export interface AgentConfig {
  id: number;
  name: string;
  systemPrompt: string;
  temperature: number;
  maxDuration: number;
  asrProvider: string;
  asrModel: string | null;
  llmProvider: string;
  llmModel: string | null;
  ttsProvider: string;
  ttsVoice: string | null;
  ttsModel: string | null;
  telephonyProvider: string;
}

export interface ProviderKey {
  providerName: string;
  apiKey: string;
  extraConfig: string | null;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface STTAdapter {
  transcribe(audioBuffer: Buffer, sampleRate: number): Promise<string>;
  transcribeStream?(
    onTranscript: (text: string, isFinal: boolean) => void
  ): StreamSTT;
}

export interface StreamSTT {
  sendAudio(chunk: Buffer): void;
  close(): void;
}

export interface LLMAdapter {
  chat(
    messages: ConversationTurn[],
    systemPrompt: string,
    onToken: (token: string) => void,
    onDone: (fullText: string) => void
  ): Promise<void>;
}

export interface TTSAdapter {
  synthesize(text: string): Promise<Buffer>;
  synthesizeStream?(
    text: string,
    onChunk: (chunk: Buffer) => void,
    onDone: () => void
  ): Promise<void>;
}

export type TelephonyProvider = "twilio" | "plivo" | "vobiz";

export interface SessionConfig {
  callId: number;
  agentConfig: AgentConfig;
  providerKeys: Map<string, string>;
  telephonyProvider: TelephonyProvider;
  onAudioOut: (audio: Buffer) => void;
  onTranscript: (speaker: "user" | "agent", text: string) => void;
  onCallEnd: () => void;
}
