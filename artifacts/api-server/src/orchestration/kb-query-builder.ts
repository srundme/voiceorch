/**
 * Phase 3 — Contextual KB Query Builder.
 *
 * When retrieval is needed, turn a referential utterance into a short search
 * string using locally available conversation context. No LLM. Search/bake/RRF
 * stay unchanged; only the query string fed into retrieveKbContextMultiEx may
 * change when KB_QUERY_BUILDER=on.
 *
 * KB_QUERY_BUILDER=on      existing search receives the built query (default)
 * KB_QUERY_BUILDER=shadow  raw STT query to the LLM path; log (and optionally
 *                          dual-search) the built query
 * KB_QUERY_BUILDER=off     raw STT query only (legacy)
 * KB_PHASE3_CANARY_AGENT_IDS  listed agents run as builder=on (Strategy B)
 *                             regardless of the global flag. Empty = nobody extra.
 *
 * Fail open: any error / empty build → raw transcript.
 */

import { isKbPhase3CanaryAgent } from "./kb-phase3-flags.js";

export type KbQueryBuilderMode = "off" | "shadow" | "on";

export type KbQueryStrategy =
  | "raw"
  | "entity_augmented"
  | "topic_augmented"
  | "entity_topic_augmented"
  | "previous_turn_augmented"
  | "fallback_raw";

export type KbEntityType = "job" | "policy" | "property" | "course" | "unknown";

export type KbEntitySource =
  | "kb_alias"
  | "caller_explicit"
  | "structured_state"
  | "previous_validated";

export type KbTopicSource = "caller_explicit" | "agent_topic" | "previous_validated";

export const KB_ENTITY_HIGH_CONFIDENCE = 0.85;

export type KbActiveEntity = {
  type: KbEntityType;
  name: string;
  attributes?: Record<string, string>;
  source?: KbEntitySource;
  confidence?: number;
  establishedTurn?: number;
};

export type KbCandidateEntity = {
  name: string;
  type: KbEntityType;
  source: KbEntitySource;
  confidence: number;
  attributes?: Record<string, string>;
};

export type KbQueryBuilderInput = {
  utterance: string;
  previousAgentTurn?: string | null;
  previousCallerTurn?: string | null;
  activeEntity?: KbActiveEntity | null;
  activeTopic?: string | null;
  knownOfferings?: string[] | null;
  turnIndex?: number;
  utteranceClass?: string | null;
  entityEstablishedTurn?: number | null;
  topicEstablishedTurn?: number | null;
};

export type KbQueryBuildResult = {
  rawQuery: string;
  searchQuery: string;
  contextualized: boolean;
  queryStrategy: KbQueryStrategy;
  topic: string | null;
  entities: string[];
  activeEntity: KbActiveEntity | null;
  activeTopic: string | null;
  candidateEntity: KbCandidateEntity | null;
  entitySource: KbEntitySource | null;
  entityConfidence: number | null;
  entityAgeTurns: number;
  topicSource: KbTopicSource | null;
  topicAgeTurns: number;
  entityChanged: boolean;
  topicCleared: boolean;
  builderMs: number;
  fallbackUsed: boolean;
};

export const KB_QUERY_MAX_CHARS = 320;

type TopicDef = {
  id: string;
  terms: string[];
  search: string;
};

const TOPICS: TopicDef[] = [
  { id: "transport", terms: ["transport", "cab", "shuttle", "bus", "pickup", "drop", "டிரான்ஸ்போர்ட்", "பேருந்து", "ट्रांसपोर्ट"], search: "transport policy" },
  { id: "salary", terms: ["salary", "ctc", "stipend", "pay", "compensation", "package", "சம்பள", "सैलरी"], search: "CTC salary" },
  { id: "premium", terms: ["premium", "pricing", "price", "cost", "fee", "fees", "how much", "எவ்வளவு", "कितना"], search: "premium pricing" },
  { id: "coverage", terms: ["covered", "coverage", "include", "included", "covers", "कवर"], search: "coverage" },
  { id: "exclusions", terms: ["exclusion", "exclusions", "not covered"], search: "exclusions" },
  { id: "eligibility", terms: ["eligib", "qualify", "qualification", "apply", "freshers", "fresher", "graduate", "graduates"], search: "eligibility" },
  { id: "experience", terms: ["experience"], search: "experience" },
  { id: "location", terms: ["location", "where", "office", "site", "எங்க"], search: "location" },
  { id: "availability", terms: ["availability", "vacancy", "opening", "openings", "கிடைக்குமா"], search: "availability" },
  { id: "refund", terms: ["refund"], search: "refund" },
  { id: "hospital", terms: ["hospital", "hospitals", "network"], search: "hospital network" },
  { id: "notice", terms: ["notice period", "notice"], search: "notice period" },
];

const TOPIC_TERM_SET = new Set(TOPICS.flatMap((t) => t.terms.map((x) => x.toLowerCase())));

const LANGUAGE_ENTITY_BLOCK = new Set([
  "tamil", "english", "hindi", "telugu", "kannada", "malayalam", "marathi",
  "bengali", "gujarati", "punjabi", "odia", "hinglish", "sure", "got", "okay",
  "yes", "yeah", "yep", "no", "nope", "mmm", "hmm", "sorry", "even", "couple",
  "minutes", "minute", "please", "hello", "hi", "actually", "already", "because",
]);

const ALIAS_DROP = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "in", "on",
  "insurance", "policy", "plan", "role", "job", "process", "knowledge", "base",
  "complete", "kb", "voice", "agent", "pack", "document", "docx", "pdf", "md",
  "part", "section", "untitled",
]);

const ALIAS_GENERIC_SINGLE = new Set([
  "health", "family", "floater", "coverage", "network", "hospital", "salary",
  "transport", "premium", "notice", "candidate", "candidates", "female", "male",
]);

/** Titles → searchable aliases (Care Supreme Health Insurance → Care, Care Supreme, Care Health). */
export function aliasesFromTitle(title: string): string[] {
  const cleaned = title
    .replace(/\.(md|docx?|pdf|txt|csv)$/i, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
  const tokens = cleaned
    .split(" ")
    .map((t) => t.replace(/[^A-Za-z0-9&.]/g, ""))
    .filter((t) => t.length >= 2 && !ALIAS_DROP.has(t.toLowerCase()));
  if (!tokens.length) return [];
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t.length < 4) return;
    out.push(t);
  };
  push(tokens.join(" "));
  for (let n = 1; n <= tokens.length; n++) {
    for (let i = 0; i + n <= tokens.length; i++) {
      const gram = tokens.slice(i, i + n).join(" ");
      if (n === 1 && ALIAS_GENERIC_SINGLE.has(gram.toLowerCase())) continue;
      if (n === 1 && LANGUAGE_ENTITY_BLOCK.has(gram.toLowerCase())) continue;
      push(gram);
    }
  }
  if (tokens.length >= 3) {
    for (let i = 1; i < tokens.length; i++) {
      if (ALIAS_GENERIC_SINGLE.has(tokens[i]!.toLowerCase()) && tokens[i]!.length <= 6) {
        push(`${tokens[0]} ${tokens[i]}`);
      }
    }
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const a of out) {
    const key = a.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(a);
  }
  return unique.slice(0, 24);
}

