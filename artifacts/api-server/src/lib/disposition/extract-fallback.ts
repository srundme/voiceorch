import { canonicalDispositionBucket, normalizeDispositionToken } from "./canonical.js";
import type { DispositionConfig } from "./types.js";

const AVOID_BUCKETS = new Set([
  "no pickup",
  "voicemail",
  "busy",
  "do not call",
  "wrong number",
]);

function scoreFallbackPrimary(key: string): number {
  const token = normalizeDispositionToken(key);
  const bucket = canonicalDispositionBucket(key, "");
  if (AVOID_BUCKETS.has(bucket)) return -1;
  if (/\bsale closed\b|\bclosed won\b|\bpayment\b/.test(bucket)) return -1;
  if (/other|review|connected|completed|spoke|general|unknown/.test(bucket) || token === "connected") {
    return 5;
  }
  // Container keys like "outcome" — the sub carries meaning; keep for review.
  if (
    token === "outcome"
    || token === "outcomes"
    || token === "disposition"
    || token === "result"
    || token === "status"
  ) {
    return 4;
  }
  return 1;
}

function scoreFallbackSub(sub: string): number {
  const bucket = canonicalDispositionBucket(sub, "");
  if (AVOID_BUCKETS.has(bucket)) return -1;
  if (/review|other|connected|completed|spoke|unknown|follow/.test(bucket)) return 5;
  if (/\bpayment\b|\bissued\b|\bsale\b/.test(bucket)) return -1;
  return 1;
}

/**
 * Placeholder classification when the extract LLM is missing or fails.
 *
 * Never stamp NOT_CONNECTED/no_answer on a call that already has a transcript —
 * that overwrites a connected conversation as "no answer" in review + Sheets.
 */
export function extractUnavailableFallback(
  cfg: DispositionConfig,
  transcript: string | null | undefined,
  reason: "no_llm" | "llm_error",
): Record<string, unknown> {
  const hasTranscript = Boolean(transcript?.trim());
  if (!hasTranscript) {
    return {
      primary: "NOT_CONNECTED",
      sub: "no_answer",
      confidence: 0,
      evidence: "",
      summary: reason === "no_llm" ? "No transcript or LLM unavailable" : "LLM extraction failed",
    };
  }

  const taxonomyKeys = Object.keys(cfg.taxonomy);
  const ranked = taxonomyKeys
    .map((k) => ({ k, score: scoreFallbackPrimary(k) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score);
  const connectedKey = ranked[0]?.k ?? taxonomyKeys[0] ?? "CONNECTED";
  const subs = cfg.taxonomy[connectedKey] ?? [];
  const rankedSubs = subs
    .map((s) => ({ s, score: scoreFallbackSub(s) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score);
  const reviewSub = rankedSubs[0]?.s ?? subs[0] ?? "needs_review";

  return {
    primary: connectedKey,
    sub: reviewSub,
    confidence: 0,
    evidence: "",
    summary:
      reason === "no_llm"
        ? "LLM unavailable — call had a transcript"
        : "LLM extraction failed — call had a transcript",
  };
}
