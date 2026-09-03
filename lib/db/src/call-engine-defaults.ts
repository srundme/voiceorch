/**
 * Bolna-style Call Engine floors. Shared by api-server create/migrate paths
 * and the optional scripts/ migrate-call-engine-config dry-run tool.
 */

export const CALL_ENGINE_SAFE = {
  bargeInEnergyThreshold: 1200,
  asrEndpointingSilenceMs: 250,
  /** Extra post-transcript wait before LLM — 0 keeps turn latency snappy. */
  incrementalDelay: 0,
  wordsForInterruption: 3,
  stopSpeakingVoiceFloor: 0.2,
  minEnergy: 800,
  minEndpointingMs: 100,
  /** Legacy UI defaults that silently added ~1–2s of dead air. */
  legacyIncrementalDelay: 350,
  legacyNoPunctuationSeconds: 1.5,
  legacyNumberSeconds: 0.5,
  /** Prior "snappy" 100ms waits — still a second endpointing layer after STT final. */
  legacySnappySpeakingSeconds: 0.1,
  /**
   * Trust STT final: no SnapServe content-based wait before LLM.
   * Providers already decide speech-end; punctuation heuristics are ours alone.
   */
  trustSpeakingSeconds: 0,
} as const;

/**
 * TTS early-dispatch threshold. Providers stream tokens; SnapServe must chunk
 * for TTS APIs (multi-vendor glue) but should not wait for a long "complete" clause.
 */
export const TTS_STREAM_DEFAULTS = {
  /** Speak as soon as a short clause is ready (.!? / comma). */
  minSentenceChars: 5,
  /** Prior platform defaults that delayed first audio. */
  legacyMinSentenceChars: [15, 18] as const,
} as const;

/** Sarvam STT — trust Saaras VAD; no SnapServe artificial holds. */
export const SARVAM_STT_LATENCY_DEFAULTS = {
  /** Match Sarvam docs / LiveKit agents: STT owns end-of-speech. */
  highVadSensitivity: true,
  /** Emit immediately when Saaras ends speech / returns transcript. */
  speechEndFlushMs: 0,
  /** Do not second-guess Saaras with mid-thought coalesce holds. */
  incompleteHoldMs: 0,
  /**
   * Realtime `silence_duration_ms` for new agents / unset config.
   * 300 matches the Fast call-engine preset. 500 was the accidental Balanced
   * factory default that stacked ~200 ms of lag after every utterance.
   */
  endOfSpeechSilenceMs: 300,
  /** Previous builder/form default — rewritten to endOfSpeechSilenceMs. */
  legacyEndOfSpeechSilenceMs: 500,
} as const;

/**
 * Prior "patient" platform defaults (post call-4940) that added hundreds of ms
 * of dead air on top of Saaras VAD — rewritten to Saaras-native on normalize.
 */
export const SARVAM_STT_LATENCY_LEGACY_PATIENT = {
  highVadSensitivity: false,
  speechEndFlushMs: 80,
  incompleteHoldMs: 700,
  fragmentCoalesceListeningMs: 250,
} as const;

/** Older snappy insert defaults (pre-patient). */
export const SARVAM_STT_LATENCY_LEGACY_SNAPPY = {
  highVadSensitivity: true,
  speechEndFlushMs: 0,
  incompleteHoldMs: 120,
  fragmentCoalesceListeningMs: 150,
} as const;

/** Pipeline fragment coalesce — off by default; Saaras (and most STTs) already segment turns. */
export const FRAGMENT_COALESCE_DEFAULTS = {
  listeningMs: 0,
  playingMs: 0,
} as const;

export function clampSarvamSpeechEndFlushMs(value: number | null | undefined): number {
  const v = typeof value === "number" && Number.isFinite(value) ? value : SARVAM_STT_LATENCY_DEFAULTS.speechEndFlushMs;
  return Math.max(0, Math.min(200, Math.round(v)));
}

