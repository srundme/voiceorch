import type { CallEvent, DispositionConfig, DispositionResult } from "./types.js";

interface CallStats {
  durationSec?: number;
  consentGiven?: boolean;
}

function extractStats(events: CallEvent[]): CallStats {
  const stats: CallStats = {};
  for (const ev of events) {
    if (ev["type"] === "duration" || ev["type"] === "call_stats") {
      if (typeof ev["durationSec"] === "number") stats.durationSec = ev["durationSec"] as number;
    }
    if (ev["type"] === "consent" && ev["given"] === true) {
      stats.consentGiven = true;
    }
  }
  return stats;
}

function buildFlags(primary: string, _sub: string, stats: CallStats): string[] {
  const flags: string[] = [];
  if (primary === "SALE_CLOSED" && stats.durationSec != null && stats.durationSec < 60) {
    flags.push("sale_but_short_call");
  }
  if (primary === "CALLBACK" && !stats.consentGiven) {
    flags.push("callback_without_consent");
  }
  return flags;
}

/**
 * Validates and reconciles the LLM output against the agent's taxonomy.
 * - Snaps invalid sub to first valid sub and caps confidence at 0.5
 * - Sets flags for anomalies (SALE_CLOSED on short call, CALLBACK without consent)
 * - needsReview = confidence < 0.7 OR any flag
 */
export function validate(
  cfg: DispositionConfig,
  out: Record<string, unknown>,
  events: CallEvent[],
): DispositionResult {
  const primary = String(out["primary"] ?? "");
  let sub = String(out["sub"] ?? "");
  let confidence =
    typeof out["confidence"] === "number" ? Math.max(0, Math.min(1, out["confidence"])) : 0;
  const evidence = String(out["evidence"] ?? "");
  const summary = String(out["summary"] ?? "");

  const validSubs: string[] = cfg.taxonomy[primary] ?? [];
  if (!validSubs.includes(sub)) {
    sub = validSubs[0] ?? sub;
    confidence = Math.min(confidence, 0.5);
  }

  const stats = extractStats(events);
  const flags = buildFlags(primary, sub, stats);

  const domainFields: Record<string, unknown> = {};
  for (const field of cfg.domainFields) {
    if (out[field.key] !== undefined) domainFields[field.key] = out[field.key];
  }

  return {
    primary,
    sub,
    confidence,
    evidence,
    summary,
    flags,
    needsReview: confidence < 0.7 || flags.length > 0,
    ...(Object.keys(domainFields).length > 0 ? { domainFields } : {}),
  };
}
