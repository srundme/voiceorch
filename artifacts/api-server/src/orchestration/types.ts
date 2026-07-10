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

/**
 * Resolve the spoken goodbye for an AI-driven end-call in a single, consistent
 * priority order so every end-call path behaves identically:
 *   1. The `end_call` tool's own `goodbyeMessage` (most specific — wins if set)
 *   2. The agent's first configured End Call Phrase (`endCallPhrases[0]`)
 *   3. `DEFAULT_GOODBYE_MESSAGE` (last resort — never hang up silently)
 */
export function resolveGoodbyeMessage(
  goodbyeMessage: string | undefined | null,
  endCallPhrases: string[],
): string {
  const explicit = goodbyeMessage?.trim();
  if (explicit) return explicit;
  const firstPhrase = endCallPhrases[0]?.trim();
  if (firstPhrase) return firstPhrase;
  return DEFAULT_GOODBYE_MESSAGE;
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
  /** Azure STT: ms of silence after last spoken word before emitting a final phrase.
   *  Default 400ms. Range 100–2000ms. Lower = faster response, higher = fewer split turns. */
  endpointingSilenceMs?: number;
  /**
   * Sarvam only: the sample rate to actually stream/send to the API. Telephony
   * audio is native 8kHz (narrowband PSTN); Sarvam's docs support sample_rate=8000
   * directly, so telephony calls should set this to 8000 rather than forcing the
   * naive linear-interpolation upsample to 16000 (which manufactures samples that
   * aren't really there and can degrade recognition on already-lossy phone audio).
   * Webcall (native 16kHz mic) should leave this unset (defaults to 16000).
   */
  nativeSampleRate?: 8000 | 16000;
}

/**
 * Provider-agnostic LLM generation parameters resolved from agent config.
 * Currently consumed only by the Sarvam adapter (per Sarvam's Chat Completions
 * docs). Every field is optional — an adapter sends a value only when it is
 * explicitly set, so any unset param falls back to the provider's own default.
 */
export interface LLMGenerationParams {
  /** Sampling temperature, 0–2. */
  temperature?: number;
  /** Nucleus sampling, 0–1. */
  topP?: number;
  /** Maximum tokens in the completion. */
  maxTokens?: number;
  /** Penalize already-present tokens to encourage new topics, -2..2. */
  presencePenalty?: number;
  /** Penalize frequent tokens to reduce repetition, -2..2. */
  frequencyPenalty?: number;
  /** Deterministic sampling seed (best-effort). */
  seed?: number;
  /** Hard stop sequence(s); a single string or up to 4 strings. */
  stop?: string | string[];
  /** Sarvam-specific: Wikipedia RAG grounding for factual accuracy. */
  wikiGrounding?: boolean;
  /**
   * Sarvam Hybrid Thinking level. The Sarvam adapter defaults this to `null`
   * (thinking disabled) for voice latency; only set this to override.
   */
  reasoningEffort?: "low" | "medium" | "high" | null;
}

export interface AgentConfig {
  id: number;
  name: string;
  systemPrompt: string;
  temperature: number;
  /** Resolved LLM generation params (temperature/top_p/penalties/etc.). */
  llmGenerationParams?: LLMGenerationParams;
  maxDuration: number;
  asrProvider: string;
  asrModel: string | null;
  llmProvider: string;
  llmModel: string | null;
  /** If set, used as a retry adapter when the primary LLM fails before producing any tokens. */
  fallbackLlmProvider: string | null;
  fallbackLlmModel: string | null;
  ttsProvider: string;
  ttsVoice: string | null;
  ttsModel: string | null;
  /** Playback speed multiplier passed to providers that support it (Cartesia, ElevenLabs). 1.0 = normal, default. */
  ttsSpeed: number;
  telephonyProvider: string;

