import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const FREE_CREDIT_CENTS = 500; // $5.00

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
      const email = (auth as any)?.sessionClaims?.email as string | undefined;
      const name = (auth as any)?.sessionClaims?.name as string | undefined;
      [user] = await db
        .insert(usersTable)
        .values({
          clerkId,
          email: email ?? null,
          name: name ?? null,
          walletBalanceCents: FREE_CREDIT_CENTS,
          freeCreditsGranted: true,
        })
        .returning();

      await db.insert(walletTransactionsTable).values({
        userId: user.id,
        type: "free_credit",
        amountCents: FREE_CREDIT_CENTS,
        description: "Welcome credit — $5.00 free to get started",
        status: "completed",
      });
    }
    (req as any).dbUser = user;
  } catch (err) {
    (req as any).log?.error({ err }, "userProvisioning error");
  }
  next();
}
