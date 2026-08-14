import { Router, type IRouter } from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import { eq, and, ne, or, inArray, sql } from "drizzle-orm";
import { db, usersTable, walletTransactionsTable, phoneNumbersTable, phoneNumberOrdersTable, agentsTable, partnersTable, vobizAccountsTable, platformSettingsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext, denyManagedClient, getManagingPartner } from "../middlewares/clientContext.js";
import { logActivity } from "../lib/activity.js";
import { issueInvoice } from "../services/invoice.js";
import { syncByoPlivoNumbers } from "../services/byo-numbers.js";
import {
  CURRENCY_INR,
  GST_RATE,
  PHONE_RENEWAL_TOTAL_PAISE,
  PHONE_WALLET_PURCHASE_MIN_BALANCE_PAISE,
  phonePurchaseBasePaise,
  withGstPaise,
  formatInr,
  gstPortionPaise,
} from "../lib/money-inr.js";
import { pricePhonePurchase, resolvePhonePromo } from "../lib/phone-promo.js";
import {
  ListPhoneNumbersResponse,
  ListAvailablePhoneNumbersQueryParams,
  ListAvailablePhoneNumbersResponse,
  InitiatePhoneNumberPurchaseBody,
  QuotePhoneNumberPromoBody,
  ConfirmPhoneNumberPurchaseBody,
  AssignPhoneNumberParams,
  AssignPhoneNumberBody,
  AssignPhoneNumberResponse,
  ReleasePhoneNumberParams,
} from "@workspace/api-zod";
import { releasePhoneNumberRecord } from "../services/phone-number-release.js";

const router: IRouter = Router();

// ── Pricing ───────────────────────────────────────────────────────────────────
// Prefix-tiered monthly rental (before GST): +9180→₹599, +9179→₹699, else ₹659.
// First purchase = monthly rental + ₹100 one-time setup + GST.
//   • Default: Razorpay card/UPI
//   • Wallet: allowed when balance > ₹20,000 (PHONE_WALLET_PURCHASE_MIN_BALANCE_PAISE)
// Renewal every 30 days debits monthly rental + GST from the wallet
// (see services/phone-renewal.ts). Carrier VoBiz INR cost is never surfaced.
export const RENEWAL_RATE_CENTS = PHONE_RENEWAL_TOTAL_PAISE; // legacy flat rate — still used by WhatsApp numbers
export const RENEWAL_INTERVAL_DAYS = 30;

function getRazorpay() {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  });
}

function addMarkup(monthlyRateCents: number, number: string): number {
  return monthlyRateCents > 0 ? phonePurchaseBasePaise(number) : 0;
}

// ── Platform VoBiz credentials (master wallet — all DID purchase/link/release) ─
function getPlatformVobizCreds() {
  const authId    = process.env["VOBIZ_AUTH_ID"];
  const authToken = process.env["VOBIZ_AUTH_TOKEN"];
  return { authId, authToken, configured: !!(authId && authToken) };
}

/** Derive the public HTTPS base URL from the request (mirrors getHttpBaseUrl in webhooks.ts). */
function deriveWebhookBase(req: import("express").Request): string {
  const fixed = process.env["WEBHOOK_BASE_URL"];
  if (fixed) return fixed.replace(/\/$/, "");
  const host  = (req.headers["x-forwarded-host"] ?? req.hostname) as string;
  const proto = (req.headers["x-forwarded-proto"] ?? "https") as string;
  return `${proto}://${host}`;
}

// Vobiz Account API base — used for live inventory, purchase, and release.
// Each call uses the platform master account (MA_) credentials.
const VOBIZ_ACCOUNT_BASE = "https://api.vobiz.ai/api/v1/Account";

function vobizHeaders(authId: string, authToken: string) {
  const basicCreds = Buffer.from(`${authId}:${authToken}`).toString("base64");
  return {
    "Authorization": `Basic ${basicCreds}`,
    "X-Auth-ID":     authId,
    "X-Auth-Token":  authToken,
    "Accept":        "application/json",
    "Content-Type":  "application/json",
  };
}

interface VobizInventoryNumber {
  id: string;
  e164: string;
  country: string;
  region?: string;
  setup_fee?: number;
  monthly_fee?: number;
  currency?: string;
  capabilities?: { voice?: boolean; sms?: boolean };
  voice_enabled?: boolean;
  status?: string;
  is_trial_number?: boolean;
  aadhaar_verification_required?: boolean;
}

interface VobizOwnedNumber {
  id: string;
  auth_id: string;
  e164: string;
  country: string;
  region?: string;
  setup_fee?: number;
  monthly_fee?: number;
  currency?: string;
  capabilities?: { voice?: boolean };
  voice_enabled?: boolean;
  status?: string;
}

/** Fetch available (unassigned) numbers from Vobiz inventory with optional filters. */
async function fetchVobizInventory(
  authId: string,
  authToken: string,
  opts: { country?: string; search?: string; page?: number; perPage?: number }
): Promise<{ items: VobizInventoryNumber[]; total: number }> {
  const params = new URLSearchParams();
  if (opts.country)          params.set("country", opts.country);
  if (opts.search)           params.set("search",  opts.search);
  params.set("page",     String(opts.page ?? 1));
  params.set("per_page", String(opts.perPage ?? 25));

  const url = `${VOBIZ_ACCOUNT_BASE}/${authId}/inventory/numbers?${params}`;
  const resp = await fetch(url, { headers: vobizHeaders(authId, authToken) });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Vobiz inventory error ${resp.status}: ${err}`);
  }
  const data = await resp.json() as { items?: VobizInventoryNumber[]; total?: number };
  return { items: data.items ?? [], total: data.total ?? 0 };
}

/** Purchase a number from Vobiz inventory and assign it to the platform account. */
async function purchaseVobizNumber(
  authId: string,
  authToken: string,
  e164: string,
  applicationId?: string,  // if provided, link the number to this app at purchase time
): Promise<VobizOwnedNumber> {
  const url = `${VOBIZ_ACCOUNT_BASE}/${authId}/numbers/purchase-from-inventory`;
  const body: Record<string, string> = { e164, currency: "INR" };
  if (applicationId) {
    body["application_id"] = applicationId;
    body["app_id"] = applicationId;
  }
  const resp = await fetch(url, {
    method:  "POST",
    headers: vobizHeaders(authId, authToken),
    body:    JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Vobiz purchase error ${resp.status}: ${err}`);
  }
  const data = await resp.json() as { number?: VobizOwnedNumber; message?: string };
  if (!data.number) throw new Error("Vobiz purchase response missing number object");
  return data.number;
}

type VobizNumberItem = {
  id?: string;
  e164?: string;
  number?: string;
  app_id?: string | null;
  application_id?: string | null;
  application?: string | null;
};

type ConfigureVobizResult = {
  appId: string | null;
  /** PATCH/POST accepted (or number already had the SnapServe app_id). */
  linked: boolean;
  /** Re-fetched number list shows application_id === SnapServe app. */
  verified: boolean;
  detail: string;
};

function vobizDigits(n: string): string {
  return n.replace(/\D/g, "");
}

function findVobizNumber(items: VobizNumberItem[], e164: string): VobizNumberItem | undefined {
  const want = vobizDigits(e164);
  return items.find((n) => {
    const got = vobizDigits(n.e164 ?? n.number ?? "");
    return got === want || got.endsWith(want) || want.endsWith(got);
  });
}

function isVobizNumberLinked(item: VobizNumberItem | undefined, appId: string | null): boolean {
  if (!item || !appId) return false;
  const target = String(appId).trim();
  const directId = String(item.app_id ?? item.application_id ?? "").trim();
  if (directId === target) return true;
  const appUrl = String(item.application ?? "").trim();
  if (appUrl && appUrl.includes(target)) return true;
  return false;
}

