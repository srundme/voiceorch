// ── Agent tools ───────────────────────────────────────────────────────────────

export interface CallTransferTool {
  type: "call_transfer";
  name: string;
  description: string;
  transferTo: string;
  warmHandoffMessage?: string;
}

export type AgentTool = CallTransferTool;

/** JSON Schema-compatible tool definition passed to LLM providers */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

// ── Core pipeline types ───────────────────────────────────────────────────────

/** Per-provider STT configuration derived from agent settings */
export interface STTConfig {
  language: string | null;
  backgroundDenoising: boolean;
  confidenceThreshold: number;
  endOfTurnConfidence: number;
  endOfTurnTimeout: number;
  keyterms: string[];
  /** "off" | "vapi" | "livekit" — "vapi" enables Deepgram utterance-end VAD events */
  smartEndpointing: string;
  autoFallback: boolean;
}

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

  // Tier 1 — Conversation Behavior
  greetingMessage: string | null;
  endCallPhrases: string[];
  silenceTimeoutSeconds: number | null;
  language: string | null;
  backchannelingEnabled: boolean;
  backchannelingFrequency: number | null;
  webhookUrl: string | null;
  noiseCancellationEnabled: boolean;

  // Tier 2 — Transcriber Settings
  sttConfig: STTConfig;

  // Tools
  tools: AgentTool[];
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
    onDone: (fullText: string) => void,
    options?: {
      tools?: ToolDefinition[];
      onToolCall?: (name: string, args: Record<string, unknown>) => void;
    }
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

export interface PipelineMetrics {
  sttLatencyMs: number;
  llmLatencyMs: number;
  ttsFirstChunkMs: number;
}

export interface SessionConfig {
  callId: number;
  agentConfig: AgentConfig;
  providerKeys: Map<string, string>;
  telephonyProvider: TelephonyProvider;
  onAudioOut: (audio: Buffer) => void;
  onTranscript: (speaker: "user" | "agent", text: string) => void;
  onCallEnd: () => void;
  onCallTransfer?: (transferTo: string) => void;
  onBargeIn?: () => void;
  onMetrics?: (metrics: PipelineMetrics) => void;
  /** Called after every completed turn with the full conversation history — used to persist to Redis */
  onConversationUpdate?: (history: ConversationTurn[]) => void;
}
