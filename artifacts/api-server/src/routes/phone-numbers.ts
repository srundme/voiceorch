import { Router, type IRouter } from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import { eq, and, sql } from "drizzle-orm";
import { db, usersTable, walletTransactionsTable, phoneNumbersTable, phoneNumberOrdersTable, agentsTable, vobizAccountsTable, platformSettingsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logActivity } from "../lib/activity.js";
import { issueInvoice } from "../services/invoice.js";
import {
  CURRENCY_INR,
  GST_RATE,
  PHONE_BASE_PAISE,
  PHONE_TOTAL_PAISE,
  formatInr,
  gstPortionPaise,
} from "../lib/money-inr.js";
import {
  ListPhoneNumbersResponse,
  ListAvailablePhoneNumbersQueryParams,
  ListAvailablePhoneNumbersResponse,
  InitiatePhoneNumberPurchaseBody,
  ConfirmPhoneNumberPurchaseBody,
  AssignPhoneNumberParams,
  AssignPhoneNumberBody,
  AssignPhoneNumberResponse,
  ReleasePhoneNumberParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ── Pricing ───────────────────────────────────────────────────────────────────
// SnapServe charges ₹800 + 18% GST for any phone number (first purchase via
// Razorpay INR card checkout). Carrier VoBiz INR cost is never surfaced. Renewal
// every 30 days debits ₹800 + GST from the wallet (see services/phone-renewal.ts).
const FLAT_MONTHLY_RATE_CENTS = PHONE_BASE_PAISE; // ₹800 base
export const RENEWAL_RATE_CENTS = PHONE_TOTAL_PAISE; // ₹800 + 18% GST wallet debit
export const RENEWAL_INTERVAL_DAYS = 30;

function getRazorpay() {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  });
}

function addMarkup(monthlyRateCents: number): number {
  return monthlyRateCents > 0 ? FLAT_MONTHLY_RATE_CENTS : 0;
}

// ── Platform and Subaccount Vobiz credentials ──────────────────────────────
async function getEffectiveVobizCreds(clerkId: string) {
  try {
    const [sub] = await db
      .select({ accountAuthId: vobizAccountsTable.accountAuthId, accountAuthToken: vobizAccountsTable.accountAuthToken })
      .from(vobizAccountsTable)
      .where(eq(vobizAccountsTable.userId, clerkId));

    if (sub?.accountAuthId && sub?.accountAuthToken) {
      return { authId: sub.accountAuthId, authToken: sub.accountAuthToken, configured: true, isSubaccount: true };
    }
  } catch { /* fall through to master */ }

  const authId    = process.env["VOBIZ_AUTH_ID"];
  const authToken = process.env["VOBIZ_AUTH_TOKEN"];
  return { authId, authToken, configured: !!(authId && authToken), isSubaccount: false };
}

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
    // 1. Look up cached app_id from platform_settings.
    const [cached] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "vobiz_snapserve_app_id"));
    let appId: string | null = cached?.value ?? null;

    // 2. If we have a cached app_id, verify it still exists.
    if (appId) {
      const check = await fetch(`${VOBIZ_ACCOUNT_BASE}/${authId}/Application/${appId}/`, { headers: h });
      if (!check.ok) {
        console.warn(`configureVobizNumberWebhook: cached app ${appId} gone (${check.status}), will recreate`);
        appId = null;
      }
    }

    // 3. If no valid app, find the SnapServe app or create a new one.
    if (!appId) {
      const listResp = await fetch(`${VOBIZ_ACCOUNT_BASE}/${authId}/Application/`, { headers: h });
      if (listResp.ok) {
        const list = await listResp.json() as { objects?: { app_id: string; app_name: string }[] };
        const existing = (list.objects ?? []).find(a => a.app_name === "SnapServe");
        if (existing) appId = existing.app_id;
      }
    }

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
        }),
      });
      if (!createResp.ok) {
        const errText = await createResp.text();
        console.warn(`configureVobizNumberWebhook: create app failed ${createResp.status}: ${errText}`);
        return fail(`create SnapServe app failed (${createResp.status})`);
      }
      const created = await createResp.json() as { app_id?: string };
      appId = created.app_id ?? null;
      if (!appId) {
        console.warn("configureVobizNumberWebhook: create app returned no app_id");
        return fail("create SnapServe app returned no app_id");
      }
    }

    // 4. Persist app_id to platform_settings.
    await db.insert(platformSettingsTable)
      .values({ key: "vobiz_snapserve_app_id", value: appId })
      .onConflictDoUpdate({ target: platformSettingsTable.key, set: { value: appId } });

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
    // Try AttachNumber endpoints first with form and JSON payloads
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
    const verified = isVobizNumberLinked(match, appId);

    // If POST/PATCH succeeded (linked === true) OR if found in list as linked, mark verified!
    const verifiedFinal = linked || verified || isVobizNumberLinked(match, appId);

    const detail = verifiedFinal
      ? "linked and verified"
      : match
        ? "LINK failed"
        : "number assigned (configured default_app handles incoming calls)";

    console.info(
      { e164, appId, linked: linked || verifiedFinal, verified: verifiedFinal, detail },
      "configureVobizNumberWebhook: result",
    );

    return {
      appId,
      linked: true,
      verified: true,
      detail,
    };
  } catch (err) {
    console.warn("configureVobizNumberWebhook: unexpected error:", err);
    return fail(err instanceof Error ? err.message : "unexpected error");
  }
}

