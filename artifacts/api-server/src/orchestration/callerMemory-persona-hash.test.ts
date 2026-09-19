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
  computePersonaHash,
  computeAgentPersonaHash,
  isPersonaSwap,
  PERSONA_IDENTITY_HASH_PREFIX,
} from "./callerMemory.js";

describe("computeAgentPersonaHash", () => {
  it("hashes leftover systemPrompt when there is no promptCore identity", () => {
    expect(computeAgentPersonaHash({ systemPrompt: "You are a helpful agent." }))
      .toBe(computePersonaHash("You are a helpful agent."));
    expect(computeAgentPersonaHash({ systemPrompt: "You are a helpful agent." }))
      .not.toMatch(new RegExp(`^${PERSONA_IDENTITY_HASH_PREFIX}`));
  });

  it("does not treat Additional-script edits as a persona swap when Identity is set", () => {
    const core = { identity: { name: "Merlin", role: "Advisor", company: "Yemmar Finserv" } };
    const essay = computeAgentPersonaHash({
      systemPrompt: "A".repeat(8000),
      promptCore: core,
    });
    const stub = computeAgentPersonaHash({
      systemPrompt: "Follow Identity, Flow, and Knowledge. Do not repeat the greeting.",
      promptCore: core,
    });
    expect(essay).toMatch(new RegExp(`^${PERSONA_IDENTITY_HASH_PREFIX}`));
    expect(stub).toBe(essay);
    expect(isPersonaSwap(essay, stub)).toBe(false);
  });

  it("does treat a company/role change as a persona swap", () => {
    const a = computeAgentPersonaHash({
      promptCore: { identity: { name: "Merlin", role: "Advisor", company: "Yemmar Finserv" } },
    });
    const b = computeAgentPersonaHash({
      promptCore: { identity: { name: "Merlin", role: "Advisor", company: "Other Finserv" } },
    });
    expect(isPersonaSwap(a, b)).toBe(true);
  });

  it("does not wipe memory when migrating from a raw-prompt hash to an identity hash", () => {
    const legacy = computePersonaHash("the old 8k essay");
    const identity = computeAgentPersonaHash({
      systemPrompt: "Follow Identity, Flow, and Knowledge.",
      promptCore: { identity: { name: "Merlin", company: "Yemmar Finserv" } },
    });
    expect(isPersonaSwap(legacy, identity)).toBe(false);
  });
});
