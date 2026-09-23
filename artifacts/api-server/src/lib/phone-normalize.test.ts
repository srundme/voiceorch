import { describe, expect, it } from "vitest";
import { normalizePhone, toDialNumber } from "./phone-normalize.js";

describe("toDialNumber", () => {
  it("adds +91 to a 10-digit sheet cell", () => {
    expect(toDialNumber(null, "9940053444")).toBe("+919940053444");
    expect(toDialNumber("6383653279", "6383653279")).toBe("+916383653279");
  });

  it("keeps a number that already has +91", () => {
    expect(toDialNumber("+919940053444", "9940053444")).toBe("+919940053444");
  });

  it("adds + when the cell already includes 91", () => {
    expect(normalizePhone("919940053444")).toBe("+919940053444");
    expect(toDialNumber("919940053444", "9940053444")).toBe("+919940053444");
  });
});
