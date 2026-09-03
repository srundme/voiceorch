/**
 * Semantic end-of-turn gate — state machine, not event-order.
 *
 * Invariants:
 *  1. VAD never commits a turn.
 *  2. Smart Turn never becomes transcript authority.
 *  3. Text veto can downgrade COMPLETE → HOLD.
 *  4. Partial transcripts never reach TTS.
 *  5. Speculative LLM output has no side effects (no TTS, tools, CRM, webhooks).
 *  6. transcript.final is required for TTS commit.
 *  7. A resumed turn invalidates prior speculative work.
 *  8. Every commit is scoped to turnGeneration.
 *  9. Old events cannot commit a newer turn.
 * 10. TTS is the first external side effect after reconciliation.
 *
 * TURN_OPEN (phase "open")
 *    partial / speech_start / speech_end / final (buffered)
 * TURN_EVALUATING
 *    final arrives → BUFFER
 *    Smart Turn complete + no veto → ELIGIBLE (await transcript.final)
 *    Smart Turn incomplete / veto → HOLD
 * HOLD
 *    resume → OPEN (turnGeneration++)
 *    timeout 1.2s → AWAITING_FINAL (still no TTS)
 * AWAITING_FINAL
 *    transcript.final → VALIDATE → processTurn → TTS
 *    grace elapsed without final → flush, then batch STT fallback
      (batch may produce the authoritative final; it never answers from a partial)
 *
 * Fail-open (Smart Turn *missing*) bypasses the audio model only.
 * A slow eval (`timeout`) HOLDs instead of cutting the caller off.
 * The text veto still runs. TTS still requires transcript.final.
 * Missing-model fail-open is a degraded mode — pipeline.ts must warn
 * once per call (`smart_turn_fail_open`) so it cannot go silent.
 */

export type EouVerdict = "complete" | "incomplete" | "unavailable" | "timeout";
/** idle | open | evaluating | holding | awaiting_final */
export type SemanticTurnPhase = "idle" | "open" | "evaluating" | "holding" | "awaiting_final";
export type SemanticTurnAction = "eligible" | "hold" | "await_final" | "ignore";

export const SEMANTIC_TURN_STOP_MS_DEFAULT = 1200;
export const SEMANTIC_TURN_STOP_MS_MIN = 400;
export const SEMANTIC_TURN_STOP_MS_MAX = 4000;
/** After incomplete timeout / eligible, wait this long for transcript.final. */
export const SEMANTIC_TURN_FINAL_MS_DEFAULT = 500;
/** Default Smart Turn eval budget. Slow eval HOLDs; missing model still fail-opens. */
export const SEMANTIC_TURN_EVAL_MS_DEFAULT = 400;
/** Extra eval budget while collecting digits / email so we prefer HOLD over timeout. */
export const SEMANTIC_TURN_EVAL_MS_COLLECTION = 700;

/**
 * Map a Smart Turn race onto an EOU verdict.
 * A session that is still loading is missing, not slow — timeout HOLD must
 * not apply until the ONNX session has actually run once.
 */
export function resolveSmartTurnEval(opts: {
  sessionReady: boolean;
  timedOut: boolean;
  verdict: EouVerdict | null | undefined;
}): EouVerdict {
  if (!opts.sessionReady) return "unavailable";
  if (opts.timedOut) return "timeout";
  return opts.verdict ?? "unavailable";
}

export function clampSemanticTurnStopMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return SEMANTIC_TURN_STOP_MS_DEFAULT;
  return Math.max(SEMANTIC_TURN_STOP_MS_MIN, Math.min(SEMANTIC_TURN_STOP_MS_MAX, Math.round(value)));
}

/**
 * Echo VAD during LLM/TTS must not bump turnGeneration. That is the
 * "TTS skipped — turnGeneration moved before playback" break (Railway 07:41):
 * processTurn is already running, isPlaying is still false, and a tail-echo
 * speech_start invalidates the reply that is about to play.
 */
export function shouldAdvanceSemanticTurnOnVadStart(opts: {
  isPlaying: boolean;
  isSendingTtsAudio: boolean;
  isProcessing: boolean;
}): boolean {
  if (opts.isPlaying || opts.isSendingTtsAudio || opts.isProcessing) return false;
  return true;
}

export function resolveSemanticTurnEnabled(raw: unknown): boolean {
  if (process.env["SEMANTIC_TURN"] === "0") return false;
  // Opt-in only. Default ON stacked Smart Turn on top of provider EOT.
  return raw === true;
}

