import { describe, it, expect } from "vitest";
import {
  makeGeminiPreambleGuard,
  parseGeminiBracketToolCall,
  resolveGoogleLlmModel,
  stripGeminiThinkingPreamble,
  GoogleLLM,
} from "./google.js";

// Stream a reply through the guard in arbitrary chunks, collect the spoken output.
function runStream(chunks: string[]): string {
  const guard = makeGeminiPreambleGuard();
  return chunks.map((c) => guard(c)).join("");
}

describe("resolveGoogleLlmModel", () => {
  it("rewrites retired 2.5 Flash ids that Google 404s (call failed after Hello)", () => {
    expect(resolveGoogleLlmModel("gemini-2.5-flash")).toBe("gemini-3.6-flash");
    expect(resolveGoogleLlmModel("models/gemini-2.5-flash-8b")).toBe("gemini-3.6-flash");
    expect(resolveGoogleLlmModel(null)).toBe("gemini-3.6-flash");
  });

  it("leaves current Gemini 3 / Pro ids alone", () => {
    expect(resolveGoogleLlmModel("gemini-3.6-flash")).toBe("gemini-3.6-flash");
    expect(resolveGoogleLlmModel("gemini-2.5-pro")).toBe("gemini-2.5-pro");
  });
});

describe("stripGeminiThinkingPreamble (final reply)", () => {
  it("leaves a normal reply untouched", () => {
    expect(stripGeminiThinkingPreamble("Hello there! How can I help?")).toBe(
      "Hello there! How can I help?",
    );
  });

  it("drops leading bracketed state/context lines", () => {
    const input =
      "[DATE/TIME CONTEXT] Monday June 30\n[LLM state] State is `wellness_intro`\nHi, welcome to the clinic.";
    expect(stripGeminiThinkingPreamble(input)).toBe("Hi, welcome to the clinic.");
  });

  it("cuts a planning narration ending in a 'New response …:' handoff", () => {
    const input =
      "The user seems to have asked about pricing. I should acknowledge it. New response based on user's question: Our plan is $5 a month.";
    expect(stripGeminiThinkingPreamble(input)).toBe("Our plan is $5 a month.");
  });

  it("strips brackets then cuts the handoff in one pass", () => {
    const input =
      "[LLM state] State is `intro`\nThe user greeted me. I will greet back. New response: Hi! Lovely to meet you.";
    expect(stripGeminiThinkingPreamble(input)).toBe("Hi! Lovely to meet you.");
  });

  it("does NOT cut when the handoff phrase appears without planning cues", () => {
    const input = "Here is the new response: it works great.";
    expect(stripGeminiThinkingPreamble(input)).toBe(
      "Here is the new response: it works great.",
    );
  });

  it("does not touch a bracketed token inside a genuine reply", () => {
    const input = "Your code is [12345] and it expires soon.";
    expect(stripGeminiThinkingPreamble(input)).toBe(
      "Your code is [12345] and it expires soon.",
    );
  });
});

describe("parseGeminiBracketToolCall", () => {
  it("parses the positional goto_slide form observed in meeting call logs", () => {
    expect(parseGeminiBracketToolCall("[called goto_slide(4)]")).toEqual({
      name: "goto_slide",
      args: { slide: 4 },
    });
  });

  it("parses an argument-free slide action", () => {
    expect(parseGeminiBracketToolCall("[called next_slide]")).toEqual({
      name: "next_slide",
      args: {},
    });
  });

  it("parses JSON and named arguments", () => {
    expect(parseGeminiBracketToolCall('[called goto_slide({"slide":10})]')).toEqual({
      name: "goto_slide",
      args: { slide: 10 },
    });
    expect(parseGeminiBracketToolCall("[called goto_slide(slide=7)]")).toEqual({
      name: "goto_slide",
      args: { slide: 7 },
    });
  });

  it("does not mistake normal bracketed speech for a tool call", () => {
    expect(parseGeminiBracketToolCall("Your code is [12345].")).toBeNull();
  });
});

describe("GoogleLLM.buildContents (tool history)", () => {
  it("uses a native model functionCall instead of a text placeholder", () => {
    const llm = new GoogleLLM("test-key", "gemini-3.5-flash-lite");
    const { history } = (llm as unknown as {
      buildContents(messages: Array<{
        role: "user" | "assistant" | "tool";
        content: string;
        toolCalls?: Array<{ id: string; name: string; args: string }>;
      }>): { history: Array<{ role?: string; parts?: Array<Record<string, unknown>> }> };
    }).buildContents([
      { role: "user", content: "Go to slide 10" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call-1", name: "goto_slide", args: '{"slide":10}' }],
      },
      { role: "tool", content: "slide=10" },
    ]);

    expect(history[1]?.parts).toEqual([
      { functionCall: { name: "goto_slide", args: { slide: 10 } } },
    ]);
    expect(JSON.stringify(history)).not.toContain("[called");
  });
});

