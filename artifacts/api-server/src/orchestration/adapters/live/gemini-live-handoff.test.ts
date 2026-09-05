import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig, ConversationTurn } from "../../types.js";
import { toLiveHandoffTurns } from "./gemini-live-pipeline.js";

const sendRealtimeInput = vi.fn();
const sendClientContent = vi.fn();
const sendToolResponse = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {},
  callRecordingsTable: {},
}));

vi.mock("../../../services/tool-executor.js", () => ({
  buildToolDefs: vi.fn(() => []),
}));

vi.mock("../../../services/execution-log.js", () => ({
  EXEC_COMPONENTS: { LLM: "LLM", TTS: "TTS", STT: "STT" },
  createExecutionLogger: () => () => {},
}));

vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  class GoogleGenAI {
    live = {
      connect: vi.fn().mockResolvedValue({
        on: vi.fn(),
        sendRealtimeInput,
        sendClientContent,
        sendToolResponse,
        close: vi.fn(),
      }),
    };
  }
  return { ...actual, GoogleGenAI };
});

import { GeminiLivePipeline } from "./gemini-live-pipeline.js";

function agentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 2,
    systemPrompt: "You are the specialist.",
    greetingMessage: null,
    firstSpeaker: "assistant",
    voiceStack: "gemini_live",
    geminiLive: { voiceName: "Kore", thinkingLevel: "minimal" },
    tools: [],
    ...overrides,
  } as AgentConfig;
}

function makePipeline(overrides: {
  greetingMessage?: string | null;
  firstSpeaker?: "assistant" | "user";
  isSquadHandoffTakeover?: boolean;
  handoffSeedTurns?: ConversationTurn[];
} = {}) {
  return new GeminiLivePipeline({
    callId: 22001,
    agentConfig: agentConfig({
      greetingMessage: overrides.greetingMessage ?? null,
      firstSpeaker: overrides.firstSpeaker ?? "assistant",
    }),
    providerKeys: new Map([["google", "test-key"]]),
    telephonyProvider: "vobiz",
    onAudioOut: vi.fn(),
    onTranscript: vi.fn(),
    onCallEnd: vi.fn(),
    rawPcmOutput: true,
    isSquadHandoffTakeover: overrides.isSquadHandoffTakeover,
    handoffSeedTurns: overrides.handoffSeedTurns,
  } as never);
}

describe("toLiveHandoffTurns", () => {
  it("keeps the last user/assistant lines as Gemini user/model turns", () => {
    expect(toLiveHandoffTurns([
      { role: "user", content: "I need a cardiologist" },
      { role: "assistant", content: "I'll connect you to booking." },
      { role: "tool", content: "ignored" },
    ])).toEqual([
      { role: "user", parts: [{ text: "I need a cardiologist" }] },
      { role: "model", parts: [{ text: "I'll connect you to booking." }] },
    ]);
  });
});

describe("Gemini Live squad handoff takeover", () => {
  beforeEach(() => {
    sendRealtimeInput.mockClear();
    sendClientContent.mockClear();
    sendToolResponse.mockClear();
  });

  it("seeds prior turns and forces turnComplete instead of a text-only VAD wait", async () => {
    const pipeline = makePipeline({
      isSquadHandoffTakeover: true,
      handoffSeedTurns: [
        { role: "user", content: "Book a slot tomorrow" },
        { role: "assistant", content: "Connecting you to Priya." },
      ],
    });
    await pipeline.greet();
    expect(sendClientContent).toHaveBeenCalled();
    const payload = sendClientContent.mock.calls[0]![0] as {
      turnComplete?: boolean;
      turns: Array<{ role: string; parts: Array<{ text: string }> }>;
    };
    expect(payload.turnComplete).toBe(true);
    expect(payload.turns[0]).toEqual({
      role: "user",
      parts: [{ text: "Book a slot tomorrow" }],
    });
    expect(payload.turns.at(-1)?.parts[0]?.text).toMatch(/took over this live call/);
    expect(sendRealtimeInput).not.toHaveBeenCalled();
    pipeline.close();
  });

  it("does not stay silent when firstSpeaker is user on a takeover", async () => {
    const pipeline = makePipeline({
      firstSpeaker: "user",
      isSquadHandoffTakeover: true,
    });
    await pipeline.greet();
    expect(sendClientContent).toHaveBeenCalled();
    pipeline.close();
  });
});
