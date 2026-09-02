import { describe, expect, it } from "vitest";
import { FILLER_SEQUENCE_ID } from "./interruption-manager.js";
import { shouldSkipImmediateBackchannel, ttsContextIdForSequence } from "./filler-playback.js";

describe("ttsContextIdForSequence", () => {
  const turnCtx = "turn-ctx-17487";

  it("keeps the Cartesia turn context for Talk sentences", () => {
    expect(ttsContextIdForSequence(7, turnCtx, FILLER_SEQUENCE_ID)).toBe(turnCtx);
  });

  it("does not let a backchannel/dead-air filler claim the Cartesia turn", () => {
    expect(ttsContextIdForSequence(FILLER_SEQUENCE_ID, turnCtx, FILLER_SEQUENCE_ID)).toBeUndefined();
  });

  it("stays undefined when the turn has no Cartesia context", () => {
    expect(ttsContextIdForSequence(1, undefined, FILLER_SEQUENCE_ID)).toBeUndefined();
  });
});

describe("shouldSkipImmediateBackchannel", () => {
  it("skips Mm-hmm when eager/speculative LLM is already generating (call 17487)", () => {
    expect(shouldSkipImmediateBackchannel(true)).toBe(true);
  });

  it("allows backchannel when no speculative LLM is in flight", () => {
    expect(shouldSkipImmediateBackchannel(false)).toBe(false);
  });
});
