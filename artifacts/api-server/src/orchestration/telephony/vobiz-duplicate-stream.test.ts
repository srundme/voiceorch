import { describe, expect, it } from "vitest";
import { decideVobizDuplicateStart, vobizDuplicateLegKey } from "./vobiz-duplicate-stream.js";

describe("vobizDuplicateLegKey", () => {
  it("prefers campaign lead over corr token", () => {
    expect(vobizDuplicateLegKey({ campaignLeadId: 42, corrToken: "abc" })).toBe("lead:42");
  });

  it("falls back to corr token when there is no lead", () => {
    expect(vobizDuplicateLegKey({ corrToken: "abc" })).toBe("corr:abc");
  });
});

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

  it("closes a second stream for the same campaign lead even when CallUUIDs differ", () => {
    expect(
      decideVobizDuplicateStart({
        callUuid: "uuid-b",
        hasLiveSession: false,
        startInFlight: false,
        legKey: "lead:99",
        hasLiveLeg: false,
        legStartInFlight: true,
      }),
    ).toEqual({ close: true, reason: "leg_in_flight" });
  });

  it("does not guard when CallUUID and leg key are both missing", () => {
    expect(
      decideVobizDuplicateStart({
        callUuid: null,
        hasLiveSession: true,
        startInFlight: true,
      }),
    ).toEqual({ close: false });
  });
});
