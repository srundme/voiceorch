import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CartesiaTTS,
  resolveCartesiaModelId,
  parseCartesiaLang,
  cartesiaWireLanguage,
  cartesiaLangFields,
  resolveCartesiaTtsLanguage,
  appendCartesiaRemainder,
  isCartesiaContextClosedError,
  takeCartesiaWordChunks,
  takeCompleteCartesiaSentences,
} from "./cartesia.js";

describe("CartesiaTTS emotion voice-control fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("synthesize() retries without emotion controls when Cartesia rejects them", async () => {
    let callCount = 0;
    const audioBytes = new Uint8Array([1, 2, 3, 4]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        callCount++;
        const body = JSON.parse(init.body as string) as { generation_config?: { emotion?: string } };
        if (body.generation_config?.emotion) {
          return {
            ok: false,
            status: 400,
            text: async () => "invalid voice controls: invalid emotion level: medium",
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(c) { c.enqueue(audioBytes); c.close(); },
          }),
        } as unknown as Response;
      }),
    );

    const tts = new CartesiaTTS("test-key", null, null, null, null);
    const result = await tts.synthesize("Great news!", ["positivity:medium"]);
    expect(callCount).toBe(2);
    expect(result.audio.length).toBe(4);
  });

  it("synthesize() still throws for unrelated Cartesia errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "internal server error",
      }) as unknown as Response),
    );
    const tts = new CartesiaTTS("test-key", null, null, null, null);
    await expect(tts.synthesize("Hello", ["positivity:low"])).rejects.toThrow(/Cartesia TTS stream error 500/);
  });

  it("setLanguage() updates the language tag on subsequent synthesize() calls", async () => {
    const languages: Array<string | undefined> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { language?: string; model_id?: string };
        languages.push(body.language);
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(c) { c.enqueue(new Uint8Array([1])); c.close(); },
          }),
        } as unknown as Response;
      }),
    );
    const tts = new CartesiaTTS("test-key", null, "sonic-3.5", "en-IN", null);
    expect(tts.resolvedModelId).toBe("sonic-3.5");
    await tts.synthesize("Hello");
    tts.setLanguage("ta-IN");
    await tts.synthesize("வணக்கம்");
    expect(languages).toEqual(["en-IN", "ta-IN"]);
  });

  it("defaults to 16 kHz PCM when no sample rate is passed (HD webcall)", () => {
    expect(new CartesiaTTS("test-key", null, null).pcmSampleRate).toBe(16000);
  });

  it("requests native 8 kHz PCM when constructed for a telephony leg", async () => {
    let sampleRate: number | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { output_format?: { sample_rate?: number } };
        sampleRate = body.output_format?.sample_rate;
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(c) { c.enqueue(new Uint8Array([1, 2])); c.close(); },
          }),
        } as unknown as Response;
      }),
    );
    const tts = new CartesiaTTS("test-key", null, null, null, null, 8000);
    expect(tts.pcmSampleRate).toBe(8000);
    await tts.synthesize("Hello");
    expect(sampleRate).toBe(8000);
  });
});

describe("takeCartesiaWordChunks", () => {
  it("does not send letter BPE until a word boundary (call 25026)", () => {
    let rest = "";
    const sent: string[] = [];
    for (const t of ["N", "o", " p", "r", "o", "blem,"]) {
      const r = takeCartesiaWordChunks(rest, t, false);
      sent.push(...r.chunks);
      rest = r.rest;
    }
    expect(sent.join("")).toBe("No problem,");
    expect(rest).toBe("");
  });
});

describe("appendCartesiaRemainder", () => {
  it("preserves token boundaries and existing sentence whitespace", () => {
    expect(appendCartesiaRemainder("வணக்கம்!", " இப்போ பேசலாமா?")).toBe("வணக்கம்! இப்போ பேசலாமா?");
    expect(appendCartesiaRemainder("cof", "fee")).toBe("coffee");
  });
});

