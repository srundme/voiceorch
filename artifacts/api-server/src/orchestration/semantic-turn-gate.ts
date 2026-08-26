/**
 * Semantic end-of-turn gate — state machine, not event-order.
 *
 * TURN_OPEN (phase "open")
 *    partial / speech_start / speech_end / final (buffered)
 * TURN_EVALUATING
 *    final arrives → BUFFER (never processTurn yet)
 *    Smart Turn complete → eligible for commit (not final authority)
 *    Smart Turn incomplete → HOLD / RESUME
 *
 * VAD proposes a pause. Smart Turn + text veto decide eligibility.
 * transcript.final is buffered until the turn is committed, then validated
 * against any speculative LLM prefill. TTS starts only after that.
 *
 * The 1.2s timer is an incomplete-only continuation cap. Complete turns
 * do not wait.
 */

export type EouVerdict = "complete" | "incomplete" | "unavailable";
/** idle | open (TURN_OPEN) | evaluating | holding */
export type SemanticTurnPhase = "idle" | "open" | "evaluating" | "holding";
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
    this.phase = "open";
    return { cancelEvaluation, wasHolding };
  }

  /**
   * VAD (or a final that arrived first) proposes endpoint.
   * Duplicate proposals while already evaluating are ignored so
   * speech_end vs transcript.final order does not restart inference.
   */
  onSpeechEnd(): { generation: number; started: boolean } {
    if (this.phase === "evaluating") {
      return { generation: this.generation, started: false };
    }
    this.generation += 1;
    this.phase = "evaluating";
    return { generation: this.generation, started: true };
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

  /**
   * Finals are buffered until the turn is committed — not until Smart Turn
   * merely “decides”. Any non-idle phase (open / evaluating / holding) blocks
   * processTurn so event order cannot leak a final into the LLM.
   */
  shouldBlockFinal(): boolean {
    return this.phase !== "idle";
  }

  reset(): void {
    this.generation += 1;
    this.continuation = false;
    this.phase = "idle";
  }
}
