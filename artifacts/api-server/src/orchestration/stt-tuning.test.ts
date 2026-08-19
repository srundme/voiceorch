import { afterEach, describe, expect, it } from "vitest";
import { resolveSttTuning, type SttTuningInputs } from "./stt-tuning.js";

/** Platform defaults: vadSilenceMs 350, asrEndpointingSilenceMs 250, stall backstop 10s. */
const DEFAULTS: SttTuningInputs = {
  vadSilenceMs: 350,
  endpointingSilenceMs: 250,
  stallBackstopMs: 10_000,
};

const ENV_KEYS = [
  "STT_LOST_TURN_BACKSTOP_MS",
  "STT_RECOVERY_MIN_SILENCE_MS",
  "STT_RECOVERY_MAX_AUDIO_MS",
  "STT_RECOVERY_MIN_AUDIO_MS",
  "STT_RECOVERY_DEDUP_MS",
  "STT_SUBSTANTIVE_SPEECH_MS",
];

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("resolveSttTuning — derivation from agent settings", () => {
  it("waits twice the agent's longest turn-closing silence before recovering", () => {
    const t = resolveSttTuning(DEFAULTS);
    expect(t.recoveryMinSilenceMs).toBe(700); // 2 × max(350, 250)
  });

  it("scales the recovery gate when the agent is tuned to be more patient", () => {
    const patient = resolveSttTuning({ ...DEFAULTS, vadSilenceMs: 900 });
    expect(patient.recoveryMinSilenceMs).toBe(1800);
    expect(patient.recoveryMinSilenceMs).toBeGreaterThan(
      resolveSttTuning(DEFAULTS).recoveryMinSilenceMs,
    );
  });

  it("follows the endpointing silence when that is the larger of the two", () => {
    const t = resolveSttTuning({ ...DEFAULTS, vadSilenceMs: 100, endpointingSilenceMs: 600 });
    expect(t.recoveryMinSilenceMs).toBe(1200);
  });

  it("keeps a floor so an aggressively tuned agent still proves the caller stopped", () => {
    const snappy = resolveSttTuning({ ...DEFAULTS, vadSilenceMs: 50, endpointingSilenceMs: 50 });
    expect(snappy.recoveryMinSilenceMs).toBe(400);
  });

  it("bounds the recovery buffer by the stall reprompt window", () => {
    expect(resolveSttTuning(DEFAULTS).recoveryMaxAudioMs).toBe(20_000);
    expect(resolveSttTuning({ ...DEFAULTS, stallBackstopMs: 6_000 }).recoveryMaxAudioMs).toBe(12_000);
  });

  it("keeps the duplicate window wider than the backstop that triggers a recovery", () => {
    const t = resolveSttTuning(DEFAULTS);
    expect(t.recoveryDedupMs).toBeGreaterThan(t.lostTurnBackstopMs);
  });

  it("never lets recovery fire before the caller could plausibly have finished", () => {
    const t = resolveSttTuning(DEFAULTS);
    expect(t.recoveryMinSilenceMs).toBeGreaterThan(DEFAULTS.vadSilenceMs);
    expect(t.recoveryMinAudioMs).toBeLessThan(t.recoveryMaxAudioMs);
  });
});

describe("resolveSttTuning — environment overrides", () => {
  it("lets an operator retune every value without a redeploy", () => {
    process.env.STT_LOST_TURN_BACKSTOP_MS = "4000";
    process.env.STT_RECOVERY_MIN_SILENCE_MS = "900";
    process.env.STT_RECOVERY_MAX_AUDIO_MS = "15000";
    process.env.STT_RECOVERY_MIN_AUDIO_MS = "250";
    process.env.STT_RECOVERY_DEDUP_MS = "7000";
    process.env.STT_SUBSTANTIVE_SPEECH_MS = "500";

    expect(resolveSttTuning(DEFAULTS)).toEqual({
      lostTurnBackstopMs: 4000,
      recoveryMinSilenceMs: 900,
      recoveryMaxAudioMs: 15000,
      recoveryMinAudioMs: 250,
      recoveryDedupMs: 7000,
      substantiveSpeechMs: 500,
    });
  });

  it("re-derives the dedup window from an overridden backstop", () => {
    process.env.STT_LOST_TURN_BACKSTOP_MS = "3000";
    expect(resolveSttTuning(DEFAULTS).recoveryDedupMs).toBe(6000);
  });

  it("ignores a non-numeric override rather than producing NaN", () => {
    process.env.STT_RECOVERY_MIN_SILENCE_MS = "not-a-number";
    expect(resolveSttTuning(DEFAULTS).recoveryMinSilenceMs).toBe(700);
  });
});

describe("optionalUnitInterval", () => {
  it("clamps 0–1 and rejects non-numbers", async () => {
    const { optionalUnitInterval } = await import("./stt-tuning.js");
    expect(optionalUnitInterval(0.3)).toBe(0.3);
    expect(optionalUnitInterval(1.5)).toBe(1);
    expect(optionalUnitInterval(-0.2)).toBe(0);
    expect(optionalUnitInterval(undefined)).toBeNull();
    expect(optionalUnitInterval("0.3")).toBeNull();
  });
});
