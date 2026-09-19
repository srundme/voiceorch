/**
 * Phase 2 — Retrieval Gate.
 *
 * One question: does this utterance need external factual knowledge?
 * Deterministic, no LLM. Fail open (uncertain / error → retrieve).
 *
 * KB_RETRIEVAL_GATE=off     current production (default)
 * KB_RETRIEVAL_GATE=shadow  current production + log the decision
 * KB_RETRIEVAL_GATE=on      skip live KB search when the gate says skip
 * KB_PHASE3_CANARY_AGENT_IDS  listed agents run as gate=on regardless of the
 *                             global flag. Empty = nobody extra.
 *
 * Query construction, bake, embeddings, and RRF are unchanged.
 */

import { isBackchannelOnlyUtterance, isCallerAttentionUtterance } from "./transcriptQuality.js";
import { isKbPhase3CanaryAgent } from "./kb-phase3-flags.js";

export type KbRetrievalGateMode = "off" | "shadow" | "on";
export type KbRetrievalDecision = "retrieve" | "skip";
export type KbUtteranceClass =
  | "acknowledgement"
  | "language_control"
  | "repeat_request"
  | "call_control"
  | "caller_fact"
  | "knowledge_query"
  | "unclear";
export type KbRetrievalGateReason =
  | "factual_question"
  | "conversational"
  | "language_control"
  | "caller_fact"
  | "unclear";

export type KbRetrievalGateResult = {
  decision: KbRetrievalDecision;
  reason: KbRetrievalGateReason;
  utteranceClass: KbUtteranceClass;
  utterance: string;
  decisionMs: number;
};

/** Optional KB catalog so person questions don't retrieve just because an offering is sticky. */
export type KbRetrievalGateOptions = {
  knownOfferings?: string[];
};

const UTTERANCE_LOG_MAX = 200;

