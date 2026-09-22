/**
 * Contextual short-answer acceptance for closed questions.
 *
 * Replaces the global word-floor gate when the agent just asked a yes/no
 * or confirmation question. Acoustic echo is handled by AEC3 + self-echo;
 * this module only decides whether a short transcript is a valid turn.
 */

import { countTranscriptWords } from "./interruption-manager.js";

/** Window after a closed question during which short answers are accepted. */
export const EXPECTING_SHORT_ANSWER_MS = 5_000;

const SHORT_ANSWER_RE =
  /^(yes|yeah|yep|yup|ok|okay|sure|correct|right|no|nope|nah|haan|han|ji|nahi|nahin|theek|accha|acha|aama|aam|illa|illai|seri|sari|vendaam|vendam|ஆம்|ஆமா|சரி|சரிங்க|இல்ல|இல்லை|வேண்டாம்|வேண்டா|हां|हाँ|जी|नहीं|नही|ठीक|अच्छा)([\s,.!]+(madam|ma'?am|sir|miss|mam|ji|jee|சார்|மேடம்|जी))?[\s,.!]*$/iu;

const CLOSED_QUESTION_RE =
  /^(?:are you|do you|can you|will you|would you|is that|is it|is there|shall we|okay\b|ok\b|right\b|correct\b)|(?:\bright\b|\bcorrect\b|\bokay\b|\bok\b)\s*\?\s*$|(?:\bcomfortable\b|\binterested\b|\bagree\b|\bconfirm(?:ing)?\b|\banything else\b)|கிடைக்குமா|சரியா|ஆமா\s*\?/i;

/** Choice / which-slot questions — not yes/no; leave as open for turn-acceptance. */
const CHOICE_QUESTION_RE =
  /\b(which\s+one|which\s+(slot|time|option)|what\s+time|11\s*(am)?\s*or|or\s+\d+\s*(am|pm)|works?\s+better)\b/i;

export function isClosedQuestion(agentText: string): boolean {
  const t = agentText.trim();
  if (!t) return false;
  // "Which one works better for you?" must NOT be treated as yes/no — that caused
  // call 28055 to IGNORE "Anything works for me?" under TURN_ACCEPTANCE_GATE=enforce.
  if (CHOICE_QUESTION_RE.test(t)) return false;
  return CLOSED_QUESTION_RE.test(t);
}

/** True when the utterance is a short confirmation / negation (optional honorific). */
export function isShortAnswerVocabulary(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.split(/\s+/).filter(Boolean).length > 4) return false;
  return SHORT_ANSWER_RE.test(t);
}

export function shouldAcceptContextualShortAnswer(opts: {
  text: string;
  expectingShortAnswer: boolean;
}): boolean {
  if (!opts.expectingShortAnswer) return false;
  return isShortAnswerVocabulary(opts.text);
}

/**
 * Barge / turn accept decision without a global short-word ban.
 * Short answers win only in EXPECTING_SHORT_ANSWER; otherwise need enough
 * words OR an explicit hard interrupt (caller passes that separately).
 */
export function shouldAcceptCallerInterrupt(opts: {
  text: string;
  isAudioPlaying: boolean;
  expectingShortAnswer: boolean;
  wordsForInterruption: number;
  isHardInterrupt: boolean;
}): boolean {
  if (!opts.isAudioPlaying) return false;
  if (opts.isHardInterrupt) return true;
  if (shouldAcceptContextualShortAnswer({
    text: opts.text,
    expectingShortAnswer: opts.expectingShortAnswer,
  })) {
    return true;
  }
  return countTranscriptWords(opts.text) >= Math.max(1, opts.wordsForInterruption);
}
