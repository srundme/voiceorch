import type { CallEvent, DispositionConfig, DispositionResult } from "./types.js";
import { clampDispositionText, extractBarePhone, isPhoneLikeDispositionField } from "./normalize-fields.js";
import { canonicalDispositionBucket } from "./canonical.js";

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
  const rawPrimary = String(out["primary"] ?? "").trim();
  let sub = String(out["sub"] ?? "").trim();
  let confidence =
    typeof out["confidence"] === "number" ? Math.max(0, Math.min(1, out["confidence"])) : 0;
  const evidence = String(out["evidence"] ?? "");
  const summary = String(out["summary"] ?? "");

  // Normalize the primary back to the configured taxonomy key. Matching is done
  // on the canonical token so "NOT_CONNECTED", "not connected" and "Not-Connected"
  // all resolve to the same configured category.
  const taxonomyKeys = Object.keys(cfg.taxonomy);
  const canonicalPrimary = canonicalDispositionBucket(rawPrimary, "");
  let matchedKey = taxonomyKeys.find(
    (k) => canonicalDispositionBucket(k, "") === canonicalPrimary,
  );

  // Providers routinely put the real outcome in `sub` and something invented in
  // `primary` (the sub enum is flat across categories, so nothing stops them).
  // Rather than persist a category the agent never configured, adopt the
  // category that actually owns this sub.
  if (!matchedKey && sub) {
    const canonicalSub = canonicalDispositionBucket(sub, "");
    matchedKey = taxonomyKeys.find((k) =>
      (cfg.taxonomy[k] ?? []).some((s) => canonicalDispositionBucket(s, "") === canonicalSub),
    );
    if (matchedKey) confidence = Math.min(confidence, 0.6);
  }

  const primary = matchedKey ?? rawPrimary;

  // Match the sub against the chosen category's allowed values, normalizing to
  // the configured spelling. If it's out of list, snap to the first valid sub
  // (keeps a non-empty sub) and cap confidence.
  const validSubs: string[] = cfg.taxonomy[primary] ?? [];
  const canonicalSub = canonicalDispositionBucket(sub, "");
  const matchedSub = validSubs.find(
    (s) => canonicalDispositionBucket(s, "") === canonicalSub,
  );
  if (matchedSub) {
    sub = matchedSub;
  } else if (!validSubs.includes(sub)) {
    sub = validSubs[0] ?? sub;
    confidence = Math.min(confidence, 0.5);
  }

  const stats = extractStats(events);
  const flags = buildFlags(primary, sub, stats);

  const domainFields: Record<string, unknown> = {};
  for (const field of cfg.domainFields) {
    if (out[field.key] === undefined) continue;
    const raw = out[field.key];
    if (isPhoneLikeDispositionField(field.key, field.label, field.type)) {
      domainFields[field.key] = extractBarePhone(raw);
    } else if (field.type === "string") {
      domainFields[field.key] = clampDispositionText(raw);
    } else {
      domainFields[field.key] = raw;
    }
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
