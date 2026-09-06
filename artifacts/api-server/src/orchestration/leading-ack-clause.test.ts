import { describe, it, expect } from "vitest";
import { stripLeadingAckClause } from "./pipeline.js";

// The cover filler plays before the LLM sentence, so a sentence that opens
// with the same ack word doubles it. Call 21546: 20 of 23 first sentences
// opened with "சரி,".
describe("stripLeadingAckClause", () => {
  it("drops a leading ack clause and keeps the content", () => {
    expect(stripLeadingAckClause("சரி, real estate business.")).toBe("real estate business.");
    expect(stripLeadingAckClause("சரி, first time தான்.")).toBe("first time தான்.");
    expect(stripLeadingAckClause("சரி, monthly turnover sixty lakh வருது.")).toBe(
      "monthly turnover sixty lakh வருது.",
    );
    expect(stripLeadingAckClause("Okay, I will send the statement.")).toBe(
      "I will send the statement.",
    );
    expect(stripLeadingAckClause("Hmm. Hi Karthik, this is the admissions office.")).toBe(
      "Hi Karthik, this is the admissions office.",
    );
    expect(stripLeadingAckClause("Mmm. I can arrange a callback for you.")).toBe(
      "I can arrange a callback for you.",
    );
    expect(stripLeadingAckClause("Okay. I'm calling from the school admissions office.")).toBe(
      "I'm calling from the school admissions office.",
    );
    expect(stripLeadingAckClause("ठीक है, मैं भेज दूंगा.")).toBe("मैं भेज दूंगा.");
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
