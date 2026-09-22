import { describe, expect, it } from "vitest";
import {
  getDispositionValues,
  labelsFromDispositionTaxonomy,
  labelsFromDispositionSchema,
  callMatchesDispositionLabel,
  isDispositionDataCollectionKey,
} from "./disposition-display";

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

  it("drops common data-collection keys without an explicit exclude list", () => {
    expect(
      getDispositionValues({
        "Lead Status": "Hot Lead",
        email: "a@b.com",
        phone: "999",
        primary: "Lead Status",
        sub: "Hot Lead",
      }),
    ).toEqual(["Hot Lead"]);
  });
});

describe("labelsFromDispositionTaxonomy", () => {
  it("returns admin sub-labels only", () => {
    expect(labelsFromDispositionTaxonomy({
      "Lead Status": ["Hot Lead", "Not Interested"],
      "Next Action": ["Call Back Tomorrow"],
    })).toEqual(["Call Back Tomorrow", "Hot Lead", "Not Interested"]);
  });
});

describe("labelsFromDispositionSchema", () => {
  it("keeps choice options and skips text fields", () => {
    expect(labelsFromDispositionSchema([
      { key: "outcome", type: "choice", options: ["Interested", "Busy"] },
      { key: "email", type: "text" },
    ])).toEqual(["Busy", "Interested"]);
  });
});

describe("callMatchesDispositionLabel", () => {
  it("matches case-insensitively", () => {
    expect(callMatchesDispositionLabel(
      { "Lead Status": "Hot Lead", sub: "Hot Lead" },
      "hot lead",
    )).toBe(true);
  });
});

describe("isDispositionDataCollectionKey", () => {
  it("flags email/phone", () => {
    expect(isDispositionDataCollectionKey("email")).toBe(true);
    expect(isDispositionDataCollectionKey("Lead Status")).toBe(false);
  });
});
