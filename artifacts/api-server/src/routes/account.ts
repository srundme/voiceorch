import { Router, type IRouter } from "express";
import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { eq } from "drizzle-orm";
import { db, usersTable, walletTransactionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logActivity } from "../lib/activity.js";
import { GetPreferencesResponse, UpdatePreferencesBody } from "@workspace/api-zod";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${buf.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  if (buf.length !== expected.length) return false;
  return timingSafeEqual(buf, expected);
}

const router: IRouter = Router();

const CONCURRENT_SLOT_CENTS = 100_000; // ₹1,000 per concurrent slot (INR paise)

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
    res.status(402).json({ error: "Insufficient balance. Top up your wallet to add a concurrent slot (₹1,000 each)." });
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

router.post("/account/change-password", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Current password and new password are required." });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (!user.passwordHash) {
    res.status(403).json({ error: "Your account uses Google sign-in and does not have a password." });
    return;
  }

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) {
    res.status(400).json({ error: "Current password is incorrect." });
    return;
  }

  const newHash = await hashPassword(newPassword);
  await db.update(usersTable).set({ passwordHash: newHash }).where(eq(usersTable.clerkId, clerkId));

  await logActivity({
    userId: clerkId,
    eventType: "account.password_changed",
    description: "Password changed",
  });

  res.json({ ok: true });
});

router.get("/account/preferences", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const prefs = user.preferences ?? {};
  res.json(GetPreferencesResponse.parse({ theme: prefs.theme ?? null }));
});

router.patch("/account/preferences", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = UpdatePreferencesBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid preferences" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  type PrefsShape = { theme?: "light" | "dark" | "system" };
  const current: PrefsShape = (user.preferences as PrefsShape | null) ?? {};
  const merged: PrefsShape = { ...current, ...(parsed.data as PrefsShape) };
  const [updated] = await db
    .update(usersTable)
    .set({ preferences: merged })
    .where(eq(usersTable.clerkId, clerkId))
    .returning();
  const updatedPrefs: PrefsShape = (updated.preferences as PrefsShape | null) ?? {};
  res.json(GetPreferencesResponse.parse({ theme: updatedPrefs.theme ?? null }));
});

export { generateApiKey, generateOrgKey };
export default router;
