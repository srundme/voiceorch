/**
 * Phase 2 — Retrieval Gate.
 *
 * One question: does this utterance need external factual knowledge?
 * Deterministic, no LLM. Fail open (uncertain / error → retrieve).
 *
 * KB_RETRIEVAL_GATE=off     current production (default)
 * KB_RETRIEVAL_GATE=shadow  current production + log the decision
 * KB_RETRIEVAL_GATE=on      skip live KB search when the gate says skip
 *
 * Query construction, bake, embeddings, and RRF are unchanged.
 */

import { isBackchannelOnlyUtterance, isCallerAttentionUtterance } from "./transcriptQuality.js";

export type KbRetrievalGateMode = "off" | "shadow" | "on";
export type KbRetrievalDecision = "retrieve" | "skip";
export type KbRetrievalGateReason =
  | "factual_question"
  | "conversational"
  | "caller_fact"
  | "unclear";

export type KbRetrievalGateResult = {
  decision: KbRetrievalDecision;
  reason: KbRetrievalGateReason;
  utterance: string;
  decisionMs: number;
};

const UTTERANCE_LOG_MAX = 200;

/** Repeat / "I didn't catch that" — conversation repair, not a KB question. */
const REPEAT_OR_HEAR_RES: RegExp[] = [
  /^(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:repeat(?:\s+that|\s+it)?|say\s+(?:that|it)\s+again|come\s+again|pardon(?:\s+me)?)\s*\??$/i,
  /^(?:what(?:'s| is)? that|huh|sorry|what)\s*\??$/i,
  /\bwhat did you (?:say|tell)\b/i,
  /\b(?:say that again|once more|one more time)\b/i,
  /மீண்டும் சொல்ல|திரும்ப சொல்ல/u,
  /फिर से (?:बोल|कह)/u,
];

const FAREWELL_THANKS_RE =
  /^(?:bye|goodbye|good bye|thanks|thank you|thankyou|that's all|thats all|ok bye|okay bye)(?:\s+(?:sir|madam|ma'?am))?\s*[.!]?\s*$/i;

/** Yes/no/ok — including "No", which transcriptQuality treats as an interrupt phrase. */
const CONVERSATIONAL_ACK_RE =
  /^(yes|yeah|yep|yup|no|nope|nah|ok|okay|sure|right|fine|hmm|hm|mm)(?:\s+(?:sir|madam|ma'?am))?[.!]?\s*$/i;

/** WH / yes-no policy questions — needs attached knowledge. */
const QUESTION_SHAPE_RE =
  /(?:\?|？|\bwhat\b|\bwhich\b|\bwhen\b|\bwhere\b|\bwhy\b|\bwho\b|\bwhose\b|\bhow\s+(?:much|many|long|far)\b|\bwhat about\b|\bis there\b|\bare there\b|\bdo they\b|\bdoes (?:it|the|this)\b|\bis (?:it|the|this|transport|salary|cab|hostel)\b|\bcan (?:i|we|freshers?|graduates?|a fresher)\b|\bcan fresher\b)/i;

const QUESTION_INDIC_RE =
  /(?:என்ன|எவ்வளவு|எப்படி|எங்க|ஏன்|யாரு|முடியுமா|கிடைக்குமா|இருக்கா|कितना|क्या |कौन |कहाँ |कितने )/u;

/** Topic words that still need KB even without a question mark ("salary", "transport"). */
const DOMAIN_HINT_RE =
  /(?:\bapply\b|\bsalary\b|\bctc\b|\bstipend\b|\btransport\b|\bcab\b|\bhostel\b|\bcanteen\b|\bcovered\b|\bcoverage\b|\bexclusion|\bhospital|\bpremium\b|\bpolicy\b|\bpf\b|\besi\b|\binsurance\b|\bvacanc|\bopening|\bfee\b|\bfees\b|\bbond\b|\beligib|\bnight shift\b|\bwork from home\b|\bwfh\b|\bjoining\b|\bincentive|\bdocument|\baadhaar|\bpan\b|சம்பள|சம்பளம்|டிரான்ஸ்போர்ட்|பேருந்து|ஹாஸ்டல்|கவர|பாலிசி|सैलरी|ट्रांसपोर्ट|कवर|पॉलिसी)/i;

/** Self-reported profile — the caller is giving facts, not asking for KB. */
const CALLER_FACT_RES: RegExp[] = [
  /\bmy name is\b/i,
  /\bi(?:'m| am) from\b/i,
  /\bi live (?:in|at)\b/i,
  /\bi stay (?:in|at)\b/i,
  /\bi(?:'m| am) calling from\b/i,
  /\bi(?:'m| am) (?:a |an )?(?:fresher|graduate|student)\b/i,
  /\bi have (?:\d+|two|three|four|five|six|seven|eight|nine|ten)(?:\.\d)?\s*(?:years?|yrs?|months?)\b/i,
  /\bmy (?:qualification|experience|notice(?:\s+period)?|location|age|number|phone|current (?:ctc|salary)|expected (?:ctc|salary))\b/i,
  /\bi (?:completed|passed|studied)\b/i,
  /\bi speak\b/i,
  /என் பெயர்|என்னோட பேரு/u,
  /நான் .{0,24}(?:லிருந்து|இல் இருந்து)/u,
  /मेरा नाम/u,
];

function clipUtterance(raw: string): string {
  const t = raw.trim();
  if (t.length <= UTTERANCE_LOG_MAX) return t;
  return `${t.slice(0, UTTERANCE_LOG_MAX)}…`;
}

function roundMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

export function resolveKbRetrievalGateMode(
  env: NodeJS.ProcessEnv = process.env,
): KbRetrievalGateMode {
  const raw = (env["KB_RETRIEVAL_GATE"] ?? "off").trim().toLowerCase();
  if (raw === "shadow" || raw === "on") return raw;
  return "off";
}

function isRepeatOrHearAsk(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return REPEAT_OR_HEAR_RES.some((re) => re.test(t));
}

function looksQuestion(text: string): boolean {
  return QUESTION_SHAPE_RE.test(text) || QUESTION_INDIC_RE.test(text);
}

function looksDomainHint(text: string): boolean {
  return DOMAIN_HINT_RE.test(text);
}

function looksCallerFact(text: string): boolean {
  return CALLER_FACT_RES.some((re) => re.test(text));
}

/**
 * Pure decision. Callers that need timing/error wrapping should use
 * `runKbRetrievalGate`. Uncertain → retrieve.
 */
export function decideKbRetrieval(utterance: string): {
  decision: KbRetrievalDecision;
  reason: KbRetrievalGateReason;
} {
  const t = utterance.trim();
  if (!t) return { decision: "skip", reason: "conversational" };

  // Repeat/hear repair before WH words — "what?" is not a KB query.
  if (isRepeatOrHearAsk(t)) return { decision: "skip", reason: "conversational" };

  if (looksQuestion(t)) return { decision: "retrieve", reason: "factual_question" };

  if (
    CONVERSATIONAL_ACK_RE.test(t)
    || isBackchannelOnlyUtterance(t)
    || isCallerAttentionUtterance(t)
    || FAREWELL_THANKS_RE.test(t)
  ) {
    return { decision: "skip", reason: "conversational" };
  }

  if (looksCallerFact(t)) return { decision: "skip", reason: "caller_fact" };

  if (looksDomainHint(t)) return { decision: "retrieve", reason: "factual_question" };

  return { decision: "retrieve", reason: "unclear" };
}

/** Timed, fail-open wrapper for the live pipeline. */
export function runKbRetrievalGate(utterance: string): KbRetrievalGateResult {
  const startedAt = performance.now();
  const clipped = clipUtterance(utterance);
  try {
    const { decision, reason } = decideKbRetrieval(utterance);
    return { decision, reason, utterance: clipped, decisionMs: roundMs(startedAt) };
  } catch {
    return {
      decision: "retrieve",
      reason: "unclear",
      utterance: clipped,
      decisionMs: roundMs(startedAt),
    };
  }
}

export function shouldSkipKbRetrieval(
  mode: KbRetrievalGateMode,
  decision: KbRetrievalDecision,
): boolean {
  return mode === "on" && decision === "skip";
}
