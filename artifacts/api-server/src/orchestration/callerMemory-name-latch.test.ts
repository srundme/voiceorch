import { describe, it, expect, vi } from "vitest";

// callerMemory.ts imports @workspace/db at module load; stub it so the pure
// detection/override logic can be tested without a database connection.
vi.mock("@workspace/db", () => ({
  db: {},
  callerProfilesTable: {},
  scheduledCallbacksTable: {},
  callerFactsTable: {},
  callerCallArchiveTable: {},
  callerSentencesTable: {},
  callerFactSentenceLinksTable: {},
  callerEpisodeFactLinksTable: {},
  canonicalizeCallerKey: (p: string) => p,
  isRealPhoneNumber: () => true,
  humanPhone: (p: string) => p,
  resolveCallerKey: (_d: string, f: string) => f,
}));

import {
  detectNameLatch,
  isPlausibleName,
  NAME_PATTERNS,
  shouldLatchOverrideExtraction,
  injectEnhancedMemory,
  isAbruptEnd,
  type CallerProfile,
} from "./callerMemory.js";

describe("detectNameLatch — rejections (no latch)", () => {
  const rejected = [
    "I am sorry",
    "I'm not able to help",
    "I am calling about my policy",
    "I'm trying to reach someone",
    // The confirmed false positive: "so confused" must never latch as a name.
    "I am so confused right now",
    "I am very happy with the service",
    "I am really interested",
  ];
  for (const phrase of rejected) {
    it(`rejects: "${phrase}"`, () => {
      expect(detectNameLatch(phrase)).toBeNull();
    });
  }

  it("rejects when the next token after the matched span is a continuation word", () => {
    // Two-word capture "Arjun Kumar" is plausible, but "trying" right after
    // reveals a sentence continuation, not a self-introduction.
    expect(detectNameLatch("I am Arjun Kumar trying to reach support")).toBeNull();
    expect(detectNameLatch("I am Arjun Kumar calling about my order")).toBeNull();
  });
});

describe("detectNameLatch — Tier A (explicit self-introductions)", () => {
  const tierA: Array<[string, string]> = [
    ["My name is Karthik", "Karthik"],
    ["This is Priya speaking", "Priya"],
    ["என் பேர் Arjun", "Arjun"],
    ["என்னோட பேரு Murali", "Murali"],
    ["என் பெயர் Kavitha", "Kavitha"],
    ["நான் Ravi பேசுறேன்", "Ravi"],
    ["मेरा नाम Divya", "Divya"],
    ["You can call me Ravi", "Ravi"],
  ];
  for (const [phrase, name] of tierA) {
    it(`latches "${phrase}" → ${name} (Tier A)`, () => {
      expect(detectNameLatch(phrase)).toEqual({ name, tier: "A" });
    });
  }

  it('keeps "this is X" gated on a speaker cue', () => {
    expect(detectNameLatch("this is regarding the managed plan")).toBeNull();
  });

  it('rejects "who\'s this" style fragments as names', () => {
    expect(detectNameLatch("my name is who")).toBeNull();
    expect(detectNameLatch("I am this")).toBeNull();
  });

  it("latches the affirmed name after a Tamil denial (call 14222)", () => {
    expect(
      detectNameLatch("சார் என்னோட பேரு ராஜேஸ்வரி கிடையாது என்னோட பேரு வந்து சிவராம்"),
    ).toEqual({ name: "சிவராம்", tier: "A" });
  });

  it("latches romanized Tamil with a trailing denial (enoda peru Karthi, rajeswari ella)", () => {
    expect(detectNameLatch("enoda peru Karthi, rajeswari ella")).toEqual({
      name: "Karthi",
      tier: "A",
    });
  });
});

describe("detectNameLatch — Tier B (ambiguous 'I am X')", () => {
  it('latches "I am Arjun" as Tier B', () => {
    expect(detectNameLatch("I am Arjun")).toEqual({ name: "Arjun", tier: "B" });
  });
  it(`latches "I'm Divya" as Tier B`, () => {
    expect(detectNameLatch("I'm Divya")).toEqual({ name: "Divya", tier: "B" });
  });
  it('latches Hindi "मैं Anand हूँ" as Tier B', () => {
    expect(detectNameLatch("मैं Anand हूँ")).toEqual({ name: "Anand", tier: "B" });
  });
});

describe("isPlausibleName", () => {
  it("accepts ordinary names", () => {
    expect(isPlausibleName("Karthik")).toBe(true);
    expect(isPlausibleName("Arjun Kumar")).toBe(true);
  });
  it("rejects the new intensifier/emotion stopwords", () => {
    for (const w of ["so confused", "so", "confused", "very", "really"]) {
      expect(isPlausibleName(w)).toBe(false);
    }
  });
  it("rejects Tamil/English negation fragments as names", () => {
    expect(isPlausibleName("ராஜேஸ்வரி கிடையாது")).toBe(false);
    expect(isPlausibleName("not Rajesh")).toBe(false);
  });
  it("keeps existing rejections", () => {
    for (const w of ["sorry", "calling", "trying", "tomorrow by", "managed"]) {
      expect(isPlausibleName(w)).toBe(false);
    }
  });
});

