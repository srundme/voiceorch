import { describe, expect, it } from "vitest";
import { decideVobizDuplicateStart } from "./vobiz-duplicate-stream.js";

describe("decideVobizDuplicateStart", () => {
  it("allows the first start when nothing is live or in flight", () => {
    expect(
      decideVobizDuplicateStart({
        callUuid: "uuid-1",
        hasLiveSession: false,
        startInFlight: false,
      }),
    ).toEqual({ close: false });
  });

  it("closes a retry when a live session already owns the CallUUID", () => {
    expect(
      decideVobizDuplicateStart({
        callUuid: "uuid-1",
        hasLiveSession: true,
        startInFlight: false,
      }),
    ).toEqual({ close: true, reason: "live_session" });
  });

  it("closes a concurrent start while the first createSession is still running", () => {
    expect(
      decideVobizDuplicateStart({
        callUuid: "uuid-1",
        hasLiveSession: false,
        startInFlight: true,
      }),
    ).toEqual({ close: true, reason: "start_in_flight" });
  });

  it("does not guard when CallUUID is missing (cannot key a session)", () => {
    expect(
      decideVobizDuplicateStart({
        callUuid: null,
        hasLiveSession: true,
        startInFlight: true,
      }),
    ).toEqual({ close: false });
  });
});
