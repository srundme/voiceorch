import type { StreamSTT } from "../../types.js";

export interface SttFinalMetadata {
  /** Provider-side request identifier (e.g. Sarvam request_id) — quote it in support escalations. */
  requestId?: string;
  /** ms from speech.enddetected → speech.phrase (Azure recognition processing time) */
  endDetectToFinalMs?: number;
  /** ms from last speech.hypothesis → speech.phrase (total delay since caller last spoke) */
  lastPartialToFinalMs?: number;
  /** How many raw STT segments were merged into this utterance (Sarvam coalescing). */
  mergedSegments?: number;
  /** Number of within-utterance pauses that were bridged (mergedSegments - 1). */
  pauseCount?: number;
  /** Interim from an in-flight coalesce buffer (Sarvam) — not a committed final. */
  pendingPartial?: boolean;
  /** Sarvam VAD END_SPEECH already received for this utterance (eager-commit signal). */
  speechEndReceived?: boolean;
}

export interface STTAdapter {
  transcribe(audioBuffer: Buffer, sampleRate?: number): Promise<string>;
  transcribeStream?(
    onTranscript: (text: string, isFinal: boolean, detectedLanguage?: string, metadata?: SttFinalMetadata) => void,
    onClose?: () => void,
  ): StreamSTT;
}
