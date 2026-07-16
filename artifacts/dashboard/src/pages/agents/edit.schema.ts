import { z } from "zod";
import { ASR_MODELS, LLM_MODELS, TTS_MODELS, getModelError } from "@/lib/agent-providers";
import type { AgentTool } from "@workspace/api-client-react";

export const agentFormSchema = z.object({
  name:              z.string().min(1, "Name is required"),
  description:       z.string().optional(),
  asrProvider:       z.string().min(1, "ASR Provider is required"),
  asrModel:          z.string().optional(),
  llmProvider:       z.string().min(1, "LLM Provider is required"),
  llmModel:          z.string().optional(),
  ttsProvider:       z.string().min(1, "TTS Provider is required"),
  ttsVoice:          z.string().optional(),
  ttsModel:          z.string().optional(),
  telephonyProvider: z.string().min(1, "Telephony Provider is required"),
  systemPrompt:      z.string().min(1, "System prompt is required"),
  systemPromptGenMeta: z.object({
    foundationVersion: z.number(),
    clientDetailsVersion: z.number().nullable(),
    domain: z.object({ id: z.number(), name: z.string(), version: z.number() }).nullable(),
    generatedAt: z.string(),
    formInputs: z.record(z.string(), z.unknown()),
  }).nullable().optional(),
  temperature:       z.number().min(0).max(2).optional(),
  maxDuration:       z.number().min(10).max(3600).optional(),
  greetingMessage:          z.string().optional(),
  firstSpeaker:             z.preprocess((v) => (v === "user" ? "user" : "assistant"), z.enum(["assistant", "user"])),
  endCallPhrases:           z.string().optional(),
  silenceTimeoutSeconds:    z.number().min(5).max(300).optional(),
  language:                 z.string().optional(),
  asrLanguage:              z.string().optional(),
  backchannelingEnabled:    z.boolean().optional(),
  backchannelingFrequency:  z.number().min(0).max(1).optional(),
  webhookUrl:               z.string().optional().refine(
    (v) => !v || v.startsWith("https://"),
    { message: "Webhook URL must start with https://" }
  ),
  webhookSecret:            z.string().optional(),
  noiseCancellationEnabled: z.boolean().optional(),
  ambientNoiseEnabled:      z.boolean().optional(),
  ambientNoiseTrack:        z.string().optional(),
  ambientNoiseVolume:       z.number().min(0).max(1).optional(),
  promptVariables: z.array(z.object({
    key:          z.string().min(1, "Key required"),
    defaultValue: z.string(),
    description:  z.string().optional(),
  })).optional(),
  vadSilenceMs:           z.number().min(50).max(2000).optional(),
  bargeInEnabled:         z.boolean().optional(),
  bargeInEnergyThreshold: z.number().min(800).max(5000).optional(),
  bargeInMinFrames:       z.number().min(1).max(20).optional(),
  micSensitivity:         z.enum(["low", "normal", "high"]).optional(),
  timezone:               z.string().optional(),
  autoSwitchToEnglish:    z.boolean().optional(),
  languageAutoDetect:     z.boolean().optional(),
  machineDetectionMode:   z.enum(["disabled", "enable", "detect_message_end"]).optional(),
  voicemailAction:        z.enum(["hangup", "leave_message", "continue"]).optional(),
  voicemailMessage:       z.string().optional(),
  voicemailLeadInSeconds: z.number().min(0).max(15).optional(),
  tools: z.array(z.object({
    type: z.enum(["call_transfer", "webhook", "send_sms", "end_call", "cal_com", "native_booking", "native_check_availability", "native_list_bookings", "native_reschedule", "native_cancel", "transfer_cold", "transfer_warm", "transfer_agent"]),
    name: z.string().optional(),
    description: z.string().optional(),
    transferTo: z.string().optional(),
    warmHandoffMessage: z.string().optional(),
    transferMode: z.enum(["cold", "warm_summary"]).optional(),
    summaryPrompt: z.string().optional(),
    url: z.string().optional(),
    method: z.enum(["GET", "POST"]).optional(),
    secret: z.string().optional(),
    preToolMessage: z.string().optional(),
    calendarId: z.preprocess(v => (v === "" || v == null ? undefined : Number(v)), z.number().optional()),
    eventTypeId: z.preprocess(v => (v === "" || v == null ? undefined : Number(v)), z.number().optional()),
    timezone: z.string().optional(),
    goodbyeMessage: z.string().optional(),
    targetNumber: z.string().optional(),
    holdMessage: z.string().optional(),
    targetAgentId: z.number().optional(),
    parameters: z.array(z.object({
      paramName: z.string().min(1, "Name required"),
      dataType: z.enum(["string", "number", "boolean"]),
      paramDescription: z.string().optional(),
      required: z.boolean().optional(),
    })).optional(),
  })).optional(),
  genderDetectionEnabled: z.boolean().optional(),
  voiceMemoryEnabled: z.boolean().optional(),
  recordingEnabled: z.boolean().optional(),
  startSpeakingWaitSecs:          z.number().min(0).max(5).optional(),
  startSpeakingOnPunctuationSecs: z.number().min(0).max(3).optional(),
  startSpeakingOnNoPunctuationSecs: z.number().min(0).max(3).optional(),
  startSpeakingOnNumberSecs:      z.number().min(0).max(3).optional(),
  /** Words before barge-in (Bolna number_of_words_for_interruption). 1–6; never 0 in Engine UI. */
  stopSpeakingNumWords:    z.number().min(1).max(6).optional(),
  stopSpeakingVoiceSecs:   z.number().min(0.2).max(1).optional(),
  stopSpeakingBackOffSecs: z.number().min(0).max(10).optional(),
  complianceIrdai: z.boolean().optional(),
  complianceDpdp:  z.boolean().optional(),
  complianceTrai:  z.boolean().optional(),
  snapserveAgentId: z.string().optional(),
  knowledgeSourceIds: z.array(z.number()).optional(),
  contextWindowTurns: z.number().min(1).max(1000).optional().nullable(),
  summarizationEnabled: z.boolean().optional(),
  stagedPromptEnabled: z.boolean().optional(),
  stagedPromptStages: z.array(z.object({ name: z.string(), content: z.string() })).optional(),
  stagedPromptCoreIdentity: z.string().optional(),
  inboundPhoneNumberId: z.number().optional().nullable(),
  outboundPhoneNumberId: z.number().optional().nullable(),
  preferredManagedNumber: z.string().optional().nullable(),

  // Latency tuning
  asrEndpointingSilenceMs: z.number().min(100).max(800).optional(),
  llmMaxTokens: z.number().min(1).max(16000).optional().nullable(),
  ttsMinSentenceChars: z.number().min(5).max(200).optional(),
  linearDelayMs: z.number().min(0).max(1500).optional(),
  ttsSpeed: z.number().min(0.7).max(1.5).optional(),
  kbBakedOnly: z.boolean().optional(),

  voiceStack: z.enum(["classic", "gemini_live"]).optional(),
  geminiLiveVoiceName: z.string().optional(),
  geminiLiveThinkingLevel: z.enum(["minimal", "low", "medium", "high"]).optional(),

  // Auto-redial on drop
  autoRedialEnabled:      z.boolean().optional(),
  autoRedialMaxAttempts:  z.number().min(1).max(10).optional(),

  // Sarvam STT mode (only relevant when asrProvider === "sarvam")
  sarvamSttMode: z.enum(["codemix", "verbatim", "transcribe"]).optional(),

  // Workspace calendar assigned to this agent for native scheduling tools
  schedulingCalendarId: z.number().optional().nullable(),
  schedulingEventTypeId: z.number().optional().nullable(),

}).superRefine((data, ctx) => {
  const asrErr = getModelError(data.asrProvider, data.asrModel, ASR_MODELS);
  if (asrErr) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["asrModel"], message: asrErr });

  const llmErr = getModelError(data.llmProvider, data.llmModel, LLM_MODELS);
  if (llmErr) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["llmModel"], message: llmErr });

  const ttsErr = getModelError(data.ttsProvider, data.ttsModel, TTS_MODELS);
  if (ttsErr) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ttsModel"], message: ttsErr });
});

