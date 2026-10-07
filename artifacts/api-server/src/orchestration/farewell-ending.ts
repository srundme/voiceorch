/**
 * Read-only goodbye checks on what was already said. These never end a call —
 * deciding when to hang up belongs to the LLM's end_call tool.
 *
 * Used by:
 *   • pipeline.ts — skip a configured End greeting when the agent already said bye
 *   • session.ts  — suppress network-drop auto-redial after a clean goodbye
 *
 * Tamil/Indic callers often say "பாய்" / "போய்" rather than Latin "bye". Missing
 * those variants caused successful closes to auto-redial as a false
 * "network drop" (calls 4848 → 4849).
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
 * True when the end of a full-call transcript contains a farewell
 * (suppress network-drop auto-callback).
 */
export function transcriptHasFarewellEnding(transcript: string): boolean {
  if (!transcript) return false;
  const tail = transcript.slice(-300).toLowerCase();
  return FAREWELL_PHRASES.some((phrase) => tail.includes(phrase.toLowerCase()));
}

/** Strict: the agent's last sentence itself is a goodbye ("…, take care. Bye!"). */
export function agentLineEndsWithGoodbye(line: string): boolean {
  const sentences = (line ?? "").trim().split(/(?<=[.!?।])\s+/).filter(Boolean);
  const last = sentences[sentences.length - 1]?.toLowerCase() ?? "";
  if (!last) return false;
  return /\b(bye|goodbye|good bye|take care|have a (good|great|nice|wonderful) (day|evening|night|weekend))\b/.test(last)
    || /(பாய்|போயிட்டு வாங்க|अलविदा|फिर मिलते)/.test(last);
}
