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
