/**
 * Campaign Transfers routes — Phase 3E
 * ─────────────────────────────────────────────────────────────────────────────
 * "Which conversations were handed to a human?"
 * Reads from call_transfers joined through call_executions → campaign.
 * call_transfers has no direct campaign FK — always join via call_executions.
 */

import { Router, type IRouter } from "express";
import { getAuth } from "../lib/auth-compat.js";
import {
  db, campaignsTable, campaignLeadsTable, campaignBatchesTable,
  callTransfersTable, callExecutionsTable, callsTable, agentsTable,
} from "@workspace/db";
import { eq, and, sql, desc, isNotNull } from "drizzle-orm";

const router: IRouter = Router();

async function requireCampaign(campaignId: number, userId: string) {
  const [row] = await db.select({ id: campaignsTable.id })
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.userId, userId)));
  return row ?? null;
}

// ── GET /campaigns/:id/transfers/metrics ──────────────────────────────────────

router.get("/campaigns/:id/transfers/metrics", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  if (isNaN(campaignId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const [m] = await db.select({
    pending:   sql<number>`count(distinct ${callTransfersTable.id}) filter (where ${callTransfersTable.status} in ('initiated', 'connected'))::int`,
    completed: sql<number>`count(distinct ${callTransfersTable.id}) filter (where ${callTransfersTable.status} = 'completed')::int`,
    failed:    sql<number>`count(distinct ${callTransfersTable.id}) filter (where ${callTransfersTable.status} = 'failed')::int`,
    today:     sql<number>`count(distinct ${callTransfersTable.id}) filter (where date(${callTransfersTable.initiatedAt} at time zone 'UTC') = current_date)::int`,
    total:     sql<number>`count(distinct ${callTransfersTable.id})::int`,
  }).from(callTransfersTable)
    .innerJoin(callExecutionsTable,
      and(
        eq(callTransfersTable.callId, callExecutionsTable.callId!),
        eq(callExecutionsTable.campaignId, campaignId),
        isNotNull(callExecutionsTable.callId),
      )!,
    );

  res.json({
    pending:   m?.pending   ?? 0,
    completed: m?.completed ?? 0,
    failed:    m?.failed    ?? 0,
    today:     m?.today     ?? 0,
    total:     m?.total     ?? 0,
  });
});

// ── GET /campaigns/:id/transfers ──────────────────────────────────────────────

router.get("/campaigns/:id/transfers", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  if (isNaN(campaignId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const status = String(req.query["status"] ?? "all");
  const page   = Math.max(0, parseInt(String(req.query["page"] ?? "0"), 10) || 0);
  const limit  = Math.min(100, Math.max(1, parseInt(String(req.query["limit"] ?? "50"), 10) || 50));

  const baseWhere = and(
    eq(callExecutionsTable.campaignId, campaignId),
    isNotNull(callExecutionsTable.callId),
  )!;

  const [countRow] = await db.select({
    count: sql<number>`count(distinct ${callTransfersTable.id})::int`,
  }).from(callTransfersTable)
    .innerJoin(callExecutionsTable,
      and(eq(callTransfersTable.callId, callExecutionsTable.callId!), baseWhere)!,
    )
    .where(
      status === "pending"   ? sql`${callTransfersTable.status} in ('initiated', 'connected')` :
      status === "completed" ? eq(callTransfersTable.status, "completed") :
      status === "failed"    ? eq(callTransfersTable.status, "failed")    :
      status === "cancelled" ? eq(callTransfersTable.status, "cancelled") :
      undefined,
    );
  const total = countRow?.count ?? 0;

  const rows = await db.selectDistinctOn([callTransfersTable.id], {
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
    // from call_executions
    leadId:             callExecutionsTable.leadId,
    batchId:            callExecutionsTable.batchId,
    // from call (duration)
    callDuration:       callsTable.durationSeconds,
    // from leads
    leadName:           campaignLeadsTable.name,
    leadPhone:          campaignLeadsTable.phone,
    // from batches
    batchName:          campaignBatchesTable.name,
    // from agents
    agentName:          agentsTable.name,
  }).from(callTransfersTable)
    .innerJoin(callExecutionsTable,
      and(eq(callTransfersTable.callId, callExecutionsTable.callId!), baseWhere)!,
    )
    .leftJoin(callsTable,          eq(callTransfersTable.callId, callsTable.id))
    .leftJoin(campaignLeadsTable,  eq(callExecutionsTable.leadId, campaignLeadsTable.id))
    .leftJoin(campaignBatchesTable, eq(callExecutionsTable.batchId, campaignBatchesTable.id))
    .leftJoin(agentsTable,         eq(callsTable.agentId, agentsTable.id))
    .where(
      status === "pending"   ? sql`${callTransfersTable.status} in ('initiated', 'connected')` :
      status === "completed" ? eq(callTransfersTable.status, "completed") :
      status === "failed"    ? eq(callTransfersTable.status, "failed")    :
      status === "cancelled" ? eq(callTransfersTable.status, "cancelled") :
      undefined,
    )
    .orderBy(callTransfersTable.id, desc(callTransfersTable.initiatedAt))
    .limit(limit)
    .offset(page * limit);

  const items = rows.map(r => {
    // Duration: prefer connectedAt→completedAt, fallback initiatedAt→completedAt
    let durationSeconds: number | null = null;
    if (r.completedAt) {
      const start = r.connectedAt ?? r.initiatedAt;
      durationSeconds = Math.max(0, Math.round((r.completedAt.getTime() - start.getTime()) / 1000));
    }

    // Outcome label
    const outcome =
      r.status === "completed"  ? "TRANSFER_COMPLETED"  :
      r.status === "failed"     ? "TRANSFER_FAILED"     :
      r.status === "cancelled"  ? "TRANSFER_CANCELLED"  :
      r.status === "connected"  ? "TRANSFER_CONNECTED"  :
      "TRANSFER_PENDING";

    return {
      id:                 r.id,
      callId:             r.callId,
      leadId:             r.leadId ?? null,
      batchId:            r.batchId ?? null,
      transferTo:         r.transferTo,
      transferName:       r.transferName ?? null,
      summary:            r.summary ?? null,
      status:             r.status,
      outcome,
      durationSeconds,
      initiatedAt:        r.initiatedAt.toISOString(),
      connectedAt:        r.connectedAt?.toISOString() ?? null,
      completedAt:        r.completedAt?.toISOString() ?? null,
      lead: {
        name:  r.leadName  ?? null,
        phone: r.leadPhone ?? null,
      },
      batchName:  r.batchName  ?? null,
      agentName:  r.agentName  ?? null,
    };
  });

  res.json({ items, total, page, limit });
});

// ── PATCH /campaigns/:id/transfers/:transferId/status ─────────────────────────

router.patch("/campaigns/:id/transfers/:transferId/status", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId  = parseInt(req.params["id"]!, 10);
  const transferId  = parseInt(req.params["transferId"]!, 10);
  if (isNaN(campaignId) || isNaN(transferId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const { status } = req.body as { status?: string };
  if (!status || !["initiated", "connected", "completed", "failed", "cancelled"].includes(status)) {
    res.status(400).json({ error: "status must be initiated | connected | completed | failed | cancelled" }); return;
  }

  // Verify transfer belongs to this campaign via call_executions
  const [transfer] = await db
    .selectDistinctOn([callTransfersTable.id], { id: callTransfersTable.id })
    .from(callTransfersTable)
    .innerJoin(callExecutionsTable,
      and(
        eq(callTransfersTable.callId, callExecutionsTable.callId!),
        eq(callExecutionsTable.campaignId, campaignId),
        isNotNull(callExecutionsTable.callId),
      )!,
    )
    .where(eq(callTransfersTable.id, transferId));

  if (!transfer) { res.status(404).json({ error: "Not found" }); return; }

  const now = new Date();
  const [updated] = await db.update(callTransfersTable)
    .set({
      status,
      ...(status === "completed" ? { completedAt: now } : {}),
      ...(status === "connected" ? { connectedAt: now } : {}),
    })
    .where(eq(callTransfersTable.id, transferId))
    .returning({ id: callTransfersTable.id });

  res.json({ id: updated?.id, status });
});

// ── POST /campaigns/:id/transfers/:transferId/retry ───────────────────────────

router.post("/campaigns/:id/transfers/:transferId/retry", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId  = parseInt(req.params["id"]!, 10);
  const transferId  = parseInt(req.params["transferId"]!, 10);
  if (isNaN(campaignId) || isNaN(transferId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const [row] = await db
    .selectDistinctOn([callTransfersTable.id], {
      id: callTransfersTable.id, status: callTransfersTable.status,
    })
    .from(callTransfersTable)
    .innerJoin(callExecutionsTable,
      and(
        eq(callTransfersTable.callId, callExecutionsTable.callId!),
        eq(callExecutionsTable.campaignId, campaignId),
        isNotNull(callExecutionsTable.callId),
      )!,
    )
    .where(eq(callTransfersTable.id, transferId));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (!["failed", "cancelled"].includes(row.status)) {
    res.status(400).json({ error: "Can only retry failed or cancelled transfers" }); return;
  }

  const [updated] = await db.update(callTransfersTable)
    .set({ status: "initiated", completedAt: null })
    .where(eq(callTransfersTable.id, transferId))
    .returning({ id: callTransfersTable.id });

  res.json({ id: updated?.id, status: "initiated" });
});

// ── GET /campaigns/:id/transfers/export ───────────────────────────────────────

router.get("/campaigns/:id/transfers/export", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const campaignId = parseInt(req.params["id"]!, 10);
  if (isNaN(campaignId) || !await requireCampaign(campaignId, userId)) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const rows = await db.selectDistinctOn([callTransfersTable.id], {
    id:           callTransfersTable.id,
    transferTo:   callTransfersTable.transferTo,
    transferName: callTransfersTable.transferName,
    status:       callTransfersTable.status,
    initiatedAt:  callTransfersTable.initiatedAt,
    connectedAt:  callTransfersTable.connectedAt,
    completedAt:  callTransfersTable.completedAt,
    leadName:     campaignLeadsTable.name,
    leadPhone:    campaignLeadsTable.phone,
    batchName:    campaignBatchesTable.name,
    agentName:    agentsTable.name,
  }).from(callTransfersTable)
    .innerJoin(callExecutionsTable,
      and(
        eq(callTransfersTable.callId, callExecutionsTable.callId!),
        eq(callExecutionsTable.campaignId, campaignId),
        isNotNull(callExecutionsTable.callId),
      )!,
    )
    .leftJoin(callsTable,          eq(callTransfersTable.callId, callsTable.id))
    .leftJoin(campaignLeadsTable,  eq(callExecutionsTable.leadId, campaignLeadsTable.id))
    .leftJoin(campaignBatchesTable, eq(callExecutionsTable.batchId, campaignBatchesTable.id))
    .leftJoin(agentsTable,         eq(callsTable.agentId, agentsTable.id))
    .orderBy(callTransfersTable.id, desc(callTransfersTable.initiatedAt))
    .limit(5000);

  const headers = ["ID", "Lead Name", "Phone", "Transferred To", "Transfer Name", "Status", "Initiated At", "Connected At", "Completed At", "Agent", "Batch"];
  const csvRows = rows.map(r => [
    r.id, r.leadName ?? "", r.leadPhone ?? "",
    r.transferTo, r.transferName ?? "", r.status,
    r.initiatedAt.toISOString(),
    r.connectedAt?.toISOString() ?? "",
    r.completedAt?.toISOString() ?? "",
    r.agentName ?? "", r.batchName ?? "",
  ].join(","));

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="transfers-${campaignId}.csv"`);
  res.send([headers.join(","), ...csvRows].join("\n"));
});

export default router;
