/**
 * transcriptQuality.ts
 *
 * P0 utilities for:
 *   A) Garbled STT transcript detection → clarification recovery
 *   C) Semantic barge-in keyword detection → instant TTS interruption
 */

import { isHoldRequest } from "./conversationDiscipline.js";

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
// NOTE: Do NOT include bare `yet` — "No, not yet." is a complete answer (call 4943
// false-clarification). `already`/`still` stay; they almost never end a finished thought alone.
const TRUNCATION_DANGLER_RE =
  /\b(about|with|for|from|into|through|of|to|and|but|or|because|although|though|a|an|the|just|like|so|also|even|only|already|still|both|either|neither|nor|since|until|unless|whether|while|as|if|then|than|that|this|these|those|which|who|whom|whose|when|where|how|what|why|ke|ki|ka|ko|mein|pe|par|se|ne|aur|lekin|jo|ek|toh|bhi|hi|na|kya|kaise|kyun|kyunki|jab|jahan|என்|உன்|என்|எனக்கு|உங்களுக்கு|என்ன|எந்த|இந்த|அந்த|ஒரு|மற்றும்|ஆனால்|அல்லது|ஏனெனில்|எப்படி|எங்கே|எப்போது)\s*[,.…]*\s*$/i;

/**
 * Devanagari postpositions and conjunctions that almost never end a finished
 * thought ("सौ करोड़ से", "मुझे 30 लाख का").
 *
 * Kept separate from TRUNCATION_DANGLER_RE because `\b` is ASCII-only in JS —
 * a Devanagari alternation placed there can never match, which left Hindi-script
 * agents with no truncation detection at all while Hinglish ("Jaipur se") worked.
 * Anchored on whitespace instead, and `।` counts as terminal punctuation.
 */
const DEVANAGARI_DANGLER_RE =
  /(?:^|\s)(से|को|में|पे|पर|का|की|के|ने|तक|और|या|लेकिन|क्योंकि|कि|अगर|जब|जहाँ|जहां|तो|भी|ही)\s*[,.।]?\s*$/u;

/** Complete short negations that end on "yet" / time words — never clarification-bait. */
const COMPLETE_SHORT_NEGATION_RE =
  /^(no|nope|nah)[,!]?\s+(not\s+)?(yet|now|really|today|ready)\.?$/i;

/** Known Sarvam silence/noise hallucinations — too short to be a real turn.
 *  Deliberately excludes normal greetings/acks ("hello", "thanks") — those are
 *  valid caller speech and must reach the LLM. */
const PHANTOM_UTTERANCE_RE =
  /^(out of|hi there|are you there|can you hear me)\.?$/i;

