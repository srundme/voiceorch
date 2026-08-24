import { describe, it, expect } from "vitest";
import { UpdateAgentBody } from "@workspace/api-zod";
import { agentFormSchema } from "./edit.schema";
import { buildUpdateAgentPayload } from "./edit";
import type { AgentFormValues } from "./edit";

const BASE: AgentFormValues = {
  name: "Support Bot",
  description: "Handles inbound support calls",
  asrProvider: "azure",
  asrModel: "en-US-standard",
  llmProvider: "openai",
  llmModel: "gpt-4o-mini",
  ttsProvider: "elevenlabs",
  ttsVoice: "",
  ttsModel: "",
  telephonyProvider: "twilio",
  systemPrompt: "You are a helpful support agent.",
  temperature: 0.7,
  maxDuration: 600,
  firstSpeaker: "assistant",
  endCallPhrases: "goodbye, bye",
  silenceTimeoutSeconds: 30,
  language: "en-US",
  backchannelingEnabled: false,
  backchannelingFrequency: 0.5,
  webhookUrl: "",
  webhookSecret: "",
  webhookPayloadTemplate: "",
  noiseCancellationEnabled: false,
  promptVariables: [],
  vadSilenceMs: 350,
  bargeInEnabled: true,
  bargeInEnergyThreshold: 1200,
  bargeInMinFrames: 4,
  tools: [],
};

