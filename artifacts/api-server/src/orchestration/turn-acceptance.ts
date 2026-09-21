/**
 * Turn Acceptance Gate — decide whether an STT final is a valid conversational
 * turn before processTurn / LLM / CRM / tools.
 *
 * Decisions: ACCEPT | CLARIFY | IGNORE
 * Mode (TURN_ACCEPTANCE_GATE): shadow (default, log only) | enforce | off
 *
 * semanticRelevance = max(slotMatchScore, globalIntentScore, trustedTopicChangeScore)
 * utteranceCoherence is diagnostic only — never independently causes ACCEPT.
 *
 * First enforcement canary: structured slots only. expectedSlot=open is fail-open.
 */

import { isClosedQuestion, isShortAnswerVocabulary } from "./short-answer.js";
import {
  isDigitCollectionContext,
  isEmailCollectionContext,
} from "./endpointing.js";
import {
  isHardInterruptTranscript,
  isSemanticInterrupt,
} from "./transcriptQuality.js";
import {
  looksLikeCancelOrRescheduleIntent,
  looksLikeDemoOrScheduleIntent,
  looksLikeImmediateToolIntent,
} from "./booking-flow-enforce.js";
import { BACKGROUND_TALKER_MIN_RAW_RMS } from "./mic-sensitivity.js";

export type ExpectedSlot =
  | "yes_no"
  | "duration"
  | "money"
  | "place"
  | "person_name"
  | "email"
  | "phone"
  | "digits"
  | "open";

export type TurnAcceptanceDecision = "accept" | "clarify" | "ignore";
export type AcousticStrength = "strong" | "weak";
export type TurnAcceptanceMode = "shadow" | "enforce" | "off";
export type BargeStrength = "hard" | "soft" | "none" | "weak";

/** Slots where enforce may IGNORE/CLARIFY. `open` stays fail-open. */
export const STRUCTURED_SLOTS: ReadonlySet<ExpectedSlot> = new Set([
  "yes_no",
  "duration",
  "money",
  "place",
  "person_name",
  "email",
  "phone",
  "digits",
]);

export const MAX_CLARIFICATIONS_PER_QUESTION = 1;
export const CLARIFICATION_COOLDOWN_MS = 3_000;

export type TurnAcceptanceInput = {
  transcript: string;
  lastAgentText: string;
  expectingShortAnswer: boolean;
  rawNearRms: number;
  sileroConfidence: number;
  sileroSustained: boolean;
  speechDurationMs: number;
  bargeStrength: BargeStrength;
  selfEcho: boolean;
  backgroundSpeechHistory: number;
  /** Clarifications already issued for the current agent question. */
  clarificationsForQuestion?: number;
  /** Ms since last clarification (Infinity if never). */
  msSinceLastClarification?: number;
};

export type TurnAcceptanceResult = {
  decision: TurnAcceptanceDecision;
  reason: string;
  expectedSlot: ExpectedSlot;
  acousticStrength: AcousticStrength;
  /** max(slot, globalIntent, trustedTopicChange) — not utteranceCoherence. */
  semanticScore: number;
  slotMatchScore: number;
  globalIntentScore: number;
  trustedTopicChangeScore: number;
  /** Diagnostic only — used to choose CLARIFY vs IGNORE, never ACCEPT alone. */
  utteranceCoherence: number;
  globalIntentMatch: boolean;
  expectedSlotMatch: boolean;
  trustedTopicChange: boolean;
  isStructuredSlot: boolean;
};

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(?:\+?\d[\d\s-]{8,}\d)/;
const DIGITS_RE = /\d{4,}/;
const DURATION_RE =
  /\b(\d+(\.\d+)?\s*(year|years|yr|yrs|month|months|mo|week|weeks|day|days)|fresher|freshers|immediate(ly)?|notice\s*period|left\s+last|working\s+since|i\s+(left|quit|joined))\b/i;
const MONEY_RE =
  /\b(\d+(\.\d+)?\s*(k|lakh|lakhs|lac|lacs|cr|crore|crores|rs\.?|inr|₹)?|negotiable|ctc|package|salary)\b/i;
const KNOWN_CITY_RE =
  /\b(bangalore|bengaluru|chennai|mumbai|delhi|new\s+delhi|hyderabad|pune|kolkata|gurgaon|gurugram|noida|coimbatore|madurai|trichy|jaipur|ahmedabad|remote|wfh|work\s+from\s+home)\b/i;
