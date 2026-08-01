/**
 * Flux-free eager / speculative LLM commit heuristics.
 *
 * Bolna uses Deepgram Flux EagerEndOfTurn; on Sarvam we use VAD speech_end plus
 * stable partial text as the commit signal instead.
 */

import { isBackchannelOnlyUtterance } from "./transcriptQuality.js";
import { envInt } from "./utils.js";

/** Stable-partial timer before launching eager LLM (Path A Bolna-feel: 180ms). */
export const EAGER_PARTIAL_STABLE_MS = envInt("EAGER_PARTIAL_STABLE_MS", 120, 50);

/** Trailing-char tolerance when final extends a speculative partial. */
const SPECULATIVE_TRAIL_CHARS = 24;

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
  // speech_end IS the stabilization signal — Sarvam's VAD already declared the
  // caller done. Launch on any real text. Pure backchannels stay excluded: their
  // finals are held by the pipeline fragment-coalesce anyway, so a speculative
  // launch on "okay"/"சரி" is always wasted work.
  if (opts?.speechEnd) {
    return t.length >= 2 && !isBackchannelOnlyUtterance(t);
  }
  if (t.length < 3) return false;
  // Pure backchannels ("சரி", "okay") often precede a real question — wait for final/coalesce.
  if (isBackchannelOnlyUtterance(t)) return false;
  if (/[.?!।]$/.test(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 3) return true;
  // Two-word Indic content replies ("எங்க எங்க") — Path A Bolna-feel
  if (words.length >= 2 && t.length >= 8) return true;
  return false;
}
