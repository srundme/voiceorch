import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
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
// SnapServe adds a ₹250/mo reseller margin on top of the carrier's monthly fee.
// The original carrier price is never surfaced to end-users.
const RESELLER_MARKUP_CENTS = 25000; // ₹250 in paisa

function addMarkup(monthlyRateCents: number): number {
  return monthlyRateCents > 0 ? monthlyRateCents + RESELLER_MARKUP_CENTS : 0;
}

// ── Platform-level Vobiz credentials ────────────────────────────────────────
function getPlatformVobizCreds() {
  const authId    = process.env["VOBIZ_AUTH_ID"];
  const authToken = process.env["VOBIZ_AUTH_TOKEN"];
  return { authId, authToken, configured: !!(authId && authToken) };
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
  e164: string
): Promise<VobizOwnedNumber> {
  const url = `${VOBIZ_ACCOUNT_BASE}/${authId}/numbers/purchase-from-inventory`;
  const resp = await fetch(url, {
    method:  "POST",
    headers: vobizHeaders(authId, authToken),
    body:    JSON.stringify({ e164, currency: "INR" }),
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
 * Configure inbound webhook on a Vobiz-owned number so that incoming calls
 * are routed to our voice webhook instead of returning "not linked with any
 * application".  Uses the Plivo-compatible Number update endpoint (POST to
 * an individual resource = Plivo convention for updates).
 * Logs a warning on failure but never throws — purchase should succeed even
 * if this auxiliary step fails.
 */
async function configureVobizNumberWebhook(
  authId: string,
  authToken: string,
  e164: string,
): Promise<void> {
  const webhookBase = (process.env["WEBHOOK_BASE_URL"] ?? "").replace(/\/$/, "");
  if (!webhookBase) {
    // In local dev WEBHOOK_BASE_URL may be absent; skip silently
    return;
  }
  const e164Path = e164.startsWith("+") ? e164.slice(1) : e164;
  const url = `${VOBIZ_ACCOUNT_BASE}/${authId}/Number/${encodeURIComponent(e164Path)}/`;
  const body = {
    answer_url:    `${webhookBase}/api/webhooks/vobiz/voice`,
    answer_method: "POST",
    hangup_url:    `${webhookBase}/api/webhooks/vobiz/status`,
    hangup_method: "POST",
  };
  try {
    const resp = await fetch(url, {
      method:  "POST",
      headers: vobizHeaders(authId, authToken),
      body:    JSON.stringify(body),
    });
    if (!resp.ok) {
      const err = await resp.text();
      // Non-fatal: log so the operator can fix manually, but don't block purchase
      console.warn(`configureVobizNumberWebhook: Vobiz returned ${resp.status} for ${e164}: ${err}`);
    }
  } catch (err) {
    console.warn(`configureVobizNumberWebhook: network error for ${e164}:`, err);
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

  // 1. Purchase number from Vobiz (deducts from platform master account balance)
  let vobizNumber: VobizOwnedNumber;
  try {
    vobizNumber = await purchaseVobizNumber(authId!, authToken!, number);
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

  // 2. Phone numbers are free during beta — no wallet deduction.
  //    Vobiz carrier cost is absorbed by the platform master wallet.
  const setupCents           = Math.round((vobizNumber.setup_fee   ?? 0) * 100);
  const carrierMonthlyCents  = Math.round((vobizNumber.monthly_fee ?? 0) * 100);
  const markedUpMonthlyCents = addMarkup(carrierMonthlyCents);
  const totalCents           = 0; // free beta — skip all user charges

  // 3. Record in SnapServe DB (no deduction)

  const [row] = await db.insert(phoneNumbersTable).values({
    userId:           clerkId,
    number,
    countryCode:      (vobizNumber.country ?? countryCode).toUpperCase(),
    region:           vobizNumber.region ?? region ?? null,
    numberType:       numberType ?? "local",
    vobizNumberId:    vobizNumber.id,
    status:           "active",
    // Store the marked-up monthly rate — this is what we show and charge the user
    monthlyRateCents: markedUpMonthlyCents,
  }).returning();

  await logActivity({
    userId:       clerkId,
    eventType:    "phone_number.purchased",
    resourceType: "phone_number",
    resourceId:   String(row.id),
    description:  `Phone number ${number} purchased${totalCents > 0 ? ` (₹${(totalCents / 100).toFixed(0)})` : ""}`,
  });

  // 4. Configure inbound answer URL on VoBiz so incoming calls reach our webhook.
  //    Non-fatal — purchase record is already saved even if this step fails.
  await configureVobizNumberWebhook(authId!, authToken!, number);

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

  const webhookBase = (process.env["WEBHOOK_BASE_URL"] ?? "").replace(/\/$/, "");
  if (!webhookBase) { res.status(503).json({ error: "WEBHOOK_BASE_URL not configured." }); return; }

  await configureVobizNumberWebhook(authId!, authToken!, row.number);

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
