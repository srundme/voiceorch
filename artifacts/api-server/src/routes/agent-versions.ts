import { Router, type IRouter } from "express";
import { eq, and, count, desc } from "drizzle-orm";
import { db, agentsTable, agentVersionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";

const router: IRouter = Router();

// ── List versions for an agent ───────────────────────────────────────────────
router.get("/agents/:id/versions", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const agentId = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }

  const [agent] = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkId)));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  const versions = await db
    .select()
    .from(agentVersionsTable)
    .where(eq(agentVersionsTable.agentId, agentId))
    .orderBy(desc(agentVersionsTable.createdAt));

  // Strip snapshot from list response for performance
  const summary = versions.map(({ snapshot: _snap, ...rest }) => rest);
  res.json(summary);
});

// ── Publish a new version snapshot ───────────────────────────────────────────
router.post("/agents/:id/versions", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const agentId = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }

  const { versionName, commitDescription, releaseNotes } = req.body ?? {};
  if (!versionName || typeof versionName !== "string" || versionName.trim().length === 0) {
    res.status(400).json({ error: "versionName is required" }); return;
  }
  if (!commitDescription || typeof commitDescription !== "string" || commitDescription.trim().length === 0) {
    res.status(400).json({ error: "commitDescription is required" }); return;
  }

  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkId)));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  // Use a transaction: demote prior production → published, then insert new version
  const newVersion = await db.transaction(async (tx) => {
    // Demote any existing production version to published
    await tx
      .update(agentVersionsTable)
      .set({ status: "published", updatedAt: new Date() })
      .where(and(
        eq(agentVersionsTable.agentId, agentId),
        eq(agentVersionsTable.status, "production"),
      ));

    // Compute next version number
    const [{ cnt }] = await tx
      .select({ cnt: count() })
      .from(agentVersionsTable)
      .where(eq(agentVersionsTable.agentId, agentId));
    const versionNumber = `v${Number(cnt) + 1}`;

    // Snapshot the current agent row (all columns)
    const snapshot: Record<string, unknown> = { ...agent };

    const [inserted] = await tx
      .insert(agentVersionsTable)
      .values({
        agentId,
        userId: clerkId,
        versionNumber,
        versionName: versionName.trim(),
        commitDescription: commitDescription.trim(),
        releaseNotes: typeof releaseNotes === "string" ? releaseNotes.trim() || null : null,
        status: "production",
        snapshot,
        publishedBy: clerkId,
      })
      .returning();

    return inserted;
  });

  res.status(201).json(newVersion);
});

// ── Get full version snapshot ─────────────────────────────────────────────────
router.get("/agents/:id/versions/:versionId", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const agentId = parseInt(String(req.params["id"] ?? ""), 10);
  const versionId = parseInt(String(req.params["versionId"] ?? ""), 10);
  if (isNaN(agentId) || isNaN(versionId)) { res.status(400).json({ error: "Invalid params" }); return; }

  const [agent] = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkId)));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  const [version] = await db
    .select()
    .from(agentVersionsTable)
    .where(and(eq(agentVersionsTable.id, versionId), eq(agentVersionsTable.agentId, agentId)));
  if (!version) { res.status(404).json({ error: "Version not found" }); return; }

  res.json(version);
});

// ── Restore: create a new draft from a snapshot ───────────────────────────────
router.post("/agents/:id/versions/:versionId/restore", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const agentId = parseInt(String(req.params["id"] ?? ""), 10);
  const versionId = parseInt(String(req.params["versionId"] ?? ""), 10);
  if (isNaN(agentId) || isNaN(versionId)) { res.status(400).json({ error: "Invalid params" }); return; }

  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkId)));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  const [sourceVersion] = await db
    .select()
    .from(agentVersionsTable)
    .where(and(eq(agentVersionsTable.id, versionId), eq(agentVersionsTable.agentId, agentId)));
  if (!sourceVersion) { res.status(404).json({ error: "Version not found" }); return; }

  const snap = sourceVersion.snapshot as Record<string, unknown>;

  const restoredDraft = await db.transaction(async (tx) => {
    // Apply snapshot fields back to the live agents row
    // Only restore agent config fields, not stats, IDs, or timestamps
    const {
      id: _id, userId: _uid, createdAt: _ca, updatedAt: _ua,
      totalCalls: _tc, successfulCalls: _sc,
      avgDurationSeconds: _ad, avgSttLatencyMs: _as, avgLlmLatencyMs: _al, avgTtsFirstChunkMs: _at,
      ...restorableFields
    } = snap;

    await tx
      .update(agentsTable)
      .set({ ...(restorableFields as any), updatedAt: new Date() })
      .where(eq(agentsTable.id, agentId));

    // Compute next version number
    const [{ cnt }] = await tx
      .select({ cnt: count() })
      .from(agentVersionsTable)
      .where(eq(agentVersionsTable.agentId, agentId));
    const versionNumber = `v${Number(cnt) + 1}`;

    // Snapshot the restored state
    const restoredAgentSnap = { ...snap, updatedAt: new Date().toISOString() };

    const [inserted] = await tx
      .insert(agentVersionsTable)
      .values({
        agentId,
        userId: clerkId,
        versionNumber,
        versionName: `Restored from ${sourceVersion.versionName}`,
        commitDescription: `Restored from ${sourceVersion.versionNumber} — ${sourceVersion.commitDescription}`,
        status: "restored",
        snapshot: restoredAgentSnap,
        publishedBy: clerkId,
        restoredFromVersionId: versionId,
      })
      .returning();

    return inserted;
  });

  res.status(201).json(restoredDraft);
});

export default router;
