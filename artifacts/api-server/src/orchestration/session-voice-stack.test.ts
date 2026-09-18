import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "./types.js";
import { resolveVoiceStack } from "./adapters/live/gemini-live-voices.js";
import {
  buildPersonaplexTextPrompt,
  resolvePersonaplexVoice,
  resolveSessionVoiceStack,
} from "./adapters/live/personaplex-voices.js";

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
import { PersonaPlexPipeline, isPersonaplexPcmFrame } from "./adapters/live/personaplex-pipeline.js";

function minimalAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    systemPrompt: "You are a helpful assistant.",
    greetingMessage: "Hello!",
    firstSpeaker: "agent",
    voiceStack: "gemini_live",
    geminiLive: { voiceName: "Kore", thinkingLevel: "minimal" },
    personaplex: null,
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
  const prevUrl = process.env["PERSONAPLEX_WS_URL"];
  afterEach(() => {
    if (prevUrl === undefined) delete process.env["PERSONAPLEX_WS_URL"];
    else process.env["PERSONAPLEX_WS_URL"] = prevUrl;
  });

  it("resolveVoiceStack only opts into gemini_live or personaplex explicitly", () => {
    expect(resolveVoiceStack(undefined)).toBe("classic");
    expect(resolveVoiceStack("classic")).toBe("classic");
    expect(resolveVoiceStack("gemini_live")).toBe("gemini_live");
    expect(resolveVoiceStack("personaplex")).toBe("personaplex");
    expect(resolveVoiceStack("other")).toBe("classic");
  });

  it("does not auto-switch intake to PersonaPlex without PERSONAPLEX_WS_URL", () => {
    delete process.env["PERSONAPLEX_WS_URL"];
    expect(resolveSessionVoiceStack({ agentType: "intake_inbound", raw: undefined })).toBe("classic");
    expect(resolveSessionVoiceStack({ agentType: "intake_inbound", raw: "personaplex" })).toBe("classic");
  });

  it("auto-switches intake to PersonaPlex when PERSONAPLEX_WS_URL is set", () => {
    process.env["PERSONAPLEX_WS_URL"] = "ws://gpu.example:9000";
    expect(resolveSessionVoiceStack({ agentType: "intake_inbound", raw: undefined })).toBe("personaplex");
    expect(resolveSessionVoiceStack({ agentType: "intake_inbound", raw: "gemini_live" })).toBe("gemini_live");
    expect(resolveSessionVoiceStack({ agentType: "custom", raw: undefined })).toBe("classic");
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
});

describe("GeminiLivePipeline carrier keepalive", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("feeds the VoBiz bridge while the model is silent, and stops on close", () => {
    vi.useFakeTimers();
    const onAudioOut = vi.fn();
    const pipeline = new GeminiLivePipeline({
      ...minimalSessionConfig(minimalAgentConfig()),
      telephonyProvider: "vobiz",
      onAudioOut,
    });

    // VoBiz drops the call after ~2 s of an idle bridge — frames must arrive
    // well before that even though Gemini has not spoken yet.
    vi.advanceTimersByTime(1000);
    expect(onAudioOut).toHaveBeenCalled();
    expect((onAudioOut.mock.calls[0]![0] as Buffer).length).toBe(320); // 20 ms @ 8 kHz PCM16

    pipeline.close();
    onAudioOut.mockClear();
    vi.advanceTimersByTime(1000);
    expect(onAudioOut).not.toHaveBeenCalled();
  });

  it("stays silent on mulaw carriers when the agent has no ambient bed", () => {
    vi.useFakeTimers();
    const onAudioOut = vi.fn();
    const pipeline = new GeminiLivePipeline({
      ...minimalSessionConfig(minimalAgentConfig()),
      telephonyProvider: "twilio",
      rawPcmOutput: false,
      onAudioOut,
    });

    vi.advanceTimersByTime(1000);
    expect(onAudioOut).not.toHaveBeenCalled();
    pipeline.close();
  });
});

