import { describe, it, expect, vi } from "vitest";
import {
  analyzeAgentBrief,
  briefAsText,
  briefInputHash,
  BriefUnavailableError,
  buildBriefSources,
  coerceBrief,
  extractKeyTerms,
  groundBrief,
  mergeBriefs,
  normalizeBrief,
  renumberBrief,
  resolveTargets,
  selectKbChunks,
  splitPromptChunks,
  type KbChunkLite,
} from "./brief.js";
import { EVENT_BRIEF_RAW, EVENT_INPUT, eventBrief } from "./test-fixtures.js";

describe("normalizeBrief / renumberBrief", () => {
  it("assigns stable prefixed ids and keeps exact values", () => {
    const b = eventBrief();
    expect(b.flowSteps.map((s) => s.id)).toEqual(["S1", "S2", "S3", "S4", "S5"]);
    expect(b.requiredInfo[2]).toEqual({ id: "I3", field: "Mobile number", validation: "10-digit" });
    expect(b.facts[2]).toMatchObject({ id: "F3", text: "Registration fee is ₹499 per child" });
    expect(b.rules[0]!.id).toBe("R1");
    expect(b.outOfScope.map((x) => x.id)).toEqual(["X1", "X2"]);
    expect(b.toolsUsage[0]).toMatchObject({ id: "T1", tool: "transfer_call" });
    expect(b.agentDirection).toBe("inbound");
  });

  it("survives junk: wrong types, unknown direction, string items, duplicates", () => {
    const b = renumberBrief(normalizeBrief({
      business: 42,
      agentDirection: "sideways",
      flowSteps: ["Greet", "greet ", { text: "Close" }, null],
      requiredInfo: ["Name", { name: "Phone", validation: "10 digits" }],
      facts: "not a list",
      rules: [{ text: "" }, { text: "Never promise refunds" }],
    }));
    expect(b.business).toBe("");
    expect(b.agentDirection).toBe("unknown");
    expect(b.flowSteps.map((s) => s.text)).toEqual(["Greet", "Close"]);
    expect(b.requiredInfo.map((f) => f.field)).toEqual(["Name", "Phone"]);
    expect(b.facts).toEqual([]);
    expect(b.rules).toEqual([{ id: "R1", text: "Never promise refunds", sourceQuote: "" }]);
  });

  it("merges chunk briefs and renumbers across them", () => {
    const a = normalizeBrief({ business: "Acme", facts: [{ text: "Fee ₹100", sourceQuote: "" }], flowSteps: ["Greet"] });
    const b = normalizeBrief({ business: "", facts: [{ text: "Open 9am-6pm", sourceQuote: "" }, { text: "Fee ₹100", sourceQuote: "" }] });
    const m = mergeBriefs([a, b]);
    expect(m.business).toBe("Acme");
    expect(m.facts.map((f) => `${f.id}:${f.text}`)).toEqual(["F1:Fee ₹100", "F2:Open 9am-6pm"]);
  });

  it("drops facts whose numbers never appear in the source (invented values)", () => {
    const b = renumberBrief(normalizeBrief({
      facts: [{ text: "Fee is ₹499", sourceQuote: "" }, { text: "Parking costs ₹50", sourceQuote: "" }, { text: "Event at 10:30 AM", sourceQuote: "" }],
    }));
    const grounded = groundBrief(b, "The fee is ₹499. Doors open 10.30 AM.");
    expect(grounded.facts.map((f) => f.text)).toEqual(["Fee is ₹499", "Event at 10:30 AM"]);
  });

  it("resolves target ids to labelled items and ignores unknown ids", () => {
    expect(resolveTargets(eventBrief(), ["f3", "R1", "Z9", "F3"])).toEqual([
      { id: "F3", kind: "fact", label: "Registration fee is ₹499 per child" },
      { id: "R1", kind: "rule", label: "Only students aged 6 to 14 are eligible; decline others" },
    ]);
  });

  it("round-trips through the jsonb cache keeping ids", () => {
    const b = eventBrief();
    expect(coerceBrief(JSON.parse(JSON.stringify(b)))).toEqual(b);
    expect(coerceBrief({ nope: true })).toBeNull();
  });

  it("renders a compact text form with ids for prompts", () => {
    const text = briefAsText(eventBrief());
    expect(text).toContain("F3: Registration fee is ₹499 per child");
    expect(text).toContain("X1: Parking at the venue");
    expect(text).toContain("I3: Mobile number — 10-digit");
  });
});