describe("NAME_PATTERNS tiering", () => {
  it("only ambiguous self-intros are Tier B (English I am / Hindi मैं हूँ)", () => {
    const tierB = NAME_PATTERNS.filter((p) => p.tier === "B");
    expect(tierB).toHaveLength(2);
    expect(tierB.some((p) => p.pattern.source.includes("i(?:'m| am)"))).toBe(true);
    expect(tierB.some((p) => p.pattern.source.includes("हूँ"))).toBe(true);
  });
});

// Simulates the Phase 3c identity-contamination guard in updateCallerProfile:
// override happens only when the latch tier grants it and the names conflict.
function resolveFinalName(
  latched: string | null,
  latchTier: "A" | "B" | null,
  extracted: string | null,
): string | null {
  if (latched && extracted && extracted.toLowerCase() !== latched.toLowerCase()) {
    return shouldLatchOverrideExtraction(latchTier) ? latched : extracted;
  }
  // No conflict: extraction wins if present, else the real-time latch write stands.
  return extracted ?? latched;
}

describe("call-end override guard (tier-conditional)", () => {
  it("Tier A latch overrides a conflicting LLM extraction (unchanged behavior)", () => {
    expect(shouldLatchOverrideExtraction("A")).toBe(true);
    expect(resolveFinalName("Karthik", "A", "Ramesh")).toBe("Karthik");
  });

  it("absent/null tier is treated as Tier A (legacy behavior)", () => {
    expect(shouldLatchOverrideExtraction(null)).toBe(true);
    expect(shouldLatchOverrideExtraction(undefined)).toBe(true);
  });

  it('"I am Arjun" + extraction agrees "Arjun" → final name Arjun', () => {
    const latch = detectNameLatch("I am Arjun")!;
    expect(resolveFinalName(latch.name, latch.tier, "Arjun")).toBe("Arjun");
  });

  it('"I am Arjun" + extraction says "Karthik" → Tier B defers, final name Karthik', () => {
    const latch = detectNameLatch("I am Arjun")!;
    expect(shouldLatchOverrideExtraction(latch.tier)).toBe(false);
    expect(resolveFinalName(latch.name, latch.tier, "Karthik")).toBe("Karthik");
  });

  it(`"I'm Divya" + call drops before extraction → real-time write persists Divya`, () => {
    const latch = detectNameLatch("I'm Divya")!;
    // No extraction ran — the latch's immediate DB write is the final state.
    expect(resolveFinalName(latch.name, latch.tier, null)).toBe("Divya");
  });
});

describe("injectEnhancedMemory — returning-caller opener (call 14351)", () => {
  it("does not tell the greeting LLM to recap bookings in the first line", () => {
    const profile = {
      id: 1,
      agentId: 67,
      phoneNumber: "917971543255",
      name: "Karthik",
      summary: "wiring issue and demo slot",
      callCount: 15,
      lastCalledAt: new Date("2026-08-27"),
      lastCallDropped: false,
      lastCallDroppedAt: null,
      predictedIntent: null,
      riskScore: null,
      sentimentTrend: null,
      preferredLanguage: "ta-IN",
    } satisfies CallerProfile;
    const out = injectEnhancedMemory("base prompt", {
      profile,
      facts: [],
      recentCalls: [],
    });
    expect(out).not.toMatch(/naturally reference what you already know/);
    expect(out).toMatch(/Do NOT recap previous bookings/);
  });
});

describe("isAbruptEnd — completed call must not keep resume-drop (call 21824)", () => {
  const base = {
    id: 1,
    agentId: 1113,
    phoneNumber: "918904887300",
    name: "Yashwanth",
    summary: null,
    callCount: 1,
    predictedIntent: null,
    riskScore: null,
    sentimentTrend: null,
    preferredLanguage: "ta-IN",
  };

  it("resumes only when the drop stamp is the latest call event", () => {
    const droppedAt = new Date();
    expect(isAbruptEnd({
      ...base,
      lastCalledAt: droppedAt,
      lastCallDropped: true,
      lastCallDroppedAt: droppedAt,
    })).toBe(true);
  });

  it("does not resume after a later completed call left a stale drop flag", () => {
    const droppedAt = new Date(Date.now() - 90_000);
    const completedAt = new Date();
    expect(isAbruptEnd({
      ...base,
      lastCalledAt: completedAt,
      lastCallDropped: true,
      lastCallDroppedAt: droppedAt,
    })).toBe(false);
  });
});
