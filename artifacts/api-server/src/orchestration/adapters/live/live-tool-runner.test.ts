import { describe, expect, it } from "vitest";
import { liveToolTimeoutMs } from "./live-tool-timeout.js";

describe("liveToolTimeoutMs", () => {
  it("gives calendar tools 45s so GCal/slot work is not killed at 15s", () => {
    expect(liveToolTimeoutMs("native_booking")).toBe(45_000);
    expect(liveToolTimeoutMs("native_check_availability")).toBe(45_000);
    expect(liveToolTimeoutMs("native_reschedule")).toBe(45_000);
    expect(liveToolTimeoutMs("native_cancel")).toBe(45_000);
  });

  it("keeps the generic Live tool cap for other tools", () => {
    expect(liveToolTimeoutMs("send_email")).toBe(15_000);
    expect(liveToolTimeoutMs("webhook")).toBe(15_000);
  });
});
