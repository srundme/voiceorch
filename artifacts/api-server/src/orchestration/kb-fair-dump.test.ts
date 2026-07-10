/**
 * Fair multi-source KB dump allocation (task: multi-KB retrieval starvation).
 *
 * Regression context (prod call 2159): agent had two knowledge sources; the
 * legacy dump concatenated entries in global insertion order and post-hoc
 * sliced at the char cap, so source 1 consumed the entire budget and source
 * 29 NEVER reached the LLM on any of the 8 turns. buildFairDump must split
 * both the entry and the char budget across sources (with rollover) so every
 * attached source contributes.
 */
import { describe, it, expect, afterEach } from "vitest";
import { buildFairDump, resolveKbTurnBudgetMs, type KbFairDumpEntry } from "./kb-retrieval.js";

const SEP = "\n\n---\n\n";

let nextId = 1;
function entry(
  sourceId: number,
  contentLen: number,
  opts: { pinned?: boolean; title?: string | null; keywords?: string | null; fill?: string } = {},
): KbFairDumpEntry {
  return {
    id: nextId++,
    sourceId,
    title: opts.title ?? null,
    content: (opts.fill ?? "x").repeat(Math.ceil(contentLen / (opts.fill ?? "x").length)).slice(0, contentLen),
    keywords: opts.keywords ?? null,
    pinned: opts.pinned ?? false,
  };
}

/** Legacy single-source formatting (what the old dump produced). */
function legacyFormat(entries: KbFairDumpEntry[]): string {
  return entries
    .map((e) => {
      const parts: string[] = [];
      if (e.title) parts.push(`Title: ${e.title}`);
      parts.push(`Content: ${e.content}`);
      if (e.keywords) parts.push(`Keywords: ${e.keywords}`);
      return parts.join("\n");
    })
    .join(SEP);
}

/** Legacy truncation boundary logic (sep > half, else newline > half, else hard cut). */
function legacyTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const sepIdx = text.lastIndexOf(SEP, maxChars);
  const nlIdx = text.lastIndexOf("\n", maxChars);
  const cut = sepIdx > maxChars * 0.5 ? sepIdx : nlIdx > maxChars * 0.5 ? nlIdx : maxChars;
  return text.slice(0, cut);
}