  // Tier 1 — Conversation Behavior
  greetingMessage: string | null;
  endCallPhrases: string[];
  silenceTimeoutSeconds: number | null;
  language: string | null;
  /** When set, overrides the initial currentLang in the pipeline for this specific call.
   *  Used by session.ts to seed the caller's preferred language from memory so the
   *  agent starts the call in the language the caller used last time. Only respected
   *  when languageAutoDetect=true. */
  initialLanguage?: string | null;
  /** When true, pipeline updates currentLang from STT's detectedLanguage on each
   *  final transcript so the per-turn LLM instruction follows the caller's language.
   *  False → strict single-language enforcement (default). */
  languageAutoDetect: boolean;
  /** When true, an explicit caller request to switch to English is honored even in
   *  strict single-language mode (languageAutoDetect=false): the pipeline latches
   *  English and injects a per-turn OVERRIDE so the LLM replies in English. */
  autoSwitchToEnglish: boolean;
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
  /** "Mic Sensitivity" — single lever scaling the noise gate ratio, VAD floor, and
   *  barge-in energy bars together. "low" filters quiet background talkers more
   *  aggressively; "high" catches quieter genuine caller replies. See mic-sensitivity.ts. */
  micSensitivity: "low" | "normal" | "high";

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
    trai: boolean;
  } | null;

  // Token Optimization
  contextWindowTurns: number | null;
  tokenSummarizationEnabled: boolean;
  tokenSummarizationThresholdTurns: number | null;
  stagedPromptEnabled: boolean;
  stagedPromptStages: Array<{ name: string; content: string }>;
  stagedPromptCoreIdentity: string | null;

  // Latency tuning — exposed in agent builder UI
  /** ms Azure waits after last spoken word before finalising (default 400). */
  asrEndpointingSilenceMs: number;
  /** Cap LLM output tokens to reduce response latency. null = model default. */
  llmMaxTokens: number | null;
  /** Min chars before a comma-clause triggers an early TTS dispatch (default 15). */
  ttsMinSentenceChars: number;
  /** Per-agent Sarvam STT transcription mode: codemix | verbatim | transcribe. null = provider default. */
  sarvamSttMode: string | null;
  /**
   * When true, skip per-turn pgvector retrieval entirely — the KB is already baked into
   * the system prompt (see KB_INJECT_MAX_CHARS). Saves ~150-200ms per turn by eliminating
   * the embed+vector-search round-trip before each LLM call. Use when the KB is small/stable
   * and the baked injection already covers it (source ID count is low, doc is < 4000 chars).
   */
  kbBakedOnly: boolean;
}

export interface ProviderKey {
  providerName: string;
  apiKey: string;
  extraConfig: string | null;
}