describe("PersonaPlexPipeline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("requires a GPU websocket URL", () => {
    delete process.env["PERSONAPLEX_WS_URL"];
    expect(() =>
      new PersonaPlexPipeline(minimalSessionConfig(minimalAgentConfig({
        voiceStack: "personaplex",
        personaplex: { wsUrl: "", voiceName: "NATM1" },
      }))),
    ).toThrow(/PERSONAPLEX_WS_URL/i);
  });

  it("does not play PCM zeros to VoBiz before the first agent frame", () => {
    vi.useFakeTimers();
    const onAudioOut = vi.fn();
    const pipeline = new PersonaPlexPipeline({
      ...minimalSessionConfig(minimalAgentConfig({
        voiceStack: "personaplex",
        personaplex: { wsUrl: "ws://127.0.0.1:9", voiceName: "NATM1", isIntake: true },
      })),
      telephonyProvider: "vobiz",
      onAudioOut,
    });
    vi.advanceTimersByTime(1000);
    expect(onAudioOut).not.toHaveBeenCalled();
    pipeline.close();
    onAudioOut.mockClear();
    vi.advanceTimersByTime(1000);
    expect(onAudioOut).not.toHaveBeenCalled();
  });

  it("does not treat JSON control frames as PCM (that played as TV static)", () => {
    expect(isPersonaplexPcmFrame(false)).toBe(false);
    expect(isPersonaplexPcmFrame(true)).toBe(true);
    expect(isPersonaplexPcmFrame(true, Buffer.from('{"type":"ready"}'))).toBe(false);
    expect(isPersonaplexPcmFrame(true, Buffer.alloc(320))).toBe(true);
    expect(isPersonaplexPcmFrame(false, Buffer.alloc(320))).toBe(true);
  });

  it("locks intake Moshi to a short Irfan persona, not the playbook", () => {
    expect(resolvePersonaplexVoice("natm1.pt")).toBe("NATM1");
    expect(resolvePersonaplexVoice("")).toBe("NATM3");
    expect(resolvePersonaplexVoice("NATM3")).toBe("NATM3");
    const prompt = buildPersonaplexTextPrompt({
      agentName: "Asha",
      systemPrompt: "You are a real estate agent. Call save_candidate_details.",
      greeting: "Hello from Homes.",
      isIntake: true,
    });
    expect(prompt).toContain("JobShop");
    expect(prompt).toContain("BPO");
    expect(prompt).toContain("Bangalore");
    expect(prompt).toContain("Never invent company names");
    expect(prompt).toContain("Do not greet first");
    expect(prompt).toContain("Information:");
    expect(prompt).toContain("You enjoy having a good conversation");
    expect(prompt).toMatch(/laugh/i);
    expect(prompt).toMatch(/jolly|friendly/i);
    expect(prompt).toMatch(/Indian English/i);
    expect(prompt).not.toContain("9964080000");
    expect(prompt).not.toContain("Naukri");
    expect(prompt.length).toBeLessThan(900);
    expect(prompt).not.toContain("real estate");
    expect(prompt).not.toContain("save_candidate_details");
  });

  it("resolves recorded hello PCM next to the bundled dist, not only src/", async () => {
    const { irfanHelloPcmCandidates, loadIrfanHelloPcm } = await import("./adapters/live/irfan-hello.js");
    const paths = irfanHelloPcmCandidates();
    expect(paths.some((p: string) => p.endsWith("orchestration/adapters/live/irfan_hello_8k.pcm") || p.endsWith("dist/irfan_hello_8k.pcm") || p.endsWith("irfan_hello_8k.pcm"))).toBe(true);
    expect(paths.some((p: string) => p.includes("dist"))).toBe(true);
    expect(loadIrfanHelloPcm()?.length).toBeGreaterThan(8000);
  });

  it("plays recorded Irfan hello without waiting for GPU", async () => {
    vi.useFakeTimers();
    const onAudioOut = vi.fn();
    const pipeline = new PersonaPlexPipeline({
      ...minimalSessionConfig(minimalAgentConfig({
        voiceStack: "personaplex",
        personaplex: { wsUrl: "ws://127.0.0.1:9", voiceName: "NATM1", isIntake: true },
      })),
      telephonyProvider: "vobiz",
      onAudioOut,
    });
    await pipeline.greet();
    vi.advanceTimersByTime(80);
    expect(onAudioOut).toHaveBeenCalled();
    expect((onAudioOut.mock.calls[0]![0] as Buffer).length).toBe(320);
    pipeline.close();
  });
});