describe("buildUpdateAgentPayload", () => {
  it("gemini live settings — placed in agentConfig when Live model selected", () => {
    const data: AgentFormValues = {
      ...BASE,
      llmProvider: "google",
      llmModel: "gemini-3.1-flash-live-preview",
      voiceStack: "gemini_live",
      geminiLiveVoiceName: "Puck",
      geminiLiveThinkingLevel: "low",
    };
    const payload = buildUpdateAgentPayload(data);
    const cfg = payload.agentConfig as Record<string, unknown>;
    expect(cfg["voiceStack"]).toBe("gemini_live");
    expect(cfg["geminiLive"]).toEqual({
      voiceName: "Puck",
      thinkingLevel: "low",
    });
  });

  it("gemini live via voice stack — payload still carries google + live model", () => {
    const data: AgentFormValues = {
      ...BASE,
      llmProvider: "google",
      llmModel: "gemini-3.1-flash-live-preview",
      voiceStack: "gemini_live",
    };
    const payload = buildUpdateAgentPayload(data);
    expect(payload.llmProvider).toBe("google");
    expect(payload.llmModel).toBe("gemini-3.1-flash-live-preview");
    expect((payload.agentConfig as Record<string, unknown>)["voiceStack"]).toBe("gemini_live");
  });

  it("minimal update — parses against UpdateAgentBody", () => {
    const payload = buildUpdateAgentPayload(BASE);
    const result = UpdateAgentBody.safeParse(payload);
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it("partial update — only name and systemPrompt changed — still valid", () => {
    const data: AgentFormValues = {
      ...BASE,
      name: "Renamed Bot",
      systemPrompt: "Updated prompt text.",
    };
    const payload = buildUpdateAgentPayload(data);
    const result = UpdateAgentBody.safeParse(payload);
    expect(result.success, JSON.stringify(result)).toBe(true);
    if (!result.success) return;
    expect(result.data.name).toBe("Renamed Bot");
    expect(result.data.systemPrompt).toBe("Updated prompt text.");
  });

  it("toggling providers — changing ASR, LLM and TTS — parses correctly", () => {
    const data: AgentFormValues = {
      ...BASE,
      asrProvider: "assemblyai",
      asrModel: "best",
      llmProvider: "qwen",
      llmModel: "qwen/qwen3-32b",
      ttsProvider: "cartesia",
      ttsModel: "sonic-3.5",
    };
    const payload = buildUpdateAgentPayload(data);
    const result = UpdateAgentBody.safeParse(payload);
    expect(result.success, JSON.stringify(result)).toBe(true);
    if (!result.success) return;
    expect(result.data.asrProvider).toBe("assemblyai");
    expect(result.data.llmProvider).toBe("qwen");
    expect(result.data.ttsProvider).toBe("cartesia");
  });

  it.skip("disposition schema with choice options — placeholder until feature is completed", () => {
    // dispositionSchema field not yet in agentFormSchema; test preserved for re-enabling
  });

  it("call transfer tool — present in payload and passes validation", () => {
    const data: AgentFormValues = {
      ...BASE,
      tools: [
        {
          type: "call_transfer",
          name: "transfer_to_human",
          description: "Transfer the caller to a human agent",
          transferTo: "+12125551234",
          warmHandoffMessage: "Let me connect you now.",
        },
      ],
    };
    const payload = buildUpdateAgentPayload(data);
    const result = UpdateAgentBody.safeParse(payload);
    expect(result.success, JSON.stringify(result)).toBe(true);
    if (!result.success) return;
    expect(result.data.tools).toHaveLength(1);
    expect(result.data.tools![0].type).toBe("call_transfer");
    expect(result.data.tools![0].transferTo).toBe("+12125551234");
  });

  it("webhook secret — placed in agentConfig, not at top-level", () => {
    const data: AgentFormValues = {
      ...BASE,
      webhookUrl: "https://example.com/hook",
      webhookSecret: "s3cr3t",
    };
    const payload = buildUpdateAgentPayload(data);
    const result = UpdateAgentBody.safeParse(payload);
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect((payload as any).webhookSecret).toBeUndefined();
    expect((payload.agentConfig as any)?.webhookSecret).toBe("s3cr3t");
  });

  it("webhook payload template — stored in agentConfig; blank clears with null", () => {
    const withTpl = buildUpdateAgentPayload({
      ...BASE,
      webhookPayloadTemplate: ' { "id": "{{callId}}" } ',
    });
    expect(UpdateAgentBody.safeParse(withTpl).success).toBe(true);
    expect((withTpl as any).webhookPayloadTemplate).toBeUndefined();
    expect((withTpl.agentConfig as any)?.webhookPayloadTemplate).toBe('{ "id": "{{callId}}" }');

    const cleared = buildUpdateAgentPayload({ ...BASE, webhookPayloadTemplate: "   " });
    expect((cleared.agentConfig as any)?.webhookPayloadTemplate).toBeNull();
  });

  it("non-default vadSilenceMs — appears in agentConfig", () => {
    const data: AgentFormValues = { ...BASE, vadSilenceMs: 500 };
    const payload = buildUpdateAgentPayload(data);
    const result = UpdateAgentBody.safeParse(payload);
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect((payload.agentConfig as any)?.vadSilenceMs).toBe(500);
  });

  it("default vadSilenceMs=350 — not included in agentConfig", () => {
    const data: AgentFormValues = { ...BASE, vadSilenceMs: 350 };
    const payload = buildUpdateAgentPayload(data);
    expect((payload.agentConfig as any)?.vadSilenceMs).toBeUndefined();
  });

  it("bargeIn disabled — recorded in agentConfig", () => {
    const data: AgentFormValues = { ...BASE, bargeInEnabled: false };
    const payload = buildUpdateAgentPayload(data);
    const result = UpdateAgentBody.safeParse(payload);
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect((payload.agentConfig as any)?.bargeInEnabled).toBe(false);
  });

  it("bargeIn enabled (default) — not included in agentConfig", () => {
    const data: AgentFormValues = { ...BASE, bargeInEnabled: true };
    const payload = buildUpdateAgentPayload(data);
    expect((payload.agentConfig as any)?.bargeInEnabled).toBeUndefined();
  });

  it("prompt variables — placed in agentConfig when present", () => {
    const data: AgentFormValues = {
      ...BASE,
      promptVariables: [
        { key: "company_name", defaultValue: "Acme", description: "Company name" },
      ],
    };
    const payload = buildUpdateAgentPayload(data);
    const result = UpdateAgentBody.safeParse(payload);
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect((payload.agentConfig as any)?.promptVariables).toHaveLength(1);
    expect((payload as any).promptVariables).toBeUndefined();
  });

  it("empty prompt variables — not included in agentConfig", () => {
    const data: AgentFormValues = { ...BASE, promptVariables: [] };
    const payload = buildUpdateAgentPayload(data);
    expect((payload.agentConfig as any)?.promptVariables).toBeUndefined();
  });

  it("Call Engine save path — clamps energy, derives voiceSeconds, writes wordsForInterruption", () => {
    // Mirrors builder Engine presets + safe floors (legacy energy 200 / voice 0.06 must not ship).
    const data: AgentFormValues = {
      ...BASE,
      maxDuration: 480,
      asrEndpointingSilenceMs: 150,
      ttsMinSentenceChars: 30,
      linearDelayMs: 50,
      llmMaxTokens: 160,
      startSpeakingWaitSecs: 0,
      startSpeakingOnPunctuationSecs: 0.1,
      startSpeakingOnNoPunctuationSecs: 0.1,
      startSpeakingOnNumberSecs: 0,
      bargeInEnabled: true,
      stopSpeakingNumWords: 1,
      stopSpeakingVoiceSecs: 0.2,
      stopSpeakingBackOffSecs: 1,
      bargeInEnergyThreshold: 800,
      autoRedialEnabled: true,
      autoRedialMaxAttempts: 3,
      silenceTimeoutSeconds: 30,
    };
    const schemaResult = agentFormSchema.safeParse(data);
    expect(schemaResult.success, JSON.stringify(schemaResult)).toBe(true);

    const payload = buildUpdateAgentPayload(data);
    const result = UpdateAgentBody.safeParse(payload);
    expect(result.success, JSON.stringify(result)).toBe(true);

    expect((payload as any).maxDuration).toBe(480);
    const cfg = payload.agentConfig as any;
    expect(cfg?.asrEndpointingSilenceMs).toBe(150);
    expect(cfg?.ttsMinSentenceChars).toBe(30);
    expect(cfg?.incrementalDelay).toBe(50);
    expect(cfg?.llmMaxTokens).toBe(160);
    expect(cfg?.bargeInEnergyThreshold).toBe(800);
    expect(cfg?.wordsForInterruption).toBe(1);
    expect(cfg?.startSpeakingPlan).toEqual({
      waitSeconds: 0,
      onPunctuationSeconds: 0.1,
      onNoPunctuationSeconds: 0.1,
      onNumberSeconds: 0,
    });
    expect(cfg?.stopSpeakingPlan).toEqual({ numWords: 1, voiceSeconds: 0.2, backOffSeconds: 1 });
    expect(cfg?.autoRedial).toEqual({ enabled: true, maxAttempts: 3 });
  });

  it("legacy energy below telephony floor is clamped on save", () => {
    const payload = buildUpdateAgentPayload({
      ...BASE,
      bargeInEnergyThreshold: 200 as any,
      stopSpeakingNumWords: 0 as any,
      stopSpeakingVoiceSecs: 0.06 as any,
    });
    const cfg = payload.agentConfig as any;
    expect(cfg?.bargeInEnergyThreshold).toBe(800);
    expect(cfg?.wordsForInterruption).toBe(3);
    expect(cfg?.stopSpeakingPlan).toEqual({ numWords: 3, voiceSeconds: 0.45, backOffSeconds: 1 });
  });

  it("rejects energy below 800 in the form schema", () => {
    const result = agentFormSchema.safeParse({ ...BASE, bargeInEnergyThreshold: 200 });
    expect(result.success).toBe(false);
  });
});

describe("agentFormSchema — provider/model cross-field validation", () => {
  const VALID_BASE = {
    name: "Test Bot",
    asrProvider: "azure",
    asrModel: "en-US-standard",
    llmProvider: "openai",
    llmModel: "gpt-4o-mini",
    ttsProvider: "cartesia",
    ttsModel: "sonic-3.5",
    ttsVoice: "",
    telephonyProvider: "twilio",
    systemPrompt: "You are a helpful assistant.",
  };

  it("valid provider/model combinations — passes schema", () => {
    const result = agentFormSchema.safeParse(VALID_BASE);
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it("default SnapServe stack (Sarvam STT + TTS) — passes schema", () => {
    const result = agentFormSchema.safeParse({
      ...VALID_BASE,
      asrProvider: "sarvam",
      asrModel: "saaras:v3",
      ttsProvider: "sarvam",
      ttsModel: "bulbul:v3",
      ttsVoice: "priya",
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it("persists Sarvam stream_type fast by default", () => {
    const payload = buildUpdateAgentPayload({
      ...VALID_BASE,
      asrProvider: "sarvam",
      asrModel: "saaras:v3",
      ttsProvider: "sarvam",
      ttsModel: "bulbul:v3",
      ttsVoice: "priya",
    } as AgentFormValues);
    expect((payload.agentConfig as any)?.sarvamSttStreamType).toBe("fast");
  });

  it("persists Sarvam realtime VAD connect params", () => {
    const payload = buildUpdateAgentPayload({
      ...VALID_BASE,
      asrProvider: "sarvam",
      asrModel: "saaras:v3",
      ttsProvider: "sarvam",
      ttsModel: "bulbul:v3",
      ttsVoice: "priya",
      sarvamEndOfSpeechSilenceMs: 300,
      sarvamFirstTurnMinSpeechMs: 200,
      sarvamVadThreshold: 0.35,
    } as AgentFormValues);
    const cfg = payload.agentConfig as any;
    expect(cfg.sarvamEndOfSpeechSilenceMs).toBe(300);
    expect(cfg.sarvamFirstTurnMinSpeechMs).toBe(200);
    expect(cfg.sarvamVadThreshold).toBe(0.35);
  });

  it("defaults Sarvam realtime VAD to 300 / 250 / 0.3 when unset", () => {
    const payload = buildUpdateAgentPayload({
      ...VALID_BASE,
      asrProvider: "sarvam",
      asrModel: "saaras:v3",
      ttsProvider: "sarvam",
      ttsModel: "bulbul:v3",
      ttsVoice: "priya",
    } as AgentFormValues);
    const cfg = payload.agentConfig as any;
    expect(cfg.sarvamEndOfSpeechSilenceMs).toBe(300);
    expect(cfg.sarvamFirstTurnMinSpeechMs).toBe(250);
    expect(cfg.sarvamVadThreshold).toBe(0.3);
  });

  it("mismatched ASR provider+model — reports error on asrModel", () => {
    const result = agentFormSchema.safeParse({
      ...VALID_BASE,
      asrProvider: "sarvam",
      asrModel: "nova-2-general",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map(i => i.path.join("."));
    expect(paths).toContain("asrModel");
  });

  it("mismatched LLM provider+model — reports error on llmModel", () => {
    const result = agentFormSchema.safeParse({
      ...VALID_BASE,
      llmProvider: "openai",
      llmModel: "qwen/qwen3-32b",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map(i => i.path.join("."));
    expect(paths).toContain("llmModel");
  });

  it("mismatched TTS provider+model — reports error on ttsModel", () => {
    const result = agentFormSchema.safeParse({
      ...VALID_BASE,
      ttsProvider: "cartesia",
      ttsModel: "sarvam-voice",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map(i => i.path.join("."));
    expect(paths).toContain("ttsModel");
  });

  it("provider with no predefined model list (elevenlabs) — any model string is accepted", () => {
    const result = agentFormSchema.safeParse({
      ...VALID_BASE,
      ttsProvider: "elevenlabs",
      ttsModel: "some-custom-voice-id",
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it("empty model field — not treated as a mismatch (falls back to runtime default)", () => {
    const result = agentFormSchema.safeParse({
      ...VALID_BASE,
      asrModel: "",
      llmModel: "",
      ttsModel: "",
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it("sarvam ASR with valid model — passes", () => {
    const result = agentFormSchema.safeParse({
      ...VALID_BASE,
      asrProvider: "sarvam",
      asrModel: "saaras:v3",
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it("sarvam ASR with invalid model — fails", () => {
    const result = agentFormSchema.safeParse({
      ...VALID_BASE,
      asrProvider: "sarvam",
      asrModel: "en-US-standard",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map(i => i.path.join("."));
    expect(paths).toContain("asrModel");
  });

  it("ASR provider with no predefined model list (assemblyai) — any model accepted", () => {
    const result = agentFormSchema.safeParse({
      ...VALID_BASE,
      asrProvider: "assemblyai",
      asrModel: "en-US-standard",
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it("sarvam LLM with valid model — passes", () => {
    const result = agentFormSchema.safeParse({
      ...VALID_BASE,
      llmProvider: "sarvam",
      llmModel: "sarvam-105b",
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it("sarvam LLM with mismatched model — fails", () => {
    const result = agentFormSchema.safeParse({
      ...VALID_BASE,
      llmProvider: "sarvam",
      llmModel: "gpt-4o",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map(i => i.path.join("."));
    expect(paths).toContain("llmModel");
  });

  it("multiple mismatches — all three field errors reported at once", () => {
    const result = agentFormSchema.safeParse({
      ...VALID_BASE,
      asrProvider: "sarvam",
      asrModel: "nova-2-general",
      llmProvider: "openai",
      llmModel: "qwen/qwen3-32b",
      ttsProvider: "cartesia",
      ttsModel: "unknown-model",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map(i => i.path.join("."));
    expect(paths).toContain("asrModel");
    expect(paths).toContain("llmModel");
    expect(paths).toContain("ttsModel");
  });
});

describe("Sarvam realtime builder catalog", () => {
  it("language picker is the 23-code table without auto or en-US", async () => {
    const { SARVAM_STT_LANGUAGES, languagesForAgent } = await import("@/lib/agent-providers");
    expect(SARVAM_STT_LANGUAGES).toHaveLength(23);
    expect(SARVAM_STT_LANGUAGES.map((l) => l.value)).toContain("or-IN");
    expect(SARVAM_STT_LANGUAGES.map((l) => l.value)).toContain("doi-IN");
    expect(SARVAM_STT_LANGUAGES.map((l) => l.value)).not.toContain("en-US");
    expect(SARVAM_STT_LANGUAGES.map((l) => l.value)).not.toContain("auto");
    expect(languagesForAgent(false)).toEqual(SARVAM_STT_LANGUAGES);
  });

  it("Saaras models are realtime; Saarika is legacy", async () => {
    const { isSarvamRealtimeAsr } = await import("@/lib/agent-providers");
    expect(isSarvamRealtimeAsr("saaras:v3")).toBe(true);
    expect(isSarvamRealtimeAsr("saaras:v3-realtime")).toBe(true);
    expect(isSarvamRealtimeAsr("saarika:v2.5")).toBe(false);
  });

  it("hydrates unset VAD from Fast / Patient endpointing", async () => {
    const { hydrateSarvamRealtimeVad } = await import("./edit.schema");
    expect(hydrateSarvamRealtimeVad({ asrEndpointingSilenceMs: 150 }).silence).toBe(300);
    expect(hydrateSarvamRealtimeVad({ asrEndpointingSilenceMs: 500 }).silence).toBe(700);
    expect(hydrateSarvamRealtimeVad({ asrEndpointingSilenceMs: 250 }).silence).toBe(400);
    expect(hydrateSarvamRealtimeVad({ sarvamEndOfSpeechSilenceMs: 400, asrEndpointingSilenceMs: 150 }).silence).toBe(400);
  });

  it("product ASR picker is only Saaras v3", async () => {
    const { asrModelsForPicker, SARVAM_PRODUCT_ASR_MODEL } = await import("@/lib/agent-providers");
    expect(asrModelsForPicker("sarvam").map((m) => m.value)).toEqual([SARVAM_PRODUCT_ASR_MODEL]);
    expect(asrModelsForPicker("sarvam", "saarika:v2.5").map((m) => m.value)).toEqual([
      SARVAM_PRODUCT_ASR_MODEL,
      "saarika:v2.5",
    ]);
  });
});
