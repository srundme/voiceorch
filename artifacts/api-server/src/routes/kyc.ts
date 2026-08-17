import { Router, type IRouter, type Request } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import {
  db,
  usersTable,
  vobizAccountsTable,
  vobizKycSessionsTable,
  kycAuditLogsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { encryptKey, decryptKey } from "../lib/crypto.js";
import { GetKycStatusResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const VOBIZ_PARTNER_BASE = "https://api.vobiz.ai/api/v1/partner";

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function partnerHeaders() {
  return {
    "X-Auth-ID":    process.env["VOBIZ_AUTH_ID"]   ?? "",
    "X-Auth-Token": process.env["VOBIZ_AUTH_TOKEN"] ?? "",
    "Accept":       "application/json",
    "Content-Type": "application/json",
  };
}

function platformConfigured(): boolean {
  return !!(process.env["VOBIZ_AUTH_ID"] && process.env["VOBIZ_AUTH_TOKEN"]);
}

import { getSelfBaseUrl } from "../lib/app-domain.js";

function publicBaseUrl(): string {
  return getSelfBaseUrl();
}

/** Base URL for the dashboard frontend (user-facing redirects after KYC). */
function dashboardBaseUrl(): string {
  const appBase = process.env["APP_BASE_URL"]?.replace(/\/$/, "");
  if (appBase) return appBase;
  // Fallback: same domain as API (works in Replit single-service dev)
  return getSelfBaseUrl();
}

function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim() ?? "";
  return req.socket.remoteAddress ?? "";
}

/* ── Audit logger ─────────────────────────────────────────────────────────── */

async function audit(
  eventType: string,
  opts: {
    userId?:   string | null;
    sessionId?: string | null;
    eventData?: Record<string, unknown>;
    ip?:        string;
  } = {},
): Promise<void> {
  try {
    await db.insert(kycAuditLogsTable).values({
      userId:    opts.userId    ?? null,
      sessionId: opts.sessionId ?? null,
      eventType,
      eventData: opts.eventData ?? null,
      ipAddress: opts.ip        ?? null,
    });
  } catch (err) {
    logger.error({ err, eventType }, "Failed to write KYC audit log");
  }
}

/* ── OCR extraction ───────────────────────────────────────────────────────── */

/**
 * Extracts structured fields from the raw verified_data blob returned by VoBiz.
 * VoBiz may nest PAN / Aadhaar / GST fields at different paths depending on
 * the verification type — we normalise them into a flat structure.
 */
function extractVerifiedFields(raw: Record<string, unknown>): Record<string, unknown> {
  const find = (keys: string[]): string | null => {
    for (const k of keys) {
      const v = raw[k] ?? (raw["data"] as any)?.[k] ?? (raw["result"] as any)?.[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };

  return {
    panNumber:   find(["pan_number", "pan", "PAN", "pan_no"]),
    name:        find(["name", "full_name", "applicant_name", "Name"]),
    dob:         find(["dob", "date_of_birth", "DOB"]),
    gstin:       find(["gstin", "gst_number", "GSTIN", "gst_no"]),
    aadhaarLast4:find(["aadhaar_last4", "uid_last4", "masked_uid"]),
    verifiedAt:  new Date().toISOString(),
    kycType:     find(["kyc_type", "verification_type", "type"]),
  };
}

/* ── Retry wrapper ────────────────────────────────────────────────────────── */

async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, delayMs = 500, label = "operation" } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      logger.warn({ err, attempt: i + 1, label }, "Retrying KYC DB operation");
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs * 2 ** i));
    }
  }
  throw lastErr;
}

/* ── Vobiz API calls ─────────────────────────────────────────────────────── */

export class VobizAccountExistsError extends Error {
  constructor(email: string) {
    super(`Vobiz sub-account already exists for email: ${email}`);
    this.name = "VobizAccountExistsError";
  }
}

interface VobizCreateAccountResponse {
  auth_id?: string;
  auth_token?: string;
  name?: string;
  email?: string;
  status?: string;
  account?: {
    auth_id: string;
    auth_token: string;
  };
}

