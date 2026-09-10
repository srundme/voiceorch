import { describe, expect, it } from "vitest";
import { pushCartesiaSpeakable } from "./cartesia-token-coalesce.js";

describe("pushCartesiaSpeakable", () => {
  it("holds English subwords until a break", () => {
    let pending = "";
    let r = pushCartesiaSpeakable(pending, "So");
    expect(r.pieces).toEqual([]);
    pending = r.rest;
    r = pushCartesiaSpeakable(pending, "rry,");
    expect(r.pieces).toEqual(["Sorry,"]);
    expect(r.rest).toBe("");
  });

  it("holds Tamil virama until a later break", () => {
    let r = pushCartesiaSpeakable("", "ன");
    expect(r.pieces).toEqual([]);
    r = pushCartesiaSpeakable(r.rest, "்");
    expect(r.pieces).toEqual([]);
    r = pushCartesiaSpeakable(r.rest, " ");
    expect(r.pieces.join("")).toContain("்");
    expect(r.rest).toBe("");
  });

  it("flushes on space", () => {
    const r = pushCartesiaSpeakable("Hello", " ");
    expect(r.pieces).toEqual(["Hello "]);
    expect(r.rest).toBe("");
  });
});
