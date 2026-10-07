import { describe, expect, it, vi } from "vitest";
import { speculativeReplayChat, type SpeculativeReplaySource } from "./speculative-replay.js";

function source(overrides: Partial<SpeculativeReplaySource>): SpeculativeReplaySource {
  return {
    storedTokens: [],
    storedFullText: "",
    tokenSink: () => {},
    completedPromise: Promise.resolve(),
    ...overrides,
  };
}

describe("speculativeReplayChat", () => {
  it("replays buffered text and completes with the full text", async () => {
    const tokens: string[] = [];
    const onDone = vi.fn();
    await speculativeReplayChat(source({ storedTokens: ["சரி", "ங்க"], storedFullText: "சரிங்க" }))(
      [], "", (t) => tokens.push(t), onDone,
    );
    expect(tokens).toEqual(["சரி", "ங்க"]);
    expect(onDone).toHaveBeenCalledWith("சரிங்க");
  });

  it("hands a tool call that finished after commit to the real turn", async () => {
    const onDone = vi.fn();
    const onToolCall = vi.fn();
    await speculativeReplayChat(source({ storedToolCall: { name: "end_call", args: { notes: "no concerns" } } }))(
      [], "", () => {}, onDone, { onToolCall },
    );
    expect(onToolCall).toHaveBeenCalledWith("end_call", { notes: "no concerns" });
    expect(onDone).not.toHaveBeenCalled();
  });
});