async function createVobizSubAccount(
  name: string,
  email: string,
): Promise<VobizCreateAccountResponse> {
  const password = randomBytes(16).toString("hex") + "A1!";
  const authId = process.env["VOBIZ_AUTH_ID"] ?? "";
  const authToken = process.env["VOBIZ_AUTH_TOKEN"] ?? "";
  const creds = Buffer.from(`${authId}:${authToken}`).toString("base64");

  // 1. Try Plivo-standard Subaccount endpoint
  if (authId && authToken) {
    try {
      const plivoSubResp = await fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Subaccount/`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${creds}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: name || email, enabled: true }),
      });
      if (plivoSubResp.ok) {
        const data = await plivoSubResp.json() as { auth_id?: string; auth_token?: string };
        if (data.auth_id && data.auth_token) {
          return {
            account: {
              auth_id: data.auth_id,
              auth_token: data.auth_token,
            },
          } as unknown as VobizCreateAccountResponse;
        }
      }
    } catch (e) {
      logger.warn({ err: e }, "Plivo-style Subaccount creation endpoint failed, trying partner API");
    }
  }

  // 2. Partner API endpoint fallback
  const resp = await fetch(`${VOBIZ_PARTNER_BASE}/accounts`, {
    method:  "POST",
    headers: partnerHeaders(),
    body:    JSON.stringify({ name: name || email, email, password, country: "IN" }),
  });
  if (resp.status === 409) {
    throw new VobizAccountExistsError(email);
  }
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Vobiz sub-account creation failed (${resp.status}): ${err}`);
  }
  return (await resp.json()) as VobizCreateAccountResponse;
}

import {
  provisionPartnerCustomerAccount,
  transferMasterBalanceToSubAccount,
  lookupPartnerCustomerByEmail,
  type VobizPartnerCustomerAccount,
} from "../services/vobiz-partner-service.js";

async function findCompletedKycSession(accountAuthId: string): Promise<boolean> {
  if (!accountAuthId) return false;
  try {
    const resp = await fetch(
      `${VOBIZ_PARTNER_BASE}/kyc-sessions?account_auth_id=${encodeURIComponent(accountAuthId)}&page=1&size=20`,
      { method: "GET", headers: partnerHeaders() },
    );
    if (!resp.ok) return false;
    const body = (await resp.json()) as { sessions?: Array<{ status?: string }> };
    const sessions = Array.isArray(body.sessions) ? body.sessions : [];
    return sessions.some((s) => s.status === "kyc_completed");
  } catch (err) {
    logger.warn({ err, accountAuthId }, "findCompletedKycSession failed");
    return false;
  }
}

export async function ensureVobizSubAccount(
  clerkId: string,
  name?: string | null,
  email?: string | null,
): Promise<{ authId: string; authToken: string }> {
  let [account] = await db
    .select()
    .from(vobizAccountsTable)
    .where(eq(vobizAccountsTable.userId, clerkId));

  if (account?.vobizAuthId && account?.vobizAuthTokenEncrypted) {
    return {
      authId: account.vobizAuthId,
      authToken: decryptKey(account.vobizAuthTokenEncrypted),
    };
  }

  if (!platformConfigured()) {
    const authId = process.env["VOBIZ_AUTH_ID"] ?? "";
    const authToken = process.env["VOBIZ_AUTH_TOKEN"] ?? "";
    return { authId, authToken };
  }

  const targetEmail = email ?? `${clerkId}@snapserve.ai`;
  const targetName = name ?? email ?? clerkId;

  let vobizAccount: VobizPartnerCustomerAccount | VobizCreateAccountResponse | null = null;

  try {
    vobizAccount = await provisionPartnerCustomerAccount(targetName, targetEmail);
  } catch { /* ignore error and fall back */ }

  if (!vobizAccount?.auth_id) {
    try {
      vobizAccount = await createVobizSubAccount(targetName, targetEmail);
    } catch (err: any) {
      if (err instanceof VobizAccountExistsError) {
        const existing = await lookupPartnerCustomerByEmail(targetEmail) ?? await fetchVobizSubAccountByEmail(targetEmail);
        if (existing) {
          vobizAccount = existing;
        } else {
          const authId = process.env["VOBIZ_AUTH_ID"] ?? "";
          const authToken = process.env["VOBIZ_AUTH_TOKEN"] ?? "";
          return { authId, authToken };
        }
      } else {
        const authId = process.env["VOBIZ_AUTH_ID"] ?? "";
        const authToken = process.env["VOBIZ_AUTH_TOKEN"] ?? "";
        return { authId, authToken };
      }
    }
  }

  const tokenToEncrypt = vobizAccount.auth_token ?? process.env["VOBIZ_AUTH_TOKEN"] ?? "";

  const [inserted] = await db
    .insert(vobizAccountsTable)
    .values({
      userId: clerkId,
      vobizAuthId: vobizAccount.auth_id ?? "",
      vobizAuthTokenEncrypted: encryptKey(tokenToEncrypt),
      kycStatus: "pending",
    })
    .onConflictDoUpdate({
      target: vobizAccountsTable.userId,
      set: {
        vobizAuthId: vobizAccount.auth_id,
        vobizAuthTokenEncrypted: encryptKey(tokenToEncrypt),
      },
    })
    .returning();

  // Auto-fund sub-account with operational balance from master partner wallet
  void transferMasterBalanceToSubAccount(inserted.vobizAuthId, 50);

  return {
    authId: inserted.vobizAuthId,
    authToken: tokenToEncrypt,
  };
}

