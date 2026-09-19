/**
 * Phase 3 production canary.
 *
 * Global defaults stay off. Listed agent IDs run as:
 *   KB_RETRIEVAL_GATE=on
 *   KB_QUERY_BUILDER=on
 *
 * Promotion to every agent is still the explicit global flags, not this list.
 *
 *   KB_PHASE3_CANARY_AGENT_IDS=1234,1231
 */

export function parseKbPhase3CanaryAgentIds(
  env: NodeJS.ProcessEnv = process.env,
): Set<number> {
  const raw = (env["KB_PHASE3_CANARY_AGENT_IDS"] ?? "").trim();
  if (!raw) return new Set();
  const ids = new Set<number>();
  for (const part of raw.split(/[,\s]+/)) {
    if (!part) continue;
    const n = Number(part);
    if (Number.isInteger(n) && n > 0) ids.add(n);
  }
  return ids;
}

export function isKbPhase3CanaryAgent(
  agentId: number | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (agentId == null || !Number.isInteger(agentId) || agentId <= 0) return false;
  return parseKbPhase3CanaryAgentIds(env).has(agentId);
}

export function kbQueryChanged(rawQuery: string, searchQuery: string): boolean {
  return rawQuery !== searchQuery;
}

export type Phase3RetrievalBucket =
  | "gate_skipped"
  | "raw_retained"
  | "query_augmented"
  | "query_fallback";

export function phase3RetrievalBucket(opts: {
  gateDecision: string | null | undefined;
  queryChanged: boolean;
  fallbackUsed: boolean;
}): Phase3RetrievalBucket {
  if (opts.gateDecision === "skip") return "gate_skipped";
  if (opts.fallbackUsed) return "query_fallback";
  if (opts.queryChanged) return "query_augmented";
  return "raw_retained";
}
