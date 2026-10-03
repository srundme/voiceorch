import { describe, expect, it } from "vitest";
import { AiCousticsCallEnhancer } from "./ai-coustics.js";

describe("AiCousticsCallEnhancer runtime", () => {
  it("reports bypassed with a reason when the license is unset", async () => {
    const enh = new AiCousticsCallEnhancer("t1", {});
    expect(await enh.init()).toBe(false);
    expect(enh.runtime()).toEqual({ state: "bypassed", reason: "AIC_SDK_LICENSE unset", errors: 0 });
  });

  it("passes audio through untouched when not initialised", () => {
    const enh = new AiCousticsCallEnhancer("t2", {});
    const frame = Buffer.alloc(320, 3);
    expect(enh.processPcm8k(frame)).toBe(frame);
  });

  it("returns the raw frame and counts the error when the processor throws", () => {
    const enh = new AiCousticsCallEnhancer("t3", {});
    const internals = enh as unknown as { ready: boolean; processor: { process: () => void } };
    internals.ready = true;
    internals.processor = { process: () => { throw new Error("boom"); } };
    const frame = Buffer.alloc(320, 5);
    expect(enh.processPcm8k(frame)).toBe(frame);
    expect(enh.runtime()).toEqual({ state: "active", errors: 1, reason: "boom" });
  });
});
