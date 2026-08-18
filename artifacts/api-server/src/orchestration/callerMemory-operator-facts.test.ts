import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  callerProfilesTable: {},
  scheduledCallbacksTable: {},
  callerFactsTable: {},
  callerCallArchiveTable: {},
  callerSentencesTable: {},
  callerFactSentenceLinksTable: {},
  callerEpisodeFactLinksTable: {},
  pendingCallerFactsTable: {},
  canonicalizeCallerKey: (p: string) => p,
  isRealPhoneNumber: () => true,
  humanPhone: (p: string) => p,
  resolveCallerKey: (_d: string, f: string) => f,
}));

import {
  sanitizeExternalFactKey,
  sanitizeLeadContextKey,
  isOperatorFactKey,
  parseExternalMemoryBody,
  injectEnhancedMemory,
  OPERATOR_UPDATE_FACT_KEY,
  EXTERNAL_FACT_PREFIX,
  type CallerContext,
} from "./callerMemory.js";

function ctx(partial: Partial<CallerContext> = {}): CallerContext {
  return {
    profile: {
      id: 1,
      agentId: 1,
      phoneNumber: "919000000000",
      name: "Priya",
      summary: null,
      callCount: 2,
      lastCalledAt: new Date(),
      lastCallDropped: false,
      lastCallDroppedAt: null,
      predictedIntent: null,
      riskScore: null,
      sentimentTrend: null,
      preferredLanguage: null,
    },
    facts: [],
    recentCalls: [],
    ...partial,
  };
}

describe("sanitizeExternalFactKey", () => {
  it("namespaces CRM keys under ext_", () => {
    expect(sanitizeExternalFactKey("Order Status")).toBe("ext_order_status");
    expect(sanitizeExternalFactKey("ext_tracking_id")).toBe("ext_tracking_id");
  });

  it("keeps operator_update unprefixed", () => {
    expect(sanitizeExternalFactKey("operator_update")).toBe(OPERATOR_UPDATE_FACT_KEY);
  });

  it("rejects internal keys", () => {
    expect(sanitizeExternalFactKey("__agent_persona_hash")).toBeNull();
    expect(sanitizeExternalFactKey("___")).toBeNull();
    expect(sanitizeExternalFactKey("")).toBeNull();
  });
});

describe("sanitizeLeadContextKey", () => {
  it("strips ext_ so campaign variables stay human", () => {
    expect(sanitizeLeadContextKey("Order Status")).toBe("order_status");
    expect(sanitizeLeadContextKey("ext_order_status")).toBe("order_status");
  });
});

describe("isOperatorFactKey", () => {
  it("matches operator note and ext_ keys only", () => {
    expect(isOperatorFactKey(OPERATOR_UPDATE_FACT_KEY)).toBe(true);
    expect(isOperatorFactKey(`${EXTERNAL_FACT_PREFIX}order_status`)).toBe(true);
    expect(isOperatorFactKey("name")).toBe(false);
    expect(isOperatorFactKey("order_status")).toBe(false);
  });
});

describe("parseExternalMemoryBody", () => {
  it("accepts note + context + facts", () => {
    const parsed = parseExternalMemoryBody({
      note: "Refund approved",
      context: { order_status: "shipped" },
      facts: [{ key: "tracking_id", value: "TRK-1" }],
    });
    expect(parsed).toMatchObject({
      update: {
        note: "Refund approved",
        context: { order_status: "shipped" },
        facts: [{ key: "tracking_id", value: "TRK-1" }],
      },
    });
  });

  it("rejects empty bodies", () => {
    expect(parseExternalMemoryBody({})).toEqual({ error: "Provide note, facts, and/or context" });
  });
});

describe("injectEnhancedMemory operator facts", () => {
  const operatorFact = {
    id: 9,
    key: "ext_order_status",
    value: "shipped yesterday, arriving Friday",
    confidence: 1,
    sourceCallId: null,
    sourceSentenceIds: [] as number[],
    supersededById: null,
    createdAt: new Date(),
  };
  const noteFact = {
    ...operatorFact,
    id: 10,
    key: OPERATOR_UPDATE_FACT_KEY,
    value: "Refund of ₹1200 approved",
  };

  it("injects ext_ and operator_update even though they are not durable identity facts", () => {
    const prompt = injectEnhancedMemory("You are a support agent.", ctx({
      facts: [operatorFact, noteFact],
    }));
    expect(prompt).toContain("OPERATOR / CRM UPDATES");
    expect(prompt).toContain("order status: shipped yesterday, arriving Friday");
    expect(prompt).toContain("Latest update: Refund of ₹1200 approved");
    expect(prompt).toContain("OPERATOR UPDATES ARE GROUND TRUTH");
    expect(prompt).not.toMatch(/KNOWN DETAILS ABOUT THIS CALLER[\s\S]*order status/);
  });

  it("still injects operator facts when personaChanged suppresses durable memory", () => {
    const prompt = injectEnhancedMemory("You are a support agent.", ctx({
      personaChanged: true,
      facts: [operatorFact, { ...operatorFact, id: 2, key: "location", value: "Chennai" }],
    }));
    expect(prompt).toContain("OPERATOR / CRM UPDATES");
    expect(prompt).toContain("order status: shipped yesterday, arriving Friday");
    expect(prompt).not.toContain("KNOWN DETAILS ABOUT THIS CALLER");
    expect(prompt).not.toContain("Chennai");
  });
});