describe("prompt chunking", () => {
  it("uses the whole prompt past 6000 chars, split on paragraphs", () => {
    const paras = Array.from({ length: 30 }, (_, i) => `Paragraph ${i}: ${"detail ".repeat(100)}`);
    const prompt = paras.join("\n\n");
    expect(prompt.length).toBeGreaterThan(20_000);
    const chunks = splitPromptChunks(prompt);
    expect(chunks.length).toBe(2);
    expect(chunks.every((c) => c.length <= 12_000)).toBe(true);
    expect(chunks.join("\n\n")).toContain("Paragraph 29");
  });

  it("caps at 24k chars and hard-splits giant paragraphs", () => {
    const chunks = splitPromptChunks("x".repeat(30_000));
    expect(chunks.map((c) => c.length)).toEqual([12_000, 12_000]);
  });

  it("puts tools, dispositions and KB in the source; KB only on the first chunk", () => {
    const filler = Array.from({ length: 90 }, (_, i) => `Extra rule ${i}: ${"text ".repeat(30)}`).join("\n\n");
    const long = { ...EVENT_INPUT, systemPrompt: `${EVENT_INPUT.systemPrompt}\n\n${filler}\n\nLAST LINE MARKER` };
    const kb: KbChunkLite[] = [{ id: 1, documentId: 1, chunkIndex: 0, content: "KB: venue gate 3 opens at 9am" }];
    const sources = buildBriefSources(long, kb);
    expect(sources.length).toBe(2);
    expect(sources[0]).toContain("transfer_call: Transfer to the events desk");
    expect(sources[0]).toContain("Child age (number, required)");
    expect(sources[0]).toContain("KB: venue gate 3");
    expect(sources[1]).not.toContain("KB: venue gate 3");
    expect(sources[1]).toContain("LAST LINE MARKER");
    expect(sources[1]).toContain("part 2 of 2");
  });

  it("hash changes when the prompt or KB changes", () => {
    const h = briefInputHash(EVENT_INPUT, []);
    expect(briefInputHash(EVENT_INPUT, [])).toBe(h);
    expect(briefInputHash({ ...EVENT_INPUT, systemPrompt: `${EVENT_INPUT.systemPrompt}!` }, [])).not.toBe(h);
    expect(briefInputHash(EVENT_INPUT, [{ id: 9, documentId: 1, chunkIndex: 0, content: "x" }])).not.toBe(h);
  });
});

describe("KB chunk selection", () => {
  const chunk = (id: number, documentId: number, content: string): KbChunkLite => ({ id, documentId, chunkIndex: id, content });

  it("prefers chunks matching prompt key terms, spreads across documents, skips duplicates, caps", () => {
    const terms = extractKeyTerms("Galaxy Marvel Science Fair registration fee 499 eligibility galaxy marvel fair");
    expect(terms).toContain("499");
    const chunks = [
      chunk(1, 1, "Company history and founders."),
      chunk(2, 1, "Galaxy Marvel Science Fair registration fee is 499."),
      chunk(3, 1, "Galaxy Marvel Science Fair registration fee is 499."),
      chunk(4, 2, "Fair eligibility: ages 6-14. Galaxy Marvel rules."),
      chunk(5, 2, "Unrelated canteen menu."),
      chunk(6, 3, "Science fair judging criteria."),
    ];
    const picked = selectKbChunks(chunks, terms, { maxChunks: 3 });
    expect(picked.map((c) => c.id)).toEqual([2, 4, 6]);
  });

  it("respects the total character budget and selects up to 20 by default", () => {
    const many = Array.from({ length: 50 }, (_, i) => chunk(i, i % 5, `fee topic ${i} ${"y".repeat(100)}`));
    expect(selectKbChunks(many, ["fee"]).length).toBe(20);
    const budget = selectKbChunks(many, ["fee"], { maxChars: 400 });
    expect(budget.reduce((n, c) => n + c.content.length, 0)).toBeLessThanOrEqual(400);
  });
});

describe("analyzeAgentBrief", () => {
  it("calls the model once per prompt chunk at low temperature and merges", async () => {
    const filler = Array.from({ length: 90 }, (_, i) => `More instructions ${i}: ${"detail ".repeat(25)}`).join("\n\n");
    const long = { ...EVENT_INPUT, systemPrompt: `${EVENT_INPUT.systemPrompt}\n\n${filler}\n\nAlso: closing line must thank the parent.` };
    const gen = vi.fn()
      .mockResolvedValueOnce({ data: EVENT_BRIEF_RAW, provider: "gemini" })
      .mockResolvedValueOnce({ data: { rules: [{ text: "Thank the parent when closing", sourceQuote: "thank the parent" }] }, provider: "gemini" });
    const out = await analyzeAgentBrief(long, [], gen);
    expect(gen).toHaveBeenCalledTimes(2);
    expect(gen.mock.calls[0]![0].temperature).toBeLessThanOrEqual(0.2);
    expect(gen.mock.calls[1]![0].user).toContain("closing line must thank the parent");
    expect(out.brief.rules.map((r) => r.text)).toContain("Thank the parent when closing");
    expect(out.brief.facts.find((f) => f.text.includes("₹499"))).toBeTruthy();
    expect(out.inputHash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("throws BriefUnavailable when nothing concrete was extracted", async () => {
    const gen = vi.fn().mockResolvedValue({ data: { business: "Acme" }, provider: "openai" });
    await expect(analyzeAgentBrief(EVENT_INPUT, [], gen)).rejects.toBeInstanceOf(BriefUnavailableError);
  });
});
