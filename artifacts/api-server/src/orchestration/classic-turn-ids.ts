/**
 * Classic turn identity model (Phase 1).
 *
 * responseId is an alias of InterruptionManager sequence_id — never invent a
 * second response counter that can disagree with invalidateCurrentTurn().
 */

/** Current media stream lifetime (VoBiz WS reconnect / new stream). */
export type MediaEpoch = number;

/**
 * One caller utterance across partials → coalesce → finals.
 * Duplicate finals for the same speech must share this id.
 */
export type UtteranceId = string;

/**
 * Agent response for an accepted utterance.
 * MUST equal InterruptionManager sequence_id (beginAgentTurn / currentSequenceId).
 */
export type ResponseId = number;

/** Playback classification for fillers / backchannels — always valid to send. */
export const FILLER_SEQUENCE_ID_ALIAS = -1 as const;

export type ClassicTurnIdSnapshot = {
  mediaEpoch: MediaEpoch;
  utteranceId: UtteranceId | null;
  /** Current agent response sequence_id (0 before first beginAgentTurn). */
  responseId: ResponseId;
  /** Parent response for an armed filler (−1 playback id); null when none. */
  fillerParentResponseId: ResponseId | null;
};

export type CommitSource =
  | "stt_final"
  | "force_finalized"
  | "batch_stt"
  | "coalesced_fragment"
  | "meeting_chat"
  | "queued_drain"
  | "safety_net";

export type InterruptRequest = {
  trigger: string;
  partial?: string;
  /** Skip soft-duck policy; hard-cancel immediately (e.g. soft-duck promotion). */
  forceHard?: boolean;
  speculative?: boolean;
  energyDetails?: Record<string, unknown>;
};

export type CommitRequest = {
  source: CommitSource;
  transcript: string;
  sttLatencyMs: number;
};