/** Complete short greetings, acks, and backchannels — never clarification-bait. */
const VALID_COMPLETE_SHORT_UTTERANCE_RE =
  /^(hi|hello|hey|hiya|yo|yes|yeah|yep|yup|no|nope|ok|okay|sure|right|fine|thanks|thank you|bye|goodbye|namaste|vanakkam|ji|jee)([,.]|\s+(madam|ma'?am|sir|there|ji|jee))?\.?$/i;

/**
 * One-word product / portal answers callers actually say (call 20094: "B2B"
 * was classified as short-allcaps-noise and triggered "I didn't hear you").
 */
const DOMAIN_ACRONYM_RE =
  /^(b2b|b2c|b2g|b2b2c|crm|api|otp|upi|gst|sme|dmc|tbo|fd|ivr|sip|did|kyc|pan|gstin|whatsapp)$/i;

/** Spoken Hindi/English forms of B2B / B2C that Saaras often writes instead of the acronym. */
const SPOKEN_DOMAIN_TERM_RE =
  /^(b\s*2\s*b|b\s*2\s*c|b\s*to\s*b|b\s*to\s*c|be\s*to\s*be|बी\s*टू\s*बी|बी\s*टू\s*सी)$/iu;

export function isDomainOrAcronymAnswer(text: string): boolean {
  const t = text.trim().replace(/[.,!।?]+$/g, "").trim();
  if (!t) return false;
  if (DOMAIN_ACRONYM_RE.test(t)) return true;
  if (SPOKEN_DOMAIN_TERM_RE.test(t)) return true;
  // Letter-digit-letter product codes: B2B, B2C, 4G
  if (/^[A-Za-z]\d[A-Za-z]$/.test(t)) return true;
  return false;
}

/** Reduplicated pure ack ("Okay Okay.") — treat as content-bearing, not noise. */
const REDUPLICATED_ACK_RE =
  /^(ok(ay)?|yes|yeah|ஆமா|சரி|ठीक|ओके|अच्छा)([\s,.!]+(ok(ay)?|yes|yeah|ஆமா|சரி|ठीक|ओके|अच्छा)){0,2}[\s,.!]*$/i;

/** Indic one-word acks / negations — backchannel, not a standalone question. */
const INDIC_SINGLE_ACK_RE =
  /^(சரி|சரிங்க|ஆமா|ஆம்|இல்ல|இல்லை|हां|हाँ|ठीक|ओके|अच्छा|जी|haan|han|theek|accha|hmm|hm|mm|ji|jee)[\s,.!]*$/iu;

/** Indic/Hinglish ack + vocative chains ("ஆமா சார் ஆமா.", "okay sir", "अच्छा जी"). */
const INDIC_ACK_VOCATIVE_RE =
  /^(ஆமா|ஆம்|சரி|ठीक|ओके|अच्छा|haan|ok(?:ay)?)([\s,.!]+(சார்|sir|जी|ji|madam|மா.?ம்|ஆமா|ஆம்|சரி|हां|हाँ|ठीक|ओके|अच्छा|haan|ok(?:ay)?)){0,4}[\s,.!]*$/iu;

/**
 * Short contextual replies that must reach the LLM even if they arrive while
 * TTS is still draining (call 20094: "हाँ जी" discarded as self-echo; "B2B"
 * then "clarified"). Content-echo still applies — this only skips energy-only discard.
 */
export function looksLikeShortContextualAnswer(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isDomainOrAcronymAnswer(t)) return true;
  if (VALID_COMPLETE_SHORT_UTTERANCE_RE.test(t)) return true;
  if (INDIC_SINGLE_ACK_RE.test(t)) return true;
  if (INDIC_ACK_VOCATIVE_RE.test(t)) return true;
  if (/^(जी|हाँ|हां|हां जी|हाँ जी|haan ji|han ji|ji|jee)[\s,.!]*$/iu.test(t)) return true;
  // Call 20275: "Yes yes, just only." / "Yeah, that's that's only." must not
  // become "I didn't get that" after a late barge.
  if (/^(yes|yeah|yep)([\s,]+(yes|yeah|yep)){0,3}[\s,]+((just|that's|thats)\s+)*only\.?$/i.test(t)) {
    return true;
  }
  return false;
}

/** English ack/backchannel only — excludes greetings/farewells (those are real turns). */
const ENGLISH_BACKCHANNEL_ONLY_RE =
  /^(yes|yeah|yep|yup|no|nope|ok|okay|sure|right|fine|hmm|hm|mm)([,.]|\s+(madam|ma'?am|sir|there))?\.?$/i;

/**
 * Pure backchannel / filler ack — not a substantive caller turn on its own.
 * Used to coalesce Tamil/Hindi "சரி"/"ஆமா" with a follow-up question, skip
 * eager speculative LLM, and suppress agent filler TTS on ack-only turns.
 */
export function isBackchannelOnlyUtterance(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (isSemanticInterrupt(t) || isTopicClarificationAsk(t) || isCallerAudioDifficulty(t)) {
    return false;
  }
  if (/[?？]/.test(t)) return false;
  if (/(முடியுமா|கேளுங்க|சொல்லுங்க|விளக்க|explain|tell me|என்ன|எப்படி|எங்க|ஏன்|time|கேட்க)/iu.test(t)) {
    return false;
  }
  if (ENGLISH_BACKCHANNEL_ONLY_RE.test(t)) return true;
  if (REDUPLICATED_ACK_RE.test(t)) return true;
  if (INDIC_SINGLE_ACK_RE.test(t)) return true;
  if (INDIC_ACK_VOCATIVE_RE.test(t)) return true;
  return false;
}

/** Caller asks to clarify / re-explain the last topic (often mid-sentence STT). */
export function isTopicClarificationAsk(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    /\b(what (was|is) that|about the|tell me (more )?about|explain( it| again)?|what (did|were) you (saying|telling))\b/i.test(t)
    || /\b(என்ன|அது என்ன|மீண்டும் சொல்ல|விளக்க)\b/u.test(t)
    || /\b(क्या था|फिर से समझा|बताओ तो)\b/u.test(t)
  );
}

/** Caller reports they cannot hear the agent (audio quality / cut TTS). */
export function isCallerAudioDifficulty(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    /\b(can'?t|cannot|couldn'?t)\s+(hear|listen)\b/i.test(t)
    || /\b(not\s+hearing|didn'?t\s+hear|don'?t\s+hear)\b/i.test(t)
    || /\b(volume|voice)\s+(is\s+)?(low|soft|unclear)\b/i.test(t)
    || /கேட்க(ல|வில்லை|முடியல)|கேக்க(ல|வில்லை)|கேட்குறது\s*(இல்ல|தெரியல)|சத்தம்\s*(கேக்க|இல்ல)/u.test(t)
    || /सुनाई\s*नहीं|आवाज़\s*नहीं|सुन\s*नहीं/u.test(t)
    || /கேட்டு\s*வேணாம்|கேட்கலைய்|கேட்கலை/u.test(t)
    || /\b(are you there|can you hear(?:\s+me)?)\b/i.test(t)
    || /^(hello[\s,]+)+hello\b/i.test(t)
  );
}

/**
 * Bolna-style accidental interruption scrap: short non-semantic finals that
 * arrive because energy barge-in cut the agent, not because the caller had a
 * real turn. These must NOT run a full LLM reply.
 */
export function isFalseInterruptionScrap(
  text: string,
  _wordsForInterruption: number,
): boolean {
  const t = text.trim();
  if (!t) return true;
  if (isCallerAudioDifficulty(t)) return false;
  if (isTopicClarificationAsk(t)) return false;
  if (isAccidentalInterruptPhrase(t) || isSemanticInterrupt(t)) return false;
  // Questions / requests are never barge scraps (call 2638 dropped "பண்ண முடியுமா?").
  if (/[?？]/.test(t)) return false;
  if (/(முடியுமா|கேளுங்க|சொல்லுங்க|விளக்க|explain|tell me|என்ன|எப்படி)\b/iu.test(t)) return false;
  if (isUltraShortNoiseFragment(t)) return true;

  // If a phrase has 2 or more words and is not an ultra-short noise fragment, it is a valid substantive speech.
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return false;

  // Single word turns that are not ultra-short noise stubs (like "Members", "Tomorrow", "Keerthi")
  // are valid and should not be discarded.
  return false;
}

/**
 * Ultra-short STT noise that should NOT run an LLM turn.
 *
 * Keep this extremely narrow: call 2632 showed a prior ≤14-grapheme / ≤2-token
 * rule silently ate real one-word Tamil replies ("இருக்கு", "நல்லா", "சொல்லுங்க")
 * before STT was even logged — so Studio looked like "STT only hears 3+ words".
 * Incomplete mid-phrase scraps after barge-in are handled by
 * `isFalseInterruptionScrap` instead.
 */
/**
 * English content-free stubs that STT often emits from noise / mid-cut scraps
 * (call 4943: lone "get" became a full LLM turn). Keep allowlists above for
 * real acks; only drop known non-answers.
 */
const ENGLISH_NOISE_STUB_RE =
  /^(get|got|oh|uh|um|ah|eh|er|hmm|mm|mhm|huh|ha|the|a|an|to|of|in|on|at|is|am|are|was|be|do|did|have|has|had|will|would|can|could|like|so|well|just|and|but|or|if|then|me|my|you|ya|he|she|it|we|they)\.?$/i;

export function isUltraShortNoiseFragment(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (isDomainOrAcronymAnswer(t)) return false;
  if (VALID_COMPLETE_SHORT_UTTERANCE_RE.test(t)) return false;
  if (REDUPLICATED_ACK_RE.test(t)) return false;
  if (COMPLETE_SHORT_NEGATION_RE.test(t)) return false;
  // Common Indic one-word acks / negations — keep for flow control
  // Include romanized "ji" (call 20094 discarded "Ji" as a 2-grapheme stub).
  if (/^(சரி|சரிங்க|ஆமா|ஆம்|இல்ல|இல்லை|हां|हाँ|ठीक|ओके|अच्छा|जी|नहीं|nahi|haan|ha[a]?n|ji|jee)[\s,.!]*$/iu.test(t)) {
    return false;
  }
  if (/^(bye|goodbye|thanks|thank you|நன்றி|வணக்கம்|धन्यवाद)\b/i.test(t)) return false;
  if (/[?？]/.test(t)) return false;
  if (/\b(how|what|why|where|when|who|என்ன|எப்படி|எங்க|ஏன்|क्या|कैसे)\b/i.test(t)) return false;

  const tokens = t.split(/\s+/).filter(Boolean);
  const compact = t.replace(/[\s,.!?;:'"“”‘’…]+/g, "");
  const graphemes = [...compact].length;

  // Only pure single-syllable stubs ("ஆ", "அ", "mm") — never whole short answers.
  if (tokens.length <= 1 && graphemes <= 2) return true;

  // Lone English function-word / filler stubs (3–5 letters) — wait for more speech.
  if (tokens.length === 1 && ENGLISH_NOISE_STUB_RE.test(t)) return true;

  return false;
}

function countScriptLetters(text: string): {
  latin: number;
  devanagari: number;
  tamil: number;
  telugu: number;
  kannada: number;
  other: number;
} {
  const counts = { latin: 0, devanagari: 0, tamil: 0, telugu: 0, kannada: 0, other: 0 };
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) counts.latin++;
    else if (cp >= 0x0900 && cp <= 0x097f) counts.devanagari++;
    else if (cp >= 0x0b80 && cp <= 0x0bff) counts.tamil++;
    else if (cp >= 0x0c00 && cp <= 0x0c7f) counts.telugu++;
    else if (cp >= 0x0c80 && cp <= 0x0cff) counts.kannada++;
    else if (/\p{L}/u.test(ch)) counts.other++;
  }
  return counts;
}

/** Unexpected Indic ranges for a latched language (LID drift, not a real switch). */
function unexpectedScriptRanges(bareLang: string): Array<[number, number]> {
  if (bareLang === "hi" || bareLang === "mr" || bareLang === "ne") {
    return [
      [0x0b80, 0x0bff], // Tamil
      [0x0c00, 0x0c7f], // Telugu
      [0x0c80, 0x0cff], // Kannada
      [0x0d00, 0x0d7f], // Malayalam
    ];
  }
  if (bareLang === "ta") {
    return [
      [0x0900, 0x097f],
      [0x0c00, 0x0c7f],
      [0x0c80, 0x0cff],
      [0x0d00, 0x0d7f],
    ];
  }
  return [];
}

export function hasUnexpectedScriptLeak(text: string, expectedLang?: string | null): boolean {
  const bare = expectedLang?.split("-")[0]?.toLowerCase() ?? "";
  const ranges = unexpectedScriptRanges(bare);
  if (ranges.length === 0) return false;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ranges.some(([lo, hi]) => cp >= lo && cp <= hi)) return true;
  }
  return false;
}

/**
 * Drop tokens written in a script that cannot be the latched language
 * (call 20094: Hindi call leaked Kannada "ಮಾಡ್ತಾ" into an otherwise Hinglish line).
 * Does not invent words — just removes the foreign-script tokens.
 */
export function repairUnexpectedScriptLeak(text: string, expectedLang?: string | null): string {
  if (!text || !hasUnexpectedScriptLeak(text, expectedLang)) return text;
  const ranges = unexpectedScriptRanges(expectedLang?.split("-")[0]?.toLowerCase() ?? "");
  const cleaned = text
    .split(/(\s+)/)
    .map((tok) => {
      if (/^\s+$/.test(tok)) return tok;
      let leak = 0;
      for (const ch of tok) {
        const cp = ch.codePointAt(0) ?? 0;
        if (ranges.some(([lo, hi]) => cp >= lo && cp <= hi)) leak++;
      }
      return leak > 0 ? "" : tok;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || text;
}

/**
 * When the final is contaminated with a foreign script and the same-turn
 * partial is clean Hindi/English, keep the partial (call 20094 eager
 * "इन्वेस्ट करते हैं ना" vs final with Kannada).
 */
export function preferStableTranscript(
  finalText: string,
  hint: string,
  expectedLang?: string | null,
): string {
  const repaired = repairUnexpectedScriptLeak(finalText, expectedLang);
  const hintTrim = hint.trim();
  if (!hintTrim) return repaired;
  if (
    hasUnexpectedScriptLeak(finalText, expectedLang)
    && !hasUnexpectedScriptLeak(hintTrim, expectedLang)
    && hintTrim.length >= 4
    && !isBackchannelOnlyUtterance(hintTrim)
  ) {
    return hintTrim;
  }
  return repaired;
}

/**
 * Flags transcripts whose Unicode script disagrees with the configured STT language.
 * Indic on an English-configured agent is a language switch, not garbled STT.
 */
function checkScriptMismatch(text: string, expectedLang?: string | null): { isGarbled: boolean; reason: string } {
  if (!expectedLang) return { isGarbled: false, reason: "" };
  const bare = expectedLang.split("-")[0]?.toLowerCase() ?? "";
  const c = countScriptLetters(text);
  const indic = c.devanagari + c.tamil + c.telugu + c.kannada + c.other;
  const total = c.latin + indic;
  if (total < 4) return { isGarbled: false, reason: "" };

  // Indic on an English-configured agent is a language switch, not noise.
  // Treating it as garbled made live Tamil inbound hear "I didn't get that"
  // twice (call 11234) even though Saaras transcribed the line correctly.
  if (bare === "en" && indic / total >= 0.65) {
    return { isGarbled: false, reason: "script-switch-en" };
  }
  if (bare === "ta" && c.tamil / total < 0.25 && c.devanagari / total >= 0.5) {
    return { isGarbled: true, reason: "script-mismatch-ta" };
  }
  if (bare === "hi" && c.devanagari / total < 0.25 && (c.tamil + c.kannada) / total >= 0.5) {
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

  if (isBackchannelOnlyUtterance(t)) return true;

  if (isLikelyIncompleteEnglishFragment(t)) return true;

  // Hold clearly-truncated fragments that end on a dangling preposition/
  // conjunction ("Why don't we plan for", "concerned about") so a follow-up
  // STT final can merge, instead of firing a false "I didn't catch that".
  // Applies to English too: Sarvam commonly splits one English thought across
  // two finals. If no follow-up arrives, the coalesce timer re-emits the
  // fragment and the garbled-transcript path still clarifies as a fallback.
  const q = checkTranscriptQuality(t, opts);
  return q.reason === "truncated-dangling";
}

const TAMIL_CONTINUATION_TAIL_RE =
  /(ஆனால்|ஆனா|வந்து|இருந்து|பண்ண|பண்ணி|போய்|சொல்லி|பார்த்து|கேட்டு|ஒரு)\s*[,.…]*\s*$/u;

const HINDI_CONTINUATION_TAIL_RE =
  /(लेकिन(\s+मैं)?|क्योंकि|सोच\s+रहा|सोच\s+रही|वाला|वाली|वाले)\s*[,.।…]?\s*$/u;

/**
 * Semantic continuation veto for the turn gate — not a 3-phrase exact list.
 * Detects dangling conversational structure ("I want to participate but…",
 * "Actually I was thinking", "நான் participate பண்ண", "लेकिन मैं").
 *
 * Distinct from shouldHoldFragmentForCoalesce: backchannel acks ("yes" / "சரி")
 * are complete turns here. This is only "the sentence signals they are still talking".
 */
export function signalsConversationalContinuation(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (VALID_COMPLETE_SHORT_UTTERANCE_RE.test(t)) return false;
  if (COMPLETE_SHORT_NEGATION_RE.test(t) || /\bnot yet\.?$/i.test(t)) return false;
  if (INDIC_SINGLE_ACK_RE.test(t) || INDIC_ACK_VOCATIVE_RE.test(t)) return false;
  if (REDUPLICATED_ACK_RE.test(t)) return false;
  // Pure acks are complete turns for EOU. "yeah but" is not a pure ack.
  if (isBackchannelOnlyUtterance(t) && !/\bbut\b|ஆனால்|ஆனா|लेकिन|lekin/i.test(t)) {
    return false;
  }

  if (/[…]|\.{2,}\s*$/.test(t)) return true;

  if (/^(yes|yeah|yep|yup|no|nope|ok|okay|sure)[,.]?\s+but\b/i.test(t)) return true;

  if (
    /\b(i was thinking|i was wondering|i was going to|i was about to|i wanted to|i was saying|actually i was|the thing is|wait[,.]? i)\s*[,.…]*\s*$/i.test(t)
  ) {
    return true;
  }

  if (TAMIL_CONTINUATION_TAIL_RE.test(t)) return true;
  if (HINDI_CONTINUATION_TAIL_RE.test(t)) return true;
  if (/\b(lekin|kyunki)\b/i.test(t) && !/[?？]$/.test(t) && !/[.?!।]$/.test(t)) return true;

  const hasStrongTerminal = /[.?!।]$/u.test(t) && !/[…]|\.{2,}/.test(t);
  if (hasStrongTerminal) {
    return /\b(but|although|though|because)\s*[.?!।]$/i.test(t)
      || /(ஆனால்|ஆனா|लेकिन)\s*[.?!।]$/u.test(t);
  }

  if (/\b(but|although|though|because|unless|until|whereas)\s*[,.…]*\s*$/i.test(t)) {
    return true;
  }

  const wordCount = t.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 3 && /\b(the|a|an|to|for|of|with|about|from)\s*[,.…]*\s*$/i.test(t)) {
    return true;
  }

  if (TRUNCATION_DANGLER_RE.test(t)) return true;
  if (wordCount >= 2 && DEVANAGARI_DANGLER_RE.test(t)) return true;

  return false;
}

/**
 * Short talk-over that is not an ack and has no sentence end — a sentence
 * start, not chatter. Used while TTS is playing so we hold for the rest of
 * the utterance instead of dropping it (call 21818: "எனக்கு இப்போ").
 * Structure only: punctuation + length + not-a-backchannel. No word lists.
 */
export function looksLikeIncompleteClauseStart(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isBackchannelOnlyUtterance(t) || isUltraShortNoiseFragment(t)) return false;
  if (isSemanticInterrupt(t) || isAccidentalInterruptPhrase(t) || isHardInterruptTranscript(t)) {
    return false;
  }
  if (/[?？]$/u.test(t)) return false;
  if (/[.।!]$/u.test(t) && !/[…]|\.{2,}/.test(t)) return false;
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  return wordCount >= 1 && wordCount <= 6;
}

/**
 * STT sometimes loops a short phrase for the whole VAD window
 * ("I said, I said, I said, …"). Collapse to one copy. Language-agnostic.
 */
export function collapseRepeatedUtterance(text: string): string {
  const t = text.trim();
  if (!t) return t;

  const norm = (s: string) => s.toLowerCase().replace(/[,.!?।;:]+$/g, "").trim();
  const clauses = t.split(/[,.!।;]+\s*|\s{2,}/).map((s) => s.trim()).filter(Boolean);
  if (clauses.length >= 3) {
    const first = norm(clauses[0]);
    if (first) {
      const same = clauses.filter((c) => norm(c) === first);
      if (same.length >= 3 && same.length / clauses.length >= 0.7) {
        return clauses[0];
      }
    }
  }

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 6) {
    const low = words.map((w) => w.replace(/[,.!?।;:]+$/g, "").toLowerCase());
    for (const n of [1, 2, 3, 4]) {
      const unit = low.slice(0, n).join(" ");
      if (!unit) continue;
      let reps = 0;
      let i = 0;
      while (i + n <= low.length && low.slice(i, i + n).join(" ") === unit) {
        reps++;
        i += n;
      }
      if (reps >= 3 && i >= words.length * 0.7) {
        return words.slice(0, n).join(" ");
      }
    }
  }
  return t;
}

/** Collapsed a long STT loop into a thin scrap — not a caller turn. */
export function isStutterLoopTranscript(original: string, collapsed: string): boolean {
  const o = original.trim();
  const c = collapsed.trim();
  if (!o || !c || o === c) return false;
  const words = c.split(/\s+/).filter(Boolean);
  return words.length <= 4 && o.length >= c.length * 3;
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

  // Product codes / portal answers must never become "I didn't hear you"
  // (call 20094: "B2B" matched short-allcaps-noise).
  if (isDomainOrAcronymAnswer(t) || looksLikeShortContextualAnswer(t)) {
    return { isGarbled: false, reason: "" };
  }

  // Normal one-word greetings / acks ("Hi", "Hello", "Okay") — complete turns.
  if (VALID_COMPLETE_SHORT_UTTERANCE_RE.test(t)) {
    return { isGarbled: false, reason: "" };
  }

  // Complete short negations ("No, not yet.") — never ask the caller to repeat.
  if (COMPLETE_SHORT_NEGATION_RE.test(t) || /\bnot yet\.?$/i.test(t)) {
    return { isGarbled: false, reason: "" };
  }

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
  // e.g. "Z Z Z", "QQ QQ". Do NOT flag digits (B2B) or a single 2–5 letter
  // acronym without spaces (CRM, API, OTP) — those are real one-word answers.
  if (t.length <= 6 && /^[^a-z\u0900-\u097f]+$/u.test(t) && /[A-Z]/.test(t)) {
    if (/\d/.test(t) || (!/\s/.test(t) && t.length >= 2 && t.length <= 5)) {
      return { isGarbled: false, reason: "" };
    }
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
  // A lone Devanagari particle ("एक", "तो") is too often a complete answer to
  // treat as truncation, so the script path needs at least two words.
  const danglesInDevanagari = wordCount >= 2 && DEVANAGARI_DANGLER_RE.test(t);
  if (wordCount <= MAX_TRUNCATION_WORDS && (TRUNCATION_DANGLER_RE.test(t) || danglesInDevanagari)) {
    // English greeting "Hi" must not match the Hindi emphatic-particle dangler `hi`.
    if (wordCount === 1 && /^hi\.?$/i.test(t)) {
      return { isGarbled: false, reason: "" };
    }
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
 * Bolna ACCIDENTAL_INTERRUPTION_PHRASES — short phrases that MUST interrupt
 * even under the word-count threshold (and must never be dropped as scraps).
 */
export const ACCIDENTAL_INTERRUPTION_PHRASES = new Set([
  "stop", "quit", "bye", "wait", "no", "wrong", "incorrect", "hold", "pause", "break",
  "cease", "halt", "silence", "enough", "excuse", "hold on", "hang on", "cut it",
  "that's enough", "thats enough", "shush", "listen", "excuse me", "hold up", "not now",
  "stop there", "stop speaking",
  "போதும்", "நிறுத்து", "காத்து", "रुको", "बस",
]);

export function isAccidentalInterruptPhrase(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/g, "");
  if (!t) return false;
  const compact = t.replace(/\s+/g, " ");
  return ACCIDENTAL_INTERRUPTION_PHRASES.has(compact);
}

/** Tokens that mean the speaker is addressing the other person — echo of our
 *  own TTS almost never adds these. Call 14345: "ஒரு நிமிஷம் நீங்க" was dropped
 *  as self-echo of the greeting's "ஒரு நிமிஷம் time கிடைக்குமா?". */
const CALLER_ADDRESS_TOKENS = new Set([
  "நீங்க", "நீங்கள்", "நான்", "நாங்க", "you", "i", "we", "me",
]);

export function hasCallerAddressToken(tokens: string[]): boolean {
  return tokens.some((t) => CALLER_ADDRESS_TOKENS.has(t.toLowerCase()));
}

/** Short "hello" / "வணக்கம்" to get the agent's attention — never far-field-drop. */
export function isCallerAttentionUtterance(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/g, "");
  if (!t) return false;
  return /^(hello|hi|hey|vanakkam|வணக்கம்|ஹலோ)(\s+(sir|madam|சார்|மேடம்))?$/.test(t);
}

/**
 * Room / meeting talk aimed at someone else, not the agent.
 * Call 20257: "Hello இங்க பாருங்க" barged the greeting; "Participants…" then
 * "punishment… protocol" became a real turn. Transcript-side drop — not an
 * RMS gate (call 14351).
 */
const CROSSTALK_RE =
  /(?:இங்க\s*பாருங்க|இங்க\s*பார்|idhar\s*dekh|look\s*here|look\s*at\s*this|(?:^|[\s,.])participants?\b|\bunmute\b|share\s+(?:the\s+)?screen|punishment.{0,48}protocol|protocol.{0,48}punishment)/iu;

export function isLikelyCrosstalkUtterance(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isSemanticInterrupt(t) || isHoldRequest(t) || looksLikeBookingTimeAnswer(t)) {
    return false;
  }
  if (looksLikeShortContextualAnswer(t) || isDomainOrAcronymAnswer(t)) return false;
  return CROSSTALK_RE.test(t);
}

/**
 * Returns true if the transcript contains a semantic interruption signal.
 * Called on both interim and final transcripts from streaming STT.
 */
export function isSemanticInterrupt(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isAccidentalInterruptPhrase(t)) return true;
  return SEMANTIC_INTERRUPT_PATTERNS.some(re => re.test(t));
}

