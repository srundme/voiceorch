import { describe, expect, it } from "vitest";
import { savedOpeningTextFor, SAVED_OPENING_TEXT } from "./saved-opening-text.js";

describe("savedOpeningTextFor", () => {
  it("matches the Sruthi opener with the name still in the template", () => {
    expect(savedOpeningTextFor("Sruthi", "Hello, this is {{agent_name}} from Jobshop. How may I assist you?")).toBe(SAVED_OPENING_TEXT);
  });

  it("matches when the name is already filled in", () => {
    expect(savedOpeningTextFor("Sruthi Sharma", SAVED_OPENING_TEXT)).toBe(SAVED_OPENING_TEXT);
  });

  it("leaves every other greeting on the live voice", () => {
    expect(savedOpeningTextFor("Cm vijay", "Vanakam na cm vijay pesura nalla irukingala")).toBeNull();
    expect(savedOpeningTextFor("Sruthi", "Hello, this is Sruthi.")).toBeNull();
  });
});
