/**
 * Call Transfers — supervisor view + management
 * The actual transfer is triggered via POST /calls/:id/transfer in calls.ts;
 * this router provides the supervisor dashboard and logging endpoints.
 */
import { Router, type IRouter } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import { db, callTransfersTable, callsTable, agentsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext } from "../middlewares/clientContext.js";
import { resolveWorkspaceScope } from "../services/workspace-scope.js";
import { reconcileTransfersForWorkspace } from "../services/campaign-tab-sync.js";

const router: IRouter = Router();

/* ── GET /transfers ─────────────────────────────────────────────────────── */

router.get("/transfers", requireAuth, clientContext, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const scope = await resolveWorkspaceScope(userId);

  // Backfill campaign lead_transfers into call_transfers so History matches
  // the campaign Transfers tab (which already reconciles on every list).
  await reconcileTransfersForWorkspace(scope.userIds).catch(() => {});

  const rows = await db
    .select({
      id:                 callTransfersTable.id,
      callId:             callTransfersTable.callId,
      transferTo:         callTransfersTable.transferTo,
      transferName:       callTransfersTable.transferName,
      summary:            callTransfersTable.summary,
      status:             callTransfersTable.status,
      providerTransferId: callTransfersTable.providerTransferId,
      initiatedAt:        callTransfersTable.initiatedAt,
      connectedAt:        callTransfersTable.connectedAt,
      completedAt:        callTransfersTable.completedAt,
      agentName:          agentsTable.name,
    })
    .from(callTransfersTable)
    .leftJoin(callsTable, eq(callTransfersTable.callId, callsTable.id))
    .leftJoin(agentsTable, eq(callsTable.agentId, agentsTable.id))
    .where(inArray(callTransfersTable.userId, scope.userIds))
    .orderBy(desc(callTransfersTable.initiatedAt))
    .limit(100);

  res.json({ transfers: rows });
});

/* ── GET /transfers/:id ──────────────────────────────────────────────────── */

router.get("/transfers/:id", requireAuth, clientContext, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const scope = await resolveWorkspaceScope(userId);
  const id     = Number(req.params["id"]);

  const [row] = await db
    .select()
    .from(callTransfersTable)
    .where(and(eq(callTransfersTable.id, id), inArray(callTransfersTable.userId, scope.userIds)));

  if (!row) { res.status(404).json({ error: "Transfer not found" }); return; }
  res.json(row);
});

/* ── PATCH /transfers/:id ────────────────────────────────────────────────── */
// Supervisor can mark a transfer as connected or completed

router.patch("/transfers/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const scope = await resolveWorkspaceScope(userId);
  if (!scope.canWrite) {
    res.status(403).json({ error: "Your team role cannot edit transfers" });
    return;
  }
  const id     = Number(req.params["id"]);
  const { status, connectedAt, completedAt } = req.body as {
    status?: string;
    connectedAt?: string;
    completedAt?: string;
  };

  const updates: Partial<typeof callTransfersTable.$inferInsert> = {};
  if (status)      updates.status      = status;
  if (connectedAt) updates.connectedAt = new Date(connectedAt);
  if (completedAt) updates.completedAt = new Date(completedAt);

  const [row] = await db
    .update(callTransfersTable)
    .set(updates)
    .where(and(eq(callTransfersTable.id, id), inArray(callTransfersTable.userId, scope.userIds)))
    .returning();

  if (!row) { res.status(404).json({ error: "Transfer not found" }); return; }
  res.json(row);
});

export default router;
