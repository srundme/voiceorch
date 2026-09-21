/**
 * Sprint 1 voice-engine switch. Default is production V1.
 *
 *   VOICE_ENGINE=v1          existing pipeline owns barge + commit
 *   VOICE_ENGINE=v2_shadow   V1 still owns the call; V2 logs hypothetical decisions
 *   VOICE_ENGINE=v2          TurnController owns endpointing and barge-in
 */

export type VoiceEngineMode = "v1" | "v2_shadow" | "v2";

export const DEFAULT_BARGE_CONFIRM_MS = 160;
export const DEFAULT_ENDPOINT_CONFIRM_MS = 400;
export const DEFAULT_SILERO_START_THRESHOLD = 0.5;
export const DEFAULT_SILERO_END_THRESHOLD = 0.35;
export const DEFAULT_SILERO_START_FRAMES = 2;
export const DEFAULT_SILERO_END_FRAMES = 3;

export function resolveVoiceEngine(env: NodeJS.ProcessEnv = process.env): VoiceEngineMode {
  const raw = (env["VOICE_ENGINE"] ?? "v1").trim().toLowerCase();
  if (raw === "v2") return "v2";
  if (raw === "v2_shadow") return "v2_shadow";
  return "v1";
}

export function envNumber(name: string, def: number, min: number, max: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[name];
  if (raw == null || raw.trim() === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export function resolveTurnTiming(env: NodeJS.ProcessEnv = process.env): {
  bargeConfirmMs: number;
  endpointConfirmMs: number;
} {
  return {
    bargeConfirmMs: envNumber("BARGE_CONFIRM_MS", DEFAULT_BARGE_CONFIRM_MS, 40, 2000, env),
    endpointConfirmMs: envNumber("ENDPOINT_CONFIRM_MS", DEFAULT_ENDPOINT_CONFIRM_MS, 80, 2000, env),
  };
}

export function resolveSileroHysteresis(env: NodeJS.ProcessEnv = process.env): {
  startThreshold: number;
  endThreshold: number;
  startFrames: number;
  endFrames: number;
} {
  return {
    startThreshold: envNumber("SILERO_START_THRESHOLD", DEFAULT_SILERO_START_THRESHOLD, 0.1, 0.95, env),
    endThreshold: envNumber("SILERO_END_THRESHOLD", DEFAULT_SILERO_END_THRESHOLD, 0.05, 0.9, env),
    // Spec: a single frame must not start or stop speech.
    startFrames: Math.max(2, Math.round(envNumber("SILERO_START_FRAMES", DEFAULT_SILERO_START_FRAMES, 2, 12, env))),
    endFrames: Math.max(2, Math.round(envNumber("SILERO_END_FRAMES", DEFAULT_SILERO_END_FRAMES, 2, 16, env))),
  };
}
