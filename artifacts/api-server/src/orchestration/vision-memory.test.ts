import { describe, expect, it } from "vitest";
import {
  CallVisionMemory,
  appendVisionCommonSense,
  buildVisionCommonSenseBlock,
  extractKnownCallerNameFromPrompt,
} from "./vision-memory.js";

describe("vision common sense", () => {
  it("appends once", () => {
    const once = appendVisionCommonSense("base");
    expect(once).toContain("[VISION COMMON SENSE");
    expect(appendVisionCommonSense(once)).toBe(once);
  });

  it("mentions multi-person rule", () => {
    expect(buildVisionCommonSenseBlock()).toMatch(/wife|DIFFERENT identity/i);
  });
});

describe("extractKnownCallerNameFromPrompt", () => {
  it("reads CALLER MEMORY name", () => {
    const prompt = "hi\n\n=== CALLER MEMORY ===\nName: Karthik  |  Calls: 2\n";
    expect(extractKnownCallerNameFromPrompt(prompt)).toBe("Karthik");
  });

  it("ignores unknown", () => {
    expect(extractKnownCallerNameFromPrompt("=== CALLER MEMORY ===\nName: unknown\n")).toBeNull();
  });
});

describe("CallVisionMemory", () => {
  it("tracks wife introduction without stealing primary name", () => {
    const mem = new CallVisionMemory("Karthik");
    mem.observeUserSpeech("This is my wife Priya, she wants to talk");
    const block = mem.formatPromptBlock();
    expect(block).toContain("primary_caller: Karthik");
    expect(block).toMatch(/spouse: Priya/i);
    expect(block).toMatch(/currently focus/i);
    expect(mem.toFamilyMembersFact()).toMatch(/Priya/i);
  });

  it("records role-only introduction", () => {
    const mem = new CallVisionMemory("Ravi");
    mem.observeUserSpeech("I am giving the phone to my wife");
    const snap = mem.snapshot();
    expect(snap.people.some((p) => p.role === "spouse")).toBe(true);
  });

  it("stores visual notes", () => {
    const mem = new CallVisionMemory();
    mem.noteVisualFinding("Two people visible; woman holding an ID card");
    expect(mem.formatPromptBlock()).toContain("Two people visible");
  });
});
