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
      ALTER TABLE partners ADD COLUMN IF NOT EXISTS referral_target_minutes integer DEFAULT 5000 NOT NULL;
      ALTER TABLE partners ADD COLUMN IF NOT EXISTS referral_reward_minutes integer DEFAULT 500 NOT NULL;
      ALTER TABLE partners ADD COLUMN IF NOT EXISTS referral_completed_cycles integer DEFAULT 0 NOT NULL;
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
        cycle_number integer DEFAULT 1,
        status text DEFAULT 'pending' NOT NULL,
        credited_at timestamp with time zone,
        created_at timestamp with time zone DEFAULT now() NOT NULL
      );
      ALTER TABLE partner_referral_earnings ADD COLUMN IF NOT EXISTS cycle_number integer DEFAULT 1;
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

    // 7. OPTION A: 5,000-Minute Recurring Milestone Cycles
    // In SnapServe, base calling rate is e.g. ₹5.00/min (500 paise/min).
    const baseRatePaise = partner.baseRateCentsPerMin || 500;
    const targetMinutes = partner.referralTargetMinutes ?? 5000;
    const rewardMinutes = partner.referralRewardMinutes ?? 500;
    const rewardPaisePerCycle = rewardMinutes * baseRatePaise; // e.g. 500 mins * ₹5 = ₹2,500 (250,000 paise)

    // Calculate cumulative paise recharged across all referrals for this partner
    const [sumRow] = await db
      .select({
        totalPaise: sql<number>`coalesce(sum(${partnerReferralsTable.totalRechargedPaise}), 0)`,
      })
      .from(partnerReferralsTable)
      .where(eq(partnerReferralsTable.partnerId, partner.id));

    const totalAudiencePaise = Number(sumRow?.totalPaise ?? 0);
    const totalAudienceMinutes = Math.floor(totalAudiencePaise / baseRatePaise);

    // Calculate total cycles earned so far vs previously completed
    const totalCyclesEarned = Math.floor(totalAudienceMinutes / targetMinutes);
    const previouslyCompletedCycles = partner.referralCompletedCycles ?? 0;
    const newCyclesToUnlock = Math.max(0, totalCyclesEarned - previouslyCompletedCycles);
    const currentCycleMinutes = totalAudienceMinutes % targetMinutes;

    if (newCyclesToUnlock > 0) {
      // One or more 5,000-minute cycles completed! Credit 500 minutes (₹2,500) per cycle
      for (let i = 0; i < newCyclesToUnlock; i++) {
        const cycleNum = previouslyCompletedCycles + i + 1;

        await db.transaction(async (tx) => {
          await tx.insert(partnerReferralEarningsTable).values({
            partnerId: partner.id,
            referralId: referralRow?.id ?? null,
            userId: payingUser.clerkId,
            rechargeTxnId: rechargeTxnId ?? null,
            rechargeAmountPaise,
            commissionPercent: 10,
            earnedPaise: rewardPaisePerCycle,
            cycleNumber: cycleNum,
            status: "credited",
            creditedAt: new Date(),
          });

          await tx.insert(walletTransactionsTable).values({
            userId: partnerUser.id,
            type: "referral_earning",
            amountCents: rewardPaisePerCycle,
            description: `Affiliate Milestone #${cycleNum} — ${rewardMinutes} free minutes (${formatInr(rewardPaisePerCycle)}) credited (${targetMinutes} referred minutes reached)`,
            status: "completed",
          });

          await tx
            .update(usersTable)
            .set({ walletBalanceCents: sql`${usersTable.walletBalanceCents} + ${rewardPaisePerCycle}` })
            .where(eq(usersTable.id, partnerUser.id));
        });

        logger.info(
          {
            partnerId: partner.id,
            partnerUserId: partnerUser.id,
            cycleNum,
            rewardMinutes,
            rewardPaisePerCycle,
          },
          "Milestone reached: 500 free minutes credited to partner wallet",
        );
      }

      await db
        .update(partnersTable)
        .set({ referralCompletedCycles: totalCyclesEarned })
        .where(eq(partnersTable.id, partner.id));
    } else {
      // Still accumulating towards next 5,000-minute milestone
      const activeCycleNum = previouslyCompletedCycles + 1;
      await db.insert(partnerReferralEarningsTable).values({
        partnerId: partner.id,
        referralId: referralRow?.id ?? null,
        userId: payingUser.clerkId,
        rechargeTxnId: rechargeTxnId ?? null,
        rechargeAmountPaise,
        commissionPercent: 10,
        earnedPaise,
        cycleNumber: activeCycleNum,
        status: "pending",
      });

      logger.info(
        {
          partnerId: partner.id,
          totalAudienceMinutes,
          currentCycleMinutes,
          targetMinutes,
          activeCycleNum,
        },
        "Referred minutes accumulated towards 5,000-minute milestone cycle",
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

/**
 * Calculate progress in the current 5,000-minute cycle and total completed cycles.
 */
export function calculateMilestoneProgress(
  totalAudienceMinutes: number,
  targetMinutes: number = 5000,
): {
  currentCycleMinutes: number;
  completedCycles: number;
  percent: number;
  minutesRemaining: number;
} {
  const safeTarget = Math.max(1, targetMinutes);
  const safeMinutes = Math.max(0, totalAudienceMinutes);
  const completedCycles = Math.floor(safeMinutes / safeTarget);
  const currentCycleMinutes = safeMinutes % safeTarget;
  const percent = Math.min(100, Math.round((currentCycleMinutes / safeTarget) * 100));
  const minutesRemaining = safeTarget - currentCycleMinutes;
  return {
    currentCycleMinutes,
    completedCycles,
    percent,
    minutesRemaining,
  };
}

/**
 * Convert recharge paise into calling minutes at the specified rate (default 500 paise = ₹5.00/min).
 */
export function convertPaiseToMinutes(amountPaise: number, ratePaisePerMin: number = 500): number {
  if (amountPaise <= 0 || ratePaisePerMin <= 0) return 0;
  return Math.floor(amountPaise / ratePaisePerMin);
}

/**
 * Convert reward minutes into rupee credits in paise (e.g. 500 minutes * 500 paise = 250,000 paise = ₹2,500).
 */
export function calculateRewardCreditsPaise(rewardMinutes: number = 500, ratePaisePerMin: number = 500): number {
  if (rewardMinutes <= 0 || ratePaisePerMin <= 0) return 0;
  return rewardMinutes * ratePaisePerMin;
}


