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
import { isRealEnglishUtterance } from "./language-filler-guard.js";
import { isBackchannelOnlyUtterance, isNearDuplicateUtterance } from "./transcriptQuality.js";
import { envInt } from "./utils.js";

/** Stable-partial timer before launching eager LLM (Path A Bolna-feel: 180ms). */
export const EAGER_PARTIAL_STABLE_MS = envInt("EAGER_PARTIAL_STABLE_MS", 60, 30);

/** Strip case, extra space, and punctuation so "Hello, sir." matches "Hello Sir". */
export function normalizeSpeculativeInput(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.?!…,،।'"‘’“”]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * STT often finalizes by completing the last word ("continu" → "continue").
 * That is the same utterance — not a new thought. Extra tokens still miss
 * (call 21189: "day after tom" → "tomorrow" is too open to commit).
 */
export function isLastTokenCompletion(partial: string, final: string): boolean {
  const p = normalizeSpeculativeInput(partial).split(" ").filter(Boolean);
  const f = normalizeSpeculativeInput(final).split(" ").filter(Boolean);
  if (p.length < 2 || p.length !== f.length) return false;
  if (p.slice(0, -1).join(" ") !== f.slice(0, -1).join(" ")) return false;
  const pLast = p[p.length - 1]!;
  const fLast = f[f.length - 1]!;
  if (pLast.length < 3) return false;
  if (fLast.length - pLast.length > 3) return false;
  return fLast.startsWith(pLast) && fLast !== pLast;
}

/**
 * STT often prepends a leading ack on the final ("Yes, can you…") after eager
 * launched on the question alone (call 21264). Same utterance — extra content
 * after the partial still misses.
 */
export function isLeadingAckPrefix(partial: string, final: string): boolean {
  const p = normalizeSpeculativeInput(partial);
  const f = normalizeSpeculativeInput(final);
  if (!p || !f || p === f || !f.endsWith(p)) return false;
  const prefix = f.slice(0, f.length - p.length).trim();
  if (!prefix) return false;
  return prefix.split(" ").every((tok) => isBackchannelOnlyUtterance(tok));
}

/**
 * Caller is still finishing the utterance we already started answering
 * (call 21450: "So, a good doctor should" → "…should be considered").
 * Barging that continuation cuts TTS and often leaves no STT final.
 */
export function isSameUtteranceContinuation(prev: string, next: string): boolean {
  const p = normalizeSpeculativeInput(prev);
  const n = normalizeSpeculativeInput(next);
  if (!p || !n) return false;
  if (p === n) return true;
  return n.startsWith(`${p} `) || p.startsWith(`${n} `);
}

/**
 * Queued STT while we are already answering this utterance — Bolna
 * `is_duplicate_user` plus a prefix continuation (call 25218: "I'm okay
 * with it" → "I'm okay with both the shifts"). Cutting TTS here is a
 * false barge; the duplicate is then discarded and the agent goes mute.
 */
export function isQueuedDuplicateUserTurn(lastUserTurn: string, incoming: string): boolean {
  if (!lastUserTurn.trim() || !incoming.trim()) return false;
  return isSameUtteranceContinuation(lastUserTurn, incoming)
    || isNearDuplicateUtterance(incoming, lastUserTurn);
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
  partialSnapshot?: string;
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
  if (opts.inputHash === finalHash) {
    return { action: "commit", reason: "hash_match", finalHash };
  }
  if (opts.partialSnapshot && isLastTokenCompletion(opts.partialSnapshot, opts.finalTranscript)) {
    return { action: "commit", reason: "last_token_completion", finalHash };
  }
  if (opts.partialSnapshot && isLeadingAckPrefix(opts.partialSnapshot, opts.finalTranscript)) {
    return { action: "commit", reason: "leading_ack_prefix", finalHash };
  }
  return { action: "discard", reason: "transcript_changed", finalHash };
}

/** True only when the final is the same utterance the prefill was built from. */
export function isSpeculativeHit(partial: string, final: string): boolean {
  return (
    speculativeInputHash(partial) === speculativeInputHash(final)
    || isLastTokenCompletion(partial, final)
    || isLeadingAckPrefix(partial, final)
  );
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
 * Sarvam English-decoder leftovers on Tamil audio (call 21546):
 * "I mean, even, even, even, even" / "Next question. Next question".
 */
export function looksLikeRepeatedSttHallucination(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/[^a-z\u0b80-\u0bff\u0900-\u097f\s]/gu, "")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  if (words.length < 3) return false;
  const counts = new Map<string, number>();
  for (const w of words) {
    const n = (counts.get(w) ?? 0) + 1;
    if (n >= 3) return true;
    counts.set(w, n);
  }
  return false;
}

function isLatinOnly(text: string): boolean {
  return !/[^\u0000-\u00ff]/.test(text) && /[a-zA-Z]/.test(text);
}

/**
 * Whether a partial is safe to start speculative LLM generation.
 * `speechEnd` still requires a stable clause — unfinished email/number
 * spelling and 1–2 word scraps change on the provider final.
 */
export function isEagerCommitReady(partial: string, opts?: {
  speechEnd?: boolean;
  /** Tamil/Hindi agent: do not prefill on English-decoder scraps. */
  indicPinned?: boolean;
}): boolean {
  const t = partial.trim();
  if (!t || isBackchannelOnlyUtterance(t)) return false;
  if (looksLikeUnstableCollectionPartial(t)) return false;
  if (looksLikeRepeatedSttHallucination(t)) return false;
  if (
    opts?.indicPinned
    && isLatinOnly(t)
    && !isRealEnglishUtterance(t)
  ) {
    return false;
  }
  if (isCompleteEmailUtterance(t) || isCompleteDigitUtterance(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (hasTerminalPunct(t) && (opts?.speechEnd ? t.length >= 3 : true)) return true;
  if (words.length >= 3) return true;
  if (opts?.speechEnd) return false;
  // Two-word Indic content replies ("எங்க எங்க") — Path A Bolna-feel
  if (words.length >= 2 && t.length >= 8) return true;
  return false;
}
