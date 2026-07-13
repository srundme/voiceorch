/**
 * transcriptQuality.ts
 *
 * P0 utilities for:
 *   A) Garbled STT transcript detection → clarification recovery
 *   C) Semantic barge-in keyword detection → instant TTS interruption
 */

export interface TranscriptQualityOptions {
  /** BCP-47 language the STT stream was configured for (e.g. en-IN, ta-IN). */
  expectedLang?: string | null;
}

// ── P0-A: Garbled transcript detection ──────────────────────────────────────

/**
 * Words that almost never end a complete thought. When an utterance has
 * ≤ MAX_TRUNCATION_WORDS words AND the last token is one of these, the STT
 * almost certainly cut the caller off mid-sentence.
 *
 * Includes English + common Hindi/Hinglish equivalents found on Indian calls.
 * Deliberately conservative — only words where an utterance-final position
 * is nearly always a truncation signal, not an ambiguous one.
 */
const TRUNCATION_DANGLER_RE =
  /\b(about|with|for|from|into|through|of|to|and|but|or|because|although|though|a|an|the|just|like|so|also|even|only|already|still|yet|both|either|neither|nor|since|until|unless|whether|while|as|if|then|than|that|this|these|those|which|who|whom|whose|when|where|how|what|why|ke|ki|ka|ko|mein|pe|par|se|ne|aur|lekin|jo|ek|toh|bhi|hi|na|kya|kaise|kyun|kyunki|jab|jahan|என்|உன்|என்|எனக்கு|உங்களுக்கு|என்ன|எந்த|இந்த|அந்த|ஒரு|மற்றும்|ஆனால்|அல்லது|ஏனெனில்|எப்படி|எங்கே|எப்போது)\s*[,.]?\s*$/i;

/** Known Sarvam silence/noise hallucinations — too short to be a real turn. */
const PHANTOM_UTTERANCE_RE =
  /^(out of|thank you|thanks|hello|hi there|are you there|can you hear me)\.?$/i;

function countScriptLetters(text: string): { latin: number; devanagari: number; tamil: number; telugu: number; other: number } {
  const counts = { latin: 0, devanagari: 0, tamil: 0, telugu: 0, other: 0 };
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) counts.latin++;
    else if (cp >= 0x0900 && cp <= 0x097f) counts.devanagari++;
    else if (cp >= 0x0b80 && cp <= 0x0bff) counts.tamil++;
    else if (cp >= 0x0c00 && cp <= 0x0c7f) counts.telugu++;
    else if (/\p{L}/u.test(ch)) counts.other++;
  }
  return counts;
}

/**
 * Flags transcripts whose Unicode script disagrees with the configured STT language.
 * Common Sarvam failure: en-IN + codemix → Gujarati/Tamil script for English speech.
 */
function checkScriptMismatch(text: string, expectedLang?: string | null): { isGarbled: boolean; reason: string } {
  if (!expectedLang) return { isGarbled: false, reason: "" };
  const bare = expectedLang.split("-")[0]?.toLowerCase() ?? "";
  const c = countScriptLetters(text);
  const indic = c.devanagari + c.tamil + c.telugu + c.other;
  const total = c.latin + indic;
  if (total < 4) return { isGarbled: false, reason: "" };

  if (bare === "en" && indic / total >= 0.65) {
    return { isGarbled: true, reason: "script-mismatch-en" };
  }
  if (bare === "ta" && c.tamil / total < 0.25 && c.devanagari / total >= 0.5) {
    return { isGarbled: true, reason: "script-mismatch-ta" };
  }
  if (bare === "hi" && c.devanagari / total < 0.25 && c.tamil / total >= 0.5) {
    return { isGarbled: true, reason: "script-mismatch-hi" };
  }
  return { isGarbled: false, reason: "" };
}

/** Max word count to consider for truncation-dangling check. */
const MAX_TRUNCATION_WORDS = 6;

/** English wh-words / intent phrases that often arrive as a split STT final. */
const ENGLISH_INCOMPLETE_FRAGMENT_RE =
  /\b(how|what|why|where|when|who|whom|whose)\s*[,.]?\s*$/i;

function isEnglishExpectedLang(expectedLang?: string | null): boolean {
  const bare = expectedLang?.split("-")[0]?.toLowerCase() ?? "";
  return bare === "en";
}

/**
 * Short English utterance that looks like the first half of a question
 * (e.g. "I want to know how" before "…I can benefit from insurance").
 */