export type AgentFormValues = z.infer<typeof agentFormSchema>;

type AgentFormTool = NonNullable<AgentFormValues["tools"]>[number];
type AgentFormToolParam = NonNullable<AgentFormTool["parameters"]>[number];

type WebhookParameterSchema = {
  type?: string;
  properties?: Record<string, { type?: string; description?: string }>;
  required?: string[];
};

/**
 * Inverse of the webhook-tool serialization in buildUpdateAgentPayload: converts
 * API tools (whose webhook `parameters` are in JSON Schema shape) back into the
 * form array shape. Non-webhook tools pass through unchanged.
 */
export function hydrateToolsForForm(tools: readonly AgentTool[]): AgentFormTool[] {
  return tools.map((tool) => {
    if (tool.type !== "webhook") {
      return tool as unknown as AgentFormTool;
    }
    const { parameters, ...toolRest } = tool as AgentTool & { parameters?: WebhookParameterSchema };
    const properties = parameters?.properties ?? {};
    const requiredKeys = parameters?.required ?? [];
    const formParameters: AgentFormToolParam[] = Object.entries(properties).map(([key, prop]) => ({
      paramName: key,
      dataType: (prop?.type ?? "string") as AgentFormToolParam["dataType"],
      paramDescription: prop?.description ?? "",
      required: requiredKeys.includes(key),
    }));
    return { ...toolRest, parameters: formParameters } as unknown as AgentFormTool;
  });
}

