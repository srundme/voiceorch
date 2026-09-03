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
    // Empirical, Aug 2026 (calls 4842/4843): uniform 1.5× "low" erased soft
    // replies. Owner: this Low preset — product default, not a Sarvam spec.
    // Do not "tune" 110 without a paired live-call RMS dump.
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
 *
 * Raised from 800 → 1200 after call 19901: user's friend speaking 1-2m away
 * was captured by STT, causing cross-talk transcripts. GTCRN enhances ALL speech,
 * so this RAW energy threshold must be high enough to distinguish phone-holder
 * from nearby bystanders. 1200 matches the legacy Normal barge-in bar and is
 * more conservative than original 800.
 *
 * LOWERED TO 900 (2026-09-03): Call 20074 showed barge-in never triggering even
 * when user was actively trying to interrupt. 1200 was too high for some mic/
 * environment combinations, blocking legitimate interruptions. 900 is a middle
 * ground: still filters far-field bystanders but allows closer/quieter speakers.
 *
 * Same bar as idle-cancel so hangup-idle cannot disagree with barge-in.
 * Owner: this constant. Call 14315: echo tails below this must not
 * look like a reply. Call 14351: this bar is NOT a transcript-discard
 * authority — listening finals go to processTurn.
 */
export const BACKGROUND_TALKER_MIN_RAW_RMS = 900;

export function isBackgroundTalkerUtterance(
  peakRawRms: number,
  minRms: number = BACKGROUND_TALKER_MIN_RAW_RMS,
): boolean {
  if (!(peakRawRms > 0)) return false;
  return peakRawRms < minRms;
}

/**
 * Pipecat UserIdle analogue: local energy must not cancel idle / stall / silence
 * hangup. Echo tails, ambient keepalive, and far-field noise trip `hasSpeech`
 * (VAD floor ~110 RMS) and previously looked like the caller was still talking
 * (call 14315: 30s dead air, no check-in). Only a near-talker frame outside
 * echo grace counts. Provider VAD speech_start and STT partials are separate.
 */
export function isIdleCancellingMicEnergy(opts: {
  hasSpeech: boolean;
  rawRms: number;
  inEchoGrace: boolean;
  minRawRms?: number;
}): boolean {
  if (!opts.hasSpeech || opts.inEchoGrace) return false;
  return opts.rawRms >= (opts.minRawRms ?? BACKGROUND_TALKER_MIN_RAW_RMS);
}
