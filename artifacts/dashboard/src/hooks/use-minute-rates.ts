import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

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
  map.set("managed", 5);    // $0.05 / min default
  map.set("byop",    3.5);  // $0.035 / min default
  for (const r of data ?? []) {
    if (r.mode) map.set(r.mode.toLowerCase(), r.rateCentsPerMin);
  }
  return map;
}

/**
 * Returns the per-minute cost in cents for an agent based on its mode.
 * Accepts the full agent object — only agentMode is used for the lookup.
 */
export function computeAgentRateCents(
  rateMap: Map<string, number>,
  agent: { agentMode?: string | null; [key: string]: unknown },
): number {
  if (!(rateMap instanceof Map)) return 0;
  const mode = agent.agentMode === "managed" ? "managed" : "byop";
  return rateMap.get(mode) ?? (mode === "managed" ? 5 : 3.5);
}
