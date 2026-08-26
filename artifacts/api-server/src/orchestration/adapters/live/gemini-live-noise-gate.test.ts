import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "../../types.js";
import { upsample8to16 } from "../../audio.js";

const sendRealtimeInput = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {},
  callRecordingsTable: {},
}));

vi.mock("../../../services/tool-executor.js", () => ({
  buildToolDefs: vi.fn(() => []),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    live: {
      connect: vi.fn().mockResolvedValue({
        on: vi.fn(),
        sendRealtimeInput,
        sendClientContent: vi.fn(),
        close: vi.fn(),
      }),
    },
  })),
  Modality: { AUDIO: "AUDIO" },
  ThinkingLevel: { MINIMAL: "MINIMAL", LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" },
}));

import { GeminiLivePipeline } from "./gemini-live-pipeline.js";

const FRAME_SAMPLES = 160; // 20 ms @ 8 kHz
const CALIB_FRAMES = 25;   // NoiseCanceller calibration window

function frame(peak: number, freqHz = 500): Buffer {
  const buf = Buffer.allocUnsafe(FRAME_SAMPLES * 2);
  for (let i = 0; i < FRAME_SAMPLES; i++) {
    const s = Math.round(peak * Math.sin((2 * Math.PI * freqHz * i) / 8000));
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, s)), i * 2);
  }
  return buf;
}

function rmsOf(buf: Buffer): number {
  let sum = 0;
  const n = buf.length / 2;
  for (let i = 0; i < n; i++) {
    const s = buf.readInt16LE(i * 2) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / n);
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
    callId: 1,
    agentConfig: agent,
    providerKeys: new Map([["google", "test-key"]]),
    telephonyProvider: telephonyProvider as "vobiz",
    onAudioOut: vi.fn(),
    onTranscript: vi.fn(),
    onCallEnd: vi.fn(),
    rawPcmOutput: true,
  } as never);
}

/** Feed frames, then return the base64 audio Gemini received for the last one. */
async function feed(
  pipeline: GeminiLivePipeline,
  frames: Buffer[],
): Promise<Buffer> {
  for (const f of frames) {
    pipeline.onRawPcm8kIn(f);
    // onRawPcm8kIn sends inside a promise chain (ensureConnected).
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
  const last = sendRealtimeInput.mock.calls.at(-1)?.[0] as { audio: { data: string } };
  return Buffer.from(last.audio.data, "base64");
}

describe("Gemini Live caller-audio noise gate", () => {
  beforeEach(() => {
    sendRealtimeInput.mockClear();
  });

  it("sends caller audio untouched when the gate is bypassed (webcall)", async () => {
    const pipeline = makePipeline(agentConfig(), "webcall");
    const input = frame(4000);
    const sent = await feed(pipeline, [input]);
    expect(sent.equals(upsample8to16(input))).toBe(true);
    pipeline.close();
  });

  it("sends caller audio untouched when the agent toggle is off", async () => {
    const pipeline = makePipeline(
      agentConfig({ noiseCancellationEnabled: false, forceSoftwareNoiseGate: true }),
    );
    const input = frame(4000);
    const sent = await feed(pipeline, [input]);
    expect(sent.equals(upsample8to16(input))).toBe(true);
    pipeline.close();
  });

  it("denoises caller audio on VoBiz when the Noise Cancellation toggle is on", async () => {
    const pipeline = makePipeline(agentConfig({ noiseCancellationEnabled: true }));
    const input = frame(4000);
    const sent = await feed(pipeline, [input]);
    // The gate's bandpass stage runs from the first frame, so the audio Gemini
    // receives can no longer be the raw upsample.
    expect(sent.equals(upsample8to16(input))).toBe(false);
    pipeline.close();
  });

  it("attenuates background noise once the gate has calibrated", async () => {
    const ambient = frame(200);
    const gated = makePipeline(agentConfig({ noiseCancellationEnabled: true }));
    const sentGated = await feed(gated, [
      ...Array.from({ length: CALIB_FRAMES }, () => ambient),
      ambient,
    ]);
    gated.close();

    sendRealtimeInput.mockClear();
    const open = makePipeline(agentConfig({ noiseCancellationEnabled: false }));
    const sentRaw = await feed(open, [
      ...Array.from({ length: CALIB_FRAMES }, () => ambient),
      ambient,
    ]);
    open.close();

    expect(rmsOf(sentGated)).toBeLessThan(rmsOf(sentRaw) * 0.5);
  });

  it("keeps the recording anchored to the raw caller audio, not the gated copy", async () => {
    const pipeline = makePipeline(agentConfig({ noiseCancellationEnabled: true }));
    const tap = vi.fn();
    (pipeline as unknown as { config: { callerAudioTap: unknown } }).config.callerAudioTap = tap;
    const input = frame(4000);
    await feed(pipeline, [input]);
    expect((tap.mock.calls[0]![0] as Buffer).equals(input)).toBe(true);
    pipeline.close();
  });
});
