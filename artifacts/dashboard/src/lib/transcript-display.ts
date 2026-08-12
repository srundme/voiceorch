/**
 * Strip LLM prosody markup that must never appear in the call-detail transcript UI.
 * Matches pipeline stripMarkupTags — emotion / break tags are TTS controls, not speech.
 */
export function stripTranscriptMarkup(text: string): string {
  if (!text) return text;
  return text
    .replace(/<\/?emotion\b[^>]*>/gi, "")
    .replace(/<break\b[^>]*\/?>/gi, "")
    .replace(/[^\S\r\n]{2,}/g, " ")
    .trim();
}
