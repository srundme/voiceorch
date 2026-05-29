/**
 * minute-rates.ts — helpers for per-minute reseller billing
 *
 * Rates are cached in memory for 60 s to avoid a DB round-trip on every call.
 * Invalidate the cache by calling invalidateMinuteRatesCache() after an admin update.
 */

import { db, providerMinuteRatesTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

const CACHE_TTL_MS = 60_000;

type RateMap = Map<string, number>; // key: "category:provider_name", value: cents/min

let _cache: RateMap | null = null;
let _cacheAt = 0;

export function invalidateMinuteRatesCache(): void {
  _cache = null;
  _cacheAt = 0;
}

async function getRateMap(): Promise<RateMap> {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) return _cache;
  try {
    const rows = await db.select().from(providerMinuteRatesTable);
    const map: RateMap = new Map();
    for (const r of rows) {
      map.set(`${r.category}:${r.providerName.toLowerCase()}`, r.rateCentsPerMin);
    }
    _cache = map;
    _cacheAt = Date.now();
    return map;
  } catch (err) {
    logger.error({ err }, "Failed to load minute rates from DB");
    return _cache ?? new Map();
  }
}

/** Returns total per-minute charge in cents for an agent's provider stack. */
export async function getAgentRateCentsPerMin(agent: {
  llmProvider?: string | null;
  asrProvider?: string | null;
  ttsProvider?: string | null;
  telephonyProvider?: string | null;
}): Promise<number> {
  const map = await getRateMap();
  const get = (cat: string, prov: string | null | undefined) =>
    map.get(`${cat}:${(prov ?? "").toLowerCase()}`) ?? 0;

  return (
    get("llm",       agent.llmProvider)       +
    get("asr",       agent.asrProvider)       +
    get("tts",       agent.ttsProvider)       +
    get("telephony", agent.telephonyProvider)
  );
}

/** Returns all rates as a flat list (for admin UI and dashboard display). */
export async function getAllMinuteRates() {
  return getRateMap();
}
