export type PlaybackReceipt = "played" | "cleared" | "closed" | "timeout";

/** Per-socket ledger. Unknown/late acknowledgements cannot resolve another turn. */
export class PlaybackCheckpoints {
  private nextId = 0;
  private closed = false;
  private pending = new Map<string, (receipt: PlaybackReceipt) => void>();

  constructor(private send: (name: string) => void, private timeoutMs = 2000) {}

  wait(): Promise<PlaybackReceipt> {
    if (this.closed) return Promise.resolve("closed");
    const name = `voiceorch-playback-${++this.nextId}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle("timeout"), this.timeoutMs);
      const settle = (receipt: PlaybackReceipt) => {
        clearTimeout(timer);
        this.pending.delete(name);
        resolve(receipt);
      };
      this.pending.set(name, settle);
      try { this.send(name); } catch { settle("closed"); }
    });
  }

  acknowledge(name: string): void { this.pending.get(name)?.("played"); }
  clear(): void { for (const settle of [...this.pending.values()]) settle("cleared"); }
  close(): void {
    this.closed = true;
    for (const settle of [...this.pending.values()]) settle("closed");
  }
}
