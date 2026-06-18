/**
 * transcriptQuality.ts
 *
 * P0 utilities for:
 *   A) Garbled STT transcript detection → clarification recovery
 *   C) Semantic barge-in keyword detection → instant TTS interruption
 */

// ── P0-A: Garbled transcript detection ──────────────────────────────────────

/**
 * Heuristic quality check on a raw STT transcript.
 * Catches noise, very short non-meaningful outputs, and heavy repetition.
 * Does NOT cover every bad case — just the most common ones that would
 * cause the LLM to produce a confused/hallucinated reply.
 */
export function checkTranscriptQuality(text: string): { isGarbled: boolean; reason: string } {
  const t = text.trim();

  // Empty after trim — caller might have been silent/muted
  if (t.length < 2) return { isGarbled: true, reason: "too-short" };

  // Only punctuation / special chars — no actual linguistic content
  // Use \p{L} (Unicode letter) + \p{N} (Unicode digit) so Indic scripts
  // (Tamil, Hindi, etc.) are NOT flagged as garbled — \W only covers ASCII.
  if (!/[\p{L}\p{N}]/u.test(t)) return { isGarbled: true, reason: "no-alphanumeric" };

  // Single repeated character: "aaaaaaa", "mmmmmm", "-------"
  if (/^(.)\1{4,}$/u.test(t)) return { isGarbled: true, reason: "single-char-repeat" };

  // Very short random-looking uppercase blobs (common Deepgram low-confidence output)
  // e.g. "Bm bm", "Z Z Z", "QQ QQ"
  if (t.length <= 6 && /^[^a-z\u0900-\u097f]+$/u.test(t) && /[A-Z]/.test(t)) {
    return { isGarbled: true, reason: "short-allcaps-noise" };
  }

  // High proportion of repeated adjacent chars — e.g. "aabb ccdd eeff"
  const chars = t.split("");
  let dups = 0;
  for (let i = 1; i < chars.length; i++) {
    if (chars[i] === chars[i - 1] && chars[i] !== " ") dups++;
  }
  if (chars.length > 6 && dups / chars.length > 0.65) {
    return { isGarbled: true, reason: "high-repetition" };
  }

  return { isGarbled: false, reason: "" };
}

const CLARIFICATION_PHRASES = [
  "Sorry, I didn't quite catch that — could you please say that again?",
  "I'm sorry, I didn't get that. Could you repeat?",
  "I didn't hear that clearly. Could you say that once more?",
  "Pardon? Could you repeat that for me?",
  "I'm sorry — could you say that again, please?",
];

let _clarificationIdx = 0;

/** Returns a rotating clarification phrase (non-random so it's predictable in tests). */
export function pickClarificationPhrase(): string {
  const phrase = CLARIFICATION_PHRASES[_clarificationIdx % CLARIFICATION_PHRASES.length]!;
  _clarificationIdx++;
  return phrase;
}

// ── P0-C: Semantic barge-in ──────────────────────────────────────────────────

/**
 * Interrupt keywords / phrases — if the caller's (partial or final) transcript
 * contains any of these, we fire barge-in immediately regardless of word count.
 *
 * Includes English + common Hinglish / transliterated equivalents used on
 * Indian insurance/finance/telecom calls.
 */
const SEMANTIC_INTERRUPT_PATTERNS: RegExp[] = [
  // Hard stops
  /\bstop\b/i,
  /\bwait\b/i,
  /\bhold on\b/i,
  /\bone sec(ond)?\b/i,
  /\bone moment\b/i,
  /\bruk(o|ja|iye)?\b/i,          // Hindi: ruko / rukiye
  /\bthehr(o|na|iye)?\b/i,        // Hindi: thehro / thehriye

  // Corrections / disagreement
  /\bno,?\s+that'?s\b/i,
  /\bthat'?s (not|wrong|incorrect)\b/i,
  /\bactually\b/i,
  /\bwait,?\s+no\b/i,
  /\bnahi(n)?\b/i,                 // Hindi: nahi / nahin
  /\bgalat\b/i,                    // Hindi: wrong

  // Interruption cues
  /\bsorry,?\s+(i|can)\b/i,
  /\bexcuse me\b/i,
  /\bmaaf (kar|kijiye|karo)\b/i,  // Hindi: sorry/excuse me

  // Repeat requests (signals caller didn't understand — different from barge-in,
  // but cutting the current TTS and letting them speak is still the right move)
  /\bcan you repeat\b/i,
  /\bsay that again\b/i,
  /\bdobara\b/i,                   // Hindi: again
  /\bphir se\b/i,                  // Hindi: once more
];

/**
 * Returns true if the transcript contains a semantic interruption signal.
 * Called on both interim and final transcripts from streaming STT.
 */
export function isSemanticInterrupt(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return SEMANTIC_INTERRUPT_PATTERNS.some(re => re.test(t));
}
