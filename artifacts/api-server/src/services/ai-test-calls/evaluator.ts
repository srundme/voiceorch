/**
 * LLM judge for an AI Test Call. Grades the TARGET agent's behaviour from the
 * transcript against the test case criteria. Never invents a score: when no
 * model answers with usable JSON the run is marked "evaluation unavailable".
 */

import { getDispositionLLMChain } from "../disposition-llm.js";
import { logger } from "../../lib/logger.js";
import { briefAsText, type AgentBrief } from "./brief.js";

export interface CriterionResult {
  criterion: string;
  pass: boolean;
  reason: string;
  evidence: string;
  /** Agent-brief ids this result relies on (e.g. "F2", "R1"). */
  refs: string[];
}

export interface TestEvaluation {
  score: number;
  verdict: "pass" | "fail";
  criteria: CriterionResult[];
  issues: string[];
  summary: string;
}

export const GENERIC_CHECKS = [
  "The caller's goal was achieved or the agent clearly explained why it could not be.",
  "Details the caller gave (name, phone number, dates) were captured and repeated back correctly.",
  "The agent did not invent facts, prices, or policies that were not provided to it.",
  "The agent handled interruptions and changes of mind gracefully.",
  "If the caller asked not to be contacted again, the agent acknowledged it and stopped selling.",
  "The agent stayed in the caller's language or switched appropriately.",
  "The call ended properly (clear closing, no abrupt cut-off or endless loop).",
];

export const EVALUATION_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["score", "verdict", "criteria", "issues", "summary"],
  properties: {
    score: { type: "integer" },
    verdict: { type: "string", enum: ["pass", "fail"] },
    criteria: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["criterion", "pass", "reason", "evidence", "refs"],
        properties: {
          criterion: { type: "string" },
          pass: { type: "boolean" },
          reason: { type: "string" },
          evidence: { type: "string" },
          refs: { type: "array", items: { type: "string" } },
        },
      },
    },
    issues: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
};

/**
 * Relabel a session transcript ("Agent:" / "Caller:") so the judge always sees
 * TARGET AGENT vs CUSTOMER, whichever leg it came from.
 */
export function normalizeTestTranscript(transcript: string, leg: "callee" | "caller"): string {
  const agentLabel = leg === "callee" ? "TARGET AGENT" : "CUSTOMER";
  const callerLabel = leg === "callee" ? "CUSTOMER" : "TARGET AGENT";
  return transcript
    .split("\n")
    .map((line) => line.replace(
      /^(\s*)(Agent|Assistant|AI|Caller|User|Customer)\s*:/i,
      (_m, ws: string, who: string) => `${ws}${/^(agent|assistant|ai)$/i.test(who) ? agentLabel : callerLabel}:`,
    ))
    .join("\n");
}

export interface EvaluationInput {
  goal: string;
  criteria: string[];
  agentSuccessCriteria?: string | null;
  latency?: { sttMs: number | null; llmMs: number | null; ttsMs: number | null };
  /** What the agent was told (facts/rules/required info/out-of-scope), from its prompt + KB. */
  brief?: AgentBrief | null;
  targets?: Array<{ id: string; label: string }>;
  expectedOutcome?: string | null;
}

