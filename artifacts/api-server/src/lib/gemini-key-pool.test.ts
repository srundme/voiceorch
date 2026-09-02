import { describe, expect, it, beforeEach } from "vitest";
import {
  applyGeminiPoolEdits,
  clearGeminiKeyExhaustion,
  isGeminiQuotaError,
  markGeminiKeyExhausted,
  maskGeminiKey,
  parseGeminiKeyList,
  parseIncomingGeminiPool,
  pickGeminiKeyFromList,
  splitGeminiPool,
} from "./gemini-key-pool.js";

describe("gemini-key-pool", () => {
  beforeEach(() => clearGeminiKeyExhaustion());

  it("parses primary + JSON extras + env without duplicates", () => {
    expect(parseGeminiKeyList("AIza1111aaaa", JSON.stringify(["AIza2222bbbb", "AIza1111aaaa"]), "AIza3333cccc"))
      .toEqual(["AIza1111aaaa", "AIza2222bbbb", "AIza3333cccc"]);
  });

  it("keeps masked slots and drops removed rows", () => {
    const existing = ["AIza1111aaaa", "AIza2222bbbb", "AIza3333cccc"];
    const incoming = [maskGeminiKey(existing[0]!), "AIza9999zzzz"];
    expect(applyGeminiPoolEdits(existing, incoming)).toEqual(["AIza1111aaaa", "AIza9999zzzz"]);
  });

  it("picks the next key after quota exhaust", () => {
    const keys = ["k1-xxxx", "k2-yyyy", "k3-zzzz"];
    expect(pickGeminiKeyFromList(keys, 1_000)).toBe("k1-xxxx");
    markGeminiKeyExhausted("k1-xxxx", 60_000, 1_000);
    expect(pickGeminiKeyFromList(keys, 1_001)).toBe("k2-yyyy");
    markGeminiKeyExhausted("k2-yyyy", 60_000, 1_001);
    expect(pickGeminiKeyFromList(keys, 1_002)).toBe("k3-zzzz");
  });

  it("falls back to the first key when every key is cooling down", () => {
    markGeminiKeyExhausted("a", 60_000, 0);
    markGeminiKeyExhausted("b", 60_000, 0);
    expect(pickGeminiKeyFromList(["a", "b"], 1)).toBe("a");
  });

  it("detects Gemini quota errors", () => {
    expect(isGeminiQuotaError(new Error("429 RESOURCE_EXHAUSTED"))).toBe(true);
    expect(isGeminiQuotaError(new Error("You exceeded your current quota"))).toBe(true);
    expect(isGeminiQuotaError(new Error("invalid api key"))).toBe(false);
    expect(isGeminiQuotaError(new Error("max tokens exceeded"))).toBe(false);
  });

  it("splits primary vs extras for storage", () => {
    expect(splitGeminiPool(["first", "second", "third"])).toEqual({
      primary: "first",
      extras: ["second", "third"],
    });
  });

  it("parses pool payloads from admin save", () => {
    expect(parseIncomingGeminiPool(["AIza••••aaaa", "AIza9999zzzz"])).toEqual(["AIza••••aaaa", "AIza9999zzzz"]);
    expect(parseIncomingGeminiPool(JSON.stringify(["one", "two"]))).toEqual(["one", "two"]);
    expect(parseIncomingGeminiPool(null)).toBeNull();
  });
});
