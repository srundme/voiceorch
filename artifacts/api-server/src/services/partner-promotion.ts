/**
 * partner-promotion.ts — applies admin-created "pending partner promotions".
 *
 * The admin panel can create a partner for an email that has no account yet
 * (routes/admin-partners.ts POST). The setup is stored in
 * partner_pending_promotions and applied here when a user with that email
 * signs up, from EVERY user-creation site:
 *   - middlewares/userProvisioning.ts  (Google session first-touch → verified)
 *   - routes/auth.ts Google Sign-In     (new-user branch → verified)
 *   - routes/auth.ts register           (email+password → NOT verified)
 *
 * SECURITY: a promotion is auto-applied only when the signup path PROVES
 * email ownership (Google-authenticated). Password signups can claim any
 * email string, so for them the pending row is left in place and surfaced to
 * the admin for one-click approval (POST /admin/partners/pending/:id/apply).
 * Without this gate, anyone who knows a pending email could register it and
 * take over the partner account.
 *
 * Must never throw — a promotion failure must not break signup.
 */

import { db, partnersTable, partnerPendingPromotionsTable, type Partner } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

/**
 * Atomically consume a pending promotion and create the partner row.
 * The DELETE..RETURNING is the claim: of N concurrent callers, exactly one
 * gets the row back; the rest see "claimed_elsewhere" and do nothing.
 */
export async function claimPendingAndPromote(
  pendingId: number,
  user: { clerkId: string },
): Promise<{ status: "promoted" | "already_partner" | "claimed_elsewhere"; partner?: Partner }> {
  return await db.transaction(async (tx) => {
    const [claimed] = await tx
      .delete(partnerPendingPromotionsTable)
      .where(eq(partnerPendingPromotionsTable.id, pendingId))
      .returning();
    if (!claimed) return { status: "claimed_elsewhere" as const };

    const [existing] = await tx
      .select({ id: partnersTable.id })
      .from(partnersTable)
      .where(eq(partnersTable.userId, user.clerkId));
    if (existing) return { status: "already_partner" as const };

    const [partner] = await tx
      .insert(partnersTable)
      .values({
        userId: user.clerkId,
        companyName: claimed.companyName,
        baseRateCentsPerMin: claimed.baseRateCentsPerMin,
        defaultClientRateCentsPerMin: claimed.defaultClientRateCentsPerMin,
      })
      .returning();
    return { status: "promoted" as const, partner };
  });
}

export async function applyPendingPartnerPromotion(
  user: { clerkId: string; email?: string | null; partnerId?: number | null },
  opts: { emailVerified: boolean },
): Promise<void> {
  try {
    const email = (user.email ?? "").trim().toLowerCase();
    if (!email) return;

    const [pending] = await db
      .select()
      .from(partnerPendingPromotionsTable)
      .where(eq(partnerPendingPromotionsTable.email, email));
    if (!pending) return;

    if (!opts.emailVerified) {
      // Password signup — can't prove email ownership. Leave the pending row;
      // the admin panel shows it as "signed up, awaiting approval".
      logger.info(
        { email, clerkId: user.clerkId },
        "Pending partner promotion held for admin approval (unverified-email signup)",
      );
      return;
    }

    // A partner's client cannot also be a partner (mirrors admin route guard).
    if (user.partnerId != null) {
      logger.warn(
        { email, clerkId: user.clerkId },
        "Pending partner promotion skipped — user is a partner's client",
      );
      return;
    }

    const result = await claimPendingAndPromote(pending.id, user);
    if (result.status === "promoted") {
      logger.info(
        { clerkId: user.clerkId, email, companyName: pending.companyName },
        "Pending partner promotion applied at signup",
      );
    }
  } catch (err) {
    logger.error({ err, clerkId: user.clerkId }, "applyPendingPartnerPromotion failed (signup unaffected)");
  }
}
