import { Router, type IRouter } from "express";
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db, usersTable, walletTransactionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logActivity } from "../lib/activity.js";

const router: IRouter = Router();

const CONCURRENT_SLOT_CENTS = 500;

function generateApiKey() { return `vok_${randomBytes(24).toString("hex")}`; }
function generateOrgKey() { return `voo_${randomBytes(24).toString("hex")}`; }

function toAccountInfo(user: typeof usersTable.$inferSelect) {
  return {
    apiKey: user.apiKey ?? null,
    orgKey: user.orgKey ?? null,
    concurrentLimit: user.concurrentLimit,
    walletId: user.id,
  };
}

router.get("/account", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(toAccountInfo(user));
});

router.post("/account/regenerate-api-key", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const newKey = generateApiKey();
  const [user] = await db
    .update(usersTable)
    .set({ apiKey: newKey })
    .where(eq(usersTable.clerkId, clerkId))
    .returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  await logActivity({ userId: clerkId, eventType: "account.api_key_regenerated", description: "API key regenerated" });
  res.json(toAccountInfo(user));
});

router.post("/account/add-concurrent", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (user.walletBalanceCents < CONCURRENT_SLOT_CENTS) {
    res.status(402).json({ error: "Insufficient balance. Top up your wallet to add a concurrent slot ($5.00 each)." });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({
      walletBalanceCents: user.walletBalanceCents - CONCURRENT_SLOT_CENTS,
      concurrentLimit: user.concurrentLimit + 1,
    })
    .where(eq(usersTable.clerkId, clerkId))
    .returning();

  await db.insert(walletTransactionsTable).values({
    userId: user.id,
    type: "debit",
    amountCents: -CONCURRENT_SLOT_CENTS,
    description: `Concurrent call slot purchased (limit now ${updated.concurrentLimit})`,
    status: "completed",
  });

  await logActivity({
    userId: clerkId,
    eventType: "account.concurrent_slot_added",
    description: `Concurrent limit increased to ${updated.concurrentLimit}`,
    metadata: { newLimit: updated.concurrentLimit },
  });

  res.json(toAccountInfo(updated));
});

export { generateApiKey, generateOrgKey };
export default router;
