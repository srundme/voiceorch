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

  it("removes laughter for providers that do not support the token", () => {
    expect(normalizeTtsNonverbals("Funny. [laughter] Next.", "sarvam"))
      .toBe("Funny.  Next.");
  });
});
