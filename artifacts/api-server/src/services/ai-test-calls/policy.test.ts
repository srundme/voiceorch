import { describe, it, expect } from "vitest";
import {
  callerLegFailureReason,
  clampTestMaxDuration,
  endSessionSideEffects,
  estimateRunCostCents,
  pickCallerLine,
  samePhone,
  testRunBypassesDestinationGates,
} from "./policy.js";

describe("endSessionSideEffects", () => {
  it("keeps every side effect for real calls", () => {
    const e = endSessionSideEffects(false);
    expect(Object.values(e).every(Boolean)).toBe(true);
  });

  it("keeps billing, usage, judge and disposition for test legs", () => {
    const e = endSessionSideEffects(true);
    expect(e.billing).toBe(true);
    expect(e.usageEvents).toBe(true);
    expect(e.successCriteriaJudge).toBe(true);
    expect(e.disposition).toBe(true);
  });

  it("suppresses customer-facing and analytics side effects for test legs", () => {
    const e = endSessionSideEffects(true);
    expect(e.callerMemory).toBe(false);
    expect(e.webhooks).toBe(false);
    expect(e.campaignHooks).toBe(false);
    expect(e.inboundCampaignMatch).toBe(false);
    expect(e.afterCallMessaging).toBe(false);
    expect(e.sheetsAndCrmPush).toBe(false);
    expect(e.flowTriggers).toBe(false);
    expect(e.rollingAgentStats).toBe(false);
    expect(e.traiOptOutScan).toBe(false);
    expect(e.autoRedial).toBe(false);
  });
});

describe("testRunBypassesDestinationGates", () => {
  it("bypasses only for a valid run dialing its verified own number", () => {
    expect(testRunBypassesDestinationGates({ runId: 7, verifiedOwnNumber: "+918045678901" }, "08045678901")).toBe(true);
  });
  it("never bypasses without a test run", () => {
    expect(testRunBypassesDestinationGates(undefined, "+918045678901")).toBe(false);
  });
  it("never bypasses when the destination differs from the verified number", () => {
    expect(testRunBypassesDestinationGates({ runId: 7, verifiedOwnNumber: "+918045678901" }, "+919999999999")).toBe(false);
  });
  it("never bypasses for an invalid run id", () => {
    expect(testRunBypassesDestinationGates({ runId: 0, verifiedOwnNumber: "+918045678901" }, "+918045678901")).toBe(false);
  });
});

describe("phone helpers", () => {
  it("matches +91 / 0 / bare formats", () => {
    expect(samePhone("+91 80456 78901", "08045678901")).toBe(true);
    expect(samePhone("918045678901", "8045678901")).toBe(true);
    expect(samePhone("", "")).toBe(false);
  });
  it("never picks the destination as the caller line", () => {
    for (let i = 0; i < 20; i++) {
      expect(pickCallerLine(["+918045678901", "+918000000002"], "8045678901")).toBe("+918000000002");
    }
    expect(pickCallerLine(["+918045678901"], "+918045678901")).toBeNull();
  });
});

describe("cost + duration", () => {
  it("estimates both legs at full duration", () => {
    expect(estimateRunCostCents({ maxDurationSeconds: 300, callerRateCentsPerMin: 500, targetRateCentsPerMin: 400 })).toBe(4500);
  });
  it("clamps durations", () => {
    expect(clampTestMaxDuration(undefined)).toBe(300);
    expect(clampTestMaxDuration(5)).toBe(60);
    expect(clampTestMaxDuration(99999)).toBe(900);
  });
});

describe("callerLegFailureReason", () => {
  it("maps carrier outcomes to readable reasons", () => {
    expect(callerLegFailureReason({ status: "busy", durationSeconds: 0, transcript: null })).toMatch(/busy/);
    expect(callerLegFailureReason({ status: "no_pickup", durationSeconds: 0, transcript: null })).toMatch(/did not answer/);
    expect(callerLegFailureReason({ status: "completed", durationSeconds: 3, transcript: "" })).toMatch(/no conversation/);
  });
  it("returns null for a real conversation", () => {
    expect(callerLegFailureReason({ status: "completed", durationSeconds: 60, transcript: "Agent: hi\nCaller: hello there" })).toBeNull();
  });
});