/**
 * Combine audio-model verdict with a cheap transcript veto.
 * `eligible` means the turn may prefill the LLM — not that TTS may start.
 * Fail-open (`unavailable`) is eligible only when the text veto does not hold.
 */
export function resolveEouCommit(opts: {
  eou: EouVerdict;
  textLooksIncomplete: boolean;
  /** Short acks / finished emails / 10-digit numbers — timeout may still fail-open. */
  snapComplete?: boolean;
}): { action: "eligible" | "hold"; reason: string } {
  if (opts.eou === "incomplete") {
    return { action: "hold", reason: "audio_incomplete" };
  }
  if (opts.textLooksIncomplete) {
    if (opts.eou === "unavailable") return { action: "hold", reason: "text_incomplete" };
    if (opts.eou === "timeout") return { action: "hold", reason: "text_incomplete" };
    return { action: "hold", reason: "text_veto" };
  }
  if (opts.eou === "timeout") {
    // Slow ONNX: do not pretend the turn is complete unless the transcript
    // is already a snap-finished ack / ID / email.
    if (opts.snapComplete) return { action: "eligible", reason: "eou_timeout_ack" };
    return { action: "hold", reason: "eou_timeout" };
  }
  if (opts.eou === "unavailable") {
    return { action: "eligible", reason: "eou_unavailable" };
  }
  return { action: "eligible", reason: "audio_complete" };
}

export class SemanticTurnGate {
  phase: SemanticTurnPhase = "idle";
  /** Monotonic id for the in-flight caller turn. Resume during HOLD/EVAL/AWAIT increments it. */
  generation = 0;

  get turnGeneration(): number {
    return this.generation;
  }

  /** True after an incomplete pause — caller resumed; merge finals, don't LLM yet. */
  continuation = false;

  onSpeechStart(): { cancelEvaluation: boolean; wasHolding: boolean; wasAwaitingFinal: boolean } {
    const cancelEvaluation = this.phase === "evaluating"
      || this.phase === "holding"
      || this.phase === "awaiting_final";
    const wasHolding = this.phase === "holding";
    const wasAwaitingFinal = this.phase === "awaiting_final";
    if (cancelEvaluation) this.continuation = true;
    this.generation += 1;
    this.phase = "open";
    return { cancelEvaluation, wasHolding, wasAwaitingFinal };
  }

  /**
   * VAD (or a final that arrived first) proposes endpoint.
   * Does not bump turnGeneration — this is the same utterance.
   * Duplicate proposals while already evaluating are ignored so
   * speech_end vs transcript.final order does not restart inference.
   */
  onSpeechEnd(): { generation: number; started: boolean } {
    if (this.phase === "evaluating") {
      return { generation: this.generation, started: false };
    }
    if (this.phase === "idle") this.generation += 1;
    this.phase = "evaluating";
    return { generation: this.generation, started: true };
  }

  onEou(generation: number, resolved: { action: "eligible" | "hold"; reason: string }): SemanticTurnAction {
    if (generation !== this.generation || this.phase !== "evaluating") return "ignore";
    if (resolved.action === "hold") {
      this.phase = "holding";
      return "hold";
    }
    this.continuation = false;
    this.phase = "awaiting_final";
    return "eligible";
  }

  /**
   * Incomplete-continuation window elapsed. Does not authorize TTS —
   * wait for transcript.final (or the finalization grace + STT fallback).
   */
  onStopTimeout(generation: number): SemanticTurnAction {
    if (generation !== this.generation || this.phase !== "holding") return "ignore";
    this.continuation = false;
    this.phase = "awaiting_final";
    return "await_final";
  }

  /**
   * Finals are buffered until the turn is *eligible* and we are waiting for
   * the authoritative final. awaiting_final / idle let the final through to
   * processTurn — that is the only TTS commit path.
   */
  shouldBlockFinal(): boolean {
    return this.phase === "open" || this.phase === "evaluating" || this.phase === "holding";
  }

  isAwaitingFinal(): boolean {
    return this.phase === "awaiting_final";
  }

  /** True iff `generation` is still the in-flight caller turn. */
  belongsTo(generation: number): boolean {
    return generation === this.generation;
  }

  /** TTS commit consumed this generation's final — back to idle, same generation. */
  markCommitted(): void {
    this.continuation = false;
    this.phase = "idle";
  }

  reset(): void {
    this.continuation = false;
    this.phase = "idle";
  }
}
