/**
 * Flux-free eager / speculative LLM commit heuristics.
 *
 * Bolna uses Deepgram Flux EagerEndOfTurn; on Sarvam we use VAD speech_end plus
 * stable partial text as the commit signal instead.
 *
 * ── PATCHED (2026-08-02) ────────────────────────────────────────────────────
 * Changes:
 *   1. EAGER_PARTIAL_STABLE_MS default lowered 180→60ms (env override still wins).
 *      Sarvam partials are stable when they arrive — 180ms was too conservative
 *      and meant the speculative LLM almost never fired before the final.
 *   2. speechEnd path in isEagerCommitReady relaxed: launch on ANY non-empty,
 *      non-backchannel text. speech_end is the strongest possible "caller done"
 *      signal — the old 2-char / word-count gates blocked short real replies
 *      like "yes" (3 chars) and "சரி" (3 chars) from the fast path.
 */

import { isBackchannelOnlyUtterance } from "./transcriptQuality.js";
import { envInt } from "./utils.js";

/** Stable-partial timer before launching eager LLM (Path A Bolna-feel: 60ms). */
export const EAGER_PARTIAL_STABLE_MS = envInt("EAGER_PARTIAL_STABLE_MS", 60, 20);

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
 *
 * PATCHED: when speechEnd is true, launch on any non-empty non-backchannel text
 * (was: needed 1+ word AND 4+ chars, or 8+ chars). Sarvam's speech_end is the
 * definitive "caller stopped" signal — no need to second-guess with length gates.
 */
export function isEagerCommitReady(partial: string, opts?: { speechEnd?: boolean }): boolean {
  const t = partial.trim();
  if (t.length < 2) return false;
  // Pure backchannels ("சரி", "okay") often precede a real question — wait for final/coalesce.
  if (isBackchannelOnlyUtterance(t)) return false;

  // ── speech_end fast path (PATCHED) ──────────────────────────────────────────
  // Sarvam VAD already declared the caller done. Launch speculative LLM on any
  // real text — the old gates (4+ chars, 1+ word with 4+ chars, 8+ chars) blocked
  // short but complete replies like "yes", "no", "சரி", "ஆம்", "हाँ".
  if (opts?.speechEnd) {
    return true;
  }

  // ── Normal (no speech_end yet) path — unchanged ────────────────────────────
  if (/[.?!।]$/.test(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 3) return true;
  // Two-word Indic content replies ("எங்க எங்க") — Path A Bolna-feel
  if (words.length >= 2 && t.length >= 8) return true;
  return false;
}
