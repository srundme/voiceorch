// ── Agent tools ───────────────────────────────────────────────────────────────

export interface CallTransferTool {
  type: "call_transfer";
  name: string;
  description: string;
  transferTo: string;
  warmHandoffMessage?: string;
  /**
   * "cold"         — immediate blind transfer (default, existing behaviour)
   * "warm_summary" — dials operator, speaks AI-generated summary when they answer, then bridges customer
   */
  transferMode?: "cold" | "warm_summary";
  /** LLM prompt used to generate the operator briefing in warm_summary mode. Falls back to a sensible default. */
  summaryPrompt?: string;
}

export interface WebhookTool {
  type: "webhook";
  name: string;
  description: string;
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  secret?: string;
  /** Optional sentence the agent speaks before invoking this tool (dead-air filler) */
  preToolMessage?: string;
  /** JSON Schema describing the arguments the LLM should pass to this tool */
  parameters?: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
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

/**
 * Sensible default farewell spoken when a call is ended by the AI (built-in
 * end_call tool or an end-call phrase) and the agent has no custom
 * `goodbyeMessage` configured. Prevents calls from dropping silently.
 */
export const DEFAULT_GOODBYE_MESSAGE = "Thank you for calling. Have a great day. Goodbye!";

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
  /** Optional: auto-resolved from agent's calendar at runtime when absent */
  eventTypeId?: number;
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
  /** Optional: target calendar id for the rescheduled booking (falls back to original booking's calendar when absent) */
  calendarId?: number;
  /** Optional: target event type id for the rescheduled booking (falls back to original booking's event type when absent) */
  eventTypeId?: number;
  /** Optional: timezone used when resolving preferred slot times */
  timezone?: string;
}

export interface NativeCancelTool {
  type: "native_cancel";
  name: string;
  description: string;
  /** Optional: calendar id stored in tool config — used for scoped ownership check */
  calendarId?: number;
  /** Optional: event type id (UI only; runtime uses calendarId for auth) */
  eventTypeId?: number;
}

export interface NativeCheckAvailabilityTool {
  type: "native_check_availability";
  name: string;
  description: string;
  /** Optional: auto-resolved from agent's calendar at runtime when absent */
  eventTypeId?: number;
  /** Optional: parent calendar id (UI only) */
  calendarId?: number;
  /** Optional timezone used when phrasing slot times back to the caller */
  timezone?: string;
}

export interface NativeListBookingsTool {
  type: "native_list_bookings";
  name: string;
  description: string;
  /** Optional: calendar id to scope the lookup (UI hint; runtime scopes by authorized userId) */
  calendarId?: number;
  /** Optional timezone used when formatting booking date/times back to the caller */
  timezone?: string;
}

export interface TransferColdTool {
  type: "transfer_cold";
  name: string;
  description: string;
  targetNumber: string;
  /** Optional hold message spoken before the transfer */
  holdMessage?: string;
}

export interface TransferWarmTool {
  type: "transfer_warm";
  name: string;
  description: string;
  targetNumber: string;
  /** Optional hold message spoken before the transfer */
  holdMessage?: string;
  /** Optional LLM prompt override for generating the operator briefing */
  summaryPrompt?: string;
}

export interface TransferAgentTool {
  type: "transfer_agent";
  name: string;
  description: string;
  /** Target agent ID to transfer the call to */
  targetAgentId: number;
}

export type AgentTool = CallTransferTool | WebhookTool | SendSmsTool | EndCallTool | CalComTool | NativeBookingTool | NativeRescheduleTool | NativeCancelTool | NativeCheckAvailabilityTool | NativeListBookingsTool | TransferColdTool | TransferWarmTool | TransferAgentTool;