describe("claimTurnContext", () => {
  it("lets only the first sentence own the turn", () => {
    const tts = new CartesiaTTS("test-key", null, null);
    expect(tts.claimTurnContext("turn-a")).toBe(true);
    expect(tts.claimTurnContext("turn-a")).toBe(false);
    tts.finalizeTurnContext("turn-a");
    expect(tts.claimTurnContext("turn-a")).toBe(false);
  });
});

describe("resolveCartesiaModelId", () => {
  it("defaults to sonic-3.6 and keeps explicit ids", () => {
    expect(resolveCartesiaModelId(null)).toBe("sonic-3.6");
    expect(resolveCartesiaModelId("sonic-3.5")).toBe("sonic-3.5");
    expect(resolveCartesiaModelId("Sonic 3.6")).toBe("sonic-3.6");
    expect(resolveCartesiaModelId("not-a-model")).toBe("sonic-3.6");
  });

  it("migrates retired sonic-2 / turbo ids so Talk is not stuck on fillers-only REST", () => {
    expect(resolveCartesiaModelId("sonic-2")).toBe("sonic-3.6");
    expect(resolveCartesiaModelId("sonic-2-2025-06-11")).toBe("sonic-3.6");
    expect(resolveCartesiaModelId("sonic-turbo")).toBe("sonic-3.6");
    expect(new CartesiaTTS("k", null, "sonic-2", "en-IN").resolvedModelId).toBe("sonic-3.6");
  });
});

describe("parseCartesiaLang / cartesiaWireLanguage", () => {
  it("splits en-IN and prefers locale on the language field", () => {
    expect(parseCartesiaLang("en-IN")).toEqual({ language: "en", locale: "en-IN" });
    expect(parseCartesiaLang("ta")).toEqual({ language: "ta", locale: "ta-IN" });
    expect(cartesiaWireLanguage("ta", "ta-IN")).toBe("ta-IN");
    expect(cartesiaWireLanguage("en", null)).toBe("en");
  });

  it("sends Sonic 3.6 regional tags as locale so English gets an Indian accent", () => {
    expect(cartesiaLangFields("en", "en-IN", "sonic-3.6")).toEqual({
      locale: "en-IN",
      normalization: "en-IN",
    });
    expect(cartesiaLangFields("hi", "hi-IN", "sonic-3.6")).toEqual({
      locale: "hi-IN",
      normalization: "hi-IN",
    });
    expect(cartesiaLangFields("en", "en-IN", "sonic-3.5")).toEqual({
      language: "en-IN",
      normalization: "en-IN",
    });
  });
});

describe("resolveCartesiaTtsLanguage", () => {
  it("lets Indic script win over an English session tag", () => {
    expect(resolveCartesiaTtsLanguage("வணக்கம் நண்பரே", "en-IN")).toBe("ta-IN");
    expect(resolveCartesiaTtsLanguage("नमस्ते, आप कैसे हैं", "en-IN")).toBe("hi-IN");
  });

  it("keeps the session tag for Latin-only text", () => {
    expect(resolveCartesiaTtsLanguage("Okay", "ta-IN")).toBe("ta-IN");
    expect(resolveCartesiaTtsLanguage("Hello", "en-IN")).toBe("en-IN");
  });
});

describe("takeCompleteCartesiaSentences", () => {
  it("keeps a trailing fragment unsent", () => {
    expect(takeCompleteCartesiaSentences("Hello. How")).toEqual({
      complete: "Hello.",
      rest: " How",
    });
    expect(takeCompleteCartesiaSentences("Hello there ")).toEqual({
      complete: "",
      rest: "Hello there ",
    });
  });
});

