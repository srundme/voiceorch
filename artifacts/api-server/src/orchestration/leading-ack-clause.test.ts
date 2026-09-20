import { describe, it, expect } from "vitest";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
const { stripLeadingAckClause } = await import("./pipeline.js");

// The cover filler plays before the LLM sentence, so a sentence that opens
// with the same ack word doubles it. Call 21546: 20 of 23 first sentences
// opened with "சரி,".
describe("stripLeadingAckClause", () => {
  it("strips a leading சரி / okay clause so it is not doubled after the cover", () => {
    expect(stripLeadingAckClause("சரி, real estate business.")).toBe("real estate business.");
    expect(stripLeadingAckClause("Okay, I will send the statement.")).toBe(
      "I will send the statement.",
    );
    expect(stripLeadingAckClause("Seri seri, நாளைக்கு call பண்ணுறேன்.")).toBe(
      "நாளைக்கு call பண்ணுறேன்.",
    );
  });

  it("leaves non-ack openers untouched", () => {
    expect(stripLeadingAckClause("வணக்கம், நா Shiva பேசுறேன்.")).toBe(
      "வணக்கம், நா Shiva பேசுறேன்.",
    );
    expect(stripLeadingAckClause("எங்க team நேரா வந்து, review பண்ணுவாங்க.")).toBe(
      "எங்க team நேரா வந்து, review பண்ணுவாங்க.",
    );
    expect(stripLeadingAckClause("I checked your file, it is approved.")).toBe(
      "I checked your file, it is approved.",
    );
  });

  it("keeps the sentence when no comma clause is present", () => {
    expect(stripLeadingAckClause("சரி.")).toBe("சரி.");
    expect(stripLeadingAckClause("okay")).toBe("okay");
    expect(stripLeadingAckClause("")).toBe("");
  });

  it("keeps the sentence when nothing meaningful would remain", () => {
    expect(stripLeadingAckClause("சரி, ok.")).toBe("சரி, ok.");
  });
});
