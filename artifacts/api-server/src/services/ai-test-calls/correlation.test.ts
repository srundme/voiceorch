import { describe, it, expect, vi, beforeEach } from "vitest";

const executeMock = vi.fn();
const updateWhere = vi.fn();
const updateSet = vi.fn(() => ({ where: updateWhere }));
vi.mock("@workspace/db", () => ({
  db: {
    execute: (...a: unknown[]) => executeMock(...a),
    update: () => ({ set: updateSet }),
  },
  callsTable: { id: "id" },
}));
vi.mock("../../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { canBeTestLeg, claimInboundTestLeg } from "./correlation.js";

const leg = { callId: 501, agentId: 11, fromNumber: "+918000000002", toNumber: "+918045678901" };

describe("canBeTestLeg", () => {
  it("rejects webcall / meet / missing caller IDs without touching the DB", () => {
    expect(canBeTestLeg({ ...leg, fromNumber: "webcall:abc" })).toBe(false);
    expect(canBeTestLeg({ ...leg, fromNumber: "" })).toBe(false);
    expect(canBeTestLeg({ ...leg, callId: 0 })).toBe(false);
    expect(canBeTestLeg(leg)).toBe(true);
  });
});

describe("claimInboundTestLeg", () => {
  beforeEach(() => {
    executeMock.mockReset();
    updateSet.mockClear();
    updateWhere.mockReset().mockResolvedValue(undefined);
  });

  it("links the call to the claimed run and flags it as a test leg", async () => {
    executeMock.mockResolvedValueOnce({ rows: [{ id: 42 }] });
    await expect(claimInboundTestLeg(leg)).resolves.toBe(42);
    expect(updateSet).toHaveBeenCalledWith({ isTest: true, testRunId: 42 });
  });

  it("returns null and leaves the call untouched when no run matches (or it was already claimed)", async () => {
    executeMock.mockResolvedValueOnce({ rows: [] });
    await expect(claimInboundTestLeg(leg)).resolves.toBeNull();
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("only one of two racing legs wins the claim", async () => {
    executeMock.mockResolvedValueOnce({ rows: [{ id: 42 }] }).mockResolvedValueOnce({ rows: [] });
    const results = await Promise.all([claimInboundTestLeg(leg), claimInboundTestLeg({ ...leg, callId: 502 })]);
    expect(results.filter((r) => r === 42)).toHaveLength(1);
    expect(updateSet).toHaveBeenCalledTimes(1);
  });

  it("matches on last-10 digits of the caller ID, target agent, and atomic unclaimed run", async () => {
    executeMock.mockResolvedValueOnce({ rows: [] });
    await claimInboundTestLeg({ ...leg, fromNumber: "08000000002" });
    const query = executeMock.mock.calls[0]![0] as { queryChunks: unknown[] };
    const flat = JSON.stringify(query.queryChunks);
    expect(flat).toContain("8000000002");
    expect(flat).toContain("FOR UPDATE SKIP LOCKED");
    expect(flat).toContain("callee_call_id IS NULL");
  });

  it("skips non-phone legs without a query", async () => {
    await expect(claimInboundTestLeg({ ...leg, fromNumber: "webcall:1" })).resolves.toBeNull();
    expect(executeMock).not.toHaveBeenCalled();
  });
});
