import { describe, expect, it } from "vitest";
import { ListAgentsResponseItem } from "@workspace/api-zod";
import { applyAsrSmartEndpointing, normalizeAsrSmartEndpointing } from "./agent-response.js";

describe("normalizeAsrSmartEndpointing", () => {
  it("keeps documented modes", () => {
    expect(normalizeAsrSmartEndpointing("off")).toBe("off");
    expect(normalizeAsrSmartEndpointing("vapi")).toBe("vapi");
    expect(normalizeAsrSmartEndpointing("livekit")).toBe("livekit");
  });

  it("maps boolean-style on to vapi so GET /agents does not 500", () => {
    expect(normalizeAsrSmartEndpointing("on")).toBe("vapi");
    expect(normalizeAsrSmartEndpointing("ON")).toBe("vapi");
    expect(normalizeAsrSmartEndpointing("true")).toBe("vapi");
  });

  it("maps unknown / empty values to off", () => {
    expect(normalizeAsrSmartEndpointing(null)).toBe("off");
    expect(normalizeAsrSmartEndpointing("")).toBe("off");
    expect(normalizeAsrSmartEndpointing("maybe")).toBe("off");
  });

  it("normalizes only when the field is present", () => {
    const skip: Record<string, unknown> = { name: "Intake" };
    applyAsrSmartEndpointing(skip);
    expect(skip).toEqual({ name: "Intake" });
    const row: Record<string, unknown> = { asrSmartEndpointing: "on" };
    applyAsrSmartEndpointing(row);
    expect(row["asrSmartEndpointing"]).toBe("vapi");
  });

  it("rejects the raw stored on-value that blanked the Agents page", () => {
    const parsed = ListAgentsResponseItem.safeParse({
      asrSmartEndpointing: "on",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.includes("asrSmartEndpointing"))).toBe(true);
    }
  });
});
