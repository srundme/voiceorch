import { Router } from "express";
import { and, eq, desc } from "drizzle-orm";
import { db, agentsTable, callsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Helper: verify agent belongs to user ─────────────────────────────────────
async function getVisionAgent(agentId: number, clerkId: string) {
  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkId)))
    .limit(1);
  return agent ?? null;
}

// ── List all vision agents for this user ─────────────────────────────────────
router.get("/vision-agents", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  try {
    const agents = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.userId, clerkId))
      .orderBy(desc(agentsTable.createdAt));

    // Filter to vision agents (agentKind === "vision" in agentConfig)
    const visionAgents = agents.filter((a) => {
      const cfg = (a.agentConfig ?? {}) as Record<string, unknown>;
      return cfg["agentKind"] === "vision";
    });

    res.json(visionAgents);
  } catch (err) {
    logger.error({ err, clerkId }, "Failed to list vision agents");
    res.status(500).json({ error: "Failed to list vision agents" });
  }
});

// ── Create a new vision agent ─────────────────────────────────────────────────
router.post("/vision-agents", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const name = typeof body["name"] === "string" ? body["name"].trim() : "New Vision Agent";
  const systemPrompt = typeof body["systemPrompt"] === "string" ? body["systemPrompt"] : "You are a helpful vision AI assistant.";
  const visionConfig = (body["visionConfig"] as Record<string, unknown> | undefined) ?? {
    enabled: true,
    defaultProvider: "gemini",
    mode: "photo_upload",
    allowWhatsapp: false,
    allowApiStaging: true,
    retentionDays: 30,
    notifyOnMedia: true,
  };

  const agentConfig: Record<string, unknown> = {
    agentKind: "vision",
    voiceStack: "gemini_live",
    llmProvider: "google",
    llmModel: "gemini-2.5-flash-preview-native-audio-dialog",
    visionConfig,
    ...(body["agentConfig"] as Record<string, unknown> | undefined ?? {}),
  };

  try {
    const [agent] = await db
      .insert(agentsTable)
      .values({
        userId: clerkId,
        name,
        systemPrompt,
        asrProvider: "google",
        llmProvider: "google",
        ttsProvider: "google",
        telephonyProvider: "webcall",
        agentConfig,
      } as typeof agentsTable.$inferInsert)
      .returning();

    res.status(201).json(agent);
  } catch (err) {
    logger.error({ err, clerkId }, "Failed to create vision agent");
    res.status(500).json({ error: "Failed to create vision agent" });
  }
});

// ── Get one vision agent ──────────────────────────────────────────────────────
router.get("/vision-agents/:id", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.id), 10);
  const clerkId = (req as any).clerkUserId as string;

  if (!Number.isFinite(agentId)) {
    res.status(400).json({ error: "Invalid agent id" });
    return;
  }

  const agent = await getVisionAgent(agentId, clerkId);
  if (!agent) {
    res.status(404).json({ error: "Vision agent not found" });
    return;
  }

  res.json(agent);
});

// ── Update vision agent ───────────────────────────────────────────────────────
router.patch("/vision-agents/:id", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.id), 10);
  const clerkId = (req as any).clerkUserId as string;

  if (!Number.isFinite(agentId)) {
    res.status(400).json({ error: "Invalid agent id" });
    return;
  }

  const agent = await getVisionAgent(agentId, clerkId);
  if (!agent) {
    res.status(404).json({ error: "Vision agent not found" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Partial<typeof agentsTable.$inferInsert> = {};

  if (typeof body["name"] === "string") patch.name = body["name"].trim();
  if (typeof body["systemPrompt"] === "string") patch.systemPrompt = body["systemPrompt"];

  if (body["agentConfig"] != null) {
    const existing = (agent.agentConfig ?? {}) as Record<string, unknown>;
    const incoming = body["agentConfig"] as Record<string, unknown>;
    patch.agentConfig = { ...existing, ...incoming } as typeof agentsTable.$inferInsert["agentConfig"];
  }

  if (Array.isArray(body["tools"])) {
    // Store tools inside agentConfig (if not already patched there)
    const currentCfg = (patch.agentConfig ?? (agent.agentConfig ?? {})) as Record<string, unknown>;
    patch.agentConfig = { ...currentCfg, tools: body["tools"] } as typeof agentsTable.$inferInsert["agentConfig"];
  }

  try {
    const [updated] = await db
      .update(agentsTable)
      .set(patch)
      .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkId)))
      .returning();
    res.json(updated);
  } catch (err) {
    logger.error({ err, agentId }, "Failed to update vision agent");
    res.status(500).json({ error: "Failed to update vision agent" });
  }
});

// ── Delete vision agent ───────────────────────────────────────────────────────
router.delete("/vision-agents/:id", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.id), 10);
  const clerkId = (req as any).clerkUserId as string;

  if (!Number.isFinite(agentId)) {
    res.status(400).json({ error: "Invalid agent id" });
    return;
  }

  const agent = await getVisionAgent(agentId, clerkId);
  if (!agent) {
    res.status(404).json({ error: "Vision agent not found" });
    return;
  }

  try {
    await db.delete(agentsTable).where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkId)));
    res.status(204).end();
  } catch (err) {
    logger.error({ err, agentId }, "Failed to delete vision agent");
    res.status(500).json({ error: "Failed to delete vision agent" });
  }
});

// ── List sessions for a vision agent ─────────────────────────────────────────
router.get("/vision-agents/:id/sessions", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.id), 10);
  const clerkId = (req as any).clerkUserId as string;
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "50"), 10) || 50, 200);

  if (!Number.isFinite(agentId)) {
    res.status(400).json({ error: "Invalid agent id" });
    return;
  }

  const agent = await getVisionAgent(agentId, clerkId);
  if (!agent) {
    res.status(404).json({ error: "Vision agent not found" });
    return;
  }

  try {
    const calls = await db
      .select()
      .from(callsTable)
      .where(eq(callsTable.agentId, agentId))
      .orderBy(desc(callsTable.createdAt))
      .limit(limit);
    res.json(calls);
  } catch (err) {
    logger.error({ err, agentId }, "Failed to list vision agent sessions");
    res.status(500).json({ error: "Failed to list sessions" });
  }
});

// ── Code snippets ─────────────────────────────────────────────────────────────
router.get("/vision-agents/:id/code-snippets", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.id), 10);
  const clerkId = (req as any).clerkUserId as string;

  if (!Number.isFinite(agentId)) {
    res.status(400).json({ error: "Invalid agent id" });
    return;
  }

  const agent = await getVisionAgent(agentId, clerkId);
  if (!agent) {
    res.status(404).json({ error: "Vision agent not found" });
    return;
  }

  const { generateCodeSnippets } = await import("../services/vision-code-snippets.js");
  const baseUrl = process.env["API_BASE_URL"] ?? `${req.protocol}://${req.get("host")}`;
  const apiKey = String(req.headers["authorization"] ?? "").replace(/^Bearer\s+/i, "");
  const snippets = generateCodeSnippets(agentId, apiKey, baseUrl);

  res.json({
    snippets,
    shareableUrl: `${baseUrl}/vision-agents/${agentId}`,
  });
});

export default router;
