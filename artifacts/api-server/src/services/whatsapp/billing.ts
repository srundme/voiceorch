/**
 * SnapServe wallet billing for native VoBiz WhatsApp channels (mode=own).
 * Shared Instant tier is not billed here (platform-subsidized + daily cap).
 * BYO BSP / Meta connections are not billed (user pays their provider).
 */
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  walletTransactionsTable,
  platformSettingsTable,
  whatsappMessagesTable,
} from "@workspace/db";
import { logger } from "../../lib/logger.js";
import { formatInr } from "../../lib/money-inr.js";

const SETTINGS_KEY = "whatsapp_message_rates";

export type WhatsappMessageRates = {
  /** Paise per template send when category unknown. */
  templateDefaultPaise: number;
  utilityPaise: number;
  marketingPaise: number;
  authenticationPaise: number;
  /** Free-form text/media inside the 24h window. */
  freeformPaise: number;
  /** Per answered minute for WhatsApp voice calling. */
  callPerMinutePaise: number;
};

export const DEFAULT_WA_MESSAGE_RATES: WhatsappMessageRates = {
  templateDefaultPaise: 50,
  utilityPaise: 40,
  marketingPaise: 120,
  authenticationPaise: 50,
  freeformPaise: 25,
  callPerMinutePaise: 150,
};

let cachedRates: { at: number; value: WhatsappMessageRates } | null = null;

export async function getWhatsappMessageRates(): Promise<WhatsappMessageRates> {
  const now = Date.now();
  if (cachedRates && now - cachedRates.at < 60_000) return cachedRates.value;
  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, SETTINGS_KEY))
      .limit(1);
    if (row?.value) {
      const parsed = JSON.parse(row.value) as Partial<WhatsappMessageRates>;
      const value: WhatsappMessageRates = { ...DEFAULT_WA_MESSAGE_RATES, ...parsed };
      cachedRates = { at: now, value };
      return value;
    }
  } catch (err) {
    logger.warn({ err }, "whatsapp-billing: failed to load rates — using defaults");
  }
  cachedRates = { at: now, value: DEFAULT_WA_MESSAGE_RATES };
  return DEFAULT_WA_MESSAGE_RATES;
}

export async function setWhatsappMessageRates(rates: Partial<WhatsappMessageRates>): Promise<WhatsappMessageRates> {
  const next = { ...DEFAULT_WA_MESSAGE_RATES, ...(await getWhatsappMessageRates()), ...rates };
  await db
    .insert(platformSettingsTable)
    .values({ key: SETTINGS_KEY, value: JSON.stringify(next) })
    .onConflictDoUpdate({
      target: platformSettingsTable.key,
      set: { value: JSON.stringify(next), updatedAt: new Date() },
    });
  cachedRates = { at: Date.now(), value: next };
  return next;
}

export function rateForTemplateCategory(rates: WhatsappMessageRates, category?: string | null): number {
  const c = (category ?? "").toUpperCase();
  if (c === "UTILITY") return rates.utilityPaise;
  if (c === "MARKETING") return rates.marketingPaise;
  if (c === "AUTHENTICATION") return rates.authenticationPaise;
  return rates.templateDefaultPaise;
}

export type WaDebitResult =
  | { ok: true; amountPaise: number; balanceAfter: number }
  | { ok: false; code: "INSUFFICIENT_BALANCE" | "USER_NOT_FOUND" | "ALREADY_BILLED"; error: string; amountPaise?: number };

/**
 * Atomic wallet debit for a WhatsApp message. Idempotent on messageRowId.
 * Call AFTER a successful VoBiz send (or before — fail closed if insufficient).
 */
