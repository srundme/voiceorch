import { describe, it, expect } from "vitest";
import { CreateAgentBody } from "@workspace/api-zod";
import { buildCreateAgentPayload } from "./create-agent-wizard";
import { getModelError, ASR_MODELS, LLM_MODELS, TTS_MODELS } from "@/lib/agent-providers";

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

  it("managed stack models are always valid — no provider/model mismatch in managed mode", () => {
    const englishPayload = buildCreateAgentPayload(BASE_MANAGED) as any;
    expect(getModelError(englishPayload.asrProvider, englishPayload.asrModel, ASR_MODELS)).toBeNull();
    expect(getModelError(englishPayload.llmProvider, englishPayload.llmModel, LLM_MODELS)).toBeNull();
  });

  it("managed stack for Indic — sarvam+gemini combination is valid", () => {
    const state = { ...BASE_MANAGED, additionalLanguages: ["hindi"] };
    const payload = buildCreateAgentPayload(state) as any;
    expect(getModelError(payload.asrProvider, payload.asrModel, ASR_MODELS)).toBeNull();
    expect(getModelError(payload.llmProvider, payload.llmModel, LLM_MODELS)).toBeNull();
  });
});

describe("getModelError — provider/model validation utility", () => {
  it("returns null for a valid ASR provider+model pair", () => {
    expect(getModelError("azure", "en-US-standard", ASR_MODELS)).toBeNull();
    expect(getModelError("assemblyai", "best", ASR_MODELS)).toBeNull();
    expect(getModelError("sarvam", "saarika:v2.5", ASR_MODELS)).toBeNull();
    expect(getModelError("cartesia", "sonic-english", ASR_MODELS)).toBeNull();
  });

  it("returns an error string for a mismatched ASR provider+model", () => {
    expect(getModelError("azure", "nova-2-general", ASR_MODELS)).not.toBeNull();
    expect(getModelError("assemblyai", "en-US-standard", ASR_MODELS)).not.toBeNull();
    expect(getModelError("sarvam", "gpt-4o", ASR_MODELS)).not.toBeNull();
  });

  it("returns null for a valid LLM provider+model pair", () => {
    expect(getModelError("openai", "gpt-4o", LLM_MODELS)).toBeNull();
    expect(getModelError("google", "gemini-2.5-flash", LLM_MODELS)).toBeNull();
    expect(getModelError("groq", "llama-3.3-70b-versatile", LLM_MODELS)).toBeNull();
    expect(getModelError("sarvam", "sarvam-m", LLM_MODELS)).toBeNull();
  });

  it("returns an error string for a mismatched LLM provider+model", () => {
    expect(getModelError("openai", "gemini-2.5-flash", LLM_MODELS)).not.toBeNull();
    expect(getModelError("google", "gpt-4o", LLM_MODELS)).not.toBeNull();
    expect(getModelError("sarvam", "llama-3.3-70b-versatile", LLM_MODELS)).not.toBeNull();
  });

  it("returns null for a valid TTS provider+model pair", () => {
    expect(getModelError("cartesia", "sonic-3.5", TTS_MODELS)).toBeNull();
    expect(getModelError("cartesia", "sonic-turbo", TTS_MODELS)).toBeNull();
  });

  it("returns an error string for a mismatched TTS provider+model", () => {
    expect(getModelError("cartesia", "sarvam-voice", TTS_MODELS)).not.toBeNull();
    expect(getModelError("cartesia", "nova-2", TTS_MODELS)).not.toBeNull();
  });

  it("returns null when provider has no known model list (e.g. elevenlabs)", () => {
    expect(getModelError("elevenlabs", "any-voice-id", TTS_MODELS)).toBeNull();
  });

  it("returns null when model is undefined or empty", () => {
    expect(getModelError("azure", undefined, ASR_MODELS)).toBeNull();
    expect(getModelError("openai", "", LLM_MODELS)).toBeNull();
    expect(getModelError("cartesia", undefined, TTS_MODELS)).toBeNull();
  });

  it("returns null for an unknown provider (not in catalogue)", () => {
    expect(getModelError("deepgram", "nova-2-general", ASR_MODELS)).toBeNull();
    expect(getModelError("cohere", "command-r-plus", LLM_MODELS)).toBeNull();
  });
});
