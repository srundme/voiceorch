/**
 * Live read of the caller's spoken English, built from their own transcripts.
 *
 * The recruiter grades this after the call, but for a voice process the
 * evidence is the call itself — so the agent accumulates a running score while
 * the candidate talks instead of anyone guessing at the end. Deliberately
 * rule-based: it must run on every caller turn without adding latency or an
 * extra model call.
 */
import type { IntakeEnglishRead } from "./intake-dispositions.js";

/** Turns shorter than this say nothing about fluency ("yes", "okay"). */
const MIN_WORDS_TO_SCORE = 4;
/** Below this many scored turns the read is provisional. */
const CONFIDENT_SAMPLES = 5;

/**
 * Words an Indian-English speaker reaches for once they are comfortable past
 * simple sentences. Their presence is evidence of range, never a penalty.
 */
const RANGE_MARKERS = [
  "because", "although", "however", "therefore", "currently", "previously",
  "actually", "basically", "regarding", "experience", "responsibility",
  "opportunity", "communication", "requirement", "immediately", "comfortable",
  "understand", "interested", "available", "graduated", "handling", "process",
  "customer", "international", "prefer", "willing", "relocate", "expecting",
];

/** Fillers and self-repairs. A few are normal; a lot signals struggle. */
const DISFLUENCY = [
  "um", "uh", "umm", "uhh", "hmm", "erm", "aa", "aaa", "mmm",
  "actually actually", "i mean i mean",
];

/** Explicit signals the caller is not following the conversation. */
const BREAKDOWN_PHRASES = [
  "come again", "say again", "repeat please", "please repeat", "pardon",
  "i don't understand", "i dont understand", "not understand", "no understand",
  "cannot understand", "can't understand", "i can't speak english",
  "i cant speak english", "no english", "hindi me", "hindi mein", "tamil la",
  "speak in hindi", "speak hindi", "speak tamil", "kannada", "telugu me",
];

export interface EnglishTurnInput {
  text: string;
  /** STT confidence for the turn, when the adapter reports one. */
  confidence?: number | null;
  /** Language the STT identified, when it reports one. */
  detectedLanguage?: string | null;
}

interface Signals {
  words: number;
  rangeHits: number;
  disfluencies: number;
  breakdown: boolean;
  nonEnglish: boolean;
}

const WORD_RE = /[a-z']+/g;

function signalsFor(input: EnglishTurnInput): Signals {
  const lower = input.text.toLowerCase();
  const words = lower.match(WORD_RE) ?? [];
  const wordSet = new Set(words);

  let disfluencies = 0;
  for (const token of DISFLUENCY) {
    if (token.includes(" ")) {
      if (lower.includes(token)) disfluencies += 1;
    } else if (wordSet.has(token)) {
      disfluencies += words.filter((w) => w === token).length;
    }
  }

  // Devanagari / Tamil / Telugu / Kannada / Malayalam blocks in the transcript
  // mean Saaras heard another language, not accented English.
  const hasIndicScript = /[\u0900-\u097F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F]/.test(input.text);
  const langCode = (input.detectedLanguage ?? "").toLowerCase();
  const nonEnglish = hasIndicScript || (langCode !== "" && !langCode.startsWith("en"));

  return {
    words: words.length,
    rangeHits: RANGE_MARKERS.filter((m) => wordSet.has(m)).length,
    disfluencies,
    breakdown: BREAKDOWN_PHRASES.some((p) => lower.includes(p)),
    nonEnglish,
  };
}

/** 0–100 for a single turn. */
function scoreTurn(s: Signals, confidence?: number | null): number {
  let score = 55;

  // Sentence length is the strongest single cue at this granularity.
  if (s.words >= 25) score += 18;
  else if (s.words >= 15) score += 12;
  else if (s.words >= 9) score += 6;
  else if (s.words <= 5) score -= 8;

  score += Math.min(15, s.rangeHits * 5);
  score -= Math.min(20, s.disfluencies * 6);
  if (s.breakdown) score -= 30;
  if (s.nonEnglish) score -= 25;

  // A consistently low STT confidence on a clean line tracks unclear speech.
  if (typeof confidence === "number" && confidence > 0) {
    if (confidence < 0.6) score -= 10;
    else if (confidence > 0.9) score += 5;
  }

  return Math.max(0, Math.min(100, score));
}

function ratingFor(score: number): IntakeEnglishRead["rating"] {
  if (score >= 82) return "Excellent";
  if (score >= 70) return "Very good";
  if (score >= 58) return "Good";
  if (score >= 45) return "Average";
  return "Poor";
}

function describe(s: Signals): string | null {
  if (s.breakdown) return "asked for repetition or said they cannot follow English";
  if (s.nonEnglish) return "answered in another language";
  if (s.disfluencies >= 3) return "frequent hesitation and fillers";
  if (s.words >= 16 && s.rangeHits >= 2) return "long, well-connected sentences";
  if (s.words >= 15) return "full sentences, steady flow";
  if (s.words <= 5) return "very short answers";
  return null;
}

const EMPTY: IntakeEnglishRead = { rating: "Good", confidence: 0, evidence: [], samples: 0 };

/**
 * Folds one caller turn into the running read. Short turns are ignored rather
 * than dragging the average down — "yes" is not weak English.
 */
export function updateEnglishRead(
  current: IntakeEnglishRead | null | undefined,
  turn: EnglishTurnInput,
): IntakeEnglishRead {
  const base = current ?? EMPTY;
  const text = (turn.text ?? "").trim();
  if (!text) return base;

  const s = signalsFor({ ...turn, text });
  // A breakdown signal counts even when it is a three-word turn, because
  // "please repeat" is itself the finding.
  if (s.words < MIN_WORDS_TO_SCORE && !s.breakdown && !s.nonEnglish) return base;

  const turnScore = scoreTurn(s, turn.confidence);
  const samples = base.samples + 1;

  // Running mean over prior turns, recovered from the stored rating band.
  const priorScore = base.samples > 0 ? bandCenter(base.rating) : turnScore;
  const blended = (priorScore * base.samples + turnScore) / samples;

  const note = describe(s);
  const evidence = note && !base.evidence.includes(note)
    ? [...base.evidence, note].slice(-6)
    : base.evidence;

  return {
    rating: ratingFor(blended),
    confidence: Math.min(1, samples / CONFIDENT_SAMPLES),
    evidence,
    samples,
  };
}

function bandCenter(rating: IntakeEnglishRead["rating"]): number {
  switch (rating) {
    case "Excellent": return 88;
    case "Very good": return 76;
    case "Good": return 64;
    case "Average": return 51;
    case "Poor": return 35;
  }
}

/** The value written to `englishCommunication` when the form is closed. */
export function englishRatingForForm(read: IntakeEnglishRead | null | undefined): string | null {
  if (!read || read.samples === 0) return null;
  return read.rating;
}
