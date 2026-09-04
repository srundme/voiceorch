/**
 * Mid-call AI→AI warm handoff for Agent Squads.
 * Keeps the carrier/webcall media transport open; swaps only the VoiceSession pipeline.
 */

import { db, agentsTable, providersTable, platformSettingsTable, type Squad, spokenSquadHandoffMessage, spokenSquadHandoffGreeting } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { decryptKey } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";
import { OrchestrationPipeline } from "../orchestration/pipeline.js";
import { GeminiLivePipeline } from "../orchestration/adapters/live/gemini-live-pipeline.js";
import {
  resolveGeminiLiveModel,
  resolveGeminiLiveThinkingLevel,
  resolveGeminiLiveVoice,
  resolveVoiceStack,
} from "../orchestration/adapters/live/gemini-live-voices.js";
import { resolveSarvamSttMode } from "../orchestration/adapters/stt/sarvam-mode.js";
import { resolveRealtimeStreamType } from "../orchestration/adapters/stt/sarvam-realtime.js";
import {
  clampSarvamIncompleteHoldMs,
  clampSarvamSpeechEndFlushMs,
  resolveSarvamHighVadSensitivity,
  normalizeCallEngineAgentConfig,
  FRAGMENT_COALESCE_DEFAULTS,
  resolveStartSpeakingPlan,
  resolveTtsMinSentenceChars,
} from "@workspace/db/call-engine-defaults";
import { resolveMicSensitivity, resolveBargeInEnergyThreshold } from "../orchestration/mic-sensitivity.js";
import { FORCE_SOFTWARE_NOISE_GATE_KEY } from "../orchestration/noise-gate.js";
import { optionalMs, optionalUnitInterval } from "../orchestration/stt-tuning.js";
import { clampSemanticTurnStopMs, resolveSemanticTurnEnabled } from "../orchestration/semantic-turn-gate.js";
import { getAttachedSourceIds } from "../orchestration/kb-retrieval.js";
import type { AgentConfig, AgentTool, SessionTransport } from "../orchestration/types.js";
import type { VoiceSession } from "../orchestration/voice-session.js";
import { appendGuardrails } from "./guardrails.js";
import {
  validateSquadHandoff,
  recordSquadHandoff,
  type HandoffPacket,
} from "./squad-engine.js";
import {
  loadSquadTeam,
  buildSquadTools,
  buildSquadPromptBlock,
  buildSharedCallerFactsBlock,
} from "./squad-teamwork.js";
import { languageDisplayName, mapLanguagePrefToBcp47 } from "../orchestration/call-direction-rules.js";

const DEFAULT_SILENCE_TIMEOUT_SECONDS = 45;

/** Live caller language from agent 1 — STT/TTS/prompt for agent 2. */
export function resolveSquadHandoffLanguage(
  packetLang: string | null | undefined,
  agentLang: string,
): { bcp47: string; label: string; fromCaller: boolean } {
  const mapped = mapLanguagePrefToBcp47(packetLang);
  if (mapped) {
    return { bcp47: mapped, label: languageDisplayName(mapped), fromCaller: true };
  }
  return { bcp47: agentLang, label: languageDisplayName(agentLang), fromCaller: false };
}

export function buildHandoffPromptBlock(packet: HandoffPacket): string {
  const lang = packet.language?.trim()
    ? resolveSquadHandoffLanguage(packet.language, packet.language)
    : null;
  return [
    "[SQUAD HANDOFF — CONFIDENTIAL CONTEXT]",
    "You are taking over this live call from a teammate. The customer is still on the line.",
    "Do NOT restart a cold greeting as if this were a new call. Acknowledge continuity briefly.",
    `Reason for handoff: ${packet.reason}`,
    `Squad goal: ${packet.goal}`,
    `Prior conversation summary:\n${packet.transcriptSummary || "(none)"}`,
    lang
      ? `Caller language preference: ${lang.label} (${lang.bcp47}).\nYou MUST continue this live call in ${lang.label}. This overrides any other language rule in your prompt. The caller already chose this language with your teammate. Do not greet or reply in a different language and do not ask which language they want unless they switch.`
      : null,
    packet.durableFacts && Object.keys(packet.durableFacts).length
      ? `Known facts: ${JSON.stringify(packet.durableFacts)}`
      : null,
    "Continue helping the customer from here.",
  ].filter(Boolean).join("\n");
}

