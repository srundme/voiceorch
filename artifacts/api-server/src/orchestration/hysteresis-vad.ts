/**
 * Frame-level Silero hysteresis. One 32 ms frame cannot start or stop speech.
 */

export type VadHysteresisState =
  | "SILENCE"
  | "START_CANDIDATE"
  | "SPEECH"
  | "END_CANDIDATE";

export type VadSpeechEvent = "SPEECH_START" | "SPEECH_CONTINUE" | "SPEECH_END";

export type VadFrameResult = {
  probability: number;
  state: VadHysteresisState;
  event: VadSpeechEvent | null;
  transition: string | null;
};

export type HysteresisVadConfig = {
  startThreshold: number;
  endThreshold: number;
  startFrames: number;
  endFrames: number;
};

export const DEFAULT_SILERO_START_THRESHOLD = 0.5;
export const DEFAULT_SILERO_END_THRESHOLD = 0.35;
export const DEFAULT_SILERO_START_FRAMES = 2;
export const DEFAULT_SILERO_END_FRAMES = 3;

function envNumber(name: string, def: number, min: number, max: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[name];
  if (raw == null || raw.trim() === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** Env-tunable hysteresis for classic-path Silero advisory. */
export function resolveSileroHysteresis(env: NodeJS.ProcessEnv = process.env): HysteresisVadConfig {
  return {
    startThreshold: envNumber("SILERO_START_THRESHOLD", DEFAULT_SILERO_START_THRESHOLD, 0.1, 0.95, env),
    endThreshold: envNumber("SILERO_END_THRESHOLD", DEFAULT_SILERO_END_THRESHOLD, 0.05, 0.9, env),
    // Spec: a single frame must not start or stop speech.
    startFrames: Math.max(2, Math.round(envNumber("SILERO_START_FRAMES", DEFAULT_SILERO_START_FRAMES, 2, 12, env))),
    endFrames: Math.max(2, Math.round(envNumber("SILERO_END_FRAMES", DEFAULT_SILERO_END_FRAMES, 2, 16, env))),
  };
}

export class HysteresisVad {
  private state: VadHysteresisState = "SILENCE";
  private run = 0;

  constructor(private readonly cfg: HysteresisVadConfig) {}

  reset(): void {
    this.state = "SILENCE";
    this.run = 0;
  }

  currentState(): VadHysteresisState {
    return this.state;
  }

  push(probability: number): VadFrameResult {
    const prev = this.state;
    let event: VadSpeechEvent | null = null;

    if (this.state === "SILENCE" || this.state === "START_CANDIDATE") {
      if (probability >= this.cfg.startThreshold) {
        this.run = this.state === "START_CANDIDATE" ? this.run + 1 : 1;
        this.state = "START_CANDIDATE";
        if (this.run >= this.cfg.startFrames) {
          this.state = "SPEECH";
          this.run = 0;
          event = "SPEECH_START";
        }
      } else {
        this.state = "SILENCE";
        this.run = 0;
      }
    } else {
      // SPEECH or END_CANDIDATE
      if (probability < this.cfg.endThreshold) {
        this.run = this.state === "END_CANDIDATE" ? this.run + 1 : 1;
        this.state = "END_CANDIDATE";
        if (this.run >= this.cfg.endFrames) {
          this.state = "SILENCE";
          this.run = 0;
          event = "SPEECH_END";
        }
      } else {
        this.state = "SPEECH";
        this.run = 0;
        event = "SPEECH_CONTINUE";
      }
    }

    const transition = this.state !== prev ? `${prev}->${this.state}` : null;
    return { probability, state: this.state, event, transition };
  }
}
