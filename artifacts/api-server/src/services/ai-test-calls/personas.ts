/**
 * Step B of persona generation: realistic counterparts of THIS business, each
 * probing specific items of the agent brief (facts, rules, required fields,
 * objections, out-of-scope questions). Drafts only — nothing is saved here.
 */

import type { TestCaseCallerFact, TestCaseTarget } from "@workspace/db/schema";
import { logger } from "../../lib/logger.js";
import { clampTestMaxDuration, MAX_TEST_CASES_PER_GENERATE } from "./policy.js";
import { briefAsText, briefIds, resolveTargets, type AgentBrief } from "./brief.js";
import type { TestJsonRequest, TestJsonResult } from "./llm.js";

export interface PersonaDraft {
  name: string;
  scenario: string;
  difficulty: "easy" | "medium" | "hard";
  language: string;
  callerGender: "female" | "male";
  callerRole: string;
  personaPrompt: string;
  goal: string;
  callerFacts: TestCaseCallerFact[];
  successCriteria: string[];
  expectedOutcome: string;
  targets: TestCaseTarget[];
  maxDurationSeconds: number;
}

/** Parsed model output before grounding checks (targets are raw ids). */
export interface RawPersona extends Omit<PersonaDraft, "targets"> {
  targetIds: string[];
}

export interface ScenarioSlot {
  scenario: string;
  focus: string;
  targets: string[];
  modifier: string | null;
}

const DIFFICULTIES = new Set(["easy", "medium", "hard"]);

/* ── Scenario planning ───────────────────────────────────────────────────── */

const ESCALATION_RE = /transfer|escalat|human|supervisor|manager|call ?back|callback/i;
const DNC_RE = /\bdnc\b|do not call|don't call|stop calling|opt[- ]?out|unsubscribe|not interested/i;
const NUMERIC_FIELD_RE = /phone|mobile|number|contact|pin|otp|aadhaar|pan|account|amount|date|age/i;

/**
 * Deterministic plan from the brief: slot 1 is always the full happy path; the
 * rest round-robin across fact / rule / field / objection / out-of-scope /
 * escalation / opt-out items. Generic behaviours are only modifiers.
 */
export function planScenarios(brief: AgentBrief, count: number): ScenarioSlot[] {
  const n = Math.max(1, Math.min(MAX_TEST_CASES_PER_GENERATE, count));
  const happyTargets = [...brief.flowSteps.map((s) => s.id), ...brief.requiredInfo.map((f) => f.id)];
  const slots: ScenarioSlot[] = [{
    scenario: "happy_path",
    focus: "Cooperative counterpart who wants the main outcome, goes through every flow step in order and gives every required field correctly when asked.",
    targets: happyTargets.length ? happyTargets.slice(0, 14) : brief.facts.slice(0, 2).map((f) => f.id),
    modifier: null,
  }];

  const escalationRules = brief.rules.filter((r) => ESCALATION_RE.test(r.text));
  const dncRules = brief.rules.filter((r) => DNC_RE.test(r.text));
  const otherRules = brief.rules.filter((r) => !escalationRules.includes(r) && !dncRules.includes(r));
  const pools: Array<Array<Omit<ScenarioSlot, "modifier">>> = [
    brief.facts.map((f) => ({ scenario: "fact_check", focus: `Asks specifically about: ${f.text}`, targets: [f.id] })),
    otherRules.map((r) => ({ scenario: "rule_probe", focus: `Situation that tests the rule: ${r.text} (e.g. the caller does not meet it or pushes against it)`, targets: [r.id] })),
    brief.requiredInfo.map((f) => ({
      scenario: "field_correction",
      focus: `Gives "${f.field}" wrongly or ambiguously at first${f.validation ? ` (rule: ${f.validation})` : ""}, then corrects it when the agent checks`,
      targets: [f.id],
    })),
    brief.objectionsHandled.map((o) => ({ scenario: "objection", focus: `Raises this objection the prompt covers: ${o.text}`, targets: [o.id] })),
    brief.outOfScope.map((x) => ({ scenario: "out_of_scope_probe", focus: `Asks about something the agent was NOT given: ${x.text}. The agent must not invent an answer.`, targets: [x.id] })),
    [
      ...escalationRules.map((r) => ({ scenario: "escalation", focus: `Triggers the escalation/transfer rule: ${r.text}`, targets: [r.id] })),
      ...brief.toolsUsage.map((t) => ({ scenario: "tool_trigger", focus: `Creates the situation where the agent should use ${t.tool}${t.when ? ` (${t.when})` : ""}`, targets: [t.id] })),
    ],
    dncRules.map((r) => ({ scenario: "dnc_request", focus: `Asks not to be contacted again; tests: ${r.text}`, targets: [r.id] })),
  ];

  const used = new Set<string>();
  const cursors = pools.map(() => 0);
  while (slots.length < n) {
    let added = false;
    for (let p = 0; p < pools.length && slots.length < n; p++) {
      const pool = pools[p]!;
      while (cursors[p]! < pool.length) {
        const cand = pool[cursors[p]!++]!;
        const key = cand.targets.join(",");
        if (used.has(key)) continue;
        used.add(key);
        slots.push({ ...cand, modifier: null });
        added = true;
        break;
      }
    }
    if (!added) break;
  }

  const modifiers: string[] = ["interrupts"];
  if (brief.languages.length > 1 || brief.languages.some((l) => !/^en/i.test(l))) modifiers.push("code_mixed");
  if (brief.requiredInfo.some((f) => NUMERIC_FIELD_RE.test(`${f.field} ${f.validation}`))) modifiers.push("spoken_digits");
  // Every other contextual slot gets one behaviour layered on top.
  slots.forEach((s, i) => { if (i > 0 && i % 2 === 0) s.modifier = modifiers[(i / 2 - 1) % modifiers.length]!; });
  return slots;
}

