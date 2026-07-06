import { Router, type Request } from "express";
import {
  db,
  usersTable,
  walletTransactionsTable,
  agentsTable,
  providersTable,
  callsTable,
  adminAuditLogsTable,
  adminImpersonationSessionsTable,
} from "@workspace/db";
import { eq, desc, and, sql, gt, isNull } from "drizzle-orm";
import { invalidateImpersonationCache, invalidateImpersonationSessionTokenCache } from "../middlewares/detectImpersonation.js";
import { invalidateUserStatusCache } from "../middlewares/userStatusCache.js";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { createSessionToken } from "../lib/session.js";
import { logger } from "../lib/logger.js";
import { randomBytes } from "node:crypto";

const router = Router();

// ─── Exchange Codes (public, no admin auth) ────────────────────────────────────
// Short-lived opaque codes (60 s TTL, single-use) stored in the DB alongside the
// impersonation session row. The actual user JWT never appears in any URL.

router.get("/impersonate/exchange", async (req, res): Promise<void> => {
  const code = req.query["code"] as string | undefined;
  if (!code) { res.status(400).json({ error: "code is required" }); return; }

  try {
    const now = new Date();
    // Atomic single-statement: match code + validity constraints, clear it, return row.
    // If 0 rows returned: code was already used, expired, or session ended.
    const [redeemed] = await db
      .update(adminImpersonationSessionsTable)
      .set({ exchangeCode: null, exchangeCodeExpiresAt: null })
      .where(
        and(
          eq(adminImpersonationSessionsTable.exchangeCode, code),
          gt(adminImpersonationSessionsTable.exchangeCodeExpiresAt, now),
          isNull(adminImpersonationSessionsTable.endedAt),
          gt(adminImpersonationSessionsTable.expiresAt, now),
        ),
      )
      .returning();

    if (!redeemed) {
      res.status(404).json({ error: "Invalid or expired exchange code" }); return;
    }

    const sessionJwt = createSessionToken(
      {
        sub: redeemed.targetUserId,
        email: redeemed.targetUserEmail ?? null,
        name: redeemed.targetUserName ?? null,
        imp: redeemed.sessionToken,
      },
      2 * 60 * 60,
    );

    res.json({ sessionJwt });
  } catch (err) {
    req.log.error({ err, errMessage: String(err) }, "impersonate/exchange failed");
    res.status(500).json({
      error: "Internal server error",
      detail: process.env["NODE_ENV"] !== "production" ? String(err) : undefined,
    });
  }
});

router.use("/admin", requireAdmin);

// ─── Audit Log Helper ─────────────────────────────────────────────────────────

async function logAdminAction(
  req: Request,
  opts: {
    targetUserId?: string | null;
    targetResourceType?: string;
    targetResourceId?: string;
    action: string;
    beforeValue?: unknown;
    afterValue?: unknown;
  },
) {
  try {
    await db.insert(adminAuditLogsTable).values({
      adminId: "admin",
      targetUserId: opts.targetUserId ?? null,
      targetResourceType: opts.targetResourceType ?? null,
      targetResourceId: opts.targetResourceId ?? null,
      action: opts.action,
      beforeValue: opts.beforeValue !== undefined ? (opts.beforeValue as any) : null,
      afterValue: opts.afterValue !== undefined ? (opts.afterValue as any) : null,
      ipAddress: ((req.headers["x-forwarded-for"] as string) ?? req.ip ?? null),
      userAgent: req.headers["user-agent"] ?? null,
    });
  } catch (err) {
    logger.error({ err }, "Failed to write admin audit log");
  }
}

async function findUserByClerkId(clerkId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return user;
}

// ─── User Status: Suspend / Reactivate / Delete ───────────────────────────────

