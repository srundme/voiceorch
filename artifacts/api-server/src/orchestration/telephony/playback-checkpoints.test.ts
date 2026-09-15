import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaybackCheckpoints } from "./playback-checkpoints.js";

afterEach(() => vi.useRealTimers());
describe("carrier playback receipts", () => {
  it("matches acknowledgements by unique name, not order", async () => {
    const send = vi.fn();
    const ledger = new PlaybackCheckpoints(send);
    const a = ledger.wait(); const b = ledger.wait();
    ledger.acknowledge("unknown");
    ledger.acknowledge(send.mock.calls[1]![0]);
    await expect(b).resolves.toBe("played");
    ledger.acknowledge(send.mock.calls[0]![0]);
    await expect(a).resolves.toBe("played");
  });
  it("invalidates cleared turns and ignores late acknowledgements", async () => {
    const send = vi.fn(); const ledger = new PlaybackCheckpoints(send);
    const old = ledger.wait(); ledger.clear();
    await expect(old).resolves.toBe("cleared");
    const next = ledger.wait();
    ledger.acknowledge(send.mock.calls[0]![0]);
    ledger.close();
    await expect(next).resolves.toBe("closed");
    await expect(ledger.wait()).resolves.toBe("closed");
  });
  it("bounds missing acknowledgements without falsely reporting playback", async () => {
    vi.useFakeTimers(); const ledger = new PlaybackCheckpoints(vi.fn(), 100);
    const receipt = ledger.wait();
    await vi.advanceTimersByTimeAsync(100);
    await expect(receipt).resolves.toBe("timeout");
    expect(vi.getTimerCount()).toBe(0);
  });
});
