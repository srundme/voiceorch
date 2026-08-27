/**
 * Mic Sensitivity thresholds — noise gate, VAD floor, and barge-in energy bar.
 *
 * Product decision (Aug 2026, call 5718): Builder does NOT expose this lever.
 * All live calls use **Low** — Normal (bar 1200) let nearby crowd talk cut the
 * agent via energy + word-count barge-in. Soft-reply misses are rarer than
 * bystander false interrupts on telephony.
 *
 * Threshold map kept for documentation / rare agentConfig overrides in DB;
 * `resolveMicSensitivity` always returns `"low"`.
 *
 * Three concrete levers are scaled together:
 *   - gateRatio: NoiseCanceller adaptive noise gate (telephony, when
 *     noiseCancellationEnabled). Frames below noiseFloor × gateRatio are
 *     attenuated (never hard-zeroed).
 *   - vadThreshold: RMS floor for hasSpeechEnergy() (STT buffering, silence
 *     watchdog, barge-in accumulators).
 *   - bargeInEnergyThreshold / webcallAecThreshold: how loud an interrupting
 *     voice must be to cut the agent mid-sentence.
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

/** Legacy form / Normal-tier barge bar — treat as unset so Low applies to all agents. */
export const LEGACY_NORMAL_BARGE_IN_ENERGY = 1200;

const THRESHOLDS: Record<MicSensitivity, MicSensitivityThresholds> = {
  // Barge-in bar raised vs Normal so background voices can't cut the agent off,
  // while the speech-detection floor stays near Normal so soft replies still land
  // (calls 4842/4843: older uniform-1.5x "low" erased real speech).
  low: {
    gateRatio: 5.0,
    vadThreshold: 110,
    bargeInEnergyThreshold: 1800,
    webcallAecThreshold: 600,
  },
  // Historical Normal — kept for reference; not selected by resolveMicSensitivity.
  normal: {
    gateRatio: 4.0,
    vadThreshold: 100,
    bargeInEnergyThreshold: LEGACY_NORMAL_BARGE_IN_ENERGY,
    webcallAecThreshold: 400,
  },
  // Quieter caller speech — not used as the product default.
  high: {
    gateRatio: 2.5,
    vadThreshold: 60,
    bargeInEnergyThreshold: 800,
    webcallAecThreshold: 250,
  },
};

/** Always Low — not exposed in Builder; best default for telephony + noisy rooms. */
export function resolveMicSensitivity(_value?: unknown): MicSensitivity {
  return "low";
}

export function getMicSensitivityThresholds(sensitivity: MicSensitivity): MicSensitivityThresholds {
  return THRESHOLDS[sensitivity];
}

/**
 * Resolve the effective barge-in energy bar. Legacy saved `1200` (Normal form
 * default) is ignored so every agent picks up Low (1800) without a UI re-save.
 * Non-1200 explicit overrides still win.
 */
export function resolveBargeInEnergyThreshold(explicit: unknown): number {
  const lowBar = THRESHOLDS.low.bargeInEnergyThreshold;
  if (typeof explicit !== "number" || !Number.isFinite(explicit)) return lowBar;
  if (explicit === LEGACY_NORMAL_BARGE_IN_ENERGY) return lowBar;
  return explicit;
}

/**
 * RAW (pre-GTCRN) RMS a telephony utterance must reach to count as the person
 * on the phone. Neural isolation keeps ANY speech — including a friend a few
 * metres away — so barge-in / turn-commit must score the mic energy, not the
 * enhanced signal.
 */
export const BACKGROUND_TALKER_MIN_RAW_RMS = 800;

export function isBackgroundTalkerUtterance(
  peakRawRms: number,
  minRms: number = BACKGROUND_TALKER_MIN_RAW_RMS,
): boolean {
  if (!(peakRawRms > 0)) return false;
  return peakRawRms < minRms;
}
