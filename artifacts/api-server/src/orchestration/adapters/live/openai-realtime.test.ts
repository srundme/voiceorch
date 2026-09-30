import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "../../types.js";

vi.mock("@workspace/db", () => ({
  db: {},
  callRecordingsTable: {},
}));

vi.mock("../../../services/tool-executor.js", () => ({
  buildToolDefs: vi.fn(() => []),
}));

import { resolveVoiceStack } from "./gemini-live-voices.js";
import {
  DEFAULT_OPENAI_REALTIME_MODEL,
  DEFAULT_OPENAI_REALTIME_VOICE,
  resolveOpenAIRealtimeModel,
  resolveOpenAIRealtimeVoice,
} from "./openai-realtime-voices.js";
import { toOpenAIRealtimeTools } from "./openai-realtime-tools.js";
import { OpenAIRealtimePipeline, toRealtimeHandoffItems } from "./openai-realtime-pipeline.js";

function agentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    systemPrompt: "You are a helpful assistant.",
    greetingMessage: "Hello!",
    firstSpeaker: "agent",
    voiceStack: "openai_realtime",
    geminiLive: null,
    openaiRealtime: { model: "gpt-realtime", voiceName: "cedar" },
    sttConfig: { language: "en-IN" },
    tools: [],
    ...overrides,
  } as AgentConfig;
}

function sessionConfig(agent: AgentConfig, keys: Array<[string, string]> = [["openai", "sk-test"]]) {
  return {
    callId: 1,
    agentConfig: agent,
    providerKeys: new Map(keys),
    telephonyProvider: "webcall" as const,
    onAudioOut: vi.fn(),
    onTranscript: vi.fn(),
    onCallEnd: vi.fn(),
    rawPcmOutput: true,
  };
}

describe("OpenAI Realtime voice stack", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolveVoiceStack opts into openai_realtime explicitly", () => {
    expect(resolveVoiceStack("openai_realtime")).toBe("openai_realtime");
    expect(resolveVoiceStack("gemini_live")).toBe("gemini_live");
    expect(resolveVoiceStack("openai")).toBe("classic");
  });

  it("pins the model to gpt-realtime and falls back to the default voice", () => {
    expect(resolveOpenAIRealtimeModel("gpt-4o-realtime-preview")).toBe(DEFAULT_OPENAI_REALTIME_MODEL);
    expect(resolveOpenAIRealtimeVoice("cedar")).toBe("cedar");
    expect(resolveOpenAIRealtimeVoice("Kore")).toBe(DEFAULT_OPENAI_REALTIME_VOICE);
    expect(resolveOpenAIRealtimeVoice(undefined)).toBe(DEFAULT_OPENAI_REALTIME_VOICE);
  });

  it("requires an OpenAI key", () => {
    expect(() => new OpenAIRealtimePipeline(sessionConfig(agentConfig(), [["google", "g"]])))
      .toThrow(/OpenAI API key/);
  });

  it("builds a session without connecting until audio or greet", () => {
    const pipeline = new OpenAIRealtimePipeline(sessionConfig(agentConfig()));
    expect(pipeline.getTranscript()).toBe("");
    expect(pipeline.getUsageTotals()).toEqual({ llmInputTokens: 0, llmOutputTokens: 0 });
    expect(() => pipeline.noteMediaDropIfWaitingForReply()).not.toThrow();
    pipeline.close();
  });

  it("feeds the VoBiz bridge while the model is silent, and stops on close", () => {
    vi.useFakeTimers();
    const onAudioOut = vi.fn();
    const pipeline = new OpenAIRealtimePipeline({
      ...sessionConfig(agentConfig()),
      telephonyProvider: "vobiz",
      onAudioOut,
    });
    vi.advanceTimersByTime(1000);
    expect(onAudioOut).toHaveBeenCalled();
    expect((onAudioOut.mock.calls[0]![0] as Buffer).length).toBe(320);
    pipeline.close();
    onAudioOut.mockClear();
    vi.advanceTimersByTime(1000);
    expect(onAudioOut).not.toHaveBeenCalled();
  });
});

describe("toOpenAIRealtimeTools", () => {
  it("emits flat function tools and fills missing array items", () => {
    const tools = toOpenAIRealtimeTools([{
      name: "lookup",
      description: "Look something up",
      parameters: {
        type: "object",
        properties: { tags: { type: "array" }, q: { type: "string", description: "query" } },
        required: ["q"],
      },
    }]);
    expect(tools).toEqual([{
      type: "function",
      name: "lookup",
      description: "Look something up",
      parameters: {
        type: "object",
        properties: {
          tags: { type: "array", items: { type: "string" } },
          q: { type: "string", description: "query" },
        },
        required: ["q"],
      },
    }]);
  });
});

describe("toRealtimeHandoffItems", () => {
  it("maps prior turns into user/assistant conversation items", () => {
    expect(toRealtimeHandoffItems([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "   " },
    ])).toEqual([
      { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "hello" }] },
    ]);
  });
});
