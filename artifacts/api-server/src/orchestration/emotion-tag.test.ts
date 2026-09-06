import { describe, it, expect } from "vitest";
import { extractEmotionTag, makeMarkupTagFilter, stripMarkupTags } from "./emotion-tag.js";

describe("extractEmotionTag", () => {
  it("forwards a complete leading tag and keeps speakable text", () => {
    expect(extractEmotionTag('<emotion value="curious"/> How much do you need?')).toEqual({
      emotion: "curious",
      text: "How much do you need?",
    });
  });

  it("does not send a truncated trailing tag to TTS (call 17666)", () => {
    const leftover = ' <emotion value="c';
    expect(extractEmotionTag(leftover)).toEqual({ emotion: null, text: "" });
  });

  it("strips a markup-only truncated sentence", () => {
    expect(extractEmotionTag('<emotion value="c')).toEqual({ emotion: null, text: "" });
    expect(extractEmotionTag('<emotion value="curious"')).toEqual({ emotion: null, text: "" });
  });
});

describe("stripMarkupTags", () => {
  it("keeps speech and drops a truncated tail tag", () => {
    expect(
      stripMarkupTags('தோராயமா எவ்ளோ amount தேவைப்படுதுன்னு சொல்ல முடியுமா? <emotion value="c'),
    ).toBe("தோராயமா எவ்ளோ amount தேவைப்படுதுன்னு சொல்ல முடியுமா?");
  });
});

describe("makeMarkupTagFilter", () => {
  it("holds a truncated opening tag so it never becomes a TTS sentence", () => {
    const filter = makeMarkupTagFilter();
    let out = "";
    for (const tok of ['சொல்ல முடியுமா? ', '<', 'emotion value="c']) {
      out += filter(tok);
    }
    expect(out).toBe("சொல்ல முடியுமா? ");
    expect(out).not.toContain("<emotion");
  });

  it("passes a complete opening tag through for extractEmotionTag", () => {
    const filter = makeMarkupTagFilter();
    const streamed = filter('<emotion value="curious"/> Hello');
    expect(streamed).toContain('<emotion value="curious"/>');
    expect(extractEmotionTag(streamed)).toEqual({ emotion: "curious", text: "Hello" });
  });
});
