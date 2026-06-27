// agents router — supports call_transfer + webhook (custom function) tools + AMD voicemail detection
import { Router, type IRouter } from "express";
import { eq, and, count, desc, asc, isNull, inArray, max } from "drizzle-orm";
import { db, agentsTable, agentVersionsTable, schedulingCalendarsTable, callerProfilesTable, callerFactsTable, callerCallArchiveTable, callerSentencesTable, callerFactSentenceLinksTable, callerEpisodeFactLinksTable, providersTable, agentKnowledgeSourcesTable, phoneNumbersTable, callsTable, executionLogsTable, type AgentConfig } from "@workspace/db";
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
  ListAgentMemorySummariesResponse,
  ListAgentMemoryFactsResponse,
  ListAgentMemoryEpisodesResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logActivity } from "../lib/activity.js";
import { encryptKey, decryptKey } from "../lib/crypto.js";
import {
  getActiveTemplate,
  generateAgentPrompt,
  type WizardInputs,
} from "../services/prompt-template.js";
import { sanitizeToolName } from "../services/tool-executor.js";
import { checkIrdaiCompliance } from "../services/irdai/index.js";

const router: IRouter = Router();

/**
 * Auto-normalize every tool's LLM-facing `name` to a provider-safe function name
 * before it is persisted, so invalid names (spaces, non-ASCII, etc.) can't be
 * silently stored and later rejected by Gemini at call time. Runtime
 * sanitization covers legacy rows; this keeps newly saved data clean too.
 */