export function buildEvaluationSystemPrompt(opts: EvaluationInput): string {
  const lines = [
    "You are a strict QA reviewer grading an AI phone agent (TARGET AGENT) from a real call transcript.",
    "The CUSTOMER was a scripted test caller. Grade ONLY the TARGET AGENT's behaviour.",
  ];
  if (opts.brief) {
    lines.push(
      "",
      "WHAT THE AGENT WAS TOLD (from its prompt and knowledge base — this is the ground truth):",
      briefAsText(opts.brief),
      "",
      "Factual accuracy: compare every fact the agent stated (prices, dates, venues, eligibility, timings, policies) with FACTS above.",
      "- A stated value that contradicts a FACT is an error. A specific claim that appears nowhere in the material (especially anything listed under NOT IN THE AGENT'S MATERIAL) is an INVENTED FACT — add an issue starting with 'Invented fact:' and fail the relevant criterion.",
      "- Check that the agent applied the RULES and collected the REQUIRED INFO with its validation (e.g. read back numbers correctly).",
    );
  }
  lines.push("", `CUSTOMER GOAL: ${opts.goal}`);
  if (opts.expectedOutcome?.trim()) lines.push(`EXPECTED OUTCOME: ${opts.expectedOutcome.trim()}`);
  if (opts.targets?.length) lines.push(`THIS TEST TARGETS: ${opts.targets.map((t) => `${t.id} (${t.label})`).join("; ")}`);
  lines.push(
    "",
    "TEST CASE CRITERIA (grade each one):",
    ...opts.criteria.map((c, i) => `${i + 1}. ${c}`),
  );
  if (opts.agentSuccessCriteria?.trim()) {
    lines.push("", `AGENT OWNER'S SUCCESS CRITERIA (grade as one extra criterion): ${opts.agentSuccessCriteria.trim()}`);
  }
  lines.push(
    "",
    "GENERIC CHECKS (grade each one that applies to this call; skip ones that clearly do not apply):",
    ...GENERIC_CHECKS.map((c) => `- ${c}`),
  );
  if (opts.latency && (opts.latency.sttMs || opts.latency.llmMs || opts.latency.ttsMs)) {
    lines.push(
      "",
      `MEASURED AVG LATENCY (ms): STT ${opts.latency.sttMs ?? "n/a"}, LLM ${opts.latency.llmMs ?? "n/a"}, TTS first audio ${opts.latency.ttsMs ?? "n/a"}. Mention in issues if total response time exceeds ~2500ms.`,
    );
  }
  lines.push(
    "",
    "For every criterion return pass true/false, a one-sentence reason, a short verbatim evidence quote from the transcript (empty string if none), and refs: the brief ids (e.g. F2, R1, I3) the judgement relies on ([] if none).",
    "score: 0-100 reflecting overall quality; verdict 'pass' only if every TEST CASE criterion passed and no serious issue (invented facts, ignored stop-calling request) occurred.",
    "issues: concrete problems worth fixing in the agent's prompt. summary: 2-3 sentences.",
    "If the transcript is too short to judge a criterion, mark it failed with reason 'not observed'.",
    "Return JSON only.",
  );
  return lines.join("\n");
}

function clip(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Validate model JSON. Returns null when it is not a usable evaluation. */
export function parseEvaluation(raw: unknown): TestEvaluation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const criteria: CriterionResult[] = Array.isArray(r["criteria"])
    ? (r["criteria"] as unknown[])
      .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
      .map((c) => ({
        criterion: clip(c["criterion"], 400),
        pass: c["pass"] === true || c["pass"] === "true",
        reason: clip(c["reason"], 600),
        evidence: clip(c["evidence"], 600),
        refs: (Array.isArray(c["refs"]) ? c["refs"] as unknown[] : [])
          .map((x) => clip(x, 8).toUpperCase())
          .filter((x) => /^[SIFROXT]\d{1,2}$/.test(x))
          .slice(0, 8),
      }))
      .filter((c) => c.criterion)
    : [];
  const scoreNum = typeof r["score"] === "number" ? r["score"] : Number(r["score"]);
  if (!Number.isFinite(scoreNum) || criteria.length === 0) return null;
  const score = Math.max(0, Math.min(100, Math.round(scoreNum)));
  const verdictRaw = clip(r["verdict"], 10).toLowerCase();
  const verdict: "pass" | "fail" = verdictRaw === "pass" || verdictRaw === "fail"
    ? verdictRaw
    : criteria.every((c) => c.pass) ? "pass" : "fail";
  const issues = Array.isArray(r["issues"])
    ? (r["issues"] as unknown[]).map((i) => clip(i, 400)).filter(Boolean).slice(0, 12)
    : [];
  return { score, verdict, criteria, issues, summary: clip(r["summary"], 1200) };
}

export class EvaluationUnavailableError extends Error {
  constructor(message = "Evaluation unavailable") {
    super(message);
    this.name = "EvaluationUnavailableError";
  }
}

export async function evaluateTestCall(opts: EvaluationInput & { transcript: string }): Promise<TestEvaluation & { provider: string }> {
  const chain = await getDispositionLLMChain();
  if (chain.length === 0) throw new EvaluationUnavailableError("Evaluation unavailable: no AI model configured");
  const system = buildEvaluationSystemPrompt(opts);
  for (const { provider, client } of chain) {
    try {
      const raw = await client.extract(system, EVALUATION_SCHEMA, opts.transcript.slice(0, 12000));
      const parsed = parseEvaluation(raw);
      if (parsed) return { ...parsed, provider };
      logger.warn({ provider }, "ai-test-calls: evaluator returned unusable JSON");
    } catch (err) {
      logger.warn({ provider, err }, "ai-test-calls: evaluator provider failed");
    }
  }
  throw new EvaluationUnavailableError();
}
