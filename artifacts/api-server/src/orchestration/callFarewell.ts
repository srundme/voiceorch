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
  // Tamil
  "பாய்",
  "பாய்க்க",
  "போய்",
  "போயிட்டு",
  "நன்றி",
  "சரியாய்",
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
 * True when the end of a full-call transcript contains a farewell
 * (suppress network-drop auto-callback).
 */
export function transcriptHasFarewellEnding(transcript: string): boolean {
  if (!transcript) return false;
  const tail = transcript.slice(-300).toLowerCase();
  return FAREWELL_PHRASES.some((phrase) => tail.includes(phrase.toLowerCase()));
}
