import { describe, it, expect } from "vitest";
import {
  isKbPhase3CanaryAgent,
  kbQueryChanged,
  parseKbPhase3CanaryAgentIds,
  phase3RetrievalBucket,
} from "./kb-phase3-flags.js";
import { resolveKbRetrievalGateMode } from "./kb-retrieval-gate.js";
import { resolveKbQueryBuilderMode } from "./kb-query-builder.js";

describe("KB Phase 3 canary flags", () => {
  it("parses comma and whitespace agent ids", () => {
    expect([...parseKbPhase3CanaryAgentIds({ KB_PHASE3_CANARY_AGENT_IDS: "12, 34 56" })].sort((a, b) => a - b))
      .toEqual([12, 34, 56]);
    expect(parseKbPhase3CanaryAgentIds({}).size).toBe(0);
    expect(parseKbPhase3CanaryAgentIds({ KB_PHASE3_CANARY_AGENT_IDS: "nope,0,-1" }).size).toBe(0);
  });

  it("enables gate+builder on only for listed agents", () => {
    const env = { KB_PHASE3_CANARY_AGENT_IDS: "1234,1231" };
    expect(isKbPhase3CanaryAgent(1234, env)).toBe(true);
    expect(resolveKbRetrievalGateMode(env, 1234)).toBe("on");
    expect(resolveKbQueryBuilderMode(env, 1234)).toBe("on");
    expect(resolveKbRetrievalGateMode(env, 99)).toBe("off");
    expect(resolveKbQueryBuilderMode(env, 99)).toBe("off");
  });

  it("does not override a global on for unlisted agents", () => {
    const env = {
      KB_PHASE3_CANARY_AGENT_IDS: "1234",
      KB_RETRIEVAL_GATE: "on",
      KB_QUERY_BUILDER: "on",
    };
    expect(resolveKbRetrievalGateMode(env, 99)).toBe("on");
    expect(resolveKbQueryBuilderMode(env, 99)).toBe("on");
  });

  it("keeps everyone off when the canary list is empty and flags are off", () => {
    expect(resolveKbRetrievalGateMode({}, 1234)).toBe("off");
    expect(resolveKbQueryBuilderMode({}, 1234)).toBe("off");
  });

  it("turns Phase 3 on for the five PSTN canary agents only, with global flags off", () => {
    const env = {
      KB_RETRIEVAL_GATE: "off",
      KB_QUERY_BUILDER: "off",
      KB_PHASE3_CANARY_AGENT_IDS: "1234,1231,1224,1233,1216",
    };
    for (const id of [1234, 1231, 1224, 1233, 1216]) {
      expect(isKbPhase3CanaryAgent(id, env)).toBe(true);
      expect(resolveKbRetrievalGateMode(env, id)).toBe("on");
      expect(resolveKbQueryBuilderMode(env, id)).toBe("on");
    }
    expect(isKbPhase3CanaryAgent(931, env)).toBe(false);
    expect(resolveKbRetrievalGateMode(env, 931)).toBe("off");
    expect(resolveKbQueryBuilderMode(env, 931)).toBe("off");
    expect(resolveKbRetrievalGateMode(env)).toBe("off");
    expect(resolveKbQueryBuilderMode(env)).toBe("off");
  });
});

describe("queryChanged and review buckets", () => {
  it("is true only when the live search string differs", () => {
    expect(kbQueryChanged("How much?", "How much?")).toBe(false);
    expect(kbQueryChanged("How much?", "Elevate How much?")).toBe(true);
  });

  it("maps the four canary review buckets", () => {
    expect(phase3RetrievalBucket({ gateDecision: "skip", queryChanged: false, fallbackUsed: false }))
      .toBe("gate_skipped");
    expect(phase3RetrievalBucket({ gateDecision: "retrieve", queryChanged: false, fallbackUsed: false }))
      .toBe("raw_retained");
    expect(phase3RetrievalBucket({ gateDecision: "retrieve", queryChanged: true, fallbackUsed: false }))
      .toBe("query_augmented");
    expect(phase3RetrievalBucket({ gateDecision: "retrieve", queryChanged: false, fallbackUsed: true }))
      .toBe("query_fallback");
  });
});
