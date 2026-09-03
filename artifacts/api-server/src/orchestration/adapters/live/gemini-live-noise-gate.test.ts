import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "../../types.js";
import * as audioPool from "../../audioPool.js";

const sendRealtimeInput = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {},
  callRecordingsTable: {},
}));

vi.mock("../../../services/tool-executor.js", () => ({
  buildToolDefs: vi.fn(() => []),
}));

vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  class GoogleGenAI {
    live = {
      connect: vi.fn().mockResolvedValue({
        on: vi.fn(),
        sendRealtimeInput,
        sendClientContent: vi.fn(),
        close: vi.fn(),
      }),
    };
  }
  return { ...actual, GoogleGenAI };
});

import { GeminiLivePipeline } from "./gemini-live-pipeline.js";

const FRAME_SAMPLES = 160; // 20 ms @ 8 kHz
let nextCallId = 1000;

function frame(peak: number, freqHz = 500): Buffer {
  const buf = Buffer.allocUnsafe(FRAME_SAMPLES * 2);
  for (let i = 0; i < FRAME_SAMPLES; i++) {
    const s = Math.round(peak * Math.sin((2 * Math.PI * freqHz * i) / 8000));
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, s)), i * 2);
  }
  return buf;
}

function agentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 1,
    systemPrompt: "You are a helpful assistant.",
    greetingMessage: "Hello!",
    firstSpeaker: "agent",
    voiceStack: "gemini_live",
    geminiLive: { voiceName: "Kore", thinkingLevel: "minimal" },
    tools: [],
    noiseCancellationEnabled: true,
    forceSoftwareNoiseGate: false,
    ...overrides,
  } as AgentConfig;
}

function makePipeline(agent: AgentConfig, telephonyProvider = "vobiz") {
  return new GeminiLivePipeline({
    callId: nextCallId++,
    agentConfig: agent,
    providerKeys: new Map([["google", "test-key"]]),
    telephonyProvider: telephonyProvider as "vobiz",
    onAudioOut: vi.fn(),
    onTranscript: vi.fn(),
    onCallEnd: vi.fn(),
    rawPcmOutput: true,
  } as never);
}

async function feed(pipeline: GeminiLivePipeline, frames: Buffer[]): Promise<Buffer> {
  for (const f of frames) pipeline.onRawPcm8kIn(f);
  await pipeline.flushCallerAudio();
  const last = sendRealtimeInput.mock.calls.at(-1)?.[0] as { audio?: { data?: string } } | undefined;
  if (!last?.audio?.data) return Buffer.alloc(0);
  return Buffer.from(last.audio.data, "base64");
}

describe("Gemini Live caller-audio noise gate", () => {
  beforeEach(() => {
    sendRealtimeInput.mockClear();
  });

  it("does not run the isolator when the gate is bypassed (webcall)", async () => {
    const spy = vi.spyOn(audioPool, "processRawPcm8kIn");
    const pipeline = makePipeline(agentConfig(), "webcall");
    pipeline.onRawPcm8kIn(frame(4000));
    await pipeline.flushCallerAudio();
    expect(spy).not.toHaveBeenCalled();
    pipeline.close();
    spy.mockRestore();
  });

  it("does not run the isolator when the agent toggle is off", async () => {
    const spy = vi.spyOn(audioPool, "processRawPcm8kIn");
    const pipeline = makePipeline(
      agentConfig({ noiseCancellationEnabled: false, forceSoftwareNoiseGate: true }),
    );
    pipeline.onRawPcm8kIn(frame(4000));
    await pipeline.flushCallerAudio();
    expect(spy).not.toHaveBeenCalled();
    pipeline.close();
    spy.mockRestore();
  });

  it("keeps isolation on while the agent is speaking", async () => {
    const spy = vi.spyOn(audioPool, "processRawPcm8kIn");
    const pipeline = makePipeline(agentConfig({ noiseCancellationEnabled: true }));
    (pipeline as unknown as { isPlayingOut: boolean }).isPlayingOut = true;
    pipeline.onRawPcm8kIn(frame(4000));
    await pipeline.flushCallerAudio();
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0]?.[2]).toBe(true);
    pipeline.close();
    spy.mockRestore();
  });

  it("runs the energy gate on VoBiz when the Noise Cancellation toggle is on", async () => {
    const spy = vi.spyOn(audioPool, "processRawPcm8kIn");
    const pipeline = makePipeline(agentConfig({ noiseCancellationEnabled: true }));
    pipeline.onRawPcm8kIn(frame(4000));
    await pipeline.flushCallerAudio();
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0]?.[2]).toBe(true);
    pipeline.close();
    spy.mockRestore();
  });

  it("keeps the recording anchored to the raw caller audio, not the isolated copy", async () => {
    const pipeline = makePipeline(agentConfig({ noiseCancellationEnabled: true }));
    const tap = vi.fn();
    (pipeline as unknown as { config: { callerAudioTap: unknown } }).config.callerAudioTap = tap;
    const input = frame(4000);
    pipeline.onRawPcm8kIn(input);
    await pipeline.flushCallerAudio();
    expect((tap.mock.calls[0]![0] as Buffer).equals(input)).toBe(true);
    pipeline.close();
  });
});
