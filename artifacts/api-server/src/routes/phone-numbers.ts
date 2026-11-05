import { Router, type IRouter } from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import { eq, and, ne, or, inArray, sql } from "drizzle-orm";
import { db, usersTable, walletTransactionsTable, phoneNumbersTable, phoneNumberOrdersTable, agentsTable, partnersTable, vobizAccountsTable, platformSettingsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext, denyManagedClient, getManagingPartner } from "../middlewares/clientContext.js";
import { logActivity } from "../lib/activity.js";
import { issueInvoice } from "../services/invoice.js";
import { syncByoNumbers, configureByoVobizNumber, BYO_VOBIZ_PROVIDER } from "../services/byo-numbers.js";
import {
  VOBIZ_ACCOUNT_BASE,
  vobizHeaders,
  findVobizNumber,
  listVobizNumbers,
  configureVobizNumberWebhook,
  type ConfigureVobizResult,
} from "../services/vobiz-account.js";
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
import { checkOncePerEmailPromo } from "../lib/phone-promo-once.js";
import { emailPromoFingerprint } from "../lib/phone-promo-email.js";
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
import { resolveWorkspaceScope } from "../services/workspace-scope.js";
import { logger } from "../lib/logger.js";

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
  // Backfill for users whose Plivo/VoBiz key predates BYO-number import: cheap
  // DB-only reconciliation (only hits the carrier API when a row changes).
  await syncByoNumbers(clerkId);
  const scope = await resolveWorkspaceScope(clerkId);
  const rows = await db
    .select()
    .from(phoneNumbersTable)
    .where(and(
      inArray(phoneNumbersTable.userId, scope.userIds),
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
  const seen = new Set(enrichedOwn.map((r) => r.id));
  const enriched = [
    ...enrichedOwn.map((r) => ({
      ...r,
      partnerAssigned: false,
      workspaceShared: r.userId !== clerkId,
    })),
    ...enrichedPartner
      .filter((r) => !seen.has(r.id))
      .map((r) => ({ ...r, partnerAssigned: true, workspaceShared: false })),
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
  const clerkId = (req as any).clerkUserId as string;

  const resolved = resolvePhonePromo(code);
  let rejectMessage: string | null = resolved.ok
    ? null
    : resolved.reason === "expired"
      ? "This promo code has expired."
      : "That promo code isn't valid.";

  if (resolved.ok && resolved.promo.oncePerEmail) {
    const [user] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.clerkId, clerkId));
    const once = await checkOncePerEmailPromo(resolved.promo, clerkId, user?.email ?? null);
    if (!once.ok) rejectMessage = once.message;
  }

  const pricing = pricePhonePurchase(number, rejectMessage ? null : (resolved.ok ? code : null));

  res.json({
    valid:   pricing.promoCode !== null,
    code:    pricing.promoCode,
    label:   pricing.promoLabel,
    message: rejectMessage,
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
  const clerkId = (req as any).clerkUserId as string;
  const parsed = InitiatePhoneNumberPurchaseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const { number, countryCode, region, numberType, renewalMode, promoCode } = parsed.data;

  // ₹0 promos cannot go through Razorpay (minimum charge is ₹1). Claim via the
  // same provision path as wallet, with no debit.
  if (pricePhonePurchase(number, promoCode).payablePaise <= 0) {
    await handleWalletOrFreePhonePurchase(req, res);
    return;
  }

  if (!process.env["RAZORPAY_KEY_ID"] || !process.env["RAZORPAY_KEY_SECRET"]) {
    res.status(503).json({ error: "Payment gateway not configured" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const resolvedPromo = promoCode && promoCode.trim() ? resolvePhonePromo(promoCode) : null;
  if (promoCode && promoCode.trim() && !resolvedPromo?.ok) {
    res.status(400).json({ error: "That promo code isn't valid.", code: "PROMO_INVALID" });
    return;
  }
  const once = await checkOncePerEmailPromo(resolvedPromo?.ok ? resolvedPromo.promo : null, clerkId, user.email);
  if (!once.ok) {
    res.status(400).json({ error: once.message, code: once.code });
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

  const [owned] = await db
    .select({ id: phoneNumberOrdersTable.id })
    .from(phoneNumberOrdersTable)
    .where(and(
      eq(phoneNumberOrdersTable.id, purchaseOrderId),
      eq(phoneNumberOrdersTable.razorpayOrderId, razorpayOrderId),
      eq(phoneNumberOrdersTable.userId, clerkId),
    ))
    .limit(1);
  if (!owned) {
    res.status(400).json({ error: "Order not found or already processed" });
    return;
  }

  try {
    const result = await fulfillCapturedPhonePurchase({
      razorpayOrderId,
      razorpayPaymentId,
      webhookBase: deriveWebhookBase(req),
      expectedClerkId: clerkId,
    });
    const [row] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, result.phoneNumberId));
    res.status(result.alreadyDone ? 200 : 201).json(row ? await enrichNumber(row) : result);
  } catch (err) {
    if (err instanceof PhoneFulfillError) {
      res.status(err.httpStatus).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
});

// ── POST /phone-numbers/purchase/wallet ───────────────────────────────────────
// Pay for a first-time voice DID from wallet when balance > ₹20,000. Debits the
// GST-inclusive total atomically, provisions via VoBiz, invoices as usual.
// On provisioning failure the wallet is refunded.

async function handleWalletOrFreePhonePurchase(req: any, res: any): Promise<void> {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = InitiatePhoneNumberPurchaseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }

  const { number, countryCode, region, numberType, renewalMode, promoCode } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const resolvedPromo = promoCode && promoCode.trim() ? resolvePhonePromo(promoCode) : null;
  if (promoCode && promoCode.trim() && !resolvedPromo?.ok) {
    res.status(400).json({ error: "That promo code isn't valid.", code: "PROMO_INVALID" });
    return;
  }
  const oncePre = await checkOncePerEmailPromo(resolvedPromo?.ok ? resolvedPromo.promo : null, clerkId, user.email);
  if (!oncePre.ok) {
    res.status(400).json({ error: oncePre.message, code: oncePre.code });
    return;
  }

  const pricingEarly = pricePhonePurchase(number, promoCode);
  const isZeroPrice = pricingEarly.payablePaise <= 0;

  if (!isZeroPrice && user.walletBalanceCents <= PHONE_WALLET_PURCHASE_MIN_BALANCE_PAISE) {
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

      if (resolvedPromo?.ok && resolvedPromo.promo.oncePerEmail) {
        const fp = emailPromoFingerprint(user.email);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`phone-promo:${resolvedPromo.promo.code}:${fp}`}))`);
        const onceLocked = await checkOncePerEmailPromo(resolvedPromo.promo, clerkId, user.email, tx);
        if (!onceLocked.ok) {
          throw Object.assign(new Error(onceLocked.message), { status: 400, code: onceLocked.code });
        }
      }

      if (payablePaise > 0) {
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
      }

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

  if (payablePaise > 0) {
    await db.insert(walletTransactionsTable).values({
      userId: user.id,
      type: "debit",
      amountCents: -payablePaise,
      description: `Phone number ${number} purchased (${formatInr(basePaise)} + GST ${formatInr(gstPaise)} = ${formatInr(payablePaise)}, paid from wallet)${promoNote}`,
      status: "completed",
    });
  }

  await logActivity({
    userId: clerkId,
    eventType: "phone_number.purchased",
    resourceType: "phone_number",
    resourceId: String(row!.id),
    description: `Phone number ${number} purchased (${formatInr(payablePaise)}, paid from wallet)`,
  });

  if (payablePaise > 0) {
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
  }

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
}

router.post("/phone-numbers/purchase/wallet", requireAuth, clientContext, denyManagedClient, handleWalletOrFreePhonePurchase);

/** Best-effort refund of a failed/aborted phone-number purchase payment. */
async function refundOrder(
  orderRowId: number,
  razorpayPaymentId: string,
  amountCents: number,
  reason: string,
): Promise<void> {
  try {
    const razorpay = getRazorpay();
    await (razorpay.payments as any).refund(razorpayPaymentId, { amount: amountCents, speed: "optimum" });
    logger.info({ orderRowId, razorpayPaymentId, reason }, "Phone number purchase payment refunded");
  } catch (err) {
    logger.error({ err, orderRowId, razorpayPaymentId, reason }, "Failed to refund phone number purchase payment — needs manual review");
  } finally {
    await db.update(phoneNumberOrdersTable)
      .set({ status: "failed", failureReason: reason })
      .where(eq(phoneNumberOrdersTable.id, orderRowId));
  }
}

export class PhoneFulfillError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 400,
  ) {
    super(message);
    this.name = "PhoneFulfillError";
  }
}

export type FulfillPhonePurchaseResult = {
  alreadyDone: boolean;
  phoneNumberId: number;
  number: string;
  userId: string;
  assignedAgentId: number | null;
};

/**
 * Provision a voice DID after Razorpay has captured payment.
 * Used by checkout confirm, the Razorpay webhook (when the browser never
 * called /purchase/confirm), and admin repair.
 */
export async function fulfillCapturedPhonePurchase(opts: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  webhookBase: string;
  expectedClerkId?: string;
  assignLoneAgent?: boolean;
}): Promise<FulfillPhonePurchaseResult> {
  const { razorpayOrderId, razorpayPaymentId, webhookBase } = opts;

  const [existingDone] = await db
    .select()
    .from(phoneNumberOrdersTable)
    .where(and(
      eq(phoneNumberOrdersTable.razorpayOrderId, razorpayOrderId),
      ne(phoneNumberOrdersTable.numberType, "whatsapp"),
    ))
    .limit(1);

  if (!existingDone) {
    throw new PhoneFulfillError("ORDER_NOT_FOUND", "Phone purchase order not found", 404);
  }
  if (opts.expectedClerkId && existingDone.userId !== opts.expectedClerkId) {
    throw new PhoneFulfillError("FORBIDDEN", "Order not found or already processed", 400);
  }
  if (existingDone.status === "completed" && existingDone.phoneNumberId) {
    return {
      alreadyDone: true,
      phoneNumberId: existingDone.phoneNumberId,
      number: existingDone.number,
      userId: existingDone.userId,
      assignedAgentId: null,
    };
  }

  const [claimed] = await db
    .update(phoneNumberOrdersTable)
    .set({ status: "processing", razorpayPaymentId })
    .where(and(
      eq(phoneNumberOrdersTable.id, existingDone.id),
      eq(phoneNumberOrdersTable.razorpayOrderId, razorpayOrderId),
      inArray(phoneNumberOrdersTable.status, ["pending", "processing"]),
      ne(phoneNumberOrdersTable.numberType, "whatsapp"),
    ))
    .returning();

  if (!claimed) {
    const [again] = await db
      .select()
      .from(phoneNumberOrdersTable)
      .where(eq(phoneNumberOrdersTable.id, existingDone.id))
      .limit(1);
    if (again?.status === "completed" && again.phoneNumberId) {
      return {
        alreadyDone: true,
        phoneNumberId: again.phoneNumberId,
        number: again.number,
        userId: again.userId,
        assignedAgentId: null,
      };
    }
    throw new PhoneFulfillError("ORDER_NOT_FOUND", "Order not found or already processed", 400);
  }

  const clerkId = claimed.userId;
  const { number, countryCode, region, numberType, amountCents, renewalMode, promoCode } = claimed;
  const resolvedRenewalMode = renewalMode === "autopay" ? "autopay" : "wallet";
  const promoNote = promoCode ? ` [promo ${promoCode}]` : "";

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) {
    throw new PhoneFulfillError("USER_NOT_FOUND", "User not found", 404);
  }

  const { authId, authToken, configured } = getPlatformVobizCreds();
  if (!configured) {
    await db.update(phoneNumberOrdersTable)
      .set({ status: "failed", failureReason: "Platform carrier credentials not configured" })
      .where(eq(phoneNumberOrdersTable.id, claimed.id));
    throw new PhoneFulfillError("PLATFORM_NOT_CONFIGURED", "Platform carrier credentials not configured.", 503);
  }

  const [taken] = await db.select({ id: phoneNumbersTable.id, userId: phoneNumbersTable.userId })
    .from(phoneNumbersTable)
    .where(and(eq(phoneNumbersTable.number, number), eq(phoneNumbersTable.status, "active")));
  if (taken && taken.userId !== clerkId) {
    await refundOrder(claimed.id, razorpayPaymentId, amountCents, "Number claimed by another user before confirmation");
    throw new PhoneFulfillError("NUMBER_TAKEN", "This number was just taken by another user. Your payment has been refunded.", 409);
  }
  if (taken && taken.userId === clerkId) {
    await db.update(phoneNumberOrdersTable)
      .set({ status: "completed", phoneNumberId: taken.id, razorpayPaymentId })
      .where(eq(phoneNumberOrdersTable.id, claimed.id));
    const assignedAgentId = opts.assignLoneAgent
      ? await assignNumberToLoneAgent(taken.id, number, clerkId, webhookBase)
      : null;
    return {
      alreadyDone: true,
      phoneNumberId: taken.id,
      number,
      userId: clerkId,
      assignedAgentId,
    };
  }

  const linkResult = await configureVobizNumberWebhook(authId!, authToken!, number, webhookBase);
  const snapserveAppId = linkResult.appId;

  let vobizNumber: VobizOwnedNumber;
  try {
    vobizNumber = await purchaseVobizNumber(authId!, authToken!, number, snapserveAppId ?? undefined);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const owned = await findOwnedVobizNumber(authId!, authToken!, number);
    if (owned) {
      vobizNumber = owned;
      logger.info({ number, vobizId: owned.id }, "Phone fulfill: number already on VoBiz account, reusing");
    } else {
      logger.error({ err, number }, "Vobiz purchase failed after payment confirmed — refunding");
      await refundOrder(claimed.id, razorpayPaymentId, amountCents, `Vobiz provisioning failed: ${msg.slice(0, 200)}`);
      throw new PhoneFulfillError(
        "VOBIZ_FAILED",
        msg.toLowerCase().includes("not found")
          ? "This number is no longer available. Your payment has been refunded."
          : "Failed to provision number. Your payment has been refunded.",
        502,
      );
    }
  }

  const now = new Date();
  const nextRenewalAt = new Date(now.getTime() + RENEWAL_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
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
    renewalRateCents: withGstPaise(phonePurchaseBasePaise(number)),
    renewalMode:      resolvedRenewalMode,
    purchasedAt:      now,
    nextRenewalAt,
    lastRenewalAt:    now,
  }).returning();

  if (resolvedRenewalMode === "autopay" && user.razorpayCustomerId && user.razorpayTokenId && !user.autoPayEnabled) {
    await db.update(usersTable).set({ autoPayEnabled: true }).where(eq(usersTable.id, user.id));
  }

  await db.update(phoneNumberOrdersTable)
    .set({ status: "completed", phoneNumberId: row!.id, razorpayPaymentId })
    .where(eq(phoneNumberOrdersTable.id, claimed.id));

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

  logger.info({ number, userId: clerkId, vobizId: vobizNumber.id, nextRenewalAt }, "Phone number purchased and provisioned after confirmed payment");

  const postLink = await ensureVobizInboundLinked(authId!, authToken!, number, webhookBase);
  logger.info({ number, ...postLink }, "Vobiz inbound link after purchase");

  const assignedAgentId = opts.assignLoneAgent
    ? await assignNumberToLoneAgent(row!.id, number, clerkId, webhookBase)
    : null;

  return {
    alreadyDone: false,
    phoneNumberId: row!.id,
    number,
    userId: clerkId,
    assignedAgentId,
  };
}

async function findOwnedVobizNumber(
  authId: string,
  authToken: string,
  e164: string,
): Promise<VobizOwnedNumber | null> {
  const items = await listVobizNumbers(authId, vobizHeaders(authId, authToken));
  const match = findVobizNumber(items, e164);
  if (!match?.id) return null;
  return {
    id: String(match.id),
    auth_id: authId,
    e164: match.e164 ?? match.number ?? e164,
    country: "IN",
  };
}

async function assignNumberToLoneAgent(
  phoneNumberId: number,
  number: string,
  clerkId: string,
  webhookBase: string,
): Promise<number | null> {
  const agents = await db
    .select({ id: agentsTable.id, inboundPhoneNumberId: agentsTable.inboundPhoneNumberId })
    .from(agentsTable)
    .where(eq(agentsTable.userId, clerkId));
  const lone = agents.length === 1 && !agents[0]!.inboundPhoneNumberId ? agents[0]! : null;
  if (!lone) return null;

  await db.update(phoneNumbersTable)
    .set({ agentId: lone.id })
    .where(eq(phoneNumbersTable.id, phoneNumberId));
  await db.update(agentsTable)
    .set({ inboundPhoneNumberId: phoneNumberId, outboundPhoneNumberId: phoneNumberId })
    .where(eq(agentsTable.id, lone.id));

  const platform = getPlatformVobizCreds();
  if (platform.configured) {
    await ensureVobizInboundLinked(platform.authId!, platform.authToken!, number, webhookBase);
  }
  await logActivity({
    userId: clerkId,
    eventType: "phone_number.assigned",
    resourceType: "phone_number",
    resourceId: String(phoneNumberId),
    description: `Phone number ${number} assigned to agent #${lone.id}`,
  });
  return lone.id;
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
  const scope = await resolveWorkspaceScope(clerkId);

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
  /** Teammate assigning an owner-purchased number onto a shared agent. */
  let workspaceScopedAssign = false;

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

  if (!target && scope.canWrite && scope.userIds.some((id) => id !== clerkId)) {
    const [wsNum] = await db
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
        inArray(phoneNumbersTable.userId, scope.userIds),
        eq(phoneNumbersTable.status, "active"),
      ));
    if (wsNum) {
      target = wsNum;
      numberOwnerId = wsNum.userId;
      workspaceScopedAssign = true;
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
    } else if (workspaceScopedAssign) {
      if (!agent.userId || !scope.userIds.includes(agent.userId)) {
        res.status(403).json({ error: "You can only assign this number to a workspace agent" });
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
      const allInWorkspace = otherOwners.every((u) => scope.userIds.includes(u)) && scope.canWrite;
      if (!allInWorkspace) {
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
    await syncByoNumbers(clerkId, { configureAll: true });
    inboundLink = { appId: null, linked: true, verified: true, detail: "Routed via your Plivo account" };
  } else if (body.data.agentId && target.provider === BYO_VOBIZ_PROVIDER) {
    // Client's own VoBiz number — link it to SnapServe on THEIR VoBiz account
    // (the number owner's key). Best-effort: the assignment stands even if
    // VoBiz is slow, and inboundLink tells the UI whether inbound is wired.
    const r = await configureByoVobizNumber(numberOwnerId, row.number);
    req.log.info({ number: row.number, userId: clerkId, ...r }, "BYO VoBiz inbound link after assign");
    inboundLink = { appId: null, linked: r.ok, verified: r.ok, detail: r.ok ? "Routed via your VoBiz account" : r.detail };
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

  if (row.provider === BYO_VOBIZ_PROVIDER) {
    // Client's own VoBiz number: repair the link on THEIR account, not ours.
    const r = await configureByoVobizNumber(clerkId, row.number);
    req.log.info({ number: row.number, userId: clerkId, ...r }, "BYO VoBiz inbound webhook reconfigured");
    res.status(r.ok ? 200 : 502).json({
      ok: r.ok,
      number: row.number,
      answerUrl: `${deriveWebhookBase(req)}/api/webhooks/vobiz/voice`,
      detail: r.detail,
      ...(r.ok ? {} : { error: "Could not link this number on your VoBiz account. Check the Auth ID and Auth Token in Providers." }),
    });
    return;
  }
  if (row.provider !== "vobiz") {
    res.status(400).json({ error: "This number is on your own carrier account; inbound is set up there automatically." });
    return;
  }

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
    // Platform DIDs only: numbers on a client's own carrier account are linked
    // with their own keys (services/byo-numbers.ts), never the master account.
    .where(and(eq(phoneNumbersTable.userId, clerkId), eq(phoneNumbersTable.status, "active"), eq(phoneNumbersTable.provider, "vobiz")));

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
