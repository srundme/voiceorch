import { describe, expect, it } from "vitest";
import { isGhostCallingLead } from "./batchScheduler.js";

const timeoutMs = 15 * 60 * 1000;
const now = new Date("2026-09-19T08:40:00.000Z");

describe("isGhostCallingLead", () => {
  it("treats pre-claimed calling rows with no lastAttemptAt as ghosts", () => {
    expect(isGhostCallingLead({
      callStatus: "calling",
      lastAttemptAt: null,
      callAttempts: 0,
      now,
      timeoutMs,
    })).toBe(true);
  });

  it("does not treat a live calling lead inside the timeout as a ghost", () => {
    expect(isGhostCallingLead({
      callStatus: "calling",
      lastAttemptAt: new Date(now.getTime() - 60_000),
      callAttempts: 1,
      now,
      timeoutMs,
    })).toBe(false);
  });

  it("treats calling leads older than the timeout as ghosts", () => {
    expect(isGhostCallingLead({
      callStatus: "calling",
      lastAttemptAt: new Date(now.getTime() - timeoutMs - 1),
      callAttempts: 1,
      now,
      timeoutMs,
    })).toBe(true);
  });

  it("does not treat pending CSV leads as ghosts", () => {
    expect(isGhostCallingLead({
      callStatus: "pending",
      lastAttemptAt: null,
      callAttempts: 0,
      now,
      timeoutMs,
    })).toBe(false);
  });
});
