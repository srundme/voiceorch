/**
 * Software noise-gate arbitration — decides whether the NoiseCanceller runs on
 * a given call, and records WHY.
 *
 * Product rule: the agent's Noise Cancellation toggle is the only user-facing
 * control, and it applies to every LLM stack (classic Sarvam/OpenAI/Groq and
 * Gemini Live alike). When the toggle is on, the audio worker runs GTCRN
 * neural voice isolation first (VOICE_ISOLATION=0 falls back to this energy
 * gate). Telephony audio (VoBiz, Twilio, Plivo) is processed when the toggle
 * is on. Greeting/echo barge-in is blocked on the transcript side (partials
 * that match carrier echo), not by pausing isolation. Browser webcall is the
 * one exception: the mic already ran AEC/NS and stacking our isolator/gate
 * erases quiet speech, so webcall stays off.
 *
 * Historically VoBiz calls skipped the software gate because the carrier also
 * denoises. That made the toggle a no-op for almost every agent. The extra
 * forceSoftwareNoiseGate / VOBIZ_FORCE_SOFTWARE_NC knobs are kept as aliases
 * that still force the gate on, but they are no longer required.
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
  /** Toggle on — software gate runs for this telephony call. */
  | "software-gate";

export interface NoiseGateDecision {
  enabled: boolean;
  reason: NoiseGateReason;
}

export interface NoiseGateInput {
  telephonyProvider: string | null | undefined;
  /** agents.noise_cancellation_enabled */
  agentEnabled: boolean;
  /** agent_config.forceSoftwareNoiseGate — still forces the gate on if set. */
  agentOverride?: unknown;
  /** VOBIZ_FORCE_SOFTWARE_NC === "1" */
  envForceVobiz?: boolean;
}

/**
 * Resolve the software noise gate for one call.
 *
 * The agent toggle is checked first — an explicitly disabled gate is never
 * re-enabled by an override. Webcall is always bypassed. Every other provider
 * (including VoBiz) runs the gate when the toggle is on, for every LLM.
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