export async function loadProviderKeysMap(userId: string | null): Promise<Map<string, string>> {
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
    if (providerKeys.has(name) || settingKey === "managed_gemini_key") continue;
    const [row] = await db.select().from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, settingKey)).limit(1);
    if (row?.value) providerKeys.set(name, row.value);
  }
  if (!providerKeys.has("google") || !providerKeys.has("gemini")) {
    const { pickManagedGeminiKey } = await import("../lib/gemini-key-pool.js");
    const geminiKey = await pickManagedGeminiKey();
    if (geminiKey) {
      if (!providerKeys.has("google")) providerKeys.set("google", geminiKey);
      if (!providerKeys.has("gemini")) providerKeys.set("gemini", geminiKey);
    }
  }
  return providerKeys;
}

async function buildTargetAgentConfig(
  agentId: number,
  packet: HandoffPacket,
  squadId: number,
  callerPhone: string | null,
): Promise<{ agentConfig: AgentConfig; providerKeys: Map<string, string> } | null> {
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId)).limit(1);
  if (!agent) return null;

  const agentCfg = normalizeCallEngineAgentConfig(
    (agent.agentConfig ?? {}) as Record<string, unknown>,
  ).config;
  let tools = Array.isArray(agent.tools) ? (agent.tools as unknown as AgentTool[]) : [];
  const endCallPhrases = agent.endCallPhrases
    ? agent.endCallPhrases.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  let systemPrompt = agent.generatedPrompt ?? agent.systemPrompt ?? "";
  systemPrompt = appendGuardrails(systemPrompt, agent.name);
  systemPrompt = `${systemPrompt}\n\n${buildHandoffPromptBlock(packet)}`;

  // The receiving agent is squad-aware too: it can hand the call back or
  // onward, schedule follow-ups, and sees what teammates know about the caller.
  try {
    const team = await loadSquadTeam(squadId, agentId);
    if (team && team.teammates.length > 0) {
      const injected = buildSquadTools(team, tools);
      if (injected.length > 0) tools = [...tools, ...injected];
      const sharedFacts = await buildSharedCallerFactsBlock(team, callerPhone, agentId);
      const blocks = [buildSquadPromptBlock(team), sharedFacts].filter(Boolean).join("\n\n");
      if (blocks) systemPrompt = `${systemPrompt}\n\n${blocks}`;
    }
  } catch (err) {
    logger.warn({ err, agentId, squadId }, "Squad teamwork injection failed for handoff target");
  }

  const configuredLang =
    (typeof agentCfg["language"] === "string" && (agentCfg["language"] as string)) ||
    agent.asrLanguage ||
    agent.language ||
    "en-IN";
  const handoffLang = resolveSquadHandoffLanguage(packet.language, configuredLang);
  const effectiveAgentLang = handoffLang.bcp47;

  const voiceStack = resolveVoiceStack(agentCfg["voiceStack"] as string | undefined);
  const micSensitivity = resolveMicSensitivity(agentCfg["micSensitivity"] as string | undefined);

  const isSarvamLlm = (agent.llmProvider ?? "").toLowerCase() === "sarvam";
  const agentConfig: AgentConfig = {
    id: agent.id,
    name: agent.name,
    systemPrompt,
    temperature: agent.temperature ?? 0.5,
    // Same semantics as session.ts: default ON unless explicitly disabled.
    sarvamIndicNumbers: agentCfg["sarvamIndicNumbers"] !== false,
    llmGenerationParams: {
      ...(typeof agent.temperature === "number" ? { temperature: agent.temperature } : {}),
      // Same resolution semantics as session.ts: explicit null = voice default;
      // legacy "maxTokens" honored only when the new key is absent — keeps the
      // cap identical across a mid-call squad handoff for legacy-config agents.
      maxTokens: (() => {
        const v = "llmMaxTokens" in agentCfg ? agentCfg["llmMaxTokens"] : agentCfg["maxTokens"];
        if (typeof v === "number" && v > 0) return v;
        return isSarvamLlm ? 500 : 200;
      })(),
      presencePenalty: 0.3,
      frequencyPenalty: 0.3,
      ...(agentCfg["reasoningEffort"] === "medium" || agentCfg["reasoningEffort"] === "high"
        ? { reasoningEffort: agentCfg["reasoningEffort"] as "medium" | "high" }
        : isSarvamLlm
          ? { reasoningEffort: null }
          : {}),
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
    // Teammate continues the live call — do not generate a cold English opener.
    firstSpeaker: "user",
    initialLanguage: handoffLang.fromCaller ? handoffLang.bcp47 : undefined,
    endCallPhrases,
    silenceTimeoutSeconds: agent.silenceTimeoutSeconds ?? DEFAULT_SILENCE_TIMEOUT_SECONDS,
    language: effectiveAgentLang,
    languageAutoDetect: agentCfg["languageMode"] === "multilingual" || agentCfg["languageAutoDetect"] === true,
    autoSwitchToEnglish: agentCfg["autoSwitchToEnglish"] === true,
    backchannelingEnabled: agent.backchannelingEnabled !== false,
    backchannelingFrequency: agent.backchannelingFrequency ?? null,
    webhookUrl: agent.webhookUrl ?? null,
    noiseCancellationEnabled: agent.noiseCancellationEnabled !== false,
    forceSoftwareNoiseGate: agentCfg[FORCE_SOFTWARE_NOISE_GATE_KEY] === true,
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
      endOfTurnTimeout: (() => {
        const fromUi = agentCfg["asrEndpointingSilenceMs"];
        if (typeof fromUi === "number" && Number.isFinite(fromUi) && fromUi > 0) {
          return Math.max(50, Math.min(5000, Math.round(fromUi)));
        }
        if (typeof agent.asrEndOfTurnTimeout === "number" && agent.asrEndOfTurnTimeout > 0) {
          return Math.max(50, Math.min(30000, Math.round(agent.asrEndOfTurnTimeout)));
        }
        return 400;
      })(),
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
    bargeInEnergyThreshold: resolveBargeInEnergyThreshold(agentCfg["bargeInEnergyThreshold"]),
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
    wordsForInterruption: (() => {
      const v = agentCfg["wordsForInterruption"];
      if (typeof v !== "number" || !Number.isFinite(v)) return 3;
      const n = Math.max(0, Math.round(v));
      return n === 2 ? 3 : n;
    })(),
    incrementalDelay: 0,
    hangupAfterLlmCall: false,
    startSpeakingPlan: resolveStartSpeakingPlan(
      agentCfg["startSpeakingPlan"] as AgentConfig["startSpeakingPlan"] | undefined,
    ),
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
    ttsMinSentenceChars: resolveTtsMinSentenceChars(
      agentCfg["ttsMinSentenceChars"] as number | undefined,
    ),
    fragmentCoalesceListeningMs: (() => {
      const v = agentCfg["fragmentCoalesceListeningMs"];
      if (typeof v !== "number" || !Number.isFinite(v)) return FRAGMENT_COALESCE_DEFAULTS.listeningMs;
      return Math.max(0, Math.min(2000, Math.round(v)));
    })(),
    fragmentCoalescePlayingMs: (() => {
      const v = agentCfg["fragmentCoalescePlayingMs"];
      if (typeof v !== "number" || !Number.isFinite(v)) return FRAGMENT_COALESCE_DEFAULTS.playingMs;
      return Math.max(0, Math.min(3000, Math.round(v)));
    })(),
    telephonyTailDrainMs: (() => {
      const v = agentCfg["telephonyTailDrainMs"];
      if (typeof v !== "number" || !Number.isFinite(v)) return 0;
      const ms = Math.max(0, Math.min(2000, Math.round(v)));
      return ms === 400 || ms === 80 ? 0 : ms;
    })(),
    sarvamSttMode: (agent.asrProvider ?? "").toLowerCase() === "sarvam"
      ? resolveSarvamSttMode(
          effectiveAgentLang,
          (agentCfg["sarvamSttMode"] as string | undefined) ?? null,
        )
      : ((agentCfg["sarvamSttMode"] as string | undefined) ?? null),
    sarvamSttStreamType: resolveRealtimeStreamType(agentCfg["sarvamSttStreamType"]),
    sarvamSttPrompt: typeof agentCfg["sarvamSttPrompt"] === "string"
      ? (agentCfg["sarvamSttPrompt"] as string)
      : null,
    sarvamHighVadSensitivity: resolveSarvamHighVadSensitivity(agentCfg["sarvamHighVadSensitivity"]),
    sarvamSpeechEndFlushMs: clampSarvamSpeechEndFlushMs(agentCfg["sarvamSpeechEndFlushMs"] as number | undefined),
    sarvamIncompleteHoldMs: clampSarvamIncompleteHoldMs(agentCfg["sarvamIncompleteHoldMs"] as number | undefined),
    // Wall-clock VAD windows; the adapter converts them to frames at the live
    // sample rate. Null means "leave the provider default alone".
    sarvamFirstTurnMinSpeechMs: optionalMs(agentCfg["sarvamFirstTurnMinSpeechMs"]),
    sarvamEndOfSpeechSilenceMs: (() => {
      const v = optionalMs(agentCfg["sarvamEndOfSpeechSilenceMs"]);
      return v === 300 || v === 500 ? null : v;
    })(),
    sarvamVadThreshold: optionalUnitInterval(agentCfg["sarvamVadThreshold"]),
    semanticTurnDetection: (agent.asrProvider ?? "").toLowerCase() === "sarvam"
      ? false
      : resolveSemanticTurnEnabled(agentCfg["semanticTurnDetection"]),
    semanticTurnStopMs: clampSemanticTurnStopMs(agentCfg["semanticTurnStopMs"]),
    kbBakedOnly: (agentCfg["kbBakedOnly"] as boolean | undefined) ?? false,
    voiceStack,
    geminiLive: voiceStack === "gemini_live"
      ? {
          model: resolveGeminiLiveModel(
            (agentCfg["geminiLive"] as Record<string, unknown> | undefined)?.["model"] as string | undefined,
          ),
          voiceName: resolveGeminiLiveVoice(
            (agentCfg["geminiLive"] as Record<string, unknown> | undefined)?.["voiceName"] as string | undefined,
          ),
          thinkingLevel: resolveGeminiLiveThinkingLevel(
            (agentCfg["geminiLive"] as Record<string, unknown> | undefined)?.["thinkingLevel"] as string | undefined,
          ),
        }
      : null,
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
  rawPcmOutputRate?: 8000 | 16000;
  callDirection: "inbound" | "outbound";
  /** Squad-shared memory owner — keeps voiceprints/memory on ONE record across handoffs. */
  memoryOwnerAgentId?: number;
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
  durableFacts?: Record<string, unknown>;
  squad: Squad;
  hooks: HandoffSessionHooks;
  previousPipeline: VoiceSession;
}): Promise<{ pipeline: VoiceSession; toMemberId: number; previousPipeline: VoiceSession } | null> {
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
    durableFacts: opts.durableFacts,
  };

  const built = await buildTargetAgentConfig(opts.toAgentId, packet, opts.squadId, opts.hooks.callerPhone);
  if (!built) {
    await recordSquadHandoff({ runId: opts.runId, packet, outcome: "failed", error: "Target agent missing" });
    return null;
  }

  // Finish any in-flight TTS on the departing agent. Speak a custom
  // announcement only — stock / empty stay silent so we do not inject
  // a second hardcoded voice before the teammate continues.
  const announcement = spokenSquadHandoffMessage(opts.squad.handoffMessage);
  try {
    await opts.previousPipeline.finishSpeakingForMaxDuration(2_500);
  } catch (err) {
    logger.warn({ err, callId: opts.hooks.callId }, "Handoff: finishSpeaking before announcement failed");
  }
  if (announcement) {
    try {
      await opts.previousPipeline.speakRaw(announcement);
    } catch (err) {
      logger.warn({ err, callId: opts.hooks.callId }, "Handoff announcement speakRaw failed");
    }
  }

  // Build the new pipeline WHILE the previous one is still alive.
  // Closing first used to leave the call dead if construction failed, and
  // dropped inbound audio during the gap before session swapped pointers.
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
          rawPcmOutputRate: hooks.rawPcmOutputRate,
          onTranscript: (speaker, text) => hooks.onTranscript?.(speaker, text),
          onCallEnd: hooks.onCallEnd,
          onBargeIn: hooks.onBargeIn,
          callDirection: hooks.callDirection,
          memoryOwnerAgentId: hooks.memoryOwnerAgentId,
          callerMemoryLanguage: packet.language ?? null,
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
          rawPcmOutputRate: hooks.rawPcmOutputRate,
          onTranscript: (speaker, text) => hooks.onTranscript?.(speaker, text),
          onCallEnd: hooks.onCallEnd,
          onBargeIn: hooks.onBargeIn,
          callDirection: hooks.callDirection,
          memoryOwnerAgentId: hooks.memoryOwnerAgentId,
          callerMemoryLanguage: packet.language ?? null,
        });
  } catch (err) {
    logger.error({ err, callId: hooks.callId }, "Failed to create handoff pipeline — keeping previous agent");
    await recordSquadHandoff({
      runId: opts.runId,
      packet,
      outcome: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const greeting = spokenSquadHandoffGreeting(opts.squad.handoffGreeting);

  // Custom greeting only. Stock copy used to be spoken on a freshly built
  // pipeline (often Gemini Live default "Kore") — a second robotic voice.
  if (greeting) {
    await new Promise((r) => setTimeout(r, 650));
    try {
      await newPipeline.speakRaw(greeting);
    } catch (err) {
      logger.warn({ err, callId: hooks.callId }, "Handoff greeting speakRaw failed");
    }
  }

  await recordSquadHandoff({ runId: opts.runId, packet, outcome: "success" });
  logger.info(
    {
      callId: hooks.callId,
      from: opts.fromAgentId,
      to: opts.toAgentId,
      runId: opts.runId,
      handoffLanguage: packet.language ?? null,
      teammateLanguage: agentConfig.language,
    },
    "Squad live handoff completed",
  );
  // Caller (session) must: live.pipeline = result.pipeline, THEN close the old one.
  return { pipeline: newPipeline, toMemberId: validated.to.id, previousPipeline: opts.previousPipeline };
}
