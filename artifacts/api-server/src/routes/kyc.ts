import { Router, type IRouter, type Request } from "express";
import { randomBytes } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import {
  db,
  usersTable,
  vobizAccountsTable,
  vobizKycSessionsTable,
  kycAuditLogsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { encryptKey } from "../lib/crypto.js";
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

function publicBaseUrl(): string {
  const domains = process.env["REPLIT_DOMAINS"];
  if (domains) {
    const first = domains.split(",")[0]?.trim();
    if (first) return `https://${first}`;
  }
  return "https://localhost";
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

interface VobizCreateAccountResponse {
  auth_id:    string;
  auth_token: string;
  name:       string;
  email:      string;
  status:     string;
}

async function createVobizSubAccount(
  name: string,
  email: string,
): Promise<VobizCreateAccountResponse> {
  const password = randomBytes(16).toString("hex") + "A1!";
  const resp = await fetch(`${VOBIZ_PARTNER_BASE}/accounts`, {
    method:  "POST",
    headers: partnerHeaders(),
    body:    JSON.stringify({ name: name || email, email, password, country: "IN" }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Vobiz sub-account creation failed (${resp.status}): ${err}`);
  }
  return resp.json() as Promise<VobizCreateAccountResponse>;
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
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Vobiz KYC session creation failed (${resp.status}): ${err}`);
  }
  return resp.json() as Promise<VobizKycSessionResponse>;
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

  res.json(GetKycStatusResponse.parse({
    kycStatus:     account.kycStatus,
    sessionId:     session?.vobizSessionId ?? null,
    sessionStatus: session?.status         ?? null,
    widgetUrl:     session?.status === "kyc_completed" || session?.status === "revoked"
                     ? null
                     : (session?.widgetUrl ?? null),
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

  // 1. Get or create VoBiz sub-account
  let [account] = await db
    .select()
    .from(vobizAccountsTable)
    .where(eq(vobizAccountsTable.userId, clerkId));

  if (!account) {
    let vobizAccount: VobizCreateAccountResponse;
    try {
      vobizAccount = await createVobizSubAccount(user.name ?? user.email ?? clerkId, user.email ?? `${clerkId}@snapserve.ai`);
    } catch (err: any) {
      req.log.error({ err, clerkId }, "Failed to create Vobiz sub-account");
      res.status(502).json({ error: "Failed to provision verification account. Please try again." });
      return;
    }

    [account] = await db
      .insert(vobizAccountsTable)
      .values({
        userId:                  clerkId,
        vobizAuthId:             vobizAccount.auth_id,
        vobizAuthTokenEncrypted: encryptKey(vobizAccount.auth_token),
        kycStatus:               "pending",
      })
      .returning();

    await audit("account_provisioned", {
      userId:    clerkId,
      eventData: { vobizAuthId: vobizAccount.auth_id },
      ip,
    });
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
  const base        = publicBaseUrl();
  const redirectUrl = `${base}/api/kyc/callback`;
  const webhookUrl  = `${base}/api/kyc/webhook`;

  let kycSession: VobizKycSessionResponse;
  try {
    kycSession = await createVobizKycSession(account.vobizAuthId, redirectUrl, webhookUrl);
  } catch (err: any) {
    req.log.error({ err, clerkId }, "Failed to create Vobiz KYC session");
    res.status(502).json({ error: "Failed to start KYC session. Please try again." });
    return;
  }

  // 3. Persist session
  await db.insert(vobizKycSessionsTable).values({
    userId:             clerkId,
    vobizSessionId:     kycSession.session_id,
    vobizAccountAuthId: account.vobizAuthId,
    flowType:           "redirect",
    status:             kycSession.status,
    widgetUrl:          kycSession.widget_url ?? null,
    redirectUrl,
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

router.get("/kyc/callback", async (req, res): Promise<void> => {
  const { session_id, status } = req.query as Record<string, string>;
  const ip = clientIp(req);

  if (!session_id) { res.redirect("/?kyc=error"); return; }

  try {
    const [session] = await db
      .select()
      .from(vobizKycSessionsTable)
      .where(eq(vobizKycSessionsTable.vobizSessionId, session_id));

    if (session) {
      const newStatus = status ?? session.status;

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
        req.log.info({ sessionId: session_id, userId: session.userId }, "KYC completed via redirect callback");
      }

      await audit("callback_received", {
        userId:    session.userId,
        sessionId: session_id,
        eventData: { status: newStatus },
        ip,
      });
    }
  } catch (err) {
    req.log.error({ err, session_id }, "Error processing KYC callback");
  }

  const outcome = status === "kyc_completed" ? "completed" : (status ?? "pending");
  res.redirect(`/app/kyc?kyc=${outcome}`);
});

/* ── POST /kyc/webhook ───────────────────────────────────────────────────── */
// VoBiz fires this for kyc.completed / kyc.failed / kyc.session_revoked.
// Respond 200 immediately; update DB with retry + idempotency + audit.

router.post("/kyc/webhook", async (req, res): Promise<void> => {
  res.sendStatus(200); // fast ack

  const body = req.body as {
    event?:         string;
    session_id?:    string;
    auth_id?:       string;
    verified_data?: Record<string, unknown>;
  };

  const { event, session_id } = body;
  if (!event || !session_id) return;

  const ip = clientIp(req);

  try {
    const [session] = await db
      .select()
      .from(vobizKycSessionsTable)
      .where(eq(vobizKycSessionsTable.vobizSessionId, session_id));

    if (!session) {
      req.log.warn({ session_id, event }, "KYC webhook for unknown session — ignored");
      return;
    }

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
