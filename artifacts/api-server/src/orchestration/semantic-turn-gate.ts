/**
 * Semantic end-of-turn gate.
 *
 * Sarvam (and Silero) only detect speech vs silence. A pause after "yeah but…"
 * looks like end-of-turn to VAD even though the caller is still thinking.
 * This gate sits AFTER vad.speech_end and BEFORE speculative LLM / processTurn.
 *
 * Fail-open: if the audio model is missing or errors, we commit unless the
 * transcript itself looks incomplete (text veto).
 */

export type EouVerdict = "complete" | "incomplete" | "unavailable";
export type SemanticTurnPhase = "idle" | "speaking" | "evaluating" | "holding";
export type SemanticTurnAction = "commit" | "hold" | "ignore";

export const SEMANTIC_TURN_STOP_MS_DEFAULT = 1200;
export const SEMANTIC_TURN_STOP_MS_MIN = 400;
export const SEMANTIC_TURN_STOP_MS_MAX = 4000;

export function clampSemanticTurnStopMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return SEMANTIC_TURN_STOP_MS_DEFAULT;
  return Math.max(SEMANTIC_TURN_STOP_MS_MIN, Math.min(SEMANTIC_TURN_STOP_MS_MAX, Math.round(value)));
}

export function resolveSemanticTurnEnabled(raw: unknown): boolean {
  if (process.env["SEMANTIC_TURN"] === "0") return false;
  if (raw === false) return false;
  return true;
}

/** Combine audio-model verdict with a cheap transcript veto. */
export function resolveEouCommit(opts: {
  eou: EouVerdict;
  textLooksIncomplete: boolean;
}): { action: "commit" | "hold"; reason: string } {
  if (opts.eou === "incomplete") {
    return { action: "hold", reason: "audio_incomplete" };
  }
  if (opts.textLooksIncomplete) {
    return { action: "hold", reason: opts.eou === "unavailable" ? "text_incomplete" : "text_veto" };
  }
  if (opts.eou === "unavailable") {
    return { action: "commit", reason: "eou_unavailable" };
  }
  return { action: "commit", reason: "audio_complete" };
}

export class SemanticTurnGate {
  phase: SemanticTurnPhase = "idle";
  generation = 0;
  /** True after an incomplete pause — caller resumed; merge finals, don't LLM yet. */
  continuation = false;

  onSpeechStart(): { cancelEvaluation: boolean; wasHolding: boolean } {
    const cancelEvaluation = this.phase === "evaluating" || this.phase === "holding";
    const wasHolding = this.phase === "holding";
    if (cancelEvaluation) this.continuation = true;
    this.generation += 1;
    this.phase = "speaking";
    return { cancelEvaluation, wasHolding };
  }

  onSpeechEnd(): { generation: number } {
    this.generation += 1;
    this.phase = "evaluating";
    return { generation: this.generation };
  }

  onEou(generation: number, resolved: { action: "commit" | "hold"; reason: string }): SemanticTurnAction {
    if (generation !== this.generation || this.phase !== "evaluating") return "ignore";
    if (resolved.action === "hold") {
      this.phase = "holding";
      return "hold";
    }
    this.continuation = false;
    this.phase = "idle";
    return "commit";
  }

  onStopTimeout(generation: number): SemanticTurnAction {
    if (generation !== this.generation || this.phase !== "holding") return "ignore";
    this.continuation = false;
    this.phase = "idle";
    return "commit";
  }

  /** Finals must not start the LLM while we are still deciding or the caller resumed mid-thought. */
  shouldBlockFinal(): boolean {
    return this.phase === "evaluating" || this.phase === "holding"
      || (this.phase === "speaking" && this.continuation);
  }

  reset(): void {
    this.generation += 1;
    this.continuation = false;
    this.phase = "idle";
  }
}
