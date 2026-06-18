import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export interface MinuteRate {
  category: string;       // "llm" | "asr" | "tts" | "telephony"
  providerName: string;
  rateCentsPerMin: number;
  label: string | null;
}

async function fetchMinuteRates(): Promise<MinuteRate[]> {
  try {
    const res = await customFetch<MinuteRate[]>("/api/billing/rates");
    return res ?? [];
  } catch {
    return [];
  }
}

/** Returns a lookup map: "category:providerName" → rateCentsPerMin */
export function useMinuteRatesMap(): Map<string, number> {
  const { data } = useQuery<MinuteRate[]>({
    queryKey: ["billing-rates"],
    queryFn: fetchMinuteRates,
    staleTime: 60_000,
  });
  const map = new Map<string, number>();
  for (const r of data ?? []) {
    map.set(`${r.category}:${r.providerName.toLowerCase()}`, r.rateCentsPerMin);
  }
  return map;
}

/** Computes total per-minute cost in paise for an agent's provider stack. */
export function computeAgentRateCents(
  rateMap: Map<string, number>,
  agent: {
    llmProvider?: string | null;
    asrProvider?: string | null;
    ttsProvider?: string | null;
    telephonyProvider?: string | null;
  },
): number {
  if (!(rateMap instanceof Map)) return 0;
  const get = (cat: string, prov: string | null | undefined) =>
    rateMap.get(`${cat}:${(prov ?? "").toLowerCase()}`) ?? 0;
  return (
    get("llm",       agent.llmProvider)       +
    get("asr",       agent.asrProvider)       +
    get("tts",       agent.ttsProvider)       +
    get("telephony", agent.telephonyProvider)
  );
}