router.patch("/admin/users/:clerkId/status", async (req, res): Promise<void> => {
  try {
    const { clerkId } = req.params;
    const { status, reason } = req.body as { status: string; reason?: string };

    if (!["active", "suspended", "deleted"].includes(status)) {
      res.status(400).json({ error: "status must be active, suspended, or deleted" });
      return;
    }

    const user = await findUserByClerkId(clerkId!);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const before = { status: user.status, suspendedReason: user.suspendedReason };

    const [updated] = await db
      .update(usersTable)
      .set({
        status,
        suspendedAt: status === "suspended" ? new Date() : null,
        suspendedReason: status === "suspended" ? (reason ?? null) : null,
      })
      .where(eq(usersTable.clerkId, clerkId!))
      .returning({ status: usersTable.status });

    await logAdminAction(req, {
      targetUserId: clerkId,
      targetResourceType: "user",
      targetResourceId: clerkId,
      action: `set_status_${status}`,
      beforeValue: before,
      afterValue: { status, reason },
    });

    // Evict the cached status immediately so an already-issued session token
    // (30-day TTL, self-contained JWT) stops being honored on the very next
    // request instead of waiting out attachSession's cache TTL.
    invalidateUserStatusCache(clerkId!);

    res.json({ status: updated?.status });
  } catch (err) {
    req.log.error({ err }, "admin/users/:clerkId/status failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── User Profile Edit ────────────────────────────────────────────────────────

router.patch("/admin/users/:clerkId/profile", async (req, res): Promise<void> => {
  try {
    const { clerkId } = req.params;
    const { email, name, concurrentLimit } = req.body as {
      email?: string;
      name?: string;
      concurrentLimit?: number;
    };

    const user = await findUserByClerkId(clerkId!);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const before = { email: user.email, name: user.name, concurrentLimit: user.concurrentLimit };
    const patch: Partial<typeof usersTable.$inferInsert> = {};
    if (email !== undefined) patch.email = email;
    if (name !== undefined) patch.name = name;
    if (concurrentLimit !== undefined) patch.concurrentLimit = concurrentLimit;

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const [updated] = await db
      .update(usersTable)
      .set(patch)
      .where(eq(usersTable.clerkId, clerkId!))
      .returning({ email: usersTable.email, name: usersTable.name, concurrentLimit: usersTable.concurrentLimit });

    await logAdminAction(req, {
      targetUserId: clerkId,
      targetResourceType: "user",
      targetResourceId: clerkId,
      action: "edit_profile",
      beforeValue: before,
      afterValue: patch,
    });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "admin/users/:clerkId/profile failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── User Sub-resources: Providers ───────────────────────────────────────────

router.get("/admin/users/:clerkId/providers", async (req, res): Promise<void> => {
  try {
    const { clerkId } = req.params;
    const rows = await db
      .select()
      .from(providersTable)
      .where(eq(providersTable.userId, clerkId!))
      .orderBy(desc(providersTable.createdAt));

    const masked = rows.map((p) => ({
      ...p,
      apiKey: undefined,
      apiKeyHint: p.apiKey ? `****${p.apiKey.slice(-4)}` : "****",
    }));

    res.json(masked);
  } catch (err) {
    req.log.error({ err }, "admin/users/:clerkId/providers failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── User Sub-resources: Calls ────────────────────────────────────────────────

router.get("/admin/users/:clerkId/calls", async (req, res): Promise<void> => {
  try {
    const { clerkId } = req.params;
    const page = Math.max(1, parseInt(String(req.query["page"] ?? "1"), 10));
    const limit = Math.min(100, parseInt(String(req.query["limit"] ?? "50"), 10));
    const offset = (page - 1) * limit;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(callsTable)
        .where(eq(callsTable.userId, clerkId!))
        .orderBy(desc(callsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: sql<number>`count(*)::int` }).from(callsTable).where(eq(callsTable.userId, clerkId!)),
    ]);

    res.json({ data: rows, total, page, pageSize: limit });
  } catch (err) {
    req.log.error({ err }, "admin/users/:clerkId/calls failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── User Sub-resources: Agents (read) ───────────────────────────────────────

router.get("/admin/users/:clerkId/agents", async (req, res): Promise<void> => {
  try {
    const { clerkId } = req.params;
    const rows = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.userId, clerkId!))
      .orderBy(desc(agentsTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "admin/users/:clerkId/agents failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Agent CRUD as Admin ──────────────────────────────────────────────────────

router.post("/admin/users/:clerkId/agents", async (req, res): Promise<void> => {
  try {
    const { clerkId } = req.params;
    const user = await findUserByClerkId(clerkId!);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const body = req.body as Record<string, unknown>;
    const [agent] = await db
      .insert(agentsTable)
      .values({ ...body, userId: clerkId } as any)
      .returning();

    await logAdminAction(req, {
      targetUserId: clerkId,
      targetResourceType: "agent",
      targetResourceId: String(agent?.id),
      action: "create_agent",
      afterValue: { agentId: agent?.id, name: body["name"] },
    });

    res.status(201).json(agent);
  } catch (err) {
    req.log.error({ err }, "admin POST agent failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/agents/:agentId", async (req, res): Promise<void> => {
  try {
    const agentId = parseInt(req.params["agentId"]!, 10);
    if (isNaN(agentId)) { res.status(400).json({ error: "Invalid agentId" }); return; }

    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

    res.json(agent);
  } catch (err) {
    req.log.error({ err }, "admin GET agent failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/agents/:agentId", async (req, res): Promise<void> => {
  try {
    const agentId = parseInt(req.params["agentId"]!, 10);
    if (isNaN(agentId)) { res.status(400).json({ error: "Invalid agentId" }); return; }

    const [existing] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    if (!existing) { res.status(404).json({ error: "Agent not found" }); return; }

    const body = req.body as Record<string, unknown>;
    const [updated] = await db
      .update(agentsTable)
      .set(body as any)
      .where(eq(agentsTable.id, agentId))
      .returning();

    await logAdminAction(req, {
      targetUserId: existing.userId,
      targetResourceType: "agent",
      targetResourceId: String(agentId),
      action: "edit_agent",
      beforeValue: { name: existing.name, status: existing.status },
      afterValue: body,
    });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "admin PATCH agent failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/agents/:agentId", async (req, res): Promise<void> => {
  try {
    const agentId = parseInt(req.params["agentId"]!, 10);
    if (isNaN(agentId)) { res.status(400).json({ error: "Invalid agentId" }); return; }

    const [existing] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    if (!existing) { res.status(404).json({ error: "Agent not found" }); return; }

    await db.delete(agentsTable).where(eq(agentsTable.id, agentId));

    await logAdminAction(req, {
      targetUserId: existing.userId,
      targetResourceType: "agent",
      targetResourceId: String(agentId),
      action: "delete_agent",
      beforeValue: { name: existing.name },
    });

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "admin DELETE agent failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Wallet: Credit / Debit / Refund / History ───────────────────────────────

router.post("/admin/users/:clerkId/wallet/credit", async (req, res): Promise<void> => {
  try {
    const { clerkId } = req.params;
    const { amountCents, description } = req.body as { amountCents: number; description?: string };
    if (typeof amountCents !== "number" || amountCents <= 0) {
      res.status(400).json({ error: "amountCents must be a positive number" });
      return;
    }

    const user = await findUserByClerkId(clerkId!);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const before = { walletBalanceCents: user.walletBalanceCents };
    const [updated] = await db
      .update(usersTable)
      .set({ walletBalanceCents: user.walletBalanceCents + amountCents })
      .where(eq(usersTable.clerkId, clerkId!))
      .returning({ walletBalanceCents: usersTable.walletBalanceCents });

    await db.insert(walletTransactionsTable).values({
      userId: user.id,
      type: "admin_credit",
      amountCents,
      description: description ?? "Admin credit",
      status: "completed",
    });

    await logAdminAction(req, {
      targetUserId: clerkId,
      targetResourceType: "wallet",
      action: "credit_wallet",
      beforeValue: before,
      afterValue: { walletBalanceCents: updated?.walletBalanceCents, amountCents },
    });

    res.json({ newBalanceCents: updated?.walletBalanceCents });
  } catch (err) {
    req.log.error({ err }, "admin wallet credit failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/users/:clerkId/wallet/debit", async (req, res): Promise<void> => {
  try {
    const { clerkId } = req.params;
    const { amountCents, description } = req.body as { amountCents: number; description?: string };
    if (typeof amountCents !== "number" || amountCents <= 0) {
      res.status(400).json({ error: "amountCents must be a positive number" });
      return;
    }

    const user = await findUserByClerkId(clerkId!);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const before = { walletBalanceCents: user.walletBalanceCents };
    const [updated] = await db
      .update(usersTable)
      .set({ walletBalanceCents: user.walletBalanceCents - amountCents })
      .where(eq(usersTable.clerkId, clerkId!))
      .returning({ walletBalanceCents: usersTable.walletBalanceCents });

    await db.insert(walletTransactionsTable).values({
      userId: user.id,
      type: "admin_debit",
      amountCents: -amountCents,
      description: description ?? "Admin debit",
      status: "completed",
    });

    await logAdminAction(req, {
      targetUserId: clerkId,
      targetResourceType: "wallet",
      action: "debit_wallet",
      beforeValue: before,
      afterValue: { walletBalanceCents: updated?.walletBalanceCents, amountCents },
    });

    res.json({ newBalanceCents: updated?.walletBalanceCents });
  } catch (err) {
    req.log.error({ err }, "admin wallet debit failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/users/:clerkId/wallet/refund", async (req, res): Promise<void> => {
  try {
    const { clerkId } = req.params;
    const { amountCents, description, callId } = req.body as {
      amountCents: number;
      description?: string;
      callId?: number;
    };
    if (typeof amountCents !== "number" || amountCents <= 0) {
      res.status(400).json({ error: "amountCents must be a positive number" });
      return;
    }

    const user = await findUserByClerkId(clerkId!);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const before = { walletBalanceCents: user.walletBalanceCents };
    const [updated] = await db
      .update(usersTable)
      .set({ walletBalanceCents: user.walletBalanceCents + amountCents })
      .where(eq(usersTable.clerkId, clerkId!))
      .returning({ walletBalanceCents: usersTable.walletBalanceCents });

    await db.insert(walletTransactionsTable).values({
      userId: user.id,
      type: "refund",
      amountCents,
      description: description ?? "Admin refund",
      status: "completed",
      callId: callId ?? null,
    });

    await logAdminAction(req, {
      targetUserId: clerkId,
      targetResourceType: "wallet",
      action: "refund_wallet",
      beforeValue: before,
      afterValue: { walletBalanceCents: updated?.walletBalanceCents, amountCents, callId },
    });

    res.json({ newBalanceCents: updated?.walletBalanceCents });
  } catch (err) {
    req.log.error({ err }, "admin wallet refund failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/users/:clerkId/wallet/transactions", async (req, res): Promise<void> => {
  try {
    const { clerkId } = req.params;
    const user = await findUserByClerkId(clerkId!);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const page = Math.max(1, parseInt(String(req.query["page"] ?? "1"), 10));
    const limit = Math.min(200, parseInt(String(req.query["limit"] ?? "100"), 10));
    const offset = (page - 1) * limit;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(walletTransactionsTable)
        .where(eq(walletTransactionsTable.userId, user.id))
        .orderBy(desc(walletTransactionsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(walletTransactionsTable)
        .where(eq(walletTransactionsTable.userId, user.id)),
    ]);

    res.json({ data: rows, total, page, pageSize: limit });
  } catch (err) {
    req.log.error({ err }, "admin wallet transactions failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Impersonation ────────────────────────────────────────────────────────────

router.post("/admin/impersonate/:clerkId", async (req, res): Promise<void> => {
  try {
    const { clerkId } = req.params;
    req.log.info({ clerkId }, "admin impersonate: request received");

    const user = await findUserByClerkId(clerkId!);
    req.log.info({ clerkId, userFound: !!user, userStatus: user?.status ?? null }, "admin impersonate: user lookup complete");

    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    if (user.status === "deleted") {
      res.status(400).json({ error: "Cannot impersonate a deleted user" });
      return;
    }

    const sessionToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours

    // Generate exchange code upfront and include it in the initial INSERT.
    // Requires migration 0012_impersonation_exchange_code to be applied
    // (adds exchange_code + exchange_code_expires_at columns to admin_impersonation_sessions).
    const exchangeCode = randomBytes(24).toString("hex");
    const exchangeCodeExpiresAt = new Date(Date.now() + 60_000); // 60 s TTL

    await db.insert(adminImpersonationSessionsTable).values({
      sessionToken,
      adminId: "admin",
      targetUserId: clerkId!,
      targetUserEmail: user.email,
      targetUserName: user.name,
      expiresAt,
      exchangeCode,
      exchangeCodeExpiresAt,
    });
    req.log.info({ clerkId, sessionTokenPrefix: sessionToken.slice(0, 8) }, "admin impersonate: session row inserted");

    await logAdminAction(req, {
      targetUserId: clerkId,
      targetResourceType: "user",
      targetResourceId: clerkId,
      action: "start_impersonation",
      afterValue: { sessionToken: sessionToken.slice(0, 8) + "...", expiresAt },
    });

    res.json({
      sessionToken,
      exchangeCode,
      userName: user.name,
      userEmail: user.email,
    });
    req.log.info({ clerkId }, "admin impersonate: response sent");
  } catch (err) {
    req.log.error({ err, errMessage: String(err) }, "admin impersonate failed");
    res.status(500).json({
      error: "Internal server error",
      detail: process.env["NODE_ENV"] !== "production" ? String(err) : undefined,
    });
  }
});

router.delete("/admin/impersonate/sessions/:sessionToken", async (req, res): Promise<void> => {
  try {
    const { sessionToken } = req.params;
    const [session] = await db
      .select()
      .from(adminImpersonationSessionsTable)
      .where(eq(adminImpersonationSessionsTable.sessionToken, sessionToken!));

    if (!session) { res.status(404).json({ error: "Session not found" }); return; }

    await db
      .update(adminImpersonationSessionsTable)
      .set({ endedAt: new Date() })
      .where(eq(adminImpersonationSessionsTable.sessionToken, sessionToken!));

    await logAdminAction(req, {
      targetUserId: session.targetUserId,
      targetResourceType: "user",
      action: "end_impersonation",
      beforeValue: { sessionToken: sessionToken!.slice(0, 8) + "..." },
    });

    // Invalidate both in-process caches so subsequent requests are rejected
    // immediately without waiting for the 5-second TTL to expire.
    invalidateImpersonationCache(session.targetUserId);
    invalidateImpersonationSessionTokenCache(sessionToken!);

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "admin end impersonation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/impersonate/sessions", async (req, res): Promise<void> => {
  try {
    const sessions = await db
      .select()
      .from(adminImpersonationSessionsTable)
      .where(
        and(
          isNull(adminImpersonationSessionsTable.endedAt),
          gt(adminImpersonationSessionsTable.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(adminImpersonationSessionsTable.createdAt));

    const masked = sessions.map((s) => ({ ...s, sessionToken: s.sessionToken.slice(0, 8) + "..." }));
    res.json(masked);
  } catch (err) {
    req.log.error({ err }, "admin list impersonation sessions failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Audit Logs ───────────────────────────────────────────────────────────────

router.get("/admin/audit-logs", async (req, res): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(String(req.query["page"] ?? "1"), 10));
    const limit = Math.min(200, parseInt(String(req.query["limit"] ?? "50"), 10));
    const offset = (page - 1) * limit;
    const userId = req.query["userId"] as string | undefined;
    const action = req.query["action"] as string | undefined;

    const conditions = [];
    if (userId) conditions.push(eq(adminAuditLogsTable.targetUserId, userId));
    if (action) conditions.push(eq(adminAuditLogsTable.action, action));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(adminAuditLogsTable)
        .where(where)
        .orderBy(desc(adminAuditLogsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: sql<number>`count(*)::int` }).from(adminAuditLogsTable).where(where),
    ]);

    res.json({ data: rows, total, page, pageSize: limit });
  } catch (err) {
    req.log.error({ err }, "admin audit-logs failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
