/**
 * Software noise-gate arbitration — decides whether the NoiseCanceller runs on
 * a given call, and records WHY.
 *
 * Background: the agent's `noiseCancellationEnabled` toggle used to be silently
 * ignored on VoBiz calls (the VoBiz media handler hardcoded noiseCancel=false
 * because VoBiz denoises at the carrier layer). Since every new agent defaults
 * to telephonyProvider "vobiz", the toggle was a no-op for effectively the whole
 * fleet — flipping it changed nothing, which is exactly what field complaints
 * described. The bypass itself is still correct as a DEFAULT (double-processing
 * already-denoised audio has a documented history of attenuating quiet one-word
 * replies), so this resolver keeps it while adding a per-agent opt-in that
 * support can flip for one customer instead of the fleet-wide env var.
 *
 * The returned `reason` is logged once per call so "was the gate actually on?"
 * is answerable from logs alone — previously it was not.
 */

/** Per-agent escape hatch key inside agents.agent_config. */
export const FORCE_SOFTWARE_NOISE_GATE_KEY = "forceSoftwareNoiseGate";

export type NoiseGateReason =
  /** Agent's Noise Cancellation toggle is off — nothing to run. */
  | "agent-toggle-off"
  /** Browser already ran AEC/NS on webcall audio. */
  | "browser-aec"
  /** VoBiz denoised at the carrier layer; software gate deliberately skipped. */
  | "vobiz-carrier"
  /** Per-agent forceSoftwareNoiseGate=true overrode the VoBiz bypass. */
  | "agent-override"
  /** VOBIZ_FORCE_SOFTWARE_NC=1 overrode the VoBiz bypass fleet-wide. */
  | "env-override"
  /** Carrier does no cleanup (Twilio/Plivo) — software gate is the only denoiser. */
  | "software-gate";

export interface NoiseGateDecision {
  enabled: boolean;
  reason: NoiseGateReason;
}

export interface NoiseGateInput {
  telephonyProvider: string | null | undefined;
  /** agents.noise_cancellation_enabled */
  agentEnabled: boolean;
  /** agent_config.forceSoftwareNoiseGate — only consulted on VoBiz. */
  agentOverride?: unknown;
  /** VOBIZ_FORCE_SOFTWARE_NC === "1" */
  envForceVobiz?: boolean;
}

/**
 * Resolve the software noise gate for one call.
 *
 * Precedence on VoBiz: per-agent override > env override > carrier bypass.
 * The agent toggle is checked first everywhere — an explicitly disabled gate is
 * never re-enabled by an override.
 */
export function resolveSoftwareNoiseGate(input: NoiseGateInput): NoiseGateDecision {
  if (!input.agentEnabled) return { enabled: false, reason: "agent-toggle-off" };

  const provider = (input.telephonyProvider ?? "").toLowerCase();

  if (provider === "webcall") return { enabled: false, reason: "browser-aec" };

  if (provider === "vobiz") {
    if (input.agentOverride === true) return { enabled: true, reason: "agent-override" };
    if (input.envForceVobiz) return { enabled: true, reason: "env-override" };
    return { enabled: false, reason: "vobiz-carrier" };
  }

  return { enabled: true, reason: "software-gate" };
}

/** Reads the fleet-wide VoBiz escape hatch. Kept here so callers don't duplicate the literal. */
export function envForceVobizSoftwareNc(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["VOBIZ_FORCE_SOFTWARE_NC"] === "1";
}
