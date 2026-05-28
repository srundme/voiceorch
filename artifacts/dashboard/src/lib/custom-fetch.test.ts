import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { customFetch, RequestTimeoutError } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("customFetch — timeout behaviour", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("resolves normally when the server responds before the timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeJsonResponse({ ok: true })),
    );

    const promise = customFetch<{ ok: boolean }>("/api/test", { timeoutMs: 5_000 });
    vi.runAllTimers();
    const result = await promise;

    expect(result).toEqual({ ok: true });
  });

  it("throws RequestTimeoutError when the timeout fires before the server responds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_input: RequestInfo | URL, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            if (init?.signal) {
              init.signal.addEventListener("abort", () => {
                const err = new DOMException("The operation was aborted.", "AbortError");
                reject(err);
              });
            }
          }),
      ),
    );

    const promise = customFetch("/api/slow", { timeoutMs: 3_000 });
    vi.advanceTimersByTime(3_000);

    await expect(promise).rejects.toBeInstanceOf(RequestTimeoutError);
  });

  it("RequestTimeoutError message mentions the timeout duration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_input: RequestInfo | URL, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            if (init?.signal) {
              init.signal.addEventListener("abort", () => {
                reject(new DOMException("aborted", "AbortError"));
              });
            }
          }),
      ),
    );

    const promise = customFetch("/api/slow", { timeoutMs: 10_000 });
    vi.advanceTimersByTime(10_000);

    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RequestTimeoutError);
    expect((err as RequestTimeoutError).message).toContain("10000");
  });

  it("does not throw RequestTimeoutError when the caller aborts their own signal", async () => {
    const callerController = new AbortController();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_input: RequestInfo | URL, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            if (init?.signal) {
              init.signal.addEventListener("abort", () => {
                reject(new DOMException("aborted", "AbortError"));
              });
            }
          }),
      ),
    );

    const promise = customFetch("/api/slow", {
      timeoutMs: 30_000,
      signal: callerController.signal,
    });

    // Caller cancels — this should NOT be wrapped as RequestTimeoutError
    callerController.abort();

    const err = await promise.catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(RequestTimeoutError);
    expect((err as Error).name).toBe("AbortError");
  });

  it("disables the timeout when timeoutMs is 0", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse({ ok: true }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await customFetch<{ ok: boolean }>("/api/test", { timeoutMs: 0 });
    expect(result).toEqual({ ok: true });

    // No AbortSignal passed when timeout is disabled
    const [, init] = mockFetch.mock.calls[0] as [unknown, RequestInit];
    expect(init.signal).toBeUndefined();
  });

  it("disables the timeout when timeoutMs is Infinity", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse({ ok: true }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await customFetch<{ ok: boolean }>("/api/test", { timeoutMs: Infinity });
    expect(result).toEqual({ ok: true });

    const [, init] = mockFetch.mock.calls[0] as [unknown, RequestInit];
    expect(init.signal).toBeUndefined();
  });
});
