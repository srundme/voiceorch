/**
 * Bolna-style Call Engine floors. Shared by api-server create/migrate paths
 * and the optional scripts/ migrate-call-engine-config dry-run tool.
 */

export const CALL_ENGINE_SAFE = {
  bargeInEnergyThreshold: 1200,
  asrEndpointingSilenceMs: 250,
  incrementalDelay: 350,
  wordsForInterruption: 3,
  stopSpeakingVoiceFloor: 0.2,
  minEnergy: 800,
  minEndpointingMs: 100,
} as const;

export function voiceSecondsFromInterruptWords(numWords: number): number {
  const n = Math.max(1, Math.min(6, Math.round(numWords || 3)));
  return Math.max(CALL_ENGINE_SAFE.stopSpeakingVoiceFloor, Number((n * 0.15).toFixed(2)));
}

export function clampInterruptWords(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return CALL_ENGINE_SAFE.wordsForInterruption;
  return Math.max(1, Math.min(6, Math.round(value)));
}

export type NormalizeCallEngineResult = {
  changed: boolean;
  config: Record<string, unknown>;
  reasons: string[];
};

/**
 * Rewrite unsafe Call Engine JSON keys that caused call-2620-class false barge-ins
 * (energy 200, voice 0.06s, words off, endpoint 50). Idempotent.
 */
export function normalizeCallEngineAgentConfig(
  raw: Record<string, unknown> | null | undefined,
): NormalizeCallEngineResult {
  const cfg: Record<string, unknown> = { ...(raw ?? {}) };
  const reasons: string[] = [];

  const energy = cfg["bargeInEnergyThreshold"];
  if (typeof energy === "number" && Number.isFinite(energy) && energy < CALL_ENGINE_SAFE.minEnergy) {
    reasons.push(`bargeInEnergyThreshold ${energy}→${CALL_ENGINE_SAFE.bargeInEnergyThreshold}`);
    cfg["bargeInEnergyThreshold"] = CALL_ENGINE_SAFE.bargeInEnergyThreshold;
  }

  const endpoint = cfg["asrEndpointingSilenceMs"];
  if (typeof endpoint === "number" && Number.isFinite(endpoint) && endpoint < CALL_ENGINE_SAFE.minEndpointingMs) {
    reasons.push(`asrEndpointingSilenceMs ${endpoint}→${CALL_ENGINE_SAFE.asrEndpointingSilenceMs}`);
    cfg["asrEndpointingSilenceMs"] = CALL_ENGINE_SAFE.asrEndpointingSilenceMs;
  }

  const planRaw = cfg["stopSpeakingPlan"];
  const plan =
    planRaw && typeof planRaw === "object"
      ? { ...(planRaw as Record<string, unknown>) }
      : null;

  const wordsCfg = typeof cfg["wordsForInterruption"] === "number" ? (cfg["wordsForInterruption"] as number) : undefined;
  const wordsPlan = plan && typeof plan["numWords"] === "number" ? (plan["numWords"] as number) : undefined;
  const voice = plan && typeof plan["voiceSeconds"] === "number" ? (plan["voiceSeconds"] as number) : undefined;

  const needsWordFix =
    (wordsCfg !== undefined && wordsCfg <= 0)
    || (wordsPlan !== undefined && wordsPlan <= 0);
  const needsVoiceFix = voice !== undefined && voice < CALL_ENGINE_SAFE.stopSpeakingVoiceFloor;

  if (needsWordFix || needsVoiceFix) {
    let words = CALL_ENGINE_SAFE.wordsForInterruption;
    if (wordsCfg !== undefined && wordsCfg > 0) words = clampInterruptWords(wordsCfg);
    else if (wordsPlan !== undefined && wordsPlan > 0) words = clampInterruptWords(wordsPlan);

    const nextVoice = voiceSecondsFromInterruptWords(words);
    const backOff =
      plan && typeof plan["backOffSeconds"] === "number" ? (plan["backOffSeconds"] as number) : 1;

    if (cfg["wordsForInterruption"] !== words) {
      reasons.push(`wordsForInterruption ${String(wordsCfg ?? "∅")}→${words}`);
      cfg["wordsForInterruption"] = words;
    }

    cfg["stopSpeakingPlan"] = {
      ...(plan ?? {}),
      numWords: words,
      voiceSeconds: nextVoice,
      backOffSeconds: backOff,
    };
    if (needsWordFix && wordsPlan !== words) {
      reasons.push(`stopSpeakingPlan.numWords ${String(wordsPlan ?? "∅")}→${words}`);
    }
    if (needsVoiceFix) {
      reasons.push(`stopSpeakingPlan.voiceSeconds ${String(voice)}→${nextVoice}`);
    }
  }

  const uniqueReasons = [...new Set(reasons)];
  return { changed: uniqueReasons.length > 0, config: cfg, reasons: uniqueReasons };
}

/** Defaults for INSERT / Vibe create — Bolna Call Engine Balanced. */
export function callEngineInsertDefaults(): Record<string, unknown> {
  return {
    asrEndpointingSilenceMs: CALL_ENGINE_SAFE.asrEndpointingSilenceMs,
    incrementalDelay: CALL_ENGINE_SAFE.incrementalDelay,
    bargeInEnergyThreshold: CALL_ENGINE_SAFE.bargeInEnergyThreshold,
    wordsForInterruption: CALL_ENGINE_SAFE.wordsForInterruption,
    stopSpeakingPlan: {
      numWords: CALL_ENGINE_SAFE.wordsForInterruption,
      voiceSeconds: voiceSecondsFromInterruptWords(CALL_ENGINE_SAFE.wordsForInterruption),
      backOffSeconds: 1,
    },
  };
}
