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

  it("shows every voice for a specific language, with matches first", () => {
    expect(filterVoicesForLanguage(VOICES, "ta-IN").map(v => v.id)).toEqual(["c", "a", "b"]);
  });

  it("shows every voice for languages with no tagged voices", () => {
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

  it("puts Hindi matches first", () => {
    expect(orderVoicesByLanguage(VOICES, "hi-IN").map(v => v.id)).toEqual(["a", "b", "c"]);
  });

  it("sorts each group by name, ignoring case and database order", () => {
    const shuffled = [
      { id: "s", name: "Shivaram", language: "ta" },
      { id: "k", name: "karthikeyan", language: "en" },
      { id: "a", name: "Aarthi", language: "ta" },
      { id: "m", name: "Mahesh", language: "en" },
    ];
    expect(orderVoicesByLanguage(shuffled, "ta-IN").map(v => v.id)).toEqual(["a", "s", "k", "m"]);
    expect(orderVoicesByLanguage(shuffled, "en-IN").map(v => v.id)).toEqual(["a", "k", "m", "s"]);
  });
});

describe("shouldClearVoiceForLanguage", () => {
  it("never clears a curated voice when the full catalog is offered", () => {
    expect(shouldClearVoiceForLanguage(VOICES, "a", "mr-IN")).toBe(false);
    expect(shouldClearVoiceForLanguage(VOICES, "b", "mr-IN")).toBe(false);
    expect(shouldClearVoiceForLanguage(VOICES, "a", "ta-IN")).toBe(false);
    expect(shouldClearVoiceForLanguage(VOICES, "c", "ta-IN")).toBe(false);
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
