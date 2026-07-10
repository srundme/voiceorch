import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SilenceWatchdog } from "./endpointing.js";

// The silence-hangup watchdog (call 1915): raw caller speech energy must keep
// the timer alive even when streaming STT emits no partials/finals, agent
// busyness counts as activity, and a legitimate expiry speaks an audible
// check-in before giving up.

const TIMEOUT = 10_000;

function makeWatchdog(overrides: Partial<ConstructorParameters<typeof SilenceWatchdog>[0]> = {}) {
  const onReprompt = vi.fn();
  const onGiveUp = vi.fn();
  const wd = new SilenceWatchdog({
    timeoutMs: TIMEOUT,
    onReprompt,
    onGiveUp,
    ...overrides,
  });
  return { wd, onReprompt, onGiveUp };
}

describe("SilenceWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reprompts once, then gives up after a further full silent window", () => {
    const { wd, onReprompt, onGiveUp } = makeWatchdog();
    wd.reset();

    vi.advanceTimersByTime(TIMEOUT);
    expect(onReprompt).toHaveBeenCalledTimes(1);
    expect(onGiveUp).not.toHaveBeenCalled();

    vi.advanceTimersByTime(TIMEOUT);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(onReprompt).toHaveBeenCalledTimes(1);
    wd.clear();
  });

  it("raw speech energy keeps it alive without resetting the timer eagerly (call 1915)", () => {
    const { wd, onReprompt, onGiveUp } = makeWatchdog();
    wd.reset();

    // Caller audibly speaks 8s in — streaming STT silent (no partials).
    vi.advanceTimersByTime(8_000);
    wd.onSpeechEnergy();

    // Original expiry point: must NOT fire — re-arms the remainder instead.
    vi.advanceTimersByTime(2_000);
    expect(onReprompt).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();

    // Full window measured from the last speech energy → reprompt fires then.
    vi.advanceTimersByTime(8_000);
    expect(onReprompt).toHaveBeenCalledTimes(1);
    expect(onGiveUp).not.toHaveBeenCalled();
    wd.clear();
  });

  it("speech energy clears the check-in count (a reprompted caller who speaks gets a fresh cycle)", () => {
    const { wd, onReprompt, onGiveUp } = makeWatchdog();
    wd.reset();

    vi.advanceTimersByTime(TIMEOUT);
    expect(onReprompt).toHaveBeenCalledTimes(1);

    // Caller responds with audible speech (still no transcript).
    wd.onSpeechEnergy();
    vi.advanceTimersByTime(TIMEOUT);
    // Instead of giving up, a fresh check-in cycle begins.
    expect(onGiveUp).not.toHaveBeenCalled();
    expect(onReprompt).toHaveBeenCalledTimes(2);
    wd.clear();
  });

  it("treats agent busyness as activity and re-arms in full", () => {
    let busy = true;
    const { wd, onReprompt, onGiveUp } = makeWatchdog({ isBusy: () => busy });
    wd.reset();

    vi.advanceTimersByTime(TIMEOUT);
    expect(onReprompt).not.toHaveBeenCalled();

    busy = false;
    vi.advanceTimersByTime(TIMEOUT);
    expect(onReprompt).toHaveBeenCalledTimes(1);
    expect(onGiveUp).not.toHaveBeenCalled();
    wd.clear();
  });

  it("reset() clears the check-in count (usable transcript = fresh cycle)", () => {
    const { wd, onReprompt, onGiveUp } = makeWatchdog();
    wd.reset();

    vi.advanceTimersByTime(TIMEOUT);
    expect(onReprompt).toHaveBeenCalledTimes(1);

    wd.reset(); // real transcript arrived
    vi.advanceTimersByTime(TIMEOUT);
    expect(onReprompt).toHaveBeenCalledTimes(2);
    expect(onGiveUp).not.toHaveBeenCalled();
    wd.clear();
  });

  it("clear() stops everything", () => {
    const { wd, onReprompt, onGiveUp } = makeWatchdog();
    wd.reset();
    wd.clear();
    vi.advanceTimersByTime(TIMEOUT * 3);
    expect(onReprompt).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("fires onNearMiss with cause=recent_speech_energy on a speech-driven re-arm", () => {
    const onNearMiss = vi.fn();
    const { wd } = makeWatchdog({ onNearMiss });
    wd.reset();

    vi.advanceTimersByTime(8_000);
    wd.onSpeechEnergy();
    vi.advanceTimersByTime(2_000);

    expect(onNearMiss).toHaveBeenCalledTimes(1);
    expect(onNearMiss).toHaveBeenCalledWith(
      expect.objectContaining({ cause: "recent_speech_energy", msSinceLastSpeech: 2_000, rearmedForMs: 8_000 }),
    );
    wd.clear();
  });

  it("fires onNearMiss with cause=busy while the agent is speaking/processing", () => {
    const onNearMiss = vi.fn();
    let busy = true;
    const { wd } = makeWatchdog({ isBusy: () => busy, onNearMiss });
    wd.reset();

    vi.advanceTimersByTime(TIMEOUT);
    expect(onNearMiss).toHaveBeenCalledTimes(1);
    expect(onNearMiss).toHaveBeenCalledWith(
      expect.objectContaining({ cause: "busy", msSinceLastSpeech: null, rearmedForMs: TIMEOUT }),
    );

    busy = false;
    wd.clear();
  });

  it("does not fire onNearMiss on a genuine expiry (reprompt or give-up)", () => {
    const onNearMiss = vi.fn();
    const { wd } = makeWatchdog({ onNearMiss });
    wd.reset();

    vi.advanceTimersByTime(TIMEOUT);
    vi.advanceTimersByTime(TIMEOUT);
    expect(onNearMiss).not.toHaveBeenCalled();
    wd.clear();
  });

  it("honors maxReprompts", () => {
    const { wd, onReprompt, onGiveUp } = makeWatchdog({ maxReprompts: 2 });
    wd.reset();
    vi.advanceTimersByTime(TIMEOUT);
    vi.advanceTimersByTime(TIMEOUT);
    expect(onReprompt).toHaveBeenCalledTimes(2);
    expect(onGiveUp).not.toHaveBeenCalled();
    vi.advanceTimersByTime(TIMEOUT);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    wd.clear();
  });
});