/* ── Prompts ─────────────────────────────────────────────────────────────── */

const callerFactSchema = { type: "object", additionalProperties: false, required: ["label", "value"],
  properties: { label: { type: "string" }, value: { type: "string" } } };

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
        required: ["name", "scenario", "targets", "difficulty", "language", "callerGender", "callerRole", "personaPrompt",
          "goal", "callerFacts", "successCriteria", "expectedOutcome"],
        properties: {
          name: { type: "string" },
          scenario: { type: "string" },
          targets: { type: "array", items: { type: "string" } },
          difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
          language: { type: "string" },
          callerGender: { type: "string", enum: ["female", "male"] },
          callerRole: { type: "string" },
          personaPrompt: { type: "string" },
          goal: { type: "string" },
          callerFacts: { type: "array", items: callerFactSchema },
          successCriteria: { type: "array", items: { type: "string" } },
          expectedOutcome: { type: "string" },
        },
      },
    },
  },
};

const MODIFIER_TEXT: Record<string, string> = {
  interrupts: "the caller interrupts the agent mid-sentence once or twice and changes one detail",
  code_mixed: "the caller mixes English with the agent's other language (Hinglish/Tanglish style)",
  spoken_digits: "the caller says numbers as spoken digit groups (e.g. 'nine eight four double-five…') and corrects one digit",
};

export function buildPersonaSystemPrompt(count: number): string {
  return [
    "You write test callers for an AI phone agent. Each caller is a realistic person this specific business deals with, and each one probes specific items from the AGENT BRIEF.",
    `Write exactly ${count} personas, one per SCENARIO PLAN slot, in the same order. Slot 1 is always the happy path.`,
    "",
    "Grounding rules (most important):",
    "- The caller is the brief's COUNTERPART, calling about the brief's actual OFFERINGS by name (e.g. the specific event, course, property or plan). Never a generic customer.",
    "- If AGENT DIRECTION is outbound, the caller is returning a missed call or calling back about the same topic, and lets the agent run its usual flow.",
    "- targets: the brief ids (S#, I#, F#, R#, O#, X#, T#) this persona tests. Use only ids that exist in the brief; at least one. Start from the slot's targets.",
    "- successCriteria: 3-6 statements about what the TARGET AGENT must do, each checkable against the brief and quoting actual values with the id, e.g.:",
    "    'Agent states the registration fee is ₹499 (F2)'",
    "    'Agent collects the child's age and declines age 15 because eligibility is 6-14 (R1, I3)'",
    "    'Agent reads back the mobile number 98450 12312 correctly (I2)'",
    "    'Agent says it will check or transfer instead of inventing parking details, which are not in its material (X1)'",
    "  Never write criteria that would fit any business (e.g. 'agent acknowledges the concern', 'agent offers information').",
    "- For an out_of_scope_probe the criterion is that the agent does NOT invent the answer. For a rule_probe, the criterion is that the agent applies the rule as written.",
    "- callerFacts: the concrete details this caller gives when asked — name, phone in spoken form, the specific option/date/batch they want, age, city, etc. Fictional but realistic Indian details, consistent with the scenario (for a rule_probe, the detail that breaks the rule).",
    "- callerRole: one line, who they are relative to this business (e.g. 'Parent registering a 9-year-old for the Galaxy Marvel Science Fair').",
    "- personaPrompt: 3-6 sentences in second person ('You are …'): who you are, why you are calling about this specific offering, how you speak, and the scenario twist. Weave in the slot's modifier if it has one. Do not mention tests, briefs or ids.",
    "- goal: one sentence — what the caller wants from this call, in the caller's terms.",
    "- expectedOutcome: one sentence — what a correct agent ends with (e.g. 'Registration captured with name, age, mobile; caller told the ₹499 fee' or 'Politely declined: age outside 6-14').",
    "- language: BCP-47 (en-IN, hi-IN, ta-IN …) matching the brief's LANGUAGES; use the agent's main language unless the slot needs code-mixing.",
    "- name: short label naming the scenario and the item, e.g. 'Over-age registration (age 15)' or 'Asks for parking at venue'.",
    "Return JSON only.",
  ].join("\n");
}

