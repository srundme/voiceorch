import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const workers = vi.hoisted(() => [] as any[]);
vi.mock("worker_threads", () => ({ Worker: class extends EventEmitter {
  postMessage = vi.fn();
  terminate = vi.fn(async () => 0);
  constructor() { super(); workers.push(this); }
} }));
import { AudioWorkerThread } from "./audioPool.js";
afterEach(() => { vi.useRealTimers(); workers.length = 0; });
const request = (worker: AudioWorkerThread) => worker.process("PROCESS_PCM8K", "call", Buffer.alloc(320), false, 4, 100);

describe("audio worker health", () => {
  it("rejects stranded jobs and replaces a crashed worker", async () => {
    vi.useFakeTimers();
    const worker = new AudioWorkerThread(new URL("file:///unused-worker"));
    const result = expect(request(worker)).rejects.toThrow("crashed");
    workers[0].emit("error", new Error("crashed"));
    await result;
    await expect(request(worker)).rejects.toThrow("unavailable");
    await vi.advanceTimersByTimeAsync(1000);
    expect(workers).toHaveLength(2);
    const next = request(worker);
    const message = workers[1].postMessage.mock.calls[0][0];
    workers[1].emit("message", { id: message.id, pcm8k: new ArrayBuffer(320), pcm16kAb: new ArrayBuffer(640) });
    expect((await next).pcm8k.length).toBe(320);
    expect(worker.pendingCount).toBe(0);
  });
  it("bounds a job whose worker never responds", async () => {
    vi.useFakeTimers();
    const worker = new AudioWorkerThread(new URL("file:///unused-worker"));
    const result = expect(request(worker)).rejects.toThrow("deadline");
    await vi.advanceTimersByTimeAsync(2000);
    await result;
    expect(worker.pendingCount).toBe(0);
  });
});