describe("Cartesia language vs locale", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("never sends language and locale together", async () => {
    const bodies: Array<{ language?: string; locale?: string; normalization?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string) as { language?: string; locale?: string; normalization?: string });
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(c) { c.enqueue(new Uint8Array([1])); c.close(); },
          }),
        } as unknown as Response;
      }),
    );
    await new CartesiaTTS("k", null, "sonic-3.6", "en-IN").synthesize("Hello");
    expect(bodies[0]).toMatchObject({ locale: "en-IN", normalization: "en-IN" });
    expect(bodies[0]!.language).toBeUndefined();
  });

  it("tags Tamil script as ta-IN even when the session language is English", async () => {
    const bodies: Array<{ language?: string; locale?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string) as { language?: string; locale?: string });
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(c) { c.enqueue(new Uint8Array([1])); c.close(); },
          }),
        } as unknown as Response;
      }),
    );
    await new CartesiaTTS("k", null, "sonic-3.6", "en-IN").synthesize("வணக்கம், நான் உங்களுக்கு உதவி செய்கிறேன்.");
    expect(bodies[0]).toMatchObject({ locale: "ta-IN" });
    expect(bodies[0]!.language).toBeUndefined();
  });
});

describe("ensureTerminalPunctuation", () => {
  it("adds a period only when the sentence has no terminal mark", () => {
    expect(CartesiaTTS.ensureTerminalPunctuation("How can I help you?")).toBe("How can I help you?");
    expect(CartesiaTTS.ensureTerminalPunctuation("Hello there")).toBe("Hello there.");
    expect(CartesiaTTS.ensureTerminalPunctuation("Hello Gopi,")).toBe("Hello Gopi,");
  });
});

describe("isCartesiaContextClosedError", () => {
  it("matches Cartesia context-closed wording", () => {
    expect(isCartesiaContextClosedError(
      new Error("Context has closed and is no longer accepting new inputs, use a new context ID."),
    )).toBe(true);
    expect(isCartesiaContextClosedError(new Error("invalid voice controls"))).toBe(false);
  });
});

class FakeCartesiaWs {
  static OPEN = 1;
  readyState = 0;
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
    try {
      const msg = JSON.parse(payload) as { flush?: boolean; context_id?: string };
      if (msg.flush === true && msg.context_id) {
        queueMicrotask(() => this.emit({ type: "flush_done", context_id: msg.context_id }));
      }
    } catch { /* ignore malformed */ }
  }

  close(): void {
    this.readyState = 3;
  }

  emit(msg: Record<string, unknown>): void {
    const data = JSON.stringify(msg);
    for (const fn of this.listeners.get("message") ?? []) fn({ data });
  }
}

