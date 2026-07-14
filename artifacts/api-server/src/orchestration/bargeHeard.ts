/**
 * Shared helpers for Bolna-style natural barge: heard-only history + interrupt hint.
 * Durable history must never include unspoken mid-sentence text.
 */

/** Join completed played sentences (the only durable "heard" source). */
export function joinHeardSentences(sentences: readonly string[]): string {
  return sentences.map((s) => s.trim()).filter(Boolean).join(" ").trim();
}

/**
 * Build next-turn interruption hint from completed play only.
 * `wasMidSentence` notes a cut without pasting the unspoken sentence body.
 */
export function buildInterruptionHint(played: string, wasMidSentence: boolean): string {
  const heard = played.trim();
  if (heard && wasMidSentence) {
    return `${heard} [cut mid-sentence]`;
  }
  if (heard) return heard;
  return "(interrupted before a full sentence finished)";
}

/**
 * What to store as the assistant utterance after playback.
 * On barge: only heard. Otherwise: prefer played sentences over full LLM text.
 */
export function resolveSpokenForHistory(opts: {
  barged: boolean;
  heardOnly: string;
  fullResponse: string;
}): string {
  if (opts.barged) return opts.heardOnly;
  return opts.heardOnly || opts.fullResponse;
}
