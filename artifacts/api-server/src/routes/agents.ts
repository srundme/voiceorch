import { Router, type IRouter } from "express";
import { eq, and, count, desc, isNull, inArray } from "drizzle-orm";
import { db, agentsTable, schedulingCalendarsTable, callerProfilesTable, callerFactsTable, callerCallArchiveTable, callerSentencesTable } from "@workspace/db";
import {
  CreateAgentBody,
  UpdateAgentBody,
  GetAgentParams,
  UpdateAgentParams,
  DeleteAgentParams,
  ToggleAgentParams,
  ListAgentsResponse,
  GetAgentResponse,
  UpdateAgentResponse,
  ToggleAgentResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logActivity } from "../lib/activity.js";
import { encryptKey, decryptKey } from "../lib/crypto.js";
import {
  getActiveTemplate,
  generateAgentPrompt,
  type WizardInputs,
} from "../services/prompt-template.js";

const router: IRouter = Router();

function maskLeadToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const plain = decryptKey(token);
  if (plain.length <= 4) return "****";
  return "..." + plain.slice(-4);
}

function prepareAgentForResponse(agent: typeof agentsTable.$inferSelect) {
  // Strip admin-only fields from dashboard responses
  const { generatedPrompt: _gp, promptTemplateVersion: _pv, wizardInputs: _wi, ...rest } = agent;
  return {
    ...rest,
    leadSourceToken: maskLeadToken(agent.leadSourceToken),
    hasGeneratedPrompt: !!agent.generatedPrompt,
  };
}

router.get("/agents", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const agents = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.userId, clerkId))
    .orderBy(agentsTable.createdAt);
  res.json(ListAgentsResponse.parse(agents.map(prepareAgentForResponse)));
});

router.post("/agents", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = CreateAgentBody.safeParse(req.body);
  if (!parsed.success) {
    const issues = parsed.error.issues;
    req.log.warn({ issues, body: req.body }, "Create agent validation failed");
    res.status(400).json({ error: "Validation failed", issues });
    return;
  }
  // wizardInputs is an admin-managed pass-through (not in DB schema strict type)
  const rawBody = (req.body ?? {}) as Record<string, unknown>;
  const wizardInputs = (rawBody["wizardInputs"] ?? null) as WizardInputs | null;

  const insertData: Record<string, unknown> = { ...parsed.data, userId: clerkId };
  if (insertData["leadSourceToken"]) {
    insertData["leadSourceToken"] = encryptKey(insertData["leadSourceToken"] as string);
  }

  // If wizard submit included inputs, run the admin master template through Qwen
  // and store the generated prompt + template version. Fail loudly if no active template.
  if (wizardInputs && typeof wizardInputs === "object") {
    let active: Awaited<ReturnType<typeof getActiveTemplate>>;
    try {
      active = await getActiveTemplate();
    } catch (err) {
      req.log.error({ err }, "Failed to query prompt_templates — table may be missing");
      res.status(503).json({
        error:
          "Agent creation is currently unavailable: platform configuration could not be read. Please contact the platform administrator.",
      });
      return;
    }
    if (!active) {
      res.status(503).json({
        error:
          "Agent creation is currently unavailable: no active prompt template configured. Please contact the platform administrator.",
      });
      return;
    }
    try {
      const generated = await generateAgentPrompt(wizardInputs, active.extractedText);
      insertData["generatedPrompt"] = generated;
      insertData["promptTemplateVersion"] = active.version;
      insertData["wizardInputs"] = wizardInputs;
    } catch (err) {
      req.log.warn({ err }, "Qwen prompt generation failed — falling back to wizard-provided systemPrompt");
      insertData["wizardInputs"] = wizardInputs;
      // generatedPrompt and promptTemplateVersion left unset; systemPrompt from payload is used
    }
  }

  const [agent] = await db
    .insert(agentsTable)
    .values(insertData as typeof agentsTable.$inferInsert)
    .returning();
  await logActivity({ userId: clerkId, eventType: "agent.created", resourceType: "agent", resourceId: String(agent.id), description: `Agent "${agent.name}" created` });
  db.insert(schedulingCalendarsTable)
    .values({
      agentId: agent.id,
      userId: clerkId,
      name: `${agent.name} Calendar`,
      timezone: "UTC",
      isActive: true,
    })
    .onConflictDoNothing()
    .catch((err) => {
      req.log.warn({ err, agentId: agent.id }, "Failed to auto-create scheduling calendar for agent");
    });
  res.status(201).json(GetAgentResponse.parse(prepareAgentForResponse(agent)));
});

