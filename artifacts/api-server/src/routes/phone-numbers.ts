import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, usersTable, walletTransactionsTable, phoneNumbersTable, agentsTable, vobizAccountsTable, platformSettingsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logActivity } from "../lib/activity.js";
import {
  ListPhoneNumbersResponse,
  ListAvailablePhoneNumbersQueryParams,
  ListAvailablePhoneNumbersResponse,
  PurchasePhoneNumberBody,
  AssignPhoneNumberParams,
  AssignPhoneNumberBody,
  AssignPhoneNumberResponse,
  ReleasePhoneNumberParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ── Pricing ───────────────────────────────────────────────────────────────────
// SnapServe charges a flat $10.00/mo (USD) for any phone number, regardless of
// the underlying carrier's local-currency cost. The carrier's raw price (which
// VoBiz returns in INR) is never surfaced to end-users — all user-facing
// pricing and wallet balances on SnapServe are USD.
const FLAT_MONTHLY_RATE_CENTS = 1000; // $10.00 USD

function addMarkup(monthlyRateCents: number): number {
  return monthlyRateCents > 0 ? FLAT_MONTHLY_RATE_CENTS : 0;
}

// ── Platform-level Vobiz credentials ────────────────────────────────────────
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
  return {
    "X-Auth-ID":    authId,
    "X-Auth-Token": authToken,
    "Accept":       "application/json",
    "Content-Type": "application/json",
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
  if (applicationId) body["application_id"] = applicationId;
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

/**
 * Ensure a SnapServe VoBiz Application exists with the correct inbound webhook
 * URLs and is set as the default_app. Also explicitly links the given number
 * to the app via UUID-based PATCH (best-effort; VoBiz may return 204 without
 * persisting on older accounts — use the VoBiz console as fallback).
 *
 * Returns the SnapServe app_id on success (so the caller can include it in
 * the purchase body to link at creation time), or null on failure.
 *
 * Non-fatal: logs warnings on failure but never throws so the caller succeeds.
 */
async function configureVobizNumberWebhook(
  authId: string,
  authToken: string,
  e164: string,
  webhookBase: string,
): Promise<string | null> {
  if (!webhookBase) {
    console.warn("configureVobizNumberWebhook: webhookBase is empty, skipping");
    return null;
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
        console.warn(`configureVobizNumberWebhook: create app failed ${createResp.status}: ${await createResp.text()}`);
        return null;
      }
      const created = await createResp.json() as { app_id?: string };
      appId = created.app_id ?? null;
      if (!appId) { console.warn("configureVobizNumberWebhook: create app returned no app_id"); return null; }
    }

    if (!appId) return null; // type guard

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

    // 6. Explicitly link the number to the app via UUID-based PATCH.
    //    VoBiz REST API: GET /numbers returns {id (uuid), application_id}.
    //    PATCH /numbers/{uuid} with application_id links the number to the app.
    //    This is best-effort — console.vobiz.ai is the reliable fallback if API
    //    PATCH silently ignores the field (VoBiz account-level permission).
    if (e164) {
      try {
        const numbersResp = await fetch(`${VOBIZ_ACCOUNT_BASE}/${authId}/numbers`, { headers: h });
        if (numbersResp.ok) {
          const numbersData = await numbersResp.json() as { items?: { id: string; e164: string; application_id?: string }[] };
          const match = (numbersData.items ?? []).find(n => n.e164 === e164 || n.e164 === `+${e164}`);
          if (match) {
            const patchResp = await fetch(`${VOBIZ_ACCOUNT_BASE}/${authId}/numbers/${match.id}`, {
              method:  "PATCH",
              headers: h,
              body:    JSON.stringify({ application_id: appId }),
            });
            if (patchResp.ok) {
              console.info(`configureVobizNumberWebhook: linked ${e164} (uuid=${match.id}) to app ${appId}`);
            } else {
              console.warn(`configureVobizNumberWebhook: link number PATCH ${patchResp.status}`);
            }
          }
        }
      } catch (linkErr) {
        console.warn("configureVobizNumberWebhook: number-link step failed (non-fatal):", linkErr);
      }
    }

    return appId;
  } catch (err) {
    console.warn("configureVobizNumberWebhook: unexpected error:", err);
    return null;
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
    purchasedAt:  row.purchasedAt.toISOString(),
    releasedAt:   row.releasedAt?.toISOString() ?? null,
    createdAt:    row.createdAt.toISOString(),
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

// ── POST /phone-numbers/purchase ──────────────────────────────────────────────

router.post("/phone-numbers/purchase", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = PurchasePhoneNumberBody.safeParse(req.body);
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

  // Check not already claimed by another user
  const [existing] = await db.select({ id: phoneNumbersTable.id }).from(phoneNumbersTable)
    .where(and(eq(phoneNumbersTable.number, number), eq(phoneNumbersTable.status, "active")));
  if (existing) { res.status(409).json({ error: "This number is already taken." }); return; }

  const { authId, authToken, configured } = getPlatformVobizCreds();

  if (!configured) {
    res.status(503).json({ error: "Platform carrier credentials not configured.", code: "PLATFORM_NOT_CONFIGURED" });
    return;
  }

  // 1a. Get/create the SnapServe VoBiz Application before purchase so we can
  //     pass application_id in the purchase body — this links the number at
  //     creation time (most reliable approach for VoBiz).
  const webhookBase = deriveWebhookBase(req);
  const snapserveAppId = await configureVobizNumberWebhook(authId!, authToken!, number, webhookBase);

  // 1b. Purchase number from Vobiz (deducts from platform master account balance).
  //     Pass application_id so VoBiz links the number to our app at purchase time.
  let vobizNumber: VobizOwnedNumber;
  try {
    vobizNumber = await purchaseVobizNumber(authId!, authToken!, number, snapserveAppId ?? undefined);
  } catch (err: any) {
    const msg: string = err?.message ?? "";
    if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
      res.status(404).json({ error: "This number is no longer available. Please search again." });
    } else if (msg.includes("500") || msg.toLowerCase().includes("balance")) {
      res.status(402).json({ error: "Platform balance insufficient to complete this purchase. Contact support." });
    } else {
      req.log.error({ err, number }, "Vobiz purchase failed");
      res.status(502).json({ error: "Failed to provision number. Please try again." });
    }
    return;
  }

  // 2. Compute the real charge: a flat $10.00 USD covers the first month.
  //    Phone numbers are a paid purchase — deducted from the user's wallet
  //    up front, same as any other billable action. The carrier's own
  //    setup/monthly fees (in INR) are absorbed by SnapServe and never
  //    passed through to the user.
  const totalCents = FLAT_MONTHLY_RATE_CENTS;

  // Re-read the latest balance (may have changed since the top of the
  // handler) and require it to cover the full charge before we commit the
  // number to this user. The carrier purchase above already succeeded, so on
  // insufficient funds we release the number back to Vobiz instead of
  // silently giving it away for free.
  const [freshUser] = await db.select({ walletBalanceCents: usersTable.walletBalanceCents })
    .from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!freshUser || freshUser.walletBalanceCents < totalCents) {
    try {
      await releaseVobizNumber(authId!, authToken!, number);
    } catch (err) {
      req.log.error({ err, number }, "Failed to release Vobiz number after insufficient-balance rejection");
    }
    res.status(402).json({
      error: `Insufficient balance. This number costs $${(totalCents / 100).toFixed(2)}. Top up your wallet and try again.`,
      code: "INSUFFICIENT_BALANCE",
    });
    return;
  }

  // 3. Record in SnapServe DB and deduct the charge from the user's wallet.

  const [row] = await db.insert(phoneNumbersTable).values({
    userId:           clerkId,
    number,
    countryCode:      (vobizNumber.country ?? countryCode).toUpperCase(),
    region:           vobizNumber.region ?? region ?? null,
    numberType:       numberType ?? "local",
    vobizNumberId:    vobizNumber.id,
    status:           "active",
    // Store the flat USD monthly rate — this is what we show and charge the user
    monthlyRateCents: FLAT_MONTHLY_RATE_CENTS,
  }).returning();

  await db.update(usersTable)
    .set({ walletBalanceCents: sql`${usersTable.walletBalanceCents} - ${totalCents}` })
    .where(eq(usersTable.clerkId, clerkId));

  await db.insert(walletTransactionsTable).values({
    userId:      user.id,
    type:        "debit",
    amountCents: -totalCents,
    description: `Phone number ${number} purchased (first month $${(totalCents / 100).toFixed(2)})`,
    status:      "completed",
  });

  await logActivity({
    userId:       clerkId,
    eventType:    "phone_number.purchased",
    resourceType: "phone_number",
    resourceId:   String(row.id),
    description:  `Phone number ${number} purchased${totalCents > 0 ? ` ($${(totalCents / 100).toFixed(2)})` : ""}`,
  });

  req.log.info({ number, userId: clerkId, vobizId: vobizNumber.id }, "Phone number purchased and provisioned");
  res.status(201).json(await enrichNumber(row));
});

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

  await logActivity({
    userId:       clerkId,
    eventType:    "phone_number.assigned",
    resourceType: "phone_number",
    resourceId:   String(row.id),
    description:  body.data.agentId
      ? `Phone number ${row.number} assigned to agent #${body.data.agentId}`
      : `Phone number ${row.number} unassigned from agent`,
  });

  res.json(AssignPhoneNumberResponse.parse(await enrichNumber(row)));
});

// ── POST /phone-numbers/:id/configure-webhook ─────────────────────────────────
// Idempotent repair: re-pushes the inbound answer URL to VoBiz for numbers
// that were purchased before auto-configuration was added.

router.post("/phone-numbers/:id/configure-webhook", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select()
    .from(phoneNumbersTable)
    .where(and(eq(phoneNumbersTable.id, id), eq(phoneNumbersTable.userId, clerkId)));
  if (!row) { res.status(404).json({ error: "Phone number not found" }); return; }

  const { authId, authToken, configured } = getPlatformVobizCreds();
  if (!configured) { res.status(503).json({ error: "Platform carrier credentials not configured." }); return; }

  const webhookBase = deriveWebhookBase(req);
  await configureVobizNumberWebhook(authId!, authToken!, row.number, webhookBase);

  req.log.info({ number: row.number, userId: clerkId }, "Vobiz inbound webhook reconfigured");
  res.json({ ok: true, number: row.number, answerUrl: `${webhookBase}/api/webhooks/vobiz/voice` });
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