export function clampSarvamIncompleteHoldMs(value: number | null | undefined): number {
  const v = typeof value === "number" && Number.isFinite(value) ? value : SARVAM_STT_LATENCY_DEFAULTS.incompleteHoldMs;
  return Math.max(0, Math.min(1000, Math.round(v)));
}

export function resolveSarvamHighVadSensitivity(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return SARVAM_STT_LATENCY_DEFAULTS.highVadSensitivity;
}

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
    let words: number = CALL_ENGINE_SAFE.wordsForInterruption;
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

  // Rewrite legacy latency footguns that were form defaults (not intentional tuning).
  const delay = cfg["incrementalDelay"];
  if (typeof delay === "number" && delay === CALL_ENGINE_SAFE.legacyIncrementalDelay) {
    reasons.push(`incrementalDelay ${delay}→${CALL_ENGINE_SAFE.incrementalDelay}`);
    cfg["incrementalDelay"] = CALL_ENGINE_SAFE.incrementalDelay;
  }

  // Rewrite legacy patient Sarvam STT defaults that stacked artificial holds on
  // top of Saaras VAD. Only when the agent still has the old platform triplet —
  // leave intentional custom tuning alone.
  const sarvamHigh = cfg["sarvamHighVadSensitivity"];
  const sarvamFlush = cfg["sarvamSpeechEndFlushMs"];
  const sarvamHold = cfg["sarvamIncompleteHoldMs"];
  const stillPatientSarvam =
    (sarvamHigh === false || sarvamHigh === undefined)
    && (sarvamFlush === SARVAM_STT_LATENCY_LEGACY_PATIENT.speechEndFlushMs || sarvamFlush === undefined)
    && (sarvamHold === SARVAM_STT_LATENCY_LEGACY_PATIENT.incompleteHoldMs || sarvamHold === undefined);
  // Older insert profiles that still layered SnapServe holds on Saaras.
  const stillLegacyHoldProfile =
    (sarvamHold === SARVAM_STT_LATENCY_LEGACY_SNAPPY.incompleteHoldMs || sarvamHold === 220)
    && (
      sarvamFlush === SARVAM_STT_LATENCY_LEGACY_SNAPPY.speechEndFlushMs
      || sarvamFlush === 30
      || sarvamFlush === undefined
    );
  if (stillPatientSarvam || stillLegacyHoldProfile) {
    if (cfg["sarvamHighVadSensitivity"] !== SARVAM_STT_LATENCY_DEFAULTS.highVadSensitivity) {
      reasons.push(
        `sarvamHighVadSensitivity ${String(sarvamHigh ?? "∅")}→${SARVAM_STT_LATENCY_DEFAULTS.highVadSensitivity}`,
      );
      cfg["sarvamHighVadSensitivity"] = SARVAM_STT_LATENCY_DEFAULTS.highVadSensitivity;
    }
    if (cfg["sarvamSpeechEndFlushMs"] !== SARVAM_STT_LATENCY_DEFAULTS.speechEndFlushMs) {
      reasons.push(
        `sarvamSpeechEndFlushMs ${String(sarvamFlush ?? "∅")}→${SARVAM_STT_LATENCY_DEFAULTS.speechEndFlushMs}`,
      );
      cfg["sarvamSpeechEndFlushMs"] = SARVAM_STT_LATENCY_DEFAULTS.speechEndFlushMs;
    }
    if (cfg["sarvamIncompleteHoldMs"] !== SARVAM_STT_LATENCY_DEFAULTS.incompleteHoldMs) {
      reasons.push(
        `sarvamIncompleteHoldMs ${String(sarvamHold ?? "∅")}→${SARVAM_STT_LATENCY_DEFAULTS.incompleteHoldMs}`,
      );
      cfg["sarvamIncompleteHoldMs"] = SARVAM_STT_LATENCY_DEFAULTS.incompleteHoldMs;
    }
  }

  const fragListen = cfg["fragmentCoalesceListeningMs"];
  if (
    fragListen === SARVAM_STT_LATENCY_LEGACY_SNAPPY.fragmentCoalesceListeningMs
    || fragListen === SARVAM_STT_LATENCY_LEGACY_PATIENT.fragmentCoalesceListeningMs
    || fragListen === 500
  ) {
    reasons.push(
      `fragmentCoalesceListeningMs ${fragListen}→${FRAGMENT_COALESCE_DEFAULTS.listeningMs}`,
    );
    cfg["fragmentCoalesceListeningMs"] = FRAGMENT_COALESCE_DEFAULTS.listeningMs;
  }
  const fragPlay = cfg["fragmentCoalescePlayingMs"];
  if (fragPlay === 800 || fragPlay === 1000) {
    reasons.push(`fragmentCoalescePlayingMs ${fragPlay}→${FRAGMENT_COALESCE_DEFAULTS.playingMs}`);
    cfg["fragmentCoalescePlayingMs"] = FRAGMENT_COALESCE_DEFAULTS.playingMs;
  }

  const sspRaw = cfg["startSpeakingPlan"];
  if (sspRaw && typeof sspRaw === "object") {
    const ssp = { ...(sspRaw as Record<string, unknown>) };
    let sspChanged = false;
    const trustSpeakingKeys = [
      "waitSeconds",
      "onPunctuationSeconds",
      "onNoPunctuationSeconds",
      "onNumberSeconds",
    ] as const;
    const legacySpeakingValues = new Set<number>([
      CALL_ENGINE_SAFE.legacyNoPunctuationSeconds,
      CALL_ENGINE_SAFE.legacyNumberSeconds,
      CALL_ENGINE_SAFE.legacySnappySpeakingSeconds,
    ]);
    for (const key of trustSpeakingKeys) {
      const v = ssp[key];
      if (typeof v === "number" && legacySpeakingValues.has(v)) {
        reasons.push(`startSpeakingPlan.${key} ${v}→${CALL_ENGINE_SAFE.trustSpeakingSeconds}`);
        ssp[key] = CALL_ENGINE_SAFE.trustSpeakingSeconds;
        sspChanged = true;
      }
    }
    if (sspChanged) cfg["startSpeakingPlan"] = ssp;
  }

  const eos = cfg["sarvamEndOfSpeechSilenceMs"];
  if (eos === SARVAM_STT_LATENCY_DEFAULTS.legacyEndOfSpeechSilenceMs) {
    reasons.push(
      `sarvamEndOfSpeechSilenceMs ${eos}→${SARVAM_STT_LATENCY_DEFAULTS.endOfSpeechSilenceMs}`,
    );
    cfg["sarvamEndOfSpeechSilenceMs"] = SARVAM_STT_LATENCY_DEFAULTS.endOfSpeechSilenceMs;
  }

  const wordsLive = cfg["wordsForInterruption"];
  if (wordsLive === 2) {
    reasons.push("wordsForInterruption 2→3");
    cfg["wordsForInterruption"] = 3;
    const ssp = cfg["stopSpeakingPlan"];
    if (ssp && typeof ssp === "object") {
      cfg["stopSpeakingPlan"] = { ...(ssp as Record<string, unknown>), numWords: 3 };
    }
  }

  const ttsMin = cfg["ttsMinSentenceChars"];
  if (
    typeof ttsMin === "number"
    && (TTS_STREAM_DEFAULTS.legacyMinSentenceChars as readonly number[]).includes(ttsMin)
  ) {
    reasons.push(`ttsMinSentenceChars ${ttsMin}→${TTS_STREAM_DEFAULTS.minSentenceChars}`);
    cfg["ttsMinSentenceChars"] = TTS_STREAM_DEFAULTS.minSentenceChars;
  }

  const tailDrain = cfg["telephonyTailDrainMs"];
  if (tailDrain === 400) {
    reasons.push("telephonyTailDrainMs 400→80");
    cfg["telephonyTailDrainMs"] = 80;
  }

  const uniqueReasons = [...new Set(reasons)];
  return { changed: uniqueReasons.length > 0, config: cfg, reasons: uniqueReasons };
}

