export interface STTAdapter {
  transcribe(audioBuffer: Buffer, sampleRate?: number): Promise<string>;
}
