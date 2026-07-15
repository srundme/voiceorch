/**
 * minute-rates.ts — flat per-minute billing rates (INR / paise)
 *
 * Flat rate for all agents: ₹5.00 / min (500 paise).
 * BYOP and managed share the same rate (plan: flat ₹5/min).
 *
 * Detection of byop vs managed is still used for analytics / UI labels but
 * does not change the charge amount.
 *
 * Rates are exposed via GET /billing/rates and used in both the telephony
 * call-end path (calls.ts) and the webcall path (webcall.ts).
 */

import { db, providersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { RATE_PAISE_PER_MIN } from "../lib/money-inr.js";

export const MANAGED_RATE_CENTS_PER_MIN = RATE_PAISE_PER_MIN; // ₹5.00 / min
export const BYOP_RATE_CENTS_PER_MIN    = RATE_PAISE_PER_MIN; // ₹5.00 / min (flat)

/**
 * Returns the flat per-minute charge in paise for a given billing mode.
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