/**
 * Caller named a day/time for booking while the agent was still talking.
 * Energy-only self-echo discard must not drop these (call 14160: "कल टेन थर्टी मैडम"
 * was thrown away because RMS never cleared the echo bar). Content self-echo
 * still applies — if the transcript is the agent's own "three PM or four PM",
 * that path remains.
 */
/**
 * PSTN barge-in must only cut TTS on a clear interrupt (stop/wait) or a slot
 * answer. Generic / garbled echo of our own pitch must not clearAudio.
 */
export function isHardInterruptTranscript(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isBackchannelOnlyUtterance(t) || isCallerAttentionUtterance(t)) return false;
  if (isSemanticInterrupt(t)) return true;
  // Slot answers are short ("2 pm", "காலை"). A long echo of our pitch that
  // merely contains "today" / "two" must not clearAudio mid-call.
  const tokenCount = t.split(/\s+/).filter(Boolean).length;
  if (tokenCount > 8 || [...t].length > 48) return false;
  return looksLikeBookingTimeAnswer(t);
}

export function looksLikeBookingTimeAnswer(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\b\d{1,2}[:.]\d{2}\b/.test(t)) return true;
  if (/\b\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?)\b/i.test(t)) return true;
  if (
    /\b(?:ten|eleven|twelve|one|two|three|four|five|six|seven|eight|nine)\s*(?:thirty|fifteen|forty[\s-]?five|o'?clock)?\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(?:tomorrow|today|tonight|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return /(?:कल|परसों|आज|सुबह|दोपहर|शाम|बजे|टेन|थर्टी|इलेवन|ट्वेल्व|நாளை|இன்னைக்கு|இன்று|காலை|மாலை|மதியம்|மணிக்கு|மணி)/u.test(t);
}

/**
 * Normalises spoken Indian email tokens into valid formatted email strings.
 * E.g., "karthik 1 2 3 அட் ஜிமெல் டாட் காம்" -> "karthik123@gmail.com"
 * "user name ऐट जीमेल डॉट कॉम" -> "username@gmail.com"
 */
/**
 * True when two transcripts are the same utterance heard twice. Used to suppress a
 * streaming final that arrives after the same audio was already recovered through
 * batch STT — otherwise the caller's turn is processed twice.
 *
 * Compares on a punctuation-stripped, case-folded token basis and accepts either an
 * exact match or a high containment ratio, since the two engines routinely differ on
 * filler words and trailing punctuation for identical audio.
 */
export function isNearDuplicateUtterance(a: string, b: string): boolean {
  const tokenize = (s: string): string[] =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean);

  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.length || !tb.length) return false;
  if (ta.join(" ") === tb.join(" ")) return true;

  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  // Single-token utterances are too common ("yes", "okay") to match loosely — a
  // caller really can say "yes" twice in a row.
  if (shorter.length < 2) return false;
  const pool = new Map<string, number>();
  for (const t of longer) pool.set(t, (pool.get(t) ?? 0) + 1);
  let shared = 0;
  for (const t of shorter) {
    const left = pool.get(t) ?? 0;
    if (left > 0) {
      shared++;
      pool.set(t, left - 1);
    }
  }
  return shared / shorter.length >= 0.8;
}

