import type { Request, Response, NextFunction } from "express";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { SessionPayload } from "../lib/session.js";

function generateApiKey() { return `vok_${randomBytes(24).toString("hex")}`; }
function generateOrgKey() { return `voo_${randomBytes(24).toString("hex")}`; }

const FREE_CREDIT_CENTS = 500; // $5.00

/**
 * Provision (or heal) the local user record for the authenticated Google
 * account. Identity comes from the verified session payload set by
 * `attachSession`; `users.clerk_id` stores the Google account subject id.
 * First-time users get API keys and a $5 welcome credit.
 */
export async function provisionUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const session = (req as unknown as { sessionPayload?: SessionPayload }).sessionPayload;
  if (!session) {
    next();
    return;
  }

  const sub = session.sub;
  try {
    let [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, sub));
    if (!user) {
      [user] = await db
        .insert(usersTable)
        .values({
          clerkId: sub,
          email: session.email,
          name: session.name,
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
      if (session.email !== null || session.name !== null) {
        const [healed] = await db
          .update(usersTable)
          .set({
            email: user.email ?? session.email,
            name: user.name ?? session.name,
          })
          .where(eq(usersTable.clerkId, sub))
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
