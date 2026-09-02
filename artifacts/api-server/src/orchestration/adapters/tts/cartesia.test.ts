import { readFileSync } from "node:fs";
import { describe, it, expect, vi, afterEach } from "vitest";
import { CartesiaTTS, resolveCartesiaModelId, joinContinuationTranscript } from "./cartesia.js";

/**
 * Regression test for the Cartesia emotion-voice-control bug: Cartesia can
 * reject `__experimental_controls.emotion` with a 400 ("invalid emotion
 * level: medium" / "invalid voice controls: ...") for a level our mapping
 * sends. This must no longer propagate as a fatal error — the adapter should
 * retry the same sentence once with emotion controls stripped and still
 * produce audio, so a call carrying `<emotion value="content">` completes
 * normally instead of ending with `reason: "failed"`.
 */
describe("CartesiaTTS emotion voice-control fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("synthesize() retries without emotion controls when Cartesia rejects them", async () => {
    let callCount = 0;
    const audioBytes = new Uint8Array([1, 2, 3, 4]).buffer;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        callCount++;
        const body = JSON.parse(init.body as string) as { generation_config?: { emotion?: string } };
        const hasEmotion = !!body.generation_config?.emotion;
        if (hasEmotion) {
          return {
            ok: false,
            status: 400,
            text: async () => "invalid voice controls: invalid emotion level: medium",
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => audioBytes,
        } as unknown as Response;
      }),
    );

    const tts = new CartesiaTTS("test-key", null, null, null, null);
    const result = await tts.synthesize("Great news!", ["positivity:medium"]);

    expect(callCount).toBe(2); // first rejected w/ emotion, second succeeds without
    expect(result.audio.length).toBe(4);
  });

  it("synthesize() still throws for unrelated Cartesia errors (no silent swallow)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "internal server error",
      }) as unknown as Response),
    );

    const tts = new CartesiaTTS("test-key", null, null, null, null);
    await expect(tts.synthesize("Hello", ["positivity:low"])).rejects.toThrow(/Cartesia TTS error 500/);
  });

  it("synthesize() with no emotions passes through unaffected on success", async () => {
    const audioBytes = new Uint8Array([9, 9]).buffer;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => audioBytes,
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const tts = new CartesiaTTS("test-key", null, null, null, null);
    const result = await tts.synthesize("Plain sentence.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.audio.length).toBe(2);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      voice?: Record<string, unknown>;
    };
    expect(body.voice).toEqual({ id: expect.any(String) });
    expect(body.voice).not.toHaveProperty("mode");
  });

  it("setLanguage() updates the language tag on subsequent synthesize() calls", async () => {
    const audioBytes = new Uint8Array([1]).buffer;
    const languages: Array<string | undefined> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { language?: string };
        languages.push(body.language);
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => audioBytes,
        } as unknown as Response;
      }),
    );

    const tts = new CartesiaTTS("test-key", null, null, "en-IN", null);
    await tts.synthesize("Hello");
    tts.setLanguage("ta-IN");
    await tts.synthesize("வணக்கம்");

    expect(languages).toEqual(["en", "ta"]);
  });

  it("defaults to 16 kHz PCM when no sample rate is passed (HD webcall)", () => {
    const tts = new CartesiaTTS("test-key", null, null);
    expect(tts.pcmSampleRate).toBe(16000);
  });

  it("requests native 8 kHz PCM when constructed for a telephony leg", async () => {
    let sampleRate: number | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as {
          output_format?: { sample_rate?: number };
        };
        sampleRate = body.output_format?.sample_rate;
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
        } as unknown as Response;
      }),
    );

    const tts = new CartesiaTTS("test-key", null, null, null, null, 8000);
    expect(tts.pcmSampleRate).toBe(8000);
    await tts.synthesize("Hello");
    expect(sampleRate).toBe(8000);
  });
});

describe("joinContinuationTranscript", () => {
  it("inserts a space so Cartesia sees one valid transcript", () => {
    expect(joinContinuationTranscript("Hello, world!", "How are you?")).toBe(" How are you?");
    expect(joinContinuationTranscript("Hello, world!", " How are you?")).toBe(" How are you?");
    expect(joinContinuationTranscript("", "Hello")).toBe("Hello");
  });
});

describe("claimTurnContext (call 17915 — no second owner clip)", () => {
  it("lets only the first sentence own the turn, even after finalize or WS-down", () => {
    const tts = new CartesiaTTS("test-key", null, null);
    expect(tts.claimTurnContext("turn-17915")).toBe(true);
    expect(tts.claimTurnContext("turn-17915")).toBe(false);
    tts.finalizeTurnContext("turn-17915");
    expect(tts.claimTurnContext("turn-17915")).toBe(false);

    const down = new CartesiaTTS("test-key", null, null);
    (down as unknown as { wsFailedPermanently: boolean }).wsFailedPermanently = true;
    expect(down.claimTurnContext("turn-ws-down")).toBe(true);
    expect(down.claimTurnContext("turn-ws-down")).toBe(false);
  });
});

describe("resolveCartesiaModelId", () => {
  it("keeps sonic-3.5 as the default and passes sonic-3.6 through as GA", () => {
    expect(resolveCartesiaModelId(null)).toBe("sonic-3.5");
    expect(resolveCartesiaModelId("sonic-3.5")).toBe("sonic-3.5");
    expect(resolveCartesiaModelId("sonic-preview")).toBe("sonic-preview");
    expect(resolveCartesiaModelId("sonic-3.6")).toBe("sonic-3.6");
    expect(resolveCartesiaModelId("not-a-model")).toBe("sonic-3.5");
  });
});

describe("Cartesia adaptor contract (source)", () => {
  it("matches current Sonic docs: /tts/websocket, voice { id }, max_buffer_delay_ms 0", () => {
    const src = readFileSync(new URL("./cartesia.ts", import.meta.url), "utf8");
    expect(src).toContain("/tts/websocket?");
    expect(src).not.toContain("/tts/websockets");
    expect(src).toContain("return { id: this.voiceId }");
    expect(src).toMatch(/CARTESIA_MAX_BUFFER_DELAY_MS = 0/);
    expect(src).toContain('CARTESIA_SONIC_36_MODEL = "sonic-3.6"');
  });
});
