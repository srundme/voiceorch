import { db, platformSettingsTable, agentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { simulationRunsTable, simulationMessagesTable } from "@workspace/db";
import { logger } from "../../lib/logger.js";

async function getManagedLlmKey(): Promise<string | null> {
  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "managed_qwen_key"));
    if (row?.value) return row.value;
  } catch {
    // fall through
  }
  return (process.env["GROQ_API_KEY"] ?? "").trim() || null;
}

export interface ScoreMetric {
  name: string;
  score: number;
  maxScore: number;
  notes: string;
}

export interface RunScore {
  overall: number;
  pass: boolean;
  metrics: ScoreMetric[];
  summary: string;
}

function buildFallback(reason: string): RunScore {
  return {
    overall: 50,
    pass: false,
    metrics: [
      { name: "Conversation Quality",   score: 8,  maxScore: 20, notes: reason },
      { name: "Qualification Accuracy", score: 8,  maxScore: 20, notes: reason },
      { name: "Tool Usage Accuracy",    score: 8,  maxScore: 20, notes: reason },
      { name: "Knowledge Accuracy",     score: 8,  maxScore: 20, notes: reason },
      { name: "Goal Completion",        score: 10, maxScore: 20, notes: reason },
      { name: "Prompt Compliance",      score: 8,  maxScore: 20, notes: reason },
    ],
    summary: `Evaluation unavailable — ${reason}`,
  };
}

/**
 * Score a completed simulation run using the managed LLM.
 * Reads messages from DB, sends to LLM for evaluation, stores result.
 * 6 metrics × 20 pts = 120 max; overall is normalised to 0-100.
 */
export async function scoreRun(runId: number, successCriteria: string[]): Promise<RunScore> {
  const messages = await db
    .select()
    .from(simulationMessagesTable)
    .where(eq(simulationMessagesTable.simulationRunId, runId))
    .orderBy(simulationMessagesTable.createdAt);

  // Fetch agent system prompt for Prompt Compliance evaluation
  let agentSystemPrompt = "";
  try {
    const [run] = await db
      .select({ agentId: simulationRunsTable.agentId })
      .from(simulationRunsTable)
      .where(eq(simulationRunsTable.id, runId));
    if (run) {
      const [agent] = await db
        .select({ systemPrompt: agentsTable.systemPrompt })
        .from(agentsTable)
        .where(eq(agentsTable.id, run.agentId));
      agentSystemPrompt = agent?.systemPrompt ?? "";
    }
  } catch {
    // non-fatal — Prompt Compliance will be scored without the system prompt
  }

  const transcript = messages
    .filter((m) => m.role === "user" || m.role === "agent")
    .map((m) => `${m.role === "user" ? "CUSTOMER" : "AGENT"}: ${m.content}`)
    .join("\n");

  const fallbackScore = buildFallback("managed LLM key not configured");

  const key = await getManagedLlmKey();
  if (!key) {
    await db
      .update(simulationRunsTable)
      .set({ score: fallbackScore.overall, result: fallbackScore as any, status: "completed", completedAt: new Date() })
      .where(eq(simulationRunsTable.id, runId));
    return fallbackScore;
  }

  const criteriaBlock =
    successCriteria.length > 0
      ? `Success Criteria:\n${successCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
      : "No explicit success criteria defined. Evaluate on overall conversation quality.";

  const systemPromptBlock = agentSystemPrompt
    ? `AGENT SYSTEM PROMPT (what the agent was instructed to do):\n${agentSystemPrompt.slice(0, 1200)}`
    : "Agent system prompt not available.";

  const prompt = `You are a quality evaluator for AI voice agent test conversations. Evaluate the following transcript against the given success criteria.

${criteriaBlock}

${systemPromptBlock}

CONVERSATION TRANSCRIPT:
${transcript}

Score the agent on these 6 metrics (0-20 each, total 0-120, normalised to 0-100):
1. Conversation Quality — clarity, empathy, natural conversational flow
2. Qualification Accuracy — correctly identified customer needs and situation
3. Tool Usage Accuracy — used available tools (booking, availability check, etc.) correctly and only when needed
4. Knowledge Accuracy — provided accurate, relevant information
5. Goal Completion — successfully fulfilled the customer's stated goal
6. Prompt Compliance — followed the agent system prompt instructions (persona, tone, restrictions)

Compute overall as: Math.round((sum_of_6_scores / 120) * 100)
Pass = overall >= 70

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "overall": <0-100>,
  "pass": <true if overall >= 70>,
  "summary": "<2-3 sentence overall evaluation>",
  "metrics": [
    {"name":"Conversation Quality","score":<0-20>,"maxScore":20,"notes":"<brief>"},
    {"name":"Qualification Accuracy","score":<0-20>,"maxScore":20,"notes":"<brief>"},
    {"name":"Tool Usage Accuracy","score":<0-20>,"maxScore":20,"notes":"<brief>"},
    {"name":"Knowledge Accuracy","score":<0-20>,"maxScore":20,"notes":"<brief>"},
    {"name":"Goal Completion","score":<0-20>,"maxScore":20,"notes":"<brief>"},
    {"name":"Prompt Compliance","score":<0-20>,"maxScore":20,"notes":"<brief>"}
  ]
}`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen/qwen3-32b",
        temperature: 0.2,
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const fb = buildFallback("LLM API error");
      await db
        .update(simulationRunsTable)
        .set({ score: fb.overall, result: fb as any, status: "completed", completedAt: new Date() })
        .where(eq(simulationRunsTable.id, runId));
      logger.warn({ status: response.status }, "scoreRun: LLM API error, using fallback");
      return fb;
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content ?? "";
    const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();

    const scored = JSON.parse(cleaned) as RunScore;

    // Normalise: recalculate overall from metric sum in case LLM didn't
    const metricSum = (scored.metrics ?? []).reduce((s, m) => s + (m.score ?? 0), 0);
    if (scored.metrics?.length === 6 && metricSum > 0) {
      scored.overall = Math.min(100, Math.max(0, Math.round((metricSum / 120) * 100)));
    } else {
      scored.overall = Math.min(100, Math.max(0, scored.overall ?? 50));
    }
    scored.pass = scored.overall >= 70;

    await db
      .update(simulationRunsTable)
      .set({ score: scored.overall, result: scored as any, status: "completed", completedAt: new Date() })
      .where(eq(simulationRunsTable.id, runId));

    logger.info({ runId, overall: scored.overall, pass: scored.pass }, "scoreRun: completed");
    return scored;
  } catch (err) {
    const fb = buildFallback("evaluation failed");
    logger.error({ runId, err }, "scoreRun: evaluation failed, using fallback");
    await db
      .update(simulationRunsTable)
      .set({ score: fb.overall, result: fb as any, status: "completed", completedAt: new Date() })
      .where(eq(simulationRunsTable.id, runId));
    return fb;
  }
}
