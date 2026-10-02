/**
 * Step A of persona generation: extract a structured "agent brief" from the
 * agent's FULL prompt, tools, disposition fields and knowledge base, so test
 * personas and grading reference what this agent was actually told.
 */

import { createHash } from "node:crypto";
import type { TestCaseTarget } from "@workspace/db/schema";
import type { TestJsonRequest, TestJsonResult } from "./llm.js";

export const BRIEF_VERSION = 1;
export const MAX_PROMPT_CHARS = 24_000;
export const PROMPT_CHUNK_CHARS = 12_000;
export const MAX_KB_CHUNKS = 20;
export const MAX_KB_CHARS = 12_000;
const MAX_KB_CHUNK_CHARS = 1_500;

export interface BriefItem { id: string; text: string; sourceQuote: string }
export interface BriefLine { id: string; text: string }
export interface BriefField { id: string; field: string; validation: string }
export interface BriefTool { id: string; tool: string; when: string }

export interface AgentBrief {
  business: string;
  offerings: string[];
  counterpart: { who: string; situation: string };
  agentDirection: "inbound" | "outbound" | "both" | "unknown";
  callObjective: string;
  languages: string[];
  flowSteps: BriefLine[];
  requiredInfo: BriefField[];
  facts: BriefItem[];
  rules: BriefItem[];
  objectionsHandled: BriefLine[];
  outOfScope: BriefLine[];
  toolsUsage: BriefTool[];
}

/** Id prefix per brief list — ids are reassigned locally, never trusted from the model. */
export const BRIEF_ID_PREFIX = {
  flowSteps: "S",
  requiredInfo: "I",
  facts: "F",
  rules: "R",
  objectionsHandled: "O",
  outOfScope: "X",
  toolsUsage: "T",
} as const;

const KIND_BY_PREFIX: Record<string, string> = {
  S: "step", I: "field", F: "fact", R: "rule", O: "objection", X: "out_of_scope", T: "tool",
};

const LIST_CAPS = {
  flowSteps: 12, requiredInfo: 12, facts: 40, rules: 30, objectionsHandled: 12, outOfScope: 15, toolsUsage: 10,
} as const;

export interface BriefAgentInput {
  name: string;
  systemPrompt: string;
  greetingMessage: string | null;
  language: string | null;
  firstSpeaker: string | null;
  useCase: string | null;
  productDetails: string | null;
  successCriteria: string | null;
  tools: Array<{ name: string; description: string }>;
  dispositionFields: Array<{ key: string; label: string; type: string; options?: string[]; required?: boolean }>;
}

export interface KbChunkLite { id: number; documentId: number; chunkIndex: number; content: string }

/* ── Prompt chunking ─────────────────────────────────────────────────────── */

/** Split the (capped) prompt into paragraph-aligned chunks so nothing past 6k chars is dropped. */
export function splitPromptChunks(prompt: string, size = PROMPT_CHUNK_CHARS, max = MAX_PROMPT_CHARS): string[] {
  const text = prompt.trim().slice(0, max);
  if (!text) return [];
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let cur = "";
  const push = () => { if (cur.trim()) chunks.push(cur.trim()); cur = ""; };
  for (const para of text.split(/\n{2,}/)) {
    if (para.length > size) {
      push();
      for (let i = 0; i < para.length; i += size) chunks.push(para.slice(i, i + size));
      continue;
    }
    if (cur.length + para.length + 2 > size) push();
    cur += (cur ? "\n\n" : "") + para;
  }
  push();
  return chunks;
}

/* ── Knowledge-base chunk selection ──────────────────────────────────────── */

const STOPWORDS = new Set((
  "the and for with that this from your you are was were will would should could have has had not but "
  + "what when where which who whom whose why how all any can may might must shall into onto about above "
  + "after again also because been before being below between both each few more most other over same "
  + "some such than then there these they those through under until very just only own once here their "
  + "them its our ours out off per via yes okay please thank thanks always never dont don't do does did "
  + "agent agents caller callers customer customers user users call calls calling assistant voice prompt "
  + "say says said tell ask asks asked make sure keep give get like need want one two "
  + "information details detail available offer offers provide provides politely clearly correctly concern "
  + "concerns acknowledge acknowledges acknowledged question questions answer answers respond response "
  + "helpful help helps properly appropriately relevant manner tone friendly professional"
).split(/\s+/));