/** Words that introduce an address rather than form part of it — the username join stops here. */
const USERNAME_CARRIER_WORDS = new Set([
  "my", "the", "this", "that", "it", "its", "it's", "is", "are", "was", "be",
  "email", "e-mail", "mail", "id", "address", "please", "send", "to", "and",
  "ஈமெயில்", "மெயில்", "ஐடி", "முகவரி", "ईमेल", "मेल", "आईडी", "पता",
]);
/** A username said as whole words ("user name") is short — anything longer is speech. */
const MAX_USERNAME_WORDS = 2;
/** Upper bound for letter-by-letter dictation ("k a r t h i k e y a n 0 1"). */
const MAX_USERNAME_TOKENS = 40;

export function normalizeSpokenEmail(text: string): string {
  if (!text) return text;
  let s = text;

  // Only apply email transformation when the text is CONFIDENTLY an email.
  // A bare "at" or "dot" is far too common in ordinary speech: "book an appointment
  // tomorrow at 11" once tripped this gate, "at" became "@", and the username
  // de-spacing below then collapsed the whole sentence into
  // "Iwanttobookanappointmenttomorrow@11:00 AM" (call 5490). Require either an
  // explicit address marker or a mail-domain token before touching anything.
  const hasAddressMarker = /(@|at\s*the\s*rate|at\s*rate|அட்ட\s*ரைட்|அட்\s*ரைட்|அட்|ऐट)/iu.test(s);
  const hasDomainMarker =
    /(ஜிமெயில்|ஜிமெல்|जीमेल|jmail|g\s*mail|gmail|யாகூ|याहू|yahoo|ஹாட்மெயில்|हॉटमेल|hotmail|டாட்\s*காம்|டட்காம்|डॉट\s*कॉम|dot\s*com|dotcom|dot\s*in|dot\s*org|\.com|\.in\b|\.org)/iu.test(s);
  if (!hasDomainMarker && !hasAddressMarker) return s;

  // Spoken email symbols & punctuation
  s = s.replace(/\b(under\s*score|underbar|அண்டர்ஸ்கோர்|அண்டர்\s*ஸ்கோர்|अंडरस्कोर)\b/giu, "_");
  s = s.replace(/\b(hyphen|dash|minus|டாஷ்|ஹைபன்|டேஷ்|माइनस)\b/giu, "-");
  // Unambiguous address markers always convert.
  s = s.replace(/(அட்ட\s*ரைட்|அட்\s*ரைட்|அட்|ऐट|\bat\s*the\s*rate\b|\bat\s*rate\b)/giu, "@");
  // A bare "at" only means "@" when a mail domain is also present ("karthik at
  // gmail dot com"). Otherwise it is ordinary speech — "call me at 11".
  if (hasDomainMarker) {
    s = s.replace(/\bat\b/giu, "@");
  }
  s = s.replace(/(டாட்\s*காம்|டட்காம்|डॉट\s*कॉम|\bdot\s*com\b|\bdotcom\b)/giu, ".com");
  s = s.replace(/(டாட்\s*இன்|டட்இன்|डॉट\s*इन|\bdot\s*in\b)/giu, ".in");
  s = s.replace(/(டாட்\s*ஆர்க்|डॉट\s*ऑर्ग|\bdot\s*org\b)/giu, ".org");
  s = s.replace(/(டாட்|டட்|डॉट|\bdot\b|\bperiod\b|\bpoint\b)/giu, ".");
  s = s.replace(/(ஜிமெயில்|ஜிமெல்|जीमेल|jmail|g\s*mail|g\s*m\s*a\s*i\s*l)/giu, "gmail");
  s = s.replace(/(யாகூ|याहू|y\s*a\s*h\s*o\s*o)/giu, "yahoo");
  s = s.replace(/(ஹாட்மெயில்|हॉटमेल|h\s*o\s*t\s*m\s*a\s*i\s*l)/giu, "hotmail");

  // Spoken number words inside email contexts
  s = s.replace(/\bzero\b/gi, "0")
       .replace(/\bone\b/gi, "1")
       .replace(/\btwo\b/gi, "2")
       .replace(/\bthree\b/gi, "3")
       .replace(/\bfour\b/gi, "4")
       .replace(/\bfive\b/gi, "5")
       .replace(/\bsix\b/gi, "6")
       .replace(/\bseven\b/gi, "7")
       .replace(/\beight\b/gi, "8")
       .replace(/\bnine\b/gi, "9");

  // Convert spoken digits inside Tamil/Hindi email contexts
  s = s.replace(/\bஒன்று\b/giu, "1")
       .replace(/\bஇரண்டு\b/giu, "2")
       .replace(/\bமூன்று\b/giu, "3")
       .replace(/\bநான்கு\b/giu, "4")
       .replace(/\bஐந்து\b/giu, "5")
       .replace(/\bஆறு\b/giu, "6")
       .replace(/\bஏழு\b/giu, "7")
       .replace(/\bஎட்டு\b/giu, "8")
       .replace(/\bஒன்பது\b/giu, "9")
       .replace(/\bபூஜ்ஜியம்\b/giu, "0")
       .replace(/\bज़ीरो\b/giu, "0")
       .replace(/\bजीरो\b/giu, "0");

  // NATO / Phonetic alphabet or "X as in X" (e.g. "k as in karthik" -> "k")
  s = s.replace(/\b([a-z0-9])\s+(?:as\s+in|for)\s+[a-z0-9]+\b/gi, "$1");

  // Convert standalone space-separated single digits "1 2 3" -> "123"
  s = s.replace(/(\d)\s+(?=\d)/g, "$1");

  // If text now contains '@', clean up whitespace & coalesce letter-by-letter dictation
  if (s.includes("@")) {
    s = s.replace(/\s*@\s*/g, "@");
    s = s.replace(/\s*\.\s*/g, ".");

    // Remove spaces between dictated single letters / numbers before '@'
    // E.g., "k a r t h i k e y a n 0 1@gmail.com" -> "karthikeyansru01@gmail.com"
    s = s.replace(/((?:^|\s)(?:[a-zA-Z0-9._-]\s+)+[a-zA-Z0-9._-])@/g, (match, prefix) => {
      return prefix.replace(/\s+/g, "") + "@";
    });

    // Join a username dictated as separate words ("user name@" -> "username@")
    // WITHOUT swallowing the carrier phrase that introduces it. The previous
    // unbounded version joined everything before the '@', so
    // "my email is karthik@gmail.com" became "myemailiskarthik@gmail.com" and a
    // whole sentence collapsed into one token (call 5490). Walk back from the '@'
    // and stop at the first carrier word or after MAX_USERNAME_WORDS.
    s = s.replace(/([^\s@]+(?:\s+[^\s@]+)*)@/, (match, prefix: string) => {
      const tokens = prefix.split(/\s+/).filter(Boolean);
      const username: string[] = [];
      for (let i = tokens.length - 1; i >= 0; i--) {
        if (username.length >= MAX_USERNAME_TOKENS) break;
        if (USERNAME_CARRIER_WORDS.has(tokens[i].toLowerCase())) break;
        username.unshift(tokens[i]);
      }
      if (username.length < 2) return match; // single token — nothing to join
      // Join only what actually looks like a username: either letter-by-letter
      // dictation ("k a r t h i k 0 1"), or a name said as a couple of words
      // ("user name"). A longer run of real words is ordinary speech, not an
      // address, and joining it is how a whole sentence once became one token.
      const isDictation = username.every((t) => t.length <= 2);
      if (!isDictation && username.length > MAX_USERNAME_WORDS) return match;
      const carrier = tokens.slice(0, tokens.length - username.length);
      return (carrier.length ? carrier.join(" ") + " " : "") + username.join("") + "@";
    });

    // Remove spaces in domain after '@' (e.g. "@ g m a i l . c o m" -> "@gmail.com")
    s = s.replace(/@([a-zA-Z0-9.\-_]+)/g, (match, domainPart) => {
      return "@" + domainPart.replace(/\s+/g, "");
    });
  }

  return s;
}

