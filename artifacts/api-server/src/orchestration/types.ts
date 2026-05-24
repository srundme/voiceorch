// ── Agent tools ───────────────────────────────────────────────────────────────

export interface CallTransferTool {
  type: "call_transfer";
  name: string;
  description: string;
  transferTo: string;
  warmHandoffMessage?: string;
}

export interface WebhookTool {
  type: "webhook";
  name: string;
  description: string;
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  secret?: string;
}

export type AgentTool = CallTransferTool | WebhookTool;

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
  inactivityMessage: string | null;

  // Tier 2 — Transcriber Settings
  sttConfig: STTConfig;

  // Tools
  tools: AgentTool[];

  // Gender Detection
  genderDetectionEnabled: boolean;
  genderDetectionProvider: string;
  genderDetectionMaleSalutation: string;
  genderDetectionFemaleSalutation: string;
  genderDetectionNeutralSalutation: string;

  // P1-A: User-defined prompt variables resolved at call start
  promptVariables: Array<{ key: string; defaultValue: string; description?: string }>;

  // P1-B: Knowledge Base RAG
  knowledgeBaseId: number | null;

  // P1-C: Webhook HMAC secret
  webhookSecret: string | null;

  // P1-D: VAD / Barge-in per-agent tuning
  vadSilenceMs: number;
  bargeInEnabled: boolean;
  bargeInEnergyThreshold: number;
  bargeInMinFrames: number;
  bargeInEchoGraceMs: number;
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
    onTranscript: (text: string, isFinal: boolean) => void,
    onClose?: () => void,
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
    onDone: () => void,
    signal?: AbortSignal
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