function normalizeToolNames(data: Record<string, unknown>): void {
  const tools = data["tools"];
  if (!Array.isArray(tools)) return;
  data["tools"] = tools.map((t) => {
    if (t && typeof t === "object" && typeof (t as Record<string, unknown>)["name"] === "string") {
      const tool = t as Record<string, unknown>;
      return { ...tool, name: sanitizeToolName(tool["name"] as string) };
    }
    return t;
  });
}

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
  if (parsed.data.webhookUrl && !parsed.data.webhookUrl.startsWith("https://")) {
    res.status(400).json({ error: "webhookUrl must be a valid https:// URL" });
    return;
  }
  // wizardInputs is an admin-managed pass-through (not in DB schema strict type)
  const rawBody = (req.body ?? {}) as Record<string, unknown>;
  const wizardInputs = (rawBody["wizardInputs"] ?? null) as WizardInputs | null;

  const insertData: Record<string, unknown> = { ...parsed.data, userId: clerkId };
  normalizeToolNames(insertData);
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

  // Guard: these columns are NOT NULL with no DB default — a missing value
  // would produce a cryptic Postgres error instead of a clear 400.
  const REQUIRED_FIELDS = ["asrProvider", "llmProvider", "ttsProvider", "telephonyProvider", "systemPrompt"] as const;
  const missingFields = REQUIRED_FIELDS.filter((f) => !insertData[f]);
  if (missingFields.length > 0) {
    req.log.warn({ missingFields, body: req.body }, "Agent create missing required fields");
    res.status(400).json({ error: `Missing required fields: ${missingFields.join(", ")}` });
    return;
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
  if (parsed.data.webhookUrl && !parsed.data.webhookUrl.startsWith("https://")) {
    res.status(400).json({ error: "webhookUrl must be a valid https:// URL" });
    return;
  }
  const updateData: Record<string, unknown> = { ...parsed.data };
  normalizeToolNames(updateData);
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
      .select({ agentConfig: agentsTable.agentConfig, systemPrompt: agentsTable.systemPrompt })
      .from(agentsTable)
      .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.userId, clerkId)));
    if (existing) {
      const merged: AgentConfig = {
        ...(existing.agentConfig as AgentConfig ?? {}),
        ...(updateData.agentConfig as AgentConfig),
      };
      // IRDAI advisory prompt check (informational only — never blocks the save).
      // When IRDAI is enabled, statically analyze the resulting system prompt
      // against the IRDAI disclosure checklist and persist the result. When
      // disabled, clear the status so the banner does not show.
      if (merged.compliance?.irdai === true) {
        const promptText = (updateData.systemPrompt as string | undefined) ?? existing.systemPrompt ?? "";
        merged.irdaiComplianceStatus = checkIrdaiCompliance(promptText);
      } else {
        delete merged.irdaiComplianceStatus;
      }
      updateData.agentConfig = merged;
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

  // Fire-and-forget: auto-save a draft snapshot after every successful PATCH.
  // Failures must never surface to the user or affect the save result.
  void (async () => {
    try {
      const DRAFT_LIMIT = 100;
      const DRAFT_TRACKED_FIELDS: Array<{ keys: string[]; label: string }> = [
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

      // Detect changes vs. the latest snapshot (any type)
      const [latestVersion] = await db
        .select()
        .from(agentVersionsTable)
        .where(eq(agentVersionsTable.agentId, agent.id))
        .orderBy(desc(agentVersionsTable.createdAt))
        .limit(1);

      const prevSnap = latestVersion ? (latestVersion.snapshot as Record<string, unknown>) : {};
      const curSnap: Record<string, unknown> = { ...agent };
      const changedLabels: string[] = [];
      for (const { keys, label } of DRAFT_TRACKED_FIELDS) {
        for (const key of keys) {
          if (JSON.stringify(prevSnap[key] ?? null) !== JSON.stringify(curSnap[key] ?? null)) {
            changedLabels.push(label);
            break;
          }
        }
      }
      const changeSummary = changedLabels.length === 0
        ? "Saved"
        : changedLabels.length === 1
          ? changedLabels[0]!
          : "Multiple Changes";

      // Sequential draft number across all versions
      const [{ totalCnt }] = await db
        .select({ totalCnt: count() })
        .from(agentVersionsTable)
        .where(eq(agentVersionsTable.agentId, agent.id));
      const draftNumber = Number(totalCnt) + 1;

      await db
        .insert(agentVersionsTable)
        .values({
          agentId: agent.id,
          userId: clerkId,
          versionNumber: `draft-${draftNumber}`,
          versionName: changeSummary,
          commitDescription: "Auto-saved draft",
          status: "draft",
          snapshotType: "draft",
          snapshot: curSnap,
          changedFields: changedLabels.length > 0 ? changedLabels : null,
          publishedBy: null,
        });

      // Enforce 100-draft retention: delete oldest drafts beyond the limit
      const draftRows = await db
        .select({ id: agentVersionsTable.id })
        .from(agentVersionsTable)
        .where(and(
          eq(agentVersionsTable.agentId, agent.id),
          eq(agentVersionsTable.snapshotType, "draft"),
        ))
        .orderBy(asc(agentVersionsTable.createdAt));

      if (draftRows.length > DRAFT_LIMIT) {
        const toDelete = draftRows.slice(0, draftRows.length - DRAFT_LIMIT).map(r => r.id);
        await db
          .delete(agentVersionsTable)
          .where(inArray(agentVersionsTable.id, toDelete));
      }
    } catch (err) {
      req.log.warn({ err }, "auto-draft snapshot failed (non-fatal)");
    }
  })();
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

// ── Agent Memory (CRM) endpoints ───────────────────────────────────────────
// Read-only aggregations that roll the per-caller memory tables up to the agent
// level. No new tables, no writes — purely a different lens on existing data.

// Per-agent rolled-up memory stats for all of the user's agents (single request,
// no N+1). Returns one row per agent, zeroed when an agent has no memory yet.
router.get("/agents/memory/summary", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;

  const agents = await db
    .select({ id: agentsTable.id, name: agentsTable.name, createdAt: agentsTable.createdAt })
    .from(agentsTable)
    .where(eq(agentsTable.userId, clerkId))
    .orderBy(desc(agentsTable.createdAt));

  const ids = agents.map(a => a.id);
  if (ids.length === 0) { res.json(ListAgentMemorySummariesResponse.parse([])); return; }

  const [callStats, factStats, episodeStats] = await Promise.all([
    db.select({
        agentId: callsTable.agentId,
        cnt:     count(),
        lastAt:  max(callsTable.createdAt),
      })
      .from(callsTable)
      .where(inArray(callsTable.agentId, ids))
      .groupBy(callsTable.agentId),
    db.select({ agentId: callerFactsTable.agentId, cnt: count() })
      .from(callerFactsTable)
      .where(and(inArray(callerFactsTable.agentId, ids), isNull(callerFactsTable.supersededById)))
      .groupBy(callerFactsTable.agentId),
    db.select({ agentId: callerCallArchiveTable.agentId, cnt: count() })
      .from(callerCallArchiveTable)
      .where(inArray(callerCallArchiveTable.agentId, ids))
      .groupBy(callerCallArchiveTable.agentId),
  ]);

  const callMap    = new Map(callStats.map(r => [r.agentId, r]));
  const factMap    = new Map(factStats.map(r => [r.agentId, r.cnt]));
  const episodeMap = new Map(episodeStats.map(r => [r.agentId, r.cnt]));

  const summaries = agents.map(a => {
    const calls = callMap.get(a.id);
    const lastAt = calls?.lastAt ?? null;
    return {
      agentId:       a.id,
      agentName:     a.name,
      totalCalls:    calls?.cnt ?? 0,
      totalFacts:    factMap.get(a.id) ?? 0,
      totalEpisodes: episodeMap.get(a.id) ?? 0,
      lastActiveAt:  lastAt ? new Date(lastAt).toISOString() : null,
      createdAt:     a.createdAt.toISOString(),
    };
  });

  res.json(ListAgentMemorySummariesResponse.parse(summaries));
});

// All current (non-superseded) facts across every conversation an agent handled
router.get("/agents/:id/memory/facts", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const agentId = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }

  const [agent] = await db.select({ id: agentsTable.id })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkId)));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  const facts = await db.select()
    .from(callerFactsTable)
    .where(and(eq(callerFactsTable.agentId, agentId), isNull(callerFactsTable.supersededById)))
    .orderBy(desc(callerFactsTable.createdAt));

  res.json(ListAgentMemoryFactsResponse.parse(facts.map(f => ({
    id:          f.id,
    key:         f.key,
    value:       f.value,
    confidence:  f.confidence,
    phoneNumber: f.phoneNumber,
    createdAt:   f.createdAt.toISOString(),
  }))));
});