export function buildPersonaUserContent(
  brief: AgentBrief,
  plan: ScenarioSlot[],
  meta: { agentName: string; agentLanguage: string | null },
): string {
  const planText = plan.map((s, i) =>
    `${i + 1}. ${s.scenario} — ${s.focus} [targets: ${s.targets.join(", ") || "choose"}]${s.modifier ? ` + modifier: ${MODIFIER_TEXT[s.modifier] ?? s.modifier}` : ""}`);
  return [
    `AGENT NAME: ${meta.agentName}`,
    `AGENT LANGUAGE SETTING: ${meta.agentLanguage ?? "unspecified"}`,
    "",
    "AGENT BRIEF:",
    briefAsText(brief),
    "",
    "SCENARIO PLAN:",
    ...planText,
  ].join("\n");
}

function buildRepairUserContent(
  base: string,
  rejected: Array<{ persona: RawPersona; reason: string }>,
  missing: ScenarioSlot[],
): string {
  return [
    base,
    "",
    "Some personas were rejected. Rewrite them so every one is grounded in the brief (real ids in targets, criteria quoting brief values).",
    ...rejected.map((r) => `- REJECTED "${r.persona.name}": ${r.reason}`),
    "",
    `Write exactly ${missing.length} replacement personas for these slots:`,
    ...missing.map((s, i) => `${i + 1}. ${s.scenario} — ${s.focus} [targets: ${s.targets.join(", ")}]`),
  ].join("\n");
}

/* ── Parsing + grounding ─────────────────────────────────────────────────── */

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Validate/normalize model output; drops entries missing the essentials. */
export function parsePersonaDrafts(raw: unknown, count: number, fallbackLanguage: string): RawPersona[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { personas?: unknown }).personas)
      ? (raw as { personas: unknown[] }).personas
      : [];
  const out: RawPersona[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const personaPrompt = str(r["personaPrompt"], 2000);
    const goal = str(r["goal"], 500);
    const criteria = Array.isArray(r["successCriteria"])
      ? (r["successCriteria"] as unknown[]).map((c) => str(c, 300)).filter(Boolean).slice(0, 8)
      : [];
    if (!personaPrompt || !goal || criteria.length === 0) continue;
    const difficulty = str(r["difficulty"], 10).toLowerCase();
    const gender = str(r["callerGender"], 10).toLowerCase();
    const callerFacts = (Array.isArray(r["callerFacts"]) ? r["callerFacts"] as unknown[] : [])
      .map((f) => {
        const o = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
        const label = str(o["label"], 60);
        const value = str(o["value"], 200);
        return label && value ? { label, value } : null;
      })
      .filter((f): f is TestCaseCallerFact => !!f)
      .slice(0, 12);
    out.push({
      name: str(r["name"], 120) || `Persona ${out.length + 1}`,
      scenario: str(r["scenario"], 40).toLowerCase().replace(/[^a-z0-9_]+/g, "_") || "happy_path",
      targetIds: (Array.isArray(r["targets"]) ? r["targets"] as unknown[] : []).map((t) => str(t, 8).toUpperCase()).filter(Boolean),
      difficulty: (DIFFICULTIES.has(difficulty) ? difficulty : "medium") as PersonaDraft["difficulty"],
      language: str(r["language"], 10) || fallbackLanguage,
      callerGender: gender === "male" ? "male" : "female",
      callerRole: str(r["callerRole"], 300),
      personaPrompt,
      goal,
      callerFacts,
      successCriteria: criteria,
      expectedOutcome: str(r["expectedOutcome"], 500),
      maxDurationSeconds: clampTestMaxDuration(undefined),
    });
    if (out.length >= count) break;
  }
  return out;
}

