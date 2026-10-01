import { describe, expect, it } from "vitest";
import { matchesReplyKeyword } from "./flow-triggers.js";

describe("matchesReplyKeyword", () => {
  it("matches any message when no keyword is set", () => {
    expect(matchesReplyKeyword(undefined, "hello")).toBe(true);
    expect(matchesReplyKeyword(" , ", "hello")).toBe(true);
  });

  it("matches any comma-separated word, case-insensitive", () => {
    expect(matchesReplyKeyword("yes, interested", "YES please")).toBe(true);
    expect(matchesReplyKeyword("yes, interested", "I am Interested")).toBe(true);
    expect(matchesReplyKeyword("yes, interested", "no thanks")).toBe(false);
  });

  it("also checks the button id", () => {
    expect(matchesReplyKeyword("book", "", "BOOK_SLOT")).toBe(true);
  });
});