/** Bolna-style Call Engine presets (endpointing + linear delay + interrupt words). */
export const CALL_ENGINE_PRESETS = {
  fast:     { asrEndpointingSilenceMs: 150, linearDelayMs: 200, stopSpeakingNumWords: 2 },
  balanced: { asrEndpointingSilenceMs: 250, linearDelayMs: 350, stopSpeakingNumWords: 3 },
  patient:  { asrEndpointingSilenceMs: 500, linearDelayMs: 700, stopSpeakingNumWords: 4 },
} as const;

export type CallEnginePreset = keyof typeof CALL_ENGINE_PRESETS;

/** Derive min voice duration so energy barge cannot undercut word-count (call 2620). */
export function voiceSecondsFromInterruptWords(numWords: number): number {
  const n = Math.max(1, Math.min(6, Math.round(numWords || 3)));
  return Math.max(0.2, Number((n * 0.15).toFixed(2)));
}

/** Telephony barge energy must never use VAD-floor values like 200. */
export function clampBargeInEnergyThreshold(value: number | null | undefined): number {
  const v = typeof value === "number" && Number.isFinite(value) ? value : 1200;
  return Math.max(800, Math.min(5000, Math.round(v)));
}

export function clampEndpointingMs(value: number | null | undefined): number {
  const v = typeof value === "number" && Number.isFinite(value) ? value : 300;
  return Math.max(100, Math.min(800, Math.round(v)));
}

export function clampLinearDelayMs(value: number | null | undefined): number {
  const v = typeof value === "number" && Number.isFinite(value) ? value : 400;
  return Math.max(0, Math.min(1500, Math.round(v)));
}

export function clampInterruptWords(value: number | null | undefined): number {
  const v = typeof value === "number" && Number.isFinite(value) ? value : 3;
  // Legacy agents stored 0 = "off" — treat as Bolna default 3.
  if (v <= 0) return 3;
  return Math.max(1, Math.min(6, Math.round(v)));
}
