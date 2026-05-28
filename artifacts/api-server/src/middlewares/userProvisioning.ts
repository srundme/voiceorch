import { getAuth, clerkClient } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

function generateApiKey() { return `vok_${randomBytes(24).toString("hex")}`; }
function generateOrgKey() { return `voo_${randomBytes(24).toString("hex")}`; }

const FREE_CREDIT_CENTS = 500; // $5.00

type ClerkIdentity = { email: string | null; name: string | null };

async function fetchClerkIdentity(clerkId: string, log?: any): Promise<ClerkIdentity> {
  try {
    const u = await clerkClient.users.getUser(clerkId);
    const primaryId = u.primaryEmailAddressId;
    const primary = u.emailAddresses?.find((e) => e.id === primaryId) ?? u.emailAddresses?.[0];
    const email = primary?.emailAddress ?? null;
    const fullName = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
    const name = fullName || u.username || null;
    return { email, name };
  } catch (err) {
    log?.error?.({ err, clerkId }, "fetchClerkIdentity failed");
    return { email: null, name: null };
  }
}

export async function provisionUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);
  const clerkId = auth?.userId;
  if (!clerkId) {
    next();
    return;
  }

  try {
    let [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
    if (!user) {
      const { email, name } = await fetchClerkIdentity(clerkId, (req as any).log);
      [user] = await db
        .insert(usersTable)
        .values({
          clerkId,
          email,
          name,
          walletBalanceCents: FREE_CREDIT_CENTS,
          freeCreditsGranted: true,
          apiKey: generateApiKey(),
          orgKey: generateOrgKey(),
        })
        .returning();

      await db.insert(walletTransactionsTable).values({
        userId: user.id,
        type: "free_credit",
        amountCents: FREE_CREDIT_CENTS,
        description: "Welcome credit — $5.00 free to get started",
        status: "completed",
      });
    } else if (user.email === null || user.name === null) {
      const { email, name } = await fetchClerkIdentity(clerkId, (req as any).log);
      if (email !== null || name !== null) {
        const [healed] = await db
          .update(usersTable)
          .set({
            email: user.email ?? email,
            name: user.name ?? name,
          })
          .where(eq(usersTable.clerkId, clerkId))
          .returning();
        if (healed) user = healed;
      }
    }
    (req as any).dbUser = user;
  } catch (err) {
    (req as any).log?.error({ err }, "userProvisioning error");
  }
  next();
}
