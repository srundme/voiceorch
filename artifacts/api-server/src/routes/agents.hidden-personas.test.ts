/**
 * GET /agents must never list hidden AI Test Call persona agents.
 * Captures the WHERE clause and compiles it with drizzle's PG dialect.
 */
import { beforeAll, describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const captured: SQL[] = [];

vi.mock("@workspace/db", async () => {
  const schema = await import("@workspace/db/schema");
  const chain = (rows: unknown[]) => {
    const q: Record<string, unknown> = {
      where: (w: SQL) => { captured.push(w); return q; },
      orderBy: () => q,
      limit: () => q,
      then: (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res),
    };
    return q;
  };
  return {
    ...schema,
    db: { select: () => ({ from: () => chain([]) }) },
    pool: {},
  };
});
vi.mock("../middlewares/requireAuth.js", () => ({ requireAuth: (_r: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../middlewares/clientContext.js", () => ({ clientContext: (_r: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../services/workspace-scope.js", () => ({
  resolveWorkspaceScope: async () => ({ userIds: ["user_a"], ownerUserId: "user_a", canWrite: true, isOwner: true }),
}));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

describe("GET /agents", () => {
  let router: unknown;
  beforeAll(async () => {
    router = (await import("./agents.js")).default;
  }, 60_000);

  it("filters out is_test_persona agents", async () => {
    const layer = (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> })
      .stack.find((l) => l.route?.path === "/agents" && l.route.methods["get"]);
    expect(layer).toBeTruthy();
    const handler = layer!.route!.stack.at(-1)!.handle;
    let body: unknown;
    const res = { json: (b: unknown) => { body = b; return res; }, status: () => res };
    await handler({ clerkUserId: "user_a", log: { warn: vi.fn() } }, res, () => {});
    expect(body).toEqual([]);
    const compiled = new PgDialect().sqlToQuery(captured[0]!);
    expect(compiled.sql).toContain('"agents"."is_test_persona" = $');
    expect(compiled.params).toContain(false);
  });
});