export async function transferVobizSubAccountBalance(customerAuthId: string, amountInr: number = 50): Promise<boolean> {
  return transferMasterBalanceToSubAccount(customerAuthId, amountInr);
}

/**
 * Recovery path: when VoBiz says an account already exists (409) but we have
 * no record in our DB (e.g. after a data wipe), scan the KYC sessions list for
 * a session whose customer_email or metadata.email matches the user's address.
 * Each session carries account_auth_id, so a match lets us re-link the account.
 *
 * Going forward every new session includes metadata.email so this always works.
 * For older redirect-flow sessions (no email stored), only email-flow sessions
 * (customer_email set) or sessions with metadata.email will match.
 */
async function fetchVobizSubAccountByEmail(
  email: string,
): Promise<VobizCreateAccountResponse | null> {
  const emailLower = email.toLowerCase();
  let page = 1;
  const size = 100;

  while (page <= 10) {
    const url = `${VOBIZ_PARTNER_BASE}/kyc-sessions?page=${page}&size=${size}`;
    const resp = await fetch(url, { method: "GET", headers: partnerHeaders() });
    const body = await resp.text();
    logger.info({ url, status: resp.status, snippet: body.slice(0, 400) }, "VoBiz GET kyc-sessions (recovery)");

    if (!resp.ok) {
      logger.warn({ status: resp.status, body: body.slice(0, 400) }, "VoBiz kyc-sessions list returned non-OK; cannot recover auth_id");
      break;
    }

    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { break; }

    const obj     = parsed as Record<string, unknown>;
    const sessions = Array.isArray(obj["sessions"]) ? obj["sessions"] as Record<string, unknown>[] : [];
    const total    = typeof obj["total"] === "number" ? obj["total"] : 0;

    for (const s of sessions) {
      const authId = typeof s["account_auth_id"] === "string" ? s["account_auth_id"] : null;
      if (!authId) continue;

      const sessionEmail = typeof s["customer_email"] === "string" ? s["customer_email"] : null;
      const metaEmail    = (s["metadata"] as Record<string, unknown> | null)?.["email"];
      const metaStr      = typeof metaEmail === "string" ? metaEmail : null;

      if (sessionEmail?.toLowerCase() === emailLower || metaStr?.toLowerCase() === emailLower) {
        logger.info({ authId, email }, "Recovered account_auth_id from KYC sessions list");
        // auth_token is unknown for stale accounts; store empty string (token is only
        // needed for voice calls, not for the KYC flow itself).
        return { auth_id: authId, auth_token: "", name: "", email, status: "recovered" };
      }
    }

    if (sessions.length < size || page * size >= total) break;
    page++;
  }

  logger.warn({ email }, "Could not find account_auth_id in VoBiz KYC sessions list");
  return null;
}

interface VobizKycSessionResponse {
  session_id: string;
  status:     string;
  widget_url: string | null;
}

