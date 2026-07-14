/**
 * Flux-free eager / speculative LLM commit heuristics.
 *
 * Bolna uses Deepgram Flux EagerEndOfTurn; on Sarvam we use VAD speech_end plus
 * stable partial text as the commit signal instead.
 */

import { envInt } from "./utils.js";

/** Stable-partial timer before launching eager LLM (Path A Bolna-feel: 180ms). */
export const EAGER_PARTIAL_STABLE_MS = envInt("EAGER_PARTIAL_STABLE_MS", 180, 50);

/** Trailing-char tolerance when final extends a speculative partial. */
const SPECULATIVE_TRAIL_CHARS = 24;

const SHORT_ACK_RE =
  /^(yes|no|ok|okay|sure|சரி|சரிங்க|ஆம்|ஆமா|हाँ|हां|haan|okay\s+sir|ok\s+sir)$/iu;

/** If the speculative partial is close enough to the final transcript, reuse it. */
export function isSpeculativeHit(partial: string, final: string): boolean {
  const p = partial.trim().toLowerCase();
  const f = final.trim().toLowerCase();
  if (p === f) return true;
  if (f.startsWith(p) && f.length - p.length <= SPECULATIVE_TRAIL_CHARS) return true;
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
  if (words.length >= 3) return true;
  // Indic / Hinglish short acks (incl. "okay sir", "ஆமா", "சரிங்க")
  if (SHORT_ACK_RE.test(t)) return true;
  // Two-word Indic replies ("எங்க எங்க", "Okay sir") — Path A Bolna-feel
  if (words.length >= 2 && t.length >= 8) return true;
  if (opts?.speechEnd) {
    if (SHORT_ACK_RE.test(t)) return true;
    if (words.length >= 1 && t.length >= 4) return true;
    if (t.length >= 8) return true;
  }
  return false;
}
