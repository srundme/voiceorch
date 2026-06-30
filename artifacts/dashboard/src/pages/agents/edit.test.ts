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
  noiseCancellationEnabled: false,
  promptVariables: [],
  vadSilenceMs: 350,
  bargeInEnabled: true,
  bargeInEnergyThreshold: 1200,
  bargeInMinFrames: 4,
  tools: [],
};

describe("buildUpdateAgentPayload", () => {
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
    expect(result.data.llmProvider).toBe("google");
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

  it("mismatched ASR provider+model — reports error on asrModel", () => {
    const result = agentFormSchema.safeParse({
      ...VALID_BASE,
      asrProvider: "azure",
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

  it("assemblyai with valid model — passes", () => {
    const result = agentFormSchema.safeParse({
      ...VALID_BASE,
      asrProvider: "assemblyai",
      asrModel: "best",
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it("assemblyai with invalid model — fails", () => {
    const result = agentFormSchema.safeParse({
      ...VALID_BASE,
      asrProvider: "assemblyai",
      asrModel: "en-US-standard",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map(i => i.path.join("."));
    expect(paths).toContain("asrModel");
  });

  it("sarvam LLM with valid model — passes", () => {
    const result = agentFormSchema.safeParse({
      ...VALID_BASE,
      llmProvider: "sarvam",
      llmModel: "sarvam-30b",
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
      asrProvider: "azure",
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
