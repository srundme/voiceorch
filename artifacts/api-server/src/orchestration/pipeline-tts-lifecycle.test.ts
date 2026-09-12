import { afterEach, describe, expect, it, vi } from "vitest";
import { OrchestrationPipeline } from "./pipeline.js";
import { InterruptionManager } from "./interruption-manager.js";

// Exercise the actual job producer without opening a call, DB session or provider.
// Only dependencies consumed by startSentenceSynthesis are installed on its prototype.
function harness() {
  const p = Object.create(OrchestrationPipeline.prototype) as any;
  p.agent = { ttsProvider: "sarvam" };
  p.config = { callId: 1 };
  p.closed = false;
  p.bargeInRequested = false;
  p.activeTtsAborts = new Set<AbortController>();
  p.interruptionMgr = new InterruptionManager();
  p.ttsCharactersTotal = 0;
  p._tTurnTtsFirstByte = null;
  p.logExec = vi.fn();
  p.tts = { pcmSampleRate: 8000, synthesize: vi.fn() };
  const sequence = p.interruptionMgr.beginAgentTurn();
  return { p, sequence };
}

function beginNextTurn(p: any) {
  for (const ac of p.activeTtsAborts as Set<AbortController>) ac.abort();
  p.interruptionMgr.beginAgentTurn();
  p.interruptionMgr.pruneStaleSequences();
  p.bargeInRequested = false; // next caller turn has already reset the flag
}

afterEach(() => vi.useRealTimers());

describe("TTS job generation ownership", () => {
  it("does not mistake a late barge-in rejection for a retryable timeout", async () => {
    const { p, sequence } = harness();
    let reject!: (error: Error) => void;
    p.tts.synthesizeStream = vi.fn(() => new Promise<void>((_, r) => { reject = r; }));
    const job = p.startSentenceSynthesis("Old reply.", 1, sequence);
    beginNextTurn(p);
    reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
    await job.ready;
    expect(p.tts.synthesize).not.toHaveBeenCalled();
    expect(job.pcmQueue).toEqual([]);
    expect(p.activeTtsAborts.size).toBe(0);
  });

  it("drops stale provider bytes even after the global interruption flag resets", async () => {
    const { p, sequence } = harness();
    let emit!: (bytes: Buffer) => void;
    let finish!: () => void;
    p.tts.synthesizeStream = vi.fn((_text, chunk) => {
      emit = chunk;
      return new Promise<void>((resolve) => { finish = resolve; });
    });
    const job = p.startSentenceSynthesis("Old reply.", 1, sequence);
    beginNextTurn(p);
    emit(Buffer.alloc(320));
    finish();
    await job.ready;
    expect(job.pcmQueue).toEqual([]);
    expect(p._tTurnTtsFirstByte).toBeNull();
  });

  it("keeps timeout recovery audio duration and byte telemetry", async () => {
    vi.useFakeTimers();
    const { p, sequence } = harness();
    p.tts.synthesizeStream = vi.fn((_text, _chunk, _done, signal: AbortSignal) =>
      new Promise<void>((_, reject) => signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("timeout"), { name: "AbortError" }));
      })));
    p.tts.synthesize.mockResolvedValue({ audio: Buffer.alloc(3200), characters: 10 });
    const job = p.startSentenceSynthesis("New reply.", 1, sequence);
    await vi.advanceTimersByTimeAsync(60_000);
    await job.ready;
    expect(p.tts.synthesize).toHaveBeenCalledTimes(1);
    expect(job.audioDurationMs).toBe(200);
    expect(job.pcmQueue).toHaveLength(1);
    expect(p.logExec).toHaveBeenCalledWith("TTS", "response", expect.objectContaining({
      responsePayload: expect.objectContaining({ audioBytes: 3200 }),
    }));
  });

  it("discards REST recovery that finishes after its sequence was invalidated", async () => {
    vi.useFakeTimers();
    const { p, sequence } = harness();
    let release!: (value: { audio: Buffer }) => void;
    p.tts.synthesize.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    p.tts.synthesizeStream = vi.fn((_text, _chunk, _done, signal: AbortSignal) =>
      new Promise<void>((_, reject) => signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("timeout"), { name: "AbortError" }));
      })));
    const job = p.startSentenceSynthesis("Old reply.", 1, sequence);
    await vi.advanceTimersByTimeAsync(60_000);
    beginNextTurn(p);
    release({ audio: Buffer.alloc(3200) });
    await job.ready;
    expect(job.pcmQueue).toEqual([]);
  });
});
