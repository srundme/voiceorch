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

export interface CriterionScore {
  criterion: string;
  score: number;
  maxScore: number;
  reason: string;
}

export interface RunScore {
  overall: number | null;
  pass: boolean;
  metrics: ScoreMetric[];
  summary: string;
  criteriaScores?: CriterionScore[];
  criteriaSource?: "user_defined" | "auto_generated" | "replaced_mismatch";
  evaluationError?: boolean;
  evaluationErrorReason?: string;
  evaluatorPrompt?: string;
  rawEvaluatorResponse?: string;
}

function buildErrorResult(reason: string, evaluatorPrompt?: string, rawResponse?: string): RunScore {
  return {
    overall: null,
    pass: false,
    metrics: [],
    summary: `Evaluation error — ${reason}`,
    evaluationError: true,
    evaluationErrorReason: reason,
    ...(evaluatorPrompt ? { evaluatorPrompt } : {}),
    ...(rawResponse ? { rawEvaluatorResponse: rawResponse } : {}),
  };
}

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

async function persistError(runId: number, result: RunScore): Promise<void> {
  await db
    .update(simulationRunsTable)
    .set({ score: null, result: result as any, status: "evaluation_error", completedAt: new Date() })
    .where(eq(simulationRunsTable.id, runId));
}

/**
 * Derive evaluation criteria appropriate to the agent's role.
 *
 * - If existingCriteria is non-empty and a system prompt is available, ask the
 *   LLM whether the stored criteria match the agent's domain. If clearly
 *   mismatched, auto-generate replacements.
 * - If existingCriteria is empty and a system prompt is available, always
 *   auto-generate 3-4 criteria.
 * - If no system prompt, fall through to whatever was passed in.
 */
async function deriveAgentCriteria(
  agentSystemPrompt: string,
  existingCriteria: string[],
  llmKey: string,
): Promise<{ criteria: string[]; source: "user_defined" | "auto_generated" | "replaced_mismatch" }> {
  if (!agentSystemPrompt.trim()) {
    return { criteria: existingCriteria, source: "user_defined" };
  }

  const promptSnippet = agentSystemPrompt.slice(0, 600);

  if (existingCriteria.length === 0) {
    // Always generate when no criteria defined
    const generated = await callCriteriaLlm(promptSnippet, null, llmKey);
    if (generated) return { criteria: generated, source: "auto_generated" };
    return { criteria: existingCriteria, source: "user_defined" };
  }

  // Check if existing criteria match the agent's domain
  const checkPrompt = `Agent system prompt (excerpt):
"${promptSnippet}"

Stored evaluation criteria:
${existingCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Do these criteria match the agent's actual role and domain? Reply with ONLY valid JSON: {"match": true} or {"match": false, "generated": ["<criterion 1>", "<criterion 2>", "<criterion 3>"]}
Generate 3-4 concise, relevant criteria if not a match. No markdown, no extra text.`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${llmKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen/qwen3-32b",
        temperature: 0.1,
        max_tokens: 300,
        messages: [{ role: "user", content: checkPrompt }],
      }),
    });

    if (!response.ok) return { criteria: existingCriteria, source: "user_defined" };

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = stripThinkTags(data.choices?.[0]?.message?.content ?? "")
      .replace(/```json\n?|\n?```/g, "")
      .trim();

    const parsed = JSON.parse(raw) as { match: boolean; generated?: string[] };
    if (parsed.match === false && Array.isArray(parsed.generated) && parsed.generated.length > 0) {
      return { criteria: parsed.generated, source: "replaced_mismatch" };
    }
    return { criteria: existingCriteria, source: "user_defined" };
  } catch {
    return { criteria: existingCriteria, source: "user_defined" };
  }
}

