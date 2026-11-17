import { beforeEach, describe, expect, it, vi } from "vitest";

const allowed = new Map<string, boolean>();
vi.mock("@workspace/db", () => {
  let lastId = "";
  const chain = {
    from: () => chain,
    where: (cond: { id: string }) => { lastId = cond.id; return chain; },
    limit: async () => (allowed.has(lastId) ? [{ allowed: allowed.get(lastId) }] : []),
  };
  return { db: { select: () => chain }, usersTable: { agentEditAllowed: "agent_edit_allowed", clerkId: "clerk_id" } };
});
vi.mock("drizzle-orm", () => ({ eq: (_col: unknown, id: string) => ({ id }) }));

import { AGENT_EDIT_RESTRICTED_CODE, invalidateAgentEditAccess, requireAgentEditAccess } from "./agent-edit-access.js";

function run(req: Record<string, unknown>) {
  return new Promise<{ next: boolean; status?: number; body?: { code?: string } }>((resolve) => {
    const res = {
      status(code: number) { return { json: (body: { code?: string }) => resolve({ next: false, status: code, body }) }; },
    };
    requireAgentEditAccess(req as never, res as never, () => resolve({ next: true }));
  });
}

beforeEach(() => {
  allowed.clear();
  for (const id of ["paid", "blocked", "partner"]) invalidateAgentEditAccess(id);
});

describe("requireAgentEditAccess", () => {
  it("lets an allowed account through", async () => {
    allowed.set("paid", true);
    expect(await run({ clerkUserId: "paid" })).toEqual({ next: true });
  });

  it("blocks an account without access with the restriction code", async () => {
    allowed.set("blocked", false);
    const r = await run({ clerkUserId: "blocked" });
    expect(r.status).toBe(403);
    expect(r.body?.code).toBe(AGENT_EDIT_RESTRICTED_CODE);
  });

  it("blocks unknown accounts by default", async () => {
    expect((await run({ clerkUserId: "nobody" })).status).toBe(403);
  });

  it("blocks a partner without access acting for an allowed client", async () => {
    allowed.set("paid", true);
    allowed.set("partner", false);
    expect((await run({ clerkUserId: "paid", actingPartnerClerkId: "partner" })).status).toBe(403);
  });

  it("lets an admin in Admin Mode through", async () => {
    allowed.set("blocked", false);
    expect(await run({ clerkUserId: "blocked", impersonationSession: { id: 1 } })).toEqual({ next: true });
  });
});
