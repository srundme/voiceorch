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

export interface SendSmsTool {
  type: "send_sms";
  name: string;
  description: string;
  messageTemplate: string;
}

export interface EndCallTool {
  type: "end_call";
  name: string;
  description: string;
  goodbyeMessage?: string;
}

export interface CalComTool {
  type: "cal_com";
  name: string;
  description: string;
  apiKey: string;
  eventTypeId: number;
  timezone?: string;
}

export interface NativeBookingTool {
  type: "native_booking";
  name: string;
  description: string;
  eventTypeId: number;
  /** Optional: parent calendar id (used by UI for cascading dropdowns; runtime resolves from event type) */
  calendarId?: number;
  /** Optional default timezone for confirmation messages */
  timezone?: string;
  /** Optional display label shown in the UI (mirrors `name`) */
  taskName?: string;
  /** Optional message spoken to the caller right before the booking executes (advisory; LLM-driven) */
  preToolMessage?: string;
}

export interface NativeRescheduleTool {
  type: "native_reschedule";
  name: string;
  description: string;
}

export interface NativeCancelTool {
  type: "native_cancel";
  name: string;
  description: string;
}

export interface NativeCheckAvailabilityTool {
  type: "native_check_availability";
  name: string;
  description: string;
  eventTypeId: number;
  /** Optional: parent calendar id (UI only) */
  calendarId?: number;
  /** Optional timezone used when phrasing slot times back to the caller */
  timezone?: string;
}

export type AgentTool = CallTransferTool | WebhookTool | SendSmsTool | EndCallTool | CalComTool | NativeBookingTool | NativeRescheduleTool | NativeCancelTool | NativeCheckAvailabilityTool;

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
  ambientNoiseEnabled: boolean;
  ambientNoiseTrack: string | null;
  inactivityMessage: string | null;
  guardrailRoutes: Array<{ name: string; scoreThreshold: number; utterances: string; response: string }>;
  ivrEnabled: boolean;
  ivrGreeting: string | null;
  ivrOptions: Array<{ digit: string; label: string; targetAgentId?: number }>;

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

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMAdapter {
  chat(
    messages: ConversationTurn[],
    systemPrompt: string,
    onToken: (token: string) => void,
    onDone: (fullText: string, usage?: LLMUsage) => void,
    options?: {
      tools?: ToolDefinition[];
      onToolCall?: (name: string, args: Record<string, unknown>) => void;
      /** Called once per chat() invocation with token counts when the provider
       *  returns them — fires on BOTH text turns and tool-call turns so the
       *  pipeline accumulates usage regardless of whether a tool was invoked. */
      onUsage?: (usage: LLMUsage) => void;
    }
  ): Promise<void>;
}

export interface TTSAdapter {
  /** Returns synthesized PCM audio together with the character count that was
   *  submitted to the provider (always equals text.length for all providers). */
  synthesize(text: string): Promise<{ audio: Buffer; characters: number }>;
  synthesizeStream?(
    text: string,
    onChunk: (chunk: Buffer) => void,
    /** Called once when synthesis is complete; receives the character count
     *  submitted to the provider so the pipeline can accumulate usage. */
    onDone: (characters: number) => void,
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
  callerPhone?: string | null;
  onAudioOut: (audio: Buffer) => void;
  onTranscript: (speaker: "user" | "agent", text: string) => void;
  onCallEnd: () => void;
  onCallTransfer?: (transferTo: string) => void;
  onBargeIn?: () => void;
  onMetrics?: (metrics: PipelineMetrics) => void;
  /** Called after every completed turn with the full conversation history — used to persist to Redis */
  onConversationUpdate?: (history: ConversationTurn[]) => void;
  /** Called when a fatal pipeline error occurs (STT/LLM/TTS failure) so the caller can fail the session with a human-readable reason */
  onFatalError?: (reason: string) => void;
}
