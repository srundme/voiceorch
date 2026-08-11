import { describe, it, expect } from "vitest";
import { filterVoicesForLanguage, orderVoicesByLanguage } from "./agent-providers";

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
