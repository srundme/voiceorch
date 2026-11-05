import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, platformSettingsTable: {} }));

import { checkVobizCredentials } from "./vobiz-account.js";

type Reply = { status: number; body?: unknown } | Error;

/** Stub fetch: the account lookup gets `account`, every number-list call gets `numbers`. */
function stubVobiz(account: Reply, numbers: Reply = { status: 200, body: { items: [] } }) {
  const fetchMock = vi.fn(async (url: string | URL) => {
    const reply = /\/(Number|numbers)/.test(String(url)) ? numbers : account;
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("checkVobizCredentials", () => {
  it("accepts working credentials when the number is on the account", async () => {
    stubVobiz({ status: 200 }, { status: 200, body: { items: [{ id: "n1", e164: "+919876543210" }] } });
    expect(await checkVobizCredentials("MA_X", "tok", "+91 98765 43210")).toEqual({ status: "ok" });
  });

  it("reports a wrong Auth ID / Auth Token", async () => {
    stubVobiz({ status: 401 });
    expect(await checkVobizCredentials("MA_X", "bad", "+919876543210")).toEqual({ status: "rejected", httpStatus: 401 });
  });

  it("reports a number that belongs to a different account", async () => {
    stubVobiz({ status: 200 }, { status: 200, body: { items: [{ id: "n1", e164: "+918000000000" }] } });
    expect(await checkVobizCredentials("MA_X", "tok", "+919876543210")).toEqual({ status: "number_not_on_account" });
  });

  it("doesn't block when VoBiz returns no number list", async () => {
    stubVobiz({ status: 200 }, { status: 404 });
    expect(await checkVobizCredentials("MA_X", "tok", "+919876543210")).toEqual({ status: "ok" });
  });

  it("doesn't block when VoBiz is unreachable or erroring", async () => {
    stubVobiz(new Error("ECONNRESET"));
    expect((await checkVobizCredentials("MA_X", "tok", "+919876543210")).status).toBe("unknown");
    stubVobiz({ status: 503 });
    expect((await checkVobizCredentials("MA_X", "tok", "+919876543210")).status).toBe("unknown");
  });
});
