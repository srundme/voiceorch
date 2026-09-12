import { readFileSync } from "node:fs";
import { describe, it, expect, vi, afterEach } from "vitest";
import { CartesiaTTS, resolveCartesiaModelId, parseCartesiaLang, cartesiaWireLanguage, joinContinuationTranscript, appendCartesiaRemainder, isCartesiaContextClosedError } from "./cartesia.js";

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
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => audioBytes,
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const tts = new CartesiaTTS("test-key", null, null, null, null);
    const result = await tts.synthesize("Plain sentence.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.audio.length).toBe(2);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as {
      voice?: Record<string, unknown>;
    };
    expect(body.voice).toEqual({ mode: "id", id: expect.any(String) });
  });

  it("setLanguage() updates the language tag on subsequent synthesize() calls", async () => {
    const audioBytes = new Uint8Array([1]).buffer;
    const languages: Array<string | undefined> = [];
    const locales: Array<string | undefined> = [];
    const models: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as {
          language?: string;
          locale?: string;
          model_id?: string;
        };
        languages.push(body.language);
        locales.push(body.locale);
        if (body.model_id) models.push(body.model_id);
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => audioBytes,
        } as unknown as Response;
      }),
    );

    const tts = new CartesiaTTS("test-key", null, "sonic-3.5", "en-IN", null);
    expect(tts.resolvedModelId).toBe("sonic-3.5");
    await tts.synthesize("Hello");
    tts.setLanguage("ta-IN");
    await tts.synthesize("வணக்கம்");

    expect(languages).toEqual(["en-IN", "ta-IN"]);
    expect(locales).toEqual([undefined, undefined]);
    expect(models).toEqual(["sonic-3.5", "sonic-3.5"]);
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

describe("appendCartesiaRemainder", () => {
  it("preserves token boundaries and existing sentence whitespace", () => {
    expect(appendCartesiaRemainder("வணக்கம்!", " இப்போ பேசலாமா?")).toBe("வணக்கம்! இப்போ பேசலாமா?");
    expect(appendCartesiaRemainder("cof", "fee")).toBe("coffee");
    expect(appendCartesiaRemainder("Hello. ", "How are you?")).toBe("Hello. How are you?");
    expect(appendCartesiaRemainder("", "First.")).toBe("First.");
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
  it("defaults to sonic-3.6 (Cartesia current model) and keeps explicit ids", () => {
    expect(resolveCartesiaModelId(null)).toBe("sonic-3.6");
    expect(resolveCartesiaModelId("sonic-3.5")).toBe("sonic-3.5");
    expect(resolveCartesiaModelId("Sonic 3.5")).toBe("sonic-3.5");
    expect(resolveCartesiaModelId("3.5")).toBe("sonic-3.5");
    expect(resolveCartesiaModelId("sonic-preview")).toBe("sonic-preview");
    expect(resolveCartesiaModelId("sonic-3.6")).toBe("sonic-3.6");
    expect(resolveCartesiaModelId("Sonic 3.6")).toBe("sonic-3.6");
    expect(resolveCartesiaModelId("not-a-model")).toBe("sonic-3.6");
  });

  it("does not remap a selected 3.5 agent onto 3.6", () => {
    const tts = new CartesiaTTS("test-key", null, "sonic-3.5");
    expect(tts.resolvedModelId).toBe("sonic-3.5");
    expect(new CartesiaTTS("test-key", null, "sonic-3.6").resolvedModelId).toBe("sonic-3.6");
  });
});

describe("parseCartesiaLang", () => {
  it("splits en-IN into language + locale for Sonic 3.6", () => {
    expect(parseCartesiaLang("en-IN")).toEqual({ language: "en", locale: "en-IN" });
    expect(parseCartesiaLang("hi")).toEqual({ language: "hi", locale: "hi-IN" });
    expect(parseCartesiaLang("ta")).toEqual({ language: "ta", locale: "ta-IN" });
    expect(parseCartesiaLang("ta-IN")).toEqual({ language: "ta", locale: "ta-IN" });
    expect(parseCartesiaLang(null)).toEqual({ language: null, locale: null });
  });
});

describe("cartesiaWireLanguage", () => {
  it("prefers the regional locale on the language field", () => {
    expect(cartesiaWireLanguage("ta", "ta-IN")).toBe("ta-IN");
    expect(cartesiaWireLanguage("en", "en-IN")).toBe("en-IN");
    expect(cartesiaWireLanguage("en", null)).toBe("en");
  });
});

describe("Cartesia language vs locale", () => {
  it("never sends language and locale together (Cartesia 400 → silent call)", async () => {
    const bodies: Array<{ language?: string; locale?: string; model_id?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string) as { language?: string; locale?: string; model_id?: string });
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new Uint8Array([1]).buffer,
        } as unknown as Response;
      }),
    );

    await new CartesiaTTS("k", null, "sonic-3.6", "en-IN").synthesize("Hello");
    await new CartesiaTTS("k", null, "sonic-3.5", "ta-IN").synthesize("வணக்கம்");

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ model_id: "sonic-3.6", language: "en-IN", normalization: "en-IN" });
    expect(bodies[1]).toMatchObject({ model_id: "sonic-3.5", language: "ta-IN", normalization: "ta-IN" });
    for (const b of bodies) {
      expect(b.locale).toBeUndefined();
      expect(Boolean(b.language) && Boolean(b.locale)).toBe(false);
    }
  });
});