function tokens(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}₹][\p{L}\p{N}₹'.-]*/gu)?.map((t) => t.replace(/[.'-]+$/, "")) ?? [];
}

/** Most frequent distinctive terms in the prompt (plus every number/price), used to rank KB chunks. */
export function extractKeyTerms(text: string, limit = 40): string[] {
  const counts = new Map<string, number>();
  for (const t of tokens(text)) {
    const isNumber = /\d/.test(t) && t.replace(/\D/g, "").length >= 2;
    if (!isNumber && (t.length < 4 || STOPWORDS.has(t))) continue;
    counts.set(t, (counts.get(t) ?? 0) + (isNumber ? 3 : 1));
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([t]) => t);
}

/**
 * Prefer chunks that mention the prompt's key terms, spread across documents,
 * skipping near-duplicates; cap count and total characters.
 */
export function selectKbChunks(
  chunks: KbChunkLite[],
  keyTerms: string[],
  opts: { maxChunks?: number; maxChars?: number } = {},
): KbChunkLite[] {
  const maxChunks = opts.maxChunks ?? MAX_KB_CHUNKS;
  const maxChars = opts.maxChars ?? MAX_KB_CHARS;
  const terms = new Set(keyTerms.map((t) => t.toLowerCase()));
  const seen = new Set<string>();
  const scored = chunks
    .filter((c) => c.content.trim().length > 0)
    .map((c) => {
      const toks = new Set(tokens(c.content));
      let score = 0;
      for (const t of terms) if (toks.has(t)) score++;
      return { c, score };
    })
    .filter(({ c }) => {
      const sig = c.content.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 160);
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });

  const byDoc = new Map<number, Array<{ c: KbChunkLite; score: number }>>();
  for (const s of scored) {
    const list = byDoc.get(s.c.documentId) ?? [];
    list.push(s);
    byDoc.set(s.c.documentId, list);
  }
  for (const list of byDoc.values()) list.sort((a, b) => b.score - a.score || a.c.chunkIndex - b.c.chunkIndex);
  const docs = [...byDoc.values()].sort((a, b) => (b[0]?.score ?? 0) - (a[0]?.score ?? 0));

  const out: KbChunkLite[] = [];
  let chars = 0;
  for (let round = 0; out.length < maxChunks; round++) {
    let progressed = false;
    for (const list of docs) {
      const pick = list[round];
      if (!pick) continue;
      progressed = true;
      const content = pick.c.content.trim().slice(0, MAX_KB_CHUNK_CHARS);
      if (chars + content.length > maxChars) continue;
      out.push({ ...pick.c, content });
      chars += content.length;
      if (out.length >= maxChunks) break;
    }
    if (!progressed) break;
  }
  return out;
}

/* ── Source assembly ─────────────────────────────────────────────────────── */