/** Defaults for INSERT / Vibe create — trust provider turn-taking; no second waits. */
export function callEngineInsertDefaults(): Record<string, unknown> {
  return {
    asrEndpointingSilenceMs: CALL_ENGINE_SAFE.asrEndpointingSilenceMs,
    incrementalDelay: CALL_ENGINE_SAFE.incrementalDelay,
    bargeInEnergyThreshold: CALL_ENGINE_SAFE.bargeInEnergyThreshold,
    wordsForInterruption: CALL_ENGINE_SAFE.wordsForInterruption,
    startSpeakingPlan: {
      waitSeconds: CALL_ENGINE_SAFE.trustSpeakingSeconds,
      onPunctuationSeconds: CALL_ENGINE_SAFE.trustSpeakingSeconds,
      onNoPunctuationSeconds: CALL_ENGINE_SAFE.trustSpeakingSeconds,
      onNumberSeconds: CALL_ENGINE_SAFE.trustSpeakingSeconds,
    },
    ttsMinSentenceChars: TTS_STREAM_DEFAULTS.minSentenceChars,
    fragmentCoalesceListeningMs: FRAGMENT_COALESCE_DEFAULTS.listeningMs,
    fragmentCoalescePlayingMs: FRAGMENT_COALESCE_DEFAULTS.playingMs,
    telephonyTailDrainMs: 80,
    sarvamHighVadSensitivity: SARVAM_STT_LATENCY_DEFAULTS.highVadSensitivity,
    sarvamSpeechEndFlushMs: SARVAM_STT_LATENCY_DEFAULTS.speechEndFlushMs,
    sarvamIncompleteHoldMs: SARVAM_STT_LATENCY_DEFAULTS.incompleteHoldMs,
    sarvamEndOfSpeechSilenceMs: SARVAM_STT_LATENCY_DEFAULTS.endOfSpeechSilenceMs,
    stopSpeakingPlan: {
      numWords: CALL_ENGINE_SAFE.wordsForInterruption,
      voiceSeconds: voiceSecondsFromInterruptWords(CALL_ENGINE_SAFE.wordsForInterruption),
      backOffSeconds: 1,
    },
  };
}

