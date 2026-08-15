import { describe, expect, it } from "vitest";

// kb-retrieval pulls in @workspace/db, which throws at import time without a
// connection string. formatEntries is pure, so a placeholder is enough — the
// pool is created lazily and never touched here.
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
const { formatEntries } = await import("./kb-retrieval.js");

type Entry = Parameters<typeof formatEntries>[0][number];

function entry(id: number, contentChars: number): Entry {
  return {
    id,
    sourceId: 223,
    title: `Entry ${id}`,
    content: "x".repeat(contentChars),
    keywords: null,
  } as Entry;
}

describe("formatEntries char cap", () => {
  it("returns everything when no cap is given", () => {
    const r = formatEntries([entry(1, 100), entry(2, 100), entry(3, 100)]);
    expect(r.truncated).toBe(false);
    expect(r.text).toContain("Entry 3");
  });

  it("stops before the entry that would exceed the cap", () => {
    const r = formatEntries([entry(1, 100), entry(2, 100), entry(3, 100)], 260);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(260);
    expect(r.text).toContain("Entry 1");
    expect(r.text).not.toContain("Entry 3");
  });

  it("drops the least relevant entries first (RRF order is preserved)", () => {
    // Entries arrive ranked; the cap must cut from the tail, never the head.
    const r = formatEntries([entry(1, 50), entry(2, 50), entry(3, 50), entry(4, 50)], 200);
    const kept = [1, 2, 3, 4].filter((n) => r.text.includes(`Entry ${n}`));
    expect(kept[0]).toBe(1);
    expect(kept).toEqual(kept.slice().sort((a, b) => a - b));
    expect(kept.length).toBeLessThan(4);
  });

  it("never emits a partial entry", () => {
    const r = formatEntries([entry(1, 40), entry(2, 40), entry(3, 40)], 130);
    for (const block of r.text.split("\n\n---\n\n")) {
      expect(block).toMatch(/^Title: Entry \d+\nContent: x+$/);
    }
  });

  it("keeps the top entry even when it alone exceeds the cap", () => {
    // Degrading to one long answer beats sending no context at all.
    const r = formatEntries([entry(1, 5000), entry(2, 100)], 1000);
    expect(r.text).toContain("Entry 1");
    expect(r.text).not.toContain("Entry 2");
    expect(r.truncated).toBe(true);
  });

  it("reports truncated=false when the cap is never reached", () => {
    const r = formatEntries([entry(1, 10), entry(2, 10)], 8000);
    expect(r.truncated).toBe(false);
    expect(r.text).toContain("Entry 2");
  });

  it("handles an empty entry list", () => {
    expect(formatEntries([], 8000)).toEqual({ text: "", truncated: false });
  });
});