export interface ConversationTurn {
  role: "user" | "assistant" | "tool";
  content: string;
  /**
   * For role="tool": the tool_call_id of the native tool call this result responds to.
   * Populated by the pipeline for native tool calls; absent for inline-function-tag results.
   */
  toolCallId?: string;
  /**
   * For role="tool": the name of the tool that was called.
   * Used by Anthropic's tool_result format which requires the tool name.
   */
  toolName?: string;
  /**
   * For role="assistant": one or more native tool invocations made in this turn.
   * Populated by the pipeline when the LLM returns a tool_calls finish_reason.
   * Adapters use this to format the conversation history correctly for follow-up
   * calls (OpenAI tool_calls format, Anthropic tool_use blocks, Gemini functionCall).
   */
  toolCalls?: Array<{
    id: string;
    name: string;
    args: string;
  }>;
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
  /** Provider-specific: force the STT engine to flush its audio buffer and emit a transcript now. */
  flush?(): void;
  /**
   * Provider-specific (optional): live-switch the stream's language hint
   * mid-call (BCP-47, e.g. "ta-IN"). Used when the caller explicitly requests
   * a different spoken language so subsequent speech is transcribed in the
   * right script. Implementations should no-op when already on the requested
   * language and reconnect their underlying session as needed. Adapters that
   * don't support live switching simply omit this method.
   */
  setLanguage?(lang: string): void;
  close(): void;
  /**
   * Set by the caller immediately after creation.
   * Fired when the adapter detects that the WebSocket has silently died during
   * an active speech segment (no messages for >3 s while inSpeech=true).
   * The caller should fall back to batch STT immediately instead of waiting
   * for STREAMING_BATCH_FALLBACK_MS.
   */
  onConnectionDead?: (() => void) | null;
  /**
   * Set by the caller immediately after creation.
   * Fired when the adapter receives a VAD speech_start event — i.e., the moment
   * the caller's mic picks up the start of a new utterance. Used by webcall.ts to
   * distinguish "user spoke AFTER agent finished" (new turn) from "user spoke
   * DURING agent speech but didn't trigger barge-in" (leftover — discard).
   */
  onSpeechStart?: (() => void) | null;
  /**
   * Set by the caller immediately after creation.
   * Fired when the adapter receives a VAD speech_end event — i.e., the moment the
   * STT engine is confident the caller has stopped speaking. Fires BEFORE the
   * transcript arrives, so the pipeline can begin pre-turn preparation (ambient
   * fill, backchannel TTS warm-up) earlier than waiting for the full coalesced text.
   */
  onSpeechEnd?: (() => void) | null;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  /**
   * Number of input tokens served from the provider's prompt cache
   * (OpenAI `usage.prompt_tokens_details.cached_tokens`). Optional — only
   * providers that report a cache breakdown populate it. Used to verify that
   * the static system-prompt prefix is actually hitting cache turn-over-turn.
   */
  cachedTokens?: number;
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
      /** Fired the moment the adapter recognises that the model output contains a
       *  tool call, BEFORE the name/args are fully parsed. `format` records which
       *  serialized shape was detected (structured streaming, JSON content
       *  envelope, or a bracket/key-value text envelope). Used for execution-log
       *  visibility only — currently emitted by the Sarvam adapter. */
      onToolDetected?: (info: { format: "structured" | "json" | "bracket" | "function_tag" }) => void;
      /** Fired once the detected tool envelope has been parsed into a name + args
       *  (just before onToolCall). Used for execution-log visibility only —
       *  currently emitted by the Sarvam adapter. */
      onToolParsed?: (info: { name: string; format: "structured" | "json" | "bracket" | "function_tag"; args: Record<string, unknown> }) => void;
      /** Called once per chat() invocation with token counts when the provider
       *  returns them — fires on BOTH text turns and tool-call turns so the
       *  pipeline accumulates usage regardless of whether a tool was invoked. */
      onUsage?: (usage: LLMUsage) => void;
      /** Anthropic KV cache: mark system prompt block as ephemeral so it is
       *  cached between successive turns. Only honoured by AnthropicLLM. */
      kvCache?: boolean;
      /** Gemini explicit context caching: the exact static prefix of
       *  `systemPrompt` (language guard + base instructions + baked KB + caller
       *  memory) that is stable turn-over-turn and should be served from a
       *  `CachedContent`. `systemPrompt` MUST start with this string. Only
       *  honoured by GoogleLLM; ignored by every other adapter. */
      cacheBase?: string;
    }
  ): Promise<void>;
  /** Optional: pre-create the provider-side context cache before the first turn
   *  so turn 1 already benefits. `base` must equal the `cacheBase` that will be
   *  passed to `chat()`. Non-blocking and best-effort — only implemented by
   *  GoogleLLM (Gemini). Adapters without it are simply not warmed early. */
  warmContextCache?(base: string, tools?: ToolDefinition[]): void;
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
  /** Optional teardown — close any persistent connections (e.g. WebSocket).
   *  Called by the pipeline's close() when the call ends. */
  close?(): void;
  /** Optional pre-warm — open persistent connections before the first synthesis
   *  request so the greeting doesn't pay the connection cost. Fire-and-forget. */
  warmup?(): void;
}

export type TelephonyProvider = "twilio" | "plivo" | "vobiz";

