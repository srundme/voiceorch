/**
 * Flux-free eager / speculative LLM commit heuristics.
 *
 * Bolna uses Deepgram Flux EagerEndOfTurn; on Sarvam we use VAD speech_end plus
 * stable partial text as the commit signal instead.
 */

import { envInt } from "./utils.js";

export const EAGER_PARTIAL_STABLE_MS = envInt("EAGER_PARTIAL_STABLE_MS", 400, 50);

/** If the speculative partial is close enough to the final transcript, reuse it. */
export function isSpeculativeHit(partial: string, final: string): boolean {
  const p = partial.trim().toLowerCase();
  const f = final.trim().toLowerCase();
  if (p === f) return true;
  if (f.startsWith(p) && f.length - p.length <= 15) return true;
  const pWords = p.split(/\s+/).filter(Boolean);
  if (pWords.length === 0) return false;
  const fWordSet = new Set(f.split(/\s+/).filter(Boolean));
  const overlap = pWords.filter((w) => fWordSet.has(w)).length;
  return overlap / pWords.length >= 0.75;
}

/**
 * Whether a partial is safe to start speculative LLM generation.
 * `speechEnd` relaxes gates when Sarvam VAD has already fired END_SPEECH.
 */
export function isEagerCommitReady(partial: string, opts?: { speechEnd?: boolean }): boolean {
  const t = partial.trim();
  if (t.length < 3) return false;
  if (/[.?!।]$/.test(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 4) return true;
  if (words.length === 1 && /^(yes|no|ok|okay|sure|சரி|ஆம்|हाँ|हां)$/iu.test(words[0]!)) return true;
  if (opts?.speechEnd) {
    if (words.length >= 2) return true;
    if (t.length >= 10) return true;
  }
  return false;
}
