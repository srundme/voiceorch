/**
 * dialOutboundAgent `testRun` option: DNC + destination OTP are skipped ONLY
 * for a valid run dialing the user's verified own number. No real dial — the
 * telephony layer is mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Rows = Record<string, unknown[]>;
let rows: Rows = {};
const inserted: Array<Record<string, unknown>> = [];

function query(table: { __t: string }) {
  const result = () => Promise.resolve(rows[table.__t] ?? []);
  const q: Record<string, unknown> = {
    where: () => q,
    limit: () => q,
    orderBy: () => q,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => result().then(res, rej),
  };
  return q;
}

vi.mock("@workspace/db", () => {
  const t = (name: string) => new Proxy({ __t: name } as Record<string, unknown>, {
    get: (target, prop) => (prop in target ? target[prop as string] : `${name}.${String(prop)}`),
  });
  return {
  db: {
    select: () => ({ from: (table: { __t: string }) => query(table) }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return { returning: async () => [{ id: 900 }] };
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
  agentsTable: t("agents"),
  callsTable: t("calls"),
  providersTable: t("providers"),
  usersTable: t("users"),
  platformSettingsTable: t("platform_settings"),
  phoneNumbersTable: t("phone_numbers"),
  vobizAccountsTable: t("vobiz_accounts"),
  verifiedPhoneDestinationsTable: t("verified_destinations"),
  };
});

const dialVobiz = vi.fn();
vi.mock("../orchestration/telephony/dial.js", () => ({
  dialTwilio: vi.fn(),
  dialPlivo: vi.fn(),
  dialVobiz: (...a: unknown[]) => dialVobiz(...a),
  resolveAmdConfig: () => ({ enabled: false, twilioMode: "Enable" }),
}));
vi.mock("../lib/crypto.js", () => ({ decryptKey: (s: string) => s }));
vi.mock("./minute-rates.js", () => ({
  resolveAgentBillingMode: async () => "managed",
  resolveOwnTelephonyDiscount: async () => 0,
  resolveBillingRateCentsPerMin: async () => 500,
}));
vi.mock("./partner-billing.js", () => ({ resolvePartnerBilling: async () => null }));
vi.mock("./irdai/gate.js", () => ({ evaluateIrdaiGate: () => ({ blocked: false }), IRDAI_BLOCKED_MESSAGE: "", IRDAI_BLOCKED_CODE: "" }));
vi.mock("./trai/index.js", () => ({ traiPreDialCheck: vi.fn(), logPreDialDecision: vi.fn() }));
const isOnDnc = vi.fn();
vi.mock("../lib/dnc-check.js", () => ({ isOnDnc: (...a: unknown[]) => isOnDnc(...a) }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { dialOutboundAgent, OutboundDialError } from "./outbound-agent-dial.js";

const TARGET = "+918045678901";

function baseRows(over: Rows = {}): Rows {
  return {
    agents: [{ id: 5, userId: "user_a", telephonyProvider: "vobiz", agentConfig: {}, outboundPhoneNumberId: null, maxDuration: 300, totalCalls: 0 }],
    users: [{ walletBalanceCents: 10_000 }],
    providers: [],
    vobiz_accounts: [],
    verified_destinations: [],
    platform_settings: [{ key: "x", value: JSON.stringify([TARGET, "+918000000002"]) }],
    ...over,
  };
}

async function dialErr(p: Promise<unknown>): Promise<OutboundDialError> {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(OutboundDialError);
  return e as OutboundDialError;
}

describe("dialOutboundAgent testRun", () => {
  beforeEach(() => {
    rows = baseRows();
    inserted.length = 0;
    dialVobiz.mockReset().mockResolvedValue({ requestUuid: "req-1", callUuid: null });
    isOnDnc.mockReset().mockResolvedValue(true);
  });

  it("blocks DNC numbers on a normal dial", async () => {
    const e = await dialErr(dialOutboundAgent({ userId: "user_a", agentId: 5, toNumber: TARGET, webhookBaseUrl: "https://x" }));
    expect(e.code).toBe("DNC_BLOCKED");
    expect(dialVobiz).not.toHaveBeenCalled();
  });

  it("requires destination OTP without KYC on a normal dial", async () => {
    isOnDnc.mockResolvedValue(false);
    const e = await dialErr(dialOutboundAgent({ userId: "user_a", agentId: 5, toNumber: TARGET, webhookBaseUrl: "https://x" }));
    expect(e.code).toBe("DESTINATION_UNVERIFIED");
  });

  it("skips DNC + OTP for a valid test run, flags the call, and never dials from the target number", async () => {
    const onBeforeDial = vi.fn().mockResolvedValue(undefined);
    const out = await dialOutboundAgent({
      userId: "user_a", agentId: 5, toNumber: TARGET, webhookBaseUrl: "https://x",
      testRun: { runId: 77, verifiedOwnNumber: TARGET, onBeforeDial },
    });
    expect(out.callId).toBe(900);
    expect(isOnDnc).not.toHaveBeenCalled();
    expect(onBeforeDial).toHaveBeenCalledWith("+918000000002");
    expect(dialVobiz.mock.calls[0]![0]).toMatchObject({ fromNumber: "+918000000002", toNumber: TARGET });
    expect(inserted[0]).toMatchObject({ isTest: true, testRunId: 77 });
    expect(onBeforeDial.mock.invocationCallOrder[0]!).toBeLessThan(dialVobiz.mock.invocationCallOrder[0]!);
  });

  it("rejects a test run whose destination is not the verified number (gates stay on)", async () => {
    const e = await dialErr(dialOutboundAgent({
      userId: "user_a", agentId: 5, toNumber: "+919999999999", webhookBaseUrl: "https://x",
      testRun: { runId: 77, verifiedOwnNumber: TARGET },
    }));
    expect(e.code).toBe("TEST_DESTINATION_MISMATCH");
    expect(dialVobiz).not.toHaveBeenCalled();
  });

  it("still requires wallet > 0 for test runs", async () => {
    rows = baseRows({ users: [{ walletBalanceCents: 0 }] });
    const e = await dialErr(dialOutboundAgent({
      userId: "user_a", agentId: 5, toNumber: TARGET, webhookBaseUrl: "https://x",
      testRun: { runId: 77, verifiedOwnNumber: TARGET },
    }));
    expect(e.code).toBe("INSUFFICIENT_BALANCE");
    expect(e.status).toBe(402);
  });

  it("refuses when the only caller line is the target number itself", async () => {
    rows = baseRows({ platform_settings: [{ key: "x", value: JSON.stringify([TARGET]) }] });
    const e = await dialErr(dialOutboundAgent({
      userId: "user_a", agentId: 5, toNumber: TARGET, webhookBaseUrl: "https://x",
      testRun: { runId: 77, verifiedOwnNumber: TARGET },
    }));
    expect(e.code).toBe("TEST_SAME_NUMBER");
    expect(dialVobiz).not.toHaveBeenCalled();
  });

  it("does not flag normal calls as tests", async () => {
    isOnDnc.mockResolvedValue(false);
    rows = baseRows({ vobiz_accounts: [{ kycStatus: "completed" }] });
    await dialOutboundAgent({ userId: "user_a", agentId: 5, toNumber: TARGET, webhookBaseUrl: "https://x" });
    expect(inserted[0]).not.toHaveProperty("isTest");
  });
});