/** Repeat / "I didn't catch that" — conversation repair, not a KB question. */
const REPEAT_OR_HEAR_RES: RegExp[] = [
  /^(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:repeat(?:\s+that|\s+it|\s+again)?|say\s+(?:that|it)\s+again|come\s+again|pardon(?:\s+me)?)\s*\??$/i,
  /^(?:what(?:'s| is)? that|huh|sorry|what)\s*\??$/i,
  /\bwhat did you (?:say|tell)\b/i,
  /\b(?:say that again|once more|one more time|repeat again)\b/i,
  /\bcouldn'?t (?:able to )?hear\b/i,
  /\bspeak clearly\b/i,
  /\bmixing (?:the )?sentences\b/i,
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
  /(?:\bapply\b|\bsalary\b|\bctc\b|\bstipend\b|\btransport\b|\bcab\b|\bhostel\b|\bcanteen\b|\bcovered\b|\bcoverage\b|\bexclusion|\bhospital|\bpremium\b|\bpolicy\b|\bplans?\b|\bpf\b|\besi\b|\binsurance\b|\bvacanc|\bopening|\bfee\b|\bfees\b|\bbond\b|\beligib|\bnight shift\b|\bwork from home\b|\bwfh\b|\bjoining\b|\bincentive|\bdocument|\baadhaar|\bpan\b|சம்பள|சம்பளம்|டிரான்ஸ்போர்ட்|பேருந்து|ஹாஸ்டல்|கவர|பாலிசி|सैलरी|ट्रांसपोर्ट|कवर|पॉलिसी)/i;

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

const LANGUAGE_NAME_LATIN_RE =
  /\b(tamil|english|hindi|telugu|kannada|malayalam|marathi|bengali|gujarati|punjabi|odia|hinglish)\b/iu;

const LANGUAGE_NAME_INDIC_RE =
  /தமிழ்(?:ல|ில்)?|இங்கிலீஷ்|ஆங்கிலம்|மலையாள(?:ம்|த்துல|த்தில்)|தெலுங்கு|கன்னடம்|हिंदी|हिन्दी|తెలుగు(?:లో)?|ಕನ್ನಡ(?:ದಲ್ಲಿ)?|മലയാള(?:ം|ത്തിൽ)?|തമിഴ്(?:ിൽ)?/u;

const LANGUAGE_NAME_RE = new RegExp(
  `${LANGUAGE_NAME_LATIN_RE.source}|${LANGUAGE_NAME_INDIC_RE.source}`,
  "iu",
);

const LANGUAGE_SPEAK_RE =
  /\b(?:speak(?:ing)?|talk(?:ing)?|bolo|explain|continue|reply|respond|switch|understand|comfortable)\b|பேசு|பேச|சம்சாரம்|புரிய|സംസാരിക്ക|പറയാമോ|പറയുക|మాట్లాడ|చెప్పండి|ಮಾತನಾಡ/iu;

const LANGUAGE_CONTROL_RES: RegExp[] = [
  /^(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:speak|talk|explain|continue|reply|respond|switch)\s+(?:to\s+|in\s+)?(?:tamil|english|hindi|telugu|kannada|malayalam|தமிழ்)/i,
  /^(?:tamil|english|hindi|telugu|kannada|malayalam|தமிழ்|മലയാളം|తెలుగు|ಕನ್ನಡ)(?:\s+please)?\s*[.!]?\s*$/i,
  /^(?:speak|talk)(?:ing)?\s+in\s+\w+/i,
  /\b(?:are|why are|why)\s+you\s+(?:speak(?:ing)?|talk(?:ing)?)\b/i,
  /\b(?:which|what)\s+language\b/i,
  /\b(?:hindi|tamil|english|malayalam|telugu|kannada)\s+mein\s+bolo\b/i,
  /\b(?:i(?:'m| am) )?comfortable only with\b/i,
  /\bi only (?:understand|speak|know)\b/i,
  /\bonly understand\b/i,
  /தமிழ்ல\s*பேசு|தமிழ்ல\s*பேச|தமிழில்\s*பேச|இங்கிலீஷ்ல\s*பேசு|ஆங்கிலத்தில்/u,
  /(?:english|tamil|hindi|malayalam|telugu|kannada)[-\s]?ல\s*பேசு/i,
  /மலையாளத்துல\s*(?:பேச|சம்சாரம்)|மலையாளத்தில்/u,
  /മലയാളത്തിൽ\s*(?:സംസാരിക്ക|പറയ)/u,
  /തമിഴിൽ\s*സംസാരിക്ക/u,
  /తెలుగులో\s*(?:మాట్లాడ|చెప్ప)/u,
  /ಕನ್ನಡದಲ್ಲಿ\s*ಮಾತನಾಡ/u,
  /(?:में बोलो|में बात)/u,
];

const CALL_CONTROL_RE =
  /^(?:hang\s*up|hangup|end(?:\s+the)?\s+call|cut(?:\s+the)?\s+call|disconnect|stop calling)(?:\s+(?:please|sir|madam|ma'?am))?\s*[.!]?\s*$/i;

const BOOK_SPECIALIST_RE =
  /\b(?:shall we )?book (?:a |the )?(?:specialist|doctor|callback|follow[- ]?up)(?:\s+call)?\b/i;

/** Questions about a named person that aren't attached knowledge objects. */
const PERSON_ISSUE_RES: RegExp[] = [
  /\b(?:what(?:'s| is)|tell me|mention) (?:what is )?the (?:issue|problem|condition) for ([A-Za-z]{2,24})\b/i,
  /\bwhat(?:'s| is) ([A-Za-z]{2,24})(?:'s) (?:issue|problem|condition)\b/i,
  /\b(?:issue|problem|condition) for ([A-Za-z]{2,24})\b/i,
];

const TRAILING_ACK_RE = /(?:ठीक है|theek hai|theekh hai)\s*[.!]?\s*$/iu;

const SPEAK_CONSENT_RE =
  /^(?:பேசலாம்|பேசலாமே)(?:\s+(?:sir|madam|ma'?am|but|ok|okay))*\s*$/iu;

function classToReason(utteranceClass: KbUtteranceClass): KbRetrievalGateReason {
  if (utteranceClass === "knowledge_query") return "factual_question";
  if (utteranceClass === "language_control") return "language_control";
  if (utteranceClass === "caller_fact") return "caller_fact";
  if (utteranceClass === "unclear") return "unclear";
  return "conversational";
}

function hasLanguageName(text: string): boolean {
  return LANGUAGE_NAME_LATIN_RE.test(text) || LANGUAGE_NAME_INDIC_RE.test(text);
}

function stripLanguageRequest(text: string): string {
  return text
    .replace(LANGUAGE_NAME_LATIN_RE, " ")
    .replace(LANGUAGE_NAME_INDIC_RE, " ")
    .replace(/\b(speak(?:ing)?|talk(?:ing)?|explain|continue|reply|respond|switch|please|language|easier|prefer|which|what|why|are|you|in|to|mein|bolo|understand|comfortable|only|with|can|could|would|tell|say|me|i|am|i'm|ma'?am|sir|madam)\b/gi, " ")
    .replace(/தமிழ்ல|தமிழில்|பேசுங்க|பேசுறீங்களா|பேசுறீங்க|பேசலாமா|பேசலாமே|பேச முடியுமா|பேசு|சம்சாரம்|இருக்கா|முடியுமா|மட்டும்/gu, " ")
    .replace(/സംസാരിക്കാമോ|സംസാരിക്കുന്നത്|സംസാരിക്കുക|സംസാരിക്ക|പറയാമോ|പറയുക|ആണോ|എനിക്ക്/gu, " ")
    .replace(/మాట్లాడగలరా|మాట్లాడండి|మాట్లాడ|చెప్పండి/gu, " ")
    .replace(/ಮಾತನಾಡಬಹುದಾ|ಮಾತನಾಡಿ|ಮಾತನಾಡ/gu, " ")
    .replace(/எனக்கு|கொஞ்சம்|புரிய\s*மாட்டேங்குது|சாரி/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Language-control has precedence over question shape.
 * "Are you speaking in Tamil?" / "Why English?" skip even though they look like questions.
 * Mixed knowledge leftover ("explain the premium in Tamil") still retrieves.
 */
export function isLanguageControlUtterance(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const isolatedLang =
    /^(?:tamil|english|hindi|telugu|kannada|malayalam|hinglish|தமிழ்|இங்கிலீஷ்|हिंदी|हिन्दी|മലയാളം|తెలుగు|ಕನ್ನಡ)\s*[.!]?\s*$/iu.test(t);
  const requested = isolatedLang
    || LANGUAGE_CONTROL_RES.some((re) => re.test(t))
    || (hasLanguageName(t) && LANGUAGE_SPEAK_RE.test(t));
  if (!requested) return false;
  const rest = stripLanguageRequest(t);
  if (rest && looksDomainHint(rest)) return false;
  return true;
}

function nameMatchesOffering(name: string, offerings: string[] | undefined): boolean {
  const n = name.trim().toLowerCase();
  if (!n || !offerings?.length) return false;
  return offerings.some((o) => {
    const t = o.trim().toLowerCase();
    return t === n || t.includes(n) || n.includes(t);
  });
}

/**
 * "What's Bhavya's issue?" is conversation memory, not product knowledge —
 * unless the named thing is an attached knowledge object or the leftover is a domain question.
 */
function looksNonKbPersonQuestion(text: string, offerings: string[] | undefined): boolean {
  if (looksDomainHint(text)) return false;
  for (const re of PERSON_ISSUE_RES) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    if (nameMatchesOffering(m[1], offerings)) return false;
    return true;
  }
  return false;
}

function looksTrailingAckStatement(text: string): boolean {
  if (!TRAILING_ACK_RE.test(text)) return false;
  if (looksQuestion(text)) return false;
  return true;
}

function wordCountish(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Deterministic utterance class for retrieval gating and query-builder hygiene.
 * Not a general intent model — a handful of skip/retrieve buckets.
 */
export function classifyKbUtterance(
  utterance: string,
  opts: KbRetrievalGateOptions = {},
): {
  utteranceClass: KbUtteranceClass;
  decision: KbRetrievalDecision;
} {
  const t = utterance.trim();
  if (!t) return { utteranceClass: "acknowledgement", decision: "skip" };

  if (isRepeatOrHearAsk(t)) return { utteranceClass: "repeat_request", decision: "skip" };
  if (isLanguageControlUtterance(t)) return { utteranceClass: "language_control", decision: "skip" };
  if (CALL_CONTROL_RE.test(t) || FAREWELL_THANKS_RE.test(t) || BOOK_SPECIALIST_RE.test(t)) {
    return { utteranceClass: "call_control", decision: "skip" };
  }
  if (
    CONVERSATIONAL_ACK_RE.test(t)
    || isBackchannelOnlyUtterance(t)
    || isCallerAttentionUtterance(t)
    || looksTrailingAckStatement(t)
    || SPEAK_CONSENT_RE.test(t)
  ) {
    return { utteranceClass: "acknowledgement", decision: "skip" };
  }
  if (looksCallerFact(t) || looksNonKbPersonQuestion(t, opts.knownOfferings)) {
    return { utteranceClass: "caller_fact", decision: "skip" };
  }
  if (looksQuestion(t) || looksDomainHint(t)) {
    return { utteranceClass: "knowledge_query", decision: "retrieve" };
  }
  return { utteranceClass: "unclear", decision: "retrieve" };
}

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
  agentId?: number | null,
): KbRetrievalGateMode {
  if (isKbPhase3CanaryAgent(agentId, env)) return "on";
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
export function decideKbRetrieval(
  utterance: string,
  opts: KbRetrievalGateOptions = {},
): {
  decision: KbRetrievalDecision;
  reason: KbRetrievalGateReason;
  utteranceClass: KbUtteranceClass;
} {
  const classified = classifyKbUtterance(utterance, opts);
  return {
    decision: classified.decision,
    reason: classToReason(classified.utteranceClass),
    utteranceClass: classified.utteranceClass,
  };
}

/** Timed, fail-open wrapper for the live pipeline. */
export function runKbRetrievalGate(
  utterance: string,
  opts: KbRetrievalGateOptions = {},
): KbRetrievalGateResult {
  const startedAt = performance.now();
  const clipped = clipUtterance(utterance);
  try {
    const { decision, reason, utteranceClass } = decideKbRetrieval(utterance, opts);
    return { decision, reason, utteranceClass, utterance: clipped, decisionMs: roundMs(startedAt) };
  } catch {
    return {
      decision: "retrieve",
      reason: "unclear",
      utteranceClass: "unclear",
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
