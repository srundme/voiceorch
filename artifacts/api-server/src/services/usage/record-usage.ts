import { db, usageEventsTable, providerPricingTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { evaluateAlertsAfterEvent } from "./alert-engine.js";

export type UsageService = "stt" | "tts" | "llm";

export interface RecordUsageInput {
  service: UsageService;
  provider: string;
  model?: string | null;
  userId?: string | null;
  workspaceId?: string | null;
  callId?: number | null;
  inputTokens?: number;
  outputTokens?: number;
  audioSeconds?: number;
  characters?: number;
  latencyMs?: number | null;
  success?: boolean;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
}

const pricingCache = new Map<string, {
  inputTokenPricePerMillionMicros: number;
  outputTokenPricePerMillionMicros: number;
  audioSecondPriceMicros: number;
  characterPriceMicros: number;
  cachedAt: number;
}>();
const PRICING_TTL_MS = 60_000;

async function getPricing(service: string, provider: string, model: string) {
  const key = `${service}:${provider}:${model}`;
  const cached = pricingCache.get(key);
  if (cached && Date.now() - cached.cachedAt < PRICING_TTL_MS) return cached;

  // Try exact match first, then fall back to provider "default" model.
  const [exactRow] = await db
    .select()
    .from(providerPricingTable)
    .where(
      and(
        eq(providerPricingTable.service, service),
        eq(providerPricingTable.provider, provider),
        eq(providerPricingTable.model, model),
      ),
    );

  let row = exactRow;
  if (!row && model !== "default") {
    const [defaultRow] = await db
      .select()
      .from(providerPricingTable)
      .where(
        and(
          eq(providerPricingTable.service, service),
          eq(providerPricingTable.provider, provider),
          eq(providerPricingTable.model, "default"),
        ),
      );
    row = defaultRow;
  }

  const entry = {
    inputTokenPricePerMillionMicros: Number(row?.inputTokenPricePerMillionMicros ?? 0),
    outputTokenPricePerMillionMicros: Number(row?.outputTokenPricePerMillionMicros ?? 0),
    audioSecondPriceMicros: Number(row?.audioSecondPriceMicros ?? 0),
    characterPriceMicros: Number(row?.characterPriceMicros ?? 0),
    cachedAt: Date.now(),
  };
  pricingCache.set(key, entry);
  return entry;
}

export function invalidatePricingCache(): void {
  pricingCache.clear();
}

export function computeCostMicros(
  pricing: {
    inputTokenPricePerMillionMicros: number;
    outputTokenPricePerMillionMicros: number;
    audioSecondPriceMicros: number;
    characterPriceMicros: number;
  },
  evt: {
    inputTokens?: number;
    outputTokens?: number;
    audioSeconds?: number;
    characters?: number;
  },
): number {
  const inTok = evt.inputTokens ?? 0;
  const outTok = evt.outputTokens ?? 0;
  const aud = evt.audioSeconds ?? 0;
  const chars = evt.characters ?? 0;
  return Math.round(
    (inTok * pricing.inputTokenPricePerMillionMicros) / 1_000_000 +
      (outTok * pricing.outputTokenPricePerMillionMicros) / 1_000_000 +
      aud * pricing.audioSecondPriceMicros +
      chars * pricing.characterPriceMicros,
  );
}

export async function recordUsage(input: RecordUsageInput): Promise<void> {
  try {
    const model = input.model ?? "default";
    const pricing = await getPricing(input.service, input.provider, model);
    const estimatedCostMicros = computeCostMicros(pricing, input);

    const [row] = await db
      .insert(usageEventsTable)
      .values({
        service: input.service,
        provider: input.provider,
        model,
        userId: input.userId ?? null,
        workspaceId: input.workspaceId ?? null,
        callId: input.callId ?? null,
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        audioSeconds: input.audioSeconds ?? 0,
        characters: input.characters ?? 0,
        latencyMs: input.latencyMs ?? null,
        estimatedCostMicros,
        success: input.success ?? true,
        errorMessage: input.errorMessage ?? null,
        metadata: input.metadata ?? null,
      })
      .returning({ id: usageEventsTable.id });

    // Evaluate alerts asynchronously
    if (row) {
      void evaluateAlertsAfterEvent({
        service: input.service,
        provider: input.provider,
        model,
        success: input.success ?? true,
        estimatedCostMicros,
      }).catch((err) => {
        logger.warn({ err }, "alert evaluation after usage event failed");
      });
    }
  } catch (err) {
    const e = err as { code?: string; message?: string };
    logger.error(
      {
        err,
        code: e?.code,
        message: e?.message,
        service: input.service,
        provider: input.provider,
        model: input.model ?? "default",
      },
      "recordUsage failed",
    );
  }
}
