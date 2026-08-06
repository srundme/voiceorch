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

export { computeProRataDebitCents, isNonBillableCallStatus } from "./call-billing.js";

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

/** ₹1.00/min discount when the user brings their OWN telephony (Plivo/Twilio/VoBiz creds). */
export const OWN_TELEPHONY_DISCOUNT_CENTS_PER_MIN = 100;

/**
 * Returns the per-minute discount (paise) for calls carried on the user's OWN
 * telephony account: ₹1/min off the flat rate, else 0.
 *
 * "Own telephony" = a providers-table row for the agent's telephonyProvider
 * with complete dialing config (authId/accountSid + fromNumber), i.e. exactly
 * the condition under which the outbound dial path uses THEIR carrier account
 * instead of platform-managed numbers.
 *
 * Note: applies only to the flat-rate path — partner-set client rates are
 * used as-is and are not discounted here.
 */
export async function resolveOwnTelephonyDiscount(
  clerkId: string | null | undefined,
  agent: { telephonyProvider?: string | null },
): Promise<number> {
  const provider = agent.telephonyProvider?.toLowerCase();
  if (!clerkId || !provider) return 0;

  const rows = await db
    .select({ providerName: providersTable.providerName, extraConfig: providersTable.extraConfig })
    .from(providersTable)
    .where(eq(providersTable.userId, clerkId));

  const row = rows.find(r => r.providerName.toLowerCase() === provider);
  if (!row) return 0;

  let cfg: Record<string, string> = {};
  try { cfg = row.extraConfig ? JSON.parse(row.extraConfig) as Record<string, string> : {}; } catch { return 0; }

  // Mirror the outbound dial paths' "own credentials" checks per provider.
  const complete =
    provider === "twilio" ? !!(cfg["accountSid"] && cfg["fromNumber"])
    : (provider === "plivo" || provider === "vobiz") ? !!(cfg["authId"] && cfg["fromNumber"])
    : false;

  return complete ? OWN_TELEPHONY_DISCOUNT_CENTS_PER_MIN : 0;
}

/** Invalidate cache shim — kept for callers that still import it; now a no-op. */
export function invalidateMinuteRatesCache(): void {}
