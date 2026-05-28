import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { createHash, randomBytes } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db, usersTable, userApiKeysTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

/* ── Key helpers ─────────────────────────────────────────────────────────── */

function generateApiKey(): { key: string; prefix: string; hash: string } {
  const secret = randomBytes(32).toString("hex"); // 64 hex chars
  const key    = `sk_live_${secret}`;
  const prefix = key.slice(0, 16); // "sk_live_" + first 8 chars
  const hash   = createHash("sha256").update(key).digest("hex");
  return { key, prefix, hash };
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/* ── GET /user-api-keys ──────────────────────────────────────────────────── */

router.get("/user-api-keys", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const keys = await db
    .select({
      id:         userApiKeysTable.id,
      name:       userApiKeysTable.name,
      keyPrefix:  userApiKeysTable.keyPrefix,
      lastUsedAt: userApiKeysTable.lastUsedAt,
      createdAt:  userApiKeysTable.createdAt,
      revokedAt:  userApiKeysTable.revokedAt,
    })
    .from(userApiKeysTable)
    .where(eq(userApiKeysTable.userId, userId))
    .orderBy(userApiKeysTable.createdAt);

  res.json({ keys });
});

/* ── POST /user-api-keys ─────────────────────────────────────────────────── */

router.post("/user-api-keys", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const name   = (req.body as { name?: string }).name?.trim() || "Default";

  // Max 5 active keys per user
  const existing = await db
    .select({ id: userApiKeysTable.id })
    .from(userApiKeysTable)
    .where(and(eq(userApiKeysTable.userId, userId), isNull(userApiKeysTable.revokedAt)));

  if (existing.length >= 5) {
    res.status(400).json({ error: "Maximum 5 active API keys allowed. Revoke one first." });
    return;
  }

  const { key, prefix, hash } = generateApiKey();

  await db.insert(userApiKeysTable).values({ userId, name, keyHash: hash, keyPrefix: prefix });

  req.log.info({ userId, prefix }, "API key created");
  // Return the FULL key exactly once — never retrievable again
  res.status(201).json({ key, prefix, name, message: "Save this key — it will not be shown again." });
});

/* ── DELETE /user-api-keys/:id ───────────────────────────────────────────── */

router.delete("/user-api-keys/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const id     = Number(req.params["id"]);

  const [row] = await db
    .select()
    .from(userApiKeysTable)
    .where(and(eq(userApiKeysTable.id, id), eq(userApiKeysTable.userId, userId)));

  if (!row) { res.status(404).json({ error: "Key not found" }); return; }
  if (row.revokedAt) { res.status(400).json({ error: "Key already revoked" }); return; }

  await db
    .update(userApiKeysTable)
    .set({ revokedAt: new Date() })
    .where(eq(userApiKeysTable.id, id));

  req.log.info({ userId, id }, "API key revoked");
  res.json({ ok: true });
});

/* ── Middleware: authenticate via Bearer API key ─────────────────────────── */
// Exported so other routes or tests can reuse it.
// Sets req.clerkUserId exactly like requireAuth so downstream handlers work unchanged.

export async function authenticateApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer sk_live_")) { next(); return; }

  const key  = auth.slice(7);
  const hash = hashKey(key);

  try {
    const [row] = await db
      .select()
      .from(userApiKeysTable)
      .where(and(eq(userApiKeysTable.keyHash, hash), isNull(userApiKeysTable.revokedAt)));

    if (!row) { res.status(401).json({ error: "Invalid or revoked API key" }); return; }

    // Touch lastUsedAt (fire-and-forget, don't await)
    db.update(userApiKeysTable)
      .set({ lastUsedAt: new Date() })
      .where(eq(userApiKeysTable.id, row.id))
      .catch((e: unknown) => logger.error({ e }, "Failed to update key lastUsedAt"));

    (req as any).clerkUserId = row.userId;
    next();
  } catch (err) {
    logger.error({ err }, "API key auth error");
    res.status(500).json({ error: "Authentication error" });
  }
}

export default router;