/** Runtime rewrite: platform speaking waits → trust STT final (0). Custom values kept. */
export function resolveStartSpeakingPlan(
  raw: {
    waitSeconds?: number;
    onPunctuationSeconds?: number;
    onNoPunctuationSeconds?: number;
    onNumberSeconds?: number;
  } | null | undefined,
): {
  waitSeconds: number;
  onPunctuationSeconds: number;
  onNoPunctuationSeconds: number;
  onNumberSeconds: number;
} {
  const legacy = new Set<number>([
    CALL_ENGINE_SAFE.legacyNoPunctuationSeconds,
    CALL_ENGINE_SAFE.legacyNumberSeconds,
    CALL_ENGINE_SAFE.legacySnappySpeakingSeconds,
  ]);
  const trust = (v: number | undefined): number => {
    if (typeof v !== "number" || !Number.isFinite(v)) return CALL_ENGINE_SAFE.trustSpeakingSeconds;
    if (legacy.has(v)) return CALL_ENGINE_SAFE.trustSpeakingSeconds;
    return Math.max(0, v);
  };
  return {
    waitSeconds: trust(raw?.waitSeconds),
    onPunctuationSeconds: trust(raw?.onPunctuationSeconds),
    onNoPunctuationSeconds: trust(raw?.onNoPunctuationSeconds),
    onNumberSeconds: trust(raw?.onNumberSeconds),
  };
}

/** Runtime rewrite: platform TTS clause waits (15/18) → early dispatch (5). */
export function resolveTtsMinSentenceChars(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return TTS_STREAM_DEFAULTS.minSentenceChars;
  }
  if ((TTS_STREAM_DEFAULTS.legacyMinSentenceChars as readonly number[]).includes(value)) {
    return TTS_STREAM_DEFAULTS.minSentenceChars;
  }
  return Math.max(1, Math.min(200, Math.round(value)));
}
