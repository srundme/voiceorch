import { afterEach, describe, expect, it, vi } from "vitest";
import { OrchestrationPipeline } from "./pipeline.js";
import { InterruptionManager } from "./interruption-manager.js";
import { CartesiaTTS } from "./adapters/tts/cartesia.js";

// Exercise the actual job producer without opening a call, DB session or provider.
// Only dependencies consumed by startSentenceSynthesis are installed on its prototype.
function harness() {
  const p = Object.create(OrchestrationPipeline.prototype) as any;
  p.agent = { ttsProvider: "sarvam" };
  p.config = { callId: 1 };
  p.closed = false;
  p.bargeInRequested = false;
  p.activeTtsAborts = new Set<AbortController>();
  p.ttsContextJobs = new Map();
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
  it("does not label timed-out partial synthesis as a completed utterance", async () => {
    vi.useFakeTimers();
    const { p, sequence } = harness();
    p.tts.synthesizeStream = vi.fn((_text, chunk, _done, signal: AbortSignal) => {
      chunk(Buffer.alloc(320));
      return new Promise<void>((_, reject) => signal.addEventListener("abort", () =>
        reject(Object.assign(new Error("partial timeout"), { name: "AbortError" }))));
    });
    const job = p.startSentenceSynthesis("This has an unsynthesized tail.", 1, sequence);
    await vi.advanceTimersByTimeAsync(60_000);
    await job.ready;
    expect(job.synthError.message).toContain("before synthesis completed");
    expect(p.tts.synthesize).not.toHaveBeenCalled();
  });

  it("starts the provider deadline at dispatch, not while queued", async () => {
    vi.useFakeTimers();
    const { p, sequence } = harness();
    p.tts.synthesisScheduling = "serial";
    let start!: () => void; let done!: () => void; let signal!: AbortSignal;
    p.tts.synthesizeStream = vi.fn((_text, _chunk, _done, ac, _emotions, onStarted) => {
      start = onStarted; signal = ac;
      return new Promise<void>((resolve) => { done = resolve; });
    });
    const job = p.startSentenceSynthesis("Queued reply.", 1, sequence);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(signal.aborted).toBe(false);
    start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(signal.aborted).toBe(false);
    done(); await job.ready;
  });

  it("does not launch a second provider request when its queue deadline expires", async () => {
    vi.useFakeTimers();
    const { p, sequence } = harness();
    p.tts.synthesisScheduling = "serial";
    p.tts.synthesizeStream = vi.fn((_text, _chunk, _done, signal: AbortSignal) =>
      new Promise<void>((_, reject) => signal.addEventListener("abort", () =>
        reject(Object.assign(new Error("cancelled queue"), { name: "AbortError" })))));
    const job = p.startSentenceSynthesis("Queued reply.", 1, sequence);
    await vi.advanceTimersByTimeAsync(30_000); await job.ready;
    expect(job.synthError.message).toContain("queue deadline");
    expect(p.tts.synthesize).not.toHaveBeenCalled();
  });
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

describe("greeting caller input", () => {
  it("retains short replies and interrupts on stop without greeting mute", () => {
    const { p } = harness();
    p.greetingFirstClipActive = true;
    p.greetingPlaybackActive = true;
    p.pendingTranscriptQueue = [];
    p.recentAgentSpeech = [];
    p.isPlaying = true;
    p.triggerBargeIn = vi.fn(() => { p.bargeInRequested = true; });
    expect(p.deferGreetingTranscript("hello", 1, "stt_final")).toBe(true);
    p.deferGreetingTranscript("hello", 1, "stt_final");
    p.deferGreetingTranscript("रुको", 2, "stt_final");
    expect(p.pendingTranscriptQueue.map((x: {text: string}) => x.text)).toEqual(["hello", "रुको"]);
    expect(p.triggerBargeIn).toHaveBeenCalledTimes(1);
    p.greetingFirstClipActive = false; p.greetingPlaybackActive = false;
    expect(p.deferGreetingTranscript("next", 3, "stt_final")).toBe(false);
  });
});

describe("playback evidence", () => {
  it("does not count underrun silence as delivery of the missing speech tail", async () => {
    const { p, sequence } = harness();
    p._processTurnGeneration = null;
    p.recordAgentSpeech = vi.fn(); p.logFn = vi.fn();
    p._currentTurnPlayedSentences = [];
    p.config.awaitPlaybackReceipt = vi.fn(async () => "played");
    p.drainSentenceJob = vi.fn(async () => ({ pacedMs: 1000, speechMs: 100, claimedMs: 400 }));
    await p.playJob({ text: "Only the start was sent.", turnNumber: 1, sequenceId: sequence });
    expect(p._currentTurnPlayedSentences).toEqual([]);
  });

  it("does not add a timer-based tail after awaiting a carrier receipt", async () => {
    vi.useFakeTimers();
    const { p } = harness();
    p.agent.telephonyTailDrainMs = 800;
    p.config.awaitPlaybackReceipt = vi.fn();
    p.config.onAudioOut = vi.fn();
    await p.drainPlaybackTail();
    expect(p.config.onAudioOut).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps all Cartesia continuation text on the acknowledged owner job", async () => {
    const { p, sequence } = harness();
    p.tts = Object.create(CartesiaTTS.prototype);
    p.tts.claimTurnContext = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    let finish!: () => void;
    p.tts.synthesizeStreamInContext = vi.fn((_id, _text, _chunk, _done, _signal, _emotions, skipDrain) =>
      skipDrain ? Promise.resolve() : new Promise<void>((resolve) => { finish = resolve; }));
    const owner = p.startSentenceSynthesis("Hello", 1, sequence, "context");
    p._processTurnGeneration = null;
    p.recordAgentSpeech = vi.fn(); p.logFn = vi.fn();
    p._currentTurnPlayedSentences = [];
    p.config.awaitPlaybackReceipt = vi.fn(async () => "played");
    p.drainSentenceJob = vi.fn(async () => {
      await owner.ready;
      return { pacedMs: 200, claimedMs: 200 };
    });
    const played = p.playJob(owner);
    const continuation = p.startSentenceSynthesis(" there.", 1, sequence, "context");
    expect(continuation.skipDrain).toBe(true);
    expect(owner.text).toBe("Hello there.");
    finish();
    await Promise.all([played, continuation.ready]);
    expect(p._currentTurnPlayedSentences).toEqual(["Hello there."]);
    expect(p._activePlaybackText).toBeNull();
    expect(p.ttsContextJobs.size).toBe(0);
  });

  it.each(["played", "timeout", "cleared", "closed"])("only records completed speech for a played receipt: %s", async (receipt) => {
    const { p, sequence } = harness();
    p._processTurnGeneration = null;
    p.recordAgentSpeech = vi.fn(); p.logFn = vi.fn();
    p._currentTurnPlayedSentences = [];
    p.config.awaitPlaybackReceipt = vi.fn(async () => receipt);
    p.drainSentenceJob = vi.fn(async () => ({ pacedMs: 200, claimedMs: 200 }));
    await p.playJob({ text: "Hello.", turnNumber: 1, sequenceId: sequence, audioDurationMs: 200 });
    expect(p._currentTurnPlayedSentences).toEqual(receipt === "played" ? ["Hello."] : []);
  });
});