async function callCriteriaLlm(promptSnippet: string, _hint: null, llmKey: string): Promise<string[] | null> {
  const genPrompt = `Agent system prompt (excerpt):
"${promptSnippet}"

Generate 3-4 concise, measurable evaluation criteria for testing this agent's performance. Each criterion should be a single short sentence. Reply ONLY with valid JSON array of strings, no markdown, no extra text. Example: ["Criterion one", "Criterion two", "Criterion three"]`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${llmKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen/qwen3-32b",
        temperature: 0.2,
        max_tokens: 250,
        messages: [{ role: "user", content: genPrompt }],
      }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = stripThinkTags(data.choices?.[0]?.message?.content ?? "")
      .replace(/```json\n?|\n?```/g, "")
      .trim();
    const parsed = JSON.parse(raw) as string[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * Score a completed simulation run using the managed LLM.
 * Reads messages from DB, sends to LLM for evaluation, stores result.
 * 6 metrics × 20 pts = 120 max; overall is normalised to 0-100.
 * Success criteria are scored individually (0-10 each, additive detail).
 */
export async function scoreRun(runId: number, successCriteria: string[]): Promise<RunScore> {
  const messages = await db
    .select()
    .from(simulationMessagesTable)
    .where(eq(simulationMessagesTable.simulationRunId, runId))
    .orderBy(simulationMessagesTable.createdAt);

  // Pre-flight: empty conversation
  if (messages.length === 0) {
    const result = buildErrorResult("No messages found in this run — the conversation did not start");
    await persistError(runId, result);
    logger.warn({ runId }, "scoreRun: no messages, skipping evaluation");
    return result;
  }

  const agentMessages = messages.filter((m) => m.role === "agent");
  if (agentMessages.length === 0) {
    const result: RunScore = {
      overall: null,
      pass: false,
      metrics: [],
      summary: "Conversation ended before the agent replied — nothing to evaluate.",
    };
    await db
      .update(simulationRunsTable)
      .set({ score: null, result: result as any, status: "completed", completedAt: new Date() })
      .where(eq(simulationRunsTable.id, runId));
    logger.warn({ runId }, "scoreRun: no agent messages, marking completed with note");
    return result;
  }

  // Fetch agent system prompt for Prompt Compliance evaluation and criteria derivation
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

  // Build transcript with tool call evidence
  const transcript = messages
    .filter((m) => m.role === "user" || m.role === "agent")
    .map((m) => {
      const prefix = m.role === "user" ? "CUSTOMER" : "AGENT";
      let line = `${prefix}: ${m.content}`;
      if (m.role === "agent") {
        const meta = m.metadata as { toolsCalled?: Array<{ name: string; args?: unknown; result?: string }> } | null;
        const tools = meta?.toolsCalled;
        if (tools && tools.length > 0) {
          const toolSummary = tools
            .map((t) => {
              const argStr = t.args ? JSON.stringify(t.args).slice(0, 200) : "{}";
              const resultStr = t.result ? ` → ${t.result.slice(0, 150)}` : "";
              return `  • ${t.name}(${argStr})${resultStr}`;
            })
            .join("\n");
          line += `\n[Tools called:\n${toolSummary}\n]`;
        }
      }
      return line;
    })
    .join("\n");

  const key = await getManagedLlmKey();
  if (!key) {
    const result = buildErrorResult("managed LLM key not configured");
    await persistError(runId, result);
    return result;
  }

  // Derive appropriate criteria (may replace mismatched stored criteria or auto-generate)
  const { criteria: effectiveCriteria, source: criteriaSource } = await deriveAgentCriteria(
    agentSystemPrompt,
    successCriteria,
    key,
  );

  logger.info({ runId, criteriaSource, criteriaCount: effectiveCriteria.length }, "scoreRun: criteria derived");

  const criteriaBlock =
    effectiveCriteria.length > 0
      ? `SUCCESS CRITERIA (score each 0–10 separately in criteriaScores):\n${effectiveCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
      : "No explicit success criteria defined. Evaluate on overall conversation quality.";

  const systemPromptBlock = agentSystemPrompt
    ? `AGENT SYSTEM PROMPT (what the agent was instructed to do):\n${agentSystemPrompt.slice(0, 1200)}`
    : "Agent system prompt not available.";

  const criteriaScoresSchema =
    effectiveCriteria.length > 0
      ? `  "criteriaScores": [
    ${effectiveCriteria.map((c) => `{"criterion":${JSON.stringify(c)},"score":<0-10>,"maxScore":10,"reason":"<brief>"}`).join(",\n    ")}
  ],`
      : `  "criteriaScores": [],`;

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

Also score each criterion individually (0-10 each) in criteriaScores.

Respond ONLY with valid JSON (no markdown, no code fences, no <think> blocks):
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
  ],
${criteriaScoresSchema}
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
        max_tokens: 1800,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "unknown error");
      const result = buildErrorResult(`LLM API error (HTTP ${response.status}): ${errText.slice(0, 200)}`, prompt);
      await persistError(runId, result);
      logger.warn({ status: response.status, runId }, "scoreRun: LLM API error");
      return result;
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content ?? "";

    // Strip <think> blocks Qwen3 may emit, then strip markdown fences
    const cleaned = stripThinkTags(raw).replace(/```json\n?|\n?```/g, "").trim();

    let scored: RunScore;
    try {
      scored = JSON.parse(cleaned) as RunScore;
    } catch (parseErr) {
      const result = buildErrorResult(
        `Failed to parse evaluator response: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        prompt,
        raw,
      );
      await persistError(runId, result);
      logger.error({ runId, parseErr, raw: raw.slice(0, 500) }, "scoreRun: JSON parse failed");
      return result;
    }

    // Validate required fields
    if (!Array.isArray(scored.metrics) || scored.metrics.length === 0) {
      const result = buildErrorResult("Evaluator response missing metrics array", prompt, raw);
      await persistError(runId, result);
      logger.error({ runId, scored }, "scoreRun: missing metrics in response");
      return result;
    }

    // Normalise: recalculate overall from metric sum in case LLM didn't
    const metricSum = (scored.metrics ?? []).reduce((s, m) => s + (m.score ?? 0), 0);
    if (scored.metrics?.length === 6 && metricSum > 0) {
      scored.overall = Math.min(100, Math.max(0, Math.round((metricSum / 120) * 100)));
    } else {
      scored.overall = Math.min(100, Math.max(0, (scored.overall as number) ?? 0));
    }
    scored.pass = (scored.overall ?? 0) >= 70;

    // Attach criteria source so the frontend can show the correct badge
    scored.criteriaSource = criteriaSource;

    // Store evaluator prompt and raw response for transparency
    scored.evaluatorPrompt = prompt;
    scored.rawEvaluatorResponse = raw;

    // Ensure criteriaScores is an array
    if (!Array.isArray(scored.criteriaScores)) {
      scored.criteriaScores = [];
    }

    await db
      .update(simulationRunsTable)
      .set({ score: scored.overall, result: scored as any, status: "completed", completedAt: new Date() })
      .where(eq(simulationRunsTable.id, runId));

    logger.info({ runId, overall: scored.overall, pass: scored.pass, criteriaSource }, "scoreRun: completed");
    return scored;
  } catch (err) {
    const result = buildErrorResult(
      `Evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
      prompt,
    );
    logger.error({ runId, err }, "scoreRun: evaluation failed");
    await persistError(runId, result);
    return result;
  }
}