async function listVobizNumbers(
  authId: string,
  headers: Record<string, string>,
): Promise<VobizNumberItem[]> {
  for (const path of [
    `${VOBIZ_ACCOUNT_BASE}/${authId}/Number/?limit=100`,
    `${VOBIZ_ACCOUNT_BASE}/${authId}/numbers?limit=100`,
    `${VOBIZ_ACCOUNT_BASE}/${authId}/Number/`,
    `${VOBIZ_ACCOUNT_BASE}/${authId}/numbers`,
  ]) {
    try {
      const resp = await fetch(path, { headers });
      if (resp.ok) {
        const data = await resp.json() as { items?: VobizNumberItem[]; objects?: VobizNumberItem[] };
        const list = data.items ?? data.objects ?? [];
        if (list.length > 0) return list;
      }
    } catch { /* try next */ }
  }
  return [];
}

/**
 * Ensure a SnapServe VoBiz Application exists with the correct inbound webhook
 * URLs and is set as the default_app. Explicitly links the given number to that
 * app and verifies the link stuck (VoBiz sometimes returns 2xx without persisting).
 */
async function configureVobizNumberWebhook(
  authId: string,
  authToken: string,
  e164: string,
  webhookBase: string,
): Promise<ConfigureVobizResult> {
  const fail = (detail: string): ConfigureVobizResult => ({
    appId: null, linked: false, verified: false, detail,
  });

  if (!webhookBase) {
    console.warn("configureVobizNumberWebhook: webhookBase is empty, skipping");
    return fail("webhookBase is empty");
  }
  const answerUrl = `${webhookBase}/api/webhooks/vobiz/voice`;
  const hangupUrl = `${webhookBase}/api/webhooks/vobiz/status`;
  const h = vobizHeaders(authId, authToken);

  try {
    let appId: string | null = null;

    // 1. If master account, try reading cached master app ID from platform_settings
    if (authId === process.env["VOBIZ_AUTH_ID"]) {
      const [cached] = await db
        .select({ value: platformSettingsTable.value })
        .from(platformSettingsTable)
        .where(eq(platformSettingsTable.key, "vobiz_snapserve_app_id"));
      appId = cached?.value ?? null;
      if (appId) {
        const check = await fetch(`${VOBIZ_ACCOUNT_BASE}/${authId}/Application/${appId}/`, { headers: h });
        if (!check.ok) appId = null;
      }
    }

    // 2. Query account's applications list for SnapServe app
    if (!appId) {
      const listResp = await fetch(`${VOBIZ_ACCOUNT_BASE}/${authId}/Application/`, { headers: h });
      if (listResp.ok) {
        const list = await listResp.json() as { objects?: { app_id: string; app_name: string }[] };
        const existing = (list.objects ?? []).find(a => a.app_name === "SnapServe");
        if (existing) appId = existing.app_id;
      }
    }

    // 3. Create SnapServe app if it doesn't exist under this authId
    if (!appId) {
      const createResp = await fetch(`${VOBIZ_ACCOUNT_BASE}/${authId}/Application/`, {
        method:  "POST",
        headers: h,
        body: JSON.stringify({
          app_name:       "SnapServe",
          answer_url:     answerUrl,
          answer_method:  "POST",
          hangup_url:     hangupUrl,
          hangup_method:  "POST",
          default_app:    true,
          // Per VoBiz docs this is the flag that auto-routes NEW numbers created
          // without an app_id (default_app alone does NOT route numbers).
          default_number_app: true,
        }),
      });
      if (!createResp.ok) {
        const errText = await createResp.text();
        console.warn(`configureVobizNumberWebhook: create app failed for ${authId} ${createResp.status}: ${errText}`);
        return fail(`create SnapServe app failed (${createResp.status})`);
      }
      const created = await createResp.json() as { app_id?: string };
      appId = created.app_id ?? null;
      if (!appId) {
        console.warn(`configureVobizNumberWebhook: create app returned no app_id for ${authId}`);
        return fail("create SnapServe app returned no app_id");
      }
    }

    // 4. If master account, update platform_settings cache
    if (authId === process.env["VOBIZ_AUTH_ID"]) {
      await db.insert(platformSettingsTable)
        .values({ key: "vobiz_snapserve_app_id", value: appId })
        .onConflictDoUpdate({ target: platformSettingsTable.key, set: { value: appId } });
    }

    // 5. Ensure app is default_app and has correct URLs (idempotent update).
    const updateResp = await fetch(`${VOBIZ_ACCOUNT_BASE}/${authId}/Application/${appId}/`, {
      method:  "POST",
      headers: h,
      body: JSON.stringify({
        answer_url:    answerUrl,
        answer_method: "POST",
        hangup_url:    hangupUrl,
        hangup_method: "POST",
        default_app:          true,
        default_endpoint_app: true,
        default_number_app:   true,
      }),
    });
    if (!updateResp.ok) {
      console.warn(`configureVobizNumberWebhook: app update failed ${updateResp.status}: ${await updateResp.text()}`);
    } else {
      console.info(`configureVobizNumberWebhook: SnapServe app ${appId} confirmed as default_app, answer_url=${answerUrl}`);
    }

    // 6. Link number → SnapServe app. Try UUID PATCH then E.164 path; verify by re-list.
    if (!e164) {
      return { appId, linked: false, verified: false, detail: "no e164 provided for number link" };
    }

    const digits = vobizDigits(e164);
    let items = await listVobizNumbers(authId, h);
    let match = findVobizNumber(items, e164);

    if (isVobizNumberLinked(match, appId)) {
      console.info(`configureVobizNumberWebhook: ${e164} already linked to SnapServe app ${appId}`);
      return { appId, linked: true, verified: true, detail: "already linked" };
    }

    const linkPayloads = [
      JSON.stringify({ app_id: appId }),
      JSON.stringify({ application_id: appId }),
      JSON.stringify({ number: e164, app_id: appId }),
      JSON.stringify({ number: digits, application_id: appId }),
    ];
    const linkTargets: Array<{ url: string; headers: Record<string, string> }> = [];

    // Account API targets (with Basic + X-Auth headers)
    if (match?.id) {
      linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/Number/${match.id}/`, headers: h });
      linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/numbers/${match.id}`, headers: h });
      linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/Application/${appId}/Number/${match.id}/`, headers: h });
    }
    linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/Number/${encodeURIComponent(digits)}/`, headers: h });
    linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/numbers/${encodeURIComponent(digits)}`, headers: h });
    linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/Application/${appId}/Number/${encodeURIComponent(digits)}/`, headers: h });
    if (e164.startsWith("+")) {
      linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/Number/${encodeURIComponent(e164)}/`, headers: h });
      linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/numbers/${encodeURIComponent(e164)}`, headers: h });
    }

    // Partner API targets (X-Auth headers)
    const partnerH = { "X-Auth-ID": authId, "X-Auth-Token": authToken, "Accept": "application/json", "Content-Type": "application/json" };
    linkTargets.push({ url: `https://api.vobiz.ai/api/v1/partner/numbers/assign`, headers: partnerH });
    linkTargets.push({ url: `https://api.vobiz.ai/api/v1/partner/numbers/${encodeURIComponent(digits)}`, headers: partnerH });
    linkTargets.push({ url: `https://api.vobiz.ai/api/v1/partner/numbers/${encodeURIComponent(digits)}/link`, headers: partnerH });

    const formH = { ...h, "Content-Type": "application/x-www-form-urlencoded" };

    // 1. AttachNumber endpoints (Plivo / VoBiz Applications API standard)
    linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/Application/${appId}/AttachNumber/`, headers: h });
    linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/Application/${appId}/AttachNumber/`, headers: formH });
    linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/Application/${appId}/attach_number/`, headers: h });
    linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/Application/${appId}/attach_number/`, headers: formH });

    // Additional payloads for AttachNumber
    const formPayloads = [
      `number=${encodeURIComponent(digits)}`,
      `number=${encodeURIComponent(e164)}`,
      `numbers=${encodeURIComponent(digits)}`,
      `numbers=${encodeURIComponent(e164)}`,
      `app_id=${encodeURIComponent(appId)}`,
    ];

    let linked = false;
    let documentedAttachOk = false;

    // 0. DOCUMENTED VoBiz attach endpoint (vobiz-applications-endpoints skill):
    //    POST /Account/{auth_id}/numbers/{number}/application  body {application_id}
    //    where {number} is the %2B-encoded E.164. This is the real API — the
    //    fallback spray below is legacy guesswork kept only as insurance.
    const plusE164 = e164.startsWith("+") ? e164 : `+${digits}`;
    try {
      const attachResp = await fetch(
        `${VOBIZ_ACCOUNT_BASE}/${authId}/numbers/${encodeURIComponent(plusE164)}/application`,
        { method: "POST", headers: h, body: JSON.stringify({ application_id: appId }) },
      );
      const attachText = await attachResp.text().catch(() => "");
      if (attachResp.ok || attachResp.status === 204) {
        documentedAttachOk = true;
        linked = true;
        console.info(`configureVobizNumberWebhook: documented attach SUCCESS ${attachResp.status} ${plusE164} -> app ${appId}`);
      } else {
        console.info(`configureVobizNumberWebhook: documented attach ${attachResp.status} ${plusE164} -> ${attachText.slice(0, 150)}`);
      }
    } catch (e) {
      console.warn("configureVobizNumberWebhook: documented attach error:", e);
    }

    // Try AttachNumber endpoints with form and JSON payloads (legacy fallback)
    if (!linked)
    for (const targetUrl of [
      `${VOBIZ_ACCOUNT_BASE}/${authId}/Application/${appId}/AttachNumber/`,
      `${VOBIZ_ACCOUNT_BASE}/${authId}/Application/${appId}/attach_number/`,
    ]) {
      for (const payload of formPayloads) {
        try {
          const resp = await fetch(targetUrl, { method: "POST", headers: formH, body: payload });
          const text = await resp.text().catch(() => "");
          if (resp.ok || resp.status === 204) {
            linked = true;
            console.info(`configureVobizNumberWebhook: AttachNumber SUCCESS ${resp.status} ${targetUrl} -> ${text.slice(0, 200)}`);
            break;
          } else {
            console.info(`configureVobizNumberWebhook: AttachNumber ${resp.status} ${targetUrl} (${payload}) -> ${text.slice(0, 150)}`);
          }
        } catch (e) {
          console.warn("configureVobizNumberWebhook: AttachNumber error:", e);
        }
      }
      if (linked) break;
    }

    if (!linked) {
      for (const target of linkTargets) {
        for (const method of ["POST", "PATCH", "PUT"]) {
          for (const body of linkPayloads) {
            try {
              const resp = await fetch(target.url, { method, headers: target.headers, body });
              const respText = await resp.text().catch(() => "");
              if (resp.ok || resp.status === 204) {
                linked = true;
                console.info(`configureVobizNumberWebhook: ${method} SUCCESS ${resp.status} ${target.url} -> ${respText.slice(0, 200)}`);
                break;
              } else {
                console.info(`configureVobizNumberWebhook: ${method} ${resp.status} ${target.url} -> ${respText.slice(0, 150)}`);
              }
            } catch (linkErr) {
              console.warn(`configureVobizNumberWebhook: ${method} error ${target.url}:`, linkErr);
            }
          }
          if (linked) break;
        }
        if (linked) break;
      }
    }

    // Brief settle + verify (VoBiz UI "Not linked" is this field).
    await new Promise((r) => setTimeout(r, 400));
    items = await listVobizNumbers(authId, h);
    match = findVobizNumber(items, e164);
    let listVerified = isVobizNumberLinked(match, appId);

    // List can lag a beat behind a successful attach — re-check once.
    if (!listVerified && linked) {
      await new Promise((r) => setTimeout(r, 800));
      items = await listVobizNumbers(authId, h);
      match = findVobizNumber(items, e164);
      listVerified = isVobizNumberLinked(match, appId);
    }

    // HONEST result. The documented attach endpoint is account-scoped, so its
    // 2xx is trustworthy even if the list lags; legacy-spray 2xx is NOT (VoBiz
    // has returned 2xx without persisting on those paths before).
    const verifiedFinal = listVerified || documentedAttachOk;

    const detail = listVerified
      ? "linked and verified"
      : documentedAttachOk
        ? "attach accepted by VoBiz (list not yet reflecting)"
        : match
          ? "number found under account but NOT linked to SnapServe app"
          : "number not found under this VoBiz account";

    console.info(
      { e164, appId, linked, verified: verifiedFinal, detail },
      "configureVobizNumberWebhook: result",
    );

    return {
      appId,
      linked,
      verified: verifiedFinal,
      detail,
    };
  } catch (err) {
    console.warn("configureVobizNumberWebhook: unexpected error:", err);
    return fail(err instanceof Error ? err.message : "unexpected error");
  }
}