router.get("/agents/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = GetAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Validation failed", issues: params.error.issues });
    return;
  }
  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.userId, clerkId)));
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json(GetAgentResponse.parse(prepareAgentForResponse(agent)));
});

router.patch("/agents/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = UpdateAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Validation failed", issues: params.error.issues });
    return;
  }
  const parsed = UpdateAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }
  const updateData: Record<string, unknown> = { ...parsed.data };
  if (updateData.leadSourceToken) {
    updateData.leadSourceToken = encryptKey(updateData.leadSourceToken as string);
  }
  // Merge agentConfig with the existing one instead of replacing it wholesale,
  // so saving one tab's fields doesn't wipe another tab's saved values.
  if (updateData.agentConfig != null) {
    const [existing] = await db
      .select({ agentConfig: agentsTable.agentConfig })
      .from(agentsTable)
      .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.userId, clerkId)));
    if (existing) {
      updateData.agentConfig = { ...(existing.agentConfig as object ?? {}), ...(updateData.agentConfig as object) };
    }
  }
  const [agent] = await db
    .update(agentsTable)
    .set({ ...updateData, updatedAt: new Date() })
    .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.userId, clerkId)))
    .returning();
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json(UpdateAgentResponse.parse(prepareAgentForResponse(agent)));
});

router.delete("/agents/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = DeleteAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Validation failed", issues: params.error.issues });
    return;
  }
  const [deleted] = await db
    .delete(agentsTable)
    .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.userId, clerkId)))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  await logActivity({ userId: clerkId, eventType: "agent.deleted", resourceType: "agent", resourceId: String(deleted.id), description: `Agent "${deleted.name}" deleted` });
  res.sendStatus(204);
});

// ── Caller Memory endpoints ────────────────────────────────────────────────

// List all callers tracked for this agent
router.get("/agents/:id/caller-memory", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const agentId = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }

  const [agent] = await db.select({ id: agentsTable.id })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkId)));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  const [profiles, factCounts, archiveCounts] = await Promise.all([
    db.select().from(callerProfilesTable)
      .where(eq(callerProfilesTable.agentId, agentId))
      .orderBy(desc(callerProfilesTable.lastCalledAt)),
    db.select({ phoneNumber: callerFactsTable.phoneNumber, cnt: count() })
      .from(callerFactsTable)
      .where(eq(callerFactsTable.agentId, agentId))
      .groupBy(callerFactsTable.phoneNumber),
    db.select({ phoneNumber: callerCallArchiveTable.phoneNumber, cnt: count() })
      .from(callerCallArchiveTable)
      .where(eq(callerCallArchiveTable.agentId, agentId))
      .groupBy(callerCallArchiveTable.phoneNumber),
  ]);

  const factMap    = new Map(factCounts.map(r => [r.phoneNumber, r.cnt]));
  const archiveMap = new Map(archiveCounts.map(r => [r.phoneNumber, r.cnt]));

  res.json(profiles.map(p => ({
    phoneNumber:     p.phoneNumber,
    name:            p.name,
    summary:         p.summary,
    callCount:       p.callCount,
    factCount:       factMap.get(p.phoneNumber) ?? 0,
    archiveCount:    archiveMap.get(p.phoneNumber) ?? 0,
    lastCalledAt:    p.lastCalledAt,
    lastCallDropped: p.lastCallDropped,
  })));
});