/** Audio transport for a session. Extends the real telephony providers with the
 *  browser "webcall" test transport. The pipeline never branches on this value
 *  (it is purely metadata + audio-format selection via rawPcmOutput), so widening
 *  it here is safe. */
export type SessionTransport = TelephonyProvider | "webcall";

export interface PipelineMetrics {
  sttLatencyMs: number;
  llmLatencyMs: number;
  ttsFirstChunkMs: number;
}

export interface SessionConfig {
  callId: number;
  agentConfig: AgentConfig;
  providerKeys: Map<string, string>;
  telephonyProvider: SessionTransport;
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
   * @returns           `true` when the telephony redirect was dispatched successfully,
   *                    `false` when it failed (pipeline will NOT end the call).
   */
  onCallTransfer?: (transferTo: string, summary?: string) => Promise<boolean>;
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
  /** Carrier answer/bridge time (epoch ms), captured at the telephony answer
   *  webhook. When set, the recording timeline is anchored here so the gap
   *  between carrier answer and the first media frame is padded as leading
   *  silence — aligning the recording clock with what the caller heard live.
   *  Absent for webcall (no carrier answer gap). */
  answeredAt?: number;
  /** When set, the session does NOT run the conversation pipeline. Instead it waits for
   *  the answering machine's outgoing greeting to end — detected acoustically via inbound
   *  VAD (sustained silence after speech ≈ the record beep) — then speaks `message` once
   *  in full and hangs up. Used by the Vobiz AMD `leave_message` path so the recipient's
   *  machine records the ENTIRE message instead of just the tail. */
  voicemailDelivery?: {
    message: string;
    /** ms of continuous silence after greeting speech that signals end-of-greeting/beep. */
    postSilenceMarginMs?: number;
    /** Hard cap: if no greeting-end is detected, speak anyway after this many ms. */
    maxWaitMs?: number;
    /** Configured Lead-in Pause (seconds) applied AFTER the greeting/beep ends and
     *  BEFORE the message is spoken, so a slow machine finishes its beep first. */
    leadInSeconds?: number;
  };
  /** When set, the session was answered with an UNRELIABLE provider "machine" hint
   *  (VoBiz synchronous AMD). Instead of enacting the voicemail action outright, the
   *  pipeline opens the media stream and runs a short acoustic confirmation window on
   *  the inbound speech-energy signal. Only an acoustically-confirmed machine enacts
   *  `action`; anything ambiguous falls through to a normal greeting so a live human
   *  is never harmed. See confirmAmdMachineThenBranch() in the pipeline. */
  amdConfirm?: {
    /** Configured "When voicemail detected" action from the agent config. */
    action: "leave_message" | "hangup" | "continue";
    /** True when the answer webhook carried a synchronous "machine" flag (legacy
     *  hint path). False when confirmation was armed UNCONDITIONALLY for an
     *  AMD-enabled VoBiz outbound call — the real verdict then arrives via the
     *  async machine_detection_url callback (onExternalAmdSignal). Diagnostic
     *  only; the confirmation heuristics are identical either way. */
    hint?: boolean;
    /** Configured Lead-in Pause (seconds); forwarded to voicemail delivery. */
    leadInSeconds?: number;
  };
  /** Called once with the acoustically-confirmed AMD verdict so the call record's
   *  `amd_result` reflects the confirmed outcome, not the raw untrusted provider flag. */
  onAmdResult?: (result: "human" | "machine") => void;
  /** Called once, just before the call ends, when an outbound call was
   *  acoustically confirmed as a MACHINE and the configured voicemail action
   *  actually executed — either the voicemail message was delivered
   *  (`leave_message`) or a confirmed-machine `hangup` fired. NOT called for the
   *  `continue` action (which greets normally) nor for human fall-through. Lets
   *  the session record a distinct "voicemail" outcome instead of "completed". */
  onVoicemailAction?: () => void;
}