export function buildOfferingAliasIndex(titles: string[] | null | undefined): Array<{ canonical: string; alias: string }> {
  const rows: Array<{ canonical: string; alias: string }> = [];
  const seen = new Set<string>();
  for (const title of titles ?? []) {
    const t = title.trim();
    if (!t) continue;
    const canonical = t.replace(/\.(md|docx?|pdf|txt)$/i, "").replace(/[_-]+/g, " ").trim() || t;
    for (const alias of [canonical, ...aliasesFromTitle(t)]) {
      const key = `${canonical.toLowerCase()}::${alias.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ canonical, alias });
    }
  }
  rows.sort((a, b) => b.alias.length - a.alias.length);
  return rows;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchKnownOffering(
  text: string,
  titles: string[] | null | undefined,
): { canonical: string; alias: string; confidence: number } | null {
  const t = text.trim();
  if (!t) return null;
  for (const row of buildOfferingAliasIndex(titles)) {
    if (row.alias.length < 4) continue;
    const re = new RegExp(`(?:^|[^a-z0-9])${escapeRe(row.alias)}(?:[^a-z0-9]|$)`, "i");
    if (!re.test(t)) continue;
    if (/\b(don't|dont|take|not)\s+care\b|\bcare\s+(about|for)\b/i.test(t) && /^care$/i.test(row.alias)) {
      continue;
    }
    const words = row.alias.trim().split(/\s+/).length;
    const confidence = words >= 2 ? 0.96 : row.alias.length >= 5 ? 0.9 : 0.86;
    return { canonical: row.canonical, alias: row.alias, confidence };
  }
  return null;
}

const STOP = new Set([
  "the", "a", "an", "is", "are", "was", "were", "do", "does", "did", "can", "could",
  "what", "which", "when", "where", "why", "who", "how", "about", "for", "and", "or",
  "to", "of", "in", "on", "at", "with", "from", "they", "them", "their", "this", "that",
  "it", "its", "there", "please", "tell", "me", "my", "we", "you", "your", "our",
  "same", "also", "just", "only", "some", "any", "have", "has", "had", "will", "would",
  "i", "im", "i'm", "sir", "madam", "maam", "ma'am", "role", "job", "the",
]);

const ENTITY_STOP = new Set([
  "the", "this", "that", "there", "they", "female", "male", "candidates", "candidate",
  "role", "available", "around", "receive", "please", "hello", "today", "current",
  "fresher", "experienced", "one-way", "free", "policy", "process",
  "okay", "ok", "hmm", "yeah", "yes", "well", "right", "alright", "hi", "hey",
  "what", "which", "when", "where", "why", "who", "how",
  "actually", "already", "because", "however", "something", "someone", "sorry",
]);

const LOCATION_RE =
  /\b(MTP|OMR|SEZ|CHENNAI|BANGALORE|BENGALURU|HYDERABAD|PUNE|NOIDA|GURGAON|GURUGRAM|MUMBAI|DELHI|COIMBATORE|KOCHI|MYSORE|WHITEFIELD|HITEC)\b/i;

const REFERENTIAL_RE =
  /\b(it|that|this|they|them|there|what about|how much|how many|for me|for freshers?|for experienced|for women|for men|for males?|for females?|for girls?|included|free|same)\b/i;

const REFERENTIAL_START_RE =
  /^(and|what about|how much|how many|is that|is it|is this|for |and\s)/i;

const CODEMIX_REF_RE = /iruk[ka]?a|irukka|இருக்கா|கிடைக்குமா|என்ன/u;

const PROFILE_CONTAMINANT_RE =
  /\b(b\.?\s*com|b\.?\s*e\.?|mba|graduate|expected salary|notice period|i(?:'m| am) from|i have \d|six months|my name)\b/i;

const MALE_RE = /\b(males?|men|man|boys?|gents?)\b/i;
const FEMALE_RE = /\b(females?|women|woman|girls?|ladies)\b/i;
const EXPERIENCED_RE = /\b(experienced)\b/i;
const FRESHER_RE = /\bfreshers?\b/i;

function roundMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

export function resolveKbQueryBuilderMode(
  env: NodeJS.ProcessEnv = process.env,
  agentId?: number | null,
): KbQueryBuilderMode {
  if (isKbPhase3CanaryAgent(agentId, env)) return "on";
  const raw = (env["KB_QUERY_BUILDER"] ?? "on").trim().toLowerCase();
  if (raw === "shadow") return "shadow";
  if (raw === "off" || raw === "0" || raw === "false") return "off";
  return "on";
}

/** Dual raw-vs-built search in shadow. Default on; set 0 to disable. */
export function kbQueryBuilderShadowSearchEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = (env["KB_QUERY_BUILDER_SHADOW_SEARCH"] ?? "1").trim();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function isReferentialQuery(utterance: string): boolean {
  const t = utterance.trim();
  if (!t) return false;
  if (REFERENTIAL_START_RE.test(t) || REFERENTIAL_RE.test(t) || CODEMIX_REF_RE.test(t)) return true;
  if (/[?？]/.test(t) && wordCount(t) <= 8) return true;
  return false;
}

const HARD_TOPICS = new Set([
  "transport", "salary", "premium", "coverage", "exclusions", "location", "hospital", "refund", "notice",
]);

const LEADING_ACK_RE =
  /^(?:okay|ok|alright|all right|hmm+|yeah|yes|yep|right|so|well)(?:[.,!]+|\s)+/i;

/** Peel "Okay." / "So," so a new question is not treated as a 8-word follow-up. */
export function stripLeadingAcks(text: string): string {
  let t = text.trim();
  for (let i = 0; i < 3; i++) {
    const next = t.replace(LEADING_ACK_RE, "").trim();
    if (next === t) break;
    t = next;
  }
  return t || text.trim();
}

function pickTopic(
  fromUtterance: string | null,
  fromPrev: string | null,
  sticky: string | null,
  opts: {
    entityChanged: boolean;
    referential: boolean;
    utteranceClass: string;
  },
): { topic: string | null; source: KbTopicSource | null; cleared: boolean } {
  if (opts.utteranceClass === "language_control" || opts.utteranceClass === "call_control") {
    return { topic: null, source: null, cleared: Boolean(sticky) };
  }
  if (fromUtterance === "premium" && (fromPrev === "salary" || sticky === "salary")) {
    return { topic: "salary", source: "caller_explicit", cleared: false };
  }
  if (opts.entityChanged) {
    if (fromUtterance) return { topic: fromUtterance, source: "caller_explicit", cleared: Boolean(sticky && sticky !== fromUtterance) };
    return { topic: null, source: null, cleared: Boolean(sticky) };
  }
  if (fromUtterance && HARD_TOPICS.has(fromUtterance)) {
    return { topic: fromUtterance, source: "caller_explicit", cleared: false };
  }
  if (opts.referential) {
    if (sticky) return { topic: sticky, source: "previous_validated", cleared: false };
    if (fromPrev && HARD_TOPICS.has(fromPrev)) return { topic: fromPrev, source: "agent_topic", cleared: false };
    if (fromUtterance) return { topic: fromUtterance, source: "caller_explicit", cleared: false };
    return { topic: sticky, source: sticky ? "previous_validated" : null, cleared: false };
  }
  if (opts.utteranceClass === "acknowledgement" || opts.utteranceClass === "repeat_request") {
    return { topic: sticky, source: sticky ? "previous_validated" : null, cleared: false };
  }
  if (fromUtterance) {
    return { topic: fromUtterance, source: "caller_explicit", cleared: Boolean(sticky && sticky !== fromUtterance) };
  }
  return { topic: null, source: null, cleared: Boolean(sticky) };
}

function detectTopic(text: string | null | undefined): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const topic of TOPICS) {
    if (topic.terms.some((term) => {
      if (/[^\x00-\x7F]/.test(term)) return lower.includes(term.toLowerCase());
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(lower);
    })) return topic.id;
  }
  return null;
}

function topicSearchTerms(id: string | null): string {
  if (!id) return "";
  return TOPICS.find((t) => t.id === id)?.search ?? id;
}

function inferEntityType(text: string): KbEntityType {
  const t = text.toLowerCase();
  if (/\b(policy|insurance|premium|health|floater|cover)\b/.test(t)) return "policy";
  if (/\b(apartment|villa|property|sq\.?\s?ft|plot|flat)\b/.test(t)) return "property";
  if (/\b(course|mba|degree|college|university)\b/.test(t)) return "course";
  if (/\b(job|role|opening|process|bpo|ctc)\b/.test(t)) return "job";
  return "unknown";
}

function capitalizeWords(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function extractLocation(text: string): string | null {
  const m = text.match(LOCATION_RE);
  if (!m?.[1]) return null;
  const token = m[1];
  return token.length <= 4 ? token.toUpperCase() : capitalizeWords(token.toLowerCase());
}

function isJunkEntitySpan(span: string): boolean {
  const toks = span.toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return true;
  return toks.every((t) =>
    STOP.has(t) || ENTITY_STOP.has(t) || TOPIC_TERM_SET.has(t) || LANGUAGE_ENTITY_BLOCK.has(t) || ALIAS_GENERIC_SINGLE.has(t)
  );
}

/** Proper-noun-ish spans from agent (or self-contained) text — not caller profile. */
export function extractEntityName(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = text.replace(/[₹$€,]/g, " ");
  const spans: string[] = [];
  const capRe = /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = capRe.exec(cleaned)) !== null) {
    const span = m[1]!.split(/\s+/).filter((w) => !ENTITY_STOP.has(w.toLowerCase())).join(" ");
    if (span.length >= 3 && !PROFILE_CONTAMINANT_RE.test(span) && !isJunkEntitySpan(span)) spans.push(span);
  }
  const beforeLabel = cleaned.match(
    /\b((?:[A-Za-z][A-Za-z0-9]+\s+){1,5}[A-Za-z][A-Za-z0-9]+)\s+(?:role|policy|process|job|plan)\b/i,
  );
  if (beforeLabel?.[1]) {
    const span = beforeLabel[1]
      .split(/\s+/)
      .filter((w) => !ENTITY_STOP.has(w.toLowerCase()) && !STOP.has(w.toLowerCase()))
      .join(" ");
    if (span.length >= 6 && !PROFILE_CONTAMINANT_RE.test(span)) spans.unshift(span);
  }
  const caps = cleaned.match(/\b[A-Z]{2,6}\b/g) ?? [];
  const allcaps = caps.filter((w) => !["CTC", "I", "AM", "PM", "OK"].includes(w));
  if (spans.length === 0 && allcaps.length === 0) return null;
  const parts = [...spans.slice(0, 3), ...allcaps.slice(0, 2)];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  const name = unique.join(" ").trim();
  return name.length >= 3 ? name.slice(0, 80) : null;
}

function extractEntity(text: string | null | undefined): KbActiveEntity | null {
  if (!text) return null;
  const name = extractEntityName(text);
  const loc = extractLocation(text);
  const titled = name
    ? {
        type: inferEntityType(text),
        name,
        ...(loc ? { attributes: { location: loc } } : {}),
      } as KbActiveEntity
    : null;
  const fromFor = extractOfferingAfterFor(text);
  if (titled && fromFor && entitiesConflict(titled, fromFor)) return fromFor;
  const picked = titled ?? fromFor;
  if (!picked) return null;
  if (loc && !picked.attributes?.location) {
    return { ...picked, attributes: { ...(picked.attributes ?? {}), location: loc } };
  }
  return picked;
}

function mergeEntity(
  primary: KbActiveEntity | null | undefined,
  fallback: KbActiveEntity | null | undefined,
): KbActiveEntity | null {
  if (!primary && !fallback) return null;
  if (!primary) return fallback ?? null;
  if (!fallback) return primary;
  const location = primary.attributes?.location ?? fallback.attributes?.location;
  const name = primary.name.length >= fallback.name.length ? primary.name : fallback.name;
  const type = primary.type !== "unknown" ? primary.type : fallback.type;
  return {
    type,
    name,
    ...(location ? { attributes: { ...(fallback.attributes ?? {}), ...(primary.attributes ?? {}), location } } : primary.attributes ?? fallback.attributes),
  };
}

const ENTITY_TOKEN_STOP = new Set([
  "cs", "bpo", "inc", "pvt", "ltd", "llc", "the", "and", "job", "role", "process", "plan",
  "health", "insurance", "policy", "family", "floater", "coverage", "network",
]);

function significantEntityTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !ENTITY_TOKEN_STOP.has(w) && !STOP.has(w));
}

/** True when two offering names have no overlapping content tokens (Infosys vs Concentrix). */
export function entitiesConflict(
  a: KbActiveEntity | null | undefined,
  b: KbActiveEntity | null | undefined,
): boolean {
  if (!a?.name || !b?.name) return false;
  const ta = significantEntityTokens(a.name);
  const tb = new Set(significantEntityTokens(b.name));
  if (!ta.length || !tb.size) return false;
  return !ta.some((t) => tb.has(t));
}

/**
 * "for Infosys" / "for infosys" — STT often lowercases the new company name,
 * which Title-Case extraction misses.
 */
function extractOfferingAfterFor(text: string): KbActiveEntity | null {
  const m = text.match(
    /\bfor\s+(?:the\s+)?([A-Za-z][A-Za-z0-9&.-]*(?:\s+[A-Za-z][A-Za-z0-9&.-]*){0,3})(?:\s+(?:role|job|policy|process|plan))?\b/i,
  );
  if (!m?.[1]) return null;
  const name = m[1]
    .split(/\s+/)
    .filter((w) => {
      const lower = w.toLowerCase();
      if (STOP.has(lower) || ENTITY_STOP.has(lower)) return false;
      if (MALE_RE.test(w) || FEMALE_RE.test(w) || FRESHER_RE.test(w) || EXPERIENCED_RE.test(w)) return false;
      if (TOPIC_TERM_SET.has(lower)) return false;
      if (/^\d/.test(w)) return false;
      return true;
    })
    .join(" ")
    .trim();
  if (name.length < 3 || PROFILE_CONTAMINANT_RE.test(name) || isJunkEntitySpan(name)) return null;
  if (/\b(people|members|persons|days|years|months|hours)\b/i.test(name)) return null;
  if (/^(two|three|four|five|six|seven|eight|nine|ten|\d)/i.test(name)) return null;
  return { type: inferEntityType(text), name };
}

function asCandidate(entity: KbActiveEntity, source: KbEntitySource, confidence: number): KbCandidateEntity {
  return {
    name: entity.name,
    type: entity.type,
    source,
    confidence,
    ...(entity.attributes ? { attributes: entity.attributes } : {}),
  };
}

/**
 * Current-turn entity evidence only. Agent text is consulted solely for
 * known-offering aliases — never free-form proper-noun NER.
 */
export function resolveCandidateEntity(opts: {
  callerText: string;
  agentText: string;
  knownOfferings?: string[] | null;
}): KbCandidateEntity | null {
  const caller = opts.callerText.trim();
  const agent = opts.agentText.trim();
  if (!caller) return null;

  const callerAlias = matchKnownOffering(caller, opts.knownOfferings);
  if (callerAlias) {
    return {
      name: callerAlias.canonical,
      type: inferEntityType(caller),
      source: "kb_alias",
      confidence: callerAlias.confidence,
    };
  }

  const fromFor = extractOfferingAfterFor(caller);
  if (fromFor && !LANGUAGE_ENTITY_BLOCK.has(fromFor.name.toLowerCase().split(/\s+/)[0] ?? "")) {
    const known = matchKnownOffering(fromFor.name, opts.knownOfferings);
    return asCandidate(
      known ? { ...fromFor, name: known.canonical } : fromFor,
      known ? "kb_alias" : "caller_explicit",
      known ? known.confidence : 0.94,
    );
  }

  const titled = extractEntityName(caller);
  if (titled && !LANGUAGE_ENTITY_BLOCK.has(titled.toLowerCase().split(/\s+/)[0] ?? "") && !isJunkEntitySpan(titled)) {
    if (extractLocation(titled) && titled.split(/\s+/).length === 1) {
      /* city/site tokens are attributes, not offerings */
    } else {
    const known = matchKnownOffering(titled, opts.knownOfferings);
    const words = titled.trim().split(/\s+/).length;
    let confidence = 0.55;
    if (known) confidence = known.confidence;
    else if (words >= 2) confidence = 0.92;
    else if (titled.length >= 6) confidence = 0.88;
    else confidence = 0.7;
    if (confidence < KB_ENTITY_HIGH_CONFIDENCE && !known) {
      /* keep as low-confidence candidate for telemetry */
    }
    return {
      name: known?.canonical ?? titled,
      type: inferEntityType(caller),
      source: known ? "kb_alias" : "caller_explicit",
      confidence,
      ...(extractLocation(caller) ? { attributes: { location: extractLocation(caller)! } } : {}),
    };
    }
  }

  const agentAlias = matchKnownOffering(agent, opts.knownOfferings);
  if (agentAlias) {
    return {
      name: agentAlias.canonical,
      type: inferEntityType(agent),
      source: "kb_alias",
      confidence: agentAlias.alias.trim().split(/\s+/).length >= 2 ? 0.9 : 0.82,
    };
  }
  return null;
}

function applyCandidate(
  previous: KbActiveEntity | null | undefined,
  candidate: KbCandidateEntity | null,
  turnIndex: number,
): { active: KbActiveEntity | null; changed: boolean } {
  const prev = previous ?? null;
  if (!candidate || candidate.confidence < KB_ENTITY_HIGH_CONFIDENCE) {
    return { active: prev, changed: false };
  }
  const next: KbActiveEntity = {
    type: candidate.type,
    name: candidate.name,
    source: candidate.source,
    confidence: candidate.confidence,
    establishedTurn: turnIndex,
    ...(candidate.attributes ? { attributes: candidate.attributes } : {}),
  };
  if (!prev) return { active: next, changed: true };
  if (entitiesConflict(next, prev)) return { active: next, changed: true };
  const richer = next.name.length > prev.name.length ? next : { ...prev, confidence: Math.max(prev.confidence ?? 0, next.confidence ?? 0) };
  return { active: richer, changed: false };
}

function utteranceModifiers(text: string): string[] {
  const out: string[] = [];
  if (MALE_RE.test(text)) out.push("male candidate");
  if (FEMALE_RE.test(text)) out.push("female candidates");
  if (EXPERIENCED_RE.test(text)) out.push("experienced candidate");
  if (FRESHER_RE.test(text) && !/i(?:'m| am) a fresher/i.test(text)) out.push("fresher");
  const members = text.match(/\b(\d+|two|three|four|five|six)\s+(people|members|persons)\b/i);
  if (members) out.push(`${members[1]} members`);
  return out;
}

function focusTerms(text: string, entityName: string | null): string[] {
  const entityTokens = new Set((entityName ?? "").toLowerCase().split(/\s+/).filter(Boolean));
  const terms: string[] = [];
  for (const raw of text.split(/[\s,?.!]+/)) {
    const tok = raw.trim();
    if (!tok) continue;
    const lower = tok.toLowerCase().replace(/^[^a-z0-9\u00C0-\uFFFF]+|[^a-z0-9\u00C0-\uFFFF]+$/giu, "");
    if (!lower || STOP.has(lower)) continue;
    if (entityTokens.has(lower)) continue;
    if (PROFILE_CONTAMINANT_RE.test(lower)) continue;
    if (/^\d+k?$/.test(lower)) continue;
    terms.push(tok);
  }
  return terms.slice(0, 8);
}

function looksSelfContained(utterance: string, entity: KbActiveEntity | null): boolean {
  const n = wordCount(utterance);
  const hasEntityAlready = entity
    ? utterance.toLowerCase().includes(entity.name.toLowerCase().split(/\s+/)[0] ?? "\0")
    : /\b[A-Z][a-zA-Z]{3,}\b/.test(utterance);
  const hasTopic = detectTopic(utterance) != null;
  // A named offering + topic is a new question even if "? + ≤8 words" looks referential.
  if (n >= 6 && hasEntityAlready && hasTopic && !REFERENTIAL_START_RE.test(utterance)) return true;
  if (isReferentialQuery(utterance)) return false;
  return n >= 8 && hasEntityAlready && hasTopic;
}

function joinQuery(parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    for (const tok of part.split(/\s+/).filter(Boolean)) {
      const key = tok.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tok);
    }
  }
  let q = out.join(" ").replace(/\s+/g, " ").trim();
  if (q.length > KB_QUERY_MAX_CHARS) q = q.slice(0, KB_QUERY_MAX_CHARS).trim();
  return q;
}

function strategyFor(opts: {
  usedEntity: boolean;
  usedTopic: boolean;
  usedPrevTurn: boolean;
  contextualized: boolean;
}): KbQueryStrategy {
  if (!opts.contextualized) return "raw";
  if (opts.usedEntity && opts.usedTopic) return "entity_topic_augmented";
  if (opts.usedEntity) return "entity_augmented";
  if (opts.usedPrevTurn) return "previous_turn_augmented";
  if (opts.usedTopic) return "topic_augmented";
  return "previous_turn_augmented";
}

function provenanceBase(input: KbQueryBuilderInput, extra: {
  searchQuery: string;
  contextualized: boolean;
  queryStrategy: KbQueryStrategy;
  topic: string | null;
  activeEntity: KbActiveEntity | null;
  activeTopic: string | null;
  candidateEntity: KbCandidateEntity | null;
  entitySource: KbEntitySource | null;
  entityConfidence: number | null;
  entityAgeTurns: number;
  topicSource: KbTopicSource | null;
  topicAgeTurns: number;
  entityChanged: boolean;
  topicCleared: boolean;
  fallbackUsed: boolean;
}): Omit<KbQueryBuildResult, "builderMs"> {
  return {
    rawQuery: (input.utterance ?? "").trim(),
    entities: extra.activeEntity ? [extra.activeEntity.name] : [],
    ...extra,
  };
}

/**
 * Pure builder. Prefer `runKbQueryBuilder` at the call site so failures
 * collapse to the raw transcript.
 */
export function buildKbQuery(input: KbQueryBuilderInput): Omit<KbQueryBuildResult, "builderMs"> {
  const rawQuery = (input.utterance ?? "").trim();
  const turnIndex = input.turnIndex ?? 0;
  const utteranceClass = input.utteranceClass ?? "unclear";
  const prevEntity = input.activeEntity ?? null;
  const prevTopic = input.activeTopic ?? null;

  if (!rawQuery) {
    return provenanceBase(input, {
      searchQuery: "",
      contextualized: false,
      queryStrategy: "fallback_raw",
      topic: prevTopic,
      activeEntity: prevEntity,
      activeTopic: prevTopic,
      candidateEntity: null,
      entitySource: prevEntity?.source ?? (prevEntity ? "previous_validated" : null),
      entityConfidence: prevEntity?.confidence ?? (prevEntity ? 1 : null),
      entityAgeTurns: ageTurns(turnIndex, prevEntity?.establishedTurn ?? input.entityEstablishedTurn),
      topicSource: prevTopic ? "previous_validated" : null,
      topicAgeTurns: ageTurns(turnIndex, input.topicEstablishedTurn),
      entityChanged: false,
      topicCleared: false,
      fallbackUsed: true,
    });
  }

  const analysisText = stripLeadingAcks(rawQuery);
  const prevAgent = (input.previousAgentTurn ?? "").trim();
  const topicFromUtterance = detectTopic(analysisText);
  const topicFromPrev = detectTopic(prevAgent);

  const skipAttach =
    utteranceClass === "language_control"
    || utteranceClass === "acknowledgement"
    || utteranceClass === "repeat_request"
    || utteranceClass === "call_control"
    || utteranceClass === "caller_fact";

  const candidate = skipAttach
    ? null
    : resolveCandidateEntity({
        callerText: analysisText,
        agentText: prevAgent,
        knownOfferings: input.knownOfferings,
      });

  const applied = applyCandidate(prevEntity, candidate, turnIndex);
  let activeEntity = applied.active;
  const entityChanged = applied.changed;
  if (activeEntity && !activeEntity.attributes?.location) {
    const loc = extractLocation(analysisText);
    if (loc) activeEntity = { ...activeEntity, attributes: { ...(activeEntity.attributes ?? {}), location: loc } };
  }
  if (activeEntity && !activeEntity.source) {
    activeEntity = { ...activeEntity, source: "previous_validated", confidence: activeEntity.confidence ?? 1 };
  }

  const referential = !skipAttach && isReferentialQuery(analysisText);
  const picked = pickTopic(topicFromUtterance, topicFromPrev, prevTopic, {
    entityChanged,
    referential,
    utteranceClass,
  });
  const activeTopic = picked.topic;
  const highCandidate = Boolean(candidate && candidate.confidence >= KB_ENTITY_HIGH_CONFIDENCE);

  const finish = (
    searchQuery: string,
    queryStrategy: KbQueryStrategy,
    contextualized: boolean,
    fallbackUsed: boolean,
    used?: { entity?: boolean; topic?: boolean; prev?: boolean },
  ) =>
    provenanceBase(input, {
      searchQuery,
      contextualized,
      queryStrategy: contextualized
        ? strategyFor({
            usedEntity: used?.entity ?? false,
            usedTopic: used?.topic ?? false,
            usedPrevTurn: used?.prev ?? false,
            contextualized: true,
          })
        : queryStrategy,
      topic: activeTopic,
      activeEntity,
      activeTopic,
      candidateEntity: candidate,
      entitySource: activeEntity?.source ?? null,
      entityConfidence: activeEntity?.confidence ?? null,
      entityAgeTurns: ageTurns(turnIndex, activeEntity?.establishedTurn ?? (entityChanged ? turnIndex : input.entityEstablishedTurn)),
      topicSource: picked.source,
      topicAgeTurns: ageTurns(turnIndex, topicFromUtterance || entityChanged || picked.cleared ? turnIndex : input.topicEstablishedTurn),
      entityChanged,
      topicCleared: picked.cleared,
      fallbackUsed,
    });

  if (skipAttach) {
    return finish(rawQuery, "raw", false, false);
  }

  const selfContained = looksSelfContained(analysisText, highCandidate && candidate
    ? { type: candidate.type, name: candidate.name }
    : activeEntity);
  if (selfContained) {
    return finish(analysisText, "raw", false, false, { entity: highCandidate, topic: Boolean(topicFromUtterance) });
  }

  const modifiers = utteranceModifiers(analysisText);
  const usedPrevTurn = Boolean(
    !entityChanged && (
      (topicFromPrev && !topicFromUtterance && referential)
      || (modifiers.length > 0 && (topicFromPrev || activeTopic) && referential)
    ),
  );
  const usedEntity = Boolean(activeEntity && (referential || highCandidate));
  const usedTopic = Boolean(activeTopic && (referential || topicFromUtterance));

  const parts: string[] = [];
  if (activeEntity && (highCandidate || referential)) {
    parts.push(activeEntity.name);
    if (activeEntity.attributes?.location) parts.push(activeEntity.attributes.location);
  }
  for (const m of modifiers) parts.push(m);
  if (activeTopic && (referential || topicFromUtterance)) parts.push(topicSearchTerms(activeTopic));
  parts.push(...focusTerms(analysisText, activeEntity?.name ?? null));

  let searchQuery = joinQuery(parts);
  if (!searchQuery) return finish(rawQuery, "fallback_raw", false, true);
  const contextualized = searchQuery.toLowerCase() !== rawQuery.toLowerCase();
  if (!contextualized) return finish(rawQuery, "raw", false, false, { entity: usedEntity, topic: usedTopic, prev: usedPrevTurn });
  return finish(searchQuery, "raw", true, false, { entity: usedEntity, topic: usedTopic, prev: usedPrevTurn });
}

function ageTurns(now: number, established: number | null | undefined): number {
  if (established == null || now <= 0) return 0;
  return Math.max(0, now - established);
}

export function runKbQueryBuilder(input: KbQueryBuilderInput): KbQueryBuildResult {
  const startedAt = performance.now();
  const rawQuery = (input.utterance ?? "").trim();
  try {
    const built = buildKbQuery(input);
    const searchQuery = built.searchQuery.trim() || rawQuery;
    return {
      ...built,
      searchQuery,
      fallbackUsed: built.fallbackUsed || !built.searchQuery.trim(),
      builderMs: roundMs(startedAt),
    };
  } catch {
    return {
      rawQuery,
      searchQuery: rawQuery,
      contextualized: false,
      queryStrategy: "fallback_raw",
      topic: null,
      entities: [],
      activeEntity: input.activeEntity ?? null,
      activeTopic: input.activeTopic ?? null,
      candidateEntity: null,
      entitySource: input.activeEntity?.source ?? null,
      entityConfidence: input.activeEntity?.confidence ?? null,
      entityAgeTurns: 0,
      topicSource: null,
      topicAgeTurns: 0,
      entityChanged: false,
      topicCleared: false,
      builderMs: roundMs(startedAt),
      fallbackUsed: true,
    };
  }
}

export function recentKbTurns(
  messages: Array<{ role: string; content: string }>,
): { previousAgentTurn: string; previousCallerTurn: string } {
  let previousAgentTurn = "";
  let previousCallerTurn = "";
  let skippedCurrentUser = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (!skippedCurrentUser && m.role === "user") {
      skippedCurrentUser = true;
      continue;
    }
    if (m.role === "assistant" && !previousAgentTurn) previousAgentTurn = m.content;
    else if (m.role === "user" && !previousCallerTurn) previousCallerTurn = m.content;
    if (previousAgentTurn && previousCallerTurn) break;
  }
  return { previousAgentTurn, previousCallerTurn };
}

export function kbHitSummary(result: {
  text?: string;
  entries?: Array<{ id: number; title?: string | null; content?: string | null }>;
} | null): { topHit: string | null; snippet: string | null; ids: number[]; count: number } {
  if (!result) return { topHit: null, snippet: null, ids: [], count: 0 };
  const entries = result.entries ?? [];
  const ids = entries.slice(0, 5).map((e) => e.id);
  const snippetSource = entries[0]?.content || result.text || "";
  const snippet = snippetSource
    ? snippetSource.replace(/\s+/g, " ").trim().slice(0, 180)
    : null;
  const topHit = entries[0]?.title?.trim() || snippet;
  return { topHit, snippet, ids, count: entries.length || (result.text ? 1 : 0) };
}

export function kbHitOverlap(a: number[], b: number[]): string {
  if (!a.length && !b.length) return "0/0";
  const set = new Set(a);
  const n = b.filter((id) => set.has(id)).length;
  return `${n}/${Math.max(a.length, b.length, 1)}`;
}

/* ── Phase 3C — conservative augmentation (Strategy B) ───────────────────
 * Frozen 3B (`buildKbQuery`) stays Strategy A. This builder does not replace it.
 *
 * Ask "what knowledge object is being discussed?", never "what proper noun
 * can I extract?". Query = augment raw with a validated object; do not rewrite.
 *
 * Level 0  self-contained          → raw
 * Level 1  entity-dependent        → entity + raw
 * Level 2  entity+topic dependent  → entity + topic + raw
 *          (only strongly referential, no knowledge payload in the utterance)
 */

export type KbQueryLevel = 0 | 1 | 2;

export type KbKnowledgeObject = {
  id: string;
  canonical: string;
  aliases: string[];
};

export type KbConservativeBuildResult = Omit<KbQueryBuildResult, "builderMs"> & {
  queryLevel: KbQueryLevel;
  knowledgeObjectId: string | null;
};

const FILE_JUNK_RE = /\((?:part|page)\s*\d+\)|\.(?:md|docx?|pdf|txt|csv)\b/ig;

const HARVEST_SKIP = /knowledge base|section \d|purpose|audience|keywords|common (?:belief|misunderstanding)|policy facts|why it matters|plan overview|overview|objection/i;

const FEATURE_HEAD = new Set([
  "sum", "insured", "cover", "coverage", "bonus", "discount", "document", "documents",
  "required", "waiting", "premium", "payback", "maternity", "newborn", "wellness",
  "tenure", "multiplier", "cumulative", "instant", "modification", "product", "name",
  "uin", "comprehensive", "options", "claim", "shield", "hospital", "network",
  "cashless", "high", "value", "benefits", "loyalty", "reset", "power", "booster",
  "ped", "optional", "feature", "features", "treatment", "sub", "limits",
  "automatic", "recharge", "comparison", "quick", "table", "unlimited",
]);

const BRAND_TOKEN_RE = /^(care|elevate|icici|lombard|star|supreme|ultimate|joy|finserv|concentrix|infosys|merlin)$/i;

export function looksOfferingName(name: string): boolean {
  const cleaned = name.replace(/^\d+[.)]\s*/, "").replace(/\s+/g, " ").trim();
  if (cleaned.length < 4 || cleaned.length > 60) return false;
  if (HARVEST_SKIP.test(cleaned)) return false;
  if (!/[A-Za-z]/.test(cleaned)) return false;
  if (/^q\s*:/i.test(cleaned)) return false;
  const tokens = cleaned.split(" ").filter(Boolean);
  if (!tokens.length || tokens.length > 6) return false;
  if (tokens.length >= 2 && cleaned === cleaned.toUpperCase() && /[A-Z]/.test(cleaned)) return false;
  const lower = tokens.map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, "")).filter(Boolean);
  if (!lower.length) return false;
  if (lower.every((t) => FEATURE_HEAD.has(t) || ALIAS_DROP.has(t) || t.length < 3)) return false;
  if (lower.some((t) => FEATURE_HEAD.has(t))) return false;
  if (tokens.some((t) => BRAND_TOKEN_RE.test(t))) return true;
  const titleish = tokens.filter((t) => /^[A-Z]/.test(t)).length >= 2;
  return titleish && tokens.length <= 4 && !FEATURE_HEAD.has(lower[0]!);
}

/** Prefer "Elevate" over "Elevate Voice Agent KB Complete.md (part 1)". */
export function canonicalKnowledgeName(title: string): string {
  const stripped = title
    .replace(FILE_JUNK_RE, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return title.trim();
  const tokens = stripped
    .split(" ")
    .map((t) => t.replace(/[^A-Za-z0-9&.]/g, ""))
    .filter((t) => t.length >= 2 && !ALIAS_DROP.has(t.toLowerCase()));
  if (!tokens.length) {
    const fallback = stripped.split(" ").find((t) => t.length >= 4);
    return fallback ?? stripped;
  }
  const joined = tokens.join(" ").trim();
  return joined.length >= 3 ? joined : (tokens[0] ?? stripped);
}

export function harvestOfferingNamesFromText(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const push = (raw: string) => {
    const name = raw.replace(/\s*[—–-]\s*[\s\S]*$/, "").replace(/\s+/g, " ").trim();
    if (!looksOfferingName(name)) return;
    out.push(name.replace(/^\d+[.)]\s*/, "").trim());
  };
  for (const m of text.matchAll(/\*\*([^*]{3,80})\*\*/g)) push(m[1] ?? "");
  for (const m of text.matchAll(/^#{1,3}\s+(.+)$/gm)) {
    const heading = (m[1] ?? "").trim();
    if (!HARVEST_SKIP.test(heading)) push(heading);
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const n of out) {
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(n);
  }
  return unique.slice(0, 40);
}

export function buildKnowledgeObjects(titles: string[] | null | undefined): KbKnowledgeObject[] {
  const byId = new Map<string, KbKnowledgeObject>();
  for (const title of titles ?? []) {
    const t = title.trim();
    if (!t) continue;
    const canonical = canonicalKnowledgeName(t);
    const id = canonical.toLowerCase();
    const aliases = [canonical, t, ...aliasesFromTitle(t), ...aliasesFromTitle(canonical)];
    const existing = byId.get(id);
    const merged = existing ? [...existing.aliases, ...aliases] : aliases;
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const a of merged) {
      const cleaned = a.replace(FILE_JUNK_RE, " ").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
      if (cleaned.length < 4) continue;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      if (ALIAS_DROP.has(key)) continue;
      seen.add(key);
      unique.push(cleaned);
    }
    unique.sort((a, b) => b.length - a.length);
    byId.set(id, { id, canonical, aliases: unique.slice(0, 24) });
  }
  return [...byId.values()];
}

export function matchKnowledgeObject(
  text: string,
  objects: KbKnowledgeObject[],
): KbKnowledgeObject | null {
  const t = text.trim();
  if (!t || !objects.length) return null;
  const rows: Array<{ obj: KbKnowledgeObject; alias: string }> = [];
  for (const obj of objects) {
    for (const alias of obj.aliases) rows.push({ obj, alias });
  }
  rows.sort((a, b) => b.alias.length - a.alias.length);
  for (const row of rows) {
    if (row.alias.length < 4) continue;
    const re = new RegExp(`(?:^|[^a-z0-9])${escapeRe(row.alias)}(?:[^a-z0-9]|$)`, "i");
    if (!re.test(t)) continue;
    if (/\b(don't|dont|take|not)\s+care\b|\bcare\s+(about|for)\b/i.test(t) && /^care$/i.test(row.alias)) {
      continue;
    }
    return row.obj;
  }
  return null;
}

const STRONG_REF_START_RE =
  /^(?:and|what about|how much|how many|is that|is it|is this|for my|and\s)/i;
const STRONG_REF_RE =
  /\b(?:what about (?:that|it|this)|is it free|and for my (?:wife|husband|son|daughter|parents?)|the (?:1st|first|second) one|that plan|this plan)\b/i;
const STRONG_REF_INDIC_RE = /அந்த (?:plan|பிளான்)|இந்த பிளான்|அது என்னது|1st one/iu;

/** Tight referential — not "any short question". */
export function isStronglyReferential(utterance: string): boolean {
  const t = utterance.trim();
  if (!t) return false;
  if (STRONG_REF_START_RE.test(t) || STRONG_REF_RE.test(t) || STRONG_REF_INDIC_RE.test(t)) return true;
  if (wordCount(t) <= 4 && /\b(that|this|it|அது|இது)\b/iu.test(t)) return true;
  return false;
}

const PAYLOAD_RE =
  /\d|\b(?:crore|lakh|percent|waiting|add-?ons?|claim|bonus|maternity|sum insured|premium|coverage|eligib|exclusion|hospital|notice|transport|salary|ctc)\b|லட்சம்|கோடி|பிரீமியம்/i;

const CATALOG_QUESTION_RE =
  /\b(?:what|which|other|each|all|every)\b.{0,40}\bplans?\b|\bplans?\b.{0,40}\b(?:what|which|explain|tell|list)|பிளான்ஸ்|பிளான்க|பிளான்ட்|ஒவ்வொரு பிளான்|கவரேஜஸ்/i;

/** Numbers, named topics, or other terms that already carry the search payload. */
export function hasKnowledgePayload(utterance: string): boolean {
  const t = utterance.trim();
  if (!t) return false;
  if (detectTopic(t)) return true;
  return PAYLOAD_RE.test(t);
}

function isCatalogQuestion(utterance: string): boolean {
  return CATALOG_QUESTION_RE.test(utterance) && !isStronglyReferential(utterance);
}

function utteranceContainsName(utterance: string, name: string | null | undefined): boolean {
  if (!name) return false;
  const re = new RegExp(`(?:^|[^a-z0-9])${escapeRe(name)}(?:[^a-z0-9]|$)`, "i");
  return re.test(utterance);
}

function augmentRaw(prefix: string[], raw: string): string {
  const lower = raw.toLowerCase();
  const keep: string[] = [];
  const seen = new Set<string>();
  for (const p of prefix) {
    const t = p.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    if (lower.includes(key)) continue;
    seen.add(key);
    keep.push(t);
  }
  const q = [...keep, raw].join(" ").replace(/\s+/g, " ").trim();
  return q.length > KB_QUERY_MAX_CHARS ? q.slice(0, KB_QUERY_MAX_CHARS).trim() : q;
}

/**
 * Strategy B. Entities only from attached knowledge objects. Default query is
 * `[validated entity] + [raw utterance]`. Topic is ephemeral.
 */
export function buildKbQueryConservative(input: KbQueryBuilderInput): KbConservativeBuildResult {
  const rawQuery = (input.utterance ?? "").trim();
  const turnIndex = input.turnIndex ?? 0;
  const utteranceClass = input.utteranceClass ?? "unclear";
  const objects = buildKnowledgeObjects(input.knownOfferings);
  const prevEntity = input.activeEntity ?? null;
  const prevTopic = input.activeTopic ?? null;

  const empty = (extra: Partial<KbConservativeBuildResult> = {}): KbConservativeBuildResult => ({
    rawQuery,
    searchQuery: rawQuery,
    contextualized: false,
    queryStrategy: extra.queryStrategy ?? "raw",
    topic: extra.activeTopic ?? null,
    entities: extra.activeEntity ? [extra.activeEntity.name] : [],
    activeEntity: extra.activeEntity ?? prevEntity,
    activeTopic: extra.activeTopic ?? null,
    candidateEntity: extra.candidateEntity ?? null,
    entitySource: extra.entitySource ?? extra.activeEntity?.source ?? null,
    entityConfidence: extra.entityConfidence ?? extra.activeEntity?.confidence ?? null,
    entityAgeTurns: extra.entityAgeTurns ?? 0,
    topicSource: extra.topicSource ?? null,
    topicAgeTurns: extra.topicAgeTurns ?? 0,
    entityChanged: extra.entityChanged ?? false,
    topicCleared: extra.topicCleared ?? false,
    fallbackUsed: extra.fallbackUsed ?? false,
    queryLevel: extra.queryLevel ?? 0,
    knowledgeObjectId: extra.knowledgeObjectId ?? null,
  });

  if (!rawQuery) {
    return empty({ queryStrategy: "fallback_raw", fallbackUsed: true, activeEntity: prevEntity, activeTopic: prevTopic });
  }

  const analysisText = stripLeadingAcks(rawQuery);
  const prevAgent = (input.previousAgentTurn ?? "").trim();
  const skipAttach =
    utteranceClass === "language_control"
    || utteranceClass === "acknowledgement"
    || utteranceClass === "repeat_request"
    || utteranceClass === "call_control"
    || utteranceClass === "caller_fact";

  const callerObj = skipAttach ? null : matchKnowledgeObject(analysisText, objects);
  const agentObj = skipAttach ? null : matchKnowledgeObject(prevAgent, objects);
  const matched = callerObj ?? agentObj;
  const prevStillValid = prevEntity && objects.some((o) => o.canonical.toLowerCase() === prevEntity.name.toLowerCase());

  let activeEntity: KbActiveEntity | null = null;
  let entityChanged = false;
  let candidateEntity: KbCandidateEntity | null = null;
  let knowledgeObjectId: string | null = null;

  if (matched) {
    candidateEntity = {
      name: matched.canonical,
      type: inferEntityType(`${matched.canonical} ${analysisText}`),
      source: "kb_alias",
      confidence: callerObj ? 0.96 : 0.9,
    };
    knowledgeObjectId = matched.id;
    const next: KbActiveEntity = {
      type: candidateEntity.type,
      name: matched.canonical,
      source: "kb_alias",
      confidence: candidateEntity.confidence,
      establishedTurn: turnIndex,
    };
    entityChanged = !prevEntity || entitiesConflict(next, prevEntity) || prevEntity.name.toLowerCase() !== next.name.toLowerCase();
    activeEntity = next;
  } else if (prevStillValid) {
    activeEntity = {
      ...prevEntity!,
      source: prevEntity!.source ?? "previous_validated",
    };
    knowledgeObjectId = prevEntity!.name.toLowerCase();
  }

  const topicFromUtterance = detectTopic(analysisText);
  const strongRef = !skipAttach && isStronglyReferential(analysisText);
  const payload = hasKnowledgePayload(analysisText);
  let activeTopic: string | null = null;
  let topicSource: KbTopicSource | null = null;
  let topicCleared = false;

  if (skipAttach && (utteranceClass === "language_control" || utteranceClass === "call_control")) {
    topicCleared = Boolean(prevTopic);
  } else if (topicFromUtterance) {
    activeTopic = topicFromUtterance;
    topicSource = "caller_explicit";
  } else if (entityChanged) {
    topicCleared = Boolean(prevTopic);
  } else if (strongRef && !payload && prevTopic) {
    const prevAge = ageTurns(turnIndex, input.topicEstablishedTurn);
    if (prevAge <= 1) {
      activeTopic = prevTopic;
      topicSource = "previous_validated";
    } else {
      topicCleared = Boolean(prevTopic);
    }
  } else {
    topicCleared = Boolean(prevTopic);
  }

  const finish = (
    searchQuery: string,
    level: KbQueryLevel,
    strategy: KbQueryStrategy,
    contextualized: boolean,
  ): KbConservativeBuildResult => ({
    rawQuery,
    searchQuery,
    contextualized,
    queryStrategy: strategy,
    topic: activeTopic,
    entities: activeEntity ? [activeEntity.name] : [],
    activeEntity,
    activeTopic,
    candidateEntity,
    entitySource: activeEntity?.source ?? null,
    entityConfidence: activeEntity?.confidence ?? null,
    entityAgeTurns: ageTurns(turnIndex, activeEntity?.establishedTurn ?? (entityChanged ? turnIndex : input.entityEstablishedTurn)),
    topicSource,
    topicAgeTurns: ageTurns(turnIndex, topicFromUtterance || entityChanged || topicCleared ? turnIndex : input.topicEstablishedTurn),
    entityChanged,
    topicCleared,
    fallbackUsed: false,
    queryLevel: level,
    knowledgeObjectId,
  });

  if (skipAttach) return finish(rawQuery, 0, "raw", false);

  const namesObject = Boolean(callerObj);
  const catalogQ = isCatalogQuestion(analysisText);
  const selfContained = namesObject && (payload || !strongRef);
  if (selfContained || (namesObject && payload) || catalogQ) {
    return finish(rawQuery, 0, "raw", false);
  }

  const topicRequired = strongRef && !payload && Boolean(activeTopic);
  if (activeEntity && topicRequired) {
    const q = augmentRaw([activeEntity.name, topicSearchTerms(activeTopic)], rawQuery);
    return finish(q, 2, "entity_topic_augmented", q.toLowerCase() !== rawQuery.toLowerCase());
  }
  if (activeEntity && !utteranceContainsName(rawQuery, activeEntity.name)) {
    const q = augmentRaw([activeEntity.name], rawQuery);
    return finish(q, 1, "entity_augmented", q.toLowerCase() !== rawQuery.toLowerCase());
  }
  return finish(rawQuery, 0, "raw", false);
}

export function runKbQueryBuilderConservative(input: KbQueryBuilderInput): KbQueryBuildResult & {
  queryLevel: KbQueryLevel;
  knowledgeObjectId: string | null;
} {
  const startedAt = performance.now();
  const rawQuery = (input.utterance ?? "").trim();
  try {
    const built = buildKbQueryConservative(input);
    const searchQuery = built.searchQuery.trim() || rawQuery;
    return {
      ...built,
      searchQuery,
      fallbackUsed: built.fallbackUsed || !built.searchQuery.trim(),
      builderMs: roundMs(startedAt),
    };
  } catch {
    return {
      rawQuery,
      searchQuery: rawQuery,
      contextualized: false,
      queryStrategy: "fallback_raw",
      topic: null,
      entities: [],
      activeEntity: input.activeEntity ?? null,
      activeTopic: input.activeTopic ?? null,
      candidateEntity: null,
      entitySource: input.activeEntity?.source ?? null,
      entityConfidence: input.activeEntity?.confidence ?? null,
      entityAgeTurns: 0,
      topicSource: null,
      topicAgeTurns: 0,
      entityChanged: false,
      topicCleared: false,
      builderMs: roundMs(startedAt),
      fallbackUsed: true,
      queryLevel: 0,
      knowledgeObjectId: null,
    };
  }
}
