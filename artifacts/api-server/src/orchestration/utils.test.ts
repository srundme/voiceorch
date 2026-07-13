import { describe, it, expect } from "vitest";
import { envInt, parseJsonObject } from "./utils.js";

describe("envInt", () => {
  it("returns default when unset", () => {
    const key = `TEST_ENV_INT_${Date.now()}`;
    expect(envInt(key, 400)).toBe(400);
  });

  it("ignores invalid values", () => {
    const key = `TEST_ENV_INT_BAD_${Date.now()}`;
    process.env[key] = "abc";
    expect(envInt(key, 120)).toBe(120);
    delete process.env[key];
  });
});

describe("parseJsonObject", () => {
  it("parses valid objects", () => {
    expect(parseJsonObject('{"mode":"codemix"}')).toEqual({ mode: "codemix" });
  });

  it("returns empty object on invalid JSON", () => {
    expect(parseJsonObject("{not json")).toEqual({});
  });
});
