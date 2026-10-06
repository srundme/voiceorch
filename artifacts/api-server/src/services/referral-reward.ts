/**
 * referral-reward.ts — Affiliate and Referral Program Automation
 *
 * Implements:
 * 1. 60-day click attribution tracking.
 * 2. Audience perks: 100 free minutes at signup + 10% bonus credit on 1st recharge.
 * 3. 10% partner commission for the first 6 months of each referred user.
 * 4. Option A (Accumulate & Unlock): Commissions accumulate as "pending" until
 *    at least `referralMinRechargedUsers` (default 10) unique referred users recharge.
 *    Once reached, all accumulated pending credits unlock into the partner's wallet,
 *    and future recharges credit in real-time.
 */

import {
  db,
  usersTable,
  partnersTable,
  partnerReferralsTable,
  partnerReferralEarningsTable,
  walletTransactionsTable,
} from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { formatInr } from "../lib/money-inr.js";

/**
 * Idempotent schema bootstrapper to ensure tables and columns exist in all environments.
 */
export async function ensureReferralSchema(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE partners ADD COLUMN IF NOT EXISTS referral_attribution_days integer DEFAULT 60 NOT NULL;
      ALTER TABLE partners ADD COLUMN IF NOT EXISTS referral_commission_percent integer DEFAULT 10 NOT NULL;
      ALTER TABLE partners ADD COLUMN IF NOT EXISTS referral_commission_months integer DEFAULT 6 NOT NULL;
      ALTER TABLE partners ADD COLUMN IF NOT EXISTS referral_min_recharged_users integer DEFAULT 10 NOT NULL;
      ALTER TABLE partners ADD COLUMN IF NOT EXISTS referral_audience_bonus_percent integer DEFAULT 10 NOT NULL;
      ALTER TABLE partners ADD COLUMN IF NOT EXISTS referral_audience_free_minutes integer DEFAULT 100 NOT NULL;
      ALTER TABLE partner_referrals ADD COLUMN IF NOT EXISTS first_recharge_at timestamp with time zone;
      ALTER TABLE partner_referrals ADD COLUMN IF NOT EXISTS recharge_count integer DEFAULT 0 NOT NULL;
      ALTER TABLE partner_referrals ADD COLUMN IF NOT EXISTS total_recharged_paise integer DEFAULT 0 NOT NULL;
      ALTER TABLE partner_referrals ADD COLUMN IF NOT EXISTS total_earned_paise integer DEFAULT 0 NOT NULL;
      CREATE TABLE IF NOT EXISTS partner_referral_earnings (
        id serial PRIMARY KEY NOT NULL,
        partner_id integer NOT NULL REFERENCES partners(id) ON DELETE cascade,
        referral_id integer REFERENCES partner_referrals(id) ON DELETE set null,
        user_id text NOT NULL,
        recharge_txn_id integer,
        recharge_amount_paise integer NOT NULL,
        commission_percent integer DEFAULT 10 NOT NULL,
        earned_paise integer NOT NULL,
        status text DEFAULT 'pending' NOT NULL,
        credited_at timestamp with time zone,
        created_at timestamp with time zone DEFAULT now() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS partner_referral_earnings_partner_id_idx ON partner_referral_earnings (partner_id);
      CREATE INDEX IF NOT EXISTS partner_referral_earnings_user_id_idx ON partner_referral_earnings (user_id);
      CREATE INDEX IF NOT EXISTS partner_referral_earnings_status_idx ON partner_referral_earnings (status);
      CREATE INDEX IF NOT EXISTS partner_referrals_user_id_idx ON partner_referrals (user_id);
    `);
  } catch (err) {
    logger.warn({ err }, "ensureReferralSchema non-fatal notice");
  }
}

/**
 * Called on every successful wallet recharge to process:
 * 1. Audience 1st-recharge bonus (+10% extra credit to paying user).
 * 2. Partner affiliate commission (+10% credit or pending accumulation under Option A).
 */
export async function processReferralRecharge(opts: {
  payingUserId: number;
  rechargeAmountPaise: number;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  rechargeTxnId?: number | null;
}): Promise<void> {
  const { payingUserId, rechargeAmountPaise, razorpayOrderId, razorpayPaymentId, rechargeTxnId } = opts;
  if (rechargeAmountPaise <= 0) return;

  try {
    // 1. Fetch paying user
    const [payingUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, payingUserId));

    if (!payingUser) return;

    // 2. Resolve partner attribution
    let referralRow = (
      await db
        .select()
        .from(partnerReferralsTable)
        .where(eq(partnerReferralsTable.userId, payingUser.clerkId))
        .limit(1)
    )[0];

    let partnerId: number | null = referralRow?.partnerId ?? null;

    if (!partnerId && payingUser.referredByCode) {
      const [matchedPartner] = await db
        .select()
        .from(partnersTable)
        .where(
          sql`lower(${partnersTable.referralCode}) = ${payingUser.referredByCode.toLowerCase()}`
        )
        .limit(1);

      if (matchedPartner) {
        partnerId = matchedPartner.id;
        // Backfill partnerReferralsTable row if missing
        try {
          const [inserted] = await db
            .insert(partnerReferralsTable)
            .values({
              partnerId: matchedPartner.id,
              referralCode: matchedPartner.referralCode || payingUser.referredByCode,
              userId: payingUser.clerkId,
              userEmail: payingUser.email ?? null,
              userName: payingUser.name ?? null,
              status: "active",
            })
            .returning();
          referralRow = inserted;
        } catch {
          // ignore duplicate race
        }
      }
    }

    if (!partnerId) return; // Not an affiliate referral

    // 3. Fetch partner config & partner user account
    const [partner] = await db
      .select()
      .from(partnersTable)
      .where(and(eq(partnersTable.id, partnerId), eq(partnersTable.status, "active")));

    if (!partner) return;

    const [partnerUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, partner.userId));

    if (!partnerUser) {
      logger.warn({ partnerId: partner.id, partnerClerkId: partner.userId }, "Partner user account not found for referral credit");
      return;
    }

    // Don't pay referral commission to a partner on their own account's recharges
    if (partnerUser.id === payingUser.id) return;

    // 4. Check if within earning duration (e.g. 6 months from user signup)
    const commissionMonths = partner.referralCommissionMonths ?? 6;
    const signupDate = new Date(payingUser.createdAt);
    const monthsSinceSignup = (Date.now() - signupDate.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);

    const isWithinEarningWindow = monthsSinceSignup <= commissionMonths;

    // 5. AUDIENCE PERK: 1st Recharge Bonus (+10% extra credit to user)
    const isFirstRecharge = !referralRow?.firstRechargeAt || (referralRow?.rechargeCount ?? 0) === 0;
    if (isFirstRecharge && partner.referralAudienceBonusPercent > 0) {
      const bonusPaise = Math.round((rechargeAmountPaise * partner.referralAudienceBonusPercent) / 100);
      if (bonusPaise > 0) {
        await db.transaction(async (tx) => {
          await tx.insert(walletTransactionsTable).values({
            userId: payingUser.id,
            type: "referral_bonus",
            amountCents: bonusPaise,
            description: `${partner.referralAudienceBonusPercent}% First Recharge Bonus via referral code ${partner.referralCode || "AFFILIATE"}`,
            status: "completed",
            razorpayOrderId: razorpayOrderId ? `bonus:${razorpayOrderId}` : null,
            razorpayPaymentId: razorpayPaymentId ? `bonus:${razorpayPaymentId}` : null,
          });

          await tx
            .update(usersTable)
            .set({ walletBalanceCents: sql`${usersTable.walletBalanceCents} + ${bonusPaise}` })
            .where(eq(usersTable.id, payingUser.id));
        });

        logger.info(
          { userId: payingUser.id, bonusPaise, partnerCode: partner.referralCode },
          "Audience first-recharge bonus credited",
        );
      }
    }

    // 6. Update referral row statistics
    const commissionPercent = partner.referralCommissionPercent ?? 10;
    const earnedPaise = isWithinEarningWindow
      ? Math.round((rechargeAmountPaise * commissionPercent) / 100)
      : 0;

    if (referralRow) {
      await db
        .update(partnerReferralsTable)
        .set({
          firstRechargeAt: referralRow.firstRechargeAt || new Date(),
          rechargeCount: sql`${partnerReferralsTable.rechargeCount} + 1`,
          totalRechargedPaise: sql`${partnerReferralsTable.totalRechargedPaise} + ${rechargeAmountPaise}`,
          totalEarnedPaise: sql`${partnerReferralsTable.totalEarnedPaise} + ${earnedPaise}`,
          status: "active",
        })
        .where(eq(partnerReferralsTable.id, referralRow.id));
    }

    // If outside 6-month window, no partner commission is generated
    if (!isWithinEarningWindow || earnedPaise <= 0) {
      logger.info(
        { userId: payingUser.id, partnerId: partner.id, monthsSinceSignup, commissionMonths },
        "Recharge occurred outside referral earning window — no affiliate commission",
      );
      return;
    }

    // 7. OPTION A (Accumulate & Unlock): Evaluate paying users count
    const [stats] = await db
      .select({
        payingCount: sql<number>`count(distinct ${partnerReferralsTable.userId})`,
      })
      .from(partnerReferralsTable)
      .where(
        and(
          eq(partnerReferralsTable.partnerId, partner.id),
          sql`(${partnerReferralsTable.rechargeCount} > 0 OR ${partnerReferralsTable.firstRechargeAt} IS NOT NULL)`,
        ),
      );

    const payingUsersCount = Number(stats?.payingCount ?? 0);
    const unlockThreshold = partner.referralMinRechargedUsers ?? 10;
    const isUnlocked = payingUsersCount >= unlockThreshold;

    if (isUnlocked) {
      // Check if there are previously locked pending earnings to release as a lump sum
      const pendingRows = await db
        .select()
        .from(partnerReferralEarningsTable)
        .where(
          and(
            eq(partnerReferralEarningsTable.partnerId, partner.id),
            eq(partnerReferralEarningsTable.status, "pending"),
          ),
        );

      let pendingTotalPaise = 0;
      if (pendingRows.length > 0) {
        pendingTotalPaise = pendingRows.reduce((acc, r) => acc + r.earnedPaise, 0);

        // Mark pending rows as credited
        await db
          .update(partnerReferralEarningsTable)
          .set({ status: "credited", creditedAt: new Date() })
          .where(
            inArray(
              partnerReferralEarningsTable.id,
              pendingRows.map((r) => r.id),
            ),
          );

        // Credit the accumulated lump sum to partner's wallet
        if (pendingTotalPaise > 0) {
          await db.transaction(async (tx) => {
            await tx.insert(walletTransactionsTable).values({
              userId: partnerUser.id,
              type: "referral_earning",
              amountCents: pendingTotalPaise,
              description: `Unlocked accumulated referral commissions from ${payingUsersCount} referred users (${formatInr(pendingTotalPaise)})`,
              status: "completed",
            });

            await tx
              .update(usersTable)
              .set({ walletBalanceCents: sql`${usersTable.walletBalanceCents} + ${pendingTotalPaise}` })
              .where(eq(usersTable.id, partnerUser.id));
          });

          logger.info(
            { partnerId: partner.id, partnerUserId: partnerUser.id, pendingTotalPaise, payingUsersCount },
            "Option A unlocked: All accumulated pending referral commissions credited to partner wallet",
          );
        }
      }

      // Record current recharge commission as credited & deposit to wallet
      await db.transaction(async (tx) => {
        const [earningRow] = await tx
          .insert(partnerReferralEarningsTable)
          .values({
            partnerId: partner.id,
            referralId: referralRow?.id ?? null,
            userId: payingUser.clerkId,
            rechargeTxnId: rechargeTxnId ?? null,
            rechargeAmountPaise,
            commissionPercent,
            earnedPaise,
            status: "credited",
            creditedAt: new Date(),
          })
          .returning();

        await tx.insert(walletTransactionsTable).values({
          userId: partnerUser.id,
          type: "referral_earning",
          amountCents: earnedPaise,
          description: `Affiliate commission (${commissionPercent}%) — recharge by referred user ${payingUser.email ?? payingUser.name ?? "client"}`,
          status: "completed",
        });

        await tx
          .update(usersTable)
          .set({ walletBalanceCents: sql`${usersTable.walletBalanceCents} + ${earnedPaise}` })
          .where(eq(usersTable.id, partnerUser.id));
      });

      logger.info(
        { partnerId: partner.id, partnerUserId: partnerUser.id, earnedPaise, payingUser: payingUser.email },
        "Referral commission credited to partner wallet in real-time",
      );
    } else {
      // Under threshold: Record as PENDING (accumulate without depositing yet)
      await db.insert(partnerReferralEarningsTable).values({
        partnerId: partner.id,
        referralId: referralRow?.id ?? null,
        userId: payingUser.clerkId,
        rechargeTxnId: rechargeTxnId ?? null,
        rechargeAmountPaise,
        commissionPercent,
        earnedPaise,
        status: "pending",
      });

      logger.info(
        {
          partnerId: partner.id,
          payingUsersCount,
          unlockThreshold,
          earnedPaise,
        },
        "Referral commission recorded as PENDING (waiting for 10-user unlock threshold)",
      );
    }
  } catch (err) {
    logger.error({ err, payingUserId, rechargeAmountPaise }, "Failed to process referral recharge (non-fatal)");
  }
}

/**
 * Mask an email address for privacy in partner listings (e.g. s***@gmail.com).
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "—";
  const [local, domain] = email.split("@");
  if (!domain) return email;
  if (local.length <= 2) return `${local[0]}*@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

/**
 * Calculate affiliate commission in paise (e.g. 10% of ₹10,000 = ₹1,000 credits).
 */
export function calculateReferralCommission(amountPaise: number, commissionPercent: number): number {
  if (amountPaise <= 0 || commissionPercent <= 0) return 0;
  return Math.round((amountPaise * commissionPercent) / 100);
}

/**
 * Calculate audience first-recharge bonus credit in paise (e.g. 10% bonus).
 */
export function calculateAudienceBonus(amountPaise: number, bonusPercent: number): number {
  if (amountPaise <= 0 || bonusPercent <= 0) return 0;
  return Math.round((amountPaise * bonusPercent) / 100);
}

/**
 * Check if the current recharge date is within the allowed affiliate earning window (e.g. 6 months).
 */
export function isWithinEarningWindow(signupDate: Date, monthsLimit: number, checkDate: Date = new Date()): boolean {
  if (monthsLimit <= 0) return false;
  const elapsedMonths = (checkDate.getTime() - signupDate.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
  return elapsedMonths <= monthsLimit;
}

/**
 * Check if a referral click is within the attribution window (e.g. 60 days).
 */
export function isAttributionValid(clickedAtTimestampMs: number, attributionDays: number, checkTimeMs: number = Date.now()): boolean {
  if (attributionDays <= 0) return false;
  const maxAgeMs = attributionDays * 24 * 60 * 60 * 1000;
  return (checkTimeMs - clickedAtTimestampMs) <= maxAgeMs;
}

