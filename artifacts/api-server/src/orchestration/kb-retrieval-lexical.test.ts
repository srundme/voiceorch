import { describe, expect, it } from "vitest";
import {
  buildKnowledgeSearchPayload,
  buildLexicalSearchTerms,
  classifyKbRetrievalMode,
  isPureNonLatinQuery,
  rrfMergeLists,
} from "./kb-lexical.js";

describe("isPureNonLatinQuery", () => {
  it("detects Tamil-only questions", () => {
    expect(isPureNonLatinQuery("ஆம்புலன்ஸ் கவர் ஆகுமா")).toBe(true);
    expect(isPureNonLatinQuery("என்ன விலை?")).toBe(true);
  });

  it("keeps FTS for code-mixed and English", () => {
    expect(isPureNonLatinQuery("ambulance coverage")).toBe(false);
    expect(isPureNonLatinQuery("ஆம்புலன்ஸ் cover")).toBe(false);
    expect(isPureNonLatinQuery("")).toBe(false);
  });
});

describe("buildLexicalSearchTerms", () => {
  it("includes the full query and tokens", () => {
    const terms = buildLexicalSearchTerms("ambulance coverage plan");
    expect(terms[0]).toBe("ambulance coverage plan");
    expect(terms).toContain("ambulance");
    expect(terms).toContain("coverage");
  });

  it("keeps Tamil phrases for substring match", () => {
    const terms = buildLexicalSearchTerms("ஆம்புலன்ஸ் கவர்");
    expect(terms[0]).toBe("ஆம்புலன்ஸ் கவர்");
    expect(terms.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty for blank", () => {
    expect(buildLexicalSearchTerms("   ")).toEqual([]);
  });
});

describe("Indic-safe merge (vector + lexical)", () => {
  const vec = [
    { id: 1, sourceId: 10, title: "Ambulance", content: "Covered in gold plan", keywords: null },
    { id: 2, sourceId: 10, title: "Clinic", content: "Hours 9-5", keywords: null },
  ];
  const lexical = [
    { id: 3, sourceId: 10, title: "ஆம்புலன்ஸ்", content: "கோல்ட் பிளானில் கவர்", keywords: null },
    { id: 1, sourceId: 10, title: "Ambulance", content: "Covered in gold plan", keywords: null },
  ];

  it("classifies vector+lexical as hybrid when FTS skipped", () => {
    expect(classifyKbRetrievalMode(vec.length, 0, lexical.length)).toBe("hybrid");
    expect(classifyKbRetrievalMode(0, 0, lexical.length)).toBe("lexical");
    expect(isPureNonLatinQuery("ஆம்புலன்ஸ் கவர்")).toBe(true);
  });

  it("RRF merges vector and lexical hits without losing Indic rows", () => {
    const merged = rrfMergeLists([vec, lexical], 5);
    expect(merged.map((r) => r.id)).toContain(3);
    expect(merged.map((r) => r.id)).toContain(1);
    // Shared id 1 appears once
    expect(merged.filter((r) => r.id === 1)).toHaveLength(1);
  });
});

describe("dashboard search payload parity", () => {
  it("returns sameAsLiveCalls ranking rows without inventing an LLM answer", () => {
    const payload = buildKnowledgeSearchPayload({
      text: "Title: Ambulance\nContent: Covered",
      source: "hybrid",
      latencyMs: 12,
      entries: [
        { id: 9, sourceId: 1, title: "Ambulance", content: "Covered", keywords: null },
      ],
    });
    expect(payload.sameAsLiveCalls).toBe(true);
    expect(payload.mode).toBe("hybrid");
    expect(payload.answer).toBe("Title: Ambulance\nContent: Covered");
    expect(payload.matchedEntries).toHaveLength(1);
    expect(payload.matchedEntries[0]!.entry.id).toBe(9);
    expect(payload.matchedEntries[0]!.rank).toBeGreaterThan(0.5);
  });

  it("empty retrieval returns explicit empty reason (no silent dump)", () => {
    const payload = buildKnowledgeSearchPayload({
      text: "",
      source: "none",
      latencyMs: 3,
      entries: [],
    });
    expect(payload.matchedEntries).toEqual([]);
    expect(payload.sameAsLiveCalls).toBe(true);
    expect(payload.answer).toMatch(/same search as live calls/i);
  });
});