const GENERIC_WORDS = new Set((
  "agent agents caller callers customer customers call calls calling the and for with that this from their they them "
  + "will should must does when what which also into more about politely correctly clearly properly appropriately "
  + "information info details detail available offer offers offering provide provides provided concern concerns "
  + "acknowledge acknowledges acknowledged empathy empathise empathize address addresses question questions answer answers "
  + "respond responds response helpful help helps relevant manner tone friendly professional handles handle situation "
  + "needs need asks ask asked request requests requested explain explains explained confirm confirms confirmed "
  + "says states mention mentions their caller's agent's"
).split(/\s+/));

/** Common words inside business/offering names that alone don't make a criterion specific. */
const STOP_NAME_WORDS = new Set("services service private limited company group centre center india solutions team official".split(" "));

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}₹][\p{L}\p{N}₹'-]*/gu)?.map((w) => w.replace(/['-]+$/, "").replace(/'s$/, "")) ?? [];
}

interface GroundingIndex {
  ids: Set<string>;
  values: Set<string>;
  itemKeywords: Array<Set<string>>;
}

export function buildGroundingIndex(brief: AgentBrief): GroundingIndex {
  const texts = [
    brief.business, ...brief.offerings,
    ...brief.facts.map((f) => `${f.text} ${f.sourceQuote}`),
    ...brief.rules.map((r) => `${r.text} ${r.sourceQuote}`),
    ...brief.requiredInfo.map((f) => `${f.field} ${f.validation}`),
    ...brief.flowSteps.map((s) => s.text),
    ...brief.objectionsHandled.map((o) => o.text),
    ...brief.outOfScope.map((x) => x.text),
    ...brief.toolsUsage.map((t) => `${t.tool} ${t.when}`),
  ].filter(Boolean);
  const values = new Set<string>();
  for (const name of [brief.business, ...brief.offerings]) {
    for (const m of name.match(/\p{Lu}[\p{L}\p{N}]{2,}/gu) ?? []) {
      const w = m.toLowerCase();
      if (!GENERIC_WORDS.has(w) && !STOP_NAME_WORDS.has(w)) values.add(w);
    }
  }
  for (const t of texts) {
    for (const n of t.match(/₹?\d[\d,.:/-]*\d|₹?\d/g) ?? []) {
      const digits = n.replace(/[^\d]/g, "");
      if (digits.length >= 2) values.add(digits);
    }
    // Proper nouns (event / product / place names): capitalised words that don't start a sentence.
    for (const sentence of t.split(/[.!?\n]+/)) {
      const ws = sentence.trim().split(/\s+/).slice(1);
      for (const raw of ws) {
        const m = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
        if (!/^\p{Lu}[\p{L}\p{N}]{2,}$/u.test(m)) continue;
        const w = m.toLowerCase();
        if (!GENERIC_WORDS.has(w)) values.add(w);
      }
    }
  }
  const itemKeywords = texts.map((t) => new Set(words(t).filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w))));
  return { ids: briefIds(brief), values, itemKeywords };
}

/** A criterion is grounded when it cites a brief id, a brief value/name, or ≥2 distinctive keywords of one item. */
export function isGroundedCriterion(criterion: string, index: GroundingIndex): boolean {
  for (const m of criterion.toUpperCase().match(/\b[SIFROXT]\d{1,2}\b/g) ?? []) if (index.ids.has(m)) return true;
  for (const n of criterion.match(/₹?\d[\d,.:/-]*\d/g) ?? []) if (index.values.has(n.replace(/[^\d]/g, ""))) return true;
  const ws = words(criterion);
  if (ws.some((w) => w.length >= 3 && index.values.has(w))) return true;
  const set = new Set(ws.filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w)));
  return index.itemKeywords.some((kw) => {
    let hits = 0;
    for (const w of set) if (kw.has(w) && ++hits >= 2) return true;
    return false;
  });
}

