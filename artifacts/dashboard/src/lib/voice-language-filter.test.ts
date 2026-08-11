import { describe, it, expect } from "vitest";
import {
  filterVoicesForLanguage,
  orderVoicesByLanguage,
  shouldClearVoiceForLanguage,
} from "./agent-providers";

const VOICES = [
  { id: "a", name: "Aditi", language: "hi" },
  { id: "b", name: "Brian", language: "en" },
  { id: "c", name: "Chitra", language: "ta" },
];

describe("filterVoicesForLanguage", () => {
  it("shows every voice to English agents", () => {
    expect(filterVoicesForLanguage(VOICES, "en-US")).toHaveLength(3);
  });

  it("narrows to the agent's language when voices exist for it", () => {
    expect(filterVoicesForLanguage(VOICES, "ta-IN").map(v => v.id)).toEqual(["c"]);
  });

  it("falls back to every voice for languages with no tagged voices", () => {
    expect(filterVoicesForLanguage(VOICES, "mr-IN").map(v => v.id)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty list when there are no voices at all", () => {
    expect(filterVoicesForLanguage([], "mr-IN")).toEqual([]);
  });
});

describe("orderVoicesByLanguage", () => {
  it("puts language matches first without dropping the rest", () => {
    expect(orderVoicesByLanguage(VOICES, "ta-IN").map(v => v.id)).toEqual(["c", "a", "b"]);
  });
});

describe("shouldClearVoiceForLanguage", () => {
  it("keeps a voice the picker offered for a language with no tagged voices", () => {
    expect(shouldClearVoiceForLanguage(VOICES, "a", "mr-IN")).toBe(false);
    expect(shouldClearVoiceForLanguage(VOICES, "b", "mr-IN")).toBe(false);
  });

  it("clears a voice the language does not offer", () => {
    expect(shouldClearVoiceForLanguage(VOICES, "a", "ta-IN")).toBe(true);
  });

  it("keeps a voice the language does offer", () => {
    expect(shouldClearVoiceForLanguage(VOICES, "c", "ta-IN")).toBe(false);
  });

  it("keeps every voice for English agents", () => {
    expect(shouldClearVoiceForLanguage(VOICES, "c", "en-US")).toBe(false);
  });

  it("never clears a user-pasted voice id", () => {
    expect(shouldClearVoiceForLanguage(VOICES, "pasted-uuid", "ta-IN")).toBe(false);
  });

  it("does nothing before the whitelist loads", () => {
    expect(shouldClearVoiceForLanguage([], "a", "ta-IN")).toBe(false);
  });

  it("ignores an empty or placeholder selection", () => {
    expect(shouldClearVoiceForLanguage(VOICES, "", "ta-IN")).toBe(false);
    expect(shouldClearVoiceForLanguage(VOICES, "__custom__", "ta-IN")).toBe(false);
  });

  it("never clears a voice that the picker is showing", () => {
    for (const lang of ["mr-IN", "ta-IN", "hi-IN", "en-US", "or-IN"]) {
      for (const offered of filterVoicesForLanguage(VOICES, lang)) {
        expect(shouldClearVoiceForLanguage(VOICES, offered.id, lang)).toBe(false);
      }
    }
  });
});
