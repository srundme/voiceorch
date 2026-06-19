import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TurnSafetyNet,
  FORCE_FINALIZE_MS,
  STALL_BACKSTOP_MS,
  STALL_MAX_REPROMPTS,
  recoveryReprompt,
} from "./endpointing.js";
import {
  createStubStreamingSTTPartialsOnly,
  createStubStreamingSTTSilent,
} from "./adapters/stubs.js";

// Deterministic tests for the two-timer turn safety net shared by pipeline.ts
// (telephony) and webcall.ts (browser WS). Driven by the STUB streaming-STT
// adapters that reproduce the two degenerate cases behind the "Listening…" hang.
describe("TurnSafetyNet", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("force-finalizes from the best partial when no STT final arrives (STUB partials-only)", () => {
    const onForceFinalize = vi.fn();
    const onStallReprompt = vi.fn();
    const onStallGiveUp = vi.fn();
    const net = new TurnSafetyNet({ onForceFinalize, onStallReprompt, onStallGiveUp });
    net.beginListening();

    // Wire the stub the same way pipeline/webcall do: partials → onPartial,
    // finals → onFinal. This stub only ever emits partials.
    const stt = createStubStreamingSTTPartialsOnly((text, isFinal) => {
      if (!isFinal) net.onPartial(text);
      else net.onFinal();
    });
    stt.sendAudio(Buffer.alloc(320));
    stt.sendAudio(Buffer.alloc(320));
    stt.sendAudio(Buffer.alloc(320));
    stt.sendAudio(Buffer.alloc(320)); // best partial = "I want to book"

    // Just before the force-finalize deadline — nothing should fire yet.
    vi.advanceTimersByTime(FORCE_FINALIZE_MS - 10);
    expect(onForceFinalize).not.toHaveBeenCalled();

    // Cross the deadline — force-finalize fires with the best partial.
    vi.advanceTimersByTime(20);
    expect(onForceFinalize).toHaveBeenCalledTimes(1);
    expect(onForceFinalize.mock.calls[0]![0]).toBe("I want to book");
    expect(onStallReprompt).not.toHaveBeenCalled();
    expect(onStallGiveUp).not.toHaveBeenCalled();

    net.clear();
  });

  it("reprompts up to STALL_MAX_REPROMPTS then gives up when no transcript ever arrives (STUB silent)", () => {
    const onForceFinalize = vi.fn();
    let net!: TurnSafetyNet;
    // Production re-arms the stall backstop after each reprompt.
    const onStallReprompt = vi.fn(() => net.beginListening());
    const onStallGiveUp = vi.fn();
    net = new TurnSafetyNet({ onForceFinalize, onStallReprompt, onStallGiveUp });

    const stt = createStubStreamingSTTSilent(() => {
      throw new Error("silent stub must not emit");
    });
    stt.sendAudio(Buffer.alloc(320)); // emits nothing

    net.beginListening();
    // Each backstop window expires with no usable transcript.
    for (let i = 0; i < STALL_MAX_REPROMPTS + 1; i++) {
      vi.advanceTimersByTime(STALL_BACKSTOP_MS + 10);
    }

    expect(onStallReprompt).toHaveBeenCalledTimes(STALL_MAX_REPROMPTS);
    expect(onStallGiveUp).toHaveBeenCalledTimes(1);
    expect(onForceFinalize).not.toHaveBeenCalled();
  });

  it("does NOT fire either timer when a turn ends on a real STT final (English/working path unchanged)", () => {
    const onForceFinalize = vi.fn();
    const onStallReprompt = vi.fn();
    const onStallGiveUp = vi.fn();
    const net = new TurnSafetyNet({ onForceFinalize, onStallReprompt, onStallGiveUp });

    net.beginListening();
    net.onPartial("hello"); // a partial arrived (force timer armed)
    net.onFinal();          // real final clears everything

    // Advance well past both thresholds — nothing should ever fire.
    vi.advanceTimersByTime(STALL_BACKSTOP_MS + FORCE_FINALIZE_MS + 1000);
    expect(onForceFinalize).not.toHaveBeenCalled();
    expect(onStallReprompt).not.toHaveBeenCalled();
    expect(onStallGiveUp).not.toHaveBeenCalled();
  });

  it("force-finalize is a no-op on an empty best-partial and falls through to the stall backstop", () => {
    const onForceFinalize = vi.fn();
    const onStallReprompt = vi.fn();
    const onStallGiveUp = vi.fn();
    const net = new TurnSafetyNet({ onForceFinalize, onStallReprompt, onStallGiveUp });

    net.beginListening();
    net.onPartial("   "); // whitespace-only → ignored, no force timer armed

    vi.advanceTimersByTime(FORCE_FINALIZE_MS + 10);
    expect(onForceFinalize).not.toHaveBeenCalled();

    // The stall backstop is still pending and fires the recovery reprompt.
    vi.advanceTimersByTime(STALL_BACKSTOP_MS + 10);
    expect(onStallReprompt).toHaveBeenCalledTimes(1);
  });

  it("clear() cancels both timers (barge-in / teardown)", () => {
    const onForceFinalize = vi.fn();
    const onStallReprompt = vi.fn();
    const onStallGiveUp = vi.fn();
    const net = new TurnSafetyNet({ onForceFinalize, onStallReprompt, onStallGiveUp });

    net.beginListening();
    net.onPartial("partial in flight");
    net.clear();

    vi.advanceTimersByTime(STALL_BACKSTOP_MS + FORCE_FINALIZE_MS + 1000);
    expect(onForceFinalize).not.toHaveBeenCalled();
    expect(onStallReprompt).not.toHaveBeenCalled();
    expect(onStallGiveUp).not.toHaveBeenCalled();
  });
});

describe("recoveryReprompt", () => {
  it("returns a language-specific reprompt and falls back to English", () => {
    expect(recoveryReprompt("ta")).toContain("மீண்டும்");
    expect(recoveryReprompt("ta-IN")).toContain("மீண்டும்"); // BCP-47 prefix stripped
    expect(recoveryReprompt("hi")).toContain("दोबारा");
    expect(recoveryReprompt("zz")).toBe(recoveryReprompt("en")); // unknown → English
    expect(recoveryReprompt(null)).toBe(recoveryReprompt("en"));
    expect(recoveryReprompt("")).toBe(recoveryReprompt("en"));
  });
});