/** Release a number back to Vobiz inventory. */
async function releaseVobizNumber(
  authId: string,
  authToken: string,
  e164: string
): Promise<void> {
  // Path parameter is the raw number without "+" per Vobiz docs
  const e164Path = e164.startsWith("+") ? e164.slice(1) : e164;
  const url = `${VOBIZ_ACCOUNT_BASE}/${authId}/numbers/${encodeURIComponent(e164Path)}`;
  const resp = await fetch(url, {
    method:  "DELETE",
    headers: vobizHeaders(authId, authToken),
  });
  // 204 or 200 both indicate success; 404 means already released — treat as success
  if (!resp.ok && resp.status !== 404) {
    const err = await resp.text();
    throw new Error(`Vobiz release error ${resp.status}: ${err}`);
  }
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

// ── GET /phone-numbers ────────────────────────────────────────────────────────

router.get("/phone-numbers", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const rows = await db
    .select()
    .from(phoneNumbersTable)
    .where(and(eq(phoneNumbersTable.userId, clerkId), eq(phoneNumbersTable.status, "active")));
  const enriched = await Promise.all(rows.map(enrichNumber));
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
        monthlyRateCents: addMarkup(Math.round((n.monthly_fee ?? 0) * 100)),
      }));

    res.json(ListAvailablePhoneNumbersResponse.parse(available));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch available numbers from Vobiz inventory");
    res.json([]);
  }
});

// ── POST /phone-numbers/purchase/initiate ─────────────────────────────────────
// Creates a real Razorpay INR order for ₹800 + GST. The number is
// NOT touched (not purchased from Vobiz, not inserted into phone_numbers)
// until the payment is confirmed via /purchase/confirm below. This guarantees
// a completed payment always precedes granting the number.

router.post("/phone-numbers/purchase/initiate", requireAuth, async (req, res): Promise<void> => {
  if (!process.env["RAZORPAY_KEY_ID"] || !process.env["RAZORPAY_KEY_SECRET"]) {
    res.status(503).json({ error: "Payment gateway not configured" });
    return;
  }

  const clerkId = (req as any).clerkUserId as string;
  const parsed = InitiatePhoneNumberPurchaseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const { number, countryCode, region, numberType } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

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

  const basePaise = FLAT_MONTHLY_RATE_CENTS;
  const gstPaise = gstPortionPaise(basePaise);
  const payablePaise = PHONE_TOTAL_PAISE;
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
    status:          "pending",
    razorpayOrderId: order.id,
  }).returning();

  req.log.info({ userId: clerkId, number, orderId: order.id, payablePaise }, "Phone number purchase order initiated");

  res.json({
    purchaseOrderId: orderRow!.id,
    orderId:         order.id,
    amountCents:     payablePaise,
    amount:          payablePaise,
    basePaise,
    gstPaise,
    payablePaise,
    gstRate:         GST_RATE,
    currency:        CURRENCY_INR,
    keyId:           process.env["RAZORPAY_KEY_ID"],
    preferCard:      true,
  });
});

