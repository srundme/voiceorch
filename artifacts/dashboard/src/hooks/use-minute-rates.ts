import { useQuery } from "@tanstack/react-query";
import { customFetch, useListProviders, getListProvidersQueryKey } from "@workspace/api-client-react";

export interface FlatRate {
  mode: string;           // "managed" | "byop"
  rateCentsPerMin: number;
  label: string | null;
}

async function fetchMinuteRates(): Promise<FlatRate[]> {
  try {
    const res = await customFetch<FlatRate[]>("/api/billing/rates");
    return res ?? [];
  } catch {
    return [];
  }
}

/** Returns a lookup map: "managed" | "byop" → rateCentsPerMin (with hardcoded fallbacks). */
export function useMinuteRatesMap(): Map<string, number> {
  const { data } = useQuery<FlatRate[]>({
    queryKey: ["billing-rates"],
    queryFn: fetchMinuteRates,
    staleTime: 60_000,
  });
  const map = new Map<string, number>();
  map.set("managed", 500); // ₹5.00 / min (paise)
  map.set("byop",    500); // ₹5.00 / min (paise) — flat
  for (const r of data ?? []) {
    if (r.mode) map.set(r.mode.toLowerCase(), r.rateCentsPerMin);
  }
  return map;
}

/**
 * Returns the set of provider names the current user has configured.
 * Used to dynamically resolve billing mode on the client, mirroring
 * resolveAgentBillingMode() on the backend.
 */
export function useUserProviderNames(): Set<string> {
  const { data: providers } = useListProviders({ query: { queryKey: getListProvidersQueryKey(), staleTime: 60_000 } });
  return new Set((providers ?? []).map(p => p.providerName.toLowerCase()));
}

/**
 * Returns the per-minute cost in cents for an agent.
 *
 * When userProviderNames is supplied (preferred), billing mode is resolved
 * dynamically — mirrors the backend resolveAgentBillingMode() logic:
 *   - user has a key for ANY of the agent's ASR/LLM/TTS providers → BYOP rate
 *   - otherwise → managed rate
 * This is always accurate regardless of the stale agentMode column in the DB.
 *
 * Falls back to the stored agentMode column when userProviderNames is omitted.
 */
export function computeAgentRateCents(
  rateMap: Map<string, number>,
  agent: {
    agentMode?: string | null;
    asrProvider?: string | null;
    llmProvider?: string | null;
    ttsProvider?: string | null;
    [key: string]: unknown;
  },
  userProviderNames?: Set<string>,
): number {
  if (!(rateMap instanceof Map)) return 0;

  let mode: string;
  if (userProviderNames !== undefined) {
    const agentProviders = [agent.asrProvider, agent.llmProvider, agent.ttsProvider]
      .filter((p): p is string => !!p)
      .map(p => p.toLowerCase());
    const isActuallyByop = agentProviders.some(p => userProviderNames.has(p));
    mode = isActuallyByop ? "byop" : "managed";
  } else {
    mode = agent.agentMode === "managed" ? "managed" : "byop";
  }

  return rateMap.get(mode) ?? 500;
}
