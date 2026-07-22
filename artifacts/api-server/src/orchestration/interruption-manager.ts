/**
 * Bolna-parity interruption / sequence management.
 *
 * Each agent reply turn receives a monotonic sequence_id. On barge-in or eager
 * miss, the active sequence is invalidated so in-flight TTS bytes are BLOCKed
 * even if the play loop hasn't observed bargeInRequested yet (stale-audio gate).
 *
 * sequence_id === -1 is reserved for fillers / backchannels (always valid).
 */

export type AudioSendStatus = "SEND" | "BLOCK" | "WAIT";

export const FILLER_SEQUENCE_ID = -1;

export interface InterruptionManagerOptions {
  /** Post-utterance grace before agent audio (Bolna incremental_delay). */
  incrementalDelayMs?: number;
  /** Min words for transcript barge-in (0 = disabled). */
  wordsForInterruption?: number;
  /** Phrases that trigger immediate interruption regardless of word count (e.g. "stop", "wait"). */
  accidentalInterruptionPhrases?: string[];
}

export class InterruptionManager {
  private currSequenceId = 0;
  private readonly validSequenceIds = new Set<number>([FILLER_SEQUENCE_ID]);
  private calleeSpeaking = false;
  private utteranceEndAt = -1;
  private readonly incrementalDelayMs: number;
  private readonly wordsForInterruption: number;
  private readonly accidentalInterruptionPhrases: Set<string>;
  private turnId = 0;
  private bargeInCount = 0;

  constructor(opts: InterruptionManagerOptions = {}) {
    this.incrementalDelayMs = opts.incrementalDelayMs ?? 500;
    this.wordsForInterruption = opts.wordsForInterruption ?? 3;
    this.accidentalInterruptionPhrases = new Set(
      (opts.accidentalInterruptionPhrases ?? ["stop", "wait", "hold on", "hang up", "cancel", "pause", "shut up", " Listen", "வேண்டாம்", "நிறுத்து", "இருங்க", "ரூக்", "रुक", "रुको", "बस", "सुनो"])
        .map((p) => p.trim().toLowerCase()),
    );
  }

  getWordsForInterruption(): number {
    return this.wordsForInterruption;
  }

  /**
   * Bolna-parity should_trigger_interruption:
   * Returns true if user speech should trigger a barge-in during audio playback.
   */
  shouldTriggerInterruption(
    wordCount: int,
    transcript: string,
    isAudioPlaying: boolean,
    welcomePlayed = true,
  ): boolean {
    if (!isAudioPlaying || !welcomePlayed) return false;
    if (this.wordsForInterruption === 0) return false;
    const stripped = transcript.trim().toLowerCase();
    return (
      wordCount >= this.wordsForInterruption ||
      this.accidentalInterruptionPhrases.has(stripped)
    );
  }

  /** Start a new agent reply turn; returns the sequence id for TTS frames. */
  beginAgentTurn(): number {
    this.turnId++;
    this.currSequenceId++;
    this.validSequenceIds.add(this.currSequenceId);
    return this.currSequenceId;
  }

  currentSequenceId(): number {
    return this.currSequenceId;
  }

  /**
   * Drop sequence ids from prior agent turns so stale prefetch cannot emit after
   * a new processTurn begins. Fillers (sequence -1) are always kept.
   */
  pruneStaleSequences(): void {
    for (const id of [...this.validSequenceIds]) {
      if (id !== FILLER_SEQUENCE_ID && id !== this.currSequenceId) {
        this.validSequenceIds.delete(id);
      }
    }
  }

  /** Invalidate the active agent turn (barge-in / eager miss). */
  invalidateCurrentTurn(): number {
    const invalidated = this.currSequenceId;
    this.validSequenceIds.clear();
    this.validSequenceIds.add(FILLER_SEQUENCE_ID);
    this.bargeInCount++;
    return invalidated;
  }

  invalidateSequence(sequenceId: number): void {
    this.validSequenceIds.delete(sequenceId);
  }

  isValidSequence(sequenceId: number): boolean {
    return this.validSequenceIds.has(sequenceId);
  }

  /**
   * Bolna get_audio_send_status equivalent.
   * historyLength > 2 enables post-utterance grace (skip on welcome turns).
   */
  getAudioSendStatus(sequenceId: number, historyLength: number): AudioSendStatus {
    if (!this.validSequenceIds.has(sequenceId)) return "BLOCK";
    if (this.calleeSpeaking) return "WAIT";
    if (historyLength > 2 && this.utteranceEndAt > 0) {
      const since = Date.now() - this.utteranceEndAt;
      if (since >= 0 && since < this.incrementalDelayMs) return "WAIT";
    }
    return "SEND";
  }

  onUserSpeechStart(): void {
    this.calleeSpeaking = true;
  }

  onUserSpeechEnd(): void {
    this.calleeSpeaking = false;
    this.utteranceEndAt = Date.now();
  }

  getBargeInCount(): number {
    return this.bargeInCount;
  }
}