// Get graph-structured memory for a specific caller:
//   L0 facts with supersession chains + fact_sources provenance
//   L1 episodes with insight_fact_ids
//   L2 sentences with NEXT-edge ordering
router.get("/agents/:id/caller-memory/:phone", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const agentId = parseInt(String(req.params["id"] ?? ""), 10);
  const phoneNumber = decodeURIComponent(String(req.params["phone"] ?? ""));
  if (isNaN(agentId) || !phoneNumber) { res.status(400).json({ error: "Invalid params" }); return; }

  const [agent] = await db.select({ id: agentsTable.id })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkId)));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  // Fetch all fact rows (current + superseded) to build chains
  const [allFacts, allEpisodes] = await Promise.all([
    db.select().from(callerFactsTable)
      .where(and(eq(callerFactsTable.agentId, agentId), eq(callerFactsTable.phoneNumber, phoneNumber)))
      .orderBy(desc(callerFactsTable.createdAt)),
    db.select().from(callerCallArchiveTable)
      .where(and(eq(callerCallArchiveTable.agentId, agentId), eq(callerCallArchiveTable.phoneNumber, phoneNumber)))
      .orderBy(desc(callerCallArchiveTable.createdAt))
      .limit(20),
  ]);

  // Build supersession chains: predecessorMap[targetId] = facts that were superseded by targetId
  const predecessorMap = new Map<number, typeof allFacts>();
  for (const f of allFacts) {
    if (f.supersededById !== null) {
      if (!predecessorMap.has(f.supersededById)) predecessorMap.set(f.supersededById, []);
      predecessorMap.get(f.supersededById)!.push(f);
    }
  }

  function buildHistory(factId: number): Array<{ id: number; value: string; confidence: number; createdAt: Date }> {
    const preds = predecessorMap.get(factId) ?? [];
    const older = preds.flatMap(p => buildHistory(p.id));
    return [...older, ...preds.map(p => ({ id: p.id, value: p.value, confidence: p.confidence, createdAt: p.createdAt }))]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  const parseSentenceIds = (raw: string) =>
    raw.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));

  // Current facts (non-superseded) with their history chains
  const currentFacts = allFacts
    .filter(f => f.supersededById === null)
    .map(f => ({
      id:                f.id,
      key:               f.key,
      value:             f.value,
      confidence:        f.confidence,
      sourceCallId:      f.sourceCallId,
      sourceSentenceIds: parseSentenceIds(f.sourceSentenceIds),
      createdAt:         f.createdAt,
      history:           buildHistory(f.id),
    }));

  // Fetch L2 sentences for all episodes
  const episodeIds = allEpisodes.map(e => e.id);
  const sentences = episodeIds.length > 0
    ? await db.select().from(callerSentencesTable)
        .where(inArray(callerSentencesTable.episodeId, episodeIds))
        .orderBy(callerSentencesTable.episodeId, callerSentencesTable.sequenceNum)
    : [];

  const sentencesByEpisode = new Map<number, typeof sentences>();
  for (const s of sentences) {
    if (!sentencesByEpisode.has(s.episodeId)) sentencesByEpisode.set(s.episodeId, []);
    sentencesByEpisode.get(s.episodeId)!.push(s);
  }

  const episodes = allEpisodes.map(ep => ({
    id:              ep.id,
    callId:          ep.callId,
    summary:         ep.summary,
    durationSeconds: ep.durationSeconds,
    createdAt:       ep.createdAt,
    insightFactIds:  parseSentenceIds(ep.insightFactIds),  // reuse parser — same format
    sentences:       (sentencesByEpisode.get(ep.id) ?? []).map(s => ({
      id:          s.id,
      sequenceNum: s.sequenceNum,
      speaker:     s.speaker,
      text:        s.text,
    })),
  }));

  res.json({ facts: currentFacts, episodes });
});

// Delete an entire fact key (current + entire supersession chain) for a caller
router.delete("/agents/:id/caller-memory/:phone/facts/:factId", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const agentId = parseInt(String(req.params["id"] ?? ""), 10);
  const factId  = parseInt(String(req.params["factId"] ?? ""), 10);
  const phoneNumber = decodeURIComponent(String(req.params["phone"] ?? ""));
  if (isNaN(agentId) || isNaN(factId) || !phoneNumber) { res.status(400).json({ error: "Invalid params" }); return; }

  const [agent] = await db.select({ id: agentsTable.id })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkId)));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  // Find the key for this fact, then delete the entire supersession chain
  const [target] = await db.select({ key: callerFactsTable.key })
    .from(callerFactsTable)
    .where(and(
      eq(callerFactsTable.id, factId),
      eq(callerFactsTable.agentId, agentId),
      eq(callerFactsTable.phoneNumber, phoneNumber),
    ));

  if (target) {
    // Cascade: delete all versions of this fact key (entire graph chain)
    await db.delete(callerFactsTable)
      .where(and(
        eq(callerFactsTable.agentId, agentId),
        eq(callerFactsTable.phoneNumber, phoneNumber),
        eq(callerFactsTable.key, target.key),
      ));
  }
  res.status(204).end();
});

// ─────────────────────────────────────────────────────────────────────────────

router.patch("/agents/:id/toggle", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = ToggleAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Validation failed", issues: params.error.issues });
    return;
  }
  const [existing] = await db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.userId, clerkId)));
  if (!existing) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  const newStatus = existing.status === "active" ? "inactive" : "active";
  const [agent] = await db
    .update(agentsTable)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.userId, clerkId)))
    .returning();
  await logActivity({ userId: clerkId, eventType: "agent.toggled", resourceType: "agent", resourceId: String(agent.id), description: `Agent "${agent.name}" set to ${newStatus}` });
  res.json(ToggleAgentResponse.parse(agent));
});

export default router;
