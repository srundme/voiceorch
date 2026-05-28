import { describe, it, expect } from "vitest";
import { CreateAgentBody } from "@workspace/api-zod";
import { buildCreateAgentPayload } from "./create-agent-wizard";

const BASE_MANAGED = {
  mode: "managed" as const,
  useCase: "appointment_booking",
  useCaseRole: "appointment booking specialist",
  useCaseService: "patient appointment booking",
  isMultilingual: false,
  primaryLanguage: "english",
  additionalLanguages: [] as string[],
  agentName: "Aria",
  companyName: "Acme Health",
  agentDirection: "inbound" as const,
  callFlowDescription: "Greet and book appointments",
  generatedPrompt: "",
  kbContent: "",
  kbFileName: "",
  voices: [],
  selectedVoiceId: "2ee87190-8f84-4925-97da-e52547f9462c",
  callTransferEnabled: false,
  callTransferNumber: "",
  byopAsr: "deepgram",
  byopLlm: "openai",
  byopTts: "elevenlabs",
  byopTelephony: "twilio",
  byopPrompt: "You are a helpful AI voice assistant.",
  leadSource: { enabled: false, type: "instagram" as const, token: "", fields: ["name", "email", "message"] },
  productDetails: "",
};

const BASE_BYOP = {
  ...BASE_MANAGED,
  mode: "byop" as const,
};

describe("buildCreateAgentPayload", () => {
  it("managed English-only — parses against CreateAgentBody", () => {
    const payload = buildCreateAgentPayload(BASE_MANAGED);
    const result = CreateAgentBody.safeParse(payload);
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it("managed multilingual with Tamil — picks sarvam ASR, parses against CreateAgentBody", () => {
    const state = {
      ...BASE_MANAGED,
      isMultilingual: true,
      additionalLanguages: ["tamil"],
    };
    const payload = buildCreateAgentPayload(state);
    const result = CreateAgentBody.safeParse(payload);
    expect(result.success, JSON.stringify(result)).toBe(true);
    if (!result.success) return;
    expect(result.data.asrProvider).toBe("sarvam");
    expect(result.data.llmProvider).toBe("google");
  });

  it("BYOP mode — parses against CreateAgentBody", () => {
    const payload = buildCreateAgentPayload(BASE_BYOP);
    const result = CreateAgentBody.safeParse(payload);
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it("managed with call transfer enabled — tool appears in payload and parses", () => {
    const state = {
      ...BASE_MANAGED,
      callTransferEnabled: true,
      callTransferNumber: "+12125551234",
    };
    const payload = buildCreateAgentPayload(state);
    const result = CreateAgentBody.safeParse(payload);
    expect(result.success, JSON.stringify(result)).toBe(true);
    if (!result.success) return;
    expect(result.data.tools).toHaveLength(1);
    expect(result.data.tools![0].type).toBe("call_transfer");
    expect(result.data.tools![0].transferTo).toBe("+12125551234");
  });

  it("managed with call transfer enabled but empty number — no tool added", () => {
    const state = {
      ...BASE_MANAGED,
      callTransferEnabled: true,
      callTransferNumber: "   ",
    };
    const payload = buildCreateAgentPayload(state);
    const result = CreateAgentBody.safeParse(payload);
    expect(result.success, JSON.stringify(result)).toBe(true);
    if (!result.success) return;
    expect(result.data.tools).toHaveLength(0);
  });

  it("managed with generatedPrompt takes precedence over callFlowDescription", () => {
    const state = {
      ...BASE_MANAGED,
      callFlowDescription: "Fallback flow",
      generatedPrompt: "AI-generated prompt",
    };
    const payload = buildCreateAgentPayload(state);
    const result = CreateAgentBody.safeParse(payload);
    expect(result.success, JSON.stringify(result)).toBe(true);
    if (!result.success) return;
    expect(result.data.systemPrompt).toBe("AI-generated prompt");
  });
});
