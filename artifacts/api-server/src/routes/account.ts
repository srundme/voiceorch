import { Router, type IRouter } from "express";
import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { eq } from "drizzle-orm";
import { db, usersTable, walletTransactionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext, denyManagedClient } from "../middlewares/clientContext.js";
import { invalidateUserStatusCache } from "../middlewares/userStatusCache.js";
import { logActivity } from "../lib/activity.js";
import { issueInvoice } from "../services/invoice.js";
import { createAlert } from "../services/usage/alert-engine.js";
import { GetPreferencesResponse, UpdatePreferencesBody } from "@workspace/api-zod";
import { logger } from "../lib/logger.js";

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

router.get("/account", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(toAccountInfo(user));
});

router.post("/account/regenerate-api-key", requireAuth, clientContext, async (req, res): Promise<void> => {
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

router.post("/account/add-concurrent", requireAuth, clientContext, denyManagedClient, async (req, res): Promise<void> => {
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

  // GST tax invoice. Paid from the wallet, so the ₹1,000 is GST-inclusive.
  void issueInvoice({
    user: { id: user.id, name: user.name, email: user.email },
    type: "concurrent_slot",
    description: `Concurrent call slot (limit now ${updated.concurrentLimit})`,
    hsnSac: "998413",
    amountCents: CONCURRENT_SLOT_CENTS,
    gstInclusive: true,
    metadata: { newLimit: updated.concurrentLimit },
  });

  res.json(toAccountInfo(updated));
});

router.post("/account/change-password", requireAuth, clientContext, async (req, res): Promise<void> => {
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

router.get("/account/preferences", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const prefs = user.preferences ?? {};
  res.json(GetPreferencesResponse.parse({ theme: prefs.theme ?? null }));
});

router.patch("/account/preferences", requireAuth, clientContext, async (req, res): Promise<void> => {
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

/**
 * Self-serve workspace deletion (Danger Zone).
 * Soft-deletes the account (status=deleted), revokes API keys, notifies admin,
 * and blocks further login via the existing status check in session/auth.
 */
router.post("/account/delete-workspace", requireAuth, clientContext, denyManagedClient, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const { confirmation } = (req.body ?? {}) as { confirmation?: string };

  if (confirmation !== "DELETE") {
    res.status(400).json({
      error: 'Type DELETE to confirm. This permanently removes your workspace from SnapServe.',
    });
    return;
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    if (user.status === "deleted") {
      res.json({ ok: true, alreadyDeleted: true });
      return;
    }

    const previousBalance = user.walletBalanceCents;

    await db
      .update(usersTable)
      .set({
        status: "deleted",
        suspendedAt: new Date(),
        suspendedReason: "User requested workspace deletion",
        apiKey: null,
        orgKey: null,
        // Strip remaining balance so a same-ID return cannot keep ₹500 / ~100 min welcome credit.
        walletBalanceCents: 0,
        freeCreditsGranted: true,
      })
      .where(eq(usersTable.clerkId, clerkId));

    if (previousBalance !== 0) {
      await db.insert(walletTransactionsTable).values({
        userId: user.id,
        type: "adjustment",
        amountCents: -previousBalance,
        description: "Workspace deleted — remaining balance forfeited",
        status: "completed",
      });
    }

    invalidateUserStatusCache(clerkId);

    await logActivity({
      userId: clerkId,
      eventType: "account.workspace_deleted",
      description: "User deleted their SnapServe workspace",
      metadata: { email: user.email, name: user.name },
    });

    void createAlert({
      type: "account_deletion",
      severity: "critical",
      title: "Workspace deleted by user",
      message: `${user.email ?? user.name ?? clerkId} permanently deleted their SnapServe workspace. Account status is now deleted.`,
      dedupeKey: `account_deletion:${clerkId}:${new Date().toISOString().slice(0, 10)}`,
      payload: {
        clerkId,
        email: user.email,
        name: user.name,
        deletedAt: new Date().toISOString(),
      },
    }).catch((err) => {
      logger.warn({ err, clerkId }, "Failed to create admin alert for workspace deletion");
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, clerkId }, "account/delete-workspace failed");
    res.status(500).json({ error: "Failed to delete workspace" });
  }
});

export { generateApiKey, generateOrgKey };
export default router;
