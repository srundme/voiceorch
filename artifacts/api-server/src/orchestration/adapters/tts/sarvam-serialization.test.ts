import { afterEach, describe, expect, it, vi } from "vitest";
import { SarvamTTS } from "./sarvam.js";

describe("SarvamTTS stream serialization", () => {
  it("never retries or falls back over an already audible prefix", async () => {
    const tts = new SarvamTTS("test-key", "ritu", null, "hi-IN", "bulbul:v3");
    const failure = new Error("socket failed after first audio");
    const ws = vi.spyOn(tts as any, "synthesizeViaWs").mockImplementation(async (_text: string, onChunk: (pcm: Buffer) => void) => {
      onChunk(Buffer.alloc(640));
      throw failure;
    });
    const http = vi.spyOn(tts as any, "synthesizeViaHttpStream");
    const chunk = vi.fn();
    const done = vi.fn();
    await expect(tts.synthesizeStream("एक ही बार बोलिए।", chunk, done)).rejects.toBe(failure);
    expect(ws).toHaveBeenCalledTimes(1);
    expect(http).not.toHaveBeenCalled();
    expect(chunk).toHaveBeenCalledTimes(1);
    expect(done).not.toHaveBeenCalled();
    // A failed turn must release the serialization slot for the next reply.
    ws.mockResolvedValue(undefined);
    await tts.synthesizeStream("next", chunk, done);
    expect(ws).toHaveBeenCalledTimes(2);
    tts.close();
  });

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

  it("sends WS min_buffer_size as characters (30–200), not PCM bytes", () => {
    const telephony = new SarvamTTS("test-key", "ritu", null, "en-IN", "bulbul:v3", null, 8000);
    const webcall = new SarvamTTS("test-key", "ritu", null, "en-IN", "bulbul:v3", null, 16000);
    const telCfg = (telephony as any).buildConfigPayload() as { min_buffer_size: number };
    const webCfg = (webcall as any).buildConfigPayload() as { min_buffer_size: number };
    expect(telCfg.min_buffer_size).toBeGreaterThanOrEqual(30);
    expect(telCfg.min_buffer_size).toBeLessThanOrEqual(200);
    expect(webCfg.min_buffer_size).toBeGreaterThanOrEqual(30);
    expect(webCfg.min_buffer_size).toBeLessThanOrEqual(200);
    // Byte-count of 10 ms s16le @ 16 kHz is 320 — that is out of range.
    expect(webCfg.min_buffer_size).not.toBe(320);
    telephony.close();
    webcall.close();
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
