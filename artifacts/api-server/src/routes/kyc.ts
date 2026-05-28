import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { db, usersTable, vobizAccountsTable, vobizKycSessionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { encryptKey } from "../lib/crypto.js";
import { GetKycStatusResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const VOBIZ_PARTNER_BASE = "https://api.vobiz.ai/api/v1/partner";

function partnerHeaders() {
  return {
    "X-Auth-ID":    process.env["VOBIZ_AUTH_ID"]    ?? "",
    "X-Auth-Token": process.env["VOBIZ_AUTH_TOKEN"]  ?? "",
    "Accept":       "application/json",
    "Content-Type": "application/json",
  };
}

function platformConfigured(): boolean {
  return !!(process.env["VOBIZ_AUTH_ID"] && process.env["VOBIZ_AUTH_TOKEN"]);
}

/** Derive the public base URL from env — used for redirect_url and webhook_url. */
function publicBaseUrl(): string {
  const domains = process.env["REPLIT_DOMAINS"];
  if (domains) {
    const first = domains.split(",")[0]?.trim();
    if (first) return `https://${first}`;
  }
  return "https://localhost";
}

// ── Create Vobiz sub-account for a SnapServe user ─────────────────────────

interface VobizCreateAccountResponse {
  auth_id:    string;
  auth_token: string;
  name:       string;
  email:      string;
  status:     string;
}

async function createVobizSubAccount(
  name: string,
  email: string
): Promise<VobizCreateAccountResponse> {
  // Generate a secure random password — users never log in to Vobiz directly.
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

// ── Create a redirect-flow KYC session on Vobiz ───────────────────────────

interface VobizKycSessionResponse {
  session_id: string;
  status:     string;
  widget_url: string | null;
}

async function createVobizKycSession(
  accountAuthId: string,
  redirectUrl:   string,
  webhookUrl:    string
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

// ── GET /kyc/status ───────────────────────────────────────────────────────

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
    sessionStatus: session?.status ?? null,
    widgetUrl:     session?.status === "kyc_completed" || session?.status === "revoked"
                     ? null
                     : (session?.widgetUrl ?? null),
    completedAt:   account.updatedAt?.toISOString() ?? null,
  }));
});

// ── POST /kyc/start ───────────────────────────────────────────────────────

router.post("/kyc/start", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;

  if (!platformConfigured()) {
    res.status(503).json({ error: "Platform carrier credentials not configured.", code: "PLATFORM_NOT_CONFIGURED" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  // 1. Get or create the user's Vobiz sub-account
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
  }

  // If already completed, return immediately
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

  // 2. Create redirect-flow KYC session (auto-revokes any previous active session on Vobiz)
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

  // 3. Persist the new session (mark any previous as superseded — Vobiz auto-revokes them)
  await db.insert(vobizKycSessionsTable).values({
    userId:             clerkId,
    vobizSessionId:     kycSession.session_id,
    vobizAccountAuthId: account.vobizAuthId,
    flowType:           "redirect",
    status:             kycSession.status,
    widgetUrl:          kycSession.widget_url ?? null,
    redirectUrl,
  });

  req.log.info({ clerkId, sessionId: kycSession.session_id }, "KYC session started");
  res.status(201).json({
    sessionId: kycSession.session_id,
    status:    kycSession.status,
    widgetUrl: kycSession.widget_url ?? null,
  });
});

// ── GET /kyc/callback ─────────────────────────────────────────────────────
// Vobiz redirects the user's browser here after they complete (or abandon) the
// KYC widget. No Clerk session — the session_id ties back to our DB.

router.get("/kyc/callback", async (req, res): Promise<void> => {
  const { session_id, status, auth_id } = req.query as Record<string, string>;
  const logger = req.log;

  if (!session_id) {
    res.redirect("/?kyc=error");
    return;
  }

  try {
    const [session] = await db
      .select()
      .from(vobizKycSessionsTable)
      .where(eq(vobizKycSessionsTable.vobizSessionId, session_id));

    if (session) {
      const newStatus = status ?? session.status;
      await db
        .update(vobizKycSessionsTable)
        .set({
          status:      newStatus,
          completedAt: newStatus === "kyc_completed" ? new Date() : undefined,
        })
        .where(eq(vobizKycSessionsTable.vobizSessionId, session_id));

      if (newStatus === "kyc_completed") {
        await db
          .update(vobizAccountsTable)
          .set({ kycStatus: "completed" })
          .where(eq(vobizAccountsTable.userId, session.userId));
        logger.info({ sessionId: session_id, userId: session.userId }, "KYC completed via redirect callback");
      }
    }
  } catch (err) {
    logger.error({ err, session_id }, "Error processing KYC callback");
  }

  const outcome = status === "kyc_completed" ? "completed" : (status ?? "pending");
  res.redirect(`/app/kyc?kyc=${outcome}`);
});

// ── POST /kyc/webhook ─────────────────────────────────────────────────────
// Vobiz fires this for kyc.completed / kyc.failed / kyc.session_revoked.
// Respond 200 immediately; update DB.

router.post("/kyc/webhook", async (req, res): Promise<void> => {
  // Respond immediately — VoBiz expects a fast 200 acknowledgement.
  res.sendStatus(200);

  const body = req.body as {
    event?:         string;
    session_id?:    string;
    auth_id?:       string;
    verified_data?: Record<string, unknown>;
  };

  const { event, session_id } = body;
  if (!event || !session_id) return;

  try {
    const [session] = await db
      .select()
      .from(vobizKycSessionsTable)
      .where(eq(vobizKycSessionsTable.vobizSessionId, session_id));

    if (!session) {
      req.log.warn({ session_id, event }, "KYC webhook for unknown session — ignored");
      return;
    }

    if (event === "kyc.completed") {
      // Idempotency guard: skip if already marked completed
      if (session.status === "kyc_completed") {
        req.log.info({ sessionId: session_id }, "KYC webhook kyc.completed already processed — skipping");
        return;
      }

      await db
        .update(vobizKycSessionsTable)
        .set({ status: "kyc_completed", completedAt: new Date() })
        .where(eq(vobizKycSessionsTable.vobizSessionId, session_id));

      await db
        .update(vobizAccountsTable)
        .set({
          kycStatus:    "completed",
          verifiedData: body.verified_data ?? null,
        })
        .where(eq(vobizAccountsTable.userId, session.userId));

      req.log.info({ sessionId: session_id, userId: session.userId }, "KYC completed via webhook");

    } else if (event === "kyc.failed") {
      // Idempotency guard: only update if not already terminal
      if (session.status === "revoked" || session.status === "kyc_completed") return;

      await db
        .update(vobizKycSessionsTable)
        .set({ status: "revoked" })
        .where(eq(vobizKycSessionsTable.vobizSessionId, session_id));

      await db
        .update(vobizAccountsTable)
        .set({ kycStatus: "failed" })
        .where(eq(vobizAccountsTable.userId, session.userId));

      req.log.info({ sessionId: session_id, userId: session.userId }, "KYC failed via webhook");

    } else if (event === "kyc.session_revoked") {
      if (session.status === "revoked" || session.status === "kyc_completed") return;

      await db
        .update(vobizKycSessionsTable)
        .set({ status: "revoked" })
        .where(eq(vobizKycSessionsTable.vobizSessionId, session_id));

      req.log.info({ sessionId: session_id }, "KYC session revoked via webhook");

    } else {
      req.log.warn({ sessionId: session_id, event }, "KYC webhook unknown event");
    }
  } catch (err) {
    req.log.error({ err, session_id, event }, "Error processing KYC webhook");
  }
});

export default router;
