import { describe, expect, it } from "vitest";
import { refuseSilentPhoneMove } from "./voice-number-assign-policy.js";

describe("refuseSilentPhoneMove", () => {
  it("allows attaching a free number", () => {
    expect(refuseSilentPhoneMove(null, 2, false)).toBe(false);
  });

  it("allows attaching when the number is already on the same agent", () => {
    expect(refuseSilentPhoneMove(2, 2, false)).toBe(false);
  });

  it("blocks vibe/assistant from taking another agent's number", () => {
    expect(refuseSilentPhoneMove(1, 2, false)).toBe(true);
  });

  it("allows an explicit Phone Numbers reassign", () => {
    expect(refuseSilentPhoneMove(1, 2, true)).toBe(false);
  });
});
