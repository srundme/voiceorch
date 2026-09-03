/**
 * Flux-free eager / speculative LLM commit heuristics.
 *
 * Bolna uses Deepgram Flux EagerEndOfTurn; on Sarvam we trust provider speech_end
 * (VAD END_SPEECH) as the commit signal. Mid-utterance stable-partial launches are
 * off by default in the pipeline (`EAGER_STABLE_PARTIAL=1` to re-enable) — that path
 * second-guesses STT before the provider decides the turn is done.
 *
 * Speculative LLM is transactional: tokens never reach TTS until the final
 * transcript hash matches the prefill input. Prefix/overlap “close enough”
 * is a miss — truncated thoughts must not be answered.
 */

import { createHash } from "node:crypto";
import { isCompleteEmailUtterance, looksLikeSpokenEmailSpelling } from "./endpointing.js";
import { isBackchannelOnlyUtterance } from "./transcriptQuality.js";
import { envInt } from "./utils.js";

/** Stable-partial timer before launching eager LLM (Path A Bolna-feel: 180ms). */
export const EAGER_PARTIAL_STABLE_MS = envInt("EAGER_PARTIAL_STABLE_MS", 60, 30);

/** Strip case, extra space, and trailing punctuation so "Hello." matches "Hello". */
export function normalizeSpeculativeInput(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.?!…,।]+$/u, "")
    .trim();
}

/** Identity of the text the speculative LLM was launched on. */
export function speculativeInputHash(text: string): string {
  return createHash("sha256").update(normalizeSpeculativeInput(text), "utf8").digest("hex");
}

export type SpeculativeReconcileAction = "commit" | "discard";

export function reconcileSpeculativePrefill(opts: {
  aborted: boolean;
  hasToolCall: boolean;
  langAtLaunch: string;
  langNow: string;
  inputHash: string;
  finalTranscript: string;
  pendingTurnId?: number;
  turnGeneration?: number;
}): { action: SpeculativeReconcileAction; reason: string; finalHash: string } {
  const finalHash = speculativeInputHash(opts.finalTranscript);
  if (opts.aborted) return { action: "discard", reason: "aborted", finalHash };
  if (opts.hasToolCall) return { action: "discard", reason: "speculative_tool_call", finalHash };
  if (
    opts.pendingTurnId !== undefined
    && opts.turnGeneration !== undefined
    && opts.pendingTurnId !== opts.turnGeneration
  ) {
    return { action: "discard", reason: "stale_turn", finalHash };
  }
  if (opts.langAtLaunch !== opts.langNow) {
    return { action: "discard", reason: "language_switched", finalHash };
  }
  if (opts.inputHash !== finalHash) {
    return { action: "discard", reason: "transcript_changed", finalHash };
  }
  return { action: "commit", reason: "hash_match", finalHash };
}

/** True only when the final is the same utterance the prefill was built from. */
export function isSpeculativeHit(partial: string, final: string): boolean {
  return speculativeInputHash(partial) === speculativeInputHash(final);
}

/**
 * Letter-salad / mid-number fragments change on the next STT event
 * (call 20284: "for" → "For what sir?", "Three" → "3 PM").
 */
function looksLikeUnstableCollectionPartial(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isCompleteEmailUtterance(t)) return false;
  if (looksLikeSpokenEmailSpelling(t)) return true;
  const tokens = t.split(/\s+/).filter(Boolean);
  const singleLetters = tokens.filter((tok) => /^[a-z]$/i.test(tok.replace(/[.,]/g, ""))).length;
  if (singleLetters >= 3) return true;
  const digits = (t.match(/\d/g) ?? []).length;
  if (digits >= 4 && digits < 10) return true;
  return false;
}

function hasTerminalPunct(text: string): boolean {
  return /[.?!।]$/u.test(text) && !/[…]|\.{2,}/.test(text);
}

function isCompleteDigitUtterance(text: string): boolean {
  return (text.replace(/\D/g, "").length >= 10);
}

/**
 * Whether a partial is safe to start speculative LLM generation.
 * `speechEnd` still requires a stable clause — unfinished email/number
 * spelling and 1–2 word scraps change on the provider final.
 */
export function isEagerCommitReady(partial: string, opts?: { speechEnd?: boolean }): boolean {
  const t = partial.trim();
  if (!t || isBackchannelOnlyUtterance(t)) return false;
  if (looksLikeUnstableCollectionPartial(t)) return false;
  if (isCompleteEmailUtterance(t) || isCompleteDigitUtterance(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (hasTerminalPunct(t) && (opts?.speechEnd ? t.length >= 3 : true)) return true;
  if (words.length >= 3) return true;
  if (opts?.speechEnd) return false;
  // Two-word Indic content replies ("எங்க எங்க") — Path A Bolna-feel
  if (words.length >= 2 && t.length >= 8) return true;
  return false;
}
