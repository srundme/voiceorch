/**
 * Shared helpers for Bolna-style natural barge: heard-only history + interrupt hint.
 * Durable history must never include unspoken mid-sentence text beyond a ms estimate.
 */

/** Join completed played sentences. */
export function joinHeardSentences(sentences: readonly string[]): string {
  return sentences.map((s) => s.trim()).filter(Boolean).join(" ").trim();
}

/**
 * Approximate how much of `fullText` was audible given elapsed playback time.
 * Uses ~70 ms/char (same estimate as barge echo hold). Cuts on a word boundary
 * when possible so history does not invent mid-grapheme Tamil fragments.
 */
export function estimateHeardPrefix(
  fullText: string,
  elapsedMs: number,
  msPerChar = 70,
): string {
  const t = fullText.trim();
  if (!t || elapsedMs <= 0) return "";
  const n = Math.min(t.length, Math.max(0, Math.floor(elapsedMs / msPerChar)));
  if (n <= 0) return "";
  if (n >= t.length) return t;
  const slice = t.slice(0, n);
  const sp = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("\u00a0"));
  if (sp >= 4) return slice.slice(0, sp).trim();
  return slice.trim();
}

export function composeHeardWithMid(completed: string, midPrefix: string): string {
  const a = completed.trim();
  const b = midPrefix.trim();
  if (!b) return a;
  if (!a) return b;
  if (a.endsWith(b) || b.startsWith(a)) return b.length >= a.length ? b : a;
  return `${a} ${b}`.trim();
}

/**
 * Next-turn interruption hint. Prefer concrete heard text (completed + estimated mid).
 */
export function buildInterruptionHint(played: string, wasMidSentence: boolean): string {
  const heard = played.trim();
  if (heard) return heard;
  if (wasMidSentence) return "(interrupted before a full sentence finished)";
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
  requireDeliveryEvidence?: boolean;
}): string {
  if (opts.barged || opts.requireDeliveryEvidence) return opts.heardOnly;
  return opts.heardOnly || opts.fullResponse;
}