export function isLikelyIncompleteEnglishFragment(text: string): boolean {
  const t = text.trim();
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  if (wordCount < 2 || wordCount > 8) return false;
  if (!/[A-Za-z]/.test(t)) return false;
  if (ENGLISH_INCOMPLETE_FRAGMENT_RE.test(t)) return true;
  // Trailing preposition only when the phrase is clearly an in-progress question.
  if (
    wordCount >= 3
    && /\b(i want to know|want to know|tell me|can you tell|how (can|do|to)|what (is|are))\b/i.test(t)
    && /\b(to|for|about|with)\s*[,.]?\s*$/i.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * Hold a short fragment briefly so a follow-up STT final can be merged
 * (common when Sarvam splits one English thought across two finals).
 */
export function shouldHoldFragmentForCoalesce(
  text: string,
  opts?: TranscriptQualityOptions,
): boolean {
  const t = text.trim();
  if (!t) return false;
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  if (wordCount > 8) return false;

  if (isEnglishExpectedLang(opts?.expectedLang) || isLikelyIncompleteEnglishFragment(t)) {
    return isLikelyIncompleteEnglishFragment(t);
  }

  const q = checkTranscriptQuality(t, opts);
  return q.reason === "truncated-dangling";
}

/**
 * Heuristic quality check on a raw STT transcript.
 * Catches noise, very short non-meaningful outputs, heavy repetition, and
 * mid-sentence truncations (VAD cut the caller off before they finished).
 * Does NOT cover every bad case — just the most common ones that would
 * cause the LLM to produce a confused/hallucinated reply.
 */
export function checkTranscriptQuality(
  text: string,
  opts?: TranscriptQualityOptions,
): { isGarbled: boolean; reason: string } {
  const t = text.trim();

  // Empty after trim — caller might have been silent/muted
  if (t.length < 2) return { isGarbled: true, reason: "too-short" };

  // Sarvam silence hallucinations (e.g. "Out of" during carrier noise)
  if (t.length <= 24 && PHANTOM_UTTERANCE_RE.test(t)) {
    return { isGarbled: true, reason: "phantom-utterance" };
  }

  const scriptMismatch = checkScriptMismatch(t, opts?.expectedLang);
  if (scriptMismatch.isGarbled) return scriptMismatch;

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

  // Mid-sentence truncation: short utterance that ends on a dangling word.
  // e.g. "Amakan concerned about" / "No no, I'm just" / "I was thinking and"
  // VAD fired before the caller finished the thought — ask them to repeat.
  // Only applied to short utterances (≤ MAX_TRUNCATION_WORDS) to avoid
  // false-positives on longer sentences that happen to end on these words.
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  if (wordCount <= MAX_TRUNCATION_WORDS && TRUNCATION_DANGLER_RE.test(t)) {
    // English question fragments ("I want to know how") are valid partials —
    // coalesce or the LLM should handle them, not a clarification reprompt.
    if (isEnglishExpectedLang(opts?.expectedLang) && isLikelyIncompleteEnglishFragment(t)) {
      return { isGarbled: false, reason: "" };
    }
    return { isGarbled: true, reason: "truncated-dangling" };
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

const CLARIFICATION_BY_LANG: Record<string, string[]> = {
  "ta-IN": [
    "மன்னிக்கவும், சரியாக கேட்கவில்லை — மீண்டும் சொல்ல முடியுமா?",
    "ஒரு நிமிஷம், தெளிவாக கேட்கவில்லை — தயவுசெய்து மீண்டும் சொல்லுங்கள்.",
    "மன்னிக்கவும், கொஞ்சம் தெளிவாக மீண்டும் சொல்ல முடியுமா?",
  ],
  "hi-IN": [
    "माफ़ कीजिए, मैं ठीक से सुन नहीं पाया — क्या आप दोबारा बोल सकते हैं?",
    "क्षमा करें, आवाज़ साफ़ नहीं आई — कृपया फिर से बोलिए।",
    "माफ़ कीजिए, एक बार और बोलिएगा?",
  ],
  "te-IN": [
    "క్షమించండి, స్పష్టంగా వినలేదు — మళ్ళీ చెప్పగలరా?",
    "సారీ, మీ మాట సరిగ్గా వినపడలేదు — దయచేసి మళ్ళీ చెప్పండి.",
  ],
  "kn-IN": [
    "ಕ್ಷಮಿಸಿ, ಸ್ಪಷ್ಟವಾಗಿ ಕೇಳಿಸಲಿಲ್ಲ — ದಯವಿಟ್ಟು ಮತ್ತೊಮ್ಮೆ ಹೇಳಬಹುದೇ?",
  ],
  "ml-IN": [
    "ക്ഷമിക്കണം, വ്യക്തമായി കേട്ടില്ല — ദയവായി വീണ്ടും പറയാമോ?",
  ],
  "mr-IN": [
    "माफ करा, मला नीट ऐकू आले नाही — कृपया पुन्हा सांगाल का?",
  ],
  "bn-IN": [
    "দুঃখিত, ঠিকমতো শুনতে পাইনি — আবার বলবেন?",
  ],
  "gu-IN": [
    "માફ કરશો, સ્પષ્ટ સાંભળાયું નહીં — ફરી કહેશો?",
  ],
};

function clarificationLangKey(lang?: string | null): string {
  if (!lang) return "en-IN";
  const t = lang.trim();
  if (CLARIFICATION_BY_LANG[t]) return t;
  const bare = t.split("-")[0]?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ta: "ta-IN", hi: "hi-IN", te: "te-IN", kn: "kn-IN", ml: "ml-IN",
    mr: "mr-IN", bn: "bn-IN", gu: "gu-IN",
  };
  return map[bare] ?? "en-IN";
}

let _clarificationIdx = 0;

/** Returns a rotating clarification phrase in the caller's language when known. */
export function pickClarificationPhrase(lang?: string | null, rotationKey?: string): string {
  const key = clarificationLangKey(lang);
  const pool = CLARIFICATION_BY_LANG[key] ?? CLARIFICATION_PHRASES;
  if (rotationKey) {
    let h = 0;
    for (let i = 0; i < rotationKey.length; i++) {
      h = (h * 31 + rotationKey.charCodeAt(i)) >>> 0;
    }
    return pool[h % pool.length]!;
  }
  const phrase = pool[_clarificationIdx % pool.length]!;
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

  // Tamil / Tanglish stop + language-switch cues
  /\b(english|inglish)\s*(la|le|ah|a)?\s*(pesu|pesunga|pesanum|pannunga|pannalam)\b/i,
  /\b(wait|stop)\s*(pannunga|pannalam|pannu)\b/i,
  /நிறுத்த/u,
  /காத்து/u,
  /போதும்/u,
  /இல்லை\s*,?\s*(அது|அப்படி|இல்ல)/u,
  /\bseri\s+seri\b/i,
  /\bok\s+ok\b/i,
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
