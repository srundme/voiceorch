/** Marker between pre-handoff and post-handoff turns in a saved call transcript. */
export const HANDOFF_TRANSCRIPT_MARKER = "--- handoff ---";

const ACCUM_CAP_CHARS = 50_000;

/**
 * Join earlier squad-agent transcripts with the current pipeline transcript.
 * Empty sides are dropped. Used at handoff (accumulate) and at call end (persist).
 */
export function mergeHandoffTranscript(prior: string | null | undefined, current: string | null | undefined): string {
  const parts = [prior, current]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
  return parts.join(`\n${HANDOFF_TRANSCRIPT_MARKER}\n`);
}

/** Keep the newest end of a long multi-handoff transcript. */
export function capHandoffTranscript(text: string, maxChars = ACCUM_CAP_CHARS): string {
  if (text.length <= maxChars) return text;
  return text.slice(-maxChars);
}
