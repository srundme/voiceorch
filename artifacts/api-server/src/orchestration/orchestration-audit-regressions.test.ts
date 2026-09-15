import { afterEach, describe, expect, it, vi } from "vitest";
import { CartesiaTTS } from "./adapters/tts/cartesia.js";
import { SarvamLLM } from "./adapters/llm/sarvam.js";
import { cartesiaUnspokenTail } from "./cartesia-token-coalesce.js";
import { fetchUserConfiguredUrl } from "../lib/ssrf.js";
import { OrchestrationPipeline } from "./pipeline.js";
import { callDrainMs } from "./lifecycle.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("orchestration audit regressions", () => {
  it("does not repeat a spoken suffix after normalization changes", () => {
    expect(cartesiaUnspokenTail("Hello, world!", "Hello world!")).toBe("");
    expect(cartesiaUnspokenTail("Hello", "Hello world!")).toBe(" world!");
  });

  it("does not retry a customer POST even when a retry was requested", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    const result = await fetchUserConfiguredUrl("https://93.184.216.34/action", { method: "POST", body: "{}" }, { retries: 2 });
    expect(result.status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps safe-read retries", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(new Response("ok"));
    vi.stubGlobal("fetch", fetcher);
    expect((await fetchUserConfiguredUrl("https://93.184.216.34/action", {}, { retries: 1 })).ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("records an error-bearing tool return as error, not success", async () => {
    const p = Object.create(OrchestrationPipeline.prototype) as any;
    Object.assign(p, { _activeTurnIndex: 1, logExec: vi.fn(), logFn: vi.fn(),
      handleToolCallInner: async () => "error: webhook tool failed to execute" });
    await p.handleToolCall("webhook", {});
    expect(p.logExec).toHaveBeenCalledWith("Tool", "response", expect.objectContaining({ status: "error" }));
    expect(p.logExec.mock.calls.some((c: any[]) => c[2].status === "success")).toBe(false);
  });

  it("does not revive a closed call for a late tool result", async () => {
    const p = Object.create(OrchestrationPipeline.prototype) as any;
    p.closed = true;
    p.conversationHistory = { appendToolResult: vi.fn() };
    await p.continueWithToolResult("book", "booked", 0, "tool-1");
    expect(p.conversationHistory.appendToolResult).not.toHaveBeenCalled();
  });

  it("pins voice/language/generation settings throughout a Cartesia context", () => {
    const tts = new CartesiaTTS("test", null, "sonic-3.6", "ta-IN", null) as any;
    const first = tts.settingsForContext("ctx", ["positivity:low"]);
    tts.setLanguage("en-IN");
    expect(tts.settingsForContext("ctx", ["anger:high"])).toBe(first);
    expect(first.add_timestamps).toBe(true);
    expect(first.voice.mode).toBe("id");
    expect(tts.settingsForContext("next")).not.toBe(first);
  });

  it("uses only timestamped words behind the carrier-confirmed audio offset", () => {
    const tts = new CartesiaTTS("test", null, "sonic-3.6", "ta-IN", null) as any;
    tts.settingsForContext("ctx");
    tts.handleWsMessage(JSON.stringify({ type: "timestamps", context_id: "ctx",
      word_timestamps: { words: ["Hello", "world"], end: [0.4, 0.9] } }));
    expect(tts.playedText("ctx", 500)).toBe("Hello");
    expect(tts.playedText("ctx", 100)).toBe("");
    const p = Object.create(OrchestrationPipeline.prototype) as any;
    Object.assign(p, { config: { awaitPlaybackReceipt: () => {} },
      _currentTurnPlayedSentences: ["Previous sentence."], activeConfirmedPlaybackText: "Hello" });
    expect(p.getHeardAgentText()).toContain("Hello");
    expect(p.getHeardAgentText()).not.toContain("world");
  });

  it("bounds a Sarvam stream that stalls after tokens and never emits completion", async () => {
    vi.useFakeTimers();
    const done = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(c) {
      c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
    } }))));
    const result = new SarvamLLM("test", null).chat([], "", () => {}, done);
    const rejected = expect(result).rejects.toThrow("stalled");
    await vi.advanceTimersByTimeAsync(15001);
    await rejected;
    expect(done).not.toHaveBeenCalled();
  });

  it("bounds the configurable deployment drain window", () => {
    expect(callDrainMs("300000")).toBe(300000);
    expect(callDrainMs("bad")).toBe(300000);
    expect(callDrainMs("-1")).toBe(0);
    expect(callDrainMs("99999999")).toBe(1800000);
  });
});