/** JSON Schema-compatible tool definition passed to LLM providers */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
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
  fallbackProviders: Array<{ provider: string; model: string | null }>;
  /** Candidate locales for Azure LID (multi-language detection). */
  candidateLanguages?: string[];
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
  backchannelPhrases: string[];
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

  // P1-A: User-defined prompt variables resolved at call start
  promptVariables: Array<{ key: string; defaultValue: string; description?: string }>;

  // P1-B: Knowledge Base RAG
  knowledgeBaseId: number | null;
  // Centralized Agent Knowledge — all knowledge source IDs attached to this agent
  // (M:N join table ∪ legacy knowledgeBaseId). Injected together at call time.
  knowledgeSourceIds: number[];

  // P1-C: Webhook HMAC secret
  webhookSecret: string | null;

  // P1-D: VAD / Barge-in per-agent tuning
  vadSilenceMs: number;
  bargeInEnabled: boolean;
  bargeInEnergyThreshold: number;
  bargeInMinFrames: number;
  bargeInEchoGraceMs: number;

  // P1-E: Agent timezone (used for date/time context in system prompt)
  timezone: string;

  // Call recording — when true, the in-process RecordingBuffer is finalized and stored at call end
  recordingEnabled: boolean;

  // P1-F: Caller gender detection
  genderDetectionEnabled: boolean;
  genderDetectionProvider?: string;
  genderDetectionMaleSalutation: string;
  genderDetectionFemaleSalutation: string;
  genderDetectionNeutralSalutation: string;

  // P1-G: Engine — interruption & pacing
  wordsForInterruption: number;
  incrementalDelay: number;

  // First speaker — "user" keeps the agent silent on connect until the caller speaks
  firstSpeaker: "assistant" | "user";

  // P1-H: Call lifecycle
  hangupAfterLlmCall: boolean;

  // P1-I: Start Speaking Plan — transcript-content-based response delay
  startSpeakingPlan: {
    waitSeconds: number;
    onPunctuationSeconds: number;
    onNoPunctuationSeconds: number;
    onNumberSeconds: number;
  } | null;

  // P1-J: Stop Speaking Plan — barge-in / interruption tuning (user-facing)
  stopSpeakingPlan: {
    numWords: number;
    voiceSeconds: number;
    backOffSeconds: number;
  } | null;

  // P1-K: Regulatory compliance (insurance / telecom)
  compliance: {
    irdai: boolean;
    dpdp: boolean;
    hipaa: boolean;
    trai: boolean;
  } | null;

  // Token Optimization
  contextWindowTurns: number | null;
  tokenSummarizationEnabled: boolean;
  tokenSummarizationThresholdTurns: number | null;
  stagedPromptEnabled: boolean;
  stagedPromptStages: Array<{ name: string; content: string }>;
  stagedPromptCoreIdentity: string | null;

  // Multilingual
  isMultilingual: boolean;
  multilingualLanguages: string[];
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
      /** Anthropic KV cache: mark system prompt block as ephemeral so it is
       *  cached between successive turns. Only honoured by AnthropicLLM. */
      kvCache?: boolean;
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
  /** Campaign lead ID for outbound calls — enables transfer DB writes + lead timeline */
  campaignLeadId?: number | null;
  onAudioOut: (audio: Buffer) => void;
  onTranscript: (speaker: "user" | "agent", text: string) => void;
  onCallEnd: () => void;
  /**
   * Called when the pipeline triggers a call transfer.
   * @param transferTo  E.164 number or SIP URI to transfer to.
   * @param summary     Operator briefing text (warm_summary mode only).
   */
  onCallTransfer?: (transferTo: string, summary?: string) => void;
  onBargeIn?: () => void;
  onMetrics?: (metrics: PipelineMetrics) => void;
  /** Called with every raw 8 kHz LINEAR16 PCM chunk arriving from the caller.
   *  Used by the voice-intelligence layer to buffer audio for speaker recognition
   *  without touching the core pipeline internals. */
  callerAudioTap?: (pcm8k: Buffer) => void;
  /** Called after every completed turn with the full conversation history — used to persist to Redis */
  onConversationUpdate?: (history: ConversationTurn[]) => void;
  /** Called when a fatal pipeline error occurs (STT/LLM/TTS failure) so the caller can fail the session with a human-readable reason */
  onFatalError?: (reason: string) => void;
  /** When true, onAudioOut receives raw 8 kHz LINEAR16 PCM instead of G.711 μ-law.
   *  Used for telephony providers (e.g. Vobiz) that natively accept PCM, avoiding a
   *  lossy mulaw encode→decode round-trip. */
  rawPcmOutput?: boolean;
  /** True when caller memory shows this is a returning caller (>=1 prior completed call).
   *  When set, the opening greeting is generated from the memory-injected system prompt
   *  (recognition-style) instead of speaking the static scripted greeting verbatim. */
  isReturningCaller?: boolean;
}
