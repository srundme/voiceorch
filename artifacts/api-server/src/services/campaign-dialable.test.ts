import { describe, expect, it } from "vitest";
import { csvBatchShouldStartNow, isCampaignDialable } from "./campaign-dialable.js";

describe("csvBatchShouldStartNow", () => {
  const now = new Date("2026-09-10T07:00:00.000Z");

  it("starts now when Launch omits autoStart and there is no schedule", () => {
    expect(csvBatchShouldStartNow({ now })).toBe(true);
  });

  it("starts now when autoStart is true", () => {
    expect(csvBatchShouldStartNow({ autoStart: true, now })).toBe(true);
  });

  it("holds as draft when autoStart is explicitly false", () => {
    expect(csvBatchShouldStartNow({ autoStart: false, now })).toBe(false);
  });

  it("waits when Run At is in the future", () => {
    expect(csvBatchShouldStartNow({
      autoStart: true,
      scheduledStartAt: new Date("2026-09-10T08:00:00.000Z"),
      now,
    })).toBe(false);
  });

  it("starts when Run At is already due", () => {
    expect(csvBatchShouldStartNow({
      scheduledStartAt: new Date("2026-09-10T06:59:00.000Z"),
      now,
    })).toBe(true);
  });
});

describe("isCampaignDialable", () => {
  it("lets a draft CSV campaign dial so a started batch is not starved", () => {
    expect(isCampaignDialable({ status: "draft", isCallingHoursEnabled: false })).toBe(true);
  });

  it("does not dial paused campaigns", () => {
    expect(isCampaignDialable({ status: "paused", isCallingHoursEnabled: false })).toBe(false);
  });
});
