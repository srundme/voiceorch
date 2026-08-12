import { describe, expect, it } from "vitest";
import { stripTranscriptMarkup } from "./transcript-display";

describe("stripTranscriptMarkup", () => {
  it("strips leading self-closing emotion tags", () => {
    expect(stripTranscriptMarkup('<emotion value="calm"/> Hello there')).toBe("Hello there");
  });

  it("strips emotion tags with type= and spaces before slash", () => {
    expect(stripTranscriptMarkup('<emotion type="curious" /> hmm')).toBe("hmm");
  });

  it("strips break tags", () => {
    expect(stripTranscriptMarkup('Wait <break time="300ms"/> more')).toBe("Wait more");
  });

  it("leaves normal text alone", () => {
    expect(stripTranscriptMarkup("Agent said hello")).toBe("Agent said hello");
  });
});
