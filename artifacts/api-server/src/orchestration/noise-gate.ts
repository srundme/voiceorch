/**
 * Software noise-cancellation arbitration — decides whether ai-coustics Quail
 * Voice Focus runs on a given call, and records WHY.
 *
 * Product rule: the agent's Noise Cancellation toggle is the only user-facing
 * control. When on, inbound telephony audio is enhanced with Quail VF (primary
 * speaker isolation) before STT. Browser webcall is bypassed (mic AEC/NS).
 *
 * Legacy forceSoftwareNoiseGate / VOBIZ_FORCE_SOFTWARE_NC still force the same
 * ai-coustics path (kept for config/log compatibility). There is no separate
 * bandpass/RMS "software gate" anymore — that was an identity no-op.
 */

/** Per-agent escape hatch key inside agents.agent_config (legacy, still honored). */
export const FORCE_SOFTWARE_NOISE_GATE_KEY = "forceSoftwareNoiseGate";

export type NoiseGateReason =
  /** Agent's Noise Cancellation toggle is off — nothing to run. */
  | "agent-toggle-off"
  /** Browser already ran AEC/NS on webcall audio. */
  | "browser-aec"
  /** Per-agent forceSoftwareNoiseGate=true (legacy VoBiz opt-in). */
  | "agent-override"
  /** VOBIZ_FORCE_SOFTWARE_NC=1 (legacy fleet-wide VoBiz opt-in). */
  | "env-override"
  /** Toggle on — ai-coustics Quail VF runs for this telephony call. */
  | "software-gate";

export interface NoiseGateDecision {
  enabled: boolean;
  reason: NoiseGateReason;
}

export interface NoiseGateInput {
  telephonyProvider: string | null | undefined;
  /** agents.noise_cancellation_enabled */
  agentEnabled: boolean;
  /** agent_config.forceSoftwareNoiseGate — still forces NC on if set. */
  agentOverride?: unknown;
  /** VOBIZ_FORCE_SOFTWARE_NC === "1" */
  envForceVobiz?: boolean;
}

/**
 * Resolve whether ai-coustics NC runs for one call.
 *
 * The agent toggle is checked first — an explicitly disabled gate is never
 * re-enabled by an override. Webcall is always bypassed. Every other provider
 * (including VoBiz) runs Quail VF when the toggle is on.
 */
export function resolveSoftwareNoiseGate(input: NoiseGateInput): NoiseGateDecision {
  if (!input.agentEnabled) return { enabled: false, reason: "agent-toggle-off" };

  const provider = (input.telephonyProvider ?? "").toLowerCase();

  if (provider === "webcall") return { enabled: false, reason: "browser-aec" };

  if (input.agentOverride === true) return { enabled: true, reason: "agent-override" };
  if (input.envForceVobiz) return { enabled: true, reason: "env-override" };

  return { enabled: true, reason: "software-gate" };
}

/** Reads the fleet-wide VoBiz escape hatch. Kept here so callers don't duplicate the literal. */
export function envForceVobizSoftwareNc(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["VOBIZ_FORCE_SOFTWARE_NC"] === "1";
}
