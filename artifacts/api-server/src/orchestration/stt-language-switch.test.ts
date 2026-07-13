import { describe, it, expect } from "vitest";
import { shouldSwitchSttLang } from "./stt-language-switch.js";

describe("shouldSwitchSttLang", () => {
  const empty = { pendingLang: "", pendingCount: 0 };

  it("no-ops when already on target language", () => {
    const r = shouldSwitchSttLang(empty, "en-IN", "en-IN", false);
    expect(r.shouldSwitch).toBe(false);
  });

  it("switches immediately when explicit", () => {
    const r = shouldSwitchSttLang(empty, "en-IN", "ta-IN", true);
    expect(r.shouldSwitch).toBe(true);
    expect(r.gate.pendingCount).toBe(0);
  });

  it("requires two consecutive passive detections", () => {
    const r1 = shouldSwitchSttLang(empty, "en-IN", "ta-IN", false);
    expect(r1.shouldSwitch).toBe(false);
    const r2 = shouldSwitchSttLang(r1.gate, "en-IN", "ta-IN", false);
    expect(r2.shouldSwitch).toBe(true);
  });

  it("resets consecutive count when language changes", () => {
    const r1 = shouldSwitchSttLang(empty, "en-IN", "ta-IN", false);
    const r2 = shouldSwitchSttLang(r1.gate, "hi-IN", "ta-IN", false);
    expect(r2.shouldSwitch).toBe(false);
    expect(r2.gate.pendingCount).toBe(1);
  });
});
