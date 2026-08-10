import { describe, expect, it } from "vitest";
import { getDispositionValues } from "./disposition-display";

describe("getDispositionValues", () => {
  it("reads dynamic taxonomy key", () => {
    expect(
      getDispositionValues({ INTERESTED: "callback_requested", confidence: 0.9, summary: "ok" }),
    ).toEqual(["callback_requested"]);
  });

  it("falls back to sub when only primary/sub are stored", () => {
    expect(
      getDispositionValues({
        primary: "INTERESTED",
        sub: "callback_requested",
        confidence: 0.8,
        summary: "Caller asked to be called back",
        evidence: "please call me tomorrow",
      }),
    ).toEqual(["callback_requested"]);
  });

  it("excludes domain field keys from outcome chips", () => {
    expect(
      getDispositionValues(
        {
          INTERESTED: "demo_booked",
          whatsapp_number: "9876543210",
          primary: "INTERESTED",
          sub: "demo_booked",
        },
        ["whatsapp_number"],
      ),
    ).toEqual(["demo_booked"]);
  });
});
