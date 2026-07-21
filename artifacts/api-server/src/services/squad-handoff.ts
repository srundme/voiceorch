/**
 * Mid-call AI→AI warm handoff for Agent Squads.
 * Keeps the carrier/webcall media transport open; swaps only the VoiceSession pipeline.
 */

import { db, agentsTable, providersTable, platformSettingsTable, type Squad } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { decryptKey } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";
import { OrchestrationPipeline } from "../orchestration/pipeline.js";
import { GeminiLivePipeline } from "../orchestration/adapters/live/gemini-live-pipeline.js";
import {
  DEFAULT_GEMINI_LIVE_MODEL,
  resolveGeminiLiveThinkingLevel,
  resolveGeminiLiveVoice,
  resolveVoiceStack,
} from "../orchestration/adapters/live/gemini-live-voices.js";
import { resolveSarvamSttMode } from "../orchestration/adapters/stt/sarvam-mode.js";
import { resolveMicSensitivity, getMicSensitivityThresholds } from "../orchestration/mic-sensitivity.js";
import { getAttachedSourceIds } from "../orchestration/kb-retrieval.js";
import type { AgentConfig, AgentTool, SessionTransport } from "../orchestration/types.js";
import type { VoiceSession } from "../orchestration/voice-session.js";
import { appendGuardrails } from "./guardrails.js";
import {
  validateSquadHandoff,
  recordSquadHandoff,
  type HandoffPacket,
} from "./squad-engine.js";

const DEFAULT_SILENCE_TIMEOUT_SECONDS = 45;

function buildHandoffPromptBlock(packet: HandoffPacket): string {
  return [
    "[SQUAD HANDOFF — CONFIDENTIAL CONTEXT]",
    "You are taking over this live call from a teammate. The customer is still on the line.",
    "Do NOT restart a cold greeting as if this were a new call. Acknowledge continuity briefly.",
    `Reason for handoff: ${packet.reason}`,
    `Squad goal: ${packet.goal}`,
    `Prior conversation summary:\n${packet.transcriptSummary || "(none)"}`,
    packet.language ? `Caller language preference: ${packet.language}` : null,
    packet.durableFacts && Object.keys(packet.durableFacts).length
      ? `Known facts: ${JSON.stringify(packet.durableFacts)}`
      : null,
    "Continue helping the customer from here.",
  ].filter(Boolean).join("\n");
}

async function loadProviderKeysMap(userId: string | null): Promise<Map<string, string>> {
  const providerKeys = new Map<string, string>();
  if (userId) {
    const rows = await db.select().from(providersTable).where(
      and(eq(providersTable.isActive, true), eq(providersTable.userId, userId)),
    );
    for (const row of rows) {
      try {
        providerKeys.set(row.providerName.toLowerCase(), decryptKey(row.apiKey));
        if (row.extraConfig) {
          providerKeys.set(`${row.providerName.toLowerCase()}:extraConfig`, row.extraConfig);
        }
      } catch { /* ignore bad key */ }
    }
  }

  const MANAGED: Record<string, string> = {
    google: "managed_gemini_key",
    gemini: "managed_gemini_key",
    deepgram: "managed_deepgram_key",
    sarvam: "managed_sarvam_key",
    cartesia: "managed_cartesia_key",
    openai: "managed_openai_key",
    azure: "managed_azure_speech_key",
  };
  for (const [name, settingKey] of Object.entries(MANAGED)) {
    if (providerKeys.has(name)) continue;
    const [row] = await db.select().from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, settingKey)).limit(1);
    if (row?.value) providerKeys.set(name, row.value);
  }
  return providerKeys;
}

