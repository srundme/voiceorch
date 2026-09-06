import { describe, expect, it } from "vitest";
import {
  isTranscriptTranslateLang,
  parseTranscriptForTranslate,
  rebuildPlainTranscript,
  toSarvamTranslateTarget,
} from "./transcript-translate.js";

describe("transcript-translate helpers", () => {
  it("accepts Mayura language codes and maps Odia", () => {
    expect(isTranscriptTranslateLang("hi-IN")).toBe(true);
    expect(isTranscriptTranslateLang("or-IN")).toBe(true);
    expect(toSarvamTranslateTarget("or-IN")).toBe("od-IN");
    expect(isTranscriptTranslateLang("fr-FR")).toBe(false);
  });

  it("parses plain Agent/Caller transcript", () => {
    const raw = "Agent: Hello\nCaller: Vanakkam";
    const parsed = parseTranscriptForTranslate(raw);
    expect(parsed.kind).toBe("plain");
    expect(parsed.lines[0]?.role).toBe("assistant");
    expect(parsed.lines[1]?.content).toBe("Vanakkam");
  });

  it("rebuilds plain transcript with translated speakable lines", () => {
    const original = ["Agent: Hello", "Caller: Hi", "[calling tool: x]"];
    const translated = [
      { role: "assistant", content: "வணக்கம்" },
      { role: "user", content: "வணக்கம்" },
      { role: "unknown", content: "[calling tool: x]" },
    ];
    const out = rebuildPlainTranscript(original, translated);
    expect(out).toContain("Agent: வணக்கம்");
    expect(out).toContain("Caller: வணக்கம்");
    expect(out).toContain("[calling tool: x]");
  });
});
