import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, pool: {}, phoneNumbersTable: {}, usersTable: {} }));
vi.mock("../minute-rates.js", () => ({
  resolveAgentBillingMode: vi.fn(),
  resolveBillingRateCentsPerMin: vi.fn(),
  resolveOwnTelephonyDiscount: vi.fn(),
}));
vi.mock("../partner-billing.js", () => ({ resolvePartnerBilling: vi.fn() }));

import { checkRunPreconditions, TestRunPreconditionError, type PreconditionDeps } from "./preconditions.js";

const target = {
  id: 11,
  userId: "user_a",
  asrProvider: "sarvam",
  llmProvider: "sarvam",
  ttsProvider: "sarvam",
  telephonyProvider: "vobiz",
};

function deps(over: Partial<PreconditionDeps> = {}): PreconditionDeps {
  return {
    findInboundNumbers: async () => [{ id: 1, number: "+918045678901", userId: "user_a", routingRules: null, squadId: null }],
    walletBalanceCents: async () => 100_000,
    concurrentLimit: async () => 10,
    activeCallSlots: async () => 0,
    rateCentsPerMin: async () => 500,
    ...over,
  };
}

async function expectError(p: Promise<unknown>, code: string, status: number) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(TestRunPreconditionError);
  expect((err as TestRunPreconditionError).code).toBe(code);
  expect((err as TestRunPreconditionError).status).toBe(status);
}

describe("checkRunPreconditions", () => {
  it("passes and returns the number + estimate", async () => {
    const out = await checkRunPreconditions({ target, maxDurations: [300, 300] }, deps());
    expect(out.inboundNumber.number).toBe("+918045678901");
    expect(out.estimatedCostCents).toBe(2 * (2500 + 2500));
  });

  it("400 when the agent has no inbound number", async () => {
    await expectError(checkRunPreconditions({ target, maxDurations: [300] }, deps({ findInboundNumbers: async () => [] })), "NO_INBOUND_NUMBER", 400);
  });

  it("400 when the number belongs to another user", async () => {
    await expectError(checkRunPreconditions({ target, maxDurations: [300] }, deps({
      findInboundNumbers: async () => [{ id: 1, number: "+918045678901", userId: "user_b", routingRules: null, squadId: null }],
    })), "INBOUND_NUMBER_NOT_OWNED", 400);
  });

  it("400 when the number routes elsewhere", async () => {
    await expectError(checkRunPreconditions({ target, maxDurations: [300] }, deps({
      findInboundNumbers: async () => [{ id: 1, number: "+918045678901", userId: "user_a", routingRules: [{ condition: "always", targetAgentId: 2 }], squadId: null }],
    })), "INBOUND_NUMBER_ROUTED", 400);
  });

  it("402 when the wallet cannot cover both legs at max duration", async () => {
    await expectError(checkRunPreconditions({ target, maxDurations: [300] }, deps({ walletBalanceCents: async () => 4999 })), "INSUFFICIENT_BALANCE", 402);
    await expectError(checkRunPreconditions({ target, maxDurations: [300] }, deps({ walletBalanceCents: async () => 0 })), "INSUFFICIENT_BALANCE", 402);
  });

  it("409 when fewer than 2 call slots are free", async () => {
    await expectError(checkRunPreconditions({ target, maxDurations: [300] }, deps({ activeCallSlots: async () => 9 })), "NO_CALL_SLOTS", 409);
  });
});
