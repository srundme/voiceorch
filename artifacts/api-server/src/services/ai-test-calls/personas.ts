/**
 * Generate realistic Indian customer personas that probe a target agent.
 * Output is a list of drafts — nothing is saved until the user confirms.
 */

import { getDispositionLLMChain } from "../disposition-llm.js";
import { logger } from "../../lib/logger.js";
import { clampTestMaxDuration, MAX_TEST_CASES_PER_GENERATE } from "./policy.js";

export interface PersonaDraft {
  name: string;
  scenario: string;
  difficulty: "easy" | "medium" | "hard";
  language: string;
  callerGender: "female" | "male";
  personaPrompt: string;
  goal: string;
  successCriteria: string[];
  maxDurationSeconds: number;
}

export const PERSONA_SCENARIOS = [
  "happy_path",
  "price_sensitive",
  "interrupts",
  "code_mixed",
  "spoken_digits_phone",
  "hallucination_probe",
  "dnc_request",
  "angry",
  "confused",
  "off_topic",
] as const;

const DIFFICULTIES = new Set(["easy", "medium", "hard"]);

export const PERSONA_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["personas"],
  properties: {
    personas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "scenario", "difficulty", "language", "callerGender", "personaPrompt", "goal", "successCriteria"],
        properties: {
          name: { type: "string" },
          scenario: { type: "string" },
          difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
          language: { type: "string" },
          callerGender: { type: "string", enum: ["female", "male"] },
          personaPrompt: { type: "string" },
          goal: { type: "string" },
          successCriteria: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

export interface TargetAgentContext {
  name: string;
  systemPrompt: string;
  greetingMessage: string | null;
  language: string | null;
  productDetails?: string | null;
  knowledgeSnippets?: string[];
  successCriteria?: string | null;
}

export function buildPersonaSystemPrompt(count: number): string {
  return [
    "You design realistic phone-call test scenarios for an AI voice agent used by an Indian business.",
    `Create exactly ${count} distinct customer personas who will phone this agent.`,
    "Spread them across these scenarios (pick the most relevant for this business, avoid repeats until all are used):",
    "- happy_path: cooperative customer who wants the main outcome (booking/purchase/enquiry).",
    "- price_sensitive: keeps asking about price, discounts, cheaper options.",
    "- interrupts: cuts the agent off mid-sentence, changes their mind.",
    "- code_mixed: speaks Hinglish/Tanglish style mixed language.",
    "- spoken_digits_phone: gives their phone number as spoken digits in groups and corrects one digit midway.",
    "- hallucination_probe: asks for specific facts NOT in the agent's knowledge (exact prices, policies, branch timings) to see if it invents answers.",
    "- dnc_request: says 'stop calling me' / asks not to be contacted again.",
    "- angry: frustrated about a past experience, raises voice, demands escalation.",
    "- confused / off_topic: elderly or distracted caller, asks unrelated questions.",
    "",
    "Rules:",
    "- personaPrompt: 3-6 sentences in second person ('You are ...') describing name, age, city, situation, speaking style and quirks. Indian names and context.",
    "- goal: one sentence — what the caller wants from this call.",
    "- successCriteria: 3-6 concrete, checkable statements about how the TARGET AGENT must behave (not the caller), e.g. 'Agent confirms the caller's 10-digit number back correctly'.",
    "- For hallucination_probe include a criterion that the agent must not invent facts it was not given.",
    "- For dnc_request include a criterion that the agent acknowledges and stops selling.",
    "- language: BCP-47 like en-IN, hi-IN, ta-IN — match the agent's language unless the scenario needs code-mixing.",
    "- name: short label like 'Price-sensitive mother, Pune'.",
    "Return JSON only.",
  ].join("\n");
}

export function buildPersonaContext(agent: TargetAgentContext): string {
  const parts = [
    `AGENT NAME: ${agent.name}`,
    `AGENT LANGUAGE: ${agent.language ?? "unspecified"}`,
    agent.greetingMessage ? `GREETING: ${agent.greetingMessage}` : "",
    `AGENT INSTRUCTIONS:\n${agent.systemPrompt.slice(0, 6000)}`,
    agent.productDetails ? `PRODUCT DETAILS:\n${agent.productDetails.slice(0, 2000)}` : "",
    agent.successCriteria ? `OWNER'S SUCCESS CRITERIA: ${agent.successCriteria}` : "",
    agent.knowledgeSnippets?.length
      ? `KNOWLEDGE BASE EXCERPTS:\n${agent.knowledgeSnippets.join("\n---\n").slice(0, 3000)}`
      : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Validate/normalize model output into drafts; drops unusable entries. */
export function parsePersonaDrafts(raw: unknown, count: number, fallbackLanguage: string): PersonaDraft[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { personas?: unknown }).personas)
      ? (raw as { personas: unknown[] }).personas
      : [];
  const out: PersonaDraft[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const personaPrompt = str(r["personaPrompt"], 2000);
    const goal = str(r["goal"], 500);
    const criteria = Array.isArray(r["successCriteria"])
      ? (r["successCriteria"] as unknown[]).map((c) => str(c, 300)).filter(Boolean).slice(0, 6)
      : [];
    if (!personaPrompt || !goal || criteria.length === 0) continue;
    const difficulty = str(r["difficulty"], 10).toLowerCase();
    const gender = str(r["callerGender"], 10).toLowerCase();
    out.push({
      name: str(r["name"], 120) || `Persona ${out.length + 1}`,
      scenario: str(r["scenario"], 40).toLowerCase() || "happy_path",
      difficulty: (DIFFICULTIES.has(difficulty) ? difficulty : "medium") as PersonaDraft["difficulty"],
      language: str(r["language"], 10) || fallbackLanguage,
      callerGender: gender === "male" ? "male" : "female",
      personaPrompt,
      goal,
      successCriteria: criteria,
      maxDurationSeconds: clampTestMaxDuration(undefined),
    });
    if (out.length >= count) break;
  }
  return out;
}

export class PersonaGenerationError extends Error {}

export async function generatePersonaDrafts(agent: TargetAgentContext, requested: number): Promise<PersonaDraft[]> {
  const count = Math.min(MAX_TEST_CASES_PER_GENERATE, Math.max(1, Math.floor(requested) || 5));
  const chain = await getDispositionLLMChain();
  if (chain.length === 0) throw new PersonaGenerationError("Persona generation is unavailable right now (no AI model configured).");
  const system = buildPersonaSystemPrompt(count);
  const context = buildPersonaContext(agent);
  let lastErr: unknown = null;
  for (const { provider, client } of chain) {
    try {
      const raw = await client.extract(system, PERSONA_SCHEMA, context);
      const drafts = parsePersonaDrafts(raw, count, agent.language ?? "en-IN");
      if (drafts.length > 0) return drafts;
      lastErr = new Error("model returned no usable personas");
    } catch (err) {
      lastErr = err;
      logger.warn({ provider, err }, "ai-test-calls: persona generation failed on provider");
    }
  }
  logger.warn({ err: lastErr }, "ai-test-calls: persona generation exhausted providers");
  throw new PersonaGenerationError("Could not generate personas right now. Please try again.");
}