/**
 * Normalises common Indian-English phonetic acoustic mishearings from STT.
 * E.g., Indian English "features" (pronounced /fiːtʃərz/) is often recognized as "Futures".
 * Stray STT digits prefixing Indic words (e.g. "4 ஆமாம்") are stripped.
 * Spoken emails ("karthik at gmail dot com") are converted to valid email strings.
 */
export function normalizeSttPhonetics(text: string): string {
  if (!text) return text;
  let s = text;
  // Replace "Futures-ல" / "Futures" when used in product feature contexts
  s = s.replace(/\bFutures([-–—]\S+)?\b/gi, (match) => {
    if (/Futures-ல/i.test(match)) return "Features-ல";
    if (/Futures-ல/i.test(match)) return "features-ல";
    return "features";
  });
  // Strip stray single digit prefixing Indic words (e.g. "4 ஆமாம்" -> "ஆமாம்")
  s = s.replace(/^\d\s+([\u0B80-\u0BFF\u0900-\u097F]+)/u, "$1");
  // Spoken B2B / B2C so the LLM sees the same token the caller meant.
  // No `\b` on Devanagari — JS word boundaries are ASCII-only, and
  // normalizeHinglishClock would otherwise turn "टू" into "2:00".
  s = s.replace(/बी\s*टू\s*बी/gu, "B2B");
  s = s.replace(/बी\s*टू\s*सी/gu, "B2C");
  s = s.replace(/\bb\s*to\s*b\b/gi, "B2B");
  s = s.replace(/\bb\s*to\s*c\b/gi, "B2C");
  s = s.replace(/\bbe\s*to\s*be\b/gi, "B2B");
  // Normalize spoken email tokens
  s = normalizeSpokenEmail(s);
  s = normalizeHinglishClock(s);
  return s;
}

