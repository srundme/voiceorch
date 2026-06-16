import type { CallEvent, PrefilterResult, TenantRule } from "./types.js";

interface CallStats {
  durationSec?: number;
  userSpeechSec?: number;
  voicemailDetected?: boolean;
  dtmfSequence?: string;
}

function extractStats(events: CallEvent[]): CallStats {
  const stats: CallStats = {};
  for (const ev of events) {
    if (ev["type"] === "call_stats" || ev["type"] === "duration") {
      if (typeof ev["durationSec"] === "number") stats.durationSec = ev["durationSec"] as number;
      if (typeof ev["userSpeechSec"] === "number") stats.userSpeechSec = ev["userSpeechSec"] as number;
    }
    if (
      (ev["type"] === "amd" && ev["result"] === "machine") ||
      ev["type"] === "voicemail_detected"
    ) {
      stats.voicemailDetected = true;
    }
    if (ev["type"] === "dtmf" && typeof ev["digit"] === "string") {
      stats.dtmfSequence = (stats.dtmfSequence ?? "") + (ev["digit"] as string);
    }
  }
  return stats;
}

/**
 * Platform-level rules applied before LLM and before tenant rules.
 * DNC + NOT_CONNECTED logic must apply to ALL tenants (compliance + connection detection).
 */
const PLATFORM_RULES: Array<{
  label: string;
  test: (s: CallStats) => boolean;
  primary: string;
  sub: string;
  confidence: number;
}> = [
  {
    label: "voicemail",
    test: (s) => !!s.voicemailDetected,
    primary: "NOT_CONNECTED",
    sub: "voicemail",
    confidence: 0.99,
  },
  {
    label: "no_answer",
    test: (s) =>
      (s.durationSec != null && s.durationSec < 6) ||
      (s.userSpeechSec != null && s.userSpeechSec < 1),
    primary: "NOT_CONNECTED",
    sub: "no_answer",
    confidence: 0.95,
  },
  {
    label: "dnc_dtmf9",
    test: (s) => !!s.dtmfSequence?.includes("9"),
    primary: "DNC",
    sub: "opt_out",
    confidence: 0.99,
  },
];

function evaluateTenantRule(
  rule: TenantRule,
  stats: CallStats,
  events: CallEvent[],
): boolean {
  switch (rule.when) {
    case "voicemailDetected":
      return !!stats.voicemailDetected;
    case "durationSec_lt":
      return stats.durationSec != null && stats.durationSec < Number(rule.value ?? 0);
    case "userSpeechSec_lt":
      return stats.userSpeechSec != null && stats.userSpeechSec < Number(rule.value ?? 0);
    case "dtmf_includes":
      return !!stats.dtmfSequence?.includes(String(rule.value ?? ""));
    case "event_type_present":
      return events.some((e) => e["type"] === rule.value);
    default:
      return false;
  }
}

/**
 * Deterministic prefilter — runs before the LLM pass.
 * Returns a result if a rule fires, or null to proceed to LLM.
 */
export function rulePrefilter(
  events: CallEvent[],
  tenantRules: TenantRule[],
): PrefilterResult | null {
  const stats = extractStats(events);

  for (const rule of PLATFORM_RULES) {
    if (rule.test(stats)) {
      return {
        primary: rule.primary,
        sub: rule.sub,
        confidence: rule.confidence,
        rule: rule.label,
      };
    }
  }

  for (const rule of tenantRules) {
    if (evaluateTenantRule(rule, stats, events)) {
      return {
        primary: rule.primary,
        sub: rule.sub,
        confidence: rule.confidence,
        rule: rule.when,
      };
    }
  }

  return null;
}
