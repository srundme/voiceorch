/**
 * Per-agent "Mic Sensitivity" — a single simple lever that maps to several
 * underlying energy thresholds involved in rejecting quiet, nearby background
 * talkers while still letting the caller's genuine soft replies ("yes",
 * "okay", digits) through.
 *
 * Three concrete levers are scaled together:
 *   - gateRatio: NoiseCanceller's adaptive noise gate (telephony only, when
 *     noiseCancellationEnabled). Frames below noiseFloor × gateRatio are
 *     attenuated (never hard-zeroed). A higher ratio makes it harder for a
 *     secondary talker who is quieter than the primary caller to pass.
 *   - vadThreshold: the RMS floor used by hasSpeechEnergy() to decide whether
 *     a frame counts as "speech" at all (feeds STT buffering, the silence
 *     watchdog, and the streaming/batch barge-in accumulators). This is the
 *     ONLY lever that applies on webcall, where noise cancellation is off
 *     because the browser already ran AEC/noise suppression.
 *   - bargeInEnergyThreshold / webcallAecThreshold: how loud an interrupting
 *     voice must be to cut off the agent mid-sentence.
 *
 * "low" = least sensitive (most aggressive filtering) — best when the caller
 * is in a noisy room with other people talking nearby.
 * "high" = most sensitive — best in a quiet 1:1 environment where even soft
 * replies must never be missed.
 * "normal" reproduces the original hardcoded constants exactly, so existing
 * agents (no micSensitivity set) are unaffected.
 */
export type MicSensitivity = "low" | "normal" | "high";

export interface MicSensitivityThresholds {
  /** NoiseCanceller adaptive gate ratio (telephony noise-cancellation path only). */
  gateRatio: number;
  /** RMS floor for hasSpeechEnergy() — gates STT feed / silence watchdog / barge-in accumulation. */
  vadThreshold: number;
  /** Default bargeInEnergyThreshold when the agent has not set an explicit override. */
  bargeInEnergyThreshold: number;
  /** Default webcall AEC barge-in cap when the agent has not set an explicit bargeInEnergyThreshold override. */
  webcallAecThreshold: number;
}

const THRESHOLDS: Record<MicSensitivity, MicSensitivityThresholds> = {
  // Barge-in bar raised 1.5x (background voices can't cut the agent off) but the
  // speech-detection floor stays near normal so the caller's own soft replies are
  // still captured. Calls 4842/4843 showed the old uniform-1.5x "low" blocked the
  // caller's real speech (15s "silence") while normal let a background "hmm" barge.
  low: {
    gateRatio: 5.0,
    vadThreshold: 110,
    bargeInEnergyThreshold: 1800,
    webcallAecThreshold: 600,
  },
  // Matches the original hardcoded constants exactly.
  normal: {
    gateRatio: 4.0,
    vadThreshold: 100,
    bargeInEnergyThreshold: 1200,
    webcallAecThreshold: 400,
  },
  // ~0.6-0.65x the normal floors — catches quieter caller speech at the cost
  // of letting more background noise through.
  high: {
    gateRatio: 2.5,
    vadThreshold: 60,
    bargeInEnergyThreshold: 800,
    webcallAecThreshold: 250,
  },
};

export function resolveMicSensitivity(value: unknown): MicSensitivity {
  return value === "low" || value === "high" ? value : "normal";
}

export function getMicSensitivityThresholds(sensitivity: MicSensitivity): MicSensitivityThresholds {
  return THRESHOLDS[sensitivity];
}