export async function debitWhatsappMessage(opts: {
  clerkUserId: string;
  messageRowId: string;
  amountPaise: number;
  description: string;
}): Promise<WaDebitResult> {
  const amount = Math.max(0, Math.floor(opts.amountPaise));
  if (amount <= 0) return { ok: true, amountPaise: 0, balanceAfter: 0 };

  const [user] = await db
    .select({ id: usersTable.id, walletBalanceCents: usersTable.walletBalanceCents })
    .from(usersTable)
    .where(eq(usersTable.clerkId, opts.clerkUserId))
    .limit(1);
  if (!user) return { ok: false, code: "USER_NOT_FOUND", error: "User not found", amountPaise: amount };

  // Idempotency: skip if we already wrote a txn for this message.
  const marker = `wa_msg:${opts.messageRowId}`;
  const [existing] = await db
    .select({ id: walletTransactionsTable.id })
    .from(walletTransactionsTable)
    .where(and(
      eq(walletTransactionsTable.userId, user.id),
      sql`${walletTransactionsTable.description} LIKE ${marker + "%"}`,
    ))
    .limit(1);
  if (existing) {
    return { ok: false, code: "ALREADY_BILLED", error: "Already billed", amountPaise: amount };
  }

  if (user.walletBalanceCents < amount) {
    return {
      ok: false,
      code: "INSUFFICIENT_BALANCE",
      error: `Insufficient wallet balance. Need ${formatInr(amount)}, have ${formatInr(user.walletBalanceCents)}.`,
      amountPaise: amount,
    };
  }

  const [updated] = await db
    .update(usersTable)
    .set({
      walletBalanceCents: sql`GREATEST(0, ${usersTable.walletBalanceCents} - ${amount})`,
    })
    .where(and(
      eq(usersTable.id, user.id),
      sql`${usersTable.walletBalanceCents} >= ${amount}`,
    ))
    .returning({ walletBalanceCents: usersTable.walletBalanceCents });

  if (!updated) {
    return {
      ok: false,
      code: "INSUFFICIENT_BALANCE",
      error: `Insufficient wallet balance. Need ${formatInr(amount)}.`,
      amountPaise: amount,
    };
  }

  await db.insert(walletTransactionsTable).values({
    userId: user.id,
    type: "debit",
    amountCents: -amount,
    // Store human description in a second row? Prefer single row with marker + detail.
    description: `${marker} · ${opts.description}`.slice(0, 400),
    status: "completed",
  });

  return { ok: true, amountPaise: amount, balanceAfter: updated.walletBalanceCents };
}

/** Pre-check balance before sending (own-channel native only). */
export async function assertWhatsappSendBalance(
  clerkUserId: string,
  amountPaise: number,
): Promise<WaDebitResult | { ok: true; amountPaise: number }> {
  const amount = Math.max(0, Math.floor(amountPaise));
  if (amount <= 0) return { ok: true, amountPaise: 0 };
  const [user] = await db
    .select({ walletBalanceCents: usersTable.walletBalanceCents })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkUserId))
    .limit(1);
  if (!user) return { ok: false, code: "USER_NOT_FOUND", error: "User not found", amountPaise: amount };
  if (user.walletBalanceCents < amount) {
    return {
      ok: false,
      code: "INSUFFICIENT_BALANCE",
      error: `Insufficient wallet balance. Need ${formatInr(amount)}, have ${formatInr(user.walletBalanceCents)}. Top up to send WhatsApp.`,
      amountPaise: amount,
    };
  }
  return { ok: true, amountPaise: amount };
}

export async function debitWhatsappCallMinutes(opts: {
  clerkUserId: string;
  callLogId: string;
  minutes: number;
}): Promise<WaDebitResult> {
  const rates = await getWhatsappMessageRates();
  const mins = Math.max(1, Math.ceil(opts.minutes));
  const amount = mins * rates.callPerMinutePaise;
  return debitWhatsappMessage({
    clerkUserId: opts.clerkUserId,
    messageRowId: `call:${opts.callLogId}`,
    amountPaise: amount,
    description: `WhatsApp call ${mins} min × ${formatInr(rates.callPerMinutePaise)}`,
  });
}

/** Best-effort annotate; unused for now but kept for call-fail paths. */
export async function annotateMessageBillingSkipped(messageRowId: string, reason: string): Promise<void> {
  await db
    .update(whatsappMessagesTable)
    .set({
      errorMessage: `billing: ${reason}`.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(whatsappMessagesTable.id, messageRowId))
    .catch(() => {});
}