/**
 * Create/link SnapServe VoBiz app for a number with retries.
 * Used on purchase + assign so inbound works without a manual "Fix inbound" step.
 */
async function ensureVobizInboundLinked(
  authId: string,
  authToken: string,
  e164: string,
  webhookBase: string,
  attempts = 3,
): Promise<ConfigureVobizResult> {
  let last: ConfigureVobizResult = {
    appId: null, linked: false, verified: false, detail: "not attempted",
  };
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 600 * i));
    last = await configureVobizNumberWebhook(authId, authToken, e164, webhookBase);
    if (last.verified) return last;
  }
  return last;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function enrichNumber(row: typeof phoneNumbersTable.$inferSelect) {
  let agentName: string | null = null;
  if (row.agentId) {
    const [ag] = await db.select({ name: agentsTable.name }).from(agentsTable).where(eq(agentsTable.id, row.agentId));
    agentName = ag?.name ?? null;
  }
  return {
    ...row,
    agentName,
    renewalMode: row.renewalMode ?? "wallet",
    renewalGraceUntil: row.renewalGraceUntil?.toISOString() ?? null,
    purchasedAt:    row.purchasedAt.toISOString(),
    nextRenewalAt:  row.nextRenewalAt?.toISOString() ?? null,
    lastRenewalAt:  row.lastRenewalAt?.toISOString() ?? null,
    releasedAt:     row.releasedAt?.toISOString() ?? null,
    createdAt:      row.createdAt.toISOString(),
  };
}

// ── GET /phone-numbers/managed ────────────────────────────────────────────────
// Returns platform-owned managed numbers visible to all authenticated users.
// These are numbers from the platform's Vobiz account that users can assign
// to their agents for test calls without KYC or purchasing their own number.

router.get("/phone-numbers/managed", requireAuth, async (req, res): Promise<void> => {
  const [row] = await db
    .select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, "managed_phone_numbers"));

  const numbers: string[] = row?.value ? (JSON.parse(row.value) as string[]) : [];
  res.json({ numbers });
});

// ── GET /phone-numbers/managed-quota ──────────────────────────────────────────
// Daily free-trial outbound allowance on platform managed numbers.

router.get("/phone-numbers/managed-quota", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const { getManagedOutboundQuota } = await import("../services/managed-outbound-quota.js");
  const quota = await getManagedOutboundQuota(clerkId);
  res.json(quota);
});

// ── GET /phone-numbers ────────────────────────────────────────────────────────

router.get("/phone-numbers", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  // Backfill for users whose Plivo key predates BYO-number import: cheap
  // DB-only reconciliation (only hits the Plivo API when a row changes).
  await syncByoPlivoNumbers(clerkId);
  const rows = await db
    .select()
    .from(phoneNumbersTable)
    .where(and(
      eq(phoneNumbersTable.userId, clerkId),
      eq(phoneNumbersTable.status, "active"),
      // WhatsApp-capable numbers are managed on the WhatsApp page, not here.
      ne(phoneNumbersTable.service, "whatsapp"),
    ));

  // Managed clients also see partner-owned numbers that are assigned to one of
  // THEIR agents (flagged partnerAssigned; they may reassign/unassign among
  // their agents). Partner numbers not on this client's agents stay invisible.
  const managingPartner = await getManagingPartner(clerkId);
  let partnerRows: typeof rows = [];
  if (managingPartner) {
    const clientAgentIds = db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.userId, clerkId));
    partnerRows = await db
      .select()
      .from(phoneNumbersTable)
      .where(and(
        eq(phoneNumbersTable.userId, managingPartner.partnerUserId),
        eq(phoneNumbersTable.status, "active"),
        ne(phoneNumbersTable.service, "whatsapp"),
        inArray(phoneNumbersTable.agentId, clientAgentIds),
      ));
  }

  const enrichedOwn = await Promise.all(rows.map(enrichNumber));
  const enrichedPartner = await Promise.all(partnerRows.map(enrichNumber));
  const enriched = [
    ...enrichedOwn.map((r) => ({ ...r, partnerAssigned: false })),
    ...enrichedPartner.map((r) => ({ ...r, partnerAssigned: true })),
  ];
  res.json(ListPhoneNumbersResponse.parse(enriched));
});