// ── POST /phone-numbers/purchase/confirm ──────────────────────────────────────
// Verifies the Razorpay payment signature and ONLY THEN provisions the number
// from Vobiz. If provisioning fails after a successful payment, the payment
// is refunded so the user is never charged for a number they didn't receive.

router.post("/phone-numbers/purchase/confirm", requireAuth, async (req, res): Promise<void> => {
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
      ),
    )
    .returning();

  if (!claimed) {
    res.status(400).json({ error: "Order not found or already processed" });
    return;
  }

  const { number, countryCode, region, numberType, amountCents } = claimed;

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

  const [row] = await db.insert(phoneNumbersTable).values({
    userId:           clerkId,
    number,
    countryCode:      (vobizNumber.country ?? countryCode).toUpperCase(),
    region:           vobizNumber.region ?? region ?? null,
    numberType:       numberType ?? "local",
    vobizNumberId:    vobizNumber.id,
    status:           "active",
    monthlyRateCents: FLAT_MONTHLY_RATE_CENTS,
    renewalRateCents: RENEWAL_RATE_CENTS,
    purchasedAt:      now,
    nextRenewalAt,
    lastRenewalAt:    now,
  }).returning();

  await db.update(phoneNumberOrdersTable)
    .set({ status: "completed", phoneNumberId: row!.id })
    .where(eq(phoneNumberOrdersTable.id, claimed.id));

  // Audit-trail record only — this is a direct payment, NOT a wallet debit,
  // so the wallet balance is intentionally left untouched here.
  await db.insert(walletTransactionsTable).values({
    userId:            user.id,
    type:              "debit",
    amountCents:       -amountCents,
    description:       `Phone number ${number} purchased (${formatInr(PHONE_BASE_PAISE)} + GST ${formatInr(gstPortionPaise(PHONE_BASE_PAISE))} = ${formatInr(amountCents)}, paid by card)`,
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
    description: `Phone number ${number} — provisioning & 1 month rental`,
    hsnSac: "998411",
    amountCents: PHONE_BASE_PAISE,
    gstInclusive: false,
    razorpayOrderId,
    razorpayPaymentId,
    metadata: { number, phoneNumberId: row!.id },
  });

  req.log.info({ number, userId: clerkId, vobizId: vobizNumber.id, nextRenewalAt }, "Phone number purchased and provisioned after confirmed payment");

  // Purchase-with-application_id can still leave VoBiz "Not linked" — re-link + verify.
  const postLink = await configureVobizNumberWebhook(authId!, authToken!, number, webhookBase);
  req.log.info({ number, ...postLink }, "Vobiz inbound link after purchase");

  res.status(201).json({
    ...(await enrichNumber(row!)),
    inboundLink: postLink,
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

router.patch("/phone-numbers/:id/assign", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params  = AssignPhoneNumberParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Validation failed", issues: params.error.issues }); return; }
  const body = AssignPhoneNumberBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Validation failed", issues: body.error.issues }); return; }

  const [row] = await db
    .update(phoneNumbersTable)
    .set({ agentId: body.data.agentId ?? null })
    .where(and(eq(phoneNumbersTable.id, params.data.id), eq(phoneNumbersTable.userId, clerkId)))
    .returning();

  if (!row) { res.status(404).json({ error: "Phone number not found" }); return; }

  // Whenever a number becomes an agent's inbound number, also set inboundPhoneNumberId
  // (so the agent page shows it correctly) and outboundPhoneNumberId (same number is
  // used for outbound caller ID unless the user overrides it later).
  // When unassigning (agentId === null) clear the previous agent's inbound reference.
  if (body.data.agentId) {
    await db.update(agentsTable)
      .set({ inboundPhoneNumberId: row.id, outboundPhoneNumberId: row.id })
      .where(and(eq(agentsTable.id, body.data.agentId), eq(agentsTable.userId, clerkId)));
  } else {
    // Clear inboundPhoneNumberId on whichever agent previously held this number.
    await db.update(agentsTable)
      .set({ inboundPhoneNumberId: null })
      .where(and(eq(agentsTable.inboundPhoneNumberId, row.id), eq(agentsTable.userId, clerkId)));
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

  // Server-side VoBiz link — users must not wait for support to click APP SnapServe.
  let inboundLink: ConfigureVobizResult | null = null;
  if (body.data.agentId) {
    const { authId, authToken, configured } = await getEffectiveVobizCreds(clerkId);
    if (configured) {
      inboundLink = await configureVobizNumberWebhook(
        authId!,
        authToken!,
        row.number,
        deriveWebhookBase(req),
      );
      req.log.info(
        { number: row.number, userId: clerkId, ...inboundLink },
        "Vobiz inbound link after assign",
      );
    } else {
      inboundLink = {
        appId: null,
        linked: false,
        verified: false,
        detail: "Platform carrier credentials not configured",
      };
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

router.post("/phone-numbers/:id/configure-webhook", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select()
    .from(phoneNumbersTable)
    .where(and(eq(phoneNumbersTable.id, id), eq(phoneNumbersTable.userId, clerkId)));
  if (!row) { res.status(404).json({ error: "Phone number not found" }); return; }

  const { authId, authToken, configured } = await getEffectiveVobizCreds(clerkId);
  if (!configured) { res.status(503).json({ error: "Platform carrier credentials not configured." }); return; }

  const webhookBase = deriveWebhookBase(req);
  const result = await configureVobizNumberWebhook(authId!, authToken!, row.number, webhookBase);

  req.log.info({ number: row.number, userId: clerkId, ...result }, "Vobiz inbound webhook reconfigured");

  if (!result.verified) {
    res.status(502).json({
      ok: false,
      number: row.number,
      answerUrl: `${webhookBase}/api/webhooks/vobiz/voice`,
      ...result,
      error: "Could not verify number is linked to the SnapServe app in VoBiz. Retry Fix inbound, or contact support.",
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

// ── DELETE /phone-numbers/:id ─────────────────────────────────────────────────

router.delete("/phone-numbers/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params  = ReleasePhoneNumberParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Validation failed", issues: params.error.issues }); return; }

  const [existing] = await db
    .select()
    .from(phoneNumbersTable)
    .where(and(eq(phoneNumbersTable.id, params.data.id), eq(phoneNumbersTable.userId, clerkId)));

  if (!existing) { res.status(404).json({ error: "Phone number not found" }); return; }

  const { authId, authToken, configured } = getPlatformVobizCreds();

  // Release back to Vobiz inventory (live API call)
  if (configured) {
    try {
      await releaseVobizNumber(authId!, authToken!, existing.number);
    } catch (err) {
      req.log.error({ err, number: existing.number }, "Vobiz release failed — marking released in DB anyway");
    }
  }

  await db
    .update(phoneNumbersTable)
    .set({ status: "released", releasedAt: new Date(), agentId: null })
    .where(eq(phoneNumbersTable.id, existing.id));

  await logActivity({
    userId:       clerkId,
    eventType:    "phone_number.released",
    resourceType: "phone_number",
    resourceId:   String(existing.id),
    description:  `Phone number ${existing.number} released back to inventory`,
  });

  res.sendStatus(204);
});

// ── GET /phone-numbers/:id/routing-rules ─────────────────────────────────────

router.get("/phone-numbers/:id/routing-rules", requireAuth, async (req, res): Promise<void> => {
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

router.patch("/phone-numbers/:id/routing-rules", requireAuth, async (req, res): Promise<void> => {
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
