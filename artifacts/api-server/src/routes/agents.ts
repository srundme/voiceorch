// agents router — supports call_transfer + webhook (custom function) tools + AMD voicemail detection
import { Router, type IRouter } from "express";
import { eq, and, count, desc, isNull, inArray } from "drizzle-orm";
import { db, agentsTable, schedulingCalendarsTable, callerProfilesTable, callerFactsTable, callerCallArchiveTable, callerSentencesTable, callerFactSentenceLinksTable, callerEpisodeFactLinksTable, providersTable, agentKnowledgeSourcesTable, phoneNumbersTable } from "@workspace/db";
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

function prepareAgentForResponse(
  agent: typeof agentsTable.$inferSelect,
  knowledgeSourceIds: number[] = [],
) {
  // Strip admin-only fields from dashboard responses
  const { generatedPrompt: _gp, promptTemplateVersion: _pv, wizardInputs: _wi, ...rest } = agent;
  return {
    ...rest,
    knowledgeSourceIds,
    leadSourceToken: maskLeadToken(agent.leadSourceToken),
    hasGeneratedPrompt: !!agent.generatedPrompt,
  };
}

/**
 * Resolve the set of attached knowledge source IDs for a list of agents.
 * Unions the M:N join table with the legacy single `knowledgeBaseId` column
 * so agents created before the join table still surface their attached source.
 */
async function getKnowledgeSourceIdsByAgent(
  agents: Array<typeof agentsTable.$inferSelect>,
): Promise<Map<number, number[]>> {
  const result = new Map<number, number[]>();
  for (const a of agents) result.set(a.id, []);
  const agentIds = agents.map((a) => a.id);
  if (agentIds.length > 0) {
    const links = await db
      .select()
      .from(agentKnowledgeSourcesTable)
      .where(inArray(agentKnowledgeSourcesTable.agentId, agentIds));
    for (const link of links) {
      const arr = result.get(link.agentId);
      if (arr && !arr.includes(link.sourceId)) arr.push(link.sourceId);
    }
  }
  // Union legacy single-column value
  for (const a of agents) {
    if (a.knowledgeBaseId != null) {
      const arr = result.get(a.id)!;
      if (!arr.includes(a.knowledgeBaseId)) arr.unshift(a.knowledgeBaseId);
    }
  }
  return result;
}

/** Replace an agent's join-table knowledge source associations. */
async function setAgentKnowledgeSources(agentId: number, sourceIds: number[]): Promise<void> {
  const unique = Array.from(new Set(sourceIds.filter((n) => Number.isInteger(n))));
  await db.delete(agentKnowledgeSourcesTable).where(eq(agentKnowledgeSourcesTable.agentId, agentId));
  if (unique.length > 0) {
    await db.insert(agentKnowledgeSourcesTable)
      .values(unique.map((sourceId) => ({ agentId, sourceId })))
      .onConflictDoNothing();
  }
}