// ── GET /phone-numbers/available ──────────────────────────────────────────────
// Proxies Vobiz Account API inventory — live available numbers ready to purchase.

router.get("/phone-numbers/available", requireAuth, async (req, res): Promise<void> => {
  const query = ListAvailablePhoneNumbersQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

  const { authId, authToken, configured } = getPlatformVobizCreds();

  if (!configured) {
    res.status(503).json({ error: "Platform carrier credentials not configured.", code: "PLATFORM_NOT_CONFIGURED" });
    return;
  }

  const { countryCode, pattern } = query.data;

  try {
    const { items } = await fetchVobizInventory(authId!, authToken!, {
      country: countryCode || undefined,
      search:  pattern     || undefined,
      page:    1,
      perPage: 50,
    });

    const available = items
      .filter(n => {
        if (n.status && n.status !== "active") return false;
        if (!(n.voice_enabled ?? n.capabilities?.voice ?? true)) return false;
        return true;
      })
      .map(n => ({
        number:           n.e164,
        countryCode:      n.country.toUpperCase(),
        region:           n.region ?? null,
        numberType:       "local" as const,
        // Apply reseller markup — never expose carrier's raw price to end-users
        monthlyRateCents: addMarkup(Math.round((n.monthly_fee ?? 0) * 100), n.e164),
      }));

    res.json(ListAvailablePhoneNumbersResponse.parse(available));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch available numbers from Vobiz inventory");
    res.json([]);
  }
});

// ── POST /phone-numbers/promo/quote ───────────────────────────────────────────
// Prices a number with a promo applied so checkout can show the breakdown
// before payment. Creates nothing; /purchase/initiate re-prices independently,
// so this endpoint is display-only and never authorises a discount by itself.

router.post("/phone-numbers/promo/quote", requireAuth, async (req, res): Promise<void> => {
  const parsed = QuotePhoneNumberPromoBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  const { code, number } = parsed.data;

  const resolved = resolvePhonePromo(code);
  const pricing = pricePhonePurchase(number, resolved.ok ? code : null);

  res.json({
    valid:   pricing.promoCode !== null,
    code:    pricing.promoCode,
    label:   pricing.promoLabel,
    message: resolved.ok
      ? null
      : resolved.reason === "expired"
        ? "This promo code has expired."
        : "That promo code isn't valid.",
    basePaise:            pricing.basePaise,
    gstPaise:             pricing.gstPaise,
    payablePaise:         pricing.payablePaise,
    standardBasePaise:    pricing.standardBasePaise,
    standardPayablePaise: withGstPaise(pricing.standardBasePaise),
    discountPaise:        pricing.discountPaise,
    gstRate:              GST_RATE,
  });
});

// ── POST /phone-numbers/purchase/initiate ─────────────────────────────────────
// Creates a real Razorpay INR order for ₹800 + GST. The number is
// NOT touched (not purchased from Vobiz, not inserted into phone_numbers)
// until the payment is confirmed via /purchase/confirm below. This guarantees
// a completed payment always precedes granting the number.