describe("buildFairDump", () => {
  it("returns empty result for no entries", () => {
    const r = buildFairDump([], { maxEntries: 200, maxChars: 8000 });
    expect(r.text).toBe("");
    expect(r.contributingSourceIds).toEqual([]);
    expect(r.truncated).toBe(false);
  });

  it("single source, under budget: byte-identical to legacy formatting, not truncated", () => {
    const es = [entry(5, 100, { title: "A" }), entry(5, 200, { keywords: "k1, k2" }), entry(5, 50)];
    const r = buildFairDump(es, { maxEntries: 200, maxChars: 8000 });
    expect(r.text).toBe(legacyFormat(es));
    expect(r.contributingSourceIds).toEqual([5]);
    expect(r.truncated).toBe(false);
  });

  it("single source, over char budget: byte-identical to legacy truncation", () => {
    const es = [entry(5, 3000), entry(5, 3000), entry(5, 3000)];
    const maxChars = 5000;
    const r = buildFairDump(es, { maxEntries: 200, maxChars });
    expect(r.text).toBe(legacyTruncate(legacyFormat(es), maxChars));
    expect(r.truncated).toBe(true);
    expect(r.contributingSourceIds).toEqual([5]);
  });

  it("single source: pinned entries lead regardless of id order", () => {
    const a = entry(5, 40);
    const pinnedLate = entry(5, 40, { pinned: true, title: "PINNED" });
    const r = buildFairDump([a, pinnedLate], { maxEntries: 200 });
    expect(r.text.indexOf("PINNED")).toBeLessThan(r.text.indexOf(a.content));
  });

  it("two sources, tight char cap: BOTH contribute (call-2159 starvation fix)", () => {
    // Shape of call 2159: source 1 alone overflows the 8000-char prefetch cap;
    // source 29 (the one the caller asked about) never got a single char in.
    const src1 = [entry(1, 6000, { fill: "a" }), entry(1, 6000, { fill: "b" })];
    const src29 = [entry(29, 1500, { fill: "G", title: "Galaxy app" }), entry(29, 1500, { fill: "H" })];
    const r = buildFairDump([...src1, ...src29], { maxEntries: 200, maxChars: 8000 });
    expect(r.contributingSourceIds).toEqual([1, 29]);
    expect(r.truncated).toBe(true);
    // Source 29's marker content must actually be present in the text.
    expect(r.text).toContain("Galaxy app");
    expect(r.text).toContain("G".repeat(100));
    expect(r.text.length).toBeLessThanOrEqual(8000);
    // Source 29 fits entirely inside its fair share → not truncated itself.
    const s29 = r.perSource.find((s) => s.sourceId === 29)!;
    expect(s29.truncated).toBe(false);
    expect(s29.keptEntries).toBe(2);
    // Source 1 absorbed the cut.
    const s1 = r.perSource.find((s) => s.sourceId === 1)!;
    expect(s1.truncated).toBe(true);
  });

  it("char rollover: a small source's unused budget flows to the large source", () => {
    const small = [entry(1, 500, { fill: "s" })]; // needs ~509 chars formatted
    const big = [entry(2, 20000, { fill: "L" })];
    const r = buildFairDump([...small, ...big], { maxEntries: 200, maxChars: 8000 });
    const s1 = r.perSource.find((s) => s.sourceId === 1)!;
    const s2 = r.perSource.find((s) => s.sourceId === 2)!;
    // Small source fully satisfied.
    expect(s1.truncated).toBe(false);
    // Big source gets ~everything the small one didn't use (not a naive 4000 split).
    expect(s2.chars).toBeGreaterThan(6500);
    expect(r.text.length).toBeLessThanOrEqual(8000);
  });

  it("three sources: all contribute under a tight cap", () => {
    const es = [
      entry(1, 9000, { fill: "a" }),
      entry(2, 9000, { fill: "b" }),
      entry(3, 9000, { fill: "c" }),
    ];
    const r = buildFairDump(es, { maxEntries: 200, maxChars: 6000 });
    expect(r.contributingSourceIds).toEqual([1, 2, 3]);
    expect(r.text.length).toBeLessThanOrEqual(6000);
    // Roughly even split (hard cuts land near the ~2000-char shares).
    for (const s of r.perSource) {
      expect(s.chars).toBeGreaterThan(1500);
      expect(s.chars).toBeLessThan(2500);
    }
  });

  it("pinned fairness is source-scoped: one source's pinned pile cannot evict another source's pinned entry", () => {
    // Source 1: 5 large pinned entries (would fill the whole cap alone).
    const src1 = Array.from({ length: 5 }, () => entry(1, 3000, { pinned: true, fill: "p" }));
    // Source 2: one pinned + one normal entry.
    const src2 = [entry(2, 800, { pinned: true, title: "S2-PINNED" }), entry(2, 800, { title: "S2-NORMAL" })];
    const r = buildFairDump([...src1, ...src2], { maxEntries: 200, maxChars: 8000 });
    expect(r.contributingSourceIds).toEqual([1, 2]);
    expect(r.text).toContain("S2-PINNED");
    // Within source 2's block, pinned leads.
    expect(r.text.indexOf("S2-PINNED")).toBeLessThan(r.text.indexOf("S2-NORMAL"));
  });

  it("entry budget is split fairly with rollover", () => {
    // Source 1 has 8 entries, source 2 has 2; maxEntries=6 → source 2 keeps
    // both, source 1 gets the remaining 4 (not first-6-in-insertion-order).
    const src1 = Array.from({ length: 8 }, () => entry(1, 20));
    const src2 = [entry(2, 20), entry(2, 20)];
    const r = buildFairDump([...src1, ...src2], { maxEntries: 6 });
    const s1 = r.perSource.find((s) => s.sourceId === 1)!;
    const s2 = r.perSource.find((s) => s.sourceId === 2)!;
    expect(s2.keptEntries).toBe(2);
    expect(s2.truncated).toBe(false);
    expect(s1.keptEntries).toBe(4);
    expect(s1.truncated).toBe(true);
    expect(r.truncated).toBe(true);
  });

  it("no char cap: everything included, sources ordered by ascending sourceId", () => {
    const es = [entry(7, 100, { fill: "z" }), entry(3, 100, { fill: "y" })];
    const r = buildFairDump(es, { maxEntries: 200 });
    expect(r.contributingSourceIds).toEqual([3, 7]);
    expect(r.text.indexOf("y")).toBeLessThan(r.text.indexOf("z"));
    expect(r.truncated).toBe(false);
  });
});

describe("resolveKbTurnBudgetMs", () => {
  const saved = {
    hybrid: process.env["KB_TURN_RETRIEVAL_BUDGET_MS"],
    skip: process.env["KB_TURN_RETRIEVAL_BUDGET_SKIPFTS_MS"],
  };
  afterEach(() => {
    if (saved.hybrid === undefined) delete process.env["KB_TURN_RETRIEVAL_BUDGET_MS"];
    else process.env["KB_TURN_RETRIEVAL_BUDGET_MS"] = saved.hybrid;
    if (saved.skip === undefined) delete process.env["KB_TURN_RETRIEVAL_BUDGET_SKIPFTS_MS"];
    else process.env["KB_TURN_RETRIEVAL_BUDGET_SKIPFTS_MS"] = saved.skip;
  });

  it("defaults: 200ms hybrid, 800ms skipFts (measured Tamil embed p90 + margin)", () => {
    delete process.env["KB_TURN_RETRIEVAL_BUDGET_MS"];
    delete process.env["KB_TURN_RETRIEVAL_BUDGET_SKIPFTS_MS"];
    expect(resolveKbTurnBudgetMs(false)).toBe(200);
    expect(resolveKbTurnBudgetMs(true)).toBe(800);
  });

  it("env overrides are honored per-mode", () => {
    process.env["KB_TURN_RETRIEVAL_BUDGET_MS"] = "150";
    process.env["KB_TURN_RETRIEVAL_BUDGET_SKIPFTS_MS"] = "1000";
    expect(resolveKbTurnBudgetMs(false)).toBe(150);
    expect(resolveKbTurnBudgetMs(true)).toBe(1000);
  });

  it("invalid env values fall back to defaults", () => {
    process.env["KB_TURN_RETRIEVAL_BUDGET_MS"] = "not-a-number";
    process.env["KB_TURN_RETRIEVAL_BUDGET_SKIPFTS_MS"] = "-5";
    expect(resolveKbTurnBudgetMs(false)).toBe(200);
    expect(resolveKbTurnBudgetMs(true)).toBe(800);
  });
});