/**
 * Sarvam often emits Devanagari number-words for clock answers
 * (call 20113: "वन थर्टी पी" / "इलेवन थर्टी एट").
 */
export function normalizeHinglishClock(text: string): string {
  if (!text) return text;
  const hours: Record<string, string> = {
    "वन": "1", "टू": "2", "थ्री": "3", "फोर": "4", "फाइव": "5",
    "सिक्स": "6", "सेवन": "7", "नाइन": "9", "टेन": "10",
    "इलेवन": "11", "ट्वेल्व": "12", "ट्वेलव": "12",
  };
  const minutes: Record<string, string> = {
    "थर्टी": "30", "फिफटीन": "15", "फोर्टीफाइव": "45", "फोर्टी फाइव": "45",
  };
  return text.replace(
    /(वन|टू|थ्री|फोर|फाइव|सिक्स|सेवन|नाइन|टेन|इलेवन|ट्वेल्व|ट्वेलव)\s*(थर्टी|फिफटीन|फोर्टी\s*फाइव|फोर्टीफाइव)?\s*(पी\.?एम?\.?|ए\.?एम\.?|पी|एएम)?/giu,
    (full, hourWord: string, minuteWord?: string, mer?: string) => {
      const h = hours[hourWord] ?? hours[hourWord.toLowerCase()];
      if (!h) return full;
      const minuteKey = (minuteWord ?? "").replace(/\s+/g, "");
      const m = minuteKey ? (minutes[minuteWord!] ?? minutes[minuteKey] ?? "00") : "00";
      const merNorm = !mer ? ""
        : /पी|p/i.test(mer) ? " PM"
        : /ए|a/i.test(mer) ? " AM"
        : "";
      return `${h}:${m}${merNorm}`;
    },
  );
}

