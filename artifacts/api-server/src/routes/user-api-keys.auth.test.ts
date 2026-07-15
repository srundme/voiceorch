/**
 * Unit tests for authenticateApiKey middleware — ensures sk_live_ Bearer
 * tokens set clerkUserId and reject revoked/invalid keys.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";

const selectMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    select: (...args: unknown[]) => selectMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    insert: vi.fn(),
  },
  usersTable: {},
  userApiKeysTable: {
    id: "id",
    userId: "user_id",
    keyHash: "key_hash",
    revokedAt: "revoked_at",
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { authenticateApiKey } from "./user-api-keys.js";

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe("authenticateApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateMock.mockReturnValue({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    });
  });

  it("passes through when Authorization is not a sk_live_ key", async () => {
    const req = { headers: { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.x.y" } } as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    await authenticateApiKey(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect((req as any).clerkUserId).toBeUndefined();
  });

  it("sets clerkUserId for a valid sk_live_ key", async () => {
    const raw = "sk_live_" + "a".repeat(64);
    const hash = createHash("sha256").update(raw).digest("hex");

    selectMock.mockReturnValue({
      from: () => ({
        where: async () => [{ id: 1, userId: "user_abc", keyHash: hash, revokedAt: null }],
      }),
    });

    const req = { headers: { authorization: `Bearer ${raw}` } } as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    await authenticateApiKey(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((req as any).clerkUserId).toBe("user_abc");
  });

  it("returns 401 for an unknown sk_live_ key", async () => {
    selectMock.mockReturnValue({
      from: () => ({
        where: async () => [],
      }),
    });

    const req = { headers: { authorization: "Bearer sk_live_" + "b".repeat(64) } } as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    await authenticateApiKey(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or revoked API key" });
  });
});
