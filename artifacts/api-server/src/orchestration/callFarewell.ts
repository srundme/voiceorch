/**
 * Shared farewell detection for live calls.
 *
 * Used by:
 *   • pipeline.ts — short-circuit to end_call when the caller says bye
 *   • session.ts  — suppress network-drop auto-redial after a clean goodbye
 *
 * Tamil/Indic callers often say "பாய்" / "போய்" rather than Latin "bye". Missing
 * those variants caused successful Galaxy-style closes to stay open (no end_call)
 * and then auto-redial as a false "network drop" (calls 4848 → 4849).
 */

/** Latin + Indic farewell tokens (substring match on a normalised tail). */
const FAREWELL_PHRASES = [
  // English / romanised
  "bye",
  "goodbye",
  "good bye",
  "take care",
  "talk soon",
  "see you",
  "have a good",
  "thank you bye",
  "thanks bye",
  "ok bye",
  "okay bye",
  "alright bye",
  "ciao",
  "tata",
  "ta-ta",
  "nothing else",
  "no more help",
  // Tamil
  "பாய்",
  "பாய்க்க",
  "போய்",
  "போயிட்டு",
  "நன்றி",
  "சரியாய்",
  "வேற எதுவும்",
  "வேற ஒன்னும்",
  "உடம்பப் பார்த்து",
  "உடம்ப பார்த்து",
  "நல்ல நாள்",
  // Hindi / Hinglish romanised + Devanagari
  "alvida",
  "phir milte",
  "अलविदा",
  "फिर मिलते",
  "नमस्ते",
] as const;

/**
 * True when a short caller utterance is a pure farewell (auto end_call).
 * Rejects long turns that merely mention thanks mid-conversation.
 */
export function isCallerFarewellUtterance(transcript: string): boolean {
  const t = transcript
    .toLowerCase()
    .replace(/[^\u0B80-\u0BFF\u0900-\u097Fa-z\s]/g, "")
    .trim();
  if (t.length === 0 || t.length > 60) return false;

  // Pure bye/goodbye — Latin
  if (/\b(bye|byee|bye\s*bye|goodbye|good\s*bye|cya|tata|tatata)\b/.test(t)) return true;

  // Tamil bye variants (பாய் / போய்) — often with மேடம்/சார்
  if (/பாய்|போய்/.test(t)) return true;

  // "thank you" / "thanks" — only when the ENTIRE utterance (after stripping
  // address terms) IS the thank-you itself.
  const stripped = t
    .replace(
      /\b(sir|madam|maam|please|ok|okay|so|much|very|lot|again|alright|great|nice|fine|மேடம்|சார்|மாம்)\b/gu,
      "",
    )
    .replace(/மேடம்|சார்|மாம்/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(thank\s*you|thanks|thankyou|thank\s*u)$/.test(stripped)) return true;

  // Tamil / Hindi thanks-only
  if (/^(நன்றி|धन्यवाद)$/u.test(stripped)) return true;
  if (/நன்றி/.test(t) && stripped.replace(/நன்றி/gu, "").trim().length === 0) return true;

  return false;
}

/**
 * Caller is wrapping up — not always a one-word "bye". Call 14315: after
 * "வேற ஏதாச்சும் help வேணுமா?" they said they need no more help / will talk
 * tomorrow; the LLM asked the same question again and they hung up in silence.
 */
export function isCallerClosingUtterance(transcript: string): boolean {
  if (isCallerFarewellUtterance(transcript)) return true;
  const t = transcript
    .toLowerCase()
    .replace(/[^\u0B80-\u0BFF\u0900-\u097Fa-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length === 0 || t.length > 120) return false;
  if (/வேற\s*(எதுவும்|ஒன்னும்|ஏதும்)/u.test(t) && /இல்ல|help|வேணா|வேண்டா/u.test(t)) return true;
  if (/வேற\s*(எதுவும்|ஒன்னும்|ஏதும்).{0,24}(பண்ண|help)/u.test(t)) return true;
  if (/\b(nothing else|no more help|thats all|that's all|that is all|im done|i'm done)\b/.test(t)) return true;
  if (/\bno\s+(more\s+)?(thanks|thank you|help)\b/.test(t)) return true;
  // Call 26692: romanised Tamil "that's all" / thanks-while-closing was not
  // a farewell, so the closer ("வேற ஏதாச்சும் help வேணுமா?") replayed 4×.
  if (/\b(avlo|avvalavu|avvalavutha|athu than|athuthaan|athuthan)\b/.test(t)) return true;
  if (/அவ்ளோ|அவ்வளவு|அவ்ளோதான்|அவ்வளவுதான்/.test(t)) return true;
  if (/\billa\b/.test(t) && /\bthank\s*you\b/.test(t)) return true;
  if (/இல்ல/.test(t) && /நன்றி/.test(t)) return true;
  return false;
}

/**
 * True when the end of a full-call transcript contains a farewell
 * (suppress network-drop auto-callback).
 */
export function transcriptHasFarewellEnding(transcript: string): boolean {
  if (!transcript) return false;
  const tail = transcript.slice(-300).toLowerCase();
  return FAREWELL_PHRASES.some((phrase) => tail.includes(phrase.toLowerCase()));
}
