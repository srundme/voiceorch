import { describe, expect, it, vi } from "vitest";
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
