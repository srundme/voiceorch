/**
 * minute-rates.ts — flat per-minute billing rates
 *
 * Two tiers:
 *   managed — $0.050 / min  (5 cents)   agent runs on platform-provided keys (default for all users)
 *   byop    — $0.035 / min  (3.5 cents) agent runs on the user's own provider API keys
 *
 * Detection rule (applied at billing time, not stored on the agent row):
 *   If the user has their own provider keys (in the providers table) for ANY of the
 *   agent's configured ASR / LLM / TTS providers → BYOP rate.
 *   Otherwise → managed rate.
 *
 * Rates are exposed via GET /billing/rates and used in both the telephony
 * call-end path (calls.ts) and the webcall path (webcall.ts).
 */

import { db, providersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const MANAGED_RATE_CENTS_PER_MIN = 5;    // $0.050 / min
export const BYOP_RATE_CENTS_PER_MIN    = 3.5;  // $0.035 / min

/**
 * Returns the flat per-minute charge in cents for a given billing mode.
 */
export function getFlatRateCentsPerMin(mode: "managed" | "byop" | string | null | undefined): number {
  return mode === "byop" ? BYOP_RATE_CENTS_PER_MIN : MANAGED_RATE_CENTS_PER_MIN;
}

/**
 * Dynamically resolves whether an agent should be billed at the managed or BYOP rate.
 *
 * Rule: if the calling user has their own provider keys for ANY of the agent's
 * configured providers (ASR / LLM / TTS) → BYOP (user brings own keys).
 * If they have no provider keys configured → managed (SnapServe's keys are in use).
 *
 * This is evaluated at billing time so it's always accurate regardless of the
 * agentMode column value (which defaults to "managed" for new agents but may be
 * stale for older rows).
 */
export async function resolveAgentBillingMode(
  clerkId: string | null | undefined,
  agent: {
    asrProvider?: string | null;
    llmProvider?: string | null;
    ttsProvider?: string | null;
  },
): Promise<"managed" | "byop"> {
  if (!clerkId) return "managed";

  const agentProviders = [agent.asrProvider, agent.llmProvider, agent.ttsProvider]
    .filter((p): p is string => !!p)
    .map(p => p.toLowerCase());

  if (agentProviders.length === 0) return "managed";

  const userProviders = await db
    .select({ providerName: providersTable.providerName })
    .from(providersTable)
    .where(eq(providersTable.userId, clerkId));

  const userProviderSet = new Set(
    userProviders.map(p => p.providerName.toLowerCase()),
  );

  const isActuallyByop = agentProviders.some(p => userProviderSet.has(p));
  return isActuallyByop ? "byop" : "managed";
}

/** Invalidate cache shim — kept for callers that still import it; now a no-op. */
export function invalidateMinuteRatesCache(): void {}
