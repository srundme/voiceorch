import { describe, expect, it } from "vitest";
import {
  detectPresentationKind,
  isAllowedPresentationUrl,
  normalizePresentationUrl,
} from "./meet-presentation.js";

describe("meet-presentation helpers", () => {
  it("detects slides / pdf / web", () => {
    expect(detectPresentationKind("https://docs.google.com/presentation/d/abc/edit")).toBe("slides");
    expect(detectPresentationKind("https://cdn.example.com/deck.pdf")).toBe("pdf");
    expect(detectPresentationKind("https://example.com/pitch")).toBe("web");
  });

  it("requires https", () => {
    expect(isAllowedPresentationUrl("https://example.com/a.pdf")).toBe(true);
    expect(isAllowedPresentationUrl("http://example.com/a.pdf")).toBe(false);
    expect(isAllowedPresentationUrl("not-a-url")).toBe(false);
  });

  it("normalizes Google Slides edit links to embed", () => {
    const out = normalizePresentationUrl(
      "https://docs.google.com/presentation/d/ABC123/edit#slide=id.p1",
    );
    expect(out).toContain("/embed?");
    expect(out).toContain("ABC123");
  });
});
