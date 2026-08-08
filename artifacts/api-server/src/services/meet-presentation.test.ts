import { describe, expect, it } from "vitest";
import {
  detectPresentationKind,
  executeMeetPresentationTool,
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

  it("does not throw when start_presentation args are null", async () => {
    const out = await executeMeetPresentationTool({
      toolName: "start_presentation",
      args: null,
      meetMid: "mid-test",
      meetBotToken: "tok",
      presentationDefaultUrl: null,
    });
    // Missing roster bot id or missing URL — must be a string error, not a crash.
    expect(typeof out).toBe("string");
    expect(out.startsWith("error:")).toBe(true);
    expect(out.toLowerCase()).not.toContain("cannot read properties of null");
  });
});
