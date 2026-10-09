import { describe, expect, it } from "vitest";
import { executionIdSearchPattern, parseCallLookup } from "./admin-call-lookup.js";

describe("parseCallLookup", () => {
  it("reads a numeric call id", () => {
    expect(parseCallLookup("13919")).toEqual({ kind: "id", id: 13919 });
    expect(parseCallLookup(" 13919 ")).toEqual({ kind: "id", id: 13919 });
  });

  it("reads a full execution id", () => {
    expect(parseCallLookup("exec_1a2b3c4d")).toEqual({ kind: "execution", executionId: "exec_1a2b3c4d" });
    expect(parseCallLookup("EXEC_1A2B3C4D")).toEqual({ kind: "execution", executionId: "exec_1a2b3c4d" });
  });

  it("reads a bare execution suffix pasted without the prefix", () => {
    expect(parseCallLookup("1a2b3c4d")).toEqual({ kind: "execution", executionId: "1a2b3c4d" });
  });

  it("reads phone numbers with 10 digits or plus prefix", () => {
    expect(parseCallLookup("8754584433")).toEqual({ kind: "phone", phone: "8754584433" });
    expect(parseCallLookup("+919886280424")).toEqual({ kind: "phone", phone: "919886280424" });
  });

  it("rejects empty or unusable input", () => {
    expect(parseCallLookup("")).toBeNull();
    expect(parseCallLookup("   ")).toBeNull();
    expect(parseCallLookup(null)).toBeNull();
    expect(parseCallLookup("exec_")).toBeNull();
    expect(parseCallLookup("0")).toBeNull();
    expect(parseCallLookup("murali@example.com")).toBeNull();
  });
});

describe("executionIdSearchPattern", () => {
  it("matches on the suffix so both paste styles find the call", () => {
    expect(executionIdSearchPattern("exec_1a2b3c4d")).toBe("%1a2b3c4d%");
    expect(executionIdSearchPattern("1a2b3c4d")).toBe("%1a2b3c4d%");
  });
});
