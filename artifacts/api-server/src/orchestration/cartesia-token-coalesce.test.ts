import { describe, expect, it } from "vitest";
import { flushCartesiaSpeakable, pushCartesiaSpeakable, cartesiaUnspokenTail, CartesiaTurnStream } from "./cartesia-token-coalesce.js";

describe("pushCartesiaSpeakable", () => {
  it("does not wait for a Latin word boundary (VoBiz dies if we add 3000ms per word)", () => {
    const r = pushCartesiaSpeakable("", "Hello");
    expect(r.pieces).toEqual(["Hello"]);
    expect(r.rest).toBe("");
  });

  it("streams Latin BPE through for Cartesia managed buffering (not word-wait)", () => {
    let pending = "";
    let spoken = "";
    for (const t of ["cof", "f", "ee "]) {
      const r = pushCartesiaSpeakable(pending, t);
      spoken += r.pieces.join("");
      pending = r.rest;
    }
    expect(spoken).toBe("coffee ");
    expect(pending).toBe("");
  });

  it("does not flush a Tamil virama as its own piece (call 24502)", () => {
    const r = pushCartesiaSpeakable("லும", "் th");
    expect(r.pieces.join("")).toBe("லும் ");
    expect(r.rest).toBe("th");
    expect(r.pieces.some((p) => p === "்" || p === "் th")).toBe(false);
  });

  it("holds சொன until ்ன attaches", () => {
    let r = pushCartesiaSpeakable("", "சொன");
    expect(r.pieces).toEqual([]);
    expect(r.rest).toBe("சொன");
    r = pushCartesiaSpeakable(r.rest, "்ன");
    expect(r.pieces).toEqual([]);
    expect(r.rest).toBe("சொன்ன");
    r = pushCartesiaSpeakable(r.rest, " ");
    expect(r.pieces.join("")).toBe("சொன்ன ");
  });

  it("keeps spaces and does not insert them", () => {
    const r = pushCartesiaSpeakable("நீங்க", " ");
    expect(r.pieces.join("")).toBe("நீங்க ");
    const r2 = pushCartesiaSpeakable("", " ");
    expect(r2.pieces.join("") + r2.rest).toBe(" ");
  });

  it("flushes the held Indic tail at stream end", () => {
    expect(flushCartesiaSpeakable("SnapServe")).toBe("SnapServe");
  });

  it("returns the unspoken suffix after Cartesia closes on .!? (call 24547)", () => {
    const sent = "சரி, அப்போ எந்த மாதிரி பிசினஸ்க்காக பாக்குறீங்க?";
    const full = "சரி, அப்போ எந்த மாதிரி பிசினஸ்க்காக பாக்குறீங்க? அதாவது ஷாப்பா, ரெஸ்டாரண்ட்டா இல்ல ஆபீஸா?";
    expect(cartesiaUnspokenTail(sent, full)).toBe(" அதாவது ஷாப்பா, ரெஸ்டாரண்ட்டா இல்ல ஆபீஸா?");
  });

  it("does not WS-continue after the first sentence end", () => {
    const s = new CartesiaTurnStream();
    expect(s.push("சரி, ")).toEqual(["சரி, "]);
    expect(s.push("பாக்குறீங்க?")).toEqual(["பாக்குறீங்க?"]);
    expect(s.push(" அதாவது ")).toEqual([]);
    expect(s.finish("சரி, பாக்குறீங்க? அதாவது ஷாப்பா?")).toEqual([" அதாவது ஷாப்பா?"]);
  });
});
