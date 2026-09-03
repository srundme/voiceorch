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

/** Indic scripts pack a turn into few whitespace tokens — a 4-grapheme floor
 *  lets "Okay" / "दरअसल" / "यू नो" cut the agent (call 10544: 14 barge-ins). */
const INDIC_LANG_PREFIXES = new Set([
  "ta", "hi", "te", "kn", "ml", "mr", "bn", "gu", "pa", "or", "ur",
]);

/** Latin / English: keep the historic 4-char floor. Indic: require a real clause. */
const BARGE_IN_MIN_CHARS_DEFAULT = 4;
const BARGE_IN_MIN_CHARS_INDIC = 10;

/** Bolna `number_of_words_for_interruption` default while TTS is playing. */
export const PLAYING_INTERRUPT_WORD_FLOOR = 3;

const DEFAULT_ACCIDENTAL_INTERRUPT_PHRASES = [
  "stop", "wait", "hold on", "hang up", "cancel", "pause", "shut up",
  "hold", "enough", "வேண்டாம்", "நிறுத்து", "இருங்க",
  "ரூக்", "रुक", "रुको", "बस", "सुनो", "एक मिनट",
];

export function countTranscriptWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Hesitation / one-word scraps — raise the playing floor to 3. */
export function isAmbiguousInterruptTranscript(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return true;
  if (/\b(uh|um|uhh|umm|er|ah)\b/i.test(t)) return true;
  return false;
}

/**
 * Bolna word floor while the agent is speaking.
 * After TTS stops the floor is 0 (caller turn). No messy/+1 bump.
 */
export function resolvePlayingWordFloor(opts: {
  transcript: string;
  configuredFloor?: number;
  lowConfidence?: boolean;
}): number {
  const configured = opts.configuredFloor && opts.configuredFloor > 0
    ? opts.configuredFloor
    : PLAYING_INTERRUPT_WORD_FLOOR;
  return configured;
}

/**
 * Minimum grapheme count on the *current* transcript before word-count barge-in
 * may fire. Background talk-over and Devanagari one-word scraps sit under this.
 */
export function bargeInMinChars(lang?: string | null): number {
  const prefix = (lang ?? "").split(/[-_]/)[0]?.toLowerCase() ?? "";
  return INDIC_LANG_PREFIXES.has(prefix) ? BARGE_IN_MIN_CHARS_INDIC : BARGE_IN_MIN_CHARS_DEFAULT;
}

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
    this.wordsForInterruption = opts.wordsForInterruption ?? PLAYING_INTERRUPT_WORD_FLOOR;
    this.accidentalInterruptionPhrases = new Set(
      (opts.accidentalInterruptionPhrases ?? DEFAULT_ACCIDENTAL_INTERRUPT_PHRASES)
        .map((p) => p.trim().toLowerCase()),
    );
  }

  getWordsForInterruption(): number {
    return this.wordsForInterruption;
  }

  isImmediateInterruptPhrase(transcript: string): boolean {
    const stripped = transcript.trim().toLowerCase().replace(/[.!?…,]+$/g, "").trim();
    if (!stripped) return false;
    if (this.accidentalInterruptionPhrases.has(stripped)) return true;
    const tokens = stripped.split(/\s+/).filter(Boolean);
    for (const phrase of this.accidentalInterruptionPhrases) {
      if (phrase.includes(" ")) {
        if (stripped.includes(phrase)) return true;
      } else if (tokens.includes(phrase)) {
        return true;
      }
    }
    return false;
  }

  /**
   * PSTN interruption policy (Bolna word floor + stop phrases).
   * vad.speech_start is not an argument — caller must pass a transcript.
   * welcomePlayed=false: first-speech mute; only stop/hold phrases cut.
   */
  shouldTriggerInterruption(
    wordCount: number,
    transcript: string,
    isAudioPlaying: boolean,
    welcomePlayed = true,
    lowConfidence = false,
  ): boolean {
    if (!isAudioPlaying) return false;
    if (this.wordsForInterruption === 0) return false;
    if (this.isImmediateInterruptPhrase(transcript)) return true;
    if (!welcomePlayed) return false;
    const words = wordCount > 0 ? wordCount : countTranscriptWords(transcript);
    const floor = resolvePlayingWordFloor({
      transcript,
      configuredFloor: this.wordsForInterruption,
      lowConfidence,
    });
    return words >= floor;
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
    // Fillers must never WAIT on echo-VAD calleeSpeaking — that audio_gates
    // "ம்ம்"/"புரிஞ்சுது" and the caller hears a chopped first word (call 14235).
    if (sequenceId === FILLER_SEQUENCE_ID) return "SEND";
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

  /** True while STT VAD reports the caller is mid-utterance. */
  isCalleeSpeaking(): boolean {
    return this.calleeSpeaking;
  }

  getBargeInCount(): number {
    return this.bargeInCount;
  }
}

