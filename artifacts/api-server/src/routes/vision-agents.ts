import { Router } from "express";
import { and, eq, desc } from "drizzle-orm";
import { db, agentsTable, callsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Serializer: shape raw DB row → VisionAgent frontend contract ─────────────
function serializeVisionAgent(agent: typeof agentsTable.$inferSelect) {
  const cfg = (agent.agentConfig ?? {}) as Record<string, unknown>;
  const vc  = (cfg["visionConfig"] as Record<string, unknown> | undefined) ?? {};
  return {
    ...agent,
    // agentConfig scalars surfaced at top level for the builder
    voiceName:       (cfg["voiceName"] as string | null | undefined) ?? agent.ttsVoiceName ?? null,
    thinkingLevel:   (cfg["thinkingLevel"] as string | undefined)    ?? "minimal",
    multilingual:    (cfg["multilingual"] as boolean | undefined)    ?? false,
    // visionConfig fields
    defaultProvider: (vc["defaultProvider"] as string | null | undefined) ?? null,
    visionMode:      (vc["mode"] as string | undefined)                   ?? "photo_upload",
    retentionDays:   (vc["retentionDays"] as number | undefined)          ?? 30,
    allowWhatsApp:   (vc["allowWhatsapp"] as boolean | undefined)         ?? false,
    allowApiStaging: (vc["allowApiStaging"] as boolean | undefined)       ?? true,
    notifyOnMedia:   (vc["notifyOnMedia"] as boolean | undefined)         ?? true,
    // tools
    tools:           (cfg["tools"] as unknown) ?? {},
  };
}

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

    res.json(visionAgents.map(serializeVisionAgent));
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
    mode: "live_stream",
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

    res.status(201).json(serializeVisionAgent(agent));
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

  res.json(serializeVisionAgent(agent));
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

  // Direct DB columns
  if (typeof body["name"] === "string") patch.name = body["name"].trim();
  if (typeof body["description"] === "string" || body["description"] === null)
    patch.description = (body["description"] as string | null);
  if (typeof body["systemPrompt"] === "string") patch.systemPrompt = body["systemPrompt"];
  if (typeof body["language"] === "string") patch.language = body["language"];
  if (typeof body["status"] === "string") patch.status = body["status"];

  // agentConfig merge — overview tab fields (voiceName, thinkingLevel, multilingual) + visionConfig, tools
  const agentCfgMerge: Record<string, unknown> = {};
  if (typeof body["voiceName"] === "string" || body["voiceName"] === null)
    agentCfgMerge["voiceName"] = body["voiceName"];
  if (typeof body["thinkingLevel"] === "string") agentCfgMerge["thinkingLevel"] = body["thinkingLevel"];
  if (typeof body["multilingual"] === "boolean") agentCfgMerge["multilingual"] = body["multilingual"];

  // Vision tab sends flat fields — map them into agentConfig.visionConfig
  const vcPatch: Record<string, unknown> = {};
  if (typeof body["visionMode"] === "string")       vcPatch["mode"]             = body["visionMode"];
  if (typeof body["defaultProvider"] === "string" || body["defaultProvider"] === null)
                                                    vcPatch["defaultProvider"]  = body["defaultProvider"];
  if (typeof body["retentionDays"] === "number")    vcPatch["retentionDays"]    = body["retentionDays"];
  if (typeof body["allowWhatsApp"] === "boolean")   vcPatch["allowWhatsapp"]    = body["allowWhatsApp"];
  if (typeof body["allowApiStaging"] === "boolean") vcPatch["allowApiStaging"]  = body["allowApiStaging"];
  if (typeof body["notifyOnMedia"] === "boolean")   vcPatch["notifyOnMedia"]    = body["notifyOnMedia"];

  if (Object.keys(vcPatch).length > 0 || body["visionConfig"] != null) {
    const existingVC = ((agent.agentConfig ?? {}) as Record<string, unknown>)["visionConfig"] as Record<string, unknown> | undefined ?? {};
    const incomingVC = (body["visionConfig"] as Record<string, unknown> | undefined) ?? {};
    agentCfgMerge["visionConfig"] = { ...existingVC, ...incomingVC, ...vcPatch };
  }

  if (body["agentConfig"] != null) {
    Object.assign(agentCfgMerge, body["agentConfig"] as Record<string, unknown>);
  }

  if (Object.keys(agentCfgMerge).length > 0 || Array.isArray(body["tools"])) {
    const existing = (agent.agentConfig ?? {}) as Record<string, unknown>;
    const merged = { ...existing, ...agentCfgMerge };
    if (Array.isArray(body["tools"])) merged["tools"] = body["tools"];
    patch.agentConfig = merged as typeof agentsTable.$inferInsert["agentConfig"];
  } else if (Array.isArray(body["tools"])) {
    const currentCfg = (agent.agentConfig ?? {}) as Record<string, unknown>;
    patch.agentConfig = { ...currentCfg, tools: body["tools"] } as typeof agentsTable.$inferInsert["agentConfig"];
  }

  // Guard: if nothing changed, return current agent without hitting DB
  if (Object.keys(patch).length === 0) {
    res.json(serializeVisionAgent(agent));
    return;
  }

  try {
    const [updated] = await db
      .update(agentsTable)
      .set(patch)
      .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkId)))
      .returning();
    res.json(serializeVisionAgent(updated));
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