describe("Cartesia WS continuations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("speaks the full turn as one continue:false generation so Sonic cannot overlap", async () => {
    const sockets: FakeCartesiaWs[] = [];
    vi.stubGlobal("WebSocket", class extends FakeCartesiaWs {
      constructor(url: string) { super(url); sockets.push(this); }
    });
    vi.stubGlobal("fetch", vi.fn());
    const tts = new CartesiaTTS("test-key", null, "sonic-3.6", "hi-IN", null, 8000);
    const chunks: Buffer[] = [];
    tts.claimTurnContext("fast-llm");
    const owner = tts.synthesizeStreamInContext("fast-llm", "नमस्ते।", (pcm) => chunks.push(pcm), () => {});
    const join = tts.synthesizeStreamInContext("fast-llm", " आप कैसे हैं?", () => {}, () => {}, undefined, undefined, true);
    try {
      // The pipeline hands over every continuation before closing the turn.
      await join;
      tts.finalizeTurnContext("fast-llm");
      await vi.waitFor(() => expect(sockets[0]?.sent.length).toBeGreaterThanOrEqual(1));
      const requests = sockets[0]!.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
      expect(requests.every((r) => r.context_id === "fast-llm")).toBe(true);
      expect(requests.filter((r) => r.flush !== true).map((r) => [r.transcript, r.continue])).toEqual([
        ["नमस्ते। आप कैसे हैं?", false],
      ]);
      expect(requests[0]).toMatchObject({
        model_id: "sonic-3.6",
        locale: "hi-IN",
        voice: { mode: "id", id: expect.any(String) },
        output_format: { sample_rate: 8000 },
      });
      expect(requests[0]!.language).toBeUndefined();
      expect(requests[0]!.max_buffer_delay_ms).toBe(0);
      sockets[0]!.emit({ type: "chunk", context_id: "fast-llm", data: Buffer.from([1, 2]).toString("base64") });
      sockets[0]!.emit({ type: "done", context_id: "fast-llm" });
      await owner;
      expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2]));
    } finally {
      tts.close();
      await owner.catch(() => {});
    }
  });

  it("speaks every sentence when finalize races ahead of the writes", async () => {
    const sockets: FakeCartesiaWs[] = [];
    vi.stubGlobal("WebSocket", class extends FakeCartesiaWs {
      constructor(url: string) { super(url); sockets.push(this); }
    });
    vi.stubGlobal("fetch", vi.fn());
    const tts = new CartesiaTTS("test-key", null, "sonic-3.6", "en-IN", null, 8000);
    tts.claimTurnContext("race-close");
    const owner = tts.synthesizeStreamInContext("race-close", "One.", () => {}, () => {});
    const join = tts.synthesizeStreamInContext("race-close", " Two.", () => {}, () => {}, undefined, undefined, true);
    // Close the turn before either write has reached the socket. No sentence may
    // be dropped or re-ordered — losing the tail here is the truncation bug.
    tts.finalizeTurnContext("race-close");
    try {
      await join;
      await vi.waitFor(() => expect(sockets[0]?.sent.length).toBeGreaterThanOrEqual(1));
      const spoken = sockets[0]!.sent
        .map((s) => JSON.parse(s) as Record<string, unknown>)
        .filter((r) => r.flush !== true)
        .map((r) => r.transcript as string)
        .join("");
      expect(spoken).toBe("One. Two.");
      const requests = sockets[0]!.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
      expect(requests.filter((r) => r.flush !== true).at(-1)).toMatchObject({ continue: false });
      sockets[0]!.emit({ type: "done", context_id: "race-close" });
      await owner;
    } finally {
      tts.close();
      await owner.catch(() => {});
    }
  });

  it("does not flush complete sentences so Sonic cannot overlap generations (call 25226)", async () => {
    const sockets: FakeCartesiaWs[] = [];
    vi.stubGlobal("WebSocket", class extends FakeCartesiaWs {
      constructor(url: string) { super(url); sockets.push(this); }
    });
    vi.stubGlobal("fetch", vi.fn());
    const tts = new CartesiaTTS("test-key", null, "sonic-3.6", "en-IN", null, 8000);
    tts.claimTurnContext("flushy");
    const owner = tts.synthesizeStreamInContext("flushy", "One.", () => {}, () => {});
    await tts.synthesizeStreamInContext("flushy", " Two.", () => {}, () => {}, undefined, undefined, true);
    await tts.synthesizeStreamInContext("flushy", " Three.", () => {}, () => {}, undefined, undefined, true);
    tts.finalizeTurnContext("flushy");
    try {
      await vi.waitFor(() => expect(sockets[0]?.sent.length).toBeGreaterThanOrEqual(1));
      const requests = sockets[0]!.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
      expect(requests.filter((r) => r.flush === true)).toEqual([]);
      expect(requests.map((r) => r.transcript)).toEqual(["One. Two. Three."]);
      expect(requests.every((r) => r.continue === false)).toBe(true);
      sockets[0]!.emit({ type: "done", context_id: "flushy" });
      await owner;
    } finally {
      tts.close();
      await owner.catch(() => {});
    }
  });

  it("holds incomplete fragments until close so Sonic cannot overlap generations", async () => {
    const sockets: FakeCartesiaWs[] = [];
    vi.stubGlobal("WebSocket", class extends FakeCartesiaWs {
      constructor(url: string) { super(url); sockets.push(this); }
    });
    vi.stubGlobal("fetch", vi.fn());
    const tts = new CartesiaTTS("test-key", null, "sonic-3.6", "en-IN", null, 8000);
    tts.claimTurnContext("frag");
    const owner = tts.synthesizeStreamInContext("frag", "Hello ", () => {}, () => {});
    await tts.synthesizeStreamInContext("frag", "there ", () => {}, () => {}, undefined, undefined, true);
    tts.finalizeTurnContext("frag");
    try {
      await vi.waitFor(() => expect(sockets[0]?.sent.length).toBeGreaterThanOrEqual(1));
      const requests = sockets[0]!.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
      expect(requests.filter((r) => r.flush === true)).toEqual([]);
      expect(requests).toEqual([
        expect.objectContaining({ context_id: "frag", transcript: "Hello there.", continue: false }),
      ]);
      sockets[0]!.emit({ type: "done", context_id: "frag" });
      await owner;
    } finally {
      tts.close();
      await owner.catch(() => {});
    }
  });

  it("speaks the whole turn on one context when Cartesia would have split generations", async () => {
    const sockets: FakeCartesiaWs[] = [];
    vi.stubGlobal("WebSocket", class extends FakeCartesiaWs {
      constructor(url: string) { super(url); sockets.push(this); }
    });
    vi.stubGlobal("fetch", vi.fn());
    const tts = new CartesiaTTS("test-key", null, "sonic-3.6", "en-IN", null, 8000);
    tts.claimTurnContext("reopen");
    const owner = tts.synthesizeStreamInContext("reopen", "First sentence.", () => {}, () => {});
    await tts.synthesizeStreamInContext("reopen", " Second sentence.", () => {}, () => {}, undefined, undefined, true);
    tts.finalizeTurnContext("reopen");
    try {
      await vi.waitFor(() => expect(sockets[0]?.sent.length).toBeGreaterThanOrEqual(1));
      const requests = sockets[0]!.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
      expect(requests.filter((r) => r.flush !== true).map((r) => [r.transcript, r.continue])).toEqual([
        ["First sentence. Second sentence.", false],
      ]);
      sockets[0]!.emit({ type: "done", context_id: "reopen" });
      await owner;
    } finally {
      tts.close();
      await owner.catch(() => {});
    }
  });

  it("speaks Talk over REST when the WebSocket generation errors (fillers-only regression)", async () => {
    const sockets: FakeCartesiaWs[] = [];
    const restBodies: Array<{ transcript?: string; model_id?: string }> = [];
    vi.stubGlobal("WebSocket", class extends FakeCartesiaWs {
      constructor(url: string) { super(url); sockets.push(this); }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        restBodies.push(JSON.parse(init.body as string) as { transcript?: string; model_id?: string });
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(c) { c.enqueue(new Uint8Array([9, 8, 7, 6])); c.close(); },
          }),
        } as unknown as Response;
      }),
    );
    const tts = new CartesiaTTS("test-key", null, "sonic-3.6", "en-IN", null, 8000);
    const chunks: Buffer[] = [];
    tts.claimTurnContext("ws-fail");
    const owner = tts.synthesizeStreamInContext("ws-fail", "What is your name?", (pcm) => chunks.push(pcm), () => {});
    await tts.synthesizeStreamInContext("ws-fail", " Please tell me.", () => {}, () => {}, undefined, undefined, true);
    tts.finalizeTurnContext("ws-fail");
    await vi.waitFor(() => expect(sockets[0]?.sent.length).toBeGreaterThanOrEqual(1));
    sockets[0]!.emit({
      type: "error",
      context_id: "ws-fail",
      error_code: "invalid_request",
      message: "invalid language: en-IN",
    });
    try {
      await owner;
      expect(Buffer.concat(chunks)).toEqual(Buffer.from([9, 8, 7, 6]));
      expect(restBodies.some((b) => (b.transcript ?? "").includes("What is your name?"))).toBe(true);
    } finally {
      tts.close();
      await owner.catch(() => {});
    }
  });

  it("does not send letter BPE on the wire (call 25026)", async () => {
    const sockets: FakeCartesiaWs[] = [];
    vi.stubGlobal("WebSocket", class extends FakeCartesiaWs {
      constructor(url: string) { super(url); sockets.push(this); }
    });
    vi.stubGlobal("fetch", vi.fn());
    const tts = new CartesiaTTS("test-key", null, "sonic-3.6", "en-IN", null, 8000);
    tts.claimTurnContext("spell");
    const owner = tts.synthesizeStreamInContext("spell", "N", () => {}, () => {});
    await tts.synthesizeStreamInContext("spell", "o", () => {}, () => {}, undefined, undefined, true);
    await tts.synthesizeStreamInContext("spell", " problem.", () => {}, () => {}, undefined, undefined, true);
    tts.finalizeTurnContext("spell");
    try {
      await vi.waitFor(() => expect(sockets[0]?.sent.length).toBeGreaterThanOrEqual(1));
      const requests = sockets[0]!.sent.map((s) => JSON.parse(s) as { transcript?: string; continue?: boolean });
      expect(requests.some((r) => r.transcript === "N")).toBe(false);
      expect(requests.some((r) => r.transcript === "o")).toBe(false);
      expect(requests).toContainEqual(expect.objectContaining({ transcript: "No problem.", continue: false }));
      sockets[0]!.emit({ type: "chunk", context_id: "spell", data: Buffer.from([1]).toString("base64") });
      sockets[0]!.emit({ type: "done", context_id: "spell" });
      await owner;
    } finally {
      tts.close();
      await owner.catch(() => {});
    }
  });

  it("holds letter BPE when a join starts before owner pending is registered", async () => {
    const sockets: FakeCartesiaWs[] = [];
    vi.stubGlobal("WebSocket", class extends FakeCartesiaWs {
      constructor(url: string) { super(url); sockets.push(this); }
    });
    vi.stubGlobal("fetch", vi.fn());
    const tts = new CartesiaTTS("test-key", null, "sonic-3.6", "en-IN", null, 8000);
    tts.claimTurnContext("race");
    const owner = tts.synthesizeStreamInContext("race", "N", () => {}, () => {});
    const join = tts.synthesizeStreamInContext("race", "o", () => {}, () => {}, undefined, undefined, true);
    await join;
    await tts.synthesizeStreamInContext("race", " problem.", () => {}, () => {}, undefined, undefined, true);
    tts.finalizeTurnContext("race");
    try {
      await vi.waitFor(() => expect(sockets[0]?.sent.length).toBeGreaterThanOrEqual(1));
      const requests = sockets[0]!.sent.map((s) => JSON.parse(s) as { transcript?: string; continue?: boolean });
      expect(requests.some((r) => r.transcript === "N")).toBe(false);
      expect(requests.some((r) => r.transcript === "o")).toBe(false);
      expect(requests).toContainEqual(expect.objectContaining({ transcript: "No problem.", continue: false }));
      sockets[0]!.emit({ type: "chunk", context_id: "race", data: Buffer.from([1]).toString("base64") });
      sockets[0]!.emit({ type: "done", context_id: "race" });
      await owner;
    } finally {
      tts.close();
      await owner.catch(() => {});
    }
  });

  it("does not send empty transcript:\"\" on finalize (calls 25048/25049)", async () => {
    const sockets: FakeCartesiaWs[] = [];
    vi.stubGlobal("WebSocket", class extends FakeCartesiaWs {
      constructor(url: string) { super(url); sockets.push(this); }
    });
    vi.stubGlobal("fetch", vi.fn());
    const tts = new CartesiaTTS("test-key", null, "sonic-3.6", "en-IN", null, 8000);
    tts.claimTurnContext("empty-llm");
    // An LLM turn that produced no speakable text must not close a context with
    // an empty transcript — Cartesia answers "No valid transcripts passed" and
    // then never emits `done`, so the turn would hang until the idle watchdog.
    const owner = tts.synthesizeStreamInContext("empty-llm", "", () => {}, () => {});
    tts.finalizeTurnContext("empty-llm");
    try {
      await owner;
      const requests = (sockets[0]?.sent ?? []).map((s) => JSON.parse(s) as { transcript?: string; continue?: boolean });
      expect(requests.some((r) => r.continue === false && !r.transcript?.trim())).toBe(false);
    } finally {
      tts.close();
      await owner.catch(() => {});
    }
  });

  it("flushes a held word as continue:false instead of an empty close", async () => {
    const sockets: FakeCartesiaWs[] = [];
    vi.stubGlobal("WebSocket", class extends FakeCartesiaWs {
      constructor(url: string) { super(url); sockets.push(this); }
    });
    vi.stubGlobal("fetch", vi.fn());
    const tts = new CartesiaTTS("test-key", null, "sonic-3.6", "en-IN", null, 8000);
    tts.claimTurnContext("held");
    const owner = tts.synthesizeStreamInContext("held", "Hello", () => {}, () => {});
    tts.finalizeTurnContext("held");
    try {
      await vi.waitFor(() => expect(sockets[0]?.sent.length).toBeGreaterThanOrEqual(1));
      const requests = sockets[0]!.sent.map((s) => JSON.parse(s) as { transcript?: string; continue?: boolean });
      expect(requests.some((r) => r.transcript === "")).toBe(false);
      expect(requests).toContainEqual(expect.objectContaining({ transcript: "Hello.", continue: false }));
      sockets[0]!.emit({ type: "chunk", context_id: "held", data: Buffer.from([1]).toString("base64") });
      sockets[0]!.emit({ type: "done", context_id: "held" });
      await owner;
    } finally {
      tts.close();
      await owner.catch(() => {});
    }
  });

  it("cancels provider synthesis on barge-in", async () => {
    const sockets: FakeCartesiaWs[] = [];
    vi.stubGlobal("WebSocket", class extends FakeCartesiaWs {
      constructor(url: string) { super(url); sockets.push(this); }
    });
    vi.stubGlobal("fetch", vi.fn());
    const tts = new CartesiaTTS("test-key", null, null);
    const abort = new AbortController();
    tts.claimTurnContext("interrupted");
    const owner = tts.synthesizeStreamInContext("interrupted", "Hello there.", () => {}, () => {}, abort.signal);
    const rejected = expect(owner).rejects.toMatchObject({ name: "AbortError" });
    await tts.synthesizeStreamInContext("interrupted", " How are you?", () => {}, () => {}, abort.signal, undefined, true);
    abort.abort();
    tts.finalizeTurnContext("interrupted");
    await rejected;
    const payloads = (sockets[0]?.sent ?? []).map((s) => JSON.parse(s) as Record<string, unknown>);
    // Barge happened before the single close write — nothing is spoken.
    expect(payloads.some((r) => typeof r.transcript === "string")).toBe(false);
    tts.close();
  });

  it("unblocks continuation jobs when barge-in fires before the owner WS opens (call 25042)", async () => {
    vi.stubGlobal("WebSocket", class extends FakeCartesiaWs {
      constructor(url: string) { super(url); }
    });
    vi.stubGlobal("fetch", vi.fn());
    const tts = new CartesiaTTS("test-key", null, null);
    const abort = new AbortController();
    tts.claimTurnContext("hang");
    const join = tts.synthesizeStreamInContext(
      "hang",
      " world",
      () => {},
      () => {},
      abort.signal,
      undefined,
      true,
    );
    abort.abort();
    tts.finalizeTurnContext("hang");
    await expect(join).rejects.toMatchObject({ name: "AbortError" });
    tts.close();
  });
});