router.post("/phone-numbers/purchase/initiate", requireAuth, clientContext, denyManagedClient, async (req, res): Promise<void> => {
  if (!process.env["RAZORPAY_KEY_ID"] || !process.env["RAZORPAY_KEY_SECRET"]) {
    res.status(503).json({ error: "Payment gateway not configured" });
    return;
  }

  const clerkId = (req as any).clerkUserId as string;
  const parsed = InitiatePhoneNumberPurchaseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const { number, countryCode, region, numberType, renewalMode, promoCode } = parsed.data;

  // Reject a bad code loudly. Falling through at full price would charge the
  // buyer several hundred rupees more than the total they were just shown.
  if (promoCode && promoCode.trim() && !resolvePhonePromo(promoCode).ok) {
    res.status(400).json({ error: "That promo code isn't valid.", code: "PROMO_INVALID" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (renewalMode === "autopay") {
    if (!user.razorpayCustomerId || !user.razorpayTokenId) {
      res.status(400).json({
        error: "Set up card auto-pay in Wallet before buying with Autopay renewal.",
        code: "NEED_AUTOPAY_SETUP",
      });
      return;
    }
  }

  // KYC gate — Indian numbers require completed identity verification
  if (!countryCode || countryCode.toUpperCase() === "IN") {
    const [kycAccount] = await db
      .select({ kycStatus: vobizAccountsTable.kycStatus })
      .from(vobizAccountsTable)
      .where(eq(vobizAccountsTable.userId, clerkId));
    if (!kycAccount || kycAccount.kycStatus !== "completed") {
      res.status(403).json({
        error: "Identity verification required to purchase Indian numbers.",
        code: "KYC_REQUIRED",
      });
      return;
    }
  }

  // Check not already claimed by another user, and no other pending order for this number.
  const [existing] = await db.select({ id: phoneNumbersTable.id }).from(phoneNumbersTable)
    .where(and(eq(phoneNumbersTable.number, number), eq(phoneNumbersTable.status, "active")));
  if (existing) { res.status(409).json({ error: "This number is already taken." }); return; }

  const [pendingOrder] = await db.select({ id: phoneNumberOrdersTable.id }).from(phoneNumberOrdersTable)
    .where(and(eq(phoneNumberOrdersTable.number, number), eq(phoneNumberOrdersTable.status, "pending")));
  if (pendingOrder) { res.status(409).json({ error: "A pending purchase already exists for this number." }); return; }

  const { configured } = getPlatformVobizCreds();
  if (!configured) {
    res.status(503).json({ error: "Platform carrier credentials not configured.", code: "PLATFORM_NOT_CONFIGURED" });
    return;
  }

  // Server-side pricing is authoritative: the client sends only the code, and
  // the amount charged is derived here, never taken from the request.
  const pricing = pricePhonePurchase(number, promoCode);
  const { basePaise, gstPaise, payablePaise, discountPaise } = pricing;
  const razorpay = getRazorpay();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let order: any;
  try {
    order = await razorpay.orders.create({
      amount:          payablePaise,
      currency:        CURRENCY_INR,
      receipt:         `phone_${user.id}_${Date.now()}`,
      notes:           {
        userId: String(user.id),
        clerkId,
        number,
        basePaise: String(basePaise),
        gstPaise: String(gstPaise),
        gstRate: String(GST_RATE),
        ...(pricing.promoCode ? { promoCode: pricing.promoCode, discountPaise: String(discountPaise) } : {}),
      },
      payment_capture: 1,
    } as any);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Razorpay error";
    res.status(502).json({ error: `Failed to create payment order: ${msg}` });
    return;
  }

  const [orderRow] = await db.insert(phoneNumberOrdersTable).values({
    userId:          clerkId,
    number,
    countryCode:     countryCode.toUpperCase(),
    region:          region ?? null,
    numberType:      numberType ?? "local",
    amountCents:     payablePaise, // Razorpay charge incl. GST (for refunds)
    promoCode:       pricing.promoCode,
    discountPaise,
    renewalMode,
    status:          "pending",
    razorpayOrderId: order.id,
  }).returning();

  req.log.info(
    { userId: clerkId, number, orderId: order.id, payablePaise, renewalMode, promoCode: pricing.promoCode, discountPaise },
    "Phone number purchase order initiated",
  );

  res.json({
    purchaseOrderId: orderRow!.id,
    orderId:         order.id,
    amountCents:     payablePaise,
    amount:          payablePaise,
    basePaise,
    gstPaise,
    payablePaise,
    gstRate:         GST_RATE,
    promoCode:       pricing.promoCode,
    discountPaise,
    currency:        CURRENCY_INR,
    keyId:           process.env["RAZORPAY_KEY_ID"],
    preferCard:      true,
  });
});

// ── POST /phone-numbers/purchase/confirm ──────────────────────────────────────
// Verifies the Razorpay payment signature and ONLY THEN provisions the number
// from Vobiz. If provisioning fails after a successful payment, the payment
// is refunded so the user is never charged for a number they didn't receive.

router.post("/phone-numbers/purchase/confirm", requireAuth, clientContext, denyManagedClient, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = ConfirmPhoneNumberPurchaseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  const { purchaseOrderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = parsed.data;

  const secret = process.env["RAZORPAY_KEY_SECRET"]!;
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  if (expectedSig !== razorpaySignature) {
    res.status(400).json({ error: "Invalid payment signature" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  // Atomically claim the order — WHERE status='pending' ensures only one
  // concurrent confirm request wins; duplicates find 0 rows and are rejected.
  const [claimed] = await db
    .update(phoneNumberOrdersTable)
    .set({ status: "processing", razorpayPaymentId })
    .where(
      and(
        eq(phoneNumberOrdersTable.id, purchaseOrderId),
        eq(phoneNumberOrdersTable.razorpayOrderId, razorpayOrderId),
        eq(phoneNumberOrdersTable.userId, clerkId),
        eq(phoneNumberOrdersTable.status, "pending"),
        // WhatsApp-number orders are confirmed via /whatsapp/numbers/purchase/confirm.
        ne(phoneNumberOrdersTable.numberType, "whatsapp"),
      ),
    )
    .returning();

  if (!claimed) {
    res.status(400).json({ error: "Order not found or already processed" });
    return;
  }

  const { number, countryCode, region, numberType, amountCents, renewalMode, promoCode } = claimed;
  const resolvedRenewalMode = renewalMode === "autopay" ? "autopay" : "wallet";
  const promoNote = promoCode ? ` [promo ${promoCode}]` : "";

  // Always buy from the platform VoBiz master wallet. Per-user sub-accounts
  // are not funded for DID cost and caused "balance debit failed" after the
  // customer already paid via Razorpay. SnapServe owns the DID; SnapServe
  // billing is Razorpay → user, VoBiz cost → master.
  const { authId, authToken, configured } = getPlatformVobizCreds();
  if (!configured) {
    await db.update(phoneNumberOrdersTable)
      .set({ status: "failed", failureReason: "Platform carrier credentials not configured" })
      .where(eq(phoneNumberOrdersTable.id, claimed.id));
    res.status(503).json({ error: "Platform carrier credentials not configured.", code: "PLATFORM_NOT_CONFIGURED" });
    return;
  }

  // Re-check the number wasn't claimed by someone else while payment was in flight.
  const [existing] = await db.select({ id: phoneNumbersTable.id }).from(phoneNumbersTable)
    .where(and(eq(phoneNumbersTable.number, number), eq(phoneNumbersTable.status, "active")));
  if (existing) {
    await refundOrder(req, claimed.id, razorpayPaymentId, amountCents, "Number claimed by another user before confirmation");
    res.status(409).json({ error: "This number was just taken by another user. Your payment has been refunded." });
    return;
  }

  const webhookBase = deriveWebhookBase(req);
  // Create/find SnapServe app + get app_id before VoBiz purchase (number may not
  // exist yet — full verify/retry runs after purchase succeeds).
  const linkResult = await configureVobizNumberWebhook(authId!, authToken!, number, webhookBase);
  const snapserveAppId = linkResult.appId;

  let vobizNumber: VobizOwnedNumber;
  try {
    vobizNumber = await purchaseVobizNumber(authId!, authToken!, number, snapserveAppId ?? undefined);
  } catch (err: any) {
    const msg: string = err?.message ?? "";
    req.log.error({ err, number }, "Vobiz purchase failed after payment confirmed — refunding");
    await refundOrder(req, claimed.id, razorpayPaymentId, amountCents, `Vobiz provisioning failed: ${msg.slice(0, 200)}`);
    res.status(502).json({
      error: msg.toLowerCase().includes("not found")
        ? "This number is no longer available. Your payment has been refunded."
        : "Failed to provision number. Your payment has been refunded.",
    });
    return;
  }

  const now = new Date();
  const nextRenewalAt = new Date(now.getTime() + RENEWAL_INTERVAL_DAYS * 24 * 60 * 60 * 1000);

  // Bookkeeping amounts are locked to what the order actually charged
  // (amountCents = base + 18% GST at initiate time), so a pricing change
  // between initiate and confirm can't make records disagree with the payment.
  const paidBasePaise = Math.round(amountCents / (1 + GST_RATE));

  const [row] = await db.insert(phoneNumbersTable).values({
    userId:           clerkId,
    number,
    countryCode:      (vobizNumber.country ?? countryCode).toUpperCase(),
    region:           vobizNumber.region ?? region ?? null,
    numberType:       numberType ?? "local",
    vobizNumberId:    vobizNumber.id,
    status:           "active",
    monthlyRateCents: phonePurchaseBasePaise(number),
    renewalRateCents: withGstPaise(phonePurchaseBasePaise(number)), // renewal = same as purchase price
    renewalMode:      resolvedRenewalMode,
    purchasedAt:      now,
    nextRenewalAt,
    lastRenewalAt:    now,
  }).returning();

  // Autopay renewal: ensure account-level auto-pay stays on when a mandate exists.
  if (resolvedRenewalMode === "autopay" && user.razorpayCustomerId && user.razorpayTokenId && !user.autoPayEnabled) {
    await db.update(usersTable).set({ autoPayEnabled: true }).where(eq(usersTable.id, user.id));
  }

  await db.update(phoneNumberOrdersTable)
    .set({ status: "completed", phoneNumberId: row!.id })
    .where(eq(phoneNumberOrdersTable.id, claimed.id));

  // Audit-trail record only — this is a direct payment, NOT a wallet debit,
  // so the wallet balance is intentionally left untouched here.
  await db.insert(walletTransactionsTable).values({
    userId:            user.id,
    type:              "debit",
    amountCents:       -amountCents,
    description:       `Phone number ${number} purchased (${formatInr(paidBasePaise)} + GST ${formatInr(amountCents - paidBasePaise)} = ${formatInr(amountCents)}, paid by card)${promoNote}`,
    status:            "completed",
    razorpayOrderId,
    razorpayPaymentId,
  });

  await logActivity({
    userId:       clerkId,
    eventType:    "phone_number.purchased",
    resourceType: "phone_number",
    resourceId:   String(row!.id),
    description:  `Phone number ${number} purchased (₹${(amountCents / 100).toFixed(2)}, paid via Razorpay)`,
  });

  // GST tax invoice: base ₹800 + 18% GST, paid by card (total = amountCents).
  void issueInvoice({
    user: { id: user.id, name: user.name, email: user.email },
    type: "phone_number",
    description: `Phone number ${number} — provisioning & 1 month rental${promoNote}`,
    hsnSac: "998411",
    amountCents: paidBasePaise,
    gstInclusive: false,
    razorpayOrderId,
    razorpayPaymentId,
    metadata: { number, phoneNumberId: row!.id, ...(promoCode ? { promoCode } : {}) },
  });

  req.log.info({ number, userId: clerkId, vobizId: vobizNumber.id, nextRenewalAt }, "Phone number purchased and provisioned after confirmed payment");

  // Purchase-with-application_id can still leave VoBiz "Not linked" — retry until verified.
  const postLink = await ensureVobizInboundLinked(authId!, authToken!, number, webhookBase);
  req.log.info({ number, ...postLink }, "Vobiz inbound link after purchase");

  res.status(201).json({
    ...(await enrichNumber(row!)),
    inboundLink: postLink,
  });
});

// ── POST /phone-numbers/purchase/wallet ───────────────────────────────────────
// Pay for a first-time voice DID from wallet when balance > ₹20,000. Debits the
// GST-inclusive total atomically, provisions via VoBiz, invoices as usual.
// On provisioning failure the wallet is refunded.

router.post("/phone-numbers/purchase/wallet", requireAuth, clientContext, denyManagedClient, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = InitiatePhoneNumberPurchaseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const { number, countryCode, region, numberType, renewalMode, promoCode } = parsed.data;

  if (promoCode && promoCode.trim() && !resolvePhonePromo(promoCode).ok) {
    res.status(400).json({ error: "That promo code isn't valid.", code: "PROMO_INVALID" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (user.walletBalanceCents <= PHONE_WALLET_PURCHASE_MIN_BALANCE_PAISE) {
    res.status(403).json({
      error: `Pay from wallet is available when your balance is above ${formatInr(PHONE_WALLET_PURCHASE_MIN_BALANCE_PAISE)}. Top up or pay by card instead.`,
      code: "WALLET_PURCHASE_NOT_ELIGIBLE",
      minBalancePaise: PHONE_WALLET_PURCHASE_MIN_BALANCE_PAISE,
      balanceCents: user.walletBalanceCents,
    });
    return;
  }

  if (renewalMode === "autopay") {
    if (!user.razorpayCustomerId || !user.razorpayTokenId) {
      res.status(400).json({
        error: "Set up card auto-pay in Wallet before buying with Autopay renewal.",
        code: "NEED_AUTOPAY_SETUP",
      });
      return;
    }
  }

  if (!countryCode || countryCode.toUpperCase() === "IN") {
    const [kycAccount] = await db
      .select({ kycStatus: vobizAccountsTable.kycStatus })
      .from(vobizAccountsTable)
      .where(eq(vobizAccountsTable.userId, clerkId));
    if (!kycAccount || kycAccount.kycStatus !== "completed") {
      res.status(403).json({
        error: "Identity verification required to purchase Indian numbers.",
        code: "KYC_REQUIRED",
      });
      return;
    }
  }

  const { configured, authId, authToken } = getPlatformVobizCreds();
  if (!configured) {
    res.status(503).json({ error: "Platform carrier credentials not configured.", code: "PLATFORM_NOT_CONFIGURED" });
    return;
  }

  const pricing = pricePhonePurchase(number, promoCode);
  const { basePaise, gstPaise, payablePaise, discountPaise } = pricing;
  const promoNote = pricing.promoCode ? ` [promo ${pricing.promoCode}]` : "";
  const resolvedRenewalMode = renewalMode === "autopay" ? "autopay" : "wallet";

  if (user.walletBalanceCents < payablePaise) {
    res.status(402).json({
      error: `Insufficient wallet balance. Need ${formatInr(payablePaise)}, have ${formatInr(user.walletBalanceCents)}.`,
      code: "INSUFFICIENT_BALANCE",
      payablePaise,
      balanceCents: user.walletBalanceCents,
    });
    return;
  }

  let orderRow: typeof phoneNumberOrdersTable.$inferSelect | undefined;
  let debitOk = false;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`phone-num:${number}`}))`);

      const [takenNow] = await tx.select({ id: phoneNumbersTable.id }).from(phoneNumbersTable)
        .where(and(eq(phoneNumbersTable.number, number), eq(phoneNumbersTable.status, "active")));
      if (takenNow) throw Object.assign(new Error("This number is already taken."), { status: 409 });

      const [openNow] = await tx.select({ id: phoneNumberOrdersTable.id }).from(phoneNumberOrdersTable)
        .where(and(
          eq(phoneNumberOrdersTable.number, number),
          inArray(phoneNumberOrdersTable.status, ["pending", "processing"]),
        ));
      if (openNow) throw Object.assign(new Error("A pending purchase already exists for this number."), { status: 409 });

      const [debited] = await tx
        .update(usersTable)
        .set({ walletBalanceCents: sql`${usersTable.walletBalanceCents} - ${payablePaise}` })
        .where(and(
          eq(usersTable.id, user.id),
          sql`${usersTable.walletBalanceCents} > ${PHONE_WALLET_PURCHASE_MIN_BALANCE_PAISE}`,
          sql`${usersTable.walletBalanceCents} >= ${payablePaise}`,
        ))
        .returning({ id: usersTable.id, walletBalanceCents: usersTable.walletBalanceCents });
      if (!debited) {
        throw Object.assign(new Error("Insufficient wallet balance or below the ₹20,000 wallet-purchase threshold."), {
          status: 402,
          code: "INSUFFICIENT_BALANCE",
        });
      }
      debitOk = true;

      [orderRow] = await tx.insert(phoneNumberOrdersTable).values({
        userId: clerkId,
        number,
        countryCode: countryCode.toUpperCase(),
        region: region ?? null,
        numberType: numberType ?? "local",
        amountCents: payablePaise,
        promoCode: pricing.promoCode,
        discountPaise,
        renewalMode: resolvedRenewalMode,
        status: "processing",
        razorpayOrderId: null,
        razorpayPaymentId: null,
      }).returning();
    });
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    if (status !== 500) {
      res.status(status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
      return;
    }
    req.log.error({ err, number }, "Phone wallet purchase transaction failed");
    res.status(500).json({ error: "Could not start wallet purchase. Please try again." });
    return;
  }

  if (!orderRow) {
    res.status(500).json({ error: "Could not create purchase order." });
    return;
  }

  const refundWallet = async (reason: string) => {
    if (debitOk) {
      await db
        .update(usersTable)
        .set({ walletBalanceCents: sql`${usersTable.walletBalanceCents} + ${payablePaise}` })
        .where(eq(usersTable.id, user.id));
      await db.insert(walletTransactionsTable).values({
        userId: user.id,
        type: "credit",
        amountCents: payablePaise,
        description: `Refund: phone number ${number} wallet purchase failed — ${reason.slice(0, 120)}`,
        status: "completed",
      });
    }
    await db.update(phoneNumberOrdersTable)
      .set({ status: "failed", failureReason: reason.slice(0, 400) })
      .where(eq(phoneNumberOrdersTable.id, orderRow!.id));
  };

  const webhookBase = deriveWebhookBase(req);
  const linkResult = await configureVobizNumberWebhook(authId!, authToken!, number, webhookBase);
  const snapserveAppId = linkResult.appId;

  let vobizNumber: VobizOwnedNumber;
  try {
    vobizNumber = await purchaseVobizNumber(authId!, authToken!, number, snapserveAppId ?? undefined);
  } catch (err: any) {
    const msg: string = err?.message ?? "Vobiz provisioning failed";
    req.log.error({ err, number }, "Vobiz purchase failed after wallet debit — refunding");
    await refundWallet(`Vobiz provisioning failed: ${msg.slice(0, 200)}`);
    res.status(502).json({
      error: msg.toLowerCase().includes("not found")
        ? "This number is no longer available. Your wallet has been refunded."
        : "Failed to provision number. Your wallet has been refunded.",
    });
    return;
  }

  const now = new Date();
  const nextRenewalAt = new Date(now.getTime() + RENEWAL_INTERVAL_DAYS * 24 * 60 * 60 * 1000);

  const [row] = await db.insert(phoneNumbersTable).values({
    userId: clerkId,
    number,
    countryCode: (vobizNumber.country ?? countryCode).toUpperCase(),
    region: vobizNumber.region ?? region ?? null,
    numberType: numberType ?? "local",
    vobizNumberId: vobizNumber.id,
    status: "active",
    monthlyRateCents: phonePurchaseBasePaise(number),
    renewalRateCents: withGstPaise(phonePurchaseBasePaise(number)),
    renewalMode: resolvedRenewalMode,
    purchasedAt: now,
    nextRenewalAt,
    lastRenewalAt: now,
  }).returning();

  if (resolvedRenewalMode === "autopay" && user.razorpayCustomerId && user.razorpayTokenId && !user.autoPayEnabled) {
    await db.update(usersTable).set({ autoPayEnabled: true }).where(eq(usersTable.id, user.id));
  }

  await db.update(phoneNumberOrdersTable)
    .set({ status: "completed", phoneNumberId: row!.id })
    .where(eq(phoneNumberOrdersTable.id, orderRow.id));

  await db.insert(walletTransactionsTable).values({
    userId: user.id,
    type: "debit",
    amountCents: -payablePaise,
    description: `Phone number ${number} purchased (${formatInr(basePaise)} + GST ${formatInr(gstPaise)} = ${formatInr(payablePaise)}, paid from wallet)${promoNote}`,
    status: "completed",
  });

  await logActivity({
    userId: clerkId,
    eventType: "phone_number.purchased",
    resourceType: "phone_number",
    resourceId: String(row!.id),
    description: `Phone number ${number} purchased (${formatInr(payablePaise)}, paid from wallet)`,
  });

  void issueInvoice({
    user: { id: user.id, name: user.name, email: user.email },
    type: "phone_number",
    description: `Phone number ${number} — provisioning & 1 month rental${promoNote}`,
    hsnSac: "998411",
    amountCents: basePaise,
    gstInclusive: false,
    razorpayPaymentId: `wallet:phone:${orderRow.id}`,
    metadata: {
      number,
      phoneNumberId: row!.id,
      paymentMethod: "wallet",
      phoneOrderId: orderRow.id,
      ...(pricing.promoCode ? { promoCode: pricing.promoCode } : {}),
    },
  });

  req.log.info(
    { number, userId: clerkId, vobizId: vobizNumber.id, payablePaise, nextRenewalAt },
    "Phone number purchased from wallet and provisioned",
  );

  const postLink = await ensureVobizInboundLinked(authId!, authToken!, number, webhookBase);
  req.log.info({ number, ...postLink }, "Vobiz inbound link after wallet purchase");

  res.status(201).json({
    ...(await enrichNumber(row!)),
    inboundLink: postLink,
    paidFromWallet: true,
    payablePaise,
    basePaise,
    gstPaise,
  });
});

/** Best-effort refund of a failed/aborted phone-number purchase payment. */
async function refundOrder(
  req: import("express").Request,
  orderRowId: number,
  razorpayPaymentId: string,
  amountCents: number,
  reason: string,
): Promise<void> {
  try {
    const razorpay = getRazorpay();
    await (razorpay.payments as any).refund(razorpayPaymentId, { amount: amountCents, speed: "optimum" });
    req.log.info({ orderRowId, razorpayPaymentId, reason }, "Phone number purchase payment refunded");
  } catch (err) {
    req.log.error({ err, orderRowId, razorpayPaymentId, reason }, "Failed to refund phone number purchase payment — needs manual review");
  } finally {
    await db.update(phoneNumberOrdersTable)
      .set({ status: "failed", failureReason: reason })
      .where(eq(phoneNumberOrdersTable.id, orderRowId));
  }
}

// ── PATCH /phone-numbers/:id/assign ──────────────────────────────────────────
// Number owners (and partners assigning to clients) use this freely.
// Managed clients may reassign/unassign partner-owned numbers that are already
// on one of their agents — they still cannot buy or release numbers.

router.patch("/phone-numbers/:id/assign", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params  = AssignPhoneNumberParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Validation failed", issues: params.error.issues }); return; }
  const body = AssignPhoneNumberBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Validation failed", issues: body.error.issues }); return; }

  const managingPartner = await getManagingPartner(clerkId);
  const isManagedClient = !!(managingPartner && managingPartner.partnerUserId !== clerkId);

  // Prefer numbers owned by the caller.
  let [target] = await db
    .select({
      id: phoneNumbersTable.id,
      service: phoneNumbersTable.service,
      provider: phoneNumbersTable.provider,
      userId: phoneNumbersTable.userId,
      agentId: phoneNumbersTable.agentId,
    })
    .from(phoneNumbersTable)
    .where(and(eq(phoneNumbersTable.id, params.data.id), eq(phoneNumbersTable.userId, clerkId)));

  /** DB owner of the phone_numbers row (partner when client reassigns a provided DID). */
  let numberOwnerId = clerkId;
  /** Client may only move numbers already on their agents. */
  let clientScopedReassign = false;

  if (!target && isManagedClient && managingPartner) {
    const clientAgentRows = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.userId, clerkId));
    const clientAgentIds = clientAgentRows.map((a) => a.id);
    if (clientAgentIds.length > 0) {
      const [partnerNum] = await db
        .select({
          id: phoneNumbersTable.id,
          service: phoneNumbersTable.service,
          provider: phoneNumbersTable.provider,
          userId: phoneNumbersTable.userId,
          agentId: phoneNumbersTable.agentId,
        })
        .from(phoneNumbersTable)
        .where(and(
          eq(phoneNumbersTable.id, params.data.id),
          eq(phoneNumbersTable.userId, managingPartner.partnerUserId),
          eq(phoneNumbersTable.status, "active"),
          inArray(phoneNumbersTable.agentId, clientAgentIds),
        ));
      if (partnerNum) {
        target = partnerNum;
        numberOwnerId = managingPartner.partnerUserId;
        clientScopedReassign = true;
      }
    }
  }

  if (!target) { res.status(404).json({ error: "Phone number not found" }); return; }
  if (target.service === "whatsapp") {
    res.status(400).json({ error: "This is a WhatsApp number — it can't take voice agents. Manage it on the WhatsApp page." });
    return;
  }

  // Validate the target agent. Normally it must be the caller's own agent, but
  // an ACTIVE partner may also point their number at an agent owned by one of
  // their client accounts (partner buys numbers, provisions them to clients).
  // Managed clients reassigning a partner DID may only target their own agents.
  if (body.data.agentId) {
    const [agent] = await db
      .select({ id: agentsTable.id, userId: agentsTable.userId })
      .from(agentsTable)
      .where(eq(agentsTable.id, body.data.agentId));
    if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
    if (clientScopedReassign) {
      if (agent.userId !== clerkId) {
        res.status(403).json({ error: "You can only assign this number to your own agents" });
        return;
      }
    } else if (agent.userId !== clerkId) {
      const [clientLink] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .innerJoin(partnersTable, eq(usersTable.partnerId, partnersTable.id))
        .where(and(
          eq(usersTable.clerkId, agent.userId ?? ""),
          eq(partnersTable.userId, clerkId),
          eq(partnersTable.status, "active"),
        ));
      if (!clientLink) {
        res.status(403).json({ error: "That agent belongs to another account" });
        return;
      }
    }
  } else if (!clientScopedReassign) {
    // Unassigning as owner/partner: if holders belong to another account, caller
    // must be that account's ACTIVE managing partner.
    const holders = await db
      .select({ userId: agentsTable.userId })
      .from(agentsTable)
      .where(or(
        eq(agentsTable.inboundPhoneNumberId, params.data.id),
        eq(agentsTable.outboundPhoneNumberId, params.data.id),
      ));
    const otherOwners = [...new Set(
      holders.map(h => h.userId).filter((u): u is string => !!u && u !== clerkId),
    )];
    if (otherOwners.length) {
      const links = await db
        .select({ clerkId: usersTable.clerkId })
        .from(usersTable)
        .innerJoin(partnersTable, eq(usersTable.partnerId, partnersTable.id))
        .where(and(
          inArray(usersTable.clerkId, otherOwners),
          eq(partnersTable.userId, clerkId),
          eq(partnersTable.status, "active"),
        ));
      if (links.length !== otherOwners.length) {
        res.status(403).json({ error: "This number is connected to a client agent. Your partner account must be active to change it." });
        return;
      }
    }
  }

  const [row] = await db
    .update(phoneNumbersTable)
    .set({ agentId: body.data.agentId ?? null })
    .where(and(eq(phoneNumbersTable.id, params.data.id), eq(phoneNumbersTable.userId, numberOwnerId)))
    .returning();

  if (!row) { res.status(404).json({ error: "Phone number not found" }); return; }

  // Whenever a number becomes an agent's inbound number, also set inboundPhoneNumberId
  // (so the agent page shows it correctly) and outboundPhoneNumberId (same number is
  // used for outbound caller ID unless the user overrides it later).
  // When unassigning (agentId === null) clear the previous agent's inbound reference.
  if (body.data.agentId) {
    // Revoke this number from any OTHER agent that previously held it — a
    // stale outboundPhoneNumberId would let the old agent keep placing
    // outbound calls with this caller ID (a real leak once numbers can be
    // assigned across accounts by partners).
    await db.update(agentsTable)
      .set({ inboundPhoneNumberId: null })
      .where(and(eq(agentsTable.inboundPhoneNumberId, row.id), ne(agentsTable.id, body.data.agentId)));
    await db.update(agentsTable)
      .set({ outboundPhoneNumberId: null })
      .where(and(eq(agentsTable.outboundPhoneNumberId, row.id), ne(agentsTable.id, body.data.agentId)));
    // Owner filter deliberately omitted — the agent was validated above
    // (caller's own, or a client agent of the caller's partner account).
    await db.update(agentsTable)
      .set({ inboundPhoneNumberId: row.id, outboundPhoneNumberId: row.id })
      .where(eq(agentsTable.id, body.data.agentId));
  } else {
    // Full revocation: clear BOTH directions on whichever agent held this
    // number (may be a client agent when a partner unassigns their number).
    await db.update(agentsTable)
      .set({ inboundPhoneNumberId: null })
      .where(eq(agentsTable.inboundPhoneNumberId, row.id));
    await db.update(agentsTable)
      .set({ outboundPhoneNumberId: null })
      .where(eq(agentsTable.outboundPhoneNumberId, row.id));
  }

  await logActivity({
    userId:       clerkId,
    eventType:    "phone_number.assigned",
    resourceType: "phone_number",
    resourceId:   String(row.id),
    description:  body.data.agentId
      ? `Phone number ${row.number} assigned to agent #${body.data.agentId}`
      : `Phone number ${row.number} unassigned from agent`,
  });

  // Linking a number to an agent MUST create/attach the SnapServe VoBiz
  // application automatically — no separate "Fix inbound" step for users.
  let inboundLink: ConfigureVobizResult | null = null;
  if (body.data.agentId && target.provider === "plivo") {
    // BYO Plivo number — inbound routes by To-number lookup on our Plivo webhook.
    await syncByoPlivoNumbers(clerkId, { configureAll: true });
    inboundLink = { appId: null, linked: true, verified: true, detail: "Routed via your Plivo account" };
  } else if (body.data.agentId) {
    const platform = getPlatformVobizCreds();
    const previousAgentId = target.agentId ?? null;
    const rollbackAssign = async () => {
      await db.update(phoneNumbersTable)
        .set({ agentId: previousAgentId })
        .where(eq(phoneNumbersTable.id, row.id));
      await db.update(agentsTable)
        .set({ inboundPhoneNumberId: null, outboundPhoneNumberId: null })
        .where(eq(agentsTable.id, body.data.agentId!));
      if (previousAgentId) {
        await db.update(agentsTable)
          .set({ inboundPhoneNumberId: row.id, outboundPhoneNumberId: row.id })
          .where(eq(agentsTable.id, previousAgentId));
      }
    };

    if (!platform.configured) {
      await rollbackAssign();
      res.status(503).json({ error: "Phone carrier is not configured. Try again later." });
      return;
    }
    inboundLink = await ensureVobizInboundLinked(
      platform.authId!,
      platform.authToken!,
      row.number,
      deriveWebhookBase(req),
    );
    req.log.info(
      { number: row.number, userId: clerkId, ...inboundLink },
      "Vobiz inbound link after assign",
    );
    if (!inboundLink.verified) {
      await rollbackAssign();
      res.status(502).json({
        error: "Could not link this number to SnapServe for inbound calls. Please try assigning again.",
        inboundLink,
      });
      return;
    }
  }

  res.json({
    ...AssignPhoneNumberResponse.parse(await enrichNumber(row)),
    inboundLink,
  });
});

// ── POST /phone-numbers/:id/configure-webhook ─────────────────────────────────
// Idempotent repair: re-pushes the inbound answer URL to VoBiz and verifies
// the number shows application_id = SnapServe (fixes "Not linked" in VoBiz UI).

router.post("/phone-numbers/:id/configure-webhook", requireAuth, clientContext, denyManagedClient, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select()
    .from(phoneNumbersTable)
    .where(and(eq(phoneNumbersTable.id, id), eq(phoneNumbersTable.userId, clerkId)));
  if (!row) { res.status(404).json({ error: "Phone number not found" }); return; }

  const platform = getPlatformVobizCreds();
  if (!platform.configured) { res.status(503).json({ error: "Platform carrier credentials not configured." }); return; }

  const webhookBase = deriveWebhookBase(req);
  const result = await ensureVobizInboundLinked(platform.authId!, platform.authToken!, row.number, webhookBase);

  req.log.info({ number: row.number, userId: clerkId, ...result }, "Vobiz inbound webhook reconfigured");

  if (!result.verified) {
    res.status(502).json({
      ok: false,
      number: row.number,
      answerUrl: `${webhookBase}/api/webhooks/vobiz/voice`,
      ...result,
      error: "Could not verify number is linked to the SnapServe app in VoBiz. Re-assign the number to the agent, or contact support.",
    });
    return;
  }

  res.json({
    ok: true,
    number: row.number,
    answerUrl: `${webhookBase}/api/webhooks/vobiz/voice`,
    ...result,
  });
});

// ── POST /phone-numbers/sync-vobiz-partner ─────────────────────────────────
// Re-link inbound webhooks for the user's numbers on the platform master
// VoBiz account. (Legacy name: previously synced to per-user sub-accounts.)

router.post("/phone-numbers/sync-vobiz-partner", requireAuth, clientContext, denyManagedClient, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const platform = getPlatformVobizCreds();
  if (!platform.configured || !platform.authId) {
    res.status(503).json({ error: "VoBiz platform credentials not configured" });
    return;
  }

  const userNumbers = await db
    .select()
    .from(phoneNumbersTable)
    .where(and(eq(phoneNumbersTable.userId, clerkId), eq(phoneNumbersTable.status, "active")));

  const webhookBase = deriveWebhookBase(req);
  const results = [];

  for (const num of userNumbers) {
    const linkResult = await ensureVobizInboundLinked(
      platform.authId,
      platform.authToken!,
      num.number,
      webhookBase,
    );

    results.push({
      number: num.number,
      assignedToSubaccount: false,
      subaccountAuthId: null as string | null,
      linkResult,
    });
  }

  res.json({
    ok: true,
    user: user.email ?? clerkId,
    subaccountAuthId: null,
    platformAuthId: platform.authId,
    totalSynced: results.length,
    results,
  });
});

// ── DELETE /phone-numbers/:id ─────────────────────────────────────────────────

router.delete("/phone-numbers/:id", requireAuth, clientContext, denyManagedClient, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params  = ReleasePhoneNumberParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Validation failed", issues: params.error.issues }); return; }

  const [existing] = await db
    .select()
    .from(phoneNumbersTable)
    .where(and(eq(phoneNumbersTable.id, params.data.id), eq(phoneNumbersTable.userId, clerkId)));

  if (!existing) { res.status(404).json({ error: "Phone number not found" }); return; }

  await releasePhoneNumberRecord(existing, { reason: "user_requested", log: req.log });

  res.sendStatus(204);
});

