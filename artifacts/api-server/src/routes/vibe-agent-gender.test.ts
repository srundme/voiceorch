import { describe, expect, it } from "vitest";
import {
  filterVoicesByAgentGender,
  inferGenderFromAgentName,
  resolveVoiceGender,
} from "./vibe-agent-gender.js";

describe("inferGenderFromAgentName", () => {
  it("detects common female Indian names", () => {
    expect(inferGenderFromAgentName("Priya")).toBe("female");
    expect(inferGenderFromAgentName("Riya Sharma")).toBe("female");
  });

  it("detects common male names", () => {
    expect(inferGenderFromAgentName("Arjun")).toBe("male");
    expect(inferGenderFromAgentName("Ken")).toBe("male");
  });

  it("returns null for unknown / unisex", () => {
    expect(inferGenderFromAgentName("AlexaBot")).toBe(null);
    expect(inferGenderFromAgentName("Kiran")).toBe(null);
    expect(inferGenderFromAgentName("")).toBe(null);
  });
});

describe("filterVoicesByAgentGender", () => {
  const catalog = [
    { voiceName: "Clara", gender: "female", description: "Middle Aged Female" },
    { voiceName: "Ken", gender: "male", description: "Middle Aged Male" },
    { voiceName: "Ella", gender: "female", description: "Young Female" },
  ];

  it("shows only female voices for Priya", () => {
    const { voices, gender } = filterVoicesByAgentGender(catalog, "Priya");
    expect(gender).toBe("female");
    expect(voices.map((v) => v.voiceName)).toEqual(["Clara", "Ella"]);
  });

  it("shows only male voices for Arjun", () => {
    const { voices } = filterVoicesByAgentGender(catalog, "Arjun");
    expect(voices.map((v) => v.voiceName)).toEqual(["Ken"]);
  });

  it("falls back to full list when name gender is unknown", () => {
    const { voices } = filterVoicesByAgentGender(catalog, "SnapBot");
    expect(voices).toHaveLength(3);
  });

  it("reads gender from description when field is missing", () => {
    expect(resolveVoiceGender("neutral", "Bold and persuasive male voice")).toBe("male");
  });
});
