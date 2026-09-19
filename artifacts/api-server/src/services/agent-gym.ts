/**
 * Agent gym — a customer-agent talks to the main agent (text, with interrupt tags),
 * scores the call, and can suggest prompt lessons. Nothing is applied until a human
 * approves. Campaign transcripts reuse the same scorecard.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  db,
  agentsTable,
  callsTable,
  platformSettingsTable,
  providersTable,
  simulationMessagesTable,
  simulationRunsTable,
  simulationTestCasesTable,
} from "@workspace/db";
import { decryptKey } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";
import { createLLMAdapter } from "../orchestration/adapters/llm/index.js";
import type { ConversationTurn, LLMAdapter } from "../orchestration/types.js";
import {
  GYM_PERSONAS,
  formatGymTranscript,
  gymScoreSystemPrompt,
  mergeGymPromptAddendum,
  parseScorecard,
  runGymConversation,
  scorecardUserPrompt,
  type GymPersona,
  type GymRunResultJson,
} from "./agent-gym-engine.js";

export {
  GYM_LESSONS_HEADING,
  GYM_PERSONAS,
  agentGymSystemPrompt,
  customerGymSystemPrompt,
  formatGymTranscript,
  mergeGymPromptAddendum,
  parseScorecard,
  runGymConversation,
  scorecardUserPrompt,
} from "./agent-gym-engine.js";
export type {
  GymChatFn,
  GymConversationResult,
  GymPersona,
  GymRunResultJson,
  GymRunSource,
  GymScorecard,
  GymTurn,
} from "./agent-gym-engine.js";

const MAX_CAMPAIGN_LEARN = 6;
const MIN_CAMPAIGN_TRANSCRIPT = 120;

export async function seedGymPersonas(agentId: number, userId: string): Promise<number> {
  const existing = await db
    .select({
      id: simulationTestCasesTable.id,
      name: simulationTestCasesTable.name,
      variables: simulationTestCasesTable.variables,
    })
    .from(simulationTestCasesTable)
    .where(eq(simulationTestCasesTable.agentId, agentId));
  const have = new Set<string>();
  for (const row of existing) {
    const vars = (row.variables ?? {}) as { personaId?: string };
    if (vars.personaId) have.add(vars.personaId);
    have.add(row.name);
  }
  let inserted = 0;
  for (const persona of GYM_PERSONAS) {
    if (have.has(persona.id) || have.has(persona.name)) continue;
    await db.insert(simulationTestCasesTable).values({
      agentId,
      userId,
      name: persona.name,
      personaPrompt: persona.personaPrompt,
      goal: persona.goal,
      successCriteria: persona.successCriteria,
      variables: { personaId: persona.id, interrupt: persona.interrupt, builtIn: true },
      maxTurns: persona.maxTurns,
    });
    inserted += 1;
  }
  return inserted;
}

async function chatOnce(llm: LLMAdapter, system: string, messages: ConversationTurn[]): Promise<string> {
  let full = "";
  await llm.chat(messages, system, () => {}, (text) => {
    full = text;
  });
  return (full || "").trim();
}

async function resolveGymLlm(agent: {
  userId: string | null;
  llmProvider: string;
  llmModel: string | null;
}): Promise<LLMAdapter | null> {
  let provider = agent.llmProvider;
  let model = agent.llmModel;
  let apiKey: string | null = null;
  if (agent.userId) {
    const rows = await db
      .select()
      .from(providersTable)
      .where(
        and(
          eq(providersTable.isActive, true),
          eq(providersTable.userId, agent.userId),
          eq(providersTable.providerName, agent.llmProvider),
        ),
      );
    if (rows[0]) {
      try {
        apiKey = decryptKey(rows[0].apiKey);
      } catch {
        apiKey = null;
      }
    }
  }
  if (!apiKey) {
    const [row] = await db
      .select()
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "managed_qwen_key"));
    apiKey = row?.value?.trim() || process.env["GROQ_API_KEY"] || null;
    if (apiKey) {
      provider = "groq";
      model = "llama-3.1-70b-versatile";
    }
  }
  if (!apiKey) return null;
  return createLLMAdapter(provider, apiKey, model);
}

function personaFromCase(row: {
  name: string;
  personaPrompt: string;
  goal: string;
  successCriteria: string[] | null;
  maxTurns: number | null;
  variables: unknown;
}): GymPersona {
  const vars = (row.variables ?? {}) as { personaId?: string; interrupt?: boolean };
  const builtIn = GYM_PERSONAS.find((p) => p.id === vars.personaId);
  return {
    id: vars.personaId || builtIn?.id || row.name,
    name: row.name,
    goal: row.goal,
    interrupt: vars.interrupt ?? builtIn?.interrupt ?? false,
    personaPrompt: row.personaPrompt,
    successCriteria: row.successCriteria?.length ? row.successCriteria : (builtIn?.successCriteria ?? []),
    maxTurns: row.maxTurns || builtIn?.maxTurns || 8,
  };
}

export async function listGymState(agentId: number, userId: string) {
  await seedGymPersonas(agentId, userId);
  const cases = await db
    .select()
    .from(simulationTestCasesTable)
    .where(eq(simulationTestCasesTable.agentId, agentId));
  const runs = await db
    .select()
    .from(simulationRunsTable)
    .where(eq(simulationRunsTable.agentId, agentId))
    .orderBy(desc(simulationRunsTable.createdAt))
    .limit(40);
  const personas = GYM_PERSONAS.map((p) => {
    const row = cases.find((c) => {
      const vars = (c.variables ?? {}) as { personaId?: string };
      return vars.personaId === p.id || c.name === p.name;
    });
    return {
      id: p.id,
      name: p.name,
      goal: p.goal,
      interrupt: p.interrupt,
      testCaseId: row?.id ?? null,
    };
  });
  return { personas, runs: runs.map(serializeRun), cases };
}

function serializeRun(row: typeof simulationRunsTable.$inferSelect) {
  const result = (row.result ?? {}) as Partial<GymRunResultJson>;
  const persona = GYM_PERSONAS.find((p) => p.id === result.personaId);
  return {
    id: row.id,
    status: row.status,
    score: row.score,
    testCaseId: row.testCaseId,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    source: result.source ?? "gym",
    personaId: result.personaId ?? null,
    personaName: persona?.name ?? null,
    suiteId: result.suiteId ?? null,
    interruptCount: result.interruptCount ?? 0,
    scores: result.scores ?? null,
    pass: result.pass ?? null,
    failures: result.failures ?? [],
    lessons: result.lessons ?? [],
    suggestedPromptAddendum: result.suggestedPromptAddendum ?? "",
    callId: result.callId ?? null,
    approvedAt: result.approvedAt ?? null,
  };
}

export async function runGymPersona(opts: {
  agentId: number;
  userId: string;
  personaId: string;
  suiteId?: string | null;
}) {
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, opts.agentId)).limit(1);
  if (!agent) throw new Error("Agent not found");
  await seedGymPersonas(opts.agentId, opts.userId);
  const cases = await db
    .select()
    .from(simulationTestCasesTable)
    .where(eq(simulationTestCasesTable.agentId, opts.agentId));
  const testCase = cases.find((c) => {
    const vars = (c.variables ?? {}) as { personaId?: string };
    return vars.personaId === opts.personaId || c.name === opts.personaId;
  });
  const builtIn = GYM_PERSONAS.find((p) => p.id === opts.personaId);
  if (!testCase && !builtIn) throw new Error("Unknown gym persona");
  const persona = testCase ? personaFromCase(testCase) : builtIn!;
  const llm = await resolveGymLlm(agent);
  if (!llm) throw new Error("No LLM key configured for this agent");

  const [run] = await db
    .insert(simulationRunsTable)
    .values({
      agentId: opts.agentId,
      testCaseId: testCase?.id ?? null,
      userId: opts.userId,
      status: "running",
      startedAt: new Date(),
      result: { source: "gym", personaId: persona.id, suiteId: opts.suiteId ?? null, interruptCount: 0 } satisfies Partial<GymRunResultJson>,
    })
    .returning();
  if (!run) throw new Error("Failed to create gym run");

  try {
    const convo = await runGymConversation({
      agentPrompt: agent.systemPrompt,
      greeting: agent.greetingMessage,
      persona,
      language: agent.language,
      chat: async ({ system, messages }) => chatOnce(llm, system, messages),
    });
    const transcript = formatGymTranscript(convo.turns);
    let scoreRaw = "";
    try {
      scoreRaw = await chatOnce(llm, gymScoreSystemPrompt(), [
        { role: "user", content: scorecardUserPrompt({ agentPrompt: agent.systemPrompt, transcript, persona }) },
      ]);
    } catch (scoreErr) {
      logger.warn({ scoreErr, runId: run.id }, "Gym scorecard LLM failed");
    }
    const scorecard = parseScorecard(scoreRaw || "{}");
    const result: GymRunResultJson = {
      source: "gym",
      personaId: persona.id,
      suiteId: opts.suiteId ?? null,
      interruptCount: convo.interruptCount,
      scores: scorecard.scores,
      pass: scorecard.pass,
      failures: scorecard.failures,
      lessons: scorecard.lessons,
      suggestedPromptAddendum: scorecard.suggestedPromptAddendum,
    };
    if (convo.turns.length > 0) {
      await db.insert(simulationMessagesTable).values(
        convo.turns.map((t) => ({
          simulationRunId: run.id,
          role: t.role,
          content: t.content,
          metadata: { interrupted: t.interrupted ?? false, speaker: t.role === "assistant" ? "agent" : "customer" },
        })),
      );
    }
    const [updated] = await db
      .update(simulationRunsTable)
      .set({
        status: "completed",
        score: scorecard.overall,
        result,
        completedAt: new Date(),
      })
      .where(eq(simulationRunsTable.id, run.id))
      .returning();
    if (!updated) throw new Error("Failed to save gym run");
    return serializeRun(updated);
  } catch (err) {
    await db
      .update(simulationRunsTable)
      .set({
        status: "failed",
        result: {
          source: "gym",
          personaId: persona.id,
          suiteId: opts.suiteId ?? null,
          interruptCount: 0,
          scores: null,
          pass: false,
          failures: [err instanceof Error ? err.message : "Gym run failed"],
          lessons: [],
          suggestedPromptAddendum: "",
        } satisfies GymRunResultJson,
        completedAt: new Date(),
      })
      .where(eq(simulationRunsTable.id, run.id));
    throw err;
  }
}

export async function getGymRun(agentId: number, runId: number) {
  const [run] = await db
    .select()
    .from(simulationRunsTable)
    .where(and(eq(simulationRunsTable.id, runId), eq(simulationRunsTable.agentId, agentId)))
    .limit(1);
  if (!run) return null;
  const messages = await db
    .select()
    .from(simulationMessagesTable)
    .where(eq(simulationMessagesTable.simulationRunId, runId))
    .orderBy(asc(simulationMessagesTable.id));
  return { run: serializeRun(run), messages };
}

export async function learnFromCampaignCalls(opts: { agentId: number; userId: string }) {
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, opts.agentId)).limit(1);
  if (!agent) throw new Error("Agent not found");
  const llm = await resolveGymLlm(agent);
  if (!llm) throw new Error("No LLM key configured for this agent");

  const prior = await db
    .select({ result: simulationRunsTable.result })
    .from(simulationRunsTable)
    .where(eq(simulationRunsTable.agentId, opts.agentId));
  const seen = new Set<number>();
  for (const row of prior) {
    const callId = (row.result as Partial<GymRunResultJson> | null)?.callId;
    if (typeof callId === "number") seen.add(callId);
  }

  const calls = await db
    .select({
      id: callsTable.id,
      transcript: callsTable.transcript,
    })
    .from(callsTable)
    .where(
      and(
        eq(callsTable.agentId, opts.agentId),
        sql`coalesce(${callsTable.transcript}, '') <> ''`,
        sql`length(${callsTable.transcript}) >= ${MIN_CAMPAIGN_TRANSCRIPT}`,
      ),
    )
    .orderBy(desc(callsTable.id))
    .limit(20);

  const fresh = calls.filter((c) => c.transcript && !seen.has(c.id)).slice(0, MAX_CAMPAIGN_LEARN);
  const scored = [];
  for (const call of fresh) {
    const transcript = call.transcript!.slice(0, 8000);
    let scoreRaw = "";
    try {
      scoreRaw = await chatOnce(llm, gymScoreSystemPrompt(), [
        { role: "user", content: scorecardUserPrompt({ agentPrompt: agent.systemPrompt, transcript }) },
      ]);
    } catch (scoreErr) {
      logger.warn({ scoreErr, callId: call.id }, "Campaign gym score failed");
      continue;
    }
    const scorecard = parseScorecard(scoreRaw);
    const result: GymRunResultJson = {
      source: "campaign",
      personaId: null,
      suiteId: null,
      interruptCount: 0,
      scores: scorecard.scores,
      pass: scorecard.pass,
      failures: scorecard.failures,
      lessons: scorecard.lessons,
      suggestedPromptAddendum: scorecard.suggestedPromptAddendum,
      callId: call.id,
    };
    const [run] = await db
      .insert(simulationRunsTable)
      .values({
        agentId: opts.agentId,
        testCaseId: null,
        userId: opts.userId,
        status: "completed",
        score: scorecard.overall,
        result,
        startedAt: new Date(),
        completedAt: new Date(),
      })
      .returning();
    if (!run) continue;
    await db.insert(simulationMessagesTable).values({
      simulationRunId: run.id,
      role: "user",
      content: transcript,
      metadata: { source: "campaign", callId: call.id },
    });
    scored.push(serializeRun(run));
  }
  return { scored: scored.length, skipped: seen.size, runs: scored };
}

export async function applyGymLesson(opts: { agentId: number; runId: number }) {
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, opts.agentId)).limit(1);
  if (!agent) throw new Error("Agent not found");
  const [run] = await db
    .select()
    .from(simulationRunsTable)
    .where(and(eq(simulationRunsTable.id, opts.runId), eq(simulationRunsTable.agentId, opts.agentId)))
    .limit(1);
  if (!run) throw new Error("Gym run not found");
  const result = (run.result ?? {}) as GymRunResultJson;
  const addendum = (result.suggestedPromptAddendum || "").trim();
  if (!addendum) throw new Error("This run has no prompt suggestion to apply");
  const merged = mergeGymPromptAddendum(agent.systemPrompt, addendum);
  if (!merged.applied) {
    return { systemPrompt: agent.systemPrompt, applied: false, run: serializeRun(run) };
  }
  const [updated] = await db
    .update(agentsTable)
    .set({ systemPrompt: merged.next, updatedAt: new Date() })
    .where(eq(agentsTable.id, opts.agentId))
    .returning();
  const nextResult: GymRunResultJson = { ...result, approvedAt: new Date().toISOString() };
  const [updatedRun] = await db
    .update(simulationRunsTable)
    .set({ result: nextResult })
    .where(eq(simulationRunsTable.id, run.id))
    .returning();
  if (!updated || !updatedRun) throw new Error("Failed to apply gym lesson");
  return { systemPrompt: updated.systemPrompt, applied: true, run: serializeRun(updatedRun) };
}