// ── GET /phone-numbers/:id/routing-rules ─────────────────────────────────────

router.get("/phone-numbers/:id/routing-rules", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"] ?? "0"), 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db
    .select({ routingRules: phoneNumbersTable.routingRules })
    .from(phoneNumbersTable)
    .where(and(eq(phoneNumbersTable.id, id), eq(phoneNumbersTable.userId, clerkId)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ routingRules: row.routingRules ?? [] });
});

// ── PATCH /phone-numbers/:id/routing-rules ────────────────────────────────────

router.patch("/phone-numbers/:id/routing-rules", requireAuth, clientContext, denyManagedClient, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"] ?? "0"), 10);
  if (!id) { res.status(400).json({ error: "Invalid phone number id" }); return; }

  const rules = req.body?.routingRules as unknown;
  if (rules !== null && rules !== undefined && !Array.isArray(rules)) {
    res.status(400).json({ error: "routingRules must be an array or null" }); return;
  }

  const [row] = await db
    .update(phoneNumbersTable)
    .set({ routingRules: (rules as typeof phoneNumbersTable.$inferInsert["routingRules"]) ?? null })
    .where(and(eq(phoneNumbersTable.id, id), eq(phoneNumbersTable.userId, clerkId)))
    .returning({ id: phoneNumbersTable.id, number: phoneNumbersTable.number });

  if (!row) { res.status(404).json({ error: "Phone number not found" }); return; }

  req.log.info({ id, ruleCount: Array.isArray(rules) ? rules.length : 0 }, "Routing rules updated");
  res.json({ ok: true });
});

export default router;