async function createVobizKycSession(
  accountAuthId: string,
  redirectUrl:   string,
  webhookUrl:    string,
  userEmail:     string,
): Promise<VobizKycSessionResponse> {
  const resp = await fetch(`${VOBIZ_PARTNER_BASE}/kyc-sessions`, {
    method:  "POST",
    headers: partnerHeaders(),
    body:    JSON.stringify({
      account_auth_id: accountAuthId,
      flow_type:       "redirect",
      redirect_url:    redirectUrl,
      webhook_url:     webhookUrl,
      expires_in_days: 7,
      // Store email in metadata so fetchVobizSubAccountByEmail can recover
      // the account_auth_id if our DB is ever wiped.
      metadata:        { email: userEmail },
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Vobiz KYC session creation failed (${resp.status}): ${err}`);
  }
  return resp.json() as Promise<VobizKycSessionResponse>;
}

/**
 * Fetch the authoritative status of a KYC session directly from VoBiz.
 * Used by the redirect callback to verify completion without trusting
 * caller-supplied query params.
 */
async function fetchVobizSessionStatus(sessionId: string): Promise<string | null> {
  try {
    const resp = await fetch(`${VOBIZ_PARTNER_BASE}/kyc-sessions/${encodeURIComponent(sessionId)}`, {
      method:  "GET",
      headers: partnerHeaders(),
    });
    if (!resp.ok) {
      logger.warn({ sessionId, status: resp.status }, "VoBiz session status fetch returned non-OK");
      return null;
    }
    const body = await resp.json() as Record<string, unknown>;
    return typeof body["status"] === "string" ? body["status"] : null;
  } catch (err) {
    logger.error({ err, sessionId }, "Failed to fetch VoBiz session status");
    return null;
  }
}

/**
 * Constant-time comparison for webhook token strings.
 * Returns false if lengths differ (avoids timing leak on length).
 */
function safeTokenEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/* ── GET /kyc/status ─────────────────────────────────────────────────────── */

router.get("/kyc/status", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;

  const [account] = await db
    .select()
    .from(vobizAccountsTable)
    .where(eq(vobizAccountsTable.userId, clerkId));

  if (!account) {
    res.json(GetKycStatusResponse.parse({ kycStatus: "pending" }));
    return;
  }

  const [session] = await db
    .select()
    .from(vobizKycSessionsTable)
    .where(eq(vobizKycSessionsTable.userId, clerkId))
    .orderBy(desc(vobizKycSessionsTable.createdAt))
    .limit(1);

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  let sessionStatus = session?.status ?? null;
  let widgetUrl = session?.widgetUrl ?? null;

  if (session && sessionStatus && !["kyc_completed", "revoked", "expired"].includes(sessionStatus)) {
    const ageMs = Date.now() - session.createdAt.getTime();
    if (ageMs > SEVEN_DAYS_MS) {
      sessionStatus = "expired";
      // Auto-update session status in DB async
      db.update(vobizKycSessionsTable)
        .set({ status: "expired" })
        .where(eq(vobizKycSessionsTable.id, session.id))
        .catch((err) => logger.warn({ err }, "Failed to auto-expire stale KYC session"));
    }
  }

  if (sessionStatus === "kyc_completed" || sessionStatus === "revoked" || sessionStatus === "expired") {
    widgetUrl = null;
  }

  res.json(GetKycStatusResponse.parse({
    kycStatus:     account.kycStatus,
    sessionId:     session?.vobizSessionId ?? null,
    sessionStatus: sessionStatus,
    widgetUrl:     widgetUrl,
    completedAt:   account.updatedAt?.toISOString() ?? null,
  }));
});

/* ── POST /kyc/start ─────────────────────────────────────────────────────── */

router.post("/kyc/start", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const ip      = clientIp(req);

  if (!platformConfigured()) {
    res.status(503).json({ error: "Platform carrier credentials not configured.", code: "PLATFORM_NOT_CONFIGURED" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  // 1. Get or create VoBiz sub-account. Re-link if the email already exists
  // on the carrier (DB wipe, retry, or a previous SnapServe signup).
  const email = user.email ?? `${clerkId}@snapserve.ai`;
  try {
    await ensureVobizSubAccount(clerkId, user.name, email);
  } catch (err) {
    req.log.error({ err, clerkId }, "ensureVobizSubAccount threw during KYC start");
  }

  let [account] = await db
    .select()
    .from(vobizAccountsTable)
    .where(eq(vobizAccountsTable.userId, clerkId));

  if (!account) {
    req.log.warn({ clerkId, email }, "No local VoBiz row after provision — looking up carrier account by email");
    const existing =
      (await lookupPartnerCustomerByEmail(email)) ??
      (await fetchVobizSubAccountByEmail(email));
    if (!existing?.auth_id) {
      req.log.error({ clerkId, email }, "VoBiz account exists or provision failed; could not re-link by email");
      res.status(409).json({
        error: "A verification account for this email already exists on the carrier but could not be re-linked. Please contact support.",
      });
      return;
    }

    [account] = await db
      .insert(vobizAccountsTable)
      .values({
        userId: clerkId,
        vobizAuthId: existing.auth_id,
        vobizAuthTokenEncrypted: encryptKey(existing.auth_token ?? ""),
        kycStatus: "pending",
      })
      .onConflictDoUpdate({
        target: vobizAccountsTable.userId,
        set: {
          vobizAuthId: existing.auth_id,
          vobizAuthTokenEncrypted: encryptKey(existing.auth_token ?? ""),
        },
      })
      .returning();

    req.log.info({ clerkId, vobizAuthId: existing.auth_id }, "Re-linked existing VoBiz account by email");
    await audit("account_provisioned", {
      userId: clerkId,
      eventData: { vobizAuthId: existing.auth_id, recovered: true },
      ip,
    });
  }

  if (!account || !account.vobizAuthId) {
    res.status(502).json({ error: "Failed to provision verification account. Please try again." });
    return;
  }

  if (account.kycStatus !== "completed" && (await findCompletedKycSession(account.vobizAuthId))) {
    await db
      .update(vobizAccountsTable)
      .set({ kycStatus: "completed" })
      .where(eq(vobizAccountsTable.userId, clerkId));
    account = { ...account, kycStatus: "completed" };
    req.log.info({ clerkId, vobizAuthId: account.vobizAuthId }, "Synced already-completed carrier KYC");
  }

  // Already completed — return early
  if (account.kycStatus === "completed") {
    const [session] = await db
      .select()
      .from(vobizKycSessionsTable)
      .where(eq(vobizKycSessionsTable.userId, clerkId))
      .orderBy(desc(vobizKycSessionsTable.createdAt))
      .limit(1);

    res.status(201).json({
      sessionId: session?.vobizSessionId ?? account.vobizAuthId,
      status:    "kyc_completed",
      widgetUrl: null,
    });
    return;
  }

  // 2. Create redirect-flow KYC session
  // Generate a per-session secret token that will be appended to the webhook URL.
  // VoBiz sends the webhook to this URL, so only legitimate VoBiz requests will
  // carry the correct token — forged webhook calls cannot know it.
  const webhookToken = randomBytes(32).toString("hex");

  const base        = publicBaseUrl();
  const redirectUrl = `${base}/api/kyc/callback`;
  const webhookUrl  = `${base}/api/kyc/webhook?wh_token=${webhookToken}`;

  let kycSession: VobizKycSessionResponse;
  try {
    kycSession = await createVobizKycSession(account.vobizAuthId, redirectUrl, webhookUrl, user.email ?? "");
  } catch (err: any) {
    req.log.error({ err, clerkId }, "Failed to create Vobiz KYC session");
    res.status(502).json({ error: "Failed to start KYC session. Please try again." });
    return;
  }

  // 3. Persist session (including the webhook token for later verification)
  await db.insert(vobizKycSessionsTable).values({
    userId:             clerkId,
    vobizSessionId:     kycSession.session_id,
    vobizAccountAuthId: account.vobizAuthId,
    flowType:           "redirect",
    status:             kycSession.status,
    widgetUrl:          kycSession.widget_url ?? null,
    redirectUrl,
    webhookToken,
  });

  await audit("session_created", {
    userId:    clerkId,
    sessionId: kycSession.session_id,
    eventData: { status: kycSession.status },
    ip,
  });

  req.log.info({ clerkId, sessionId: kycSession.session_id }, "KYC session started");
  res.status(201).json({
    sessionId: kycSession.session_id,
    status:    kycSession.status,
    widgetUrl: kycSession.widget_url ?? null,
  });
});

/* ── GET /kyc/callback ───────────────────────────────────────────────────── */
// VoBiz redirects the user's browser here after they complete (or abandon) the
// KYC widget. No Clerk session — the session_id ties back to our DB.
//
// SECURITY: The `status` query param is provided by VoBiz in the redirect URL
// but flows through the user's browser and can be tampered with. We ignore it
// for any privileged state transition and instead verify the real session
// status directly with the VoBiz partner API before marking KYC completed.

router.get("/kyc/callback", async (req, res): Promise<void> => {
  // VoBiz passes session_id and auth_id as query params on redirect.
  // We intentionally do NOT use the `status` param for DB state changes.
  const { session_id, auth_id } = req.query as Record<string, string>;
  const ip = clientIp(req);

  if (!session_id) { res.redirect(`${dashboardBaseUrl()}/app/kyc?kyc=error`); return; }

  let verifiedStatus: string | null = null;

  try {
    const [session] = await db
      .select()
      .from(vobizKycSessionsTable)
      .where(eq(vobizKycSessionsTable.vobizSessionId, session_id));

    if (session) {
      // Fetch the authoritative status from VoBiz — do not trust query params
      verifiedStatus = await fetchVobizSessionStatus(session_id);

      // Fall back to the current DB status if the VoBiz API call fails,
      // so the callback still redirects correctly without a privilege escalation.
      const newStatus = verifiedStatus ?? session.status;

      await withRetry(
        () => db
          .update(vobizKycSessionsTable)
          .set({ status: newStatus, completedAt: newStatus === "kyc_completed" ? new Date() : undefined })
          .where(eq(vobizKycSessionsTable.vobizSessionId, session_id)),
        { label: "callback-session-update" },
      );

      if (newStatus === "kyc_completed") {
        await withRetry(
          () => db
            .update(vobizAccountsTable)
            .set({ kycStatus: "completed" })
            .where(eq(vobizAccountsTable.userId, session.userId)),
          { label: "callback-account-update" },
        );
        req.log.info({ sessionId: session_id, userId: session.userId }, "KYC completed via redirect callback (provider-verified)");
      }

      await audit("callback_received", {
        userId:    session.userId,
        sessionId: session_id,
        eventData: { verifiedStatus: newStatus, auth_id: auth_id ?? null },
        ip,
      });

      req.log.info({ sessionId: session_id, userId: session.userId, verifiedStatus: newStatus }, "KYC redirect callback received (VoBiz-verified)");
    }
  } catch (err) {
    req.log.error({ err, session_id }, "Error processing KYC callback");
  }

  const outcome = verifiedStatus === "kyc_completed" ? "completed" : (verifiedStatus ?? "pending");
  res.redirect(`${dashboardBaseUrl()}/app/kyc?kyc=${outcome}`);
});

/* ── POST /kyc/webhook ───────────────────────────────────────────────────── */
// VoBiz fires this for kyc.completed / kyc.failed / kyc.session_revoked.
// Respond 200 immediately; update DB with retry + idempotency + audit.
//
// SECURITY: Each session is created with a unique secret token embedded in the
// webhook URL (?wh_token=<hex>). We verify this token via constant-time
// comparison before processing any state change. Requests lacking the correct
// token are rejected immediately and logged, preventing forged webhook abuse.
// For kyc.completed events a secondary VoBiz API confirmation is also required.

router.post("/kyc/webhook", async (req, res): Promise<void> => {
  const body = req.body as {
    event?:         string;
    session_id?:    string;
    auth_id?:       string;
    verified_data?: Record<string, unknown>;
  };

  const { event, session_id } = body;
  const suppliedToken = typeof req.query["wh_token"] === "string" ? req.query["wh_token"] : "";

  // Reject immediately if basic fields are missing — fast path before DB
  if (!event || !session_id) {
    res.sendStatus(400);
    return;
  }

  const ip = clientIp(req);

  try {
    const [session] = await db
      .select()
      .from(vobizKycSessionsTable)
      .where(eq(vobizKycSessionsTable.vobizSessionId, session_id));

    if (!session) {
      req.log.warn({ session_id, event }, "KYC webhook for unknown session — ignored");
      res.sendStatus(200); // return 200 to avoid VoBiz retry storm on stale sessions
      return;
    }

    // Verify the per-session webhook token using constant-time comparison.
    // Sessions created before this change have no stored token (webhookToken=null);
    // reject them too to avoid the original bypass window.
    const storedToken = session.webhookToken ?? "";
    if (!storedToken || !suppliedToken || !safeTokenEqual(storedToken, suppliedToken)) {
      req.log.warn({ session_id, event }, "KYC webhook rejected: invalid or missing webhook token");
      await audit("webhook_auth_failed", {
        userId:    session.userId,
        sessionId: session_id,
        eventData: { event, reason: "invalid_token" },
        ip,
      });
      res.sendStatus(403);
      return;
    }

    res.sendStatus(200); // fast ack after auth passes

    // Store raw webhook payload regardless of event type
    await withRetry(
      () => db
        .update(vobizKycSessionsTable)
        .set({ webhookPayload: body as any })
        .where(eq(vobizKycSessionsTable.vobizSessionId, session_id)),
      { label: "webhook-payload-store" },
    );

    // Audit every incoming webhook
    await audit("webhook_received", {
      userId:    session.userId,
      sessionId: session_id,
      eventData: { event, status: session.status },
      ip,
    });

    if (event === "kyc.completed") {
      // Idempotency guard
      if (session.status === "kyc_completed") {
        req.log.info({ sessionId: session_id }, "KYC webhook kyc.completed already processed — skipping");
        return;
      }

      // Server-to-server confirmation: ask VoBiz whether the session is
      // actually completed before writing to the DB.  This is the second line
      // of defence — even a caller who somehow learned the webhook URL token
      // cannot mark an incomplete session as done.
      const confirmedStatus = await fetchVobizSessionStatus(session_id);
      if (confirmedStatus !== "kyc_completed") {
        req.log.warn(
          { sessionId: session_id, confirmedStatus },
          "KYC webhook kyc.completed rejected: VoBiz API reports session is not completed",
        );
        await audit("webhook_rejected", {
          userId:    session.userId,
          sessionId: session_id,
          eventData: { event, confirmedStatus },
          ip,
        });
        return;
      }

      const extracted = body.verified_data ? extractVerifiedFields(body.verified_data) : null;

      await withRetry(
        () => db
          .update(vobizKycSessionsTable)
          .set({ status: "kyc_completed", completedAt: new Date() })
          .where(eq(vobizKycSessionsTable.vobizSessionId, session_id)),
        { label: "webhook-session-complete" },
      );

      await withRetry(
        () => db
          .update(vobizAccountsTable)
          .set({
            kycStatus:     "completed",
            verifiedData:  body.verified_data ?? null,
            extractedData: extracted,
          })
          .where(eq(vobizAccountsTable.userId, session.userId)),
        { label: "webhook-account-complete" },
      );

      await audit("status_changed", {
        userId:    session.userId,
        sessionId: session_id,
        eventData: { from: session.status, to: "kyc_completed", extracted },
        ip,
      });

      req.log.info({ sessionId: session_id, userId: session.userId, extracted }, "KYC completed via webhook");

    } else if (event === "kyc.failed") {
      if (session.status === "revoked" || session.status === "kyc_completed") return;

      await withRetry(
        () => db
          .update(vobizKycSessionsTable)
          .set({ status: "revoked" })
          .where(eq(vobizKycSessionsTable.vobizSessionId, session_id)),
        { label: "webhook-session-fail" },
      );

      await withRetry(
        () => db
          .update(vobizAccountsTable)
          .set({ kycStatus: "failed" })
          .where(eq(vobizAccountsTable.userId, session.userId)),
        { label: "webhook-account-fail" },
      );

      await audit("status_changed", {
        userId:    session.userId,
        sessionId: session_id,
        eventData: { from: session.status, to: "failed" },
        ip,
      });

      req.log.info({ sessionId: session_id, userId: session.userId }, "KYC failed via webhook");

    } else if (event === "kyc.session_revoked") {
      if (session.status === "revoked" || session.status === "kyc_completed") return;

      await withRetry(
        () => db
          .update(vobizKycSessionsTable)
          .set({ status: "revoked" })
          .where(eq(vobizKycSessionsTable.vobizSessionId, session_id)),
        { label: "webhook-session-revoke" },
      );

      await audit("status_changed", {
        userId:    session.userId,
        sessionId: session_id,
        eventData: { from: session.status, to: "revoked" },
        ip,
      });

      req.log.info({ sessionId: session_id }, "KYC session revoked via webhook");

    } else {
      req.log.warn({ sessionId: session_id, event }, "KYC webhook unknown event type");
    }
  } catch (err) {
    req.log.error({ err, session_id, event }, "Error processing KYC webhook");
  }
});

export default router;