function contextHeader(input: BriefAgentInput, kb: KbChunkLite[], includeKb: boolean): string {
  const parts = [
    `AGENT NAME: ${input.name}`,
    `AGENT LANGUAGE SETTING: ${input.language ?? "unspecified"}`,
    `WHO SPEAKS FIRST: ${input.firstSpeaker === "user" ? "the other person (agent waits)" : "the agent"}`,
    input.useCase ? `USE CASE: ${input.useCase}` : "",
    input.greetingMessage ? `GREETING: ${input.greetingMessage}` : "",
    input.productDetails ? `PRODUCT DETAILS:\n${input.productDetails.slice(0, 4000)}` : "",
    input.successCriteria ? `OWNER'S SUCCESS CRITERIA: ${input.successCriteria.slice(0, 1500)}` : "",
    input.tools.length
      ? `TOOLS THE AGENT CAN CALL:\n${input.tools.map((t) => `- ${t.name}: ${t.description || "(no description)"}`).join("\n")}`
      : "",
    input.dispositionFields.length
      ? `FIELDS THE AGENT MUST CAPTURE (post-call disposition):\n${input.dispositionFields.map((f) =>
        `- ${f.label || f.key} (${f.type}${f.required ? ", required" : ""}${f.options?.length ? `: ${f.options.join(" / ")}` : ""})`).join("\n")}`
      : "",
    includeKb && kb.length
      ? `KNOWLEDGE BASE EXCERPTS:\n${kb.map((c) => c.content).join("\n---\n")}`
      : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

/** One LLM user message per prompt chunk; KB rides with the first chunk only. */
export function buildBriefSources(input: BriefAgentInput, kb: KbChunkLite[]): string[] {
  const chunks = splitPromptChunks(input.systemPrompt);
  const parts = chunks.length ? chunks : [""];
  return parts.map((chunk, i) => [
    contextHeader(input, kb, i === 0),
    parts.length > 1
      ? `SYSTEM PROMPT (part ${i + 1} of ${parts.length} — extract only what this part states):\n${chunk}`
      : `SYSTEM PROMPT:\n${chunk}`,
  ].join("\n\n"));
}

/** Changes whenever anything the brief is built from changes. */
export function briefInputHash(input: BriefAgentInput, kb: KbChunkLite[]): string {
  const payload = JSON.stringify({
    v: BRIEF_VERSION,
    ...input,
    systemPrompt: input.systemPrompt.slice(0, MAX_PROMPT_CHARS),
    kb: kb.map((c) => [c.id, c.content.length]),
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

/* ── Model I/O ───────────────────────────────────────────────────────────── */

const quoted = { type: "object", additionalProperties: false, required: ["text", "sourceQuote"],
  properties: { text: { type: "string" }, sourceQuote: { type: "string" } } };

export const BRIEF_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["business", "offerings", "counterpart", "agentDirection", "callObjective", "languages", "flowSteps",
    "requiredInfo", "facts", "rules", "objectionsHandled", "outOfScope", "toolsUsage"],
  properties: {
    business: { type: "string" },
    offerings: { type: "array", items: { type: "string" } },
    counterpart: { type: "object", additionalProperties: false, required: ["who", "situation"],
      properties: { who: { type: "string" }, situation: { type: "string" } } },
    agentDirection: { type: "string", enum: ["inbound", "outbound", "both", "unknown"] },
    callObjective: { type: "string" },
    languages: { type: "array", items: { type: "string" } },
    flowSteps: { type: "array", items: { type: "string" } },
    requiredInfo: { type: "array", items: { type: "object", additionalProperties: false, required: ["field", "validation"],
      properties: { field: { type: "string" }, validation: { type: "string" } } } },
    facts: { type: "array", items: quoted },
    rules: { type: "array", items: quoted },
    objectionsHandled: { type: "array", items: { type: "string" } },
    outOfScope: { type: "array", items: { type: "string" } },
    toolsUsage: { type: "array", items: { type: "object", additionalProperties: false, required: ["tool", "when"],
      properties: { tool: { type: "string" }, when: { type: "string" } } } },
  },
};

export function buildBriefSystemPrompt(): string {
  return [
    "You analyse the configuration of an AI phone agent for a business and extract a precise brief that a QA team will use to write test calls.",
    "Extract ONLY what the material actually states. Never add industry knowledge, typical prices, or assumptions.",
    "",
    "Fields:",
    "- business: the business / brand name and what it is (one line).",
    "- offerings: the specific products, services, events, courses or plans the agent talks about, using their exact names.",
    "- counterpart.who: who is on the other end of these calls (e.g. 'parent of a school student', 'property buyer', 'patient', 'loan lead'). counterpart.situation: their typical situation when the call happens.",
    "- agentDirection: 'outbound' if the agent calls people (leads, reminders, follow-ups), 'inbound' if people call it, 'both', or 'unknown'.",
    "- callObjective: the single main outcome the agent is trying to achieve.",
    "- languages: BCP-47 codes the agent speaks or is told to switch to (e.g. en-IN, hi-IN, ta-IN).",
    "- flowSteps: the conversation steps IN ORDER, as the prompt describes them (greeting/identity check → … → closing).",
    "- requiredInfo: every piece of information the agent must collect, with its validation rule if any (e.g. '10-digit mobile', 'date in the future', 'age 6-14', one of a fixed list). Include required disposition fields.",
    "- facts: every concrete fact the agent may state — prices/fees, dates, times, venues/addresses, eligibility, durations, offers, policies, contact numbers. Keep exact values. sourceQuote = a short verbatim phrase from the material that states it.",
    "- rules: do/don't instructions, compliance lines, escalation or transfer triggers, how to handle opt-outs, closing rules. sourceQuote as above.",
    "- objectionsHandled: objections or difficult questions the prompt explicitly tells the agent how to handle.",
    "- outOfScope: things the agent is told not to discuss, or important questions a real caller would likely ask that the material does NOT answer (e.g. parking, refunds, exact location) — the agent must not invent these.",
    "- toolsUsage: for each tool, when the agent is supposed to use it.",
    "",
    "Be exhaustive for facts, rules and requiredInfo — these drive the tests. Use [] for lists with nothing stated and '' for unknown strings.",
    "Return JSON only.",
  ].join("\n");
}

/* ── Normalization ───────────────────────────────────────────────────────── */

function clip(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function textOf(v: unknown, max: number): string {
  if (typeof v === "string") return clip(v, max);
  if (v && typeof v === "object") {
    const r = v as Record<string, unknown>;
    return clip(r["text"] ?? r["step"] ?? r["description"] ?? r["value"], max);
  }
  return "";
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

const DIRECTIONS = new Set(["inbound", "outbound", "both", "unknown"]);

/** Sanitize model output; ids are assigned later by `renumberBrief`. */
export function normalizeBrief(raw: unknown): AgentBrief {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cp = (r["counterpart"] && typeof r["counterpart"] === "object" ? r["counterpart"] : {}) as Record<string, unknown>;
  const direction = clip(r["agentDirection"], 10).toLowerCase();
  const item = (v: unknown): BriefItem | null => {
    const text = textOf(v, 400);
    if (!text) return null;
    const quote = v && typeof v === "object" ? clip((v as Record<string, unknown>)["sourceQuote"], 300) : "";
    return { id: "", text, sourceQuote: quote };
  };
  const line = (v: unknown): BriefLine | null => {
    const text = textOf(v, 300);
    return text ? { id: "", text } : null;
  };
  return {
    business: clip(r["business"], 300),
    offerings: list(r["offerings"]).map((o) => textOf(o, 200)).filter(Boolean).slice(0, 12),
    counterpart: { who: clip(cp["who"], 200), situation: clip(cp["situation"], 400) },
    agentDirection: (DIRECTIONS.has(direction) ? direction : "unknown") as AgentBrief["agentDirection"],
    callObjective: clip(r["callObjective"], 400),
    languages: list(r["languages"]).map((l) => clip(l, 10)).filter(Boolean).slice(0, 6),
    flowSteps: list(r["flowSteps"]).map(line).filter((x): x is BriefLine => !!x),
    requiredInfo: list(r["requiredInfo"]).map((v) => {
      if (typeof v === "string") return clip(v, 120) ? { id: "", field: clip(v, 120), validation: "" } : null;
      const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
      const field = clip(o["field"] ?? o["name"], 120);
      return field ? { id: "", field, validation: clip(o["validation"], 200) } : null;
    }).filter((x): x is BriefField => !!x),
    facts: list(r["facts"]).map(item).filter((x): x is BriefItem => !!x),
    rules: list(r["rules"]).map(item).filter((x): x is BriefItem => !!x),
    objectionsHandled: list(r["objectionsHandled"]).map(line).filter((x): x is BriefLine => !!x),
    outOfScope: list(r["outOfScope"]).map(line).filter((x): x is BriefLine => !!x),
    toolsUsage: list(r["toolsUsage"]).map((v) => {
      const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
      const tool = clip(o["tool"] ?? o["name"], 80);
      return tool ? { id: "", tool, when: clip(o["when"] ?? o["usage"], 300) } : null;
    }).filter((x): x is BriefTool => !!x),
  };
}

type ListKey = keyof typeof BRIEF_ID_PREFIX;
const LIST_KEYS = Object.keys(BRIEF_ID_PREFIX) as ListKey[];

function itemKey(key: ListKey, v: BriefLine | BriefItem | BriefField | BriefTool): string {
  const s = key === "requiredInfo" ? (v as BriefField).field : key === "toolsUsage" ? (v as BriefTool).tool : (v as BriefLine).text;
  return s.toLowerCase().replace(/[^\p{L}\p{N}₹]+/gu, " ").trim();
}

/** Dedupe, cap and assign stable ids (S1, I1, F1, R1, O1, X1, T1). */
export function renumberBrief(brief: AgentBrief): AgentBrief {
  const out: AgentBrief = { ...brief };
  for (const key of LIST_KEYS) {
    const seen = new Set<string>();
    const items = (brief[key] as Array<BriefLine | BriefItem | BriefField | BriefTool>).filter((v) => {
      const k = itemKey(key, v);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, LIST_CAPS[key]);
    (out[key] as unknown[]) = items.map((v, i) => ({ ...v, id: `${BRIEF_ID_PREFIX[key]}${i + 1}` }));
  }
  return out;
}

/** Combine briefs extracted from separate prompt chunks. */
export function mergeBriefs(briefs: AgentBrief[]): AgentBrief {
  const first = <T>(pick: (b: AgentBrief) => T, empty: (v: T) => boolean): T => {
    for (const b of briefs) { const v = pick(b); if (!empty(v)) return v; }
    return pick(briefs[0] ?? normalizeBrief({}));
  };
  const merged: AgentBrief = {
    business: first((b) => b.business, (v) => !v),
    offerings: [...new Set(briefs.flatMap((b) => b.offerings))].slice(0, 12),
    counterpart: first((b) => b.counterpart, (v) => !v.who),
    agentDirection: first((b) => b.agentDirection, (v) => v === "unknown"),
    callObjective: first((b) => b.callObjective, (v) => !v),
    languages: [...new Set(briefs.flatMap((b) => b.languages))].slice(0, 6),
    flowSteps: [], requiredInfo: [], facts: [], rules: [], objectionsHandled: [], outOfScope: [], toolsUsage: [],
  };
  for (const key of LIST_KEYS) (merged[key] as unknown[]) = briefs.flatMap((b) => b[key] as unknown[]);
  return renumberBrief(merged);
}

const stripSeparators = (s: string) => s.replace(/[,.:]/g, "");

function numericTokens(text: string): string[] {
  return (text.match(/\d[\d,.:]*\d|\d/g) ?? []).map(stripSeparators).filter((n) => n.length >= 2);
}

/**
 * Drop facts/rules whose numbers (prices, dates, ages) never appear in the
 * source material — the model invented them.
 */
export function groundBrief(brief: AgentBrief, sourceText: string): AgentBrief {
  const source = stripSeparators(sourceText);
  const ok = (it: BriefItem) => numericTokens(it.text).every((n) => source.includes(n));
  return renumberBrief({ ...brief, facts: brief.facts.filter(ok), rules: brief.rules.filter(ok) });
}

export function briefItemCount(brief: AgentBrief): number {
  return brief.flowSteps.length + brief.requiredInfo.length + brief.facts.length + brief.rules.length
    + brief.objectionsHandled.length + brief.outOfScope.length + brief.toolsUsage.length;
}

/** A brief is usable for testing when it has at least one concrete fact, rule, step or field. */
export function briefIsUsable(brief: AgentBrief): boolean {
  return brief.facts.length + brief.rules.length + brief.flowSteps.length + brief.requiredInfo.length > 0;
}

/* ── Lookups ─────────────────────────────────────────────────────────────── */

export function briefIds(brief: AgentBrief): Set<string> {
  const ids = new Set<string>();
  for (const key of LIST_KEYS) for (const v of brief[key] as Array<{ id: string }>) ids.add(v.id);
  return ids;
}

export function briefItemText(brief: AgentBrief, id: string): string | null {
  for (const key of LIST_KEYS) {
    for (const v of brief[key] as Array<BriefLine | BriefItem | BriefField | BriefTool>) {
      if (v.id !== id) continue;
      if (key === "requiredInfo") { const f = v as BriefField; return f.validation ? `${f.field} (${f.validation})` : f.field; }
      if (key === "toolsUsage") { const t = v as BriefTool; return t.when ? `${t.tool}: ${t.when}` : t.tool; }
      return (v as BriefLine).text;
    }
  }
  return null;
}

export function resolveTargets(brief: AgentBrief, ids: string[]): TestCaseTarget[] {
  const out: TestCaseTarget[] = [];
  for (const raw of ids) {
    const id = raw.trim().toUpperCase();
    const text = briefItemText(brief, id);
    if (!text || out.some((t) => t.id === id)) continue;
    out.push({ id, kind: KIND_BY_PREFIX[id[0]!] ?? "item", label: text.length > 90 ? `${text.slice(0, 87)}…` : text });
  }
  return out;
}

/** Compact text form for persona / judge prompts. */
export function briefAsText(brief: AgentBrief, opts: { includeFlow?: boolean } = {}): string {
  const lines: string[] = [];
  if (brief.business) lines.push(`BUSINESS: ${brief.business}`);
  if (brief.offerings.length) lines.push(`OFFERINGS: ${brief.offerings.join("; ")}`);
  if (brief.counterpart.who) lines.push(`COUNTERPART: ${brief.counterpart.who}${brief.counterpart.situation ? ` — ${brief.counterpart.situation}` : ""}`);
  lines.push(`AGENT DIRECTION: ${brief.agentDirection}`);
  if (brief.callObjective) lines.push(`CALL OBJECTIVE: ${brief.callObjective}`);
  if (brief.languages.length) lines.push(`LANGUAGES: ${brief.languages.join(", ")}`);
  const section = (title: string, rows: string[]) => { if (rows.length) lines.push("", `${title}:`, ...rows); };
  if (opts.includeFlow !== false) section("FLOW STEPS (in order)", brief.flowSteps.map((s) => `${s.id}: ${s.text}`));
  section("REQUIRED INFO", brief.requiredInfo.map((f) => `${f.id}: ${f.field}${f.validation ? ` — ${f.validation}` : ""}`));
  section("FACTS (ground truth)", brief.facts.map((f) => `${f.id}: ${f.text}`));
  section("RULES", brief.rules.map((r) => `${r.id}: ${r.text}`));
  section("OBJECTIONS THE PROMPT HANDLES", brief.objectionsHandled.map((o) => `${o.id}: ${o.text}`));
  section("NOT IN THE AGENT'S MATERIAL (must not invent)", brief.outOfScope.map((x) => `${x.id}: ${x.text}`));
  section("TOOLS", brief.toolsUsage.map((t) => `${t.id}: ${t.tool}${t.when ? ` — ${t.when}` : ""}`));
  return lines.join("\n");
}

/* ── Orchestration ───────────────────────────────────────────────────────── */

export class BriefUnavailableError extends Error {}

type JsonGen = (req: TestJsonRequest, accept?: (d: Record<string, unknown>) => boolean) => Promise<TestJsonResult>;

/**
 * Extract the brief, one model call per prompt chunk (long prompts are split,
 * not truncated at 6k), then merge and drop facts with invented numbers.
 */
export async function analyzeAgentBrief(
  input: BriefAgentInput,
  kb: KbChunkLite[],
  genOverride?: JsonGen,
): Promise<{ brief: AgentBrief; provider: string; inputHash: string }> {
  const gen = genOverride ?? (await import("./llm.js")).generateTestJson;
  const sources = buildBriefSources(input, kb);
  const system = buildBriefSystemPrompt();
  const parts: AgentBrief[] = [];
  const providers = new Set<string>();
  for (const [i, user] of sources.entries()) {
    const res = await gen(
      { label: `brief:${i + 1}/${sources.length}`, system, user, schema: BRIEF_SCHEMA, temperature: 0.1, maxOutputTokens: 12_000 },
      (d) => briefItemCount(renumberBrief(normalizeBrief(d))) > 0,
    );
    providers.add(res.provider);
    parts.push(normalizeBrief(res.data));
  }
  const sourceText = [input.systemPrompt.slice(0, MAX_PROMPT_CHARS), input.greetingMessage ?? "", input.productDetails ?? "",
    input.successCriteria ?? "", ...input.tools.map((t) => t.description), ...kb.map((c) => c.content)].join("\n");
  const brief = groundBrief(mergeBriefs(parts), sourceText);
  if (!briefIsUsable(brief)) {
    throw new BriefUnavailableError("We couldn't find concrete steps, facts or rules in this agent's prompt. Add them to the prompt and try again.");
  }
  return { brief, provider: [...providers].join("+"), inputHash: briefInputHash(input, kb) };
}

/** Defensive read of a cached brief (jsonb). */
export function coerceBrief(raw: unknown): AgentBrief | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r["facts"]) || !Array.isArray(r["flowSteps"])) return null;
  const b = normalizeBrief(raw);
  // Keep stored ids so saved test-case targets keep resolving.
  for (const key of LIST_KEYS) {
    const src = list(r[key]);
    (b[key] as Array<{ id: string }>).forEach((v, i) => {
      const id = (src[i] as { id?: unknown } | undefined)?.id;
      v.id = typeof id === "string" && /^[A-Z]\d+$/.test(id) ? id : `${BRIEF_ID_PREFIX[key]}${i + 1}`;
    });
  }
  return b;
}
