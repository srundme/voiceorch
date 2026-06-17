import { Router, type IRouter } from "express";
import { eq, and, count, desc, inArray } from "drizzle-orm";
import { db, agentsTable, agentVersionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";

const router: IRouter = Router();

const VERSION_LIMIT = 10;
const WARNING_THRESHOLD = 8;

const TRACKED_FIELDS: Array<{ keys: string[]; label: string }> = [
  { keys: ["systemPrompt"], label: "Prompt Modified" },
  { keys: ["ttsVoice", "ttsProvider", "ttsModel"], label: "Voice Updated" },
  { keys: ["llmProvider", "llmModel", "temperature"], label: "LLM Changed" },
  { keys: ["asrProvider", "asrModel", "asrLanguage"], label: "ASR Changed" },
  { keys: ["telephonyProvider"], label: "Telephony Changed" },
  { keys: ["webhookUrl"], label: "Webhook Updated" },
  { keys: ["tools"], label: "Tools Modified" },
  { keys: ["knowledgeSourceIds"], label: "Knowledge Base Updated" },
  { keys: ["greetingMessage", "endCallPhrases"], label: "Conversation Updated" },
  { keys: ["maxDuration", "silenceTimeoutSeconds", "language"], label: "Call Settings Changed" },
  { keys: ["agentConfig"], label: "Advanced Config Updated" },
];

function detectChanges(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): string[] {
  const labels: string[] = [];
  for (const { keys, label } of TRACKED_FIELDS) {
    for (const key of keys) {
      const a = JSON.stringify(prev[key] ?? null);
      const b = JSON.stringify(next[key] ?? null);
      if (a !== b) { labels.push(label); break; }
    }
  }
  return labels;
}

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

  const publishedCount = versions.filter(
    v => v.status === "production" || v.status === "published",
  ).length;

  const summary = versions.map(({ snapshot: _snap, ...rest }) => rest);

  res.json({ versions: summary, publishedCount, limit: VERSION_LIMIT });
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

  // Pre-check the published version count (outside tx for early 422)
  const [{ publishedCnt }] = await db
    .select({ publishedCnt: count() })
    .from(agentVersionsTable)
    .where(
      and(
        eq(agentVersionsTable.agentId, agentId),
        inArray(agentVersionsTable.status, ["production", "published"]),
      ),
    );

  if (Number(publishedCnt) >= VERSION_LIMIT) {
    res.status(422).json({
      error: "VERSION_LIMIT_REACHED",
      publishedCount: Number(publishedCnt),
      limit: VERSION_LIMIT,
    });
    return;
  }

  const newVersion = await db.transaction(async (tx) => {
    // Fetch current production snapshot for diffing
    const [prevProduction] = await tx
      .select()
      .from(agentVersionsTable)
      .where(and(
        eq(agentVersionsTable.agentId, agentId),
        eq(agentVersionsTable.status, "production"),
      ));

    // Demote any existing production version to published
    await tx
      .update(agentVersionsTable)
      .set({ status: "published", updatedAt: new Date() })
      .where(and(
        eq(agentVersionsTable.agentId, agentId),
        eq(agentVersionsTable.status, "production"),
      ));

    // Compute next version number (total versions count)
    const [{ cnt }] = await tx
      .select({ cnt: count() })
      .from(agentVersionsTable)
      .where(eq(agentVersionsTable.agentId, agentId));
    const versionNumber = `v${Number(cnt) + 1}`;

    // Snapshot the current agent row
    const snapshot: Record<string, unknown> = { ...agent };

    // Auto-detect changed fields vs. previous production
    let changedFields: string[] | null = null;
    if (prevProduction) {
      const prevSnap = prevProduction.snapshot as Record<string, unknown>;
      const detected = detectChanges(prevSnap, snapshot);
      changedFields = detected.length > 0 ? detected : null;
    }

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
        changedFields,
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

    const [{ cnt }] = await tx
      .select({ cnt: count() })
      .from(agentVersionsTable)
      .where(eq(agentVersionsTable.agentId, agentId));
    const versionNumber = `v${Number(cnt) + 1}`;

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

// ── Archive a version ─────────────────────────────────────────────────────────
router.patch("/agents/:id/versions/:versionId/archive", requireAuth, async (req, res): Promise<void> => {
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

  if (version.status === "archived") {
    res.status(400).json({ error: "Version is already archived" }); return;
  }

  const [updated] = await db
    .update(agentVersionsTable)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(agentVersionsTable.id, versionId))
    .returning();

  const { snapshot: _snap, ...rest } = updated!;
  res.json(rest);
});

export default router;
