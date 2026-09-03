import { readFileSync } from "node:fs";
import { describe, it, expect, vi, afterEach } from "vitest";
import { CartesiaTTS, resolveCartesiaModelId, joinContinuationTranscript, isCartesiaContextClosedError } from "./cartesia.js";

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
    expect(body.voice).toEqual({ mode: "id", id: expect.any(String) });
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
  it("matches current Sonic docs: /tts/websocket, voice { mode: id, id }, max_buffer_delay_ms 0", () => {
    const src = readFileSync(new URL("./cartesia.ts", import.meta.url), "utf8");
    expect(src).toContain("/tts/websocket?");
    expect(src).not.toContain("/tts/websockets");
    expect(src).toContain('return { mode: "id", id: this.voiceId }');
    expect(src).toMatch(/CARTESIA_MAX_BUFFER_DELAY_MS = 0/);
    expect(src).toContain('CARTESIA_SONIC_36_MODEL = "sonic-3.6"');
  });

  it("sends voice on continue:false finalize so Cartesia does not 400 Voice ID required mid-clip", () => {
    const src = readFileSync(new URL("./cartesia.ts", import.meta.url), "utf8");
    expect(src).toContain('transcript: ""');
    expect(src).toMatch(/transcript: "",\s*\n\s*voice: this\.buildVoice\(\)/);
  });

  it("ignores premature context done until leftover REST + finalizeTurnContext (call 18112 / 19809)", () => {
    const src = readFileSync(new URL("./cartesia.ts", import.meta.url), "utf8");
    expect(src).toContain("claimedTurns.has(contextId)");
    expect(src).toContain("finalizedTurns.has(contextId)");
    expect(src).toContain("cartesia_context_closed_after_first_clip");
    expect(src).toContain("cartesia_leftover_rest");
  });

  it("does not arm the playJob idle timer on skipDrain leftover REST (call 19809)", () => {
    const src = readFileSync(new URL("../../pipeline.ts", import.meta.url), "utf8");
    expect(src).toContain("if (job.skipDrain) return;");
    expect(src).toContain("&& !job.skipDrain");
  });
});

describe("isCartesiaContextClosedError", () => {
  it("matches Cartesia's delay=0 context-closed 400 wording (call 19809)", () => {
    expect(isCartesiaContextClosedError(
      new Error("Context has closed and is no longer accepting new inputs, use a new context ID. — Context closed — status=400"),
    )).toBe(true);
    expect(isCartesiaContextClosedError(
      new Error("Cartesia WS synthesis error: Context has closed and is no longer accepting new inputs"),
    )).toBe(true);
    expect(isCartesiaContextClosedError(new Error("use a new context ID"))).toBe(true);
    expect(isCartesiaContextClosedError(new Error("Cartesia WS synthesis error: unknown"))).toBe(false);
    expect(isCartesiaContextClosedError(new Error("invalid voice controls"))).toBe(false);
  });
});

/**
 * Fake Cartesia WS: open on the next microtask, capture send(), emit messages.
 * Call 19809: clip-1 `done` + 400 "Context has closed" while later sentences
 * still need to play — they REST into the owner PCM sink.
 */
class FakeCartesiaWs {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = FakeCartesiaWs.CONNECTING;
  url: string;
  sent: string[] = [];
  private listeners = new Map<string, Array<(ev: { data?: string }) => void>>();

  constructor(url: string) {
    this.url = url;
    queueMicrotask(() => {
      this.readyState = FakeCartesiaWs.OPEN;
      for (const fn of this.listeners.get("open") ?? []) fn({});
    });
  }

  addEventListener(type: string, fn: (ev: { data?: string }) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = 3;
  }

  emit(msg: Record<string, unknown>): void {
    const data = JSON.stringify(msg);
    for (const fn of this.listeners.get("message") ?? []) fn({ data });
  }
}

describe("Cartesia delay=0 leftover REST (call 19809 mid-sentence cut)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("plays remaining sentences via REST into the owner sink after Cartesia closes the context", async () => {
    const sockets: FakeCartesiaWs[] = [];
    vi.stubGlobal("WebSocket", class extends FakeCartesiaWs {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    });

    const restPcm = new Uint8Array([20, 21, 22, 23]);
    const fetchMock = vi.fn(async () => {
      let n = 0;
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => (n++ === 0
              ? { done: false, value: restPcm }
              : { done: true, value: undefined }),
            releaseLock: () => {},
          }),
        },
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const tts = new CartesiaTTS("test-key", null, null);
    const turnId = "turn-19809";
    expect(tts.claimTurnContext(turnId)).toBe(true);

    const ownerChunks: Buffer[] = [];
    const joinChunks: Buffer[] = [];
    let ownerDoneChars = 0;
    let joinDoneChars = 0;

    const ownerP = tts.synthesizeStreamInContext(
      turnId,
      "देखिए, आपकी गाड़ी पर एक pending traffic",
      (pcm) => { ownerChunks.push(pcm); },
      (n) => { ownerDoneChars = n; },
      undefined,
      undefined,
      false,
    );

    await vi.waitFor(() => expect(sockets.length).toBe(1));
    await vi.waitFor(() => expect(sockets[0]!.sent.length).toBeGreaterThan(0));

    expect(tts.claimTurnContext(turnId)).toBe(false);

    const joinP = tts.synthesizeStreamInContext(
      turnId,
      "challan है।",
      (pcm) => { joinChunks.push(pcm); },
      (n) => { joinDoneChars = n; },
      undefined,
      undefined,
      true,
    );

    const wsPcm = Buffer.from([10, 11, 12, 13]);
    sockets[0]!.emit({
      type: "chunk",
      context_id: turnId,
      data: wsPcm.toString("base64"),
    });
    sockets[0]!.emit({ type: "done", context_id: turnId });
    sockets[0]!.emit({
      type: "error",
      context_id: turnId,
      status: 400,
      errorCode: null,
      detail: "Context has closed and is no longer accepting new inputs, use a new context ID. — Context closed — status=400",
    });

    await joinP;
    tts.finalizeTurnContext(turnId);
    await ownerP;

    const ownerBytes = Buffer.concat(ownerChunks);
    expect(ownerBytes.equals(Buffer.concat([wsPcm, Buffer.from(restPcm)]))).toBe(true);
    expect(joinChunks).toEqual([]);
    expect(ownerDoneChars).toBeGreaterThan(0);
    expect(joinDoneChars).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalled();
    expect((fetchMock.mock.calls[0]![0] as string)).toContain("/tts/bytes");

    const continueTrue = sockets[0]!.sent.filter((s) => {
      const m = JSON.parse(s) as { continue?: boolean; transcript?: string };
      return m.continue === true && (m.transcript?.includes("challan") ?? false);
    });
    expect(continueTrue).toEqual([]);
    expect((tts as unknown as { wsFailedPermanently: boolean }).wsFailedPermanently).toBe(false);
  });

  it("does not permanently kill WS after a single context error (call 19742 double-speak + jump)", () => {
    const src = readFileSync(new URL("./cartesia.ts", import.meta.url), "utf8");
    expect(src).toContain("cartesia_skip_rest_duplicate");
    expect(src).toContain("REST this sentence only");
    expect(src).toContain("restFallbackTurns");
    expect(src).toContain("if (this.ws !== ws) return");
    expect(src).toContain("formatWsError");
  });
});
