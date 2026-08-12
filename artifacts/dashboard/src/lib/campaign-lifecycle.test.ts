import { describe, it, expect } from "vitest";
import {
  canActivateCampaign,
  canPauseCampaign,
  canResumeCampaign,
  canStopCampaign,
} from "./campaign-lifecycle";

describe("campaign lifecycle helpers", () => {
  it("allows pause from active or listening", () => {
    expect(canPauseCampaign("active")).toBe(true);
    expect(canPauseCampaign("listening")).toBe(true);
    expect(canPauseCampaign("paused")).toBe(false);
  });

  it("allows resume only from paused", () => {
    expect(canResumeCampaign("paused")).toBe(true);
    expect(canResumeCampaign("active")).toBe(false);
  });

  it("allows activate only from stopped", () => {
    expect(canActivateCampaign("stopped")).toBe(true);
    expect(canActivateCampaign("paused")).toBe(false);
  });

  it("allows stop from active, paused, or listening", () => {
    expect(canStopCampaign("active")).toBe(true);
    expect(canStopCampaign("paused")).toBe(true);
    expect(canStopCampaign("listening")).toBe(true);
    expect(canStopCampaign("stopped")).toBe(false);
    expect(canStopCampaign("draft")).toBe(false);
  });
});
