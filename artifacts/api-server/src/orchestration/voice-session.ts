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

  /** Classic uses full AMD/media-drop hooks; Live provides no-op stubs in v1. */
  noteMediaDropIfWaitingForReply(): void;
  onExternalAmdSignal(verdict: "machine" | "human", source: string): void;
}
