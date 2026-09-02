import { afterEach, describe, expect, it, vi } from "vitest";
import { SarvamTTS } from "./sarvam.js";

describe("SarvamTTS stream serialization", () => {
  it("keeps overlapping sentence prefetch on one ordered WS path", async () => {
    const tts = new SarvamTTS("test-key", "ritu", null, "ta-IN", "bulbul:v3");
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let active = 0;
    let maxActive = 0;
    const starts: string[] = [];

    vi.spyOn(tts as any, "synthesizeViaWs").mockImplementation(
      async (text: string, onChunk: (chunk: Buffer) => void) => {
        starts.push(text);
        active++;
        maxActive = Math.max(maxActive, active);
        if (text === "first") await firstGate;
        onChunk(Buffer.alloc(640));
        active--;
      },
    );

    const first = tts.synthesizeStream("first", () => {}, () => {});
    await vi.waitFor(() => expect(starts).toEqual(["first"]));

    const second = tts.synthesizeStream("second", () => {}, () => {});
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(starts).toEqual(["first"]);

    releaseFirst();
    await Promise.all([first, second]);

    expect(starts).toEqual(["first", "second"]);
    expect(maxActive).toBe(1);
    tts.close();
  });

  it("does not synthesize a queued sentence after its turn is aborted", async () => {
    const tts = new SarvamTTS("test-key", "ritu", null, "ta-IN", "bulbul:v3");
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const starts: string[] = [];

    vi.spyOn(tts as any, "synthesizeViaWs").mockImplementation(async (text: string) => {
      starts.push(text);
      if (text === "first") await firstGate;
    });

    const first = tts.synthesizeStream("first", () => {}, () => {});
    await vi.waitFor(() => expect(starts).toEqual(["first"]));

    const abort = new AbortController();
    const second = tts.synthesizeStream("second", () => {}, () => {}, abort.signal);
    abort.abort();
    releaseFirst();

    await first;
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(starts).toEqual(["first"]);
    tts.close();
  });
});

describe("SarvamTTS sample rate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("defaults to 16 kHz PCM when no sample rate is passed (HD webcall / preview)", () => {
    const tts = new SarvamTTS("test-key", "ritu", null, "en-IN", "bulbul:v3");
    expect(tts.pcmSampleRate).toBe(16000);
    tts.close();
  });

  it("requests native 8 kHz PCM when constructed for a telephony leg", async () => {
    let sampleRate: number | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { speech_sample_rate?: number };
        sampleRate = body.speech_sample_rate;
        return {
          ok: true,
          status: 200,
          json: async () => ({ audios: [Buffer.alloc(4).toString("base64")] }),
        } as unknown as Response;
      }),
    );

    const tts = new SarvamTTS("test-key", "ritu", null, "en-IN", "bulbul:v3", null, 8000);
    expect(tts.pcmSampleRate).toBe(8000);
    await tts.synthesize("Hello");
    expect(sampleRate).toBe(8000);
    tts.close();
  });
});
