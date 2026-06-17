import type { StreamSTT } from "../../types.js";

export interface STTAdapter {
  transcribe(audioBuffer: Buffer, sampleRate?: number): Promise<string>;
  transcribeStream?(
    onTranscript: (text: string, isFinal: boolean, detectedLanguage?: string) => void,
    onClose?: () => void,
  ): StreamSTT;
}