// All conversation episodes for an agent, newest first (timeline source)
router.get("/agents/:id/memory/episodes", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const agentId = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }

  const [agent] = await db.select({ id: agentsTable.id })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkId)));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  const episodes = await db.select({
      id:              callerCallArchiveTable.id,
      callId:          callerCallArchiveTable.callId,
      summary:         callerCallArchiveTable.summary,
      durationSeconds: callerCallArchiveTable.durationSeconds,
      createdAt:       callerCallArchiveTable.createdAt,
    })
    .from(callerCallArchiveTable)
    .where(eq(callerCallArchiveTable.agentId, agentId))
    .orderBy(desc(callerCallArchiveTable.createdAt));

  res.json(ListAgentMemoryEpisodesResponse.parse(episodes.map(e => ({
    id:              e.id,
    callId:          e.callId,
    summary:         e.summary,
    durationSeconds: e.durationSeconds,
    createdAt:       e.createdAt.toISOString(),
  }))));
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

  /** Fact keys that the memory system commonly stores caller names under. */
  const NAME_FACT_KEYS = [
    "name", "full_name", "customer_name", "caller_name",
    "contact_name", "first_name", "client_name", "user_name",
  ];

  const [profiles, factCounts, archiveCounts, nameFacts] = await Promise.all([
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
    // Bulk-fetch name-type facts so we can show caller names even when the
    // caller profile's name field is null (e.g. the call dropped before name
    // extraction ran). Only unsuperseded (current) facts are included.
    db.select({ phoneNumber: callerFactsTable.phoneNumber, value: callerFactsTable.value })
      .from(callerFactsTable)
      .where(and(
        eq(callerFactsTable.agentId, agentId),
        isNull(callerFactsTable.supersededById),
        inArray(callerFactsTable.key, NAME_FACT_KEYS),
      ))
      .orderBy(desc(callerFactsTable.createdAt)),
  ]);

  const factMap    = new Map(factCounts.map(r => [r.phoneNumber, r.cnt]));
  const archiveMap = new Map(archiveCounts.map(r => [r.phoneNumber, r.cnt]));
  // First name fact per caller wins (already ordered newest-first).
  const nameFactMap = new Map<string, string>();
  for (const f of nameFacts) {
    if (!nameFactMap.has(f.phoneNumber) && f.value) nameFactMap.set(f.phoneNumber, f.value);
  }

  res.json(profiles.map(p => ({
    phoneNumber:     p.phoneNumber,
    // Profile name takes precedence; fall back to any extracted name fact.
    name:            p.name ?? nameFactMap.get(p.phoneNumber) ?? null,
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

/* ── GET /agents/:id/latency-stats ─────────────────────────────────────────── */
router.get("/agents/:id/latency-stats", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const agentId = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }

  const [agent] = await db.select({ id: agentsTable.id })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkId)));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  const recentCalls = await db.select({ id: callsTable.id })
    .from(callsTable)
    .where(eq(callsTable.agentId, agentId))
    .orderBy(desc(callsTable.createdAt))
    .limit(20);

  if (recentCalls.length === 0) {
    res.json({ callCount: 0, sttMs: null, ttftMs: null, ttsMs: null, e2eMs: null });
    return;
  }

  const callIds = recentCalls.map(c => c.id);
  const rows = await db.select()
    .from(executionLogsTable)
    .where(and(
      inArray(executionLogsTable.callId, callIds),
      inArray(executionLogsTable.component, ["STT", "LLM", "TTS"]),
    ));

  const sttVals: number[] = [];
  const ttftVals: number[] = [];
  const ttsVals: number[] = [];

  for (const row of rows) {
    const rp = row.responsePayload as Record<string, unknown> | null;
    const meta = row.metadata as Record<string, unknown> | null;

    if (row.component === "STT" && row.direction === "response" && row.status === "success") {
      const v = rp?.["endDetectToFinalMs"];
      if (typeof v === "number") sttVals.push(v);
    }
    if (row.component === "LLM" && meta?.["event"] === "First Token Received") {
      const v = meta?.["ttftMs"];
      if (typeof v === "number") ttftVals.push(v);
    }
    if (row.component === "TTS" && row.direction === "response" && row.status === "success") {
      const fb = rp?.["firstByteMs"];
      const textLen = rp?.["textLength"];
      // Skip filler phrases (very short text — "ஆமா...", "ம்ம்ம்..." etc.)
      if (typeof fb === "number" && typeof textLen === "number" && textLen > 20) {
        ttsVals.push(fb);
      }
    }
  }

  const avg = (arr: number[]) =>
    arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

  const sttMs  = avg(sttVals);
  const ttftMs = avg(ttftVals);
  const ttsMs  = avg(ttsVals);
  // Dispatch overhead (STT→LLM processing) is ~100ms fixed — not separately logged
  const DISPATCH_MS = 100;
  const e2eMs = (sttMs !== null && ttftMs !== null && ttsMs !== null)
    ? sttMs + DISPATCH_MS + ttftMs + ttsMs
    : null;

  res.json({ callCount: recentCalls.length, sttMs, ttftMs, ttsMs, e2eMs });
});

export default router;
