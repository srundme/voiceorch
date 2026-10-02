import { describe, it, expect, vi, beforeEach } from "vitest";

const chainMock = vi.fn();
vi.mock("../disposition-llm.js", () => ({
  getDispositionLLMChain: (...a: unknown[]) => chainMock(...a),
}));
vi.mock("../../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { generatePersonaDrafts, parsePersonaDrafts, PersonaGenerationError } from "./personas.js";

const good = {
  name: "Price-sensitive mother, Pune",
  scenario: "price_sensitive",
  difficulty: "hard",
  language: "hi-IN",
  callerGender: "female",
  personaPrompt: "You are Sunita, 38, from Pune. You keep asking for discounts.",
  goal: "Find the cheapest plan",
  successCriteria: ["Agent states only prices given in its instructions", "Agent offers to book a visit"],
};

const agent = { name: "Clinic bot", systemPrompt: "You book clinic visits.", greetingMessage: "Hello!", language: "en-IN" };

describe("parsePersonaDrafts", () => {
  it("accepts the {personas:[...]} shape and normalizes fields", () => {
    const out = parsePersonaDrafts({ personas: [good, { ...good, difficulty: "insane", callerGender: "x" }] }, 5, "en-IN");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ name: good.name, difficulty: "hard", callerGender: "female", maxDurationSeconds: 300 });
    expect(out[1]).toMatchObject({ difficulty: "medium", callerGender: "female" });
  });

  it("drops entries without persona, goal or criteria and caps the count", () => {
    const out = parsePersonaDrafts([
      { ...good, personaPrompt: "" },
      { ...good, successCriteria: [] },
      good, good, good,
    ], 2, "en-IN");
    expect(out).toHaveLength(2);
  });

  it("falls back to the agent language and limits criteria to 6", () => {
    const out = parsePersonaDrafts([{ ...good, language: "", successCriteria: Array(9).fill("Agent does a thing") }], 3, "ta-IN");
    expect(out[0]!.language).toBe("ta-IN");
    expect(out[0]!.successCriteria).toHaveLength(6);
  });

  it("returns [] for garbage", () => {
    expect(parsePersonaDrafts("nope", 3, "en-IN")).toEqual([]);
    expect(parsePersonaDrafts({ foo: 1 }, 3, "en-IN")).toEqual([]);
  });
});

describe("generatePersonaDrafts", () => {
  beforeEach(() => chainMock.mockReset());

  it("falls back to the next provider when the first fails", async () => {
    const bad = { extract: vi.fn().mockRejectedValue(new Error("429")) };
    const ok = { extract: vi.fn().mockResolvedValue({ personas: [good] }) };
    chainMock.mockResolvedValue([{ provider: "sarvam", client: bad }, { provider: "openai", client: ok }]);
    const drafts = await generatePersonaDrafts(agent, 3);
    expect(drafts).toHaveLength(1);
    expect(ok.extract).toHaveBeenCalledOnce();
    const [system, , context] = ok.extract.mock.calls[0]!;
    expect(system).toContain("exactly 3");
    expect(context).toContain("You book clinic visits.");
  });

  it("caps the requested count at 10", async () => {
    const ok = { extract: vi.fn().mockResolvedValue({ personas: [good] }) };
    chainMock.mockResolvedValue([{ provider: "sarvam", client: ok }]);
    await generatePersonaDrafts(agent, 50);
    expect(ok.extract.mock.calls[0]![0]).toContain("exactly 10");
  });

  it("throws a clear error when no model is configured or none returns usable output", async () => {
    chainMock.mockResolvedValue([]);
    await expect(generatePersonaDrafts(agent, 3)).rejects.toBeInstanceOf(PersonaGenerationError);
    chainMock.mockResolvedValue([{ provider: "sarvam", client: { extract: vi.fn().mockResolvedValue({ personas: [] }) } }]);
    await expect(generatePersonaDrafts(agent, 3)).rejects.toBeInstanceOf(PersonaGenerationError);
  });
});