async function buildTargetAgentConfig(
  agentId: number,
  packet: HandoffPacket,
): Promise<{ agentConfig: AgentConfig; providerKeys: Map<string, string> } | null> {
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId)).limit(1);
  if (!agent) return null;

  const agentCfg = (agent.agentConfig ?? {}) as Record<string, unknown>;
  const tools = Array.isArray(agent.tools) ? (agent.tools as unknown as AgentTool[]) : [];
  const endCallPhrases = agent.endCallPhrases
    ? agent.endCallPhrases.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  let systemPrompt = agent.generatedPrompt ?? agent.systemPrompt ?? "";
  systemPrompt = appendGuardrails(systemPrompt, agent.name);
  systemPrompt = `${systemPrompt}\n\n${buildHandoffPromptBlock(packet)}`;

  const effectiveAgentLang =
    (typeof agentCfg["language"] === "string" && (agentCfg["language"] as string)) ||
    agent.asrLanguage ||
    agent.language ||
    "en-IN";

  const voiceStack = resolveVoiceStack(agentCfg["voiceStack"] as string | undefined);
  const micSensitivity = resolveMicSensitivity(agentCfg["micSensitivity"] as string | undefined);

  const agentConfig: AgentConfig = {
    id: agent.id,
    name: agent.name,
    systemPrompt,
    temperature: agent.temperature ?? 0.5,
    llmGenerationParams: {
      ...(typeof agent.temperature === "number" ? { temperature: agent.temperature } : {}),
      maxTokens: typeof agentCfg["llmMaxTokens"] === "number" ? (agentCfg["llmMaxTokens"] as number) : 160,
      presencePenalty: 0.3,
      frequencyPenalty: 0.3,
    },
    maxDuration: agent.maxDuration ?? 600,
    asrProvider: agent.asrProvider,
    asrModel: agent.asrModel,
    llmProvider: agent.llmProvider,
    llmModel: agent.llmModel,
    fallbackLlmProvider: agent.llmFallbackProvider ?? null,
    fallbackLlmModel: agent.llmFallbackModel ?? null,
    ttsProvider: agent.ttsProvider,
    ttsVoice: agent.ttsVoice,
    ttsModel: agent.ttsModel,
    ttsSpeed: (agentCfg["ttsSpeed"] as number | undefined) ?? 1.0,
    telephonyProvider: agent.telephonyProvider,
    greetingMessage: null,
    firstSpeaker: "assistant",
    endCallPhrases,
    silenceTimeoutSeconds: agent.silenceTimeoutSeconds ?? DEFAULT_SILENCE_TIMEOUT_SECONDS,
    language: effectiveAgentLang,
    languageAutoDetect: agentCfg["languageMode"] === "multilingual" || agentCfg["languageAutoDetect"] === true,
    autoSwitchToEnglish: agentCfg["autoSwitchToEnglish"] === true,
    backchannelingEnabled: agent.backchannelingEnabled ?? false,
    backchannelingFrequency: agent.backchannelingFrequency ?? null,
    webhookUrl: agent.webhookUrl ?? null,
    noiseCancellationEnabled: agent.noiseCancellationEnabled ?? false,
    ambientNoiseEnabled: (agentCfg["ambientNoiseEnabled"] as boolean | undefined) ?? false,
    ambientNoiseTrack: (agentCfg["ambientNoiseTrack"] as string | undefined) ?? null,
    ambientNoiseVolume: 1.0,
    inactivityMessage: agent.inactivityMessage ?? null,
    guardrailRoutes: [],
    ivrEnabled: false,
    ivrGreeting: null,
    ivrOptions: [],
    sttConfig: {
      language: effectiveAgentLang,
      backgroundDenoising: agent.asrBackgroundDenoising ?? false,
      confidenceThreshold: agent.asrConfidenceThreshold ?? 0.40,
      endOfTurnConfidence: agent.asrEndOfTurnConfidence ?? 0.70,
      endOfTurnTimeout: agent.asrEndOfTurnTimeout ?? 5000,
      keyterms: agent.asrKeyterms
        ? agent.asrKeyterms.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
      smartEndpointing: agent.asrSmartEndpointing ?? "off",
      autoFallback: agent.asrAutoFallback ?? false,
      fallbackProviders: (agent.asrFallbackProviders as Array<{ provider: string; model: string | null }> | null | undefined) ?? [],
    },
    tools,
    promptVariables: [],
    knowledgeBaseId: agent.knowledgeBaseId ?? null,
    knowledgeSourceIds: await getAttachedSourceIds(agent.id, agent.knowledgeBaseId),
    webhookSecret: (agentCfg["webhookSecret"] as string | undefined) ?? null,
    vadSilenceMs: (agentCfg["vadSilenceMs"] as number | undefined) ?? 350,
    bargeInEnabled: (agentCfg["bargeInEnabled"] as boolean | undefined) ?? true,
    bargeInEnergyThreshold: (agentCfg["bargeInEnergyThreshold"] as number | undefined)
      ?? getMicSensitivityThresholds(micSensitivity).bargeInEnergyThreshold,
    bargeInMinFrames: (agentCfg["bargeInMinFrames"] as number | undefined) ?? 4,
    bargeInEchoGraceMs: (agentCfg["bargeInEchoGraceMs"] as number | undefined) ?? 600,
    micSensitivity,
    timezone: (agentCfg["timezone"] as string | undefined) ?? "Asia/Kolkata",
    recordingEnabled: (agentCfg["recordingEnabled"] as boolean | undefined) ?? false,
    genderDetectionEnabled: false,
    genderDetectionMaleSalutation: "Sir",
    genderDetectionFemaleSalutation: "Ma'am",
    genderDetectionNeutralSalutation: "",
    voiceMemoryEnabled: false,
    wordsForInterruption: (agentCfg["wordsForInterruption"] as number | undefined) ?? 3,
    incrementalDelay: (agentCfg["incrementalDelay"] as number | undefined) ?? 0,
    hangupAfterLlmCall: false,
    startSpeakingPlan: {
      waitSeconds: 0,
      onPunctuationSeconds: 0.1,
      onNoPunctuationSeconds: 1.5,
      onNumberSeconds: 0.5,
    },
    stopSpeakingPlan: null,
    compliance: null,
    contextWindowTurns: agent.contextWindowTurns ?? null,
    tokenSummarizationEnabled: agent.tokenSummarizationEnabled ?? false,
    tokenSummarizationThresholdTurns: agent.tokenSummarizationThresholdTurns ?? null,
    stagedPromptEnabled: agent.stagedPromptEnabled ?? false,
    stagedPromptStages: (agent.stagedPromptStages as Array<{ name: string; content: string }> | null) ?? [],
    stagedPromptCoreIdentity: agent.stagedPromptCoreIdentity ?? null,
    asrEndpointingSilenceMs: (agentCfg["asrEndpointingSilenceMs"] as number | undefined) ?? 250,
    llmMaxTokens: (agentCfg["llmMaxTokens"] as number | null | undefined) ?? null,
    ttsMinSentenceChars: (agentCfg["ttsMinSentenceChars"] as number | undefined) ?? 18,
    sarvamSttMode: (agent.asrProvider ?? "").toLowerCase() === "sarvam"
      ? resolveSarvamSttMode(
          effectiveAgentLang,
          (agentCfg["sarvamSttMode"] as string | undefined) ?? null,
        )
      : ((agentCfg["sarvamSttMode"] as string | undefined) ?? null),
    kbBakedOnly: (agentCfg["kbBakedOnly"] as boolean | undefined) ?? false,
    voiceStack,
    geminiLive: voiceStack === "gemini_live"
      ? {
          model: (typeof (agentCfg["geminiLive"] as Record<string, unknown> | undefined)?.["model"] === "string"
            && ((agentCfg["geminiLive"] as Record<string, unknown>)["model"] as string).trim())
            ? ((agentCfg["geminiLive"] as Record<string, unknown>)["model"] as string)
            : DEFAULT_GEMINI_LIVE_MODEL,
          voiceName: resolveGeminiLiveVoice(
            (agentCfg["geminiLive"] as Record<string, unknown> | undefined)?.["voiceName"] as string | undefined,
          ),
          thinkingLevel: resolveGeminiLiveThinkingLevel(
            (agentCfg["geminiLive"] as Record<string, unknown> | undefined)?.["thinkingLevel"] as string | undefined,
          ),
        }
      : null,
    visionEnabled: agentCfg["visionEnabled"] === true,
    visionLiveEnabled: agentCfg["visionLiveEnabled"] === true,
  };
  agentConfig.sttConfig.endpointingSilenceMs = agentConfig.asrEndpointingSilenceMs;

  const providerKeys = await loadProviderKeysMap(agent.userId);
  return { agentConfig, providerKeys };
}