describe("ensureTerminalPunctuation", () => {
  it("adds a period only when the sentence has no terminal mark", () => {
    expect(CartesiaTTS.ensureTerminalPunctuation("How can I help you?")).toBe("How can I help you?");
    expect(CartesiaTTS.ensureTerminalPunctuation("Hello there")).toBe("Hello there.");
  });

  it("does not turn a comma pause into a full stop", () => {
    expect(CartesiaTTS.ensureTerminalPunctuation("Hello Gopi,")).toBe("Hello Gopi,");
    expect(CartesiaTTS.ensureTerminalPunctuation("Wait a second;")).toBe("Wait a second;");
  });
});

describe("Cartesia adaptor contract (source)", () => {
  it("matches current Sonic docs: /tts/websocket, voice { mode: id, id }, managed buffering", () => {
    const src = readFileSync(new URL("./cartesia.ts", import.meta.url), "utf8");
    expect(src).toContain("/tts/websocket?");
    expect(src).not.toContain("/tts/websockets");
    expect(src).toContain('return { mode: "id", id: this.voiceId }');
    expect(src).toMatch(/CARTESIA_MAX_BUFFER_DELAY_MS = 3000/);
    expect(src).toMatch(/max_buffer_delay_ms: CARTESIA_MAX_BUFFER_DELAY_MS/);
    expect(src).toContain("CARTESIA_SONIC_36_MODEL = \"sonic-3.6\"");
    expect(src).toContain("never both");
    expect(src).toContain("msg.language = tag");
    expect(src).toContain("msg.normalization = tag");
  });

  it("sends voice on continue:false finalize so Cartesia does not 400 Voice ID required mid-clip", () => {
    const src = readFileSync(new URL("./cartesia.ts", import.meta.url), "utf8");
    expect(src).toContain('transcript: ""');
    expect(src).toMatch(/transcript: "",\s*\n\s*voice: this\.buildVoice\(\)/);
  });

  it("ignores premature context done until leftover REST + finalizeTurnContext (call 18112 / 19809)", () => {
    const src = readFileSync(new URL("./cartesia.ts", import.meta.url), "utf8");
    expect(src).toContain("claimedTurns.has(contextId)");
    expect(src).toContain("closingTurns.has(contextId)");
    expect(src).toContain("cartesia_context_closed_after_first_clip");
    expect(src).toContain("cartesia_leftover_rest");
  });

  it("sends leftover REST once from concatenated remainder after clip 1", () => {
    const src = readFileSync(new URL("./cartesia.ts", import.meta.url), "utf8");
    expect(src).toContain("appendTurnRemainder");
  });

  it("streams join transcripts on the open WS context (managed buffering)", () => {
    const src = readFileSync(new URL("./cartesia.ts", import.meta.url), "utf8");
    expect(src).toContain("sendTranscript(streamed)");
    expect(src).toContain("middle ground");
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

  it("sends every continuation before closing when the LLM finishes before WS opens", async () => {
    const sockets: FakeCartesiaWs[] = [];
    vi.stubGlobal("WebSocket", class extends FakeCartesiaWs {
      constructor(url: string) { super(url); sockets.push(this); }
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const tts = new CartesiaTTS("test-key", null, "sonic-3.6", "hi-IN", null, 8000);
    const chunks: Buffer[] = [];
    tts.claimTurnContext("fast-llm");
    const owner = tts.synthesizeStreamInContext("fast-llm", "नमस्ते।", (pcm) => chunks.push(pcm), () => {});
    const join = tts.synthesizeStreamInContext("fast-llm", " आप कैसे हैं?", () => {}, () => {}, undefined, undefined, true);
    tts.finalizeTurnContext("fast-llm");
    try {
      await join;
      await vi.waitFor(() => expect(sockets[0]?.sent.length).toBe(3));
      const requests = sockets[0]!.sent.map((s) => JSON.parse(s));
      expect(requests.map((r) => [r.transcript, r.continue])).toEqual([
        ["नमस्ते।", true], [" आप कैसे हैं?", true], ["", false],
      ]);
      expect(requests.every((r) => r.context_id === "fast-llm")).toBe(true);
      expect(requests[0]).toMatchObject({ model_id: "sonic-3.6", output_format: { sample_rate: 8000 } });
      sockets[0]!.emit({ type: "chunk", context_id: "fast-llm", data: Buffer.from([1, 2]).toString("base64") });
      sockets[0]!.emit({ type: "done", context_id: "fast-llm" });
      await owner;
      expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2]));
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      tts.close();
      await owner.catch(() => {});
    }
  });

  it("reports a send failure instead of swallowing it in the send queue", async () => {
    const tts = new CartesiaTTS("test-key", null, null);
    const queue = tts as unknown as { enqueueTurnSend(id: string, send: () => void): Promise<void> };
    await expect(queue.enqueueTurnSend("send-error", () => { throw new Error("socket closed"); })).rejects.toThrow("socket closed");
    const next = vi.fn();
    await queue.enqueueTurnSend("send-error", next);
    expect(next).toHaveBeenCalledOnce();
    tts.close();
  });

  it("cancels provider synthesis on barge-in and does not REST-replay the tail", async () => {
    const sockets: FakeCartesiaWs[] = [];
    vi.stubGlobal("WebSocket", class extends FakeCartesiaWs {
      constructor(url: string) { super(url); sockets.push(this); }
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const tts = new CartesiaTTS("test-key", null, null);
    const abort = new AbortController();
    tts.claimTurnContext("interrupted");
    const owner = tts.synthesizeStreamInContext("interrupted", "Hello.", () => {}, () => {}, abort.signal);
    const rejected = expect(owner).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(sockets[0]?.sent.length).toBe(1));
    tts.appendTurnRemainder("interrupted", " Do not play this after interruption.");
    abort.abort();
    tts.finalizeTurnContext("interrupted");
    await rejected;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(sockets[0]!.sent.map((s) => JSON.parse(s))).toContainEqual({ context_id: "interrupted", cancel: true });
    expect(fetchMock).not.toHaveBeenCalled();
    tts.close();
  });

  it("does not finalize a context aborted before the handshake completed", async () => {
    const sockets: FakeCartesiaWs[] = [];
    vi.stubGlobal("WebSocket", class extends FakeCartesiaWs {
      constructor(url: string) { super(url); sockets.push(this); }
    });
    const tts = new CartesiaTTS("test-key", null, null);
    const abort = new AbortController();
    abort.abort();
    tts.claimTurnContext("early-abort");
    const owner = tts.synthesizeStreamInContext("early-abort", "Hello.", () => {}, () => {}, abort.signal);
    tts.finalizeTurnContext("early-abort");
    await expect(owner).rejects.toMatchObject({ name: "AbortError" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(sockets.flatMap((ws) => ws.sent)).toEqual([]);
    tts.close();
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
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
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
