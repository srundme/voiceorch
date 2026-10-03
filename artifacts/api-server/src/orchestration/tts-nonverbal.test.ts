import { describe, expect, it } from "vitest";
import { normalizeTtsNonverbals } from "./tts-nonverbal.js";

describe("normalizeTtsNonverbals", () => {
  it("preserves Cartesia's inline laughter token", () => {
    expect(normalizeTtsNonverbals("That's a good one! [laughter] Let me check.", "cartesia"))
      .toBe("That's a good one! [laughter] Let me check.");
  });

  it("preserves standalone laughter and normalizes its spelling", () => {
    expect(normalizeTtsNonverbals("[Laughter]", "Cartesia")).toBe("[laughter]");
  });

  it("removes unsupported stage directions for Cartesia", () => {
    expect(normalizeTtsNonverbals("Hello [gasp] *sighs* (whispers) there", "cartesia"))
      .toBe("Hello    there");
  });

  it("drops unresolved prompt placeholders instead of speaking them", () => {
    expect(normalizeTtsNonverbals("Am I speaking with {{name}}?", "cartesia"))
      .toBe("Am I speaking with?");
    expect(normalizeTtsNonverbals("Hi {{ name }}, this is Ishani.", "sarvam"))
      .toBe("Hi, this is Ishani.");
  });

  it("removes laughter for providers that do not support the token", () => {
    expect(normalizeTtsNonverbals("Funny. [laughter] Next.", "sarvam"))
      .toBe("Funny.  Next.");
  });

  it("speaks a spaced slash between words as 'or' but leaves dates alone", () => {
    expect(normalizeTtsNonverbals("Thanisandra / North Bangalore works for you?", "cartesia"))
      .toBe("Thanisandra or North Bangalore works for you?");
    expect(normalizeTtsNonverbals("Visit on 14/08 at 11.", "cartesia"))
      .toBe("Visit on 14/08 at 11.");
  });
});