describe("GoogleLLM.cacheEligible (context-cache gating)", () => {
  // Access the private predicate at runtime (TS `private` is compile-time only).
  const call = (llm: GoogleLLM, cacheBase: string | undefined, systemPrompt: string, lastIsTool: boolean) =>
    (llm as unknown as {
      cacheEligible(b: string | undefined, s: string, t: boolean): boolean;
    }).cacheEligible(cacheBase, systemPrompt, lastIsTool);

  // CACHE_MIN_CHARS default is 4096 — build a base comfortably above it.
  const base = "X".repeat(5000);
  const tail = "\n\n[CURRENT DATE & TIME] now";
  const fresh = () => new GoogleLLM("test-key", "gemini-2.5-flash");

  it("is eligible when base is long, a prefix of the prompt, and the turn is not a tool result", () => {
    expect(call(fresh(), base, base + tail, false)).toBe(true);
  });

  it("is NOT eligible without a cacheBase", () => {
    expect(call(fresh(), undefined, base + tail, false)).toBe(false);
  });

  it("is NOT eligible when the base is shorter than the minimum", () => {
    const short = "X".repeat(100);
    expect(call(fresh(), short, short + tail, false)).toBe(false);
  });

  it("is NOT eligible when the prompt does not start with the base (e.g. staged-prompt override)", () => {
    const staged = "Y".repeat(5000) + tail;
    expect(call(fresh(), base, staged, false)).toBe(false);
  });

  it("is NOT eligible for a tool-result turn", () => {
    expect(call(fresh(), base, base + tail, true)).toBe(false);
  });

  it("is NOT eligible on a non-gemini model", () => {
    const llm = new GoogleLLM("test-key", "text-bison");
    expect(call(llm, base, base + tail, false)).toBe(false);
  });

  it("is NOT eligible once caching has been disabled for the call (fallback latch)", () => {
    const llm = fresh();
    (llm as unknown as { cacheDisabled: boolean }).cacheDisabled = true;
    expect(call(llm, base, base + tail, false)).toBe(false);
  });
});

describe("GoogleLLM context cache is keyed by base (language code-switching)", () => {
  // A caller who switches language produces a different cache base per language
  // guard. Each base must get its own CachedContent instead of evicting the
  // previous one and burning the warm budget until caching shuts off.
  type CacheInternals = {
    ensureCache(base: string, tools: undefined): void;
    caches: Map<string, { name: string }>;
    warmPromises: Map<string, Promise<void>>;
    cacheDisabled: boolean;
    warmCount: number;
    ai: { caches: { create: (cfg: unknown) => Promise<{ name: string }> } };
  };

  const englishBase = "EN-GUARD " + "X".repeat(5000);
  const tamilBase = "TA-GUARD " + "X".repeat(5000);

  function stubbed(): { llm: GoogleLLM; internals: CacheInternals; created: string[] } {
    const llm = new GoogleLLM("test-key", "gemini-2.5-flash");
    const internals = llm as unknown as CacheInternals;
    const created: string[] = [];
    internals.ai = {
      caches: {
        create: async (cfg: unknown) => {
          const instruction = (cfg as { config: { systemInstruction: string } }).config.systemInstruction;
          created.push(instruction);
          return { name: `cache-${created.length}` };
        },
      },
    };
    return { llm, internals, created };
  }

  it("keeps a separate cache per base so a language flip still hits cache", async () => {
    const { internals, created } = stubbed();

    internals.ensureCache(englishBase, undefined);
    await internals.warmPromises.get(englishBase);
    internals.ensureCache(tamilBase, undefined);
    await internals.warmPromises.get(tamilBase);

    expect(created).toEqual([englishBase, tamilBase]);
    expect(internals.caches.get(englishBase)?.name).toBe("cache-1");
    expect(internals.caches.get(tamilBase)?.name).toBe("cache-2");

    // Switching back must reuse the existing cache, not create a third.
    internals.ensureCache(englishBase, undefined);
    expect(created).toHaveLength(2);
  });

  it("stops warming new bases past the budget but keeps serving existing ones", async () => {
    const { internals, created } = stubbed();

    internals.ensureCache(englishBase, undefined);
    await internals.warmPromises.get(englishBase);
    internals.warmCount = 999; // budget exhausted

    internals.ensureCache(tamilBase, undefined);
    expect(created).toEqual([englishBase]);
    // The already-warmed base must still be usable — this is the regression that
    // made long multilingual calls run entirely uncached.
    expect(internals.cacheDisabled).toBe(false);
    expect(internals.caches.get(englishBase)?.name).toBe("cache-1");
  });
});

describe("makeGeminiPreambleGuard (streaming)", () => {
  it("passes a normal reply through unchanged", () => {
    expect(runStream(["Hello ", "there!"])).toBe("Hello there!");
  });

  it("never delays the first token of a normal reply", () => {
    const guard = makeGeminiPreambleGuard();
    expect(guard("Hi")).toBe("Hi");
  });

  it("drops a leading bracketed line split across tokens", () => {
    expect(
      runStream(["[DATE/TIME", " CONTEXT] Mon", "day\n", "Hello there"]),
    ).toBe("Hello there");
  });

  it("drops planning narration up to a handoff already visible in the buffer", () => {
    expect(
      runStream([
        "The user asked a question. I should reply. New response: ",
        "Sure, happy to help!",
      ]),
    ).toBe("Sure, happy to help!");
  });

  it("releases reply text after a stripped context line", () => {
    expect(runStream(["[LLM state] x\n", "Okay, ", "let's begin."])).toBe(
      "Okay, let's begin.",
    );
  });
});
