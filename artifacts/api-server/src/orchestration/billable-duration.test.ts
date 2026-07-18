import { describe, expect, it } from "vitest";
import { resolveBillableDurationSeconds } from "./billable-duration.js";

describe("resolveBillableDurationSeconds", () => {
  const startedAtMs = 1_000_000;

  it("falls back to wall-clock when no media/recording signal", () => {
    expect(
      resolveBillableDurationSeconds({
        wallClockSeconds: 480,
        startedAtMs,
        lastMediaAtMs: null,
        recordingSeconds: null,
      }),
    ).toBe(480);
  });

  it("does not charge idle keepalive after a short conversation (call #3234 class)", () => {
    // ~2:02 of talk, session lingered to default maxDuration 8:00
    const lastMediaAtMs = startedAtMs + 122_000;
    expect(
      resolveBillableDurationSeconds({
        wallClockSeconds: 480,
        startedAtMs,
        lastMediaAtMs,
        recordingSeconds: 122,
        idleGraceSeconds: 10,
      }),
    ).toBe(132); // 122 + 10 grace, not 480
  });

  it("never exceeds wall-clock", () => {
    expect(
      resolveBillableDurationSeconds({
        wallClockSeconds: 90,
        startedAtMs,
        lastMediaAtMs: startedAtMs + 200_000,
        recordingSeconds: 200,
        idleGraceSeconds: 10,
      }),
    ).toBe(90);
  });

  it("uses the longer of media vs recording before capping", () => {
    expect(
      resolveBillableDurationSeconds({
        wallClockSeconds: 600,
        startedAtMs,
        lastMediaAtMs: startedAtMs + 100_000,
        recordingSeconds: 150,
        idleGraceSeconds: 10,
      }),
    ).toBe(160); // recording 150 + grace
  });

  it("returns 0 for zero wall-clock", () => {
    expect(
      resolveBillableDurationSeconds({
        wallClockSeconds: 0,
        startedAtMs,
        lastMediaAtMs: startedAtMs + 5_000,
        recordingSeconds: 5,
      }),
    ).toBe(0);
  });
});