/** Upper bound on how many queued finals get merged into the next turn. */
export const MAX_COALESCED_TRANSCRIPTS = 2;
/**
 * Drop queued finals older than this relative to the newest entry. Greeting-era
 * leftovers (call 5677: "ஹலோ" processed 15s late ahead of the ambulance ask)
 * otherwise dilute or displace the caller's current intent.
 */
export const PENDING_TRANSCRIPT_MAX_AGE_BEHIND_NEWEST_MS = 8_000;

export interface PendingTranscriptEntry<TCloseReason = string> {
  text: string;
  emittedAt: number;
  closeReason: TCloseReason;
}

/**
 * Collapse STT finals that piled up while a turn (or greeting) was in flight
 * into a single next turn: drop stale/backchannel/duplicate parts, keep the
 * newest intent. Pure helper so call-5677-style backlog can be unit-tested.
 */
export function coalescePendingTranscripts<TCloseReason>(
  queued: ReadonlyArray<PendingTranscriptEntry<TCloseReason>>,
  opts?: {
    maxParts?: number;
    maxAgeBehindNewestMs?: number;
  },
): PendingTranscriptEntry<TCloseReason> | null {
  if (queued.length === 0) return null;
  const last = queued[queued.length - 1];
  const maxParts = opts?.maxParts ?? MAX_COALESCED_TRANSCRIPTS;
  const maxAgeBehindNewestMs =
    opts?.maxAgeBehindNewestMs ?? PENDING_TRANSCRIPT_MAX_AGE_BEHIND_NEWEST_MS;

  const fresh = queued.filter(
    (e) => last.emittedAt - e.emittedAt <= maxAgeBehindNewestMs,
  );
  const candidates = fresh.length > 0 ? fresh : [last];
  if (candidates.length === 1) return candidates[0];

  const parts: string[] = [];
  for (const { text } of candidates) {
    const t = text.trim();
    if (!t) continue;
    // Bare acks add no intent once merged with real speech, and leading with one
    // biases the LLM toward acknowledging instead of answering the question.
    if (isBackchannelOnlyUtterance(t)) continue;
    if (parts.length > 0 && isNearDuplicateUtterance(parts[parts.length - 1], t)) continue;
    parts.push(t);
  }
  // All acks — the newest one still represents the caller's turn.
  if (parts.length === 0) return last;
  // Only the tail carries the caller's current intent; older fragments are context
  // at best and contradicted self-corrections at worst ("no no, ambulance").
  const merged = parts.slice(-maxParts).join(" ");
  return { text: merged, emittedAt: last.emittedAt, closeReason: last.closeReason };
}

