import { describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "./types.js";
import { resolveVoiceStack } from "./adapters/live/gemini-live-voices.js";

vi.mock("@workspace/db", () => ({
  db: {},
  callRecordingsTable: {},
}));

vi.mock("../services/tool-executor.js", () => ({
  buildToolDefs: vi.fn(() => []),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    live: {
      connect: vi.fn().mockResolvedValue({
        on: vi.fn(),
        sendRealtimeInput: vi.fn(),
        sendClientContent: vi.fn(),
        close: vi.fn(),
      }),
    },
  })),
  Modality: { AUDIO: "AUDIO" },
  ThinkingLevel: { MINIMAL: "MINIMAL", LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" },
}));

import { GeminiLivePipeline } from "./adapters/live/gemini-live-pipeline.js";

function minimalAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    systemPrompt: "You are a helpful assistant.",
    greetingMessage: "Hello!",
    firstSpeaker: "agent",
    voiceStack: "gemini_live",
    geminiLive: { voiceName: "Kore", thinkingLevel: "minimal" },
    tools: [],
    ...overrides,
  } as AgentConfig;
}

function minimalSessionConfig(agentConfig: AgentConfig) {
  return {
    callId: 1,
    agentConfig,
    providerKeys: new Map([["google", "test-key"]]),
    telephonyProvider: "webcall" as const,
    onAudioOut: vi.fn(),
    onTranscript: vi.fn(),
    onCallEnd: vi.fn(),
    rawPcmOutput: true,
  };
}

describe("session voice stack routing", () => {
  it("resolveVoiceStack only opts into gemini_live explicitly", () => {
    expect(resolveVoiceStack(undefined)).toBe("classic");
    expect(resolveVoiceStack("classic")).toBe("classic");
    expect(resolveVoiceStack("gemini_live")).toBe("gemini_live");
    expect(resolveVoiceStack("other")).toBe("classic");
  });

  it("selects GeminiLivePipeline class when voiceStack is gemini_live", () => {
    const agentConfig = minimalAgentConfig({ voiceStack: "gemini_live" });
    const useLive = resolveVoiceStack(agentConfig.voiceStack) === "gemini_live";
    const pipeline = useLive
      ? new GeminiLivePipeline(minimalSessionConfig(agentConfig))
      : null;
    expect(pipeline).toBeInstanceOf(GeminiLivePipeline);
  });

  it("GeminiLivePipeline implements VoiceSession telephony hooks as no-ops", () => {
    const pipeline = new GeminiLivePipeline(
      minimalSessionConfig(minimalAgentConfig()),
    );
    expect(() => pipeline.noteMediaDropIfWaitingForReply()).not.toThrow();
    expect(() => pipeline.onExternalAmdSignal("machine", "test")).not.toThrow();
    expect(typeof pipeline.greet).toBe("function");
    expect(typeof pipeline.onRawPcm8kIn).toBe("function");
    expect(typeof pipeline.getTranscript).toBe("function");
  });

  it("GeminiLivePipeline requires a Google API key", () => {
    expect(() =>
      new GeminiLivePipeline({
        ...minimalSessionConfig(minimalAgentConfig()),
        providerKeys: new Map(),
      }),
    ).toThrow(/Google API key/i);
  });
});