export type HandoffSessionHooks = {
  callId: number;
  telephonyProvider: SessionTransport;
  callerPhone: string | null;
  campaignLeadId: number | null;
  onAudioOut: (audio: Buffer) => void;
  onCallEnd: () => void;
  onBargeIn?: () => void;
  onTranscript?: (speaker: "user" | "agent", text: string) => void;
  rawPcmOutput?: boolean;
  callDirection: "inbound" | "outbound";
};

/**
 * Swap the active VoiceSession to the target squad member.
 * Returns the new pipeline on success, or null if handoff was refused.
 */
export async function performSquadAgentHandoff(opts: {
  squadId: number;
  runId: number;
  fromAgentId: number;
  toAgentId: number;
  reason: string;
  goal: string;
  transcriptSummary: string;
  language?: string | null;
  squad: Squad;
  hooks: HandoffSessionHooks;
  previousPipeline: VoiceSession;
}): Promise<{ pipeline: VoiceSession; toMemberId: number } | null> {
  const validated = await validateSquadHandoff({
    squadId: opts.squadId,
    fromAgentId: opts.fromAgentId,
    toAgentId: opts.toAgentId,
  });
  if (!validated.ok) {
    logger.warn({ err: validated.error, runId: opts.runId }, "Squad handoff refused");
    await recordSquadHandoff({
      runId: opts.runId,
      packet: {
        fromMemberId: 0,
        toMemberId: 0,
        fromAgentId: opts.fromAgentId,
        toAgentId: opts.toAgentId,
        reason: opts.reason,
        goal: opts.goal,
        transcriptSummary: opts.transcriptSummary,
      },
      outcome: "failed",
      error: validated.error,
    });
    return null;
  }

  const packet: HandoffPacket = {
    fromMemberId: validated.from.id,
    toMemberId: validated.to.id,
    fromAgentId: opts.fromAgentId,
    toAgentId: opts.toAgentId,
    reason: opts.reason,
    goal: opts.goal,
    transcriptSummary: opts.transcriptSummary,
    language: opts.language,
  };

  const built = await buildTargetAgentConfig(opts.toAgentId, packet);
  if (!built) {
    await recordSquadHandoff({ runId: opts.runId, packet, outcome: "failed", error: "Target agent missing" });
    return null;
  }

  try {
    opts.previousPipeline.close();
  } catch (err) {
    logger.warn({ err, callId: opts.hooks.callId }, "Error closing previous pipeline before handoff");
  }

  const { agentConfig, providerKeys } = built;
  const hooks = opts.hooks;

  let newPipeline: VoiceSession;
  try {
    newPipeline = agentConfig.voiceStack === "gemini_live"
      ? new GeminiLivePipeline({
          callId: hooks.callId,
          agentConfig,
          providerKeys,
          telephonyProvider: hooks.telephonyProvider,
          callerPhone: hooks.callerPhone,
          campaignLeadId: hooks.campaignLeadId,
          onAudioOut: hooks.onAudioOut,
          rawPcmOutput: hooks.rawPcmOutput ?? (hooks.telephonyProvider === "vobiz"),
          onTranscript: (speaker, text) => hooks.onTranscript?.(speaker, text),
          onCallEnd: hooks.onCallEnd,
          onBargeIn: hooks.onBargeIn,
          callDirection: hooks.callDirection,
        })
      : new OrchestrationPipeline({
          callId: hooks.callId,
          agentConfig,
          providerKeys,
          telephonyProvider: hooks.telephonyProvider,
          callerPhone: hooks.callerPhone,
          campaignLeadId: hooks.campaignLeadId,
          onAudioOut: hooks.onAudioOut,
          rawPcmOutput: hooks.rawPcmOutput ?? (hooks.telephonyProvider === "vobiz"),
          onTranscript: (speaker, text) => hooks.onTranscript?.(speaker, text),
          onCallEnd: hooks.onCallEnd,
          onBargeIn: hooks.onBargeIn,
          callDirection: hooks.callDirection,
        });
  } catch (err) {
    logger.error({ err, callId: hooks.callId }, "Failed to create handoff pipeline");
    await recordSquadHandoff({
      runId: opts.runId,
      packet,
      outcome: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const greeting =
    (opts.squad.handoffGreeting && opts.squad.handoffGreeting.trim()) ||
    "Hi — I've been briefed on your conversation so far. How can I help?";

  try {
    await newPipeline.speakRaw(greeting);
  } catch (err) {
    logger.warn({ err, callId: hooks.callId }, "Handoff greeting speakRaw failed");
  }

  await recordSquadHandoff({ runId: opts.runId, packet, outcome: "success" });
  logger.info(
    { callId: hooks.callId, from: opts.fromAgentId, to: opts.toAgentId, runId: opts.runId },
    "Squad live handoff completed",
  );
  return { pipeline: newPipeline, toMemberId: validated.to.id };
}