const RELOCATE_RE = /\b(relocat(e|ion|ing)|willing\s+to\s+move|can\s+move)\b/i;
const PLACE_PREP_RE =
  /\b(in|from|at|near)\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?\b/;
const CONDITIONAL_YES_NO_RE =
  /\b(only\s+if|depends|maybe|not\s+sure|can\s+try|comfortable\s+with|ok\s+with|fine\s+with)\b/i;
/** Explicit topic-change cue — required for trustedTopicChange. */
const TOPIC_CHANGE_CUE_RE =
  /\b(actually|wait|before\s+that|by\s+the\s+way|one\s+more\s+(thing|question)|instead|rather|i\s+wanted\s+to\s+(ask|tell|say)|i\s+have\s+(a\s+)?(question|doubt))\b/i;
const MEANINGFUL_INTENT_RE =
  /\b(what(?:'s| is| are)|how\s+much|how\s+many|where\s+is|who\s+(?:are|is)|tell\s+me|salary|price|pricing|company|job|role|demo|office|call\s+me|callback|not\s+(looking|interested)|another\s+question)\b/i;
const INFO_QUESTION_RE =
  /\b(what(?:'s| is| are)|how\s+much|how\s+many|who\s+(?:are|is)|tell\s+me\s+about|price|pricing|company|job|role|demo|purpose|why\s+(?:are|do)\s+you)\b/i;
const NAME_ASK_RE =
  /\b(your\s+name|may\s+i\s+(have|know)\s+your\s+name|whom\s+am\s+i\s+speaking|caller'?s?\s+name|full\s+name)\b/i;
const DURATION_ASK_RE =
  /\b(experience|how\s+long|years?\s+of|fresher|notice\s*period|currently\s+working|are\s+you\s+working)\b/i;
const MONEY_ASK_RE = /\b(salary|ctc|package|compensation|pay|expect(ation|ing)?)\b/i;
const PLACE_ASK_RE = /\b(location|city|where\s+(?:are|do)\s+you|relocat)\b/i;
const PHONE_ASK_RE = /\b(phone|mobile|contact\s+number|whatsapp\s+number|call\s+you\s+on)\b/i;
const VERB_RE =
  /\b(is|are|was|were|be|been|am|do|does|did|have|has|had|will|would|can|could|should|move|moving|support|supports|come|coming|go|going|look|looking|want|need|get|got|make|made|take|took|say|said|tell|told)\b/i;
const BACKGROUND_PHRASE_RE =
  /\b(supports?\s+number|move\s+in\s+the\s+right|don'?t\s+move|come\s+to\s+the\s+shop|right\s+direction|attacking\s+something)\b/i;
const UNAMBIGUOUS_GLOBAL_RE =
  /\b(not\s+interested|don'?t\s+call|do\s+not\s+call|wrong\s+number|call\s+me\s+(later|back|tomorrow)|callback|stop|wait|cancel|busy\s+now)\b/i;

export function resolveTurnAcceptanceMode(
  env: NodeJS.ProcessEnv = process.env,
): TurnAcceptanceMode {
  const raw = (env["TURN_ACCEPTANCE_GATE"] ?? "shadow").trim().toLowerCase();
  if (raw === "enforce" || raw === "on" || raw === "1" || raw === "true") return "enforce";
  if (raw === "off" || raw === "0" || raw === "false") return "off";
  return "shadow";
}

export function isStructuredSlot(slot: ExpectedSlot): boolean {
  return STRUCTURED_SLOTS.has(slot);
}

export function inferExpectedSlot(lastAgentText: string): ExpectedSlot {
  const t = lastAgentText.trim();
  if (!t) return "open";
  if (isEmailCollectionContext(t)) return "email";
  if (PHONE_ASK_RE.test(t) || (isDigitCollectionContext(t) && /\b(phone|mobile|otp|pin|aadhaar|aadhar)\b/i.test(t))) {
    return /\b(otp|pin|aadhaar|aadhar|code)\b/i.test(t) ? "digits" : "phone";
  }
  if (isDigitCollectionContext(t)) return "digits";
  if (NAME_ASK_RE.test(t)) return "person_name";
  if (MONEY_ASK_RE.test(t)) return "money";
  if (PLACE_ASK_RE.test(t)) return "place";
  if (DURATION_ASK_RE.test(t)) return "duration";
  if (isClosedQuestion(t)) return "yes_no";
  return "open";
}

function scoreYesNoSlot(transcript: string): number {
  if (isShortAnswerVocabulary(transcript)) return 0.95;
  if (CONDITIONAL_YES_NO_RE.test(transcript)) return 0.8;
  return 0;
}

function scoreDurationSlot(transcript: string): number {
  if (DURATION_RE.test(transcript)) return 0.9;
  if (/\b(i\s+)?(left|quit|resigned|joined|am\s+working|not\s+working|unemployed)\b/i.test(transcript)) {
    return 0.85;
  }
  return 0;
}

function scoreMoneySlot(transcript: string): number {
  if (MONEY_RE.test(transcript)) return 0.9;
  if (/\b\d{2,}\b/.test(transcript) && transcript.split(/\s+/).length <= 6) return 0.7;
  return 0;
}

function scorePlaceSlot(transcript: string): number {
  if (KNOWN_CITY_RE.test(transcript) || RELOCATE_RE.test(transcript)) return 0.9;
  if (PLACE_PREP_RE.test(transcript) && !BACKGROUND_PHRASE_RE.test(transcript)) return 0.75;
  if (/^(yes|no|yeah|nope)\b/i.test(transcript.trim()) && RELOCATE_RE.test(transcript)) return 0.85;
  return 0;
}

function scorePersonName(transcript: string): number {
  const t = transcript.trim().replace(/[.,!?]+$/g, "");
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return 0;
  if (/^(yes|no|ok|okay|hello|hi|thanks|thank you)$/i.test(t)) return 0;
  if (/\d/.test(t) || DIGITS_RE.test(t)) return 0;
  if (BACKGROUND_PHRASE_RE.test(t)) return 0;
  if (VERB_RE.test(t)) return 0;
  if (/\b(the|a|an|to|for|with|from|into|about|number|shop|right|now|direction)\b/i.test(t)) {
    return 0;
  }
  // Name-like: mostly alphabetic tokens, no command shape.
  if (words.every((w) => /^[\p{L}'.-]+$/u.test(w))) return 0.85;
  return 0;
}

function scoreEmail(transcript: string): number {
  if (EMAIL_RE.test(transcript)) return 0.95;
  if (/@|dot\s+com|gmail|yahoo|outlook/i.test(transcript)) return 0.75;
  return 0;
}

function scorePhoneOrDigits(transcript: string, phone: boolean): number {
  if (PHONE_RE.test(transcript) || DIGITS_RE.test(transcript)) return phone ? 0.9 : 0.85;
  if (/^(zero|one|two|three|four|five|six|seven|eight|nine|oh)(\s|$)/i.test(transcript)) {
    return 0.7;
  }
  return 0;
}

export function scoreExpectedSlotMatch(slot: ExpectedSlot, transcript: string): number {
  const t = transcript.trim();
  if (!t) return 0;
  switch (slot) {
    case "yes_no":
      return scoreYesNoSlot(t);
    case "duration":
      return scoreDurationSlot(t);
    case "money":
      return scoreMoneySlot(t);
    case "place":
      return scorePlaceSlot(t);
    case "person_name":
      return scorePersonName(t);
    case "email":
      return scoreEmail(t);
    case "phone":
      return scorePhoneOrDigits(t, true);
    case "digits":
      return scorePhoneOrDigits(t, false);
    case "open":
      return 0;
  }
}

/**
 * Global intent. Under weak audio, only unambiguous phrases accept
 * (avoid noise hallucinations matching soft patterns).
 */
export function matchGlobalIntent(
  transcript: string,
  acousticStrength: AcousticStrength = "strong",
): boolean {
  const t = transcript.trim();
  if (!t) return false;
  if (acousticStrength === "weak") {
    return UNAMBIGUOUS_GLOBAL_RE.test(t)
      || looksLikeImmediateToolIntent(t)
      || looksLikeCancelOrRescheduleIntent(t);
  }
  if (isHardInterruptTranscript(t) || isSemanticInterrupt(t)) return true;
  if (looksLikeImmediateToolIntent(t)) return true;
  if (looksLikeCancelOrRescheduleIntent(t)) return true;
  if (looksLikeDemoOrScheduleIntent(t)) return true;
  if (INFO_QUESTION_RE.test(t)) return true;
  return false;
}

/**
 * Diagnostic fluency score — NEVER an ACCEPT path by itself.
 */
export function utteranceCoherenceScore(transcript: string): number {
  const t = transcript.trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 3 || words.length > 40) return 0;
  if (/\b(i|we|my|i'?m|they|the|a|an)\b/i.test(t) || VERB_RE.test(t)) {
    return 0.75;
  }
  return 0;
}

/**
 * Trusted topic change: strong acoustics + explicit cue + meaningful intent.
 * Strong audio alone is not enough (TV/reel can be loud).
 */
export function trustedTopicChangeScore(
  transcript: string,
  acousticStrength: AcousticStrength,
): number {
  if (acousticStrength !== "strong") return 0;
  const t = transcript.trim();
  if (!TOPIC_CHANGE_CUE_RE.test(t) && !MEANINGFUL_INTENT_RE.test(t)) return 0;
  // Need both an explicit pivot cue OR clear info-question, plus meaningful content.
  const hasCue = TOPIC_CHANGE_CUE_RE.test(t);
  const hasMeaning = MEANINGFUL_INTENT_RE.test(t) || INFO_QUESTION_RE.test(t)
    || looksLikeImmediateToolIntent(t)
    || /\bnot\s+(looking|interested)\b/i.test(t);
  if (hasCue && hasMeaning) return 0.9;
  if (hasCue && t.split(/\s+/).length >= 4) return 0.8;
  // "What is the salary?" without "actually" — still a clear topic-change question.
  if (!hasCue && INFO_QUESTION_RE.test(t) && MEANINGFUL_INTENT_RE.test(t) && t.split(/\s+/).length >= 3) {
    return 0.85;
  }
  return 0;
}

export function deriveAcousticStrength(opts: {
  rawNearRms: number;
  sileroSustained: boolean;
  sileroConfidence: number;
  speechDurationMs: number;
  bargeStrength: BargeStrength;
  backgroundSpeechHistory: number;
}): AcousticStrength {
  let score = 0;
  if (opts.rawNearRms >= BACKGROUND_TALKER_MIN_RAW_RMS) score += 1;
  if (opts.rawNearRms >= BACKGROUND_TALKER_MIN_RAW_RMS * 2) score += 1;
  if (opts.sileroSustained) score += 1;
  if (opts.sileroConfidence >= 0.55) score += 1;
  if (opts.speechDurationMs >= 400) score += 1;
  if (opts.speechDurationMs >= 900) score += 1;
  if (opts.bargeStrength === "hard") score += 1;
  if (opts.bargeStrength === "weak" || opts.bargeStrength === "soft") score -= 1;
  if (opts.backgroundSpeechHistory >= 2) score -= 1;
  return score >= 3 ? "strong" : "weak";
}

function resultBase(
  partial: Omit<TurnAcceptanceResult, "isStructuredSlot"> & { expectedSlot: ExpectedSlot },
): TurnAcceptanceResult {
  return {
    ...partial,
    isStructuredSlot: isStructuredSlot(partial.expectedSlot),
  };
}

/**
 * Precedence:
 * 1 self-echo → IGNORE
 * 2 global intent → ACCEPT
 * 3 strong expected-slot match → ACCEPT
 * 4 trusted topic change → ACCEPT
 * 5 structured + strong + mismatch → CLARIFY (with loop protection)
 * 6 structured + weak + mismatch → IGNORE
 * 7 open → ACCEPT fail-open
 */
export function evaluateTurnAcceptance(input: TurnAcceptanceInput): TurnAcceptanceResult {
  const transcript = input.transcript.trim();
  const expectedSlot = inferExpectedSlot(input.lastAgentText);
  const structured = isStructuredSlot(expectedSlot);
  const clarifications = input.clarificationsForQuestion ?? 0;
  const msSinceClarify = input.msSinceLastClarification ?? Number.POSITIVE_INFINITY;

  if (input.selfEcho) {
    return resultBase({
      decision: "ignore",
      reason: "self_echo",
      expectedSlot,
      acousticStrength: "weak",
      semanticScore: 0,
      slotMatchScore: 0,
      globalIntentScore: 0,
      trustedTopicChangeScore: 0,
      utteranceCoherence: 0,
      globalIntentMatch: false,
      expectedSlotMatch: false,
      trustedTopicChange: false,
    });
  }

  const acousticStrength = deriveAcousticStrength({
    rawNearRms: input.rawNearRms,
    sileroSustained: input.sileroSustained,
    sileroConfidence: input.sileroConfidence,
    speechDurationMs: input.speechDurationMs,
    bargeStrength: input.bargeStrength,
    backgroundSpeechHistory: input.backgroundSpeechHistory,
  });

  const globalIntentMatch = matchGlobalIntent(transcript, acousticStrength);
  const globalIntentScore = globalIntentMatch ? 1 : 0;

  let slotMatchScore = scoreExpectedSlotMatch(expectedSlot, transcript);
  if (input.expectingShortAnswer && isShortAnswerVocabulary(transcript)) {
    slotMatchScore = Math.max(slotMatchScore, 0.95);
  }
  const expectedSlotMatch = slotMatchScore >= 0.7;

  const trustedScore = trustedTopicChangeScore(transcript, acousticStrength);
  const trustedTopicChange = trustedScore >= 0.8;
  const utteranceCoherence = utteranceCoherenceScore(transcript);
  const semanticScore = Math.max(slotMatchScore, globalIntentScore, trustedScore);

  // 2. Global intent
  if (globalIntentMatch) {
    return resultBase({
      decision: "accept",
      reason: "global_intent",
      expectedSlot,
      acousticStrength,
      semanticScore,
      slotMatchScore,
      globalIntentScore,
      trustedTopicChangeScore: trustedScore,
      utteranceCoherence,
      globalIntentMatch,
      expectedSlotMatch,
      trustedTopicChange,
    });
  }

  // 3. Strong expected-slot match
  if (expectedSlotMatch) {
    return resultBase({
      decision: "accept",
      reason: "expected_slot_match",
      expectedSlot,
      acousticStrength,
      semanticScore,
      slotMatchScore,
      globalIntentScore,
      trustedTopicChangeScore: trustedScore,
      utteranceCoherence,
      globalIntentMatch,
      expectedSlotMatch,
      trustedTopicChange,
    });
  }

  // 4. Explicit trusted topic change
  if (trustedTopicChange) {
    return resultBase({
      decision: "accept",
      reason: "trusted_topic_change",
      expectedSlot,
      acousticStrength,
      semanticScore,
      slotMatchScore,
      globalIntentScore,
      trustedTopicChangeScore: trustedScore,
      utteranceCoherence,
      globalIntentMatch,
      expectedSlotMatch,
      trustedTopicChange,
    });
  }

  // 7. Open slot → fail-open (first enforcement version)
  if (!structured) {
    return resultBase({
      decision: "accept",
      reason: acousticStrength === "strong" && utteranceCoherence >= 0.75
        ? "open_fail_open_strong"
        : "open_fail_open",
      expectedSlot,
      acousticStrength,
      semanticScore,
      slotMatchScore,
      globalIntentScore,
      trustedTopicChangeScore: trustedScore,
      utteranceCoherence,
      globalIntentMatch,
      expectedSlotMatch,
      trustedTopicChange,
    });
  }

  // Structured slot mismatch from here.
  const inClarifyCooldown = msSinceClarify < CLARIFICATION_COOLDOWN_MS;
  const clarifyBudgetExhausted = clarifications >= MAX_CLARIFICATIONS_PER_QUESTION;

  // 5. Structured + strong + mismatch → CLARIFY (or fail-open / ignore after budget)
  if (acousticStrength === "strong") {
    if (clarifyBudgetExhausted) {
      // Strong second response after one clarify → fail-open accept
      if (utteranceCoherence >= 0.75 || input.backgroundSpeechHistory < 2) {
        return resultBase({
          decision: "accept",
          reason: "clarify_budget_fail_open",
          expectedSlot,
          acousticStrength,
          semanticScore,
          slotMatchScore,
          globalIntentScore,
          trustedTopicChangeScore: trustedScore,
          utteranceCoherence,
          globalIntentMatch,
          expectedSlotMatch,
          trustedTopicChange,
        });
      }
      return resultBase({
        decision: "ignore",
        reason: "repeated_mismatch_after_clarify",
        expectedSlot,
        acousticStrength,
        semanticScore,
        slotMatchScore,
        globalIntentScore,
        trustedTopicChangeScore: trustedScore,
        utteranceCoherence,
        globalIntentMatch,
        expectedSlotMatch,
        trustedTopicChange,
      });
    }
    if (inClarifyCooldown) {
      return resultBase({
        decision: "ignore",
        reason: "clarification_cooldown",
        expectedSlot,
        acousticStrength,
        semanticScore,
        slotMatchScore,
        globalIntentScore,
        trustedTopicChangeScore: trustedScore,
        utteranceCoherence,
        globalIntentMatch,
        expectedSlotMatch,
        trustedTopicChange,
      });
    }
    return resultBase({
      decision: "clarify",
      reason: "structured_slot_mismatch_strong",
      expectedSlot,
      acousticStrength,
      semanticScore,
      slotMatchScore,
      globalIntentScore,
      trustedTopicChangeScore: trustedScore,
      utteranceCoherence,
      globalIntentMatch,
      expectedSlotMatch,
      trustedTopicChange,
    });
  }

  // 6. Structured + weak + mismatch → IGNORE
  return resultBase({
    decision: "ignore",
    reason: input.backgroundSpeechHistory >= 1
      ? "repeated_unrelated_background"
      : "structured_slot_mismatch_weak",
    expectedSlot,
    acousticStrength,
    semanticScore,
    slotMatchScore,
    globalIntentScore,
    trustedTopicChangeScore: trustedScore,
    utteranceCoherence,
    globalIntentMatch,
    expectedSlotMatch,
    trustedTopicChange,
  });
}

/**
 * Enforce blocks IGNORE/CLARIFY only for structured slots.
 * Open-slot decisions are never enforced (always processTurn).
 */
export function shouldEnforceTurnDecision(
  mode: TurnAcceptanceMode,
  decision: TurnAcceptanceDecision,
  expectedSlot?: ExpectedSlot,
): boolean {
  if (mode !== "enforce") return false;
  if (decision === "accept") return false;
  if (expectedSlot && !isStructuredSlot(expectedSlot)) return false;
  return decision === "ignore" || decision === "clarify";
}

/** Deterministic slot-specific clarification (no old TTS clip replay). */
export function clarificationPromptForSlot(
  slot: ExpectedSlot,
  lastAgentText: string,
  langHint?: string | null,
): string {
  const ta = (langHint ?? "").toLowerCase().startsWith("ta");
  switch (slot) {
    case "yes_no":
      return ta
        ? "மன்னிக்கவும், இரவு ஷிப்ட் சரிதானா? மீண்டும் சொல்லுங்கள்."
        : "Sorry, are you comfortable with the night shift? Could you say that again?";
    case "duration":
      return ta
        ? "மன்னிக்கவும், எத்தனை வருட அனுபவம்? மீண்டும் சொல்லுங்கள்."
        : "Sorry, how many years of experience do you have?";
    case "money":
      return ta
        ? "மன்னிக்கவும், எதிர்பார்க்கும் சம்பளம் என்ன? மீண்டும் சொல்லுங்கள்."
        : "Could you repeat your expected salary?";
    case "place":
      return ta
        ? "மன்னிக்கவும், நீங்கள் எந்த ஊரில் இருக்கிறீர்கள்?"
        : "Sorry, which city or location are you in?";
    case "person_name":
      return ta
        ? "மன்னிக்கவும், உங்கள் பெயர் என்ன? மீண்டும் சொல்லுங்கள்."
        : "Sorry, could you repeat your name?";
    case "email":
      return ta
        ? "மன்னிக்கவும், உங்கள் இமெயில் ஐடியை மீண்டும் சொல்லுங்கள்."
        : "Sorry, could you repeat your email address?";
    case "phone":
    case "digits":
      return ta
        ? "மன்னிக்கவும், எண்ணை மீண்டும் சொல்லுங்கள்."
        : "Sorry, could you repeat that number?";
    default: {
      const clipped = lastAgentText.trim().replace(/\s+/g, " ").slice(0, 120);
      return clipped
        ? `Sorry, I didn't catch that. ${clipped}`
        : "Sorry, I didn't catch that. Could you say that again?";
    }
  }
}
