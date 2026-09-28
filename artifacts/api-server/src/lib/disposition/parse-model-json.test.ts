import { describe, expect, it } from "vitest";
import { parseDispositionModelJson } from "./parse-model-json.js";

describe("parseDispositionModelJson", () => {
  it("reads a fenced object", () => {
    const parsed = parseDispositionModelJson('```json\n{"primary":"outcome","sub":"interested","city":"Pune"}\n```');
    expect(parsed["sub"]).toBe("interested");
    expect(parsed["city"]).toBe("Pune");
  });

  it("reads an object that follows reasoning text", () => {
    const parsed = parseDispositionModelJson('The caller agreed.\n{"primary":"outcome","sub":"callback"}');
    expect(parsed["sub"]).toBe("callback");
  });
});
