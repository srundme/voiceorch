import type { StreamSTT } from "../../types.js";

export interface SttFinalMetadata {
  /** ms from speech.enddetected → speech.phrase (Azure recognition processing time) */
  endDetectToFinalMs?: number;
  /** ms from last speech.hypothesis → speech.phrase (total delay since caller last spoke) */
  lastPartialToFinalMs?: number;
}

export interface STTAdapter {
  transcribe(audioBuffer: Buffer, sampleRate?: number): Promise<string>;
  transcribeStream?(
    onTranscript: (text: string, isFinal: boolean, detectedLanguage?: string, metadata?: SttFinalMetadata) => void,
    onClose?: () => void,
  ): StreamSTT;
}
