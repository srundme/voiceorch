/**
 * Effective-dated cost & customer pricing lookups (Admin V2).
 * Historical rows are never overwritten — pick the rate active at `at`.
 */
import {
  db,
  customerPricingRatesTable,
  providerCostRatesTable,
  platformSettingsTable,
} from "@workspace/db";
import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { RATE_PAISE_PER_MIN } from "../lib/money-inr.js";

const customerCache = new Map<string, { paise: number; at: number }>();
const providerCache = new Map<string, { rate: number; currency: string; unit: string; at: number }>();
const CACHE_TTL_MS = 60_000;

export function invalidateCostPricingCaches(): void {
  customerCache.clear();
  providerCache.clear();
}

async function usdToInrRate(): Promise<number> {
  try {
    const [row] = await db
      .select()
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "vobiz_usd_to_inr_rate"))
      .limit(1);
    const n = Number(row?.value ?? 96);
    return Number.isFinite(n) && n > 0 ? n : 96;
  } catch {
    return 96;
  }
}

/**
 * Customer voice list price in paise/min at `at` (default now).
 * Falls back to product flat rate when no effective-dated row exists.
 */
export async function resolveCustomerRateCentsPerMin(
  at: Date = new Date(),
  opts?: { plan?: string; segment?: string },
): Promise<number> {
  const plan = (opts?.plan ?? "standard").toLowerCase();
  const segment = (opts?.segment ?? "default").toLowerCase();
  const cacheKey = `${plan}:${segment}:${at.toISOString().slice(0, 13)}`;
  const cached = customerCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.paise;

  try {
    const [row] = await db
      .select()
      .from(customerPricingRatesTable)
      .where(
        and(
          eq(customerPricingRatesTable.plan, plan),
          eq(customerPricingRatesTable.segment, segment),
          eq(customerPricingRatesTable.service, "voice"),
          eq(customerPricingRatesTable.billingUnit, "per_minute"),
          lte(customerPricingRatesTable.effectiveFrom, at),
          or(isNull(customerPricingRatesTable.effectiveTo), sql`${customerPricingRatesTable.effectiveTo} >= ${at}`),
        ),
      )
      .orderBy(desc(customerPricingRatesTable.effectiveFrom))
      .limit(1);

    if (row) {
      const currency = (row.currency ?? "INR").toUpperCase();
      const rate = Number(row.rate);
      let paise = RATE_PAISE_PER_MIN;
      if (Number.isFinite(rate) && rate > 0) {
        if (currency === "INR") paise = Math.round(rate * 100);
        else if (currency === "USD") {
          const fx = await usdToInrRate();
          paise = Math.round(rate * fx * 100);
        }
      }
      customerCache.set(cacheKey, { paise, at: Date.now() });
      return paise;
    }
  } catch {
    // table may be missing pre-migration
  }

  customerCache.set(cacheKey, { paise: RATE_PAISE_PER_MIN, at: Date.now() });
  return RATE_PAISE_PER_MIN;
}

export type ProviderCostQuote = {
  /** Estimated cost in USD micros (same unit as usage_events.estimated_cost_micros). */
  costMicros: number;
  source: "provider_cost_rates" | "none";
};

/**
 * Quote provider COGS from effective-dated provider_cost_rates.
 * Supports per_minute / per_second; returns none when no row matches.
 */
export async function quoteProviderCostMicros(opts: {
  provider: string;
  service: string;
  at?: Date;
  audioSeconds?: number;
  characters?: number;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<ProviderCostQuote> {
  const at = opts.at ?? new Date();
  const provider = opts.provider.toLowerCase();
  const service = opts.service.toLowerCase();
  // Map llm/stt/tts to table services
  const serviceKey = service === "asr" ? "stt" : service;

  const cacheKey = `${provider}:${serviceKey}`;
  let rateInfo = providerCache.get(cacheKey);
  if (!rateInfo || Date.now() - rateInfo.at >= CACHE_TTL_MS) {
    try {
      const [row] = await db
        .select()
        .from(providerCostRatesTable)
        .where(
          and(
            eq(providerCostRatesTable.provider, provider),
            eq(providerCostRatesTable.service, serviceKey),
            lte(providerCostRatesTable.effectiveFrom, at),
            or(isNull(providerCostRatesTable.effectiveTo), sql`${providerCostRatesTable.effectiveTo} >= ${at}`),
          ),
        )
        .orderBy(desc(providerCostRatesTable.effectiveFrom))
        .limit(1);

      if (!row) {
        return { costMicros: 0, source: "none" };
      }
      rateInfo = {
        rate: Number(row.rate),
        currency: (row.currency ?? "USD").toUpperCase(),
        unit: row.billingUnit,
        at: Date.now(),
      };
      providerCache.set(cacheKey, rateInfo);
    } catch {
      return { costMicros: 0, source: "none" };
    }
  }

  if (!rateInfo || !Number.isFinite(rateInfo.rate) || rateInfo.rate <= 0) {
    return { costMicros: 0, source: "none" };
  }

  let amountInCurrency = 0;
  const audio = opts.audioSeconds ?? 0;
  const chars = opts.characters ?? 0;
  const inTok = opts.inputTokens ?? 0;
  const outTok = opts.outputTokens ?? 0;

  switch (rateInfo.unit) {
    case "per_minute":
      amountInCurrency = rateInfo.rate * (audio / 60);
      break;
    case "per_second":
      amountInCurrency = rateInfo.rate * audio;
      break;
    case "per_character":
      amountInCurrency = rateInfo.rate * chars;
      break;
    case "per_token":
      amountInCurrency = rateInfo.rate * (inTok + outTok);
      break;
    case "per_1m_tokens":
      amountInCurrency = (rateInfo.rate * (inTok + outTok)) / 1_000_000;
      break;
    default:
      return { costMicros: 0, source: "none" };
  }

  if (amountInCurrency <= 0) return { costMicros: 0, source: "none" };

  let costMicros = 0;
  if (rateInfo.currency === "USD") {
    costMicros = Math.round(amountInCurrency * 1_000_000);
  } else if (rateInfo.currency === "INR") {
    const fx = await usdToInrRate();
    costMicros = Math.round((amountInCurrency / fx) * 1_000_000);
  } else {
    return { costMicros: 0, source: "none" };
  }

  return { costMicros, source: "provider_cost_rates" };
}
