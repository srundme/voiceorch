/**
 * ClassicTurnCoordinator — Phase 1 routing facade.
 *
 * Centralizes *execution entry* for conversational interrupt and caller-turn
 * commit. Existing policies (word floors, soft duck, acceptance mode) stay in
 * pipeline helpers; later phases move conflicting policies behind this boundary.
 *
 * Rules:
 * - Only this coordinator may authorize interrupt or commit.
 * - Decision path is synchronous / non-blocking: never await KB / LLM / TTS here.
 * - responseId === InterruptionManager sequence_id (no second counter).
 * - Filler playback id stays −1, but tracks parent responseId for cancel pairing.
 */

import { logger } from "../lib/logger.js";
import type {
  ClassicTurnIdSnapshot,
  CommitRequest,
  CommitSource,
  InterruptRequest,
  MediaEpoch,
  ResponseId,
  UtteranceId,
} from "./classic-turn-ids.js";

export type ClassicTurnCoordinatorDeps = {
  getMediaEpoch: () => MediaEpoch;
  /** Current agent sequence_id from InterruptionManager. */
  getResponseId: () => ResponseId;
  isResponseValid: (responseId: ResponseId) => boolean;
  /** Soft-duck-or-hard policy (existing requestBargeIn body). */
  executeConversationalInterrupt: (req: InterruptRequest & ClassicTurnIdSnapshot) => void;
  /** Hard cancel only (existing triggerBargeIn body). */
  executeHardInterrupt: (req: InterruptRequest & ClassicTurnIdSnapshot) => void;
  /** Starts processTurn — may return a Promise; coordinator does not await KB/LLM/TTS work. */
  executeCommit: (req: CommitRequest & ClassicTurnIdSnapshot) => void | Promise<void>;
  callId?: string | number;
};

export class ClassicTurnCoordinator {
  private utteranceSeq = 0;
  private currentUtteranceId: UtteranceId | null = null;
  private fillerParentResponseId: ResponseId | null = null;
  /** Sync decision serialization — never held across KB/LLM/TTS awaits. */
  private decisionBusy = false;
  private pendingDecisions: Array<() => void> = [];
  private readonly deps: ClassicTurnCoordinatorDeps;

  constructor(deps: ClassicTurnCoordinatorDeps) {
    this.deps = deps;
  }

  snapshotIds(): ClassicTurnIdSnapshot {
    return {
      mediaEpoch: this.deps.getMediaEpoch(),
      utteranceId: this.currentUtteranceId,
      responseId: this.deps.getResponseId(),
      fillerParentResponseId: this.fillerParentResponseId,
    };
  }

  /**
   * Ensure an utterance id for this caller speech streak (partials / VAD).
   * Idempotent until {@link clearUtterance} / successful commit.
   */
  noteCallerSpeech(): UtteranceId {
    if (!this.currentUtteranceId) {
      this.utteranceSeq += 1;
      this.currentUtteranceId = `u${this.utteranceSeq}-${Date.now()}`;
    }
    return this.currentUtteranceId;
  }

  clearUtterance(): void {
    this.currentUtteranceId = null;
  }

  /** Arm filler against the response that owns the turn (sequence_id). */
  bindFillerToResponse(responseId: ResponseId): void {
    if (responseId <= 0) return;
    this.fillerParentResponseId = responseId;
  }

  clearFillerParent(): void {
    this.fillerParentResponseId = null;
  }

  fillerParentResponseIdOrNull(): ResponseId | null {
    return this.fillerParentResponseId;
  }

  /** Re-check before playback or tool dispatch on async completion. */
  isResponseStillValid(responseId: ResponseId): boolean {
    return this.deps.isResponseValid(responseId);
  }

  /**
   * Sole entry for conversational interruption (soft duck or hard barge).
   * Sync — must not await provider I/O.
   */
  requestInterrupt(req: InterruptRequest): void {
    this.runSerialized(() => {
      if (!this.currentUtteranceId && (req.partial?.trim() || req.trigger)) {
        this.noteCallerSpeech();
      }
      const snap = this.snapshotIds();
      logger.debug(
        {
          callId: this.deps.callId,
          event: "ClassicTurnCoordinator.interrupt",
          trigger: req.trigger,
          forceHard: Boolean(req.forceHard),
          ...snap,
        },
        "Turn coordinator interrupt",
      );
      if (req.forceHard) {
        this.deps.executeHardInterrupt({ ...req, ...snap });
        this.clearFillerParent();
      } else {
        this.deps.executeConversationalInterrupt({ ...req, ...snap });
      }
    });
  }

  /**
   * Sole entry for caller-turn commit (STT final, recovery, batch, meeting chat, …).
   * Returns the executeCommit promise if any; coordinator itself does not await
   * KB/LLM/TTS — those run inside processTurn after this returns control.
   */
  requestCommit(req: CommitRequest): Promise<void> {
    let run: (() => void | Promise<void>) | null = null;
    this.runSerialized(() => {
      if (!this.currentUtteranceId) this.noteCallerSpeech();
      const snap = this.snapshotIds();
      logger.debug(
        {
          callId: this.deps.callId,
          event: "ClassicTurnCoordinator.commit",
          source: req.source,
          transcriptPreview: req.transcript.slice(0, 80),
          ...snap,
        },
        "Turn coordinator commit",
      );
      const captured = { ...req, ...snap };
      run = () => {
        const result = this.deps.executeCommit(captured);
        // Utterance consumed at commit authorization; next speech starts a new id.
        this.clearUtterance();
        return result;
      };
    });
    const out = run?.();
    return Promise.resolve(out);
  }

  /** Map closeReason / path label → CommitSource. */
  static commitSourceFromCloseReason(closeReason: string | undefined): CommitSource {
    switch (closeReason) {
      case "force_finalized":
        return "force_finalized";
      case "coalesced_fragment":
        return "coalesced_fragment";
      case "safety_net":
        return "safety_net";
      default:
        return "stt_final";
    }
  }

  private runSerialized(fn: () => void): void {
    if (this.decisionBusy) {
      this.pendingDecisions.push(fn);
      return;
    }
    this.decisionBusy = true;
    try {
      fn();
    } finally {
      this.decisionBusy = false;
      const next = this.pendingDecisions.shift();
      if (next) this.runSerialized(next);
    }
  }
}
