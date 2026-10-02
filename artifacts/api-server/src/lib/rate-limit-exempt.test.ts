import { describe, expect, it } from "vitest";
import { isRateLimitExempt } from "./rate-limit.js";

describe("isRateLimitExempt", () => {
  it("exempts the screenshare viewer poll (with query string)", () => {
    expect(isRateLimitExempt("/api/meet-bots/present-state?mb=abc.def.ghi")).toBe(true);
    expect(isRateLimitExempt("/api/meet-bots/present?mb=abc.def.ghi")).toBe(true);
  });

  it("still rate-limits other meet-bot routes", () => {
    expect(isRateLimitExempt("/api/meet-bots")).toBe(false);
    expect(isRateLimitExempt("/api/meet-bots/some-bot-id")).toBe(false);
  });

  it("keeps existing exemptions", () => {
    expect(isRateLimitExempt("/api/healthz")).toBe(true);
    expect(isRateLimitExempt("/api/meet-bots/recall-events?mb=x")).toBe(true);
  });

  it("exempts the sales pipeline, which applies its own per-session limiter", () => {
    expect(isRateLimitExempt("/api/sales/today?date=2026-10-05")).toBe(true);
    expect(isRateLimitExempt("/api/sales/webhooks/leads")).toBe(true);
    expect(isRateLimitExempt("/api/salesforce")).toBe(false);
  });

  it("does not exempt unrelated routes", () => {
    expect(isRateLimitExempt("/api/agents")).toBe(false);
    expect(isRateLimitExempt("/api/campaigns/1/analytics")).toBe(false);
  });
});
