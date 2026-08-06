import type { CallEvent, DispositionConfig, DispositionResult } from "./types.js";
import { clampDispositionText, extractBarePhone, isPhoneLikeDispositionField } from "./normalize-fields.js";

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

  // Normalize the primary back to the configured taxonomy key, tolerating
  // casing/whitespace differences (e.g. "Intent" → "intent"). Falls back to the
  // raw value when no taxonomy key matches (genuinely-invalid classification).
  const matchedKey = Object.keys(cfg.taxonomy).find(
    (k) => k.toLowerCase() === rawPrimary.toLowerCase(),
  );
  const primary = matchedKey ?? rawPrimary;

  // Match the sub against the chosen category's allowed values case-insensitively,
  // normalizing to the configured value. If it's out of list, snap to the first
  // valid sub (keeps a non-empty sub) and cap confidence.
  const validSubs: string[] = cfg.taxonomy[primary] ?? [];
  const matchedSub = validSubs.find((s) => s.toLowerCase() === sub.toLowerCase());
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
