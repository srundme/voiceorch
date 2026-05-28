import { describe, it, expect } from "vitest";
import { UpdateAgentBody } from "@workspace/api-zod";
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
  greetingMessage: "Hello! How can I help you today?",
  endCallPhrases: "goodbye, bye",
  silenceTimeoutSeconds: 30,
  language: "en-US",
  backchannelingEnabled: false,
  backchannelingFrequency: 0.5,
  webhookUrl: "",
  webhookSecret: "",
  noiseCancellationEnabled: false,
  promptVariables: [],
  vadSilenceMs: 250,
  bargeInEnabled: true,
  bargeInEnergyThreshold: 1200,
  bargeInMinFrames: 4,
  tools: [],
  dispositionSchema: [],
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
      llmProvider: "google",
      llmModel: "gemini-2.5-flash",
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

  it("disposition schema with choice options — CSV is split into array", () => {
    const data: AgentFormValues = {
      ...BASE,
      dispositionSchema: [
        {
          key: "outcome",
          label: "Call Outcome",
          type: "choice",
          required: true,
          options: "Interested, Not Interested, Follow Up",
        },
        {
          key: "satisfied",
          label: "Satisfied",
          type: "boolean",
          required: false,
          options: "",
        },
      ],
    };
    const payload = buildUpdateAgentPayload(data);
    const result = UpdateAgentBody.safeParse(payload);
    expect(result.success, JSON.stringify(result)).toBe(true);
    if (!result.success) return;
    const outcome = result.data.dispositionSchema?.[0];
    expect(outcome?.options).toEqual(["Interested", "Not Interested", "Follow Up"]);
    const satisfied = result.data.dispositionSchema?.[1];
    expect(satisfied?.options).toBeUndefined();
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

  it("default vadSilenceMs=250 — not included in agentConfig", () => {
    const data: AgentFormValues = { ...BASE, vadSilenceMs: 250 };
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
