/**
 * partner-billing.ts — reseller (partner) spread billing.
 *
 * Model: a partner onboards client accounts (users.partnerId → partners.id).
 * The platform charges the partner `baseRateCentsPerMin` per client-minute;
 * the partner sets a per-client rate (>= base). On every billed call the
 * client wallet is debited at the client rate (by the existing call-debit
 * sites) and the spread (client rate − base rate) is credited to the
 * partner's wallet here.
 *
 * Used by BOTH call-debit sites (routes/calls.ts HTTP end + orchestration/
 * session.ts WS end) and both preflight credit-estimate sites (routes/calls.ts,
 * services/outbound-agent-dial.ts). Keep them in sync via these helpers —
 * never inline partner rate logic at a call site.
 */

import { db, usersTable, partnersTable, walletTransactionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

export interface PartnerBillingInfo {
  partnerId: number;
  /** Clerk id of the partner's own user account. */
  partnerClerkId: string;
  /** users.id row of the partner (wallet ops target). */
  partnerUsersRowId: number;
  companyName: string;
  baseRateCentsPerMin: number;
  /** Effective per-minute rate the client is billed at (>= base). */
  clientRateCentsPerMin: number;
  /**
   * True when the billed user IS the partner: their own usage bills at the
   * base rate (clientRate === baseRate) and no spread is ever credited.
   */
  isSelfPartner?: boolean;
}

/**
 * Resolve partner-aware billing for a client user (by clerk id).
 *
 * Returns null when the user has no ACTIVE partner — callers fall back to the
 * standard flat rate. A suspended partner is treated as absent: their clients
 * bill at the standard rate and no spread accrues.
 */
export async function resolvePartnerBilling(
  clerkId: string | null | undefined,
): Promise<PartnerBillingInfo | null> {
  if (!clerkId) return null;
  try {
    const [row] = await db
      .select({
        partnerId: partnersTable.id,
        partnerClerkId: partnersTable.userId,
        companyName: partnersTable.companyName,
        partnerStatus: partnersTable.status,
        baseRate: partnersTable.baseRateCentsPerMin,
        defaultClientRate: partnersTable.defaultClientRateCentsPerMin,
        clientRate: usersTable.partnerRateCentsPerMin,
      })
      .from(usersTable)
      .innerJoin(partnersTable, eq(usersTable.partnerId, partnersTable.id))
      .where(eq(usersTable.clerkId, clerkId));
    // Not a partner's client — but the user may BE a partner themselves, in
    // which case their own usage bills at their base rate (not the flat rate).
    if (!row) return await resolveSelfPartnerBilling(clerkId);
    if (row.partnerStatus !== "active") return null;

    const [partnerUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.clerkId, row.partnerClerkId));
    if (!partnerUser) return null;

    // Never bill a client below the partner's base rate — spread is clamped
    // at 0 elsewhere, but a below-base rate would undercut the platform fee.
    const clientRateCentsPerMin = Math.max(
      row.clientRate ?? row.defaultClientRate,
      row.baseRate,
    );

    return {
      partnerId: row.partnerId,
      partnerClerkId: row.partnerClerkId,
      partnerUsersRowId: partnerUser.id,
      companyName: row.companyName,
      baseRateCentsPerMin: row.baseRate,
      clientRateCentsPerMin,
    };
  } catch {
    // Billing resolution must never break a call path — standard rate fallback.
    return null;
  }
}

/**
 * A partner's OWN account bills at their base rate — the platform's wholesale
 * price to them — instead of the flat retail rate. No spread applies (they
 * can't earn a margin on themselves).
 */
async function resolveSelfPartnerBilling(clerkId: string): Promise<PartnerBillingInfo | null> {
  const [row] = await db
    .select({
      partnerId: partnersTable.id,
      companyName: partnersTable.companyName,
      status: partnersTable.status,
      baseRate: partnersTable.baseRateCentsPerMin,
      usersRowId: usersTable.id,
    })
    .from(partnersTable)
    .innerJoin(usersTable, eq(usersTable.clerkId, partnersTable.userId))
    .where(eq(partnersTable.userId, clerkId));
  if (!row || row.status !== "active") return null;
  return {
    partnerId: row.partnerId,
    partnerClerkId: clerkId,
    partnerUsersRowId: row.usersRowId,
    companyName: row.companyName,
    baseRateCentsPerMin: row.baseRate,
    clientRateCentsPerMin: row.baseRate,
    isSelfPartner: true,
  };
}

/**
 * Credit the partner's wallet with the spread for one billed call.
 *
 * `debitCents` is what the client was actually debited. The platform's share
 * uses the SAME rounding as the debit (`max(1, round(min × rate))`) so
 * debit = platform + spread exactly, with no rounding drift.
 *
 * Returns the spread credited (0 when the rate has no margin). Callers wrap
 * in try/catch — an earning-credit failure must never break call teardown.
 */
export async function creditPartnerSpreadOnCall(opts: {
  partner: PartnerBillingInfo;
  callId: number;
  durationSeconds: number;
  debitCents: number;
}): Promise<number> {
  const { partner, callId, durationSeconds, debitCents } = opts;
  if (partner.isSelfPartner) return 0; // own usage at base rate — no spread
  if (debitCents <= 0 || durationSeconds <= 0) return 0;

  const platformCents = Math.max(1, Math.round((durationSeconds / 60) * partner.baseRateCentsPerMin));
  const spreadCents = Math.max(0, debitCents - platformCents);
  if (spreadCents <= 0) return 0;

  // Transactional + idempotent: the ledger insert goes FIRST — the partial
  // unique index wallet_tx_partner_earning_call_uniq (one partner_earning row
  // per call) makes a duplicate credit fail with 23505 and abort the
  // transaction BEFORE the wallet increment, so racing end-of-call paths can
  // never double-credit and balance/ledger can never diverge. The increment
  // itself stays atomic in-DB (mirrors the atomic decrement used by debits).
  try {
    await db.transaction(async (tx) => {
      await tx.insert(walletTransactionsTable).values({
        userId: partner.partnerUsersRowId,
        type: "partner_earning",
        amountCents: spreadCents,
        description: `Partner earning — client call #${callId} (${durationSeconds}s spread)`,
        status: "completed",
        callId,
      });
      await tx
        .update(usersTable)
        .set({ walletBalanceCents: sql`${usersTable.walletBalanceCents} + ${spreadCents}` })
        .where(eq(usersTable.id, partner.partnerUsersRowId));
    });
  } catch (err) {
    if (isUniqueViolation(err)) return 0; // spread for this call was already credited
    throw err;
  }
  return spreadCents;
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}
