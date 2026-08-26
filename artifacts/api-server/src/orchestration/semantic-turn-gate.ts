/**
 * Semantic end-of-turn gate.
 *
 * VAD = "the person stopped talking."
 * Smart Turn = "was that a complete conversational turn?"
 * Text veto = "even if the audio model says complete, the words say they are continuing."
 * transcript.final = source of truth for LLM/TTS — never send TTS before that
 * is validated. The 1.2s timer is an incomplete-only continuation cap, not a
 * wait on every turn.
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
