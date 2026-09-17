/**
 * Turn sequence ids + word-count barge-in (Bolna `number_of_words_for_interruption`).
 *
 * sequence_id === -1 is reserved for fillers / backchannels (always valid).
 */

export type AudioSendStatus = "SEND" | "BLOCK" | "WAIT";

export const FILLER_SEQUENCE_ID = -1;

/** Bolna `number_of_words_for_interruption` default while TTS is playing. */
export const PLAYING_INTERRUPT_WORD_FLOOR = 3;

export function countTranscriptWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export interface InterruptionManagerOptions {
  /** Min words for transcript barge-in (0 / unset = default 3). */
  wordsForInterruption?: number;
}

export class InterruptionManager {
  private currSequenceId = 0;
  private readonly validSequenceIds = new Set<number>([FILLER_SEQUENCE_ID]);
  private calleeSpeaking = false;
  private readonly wordsForInterruption: number;
  private bargeInCount = 0;

  constructor(opts: InterruptionManagerOptions = {}) {
    this.wordsForInterruption = (opts.wordsForInterruption && opts.wordsForInterruption > 0)
      ? opts.wordsForInterruption
      : PLAYING_INTERRUPT_WORD_FLOOR;
  }

  getWordsForInterruption(): number {
    return this.wordsForInterruption;
  }

  /**
   * Barge only on word count while TTS is playing.
   * `word_count >= number_of_words` (default 3).
   */
  shouldTriggerInterruption(
    wordCount: number,
    transcript: string,
    isAudioPlaying: boolean,
  ): boolean {
    if (!isAudioPlaying) return false;
    const words = Math.max(wordCount, countTranscriptWords(transcript));
    return words >= this.wordsForInterruption;
  }

  /** Start a new agent reply turn; returns the sequence id for TTS frames. */
  beginAgentTurn(): number {
    this.currSequenceId++;
    this.validSequenceIds.add(this.currSequenceId);
    return this.currSequenceId;
  }

  currentSequenceId(): number {
    return this.currSequenceId;
  }

  pruneStaleSequences(): void {
    for (const id of [...this.validSequenceIds]) {
      if (id !== FILLER_SEQUENCE_ID && id !== this.currSequenceId) {
        this.validSequenceIds.delete(id);
      }
    }
  }

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

  getAudioSendStatus(sequenceId: number, _historyLength: number): AudioSendStatus {
    if (!this.validSequenceIds.has(sequenceId)) return "BLOCK";
    return "SEND";
  }

  onUserSpeechStart(): void {
    this.calleeSpeaking = true;
  }

  onUserSpeechEnd(): void {
    this.calleeSpeaking = false;
  }

  isCalleeSpeaking(): boolean {
    return this.calleeSpeaking;
  }

  getBargeInCount(): number {
    return this.bargeInCount;
  }
}
