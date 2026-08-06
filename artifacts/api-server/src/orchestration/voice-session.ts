import type { ConversationTurn } from "./types.js";
import type { RecordingBuffer } from "./recorder.js";

/**
 * Minimal surface shared by OrchestrationPipeline (classic) and
 * GeminiLivePipeline (native audio). Transports and session.ts depend only
 * on this interface so voice-stack routing stays localized to createSession.
 */
export interface VoiceSession {
  endReasonHint: string | null;

  onAudioIn(mulawChunk: Buffer): void;
  onRawPcm8kIn(pcm8k: Buffer, noiseCancel?: boolean, nativePcm16k?: Buffer): void;

  greet(): Promise<void>;
  close(): void;

  confirmAmdMachineThenBranch(): Promise<void>;
  deliverVoicemail(): Promise<void>;
  finishSpeakingForMaxDuration(graceMs: number): Promise<void>;
  speakRaw(text: string): Promise<void>;

  getTranscript(): string;
  getHistory(): ConversationTurn[];
  getLastTurnTexts(): { lastUser: string | null; lastAgent: string | null };
  getPreferredCallerLang(): string;
  getExplicitLangRequestForMemory(): string | null;
  getRecording(): RecordingBuffer;

  /**
   * Epoch ms of the last meaningful media (caller speech or real TTS out).
   * Used for billable duration when the session wall-clock outlives talk time.
   * Null when unknown.
   */
  getLastMediaAtMs(): number | null;

  /** Classic uses full AMD/media-drop hooks; Live provides no-op stubs in v1. */
  noteMediaDropIfWaitingForReply(): void;
  onExternalAmdSignal(verdict: "machine" | "human", source: string): void;

  /**
   * Optional: deliver a video frame from the webcall client to the pipeline.
   * Only implemented by GeminiLivePipeline; classic pipeline ignores it.
   */
  onVideoFrame?(jpegBase64: string, mimeType?: string): void;

  /**
   * Optional: meeting speaker identification (Recall bot calls). Driven by
   * services/meet-roster.ts. Only the classic pipeline implements these; the
   * roster calls them defensively (`?.`) so Live sessions simply lack names.
   */
  markMeetingMode?(): void;
  setMeetingRoster?(line: string | null): void;
  setMeetingSpeaker?(name: string | null): void;
  injectMeetingNote?(note: string): void;
  /** Cost cut: end voice session when the meeting room empties / bot leaves. */
  endMeetingSession?(reason?: string): void;
}