router.get("/agents", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const agents = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.userId, clerkId))
    .orderBy(agentsTable.createdAt);
  const sourceIdMap = await getKnowledgeSourceIdsByAgent(agents);
  res.json(ListAgentsResponse.parse(agents.map((a) => prepareAgentForResponse(a, sourceIdMap.get(a.id) ?? []))));
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
  // knowledgeSourceIds is an M:N association, not an agents column — extract before insert.
  const createSourceIds = Array.isArray(insertData["knowledgeSourceIds"])
    ? (insertData["knowledgeSourceIds"] as number[])
    : null;
  delete insertData["knowledgeSourceIds"];
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
  let createdSourceIds: number[] = [];
  if (createSourceIds) {
    await setAgentKnowledgeSources(agent.id, createSourceIds);
    createdSourceIds = Array.from(new Set(createSourceIds.filter((n) => Number.isInteger(n))));
  }
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
  res.status(201).json(GetAgentResponse.parse(prepareAgentForResponse(agent, createdSourceIds)));
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
  const sourceIdMap = await getKnowledgeSourceIdsByAgent([agent]);
  res.json(GetAgentResponse.parse(prepareAgentForResponse(agent, sourceIdMap.get(agent.id) ?? [])));
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
  // knowledgeSourceIds is an M:N association, not an agents column — extract before update.
  const updateSourceIds = Array.isArray(updateData["knowledgeSourceIds"])
    ? (updateData["knowledgeSourceIds"] as number[])
    : undefined;
  delete updateData["knowledgeSourceIds"];
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
  if (updateSourceIds !== undefined) {
    await setAgentKnowledgeSources(agent.id, updateSourceIds);
  }
  // Sync phone_numbers.agent_id when inbound phone number assignment changes
  if ("inboundPhoneNumberId" in parsed.data) {
    await db.update(phoneNumbersTable)
      .set({ agentId: null })
      .where(eq(phoneNumbersTable.agentId, agent.id));
    if (parsed.data.inboundPhoneNumberId && agent.userId) {
      await db.update(phoneNumbersTable)
        .set({ agentId: agent.id })
        .where(and(
          eq(phoneNumbersTable.id, parsed.data.inboundPhoneNumberId as number),
          eq(phoneNumbersTable.userId, agent.userId),
        ));
    }
  }
  const sourceIdMap = await getKnowledgeSourceIdsByAgent([agent]);
  res.json(UpdateAgentResponse.parse(prepareAgentForResponse(agent, sourceIdMap.get(agent.id) ?? [])));
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

  // Fetch all fact rows (current + superseded) to build chains, and episodes
  const [allFacts, allEpisodes] = await Promise.all([
    db.select().from(callerFactsTable)
      .where(and(eq(callerFactsTable.agentId, agentId), eq(callerFactsTable.phoneNumber, phoneNumber)))
      .orderBy(desc(callerFactsTable.createdAt)),
    db.select().from(callerCallArchiveTable)
      .where(and(eq(callerCallArchiveTable.agentId, agentId), eq(callerCallArchiveTable.phoneNumber, phoneNumber)))
      .orderBy(desc(callerCallArchiveTable.createdAt))
      .limit(20),
  ]);

  const allFactIds  = allFacts.map(f => f.id);
  const episodeIds  = allEpisodes.map(e => e.id);

  // Kick off all three queries in parallel (launch before any await)
  const sentencesP = episodeIds.length > 0
    ? db.select().from(callerSentencesTable)
        .where(inArray(callerSentencesTable.episodeId, episodeIds))
        .orderBy(callerSentencesTable.episodeId, callerSentencesTable.sequenceNum)
    : null;

  const [factSentenceLinks, episodeFactLinks] = await Promise.all([
    allFactIds.length > 0
      ? db.select({ factId: callerFactSentenceLinksTable.factId, sentenceId: callerFactSentenceLinksTable.sentenceId })
          .from(callerFactSentenceLinksTable)
          .where(inArray(callerFactSentenceLinksTable.factId, allFactIds))
      : Promise.resolve([] as Array<{ factId: number; sentenceId: number }>),
    episodeIds.length > 0
      ? db.select({ episodeId: callerEpisodeFactLinksTable.episodeId, factId: callerEpisodeFactLinksTable.factId })
          .from(callerEpisodeFactLinksTable)
          .where(inArray(callerEpisodeFactLinksTable.episodeId, episodeIds))
      : Promise.resolve([] as Array<{ episodeId: number; factId: number }>),
  ]);

  const sentences = sentencesP ? await sentencesP : [];

  // Build lookup maps from junction tables
  const sentenceIdsByFact = new Map<number, number[]>();
  for (const link of factSentenceLinks) {
    if (!sentenceIdsByFact.has(link.factId)) sentenceIdsByFact.set(link.factId, []);
    sentenceIdsByFact.get(link.factId)!.push(link.sentenceId);
  }

  const factIdsByEpisode = new Map<number, number[]>();
  for (const link of episodeFactLinks) {
    if (!factIdsByEpisode.has(link.episodeId)) factIdsByEpisode.set(link.episodeId, []);
    factIdsByEpisode.get(link.episodeId)!.push(link.factId);
  }

  const sentencesByEpisode = new Map<number, typeof sentences>();
  for (const s of sentences) {
    if (!sentencesByEpisode.has(s.episodeId)) sentencesByEpisode.set(s.episodeId, []);
    sentencesByEpisode.get(s.episodeId)!.push(s);
  }

  // Build supersession chains: predecessorMap[targetId] = facts superseded by targetId
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

  // Current (non-superseded) facts with history chains + fact_sources from junction table
  const currentFacts = allFacts
    .filter(f => f.supersededById === null)
    .map(f => ({
      id:                f.id,
      key:               f.key,
      value:             f.value,
      confidence:        f.confidence,
      sourceCallId:      f.sourceCallId,
      sourceSentenceIds: sentenceIdsByFact.get(f.id) ?? [],
      createdAt:         f.createdAt,
      history:           buildHistory(f.id),
    }));

  // Episodes with insight_facts from junction table + L2 sentences
  const episodes = allEpisodes.map(ep => ({
    id:              ep.id,
    callId:          ep.callId,
    summary:         ep.summary,
    durationSeconds: ep.durationSeconds,
    createdAt:       ep.createdAt,
    insightFactIds:  factIdsByEpisode.get(ep.id) ?? [],
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

// ── SnapServe Executions proxy ─────────────────────────────────────────────

router.get("/agents/:id/snapserve-executions", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const agentId = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }

  const [agent] = await db.select({ id: agentsTable.id, snapserveAgentId: agentsTable.snapserveAgentId })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkId)));

  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  if (!agent.snapserveAgentId) {
    res.status(404).json({ error: "SnapServe Agent ID not configured for this agent" });
    return;
  }

  const pageNumber = parseInt(String(req.query["page_number"] ?? "1"), 10) || 1;
  const pageSize   = parseInt(String(req.query["page_size"] ?? "20"), 10) || 20;

  // Find an active SnapServe provider key for this user
  const [snapserveProvider] = await db.select({ apiKey: providersTable.apiKey })
    .from(providersTable)
    .where(and(
      eq(providersTable.userId, clerkId),
      eq(providersTable.providerType, "orchestration"),
      eq(providersTable.providerName, "snapserve"),
      eq(providersTable.isActive, true),
    ))
    .limit(1);

  if (!snapserveProvider) {
    res.status(404).json({ error: "No active SnapServe API key found. Add one on the Providers page." });
    return;
  }

  const rawKey = decryptKey(snapserveProvider.apiKey);
  const snapserveUrl = `https://api.snapserve.ai/v2/agent/${agent.snapserveAgentId}/executions?page_number=${pageNumber}&page_size=${pageSize}`;

  let snapserveRes: Response;
  try {
    snapserveRes = await fetch(snapserveUrl, {
      headers: { "Authorization": `Bearer ${rawKey}`, "Content-Type": "application/json" },
    });
  } catch (err) {
    req.log.error({ err, snapserveUrl }, "SnapServe API fetch failed");
    res.status(502).json({ error: "Failed to reach SnapServe API", detail: String(err) });
    return;
  }

  const body = await snapserveRes.text().catch(() => "");
  if (!snapserveRes.ok) {
    req.log.warn({ status: snapserveRes.status, body }, "SnapServe API returned non-2xx");
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = { error: body || `SnapServe API error (HTTP ${snapserveRes.status})` }; }
    res.status(snapserveRes.status).json(parsed);
    return;
  }

  let data: unknown;
  try { data = JSON.parse(body); } catch { data = body; }
  res.json(data);
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
