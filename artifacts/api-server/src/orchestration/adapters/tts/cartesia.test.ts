import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CartesiaTTS,
  resolveCartesiaModelId,
  parseCartesiaLang,
  cartesiaWireLanguage,
  appendCartesiaRemainder,
  isCartesiaContextClosedError,
  takeCartesiaWordChunks,
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
});

describe("parseCartesiaLang / cartesiaWireLanguage", () => {
  it("splits en-IN and prefers locale on the language field", () => {
    expect(parseCartesiaLang("en-IN")).toEqual({ language: "en", locale: "en-IN" });
    expect(parseCartesiaLang("ta")).toEqual({ language: "ta", locale: "ta-IN" });
    expect(cartesiaWireLanguage("ta", "ta-IN")).toBe("ta-IN");
    expect(cartesiaWireLanguage("en", null)).toBe("en");
  });
});

describe("Cartesia language vs locale", () => {
  it("never sends language and locale together", async () => {
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
    await new CartesiaTTS("k", null, "sonic-3.6", "en-IN").synthesize("Hello");
    expect(bodies[0]).toMatchObject({ language: "en-IN" });
    expect(bodies[0]!.locale).toBeUndefined();
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

  it("sends word chunks then continue:false on the same context", async () => {
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
    tts.finalizeTurnContext("fast-llm");
    try {
      await join;
      await vi.waitFor(() => expect(sockets[0]?.sent.length).toBe(3));
      const requests = sockets[0]!.sent.map((s) => JSON.parse(s));
      expect(requests.map((r) => [r.transcript, r.continue])).toEqual([
        ["नमस्ते।", true], [" आप कैसे हैं?", true], [undefined, false],
      ]);
      expect(requests[0]).toMatchObject({
        model_id: "sonic-3.6",
        max_buffer_delay_ms: 3000,
        voice: { mode: "id", id: expect.any(String) },
        output_format: { sample_rate: 8000 },
      });
      sockets[0]!.emit({ type: "chunk", context_id: "fast-llm", data: Buffer.from([1, 2]).toString("base64") });
      sockets[0]!.emit({ type: "done", context_id: "fast-llm" });
      await owner;
      expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2]));
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
      await vi.waitFor(() => expect(sockets[0]?.sent.length).toBeGreaterThanOrEqual(2));
      const requests = sockets[0]!.sent.map((s) => JSON.parse(s) as { transcript?: string });
      expect(requests.some((r) => r.transcript === "N")).toBe(false);
      expect(requests.some((r) => r.transcript === "o")).toBe(false);
      expect(requests.map((r) => r.transcript)).toContain("No problem.");
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
      await vi.waitFor(() => expect(sockets[0]?.sent.length).toBeGreaterThanOrEqual(2));
      const requests = sockets[0]!.sent.map((s) => JSON.parse(s) as { transcript?: string });
      expect(requests.some((r) => r.transcript === "N")).toBe(false);
      expect(requests.some((r) => r.transcript === "o")).toBe(false);
      expect(requests.map((r) => r.transcript)).toContain("No problem.");
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
    const owner = tts.synthesizeStreamInContext("empty-llm", "", () => {}, () => {});
    tts.finalizeTurnContext("empty-llm");
    try {
      await vi.waitFor(() => expect(sockets[0]).toBeTruthy());
      await new Promise((r) => setTimeout(r, 40));
      const requests = (sockets[0]?.sent ?? []).map((s) => JSON.parse(s) as { transcript?: string; continue?: boolean });
      expect(requests.some((r) => r.transcript === "")).toBe(false);
      expect(requests.filter((r) => r.continue === false && r.transcript == null)).toHaveLength(0);
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
      expect(requests).toContainEqual(expect.objectContaining({ transcript: "Hello", continue: false }));
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
    const owner = tts.synthesizeStreamInContext("interrupted", "Hello.", () => {}, () => {}, abort.signal);
    const rejected = expect(owner).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(sockets[0]?.sent.length).toBe(1));
    abort.abort();
    tts.finalizeTurnContext("interrupted");
    await rejected;
    expect(sockets[0]!.sent.map((s) => JSON.parse(s))).toContainEqual({ context_id: "interrupted", cancel: true });
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