/** Keep personas that target real brief items and have at least one grounded criterion. */
export function validatePersonas(
  personas: RawPersona[],
  brief: AgentBrief,
): { accepted: PersonaDraft[]; rejected: Array<{ persona: RawPersona; reason: string }> } {
  const index = buildGroundingIndex(brief);
  const accepted: PersonaDraft[] = [];
  const rejected: Array<{ persona: RawPersona; reason: string }> = [];
  for (const p of personas) {
    const targets = resolveTargets(brief, p.targetIds);
    if (targets.length === 0) {
      rejected.push({ persona: p, reason: `targets ${JSON.stringify(p.targetIds)} are not ids in the brief` });
      continue;
    }
    if (!p.successCriteria.some((c) => isGroundedCriterion(c, index))) {
      rejected.push({ persona: p, reason: "every success criterion is generic — none references a brief fact, rule, field or value" });
      continue;
    }
    const { targetIds: _ids, ...rest } = p;
    accepted.push({ ...rest, targets });
  }
  return { accepted, rejected };
}

/** Happy path first, unique names, capped. */
export function orderPersonas(personas: PersonaDraft[], count: number): PersonaDraft[] {
  const seen = new Set<string>();
  const unique = personas.filter((p) => {
    const k = p.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const happy = unique.findIndex((p) => p.scenario === "happy_path");
  if (happy > 0) unique.unshift(...unique.splice(happy, 1));
  return unique.slice(0, count);
}

/* ── Orchestration ───────────────────────────────────────────────────────── */

export class PersonaGenerationError extends Error {}

type JsonGen = (req: TestJsonRequest, accept?: (d: Record<string, unknown>) => boolean) => Promise<TestJsonResult>;

export async function generatePersonaDrafts(
  brief: AgentBrief,
  opts: { count: number; agentName: string; agentLanguage: string | null },
  genOverride?: JsonGen,
): Promise<{ drafts: PersonaDraft[]; provider: string }> {
  const gen = genOverride ?? (await import("./llm.js")).generateTestJson;
  const count = Math.min(MAX_TEST_CASES_PER_GENERATE, Math.max(1, Math.floor(opts.count) || 5));
  const fallbackLang = opts.agentLanguage ?? brief.languages[0] ?? "en-IN";
  const plan = planScenarios(brief, count);
  const system = buildPersonaSystemPrompt(plan.length);
  const base = buildPersonaUserContent(brief, plan, opts);
  const accept = (d: Record<string, unknown>) => parsePersonaDrafts(d, count, fallbackLang).length > 0;

  let provider = "";
  let first;
  try {
    const res = await gen({ label: "personas", system, user: base, schema: PERSONA_SCHEMA, temperature: 0.6 }, accept);
    provider = res.provider;
    first = validatePersonas(parsePersonaDrafts(res.data, count, fallbackLang), brief);
  } catch (err) {
    if (err instanceof Error && err.name === "TestLlmUnavailableError") throw new PersonaGenerationError("Could not generate personas right now. Please try again.");
    throw err;
  }

  let accepted = first.accepted;
  const hasHappy = accepted.some((p) => p.scenario === "happy_path");
  const covered = new Set(accepted.flatMap((p) => p.targets.map((t) => t.id)));
  const missing = plan.filter((s, i) => (i === 0 ? !hasHappy : !s.targets.some((t) => covered.has(t))))
    .slice(0, count - accepted.length);

  if (missing.length > 0) {
    try {
      const res = await gen({
        label: "personas:repair",
        system: buildPersonaSystemPrompt(missing.length),
        user: buildRepairUserContent(base, first.rejected, missing),
        schema: PERSONA_SCHEMA,
        temperature: 0.5,
      }, accept);
      const repaired = validatePersonas(parsePersonaDrafts(res.data, missing.length, fallbackLang), brief);
      accepted = [...accepted, ...repaired.accepted];
      if (repaired.rejected.length) {
        logger.info({ rejected: repaired.rejected.map((r) => r.reason) }, "ai-test-calls: personas still ungrounded after repair");
      }
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "ai-test-calls: persona repair failed");
    }
  }

  const drafts = orderPersonas(accepted, count);
  if (drafts.length === 0) {
    throw new PersonaGenerationError("Couldn't write test callers grounded in this agent's prompt. Add concrete details (offerings, prices, steps, rules) to the prompt and try again.");
  }
  return { drafts, provider };
}
