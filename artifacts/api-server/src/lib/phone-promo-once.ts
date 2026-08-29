import { and, eq, inArray } from "drizzle-orm";
import { db, phoneNumberOrdersTable, usersTable } from "@workspace/db";
import { emailPromoFingerprint } from "./phone-promo-email.js";
import type { PhonePromo } from "./phone-promo.js";

const CONSUMING_STATUSES = ["pending", "processing", "completed"] as const;

export type OncePerEmailCheck =
  | { ok: true }
  | { ok: false; code: "PROMO_NEEDS_EMAIL" | "PROMO_ALREADY_USED"; message: string };

/**
 * True when this login (or the same mailbox fingerprint) already has a
 * consuming order for `promoCode`.
 */
export async function hasUsedOncePerEmailPromo(
  promoCode: string,
  clerkId: string,
  email: string | null | undefined,
  executor: typeof db | { select: typeof db.select } = db,
): Promise<boolean> {
  const fp = emailPromoFingerprint(email);
  const rows = await executor
    .select({
      clerkId: phoneNumberOrdersTable.userId,
      email: usersTable.email,
    })
    .from(phoneNumberOrdersTable)
    .innerJoin(usersTable, eq(usersTable.clerkId, phoneNumberOrdersTable.userId))
    .where(and(
      eq(phoneNumberOrdersTable.promoCode, promoCode),
      inArray(phoneNumberOrdersTable.status, [...CONSUMING_STATUSES]),
    ));

  return rows.some(r =>
    r.clerkId === clerkId
    || (fp.length > 0 && emailPromoFingerprint(r.email) === fp),
  );
}

export async function checkOncePerEmailPromo(
  promo: PhonePromo | null | undefined,
  clerkId: string,
  email: string | null | undefined,
  executor: typeof db | { select: typeof db.select } = db,
): Promise<OncePerEmailCheck> {
  if (!promo?.oncePerEmail) return { ok: true };
  const fp = emailPromoFingerprint(email);
  if (!fp) {
    return {
      ok: false,
      code: "PROMO_NEEDS_EMAIL",
      message: "This offer needs an email on your SnapServe account.",
    };
  }
  if (await hasUsedOncePerEmailPromo(promo.code, clerkId, email, executor)) {
    return {
      ok: false,
      code: "PROMO_ALREADY_USED",
      message: "This code can only be used once per email account.",
    };
  }
  return { ok: true };
}
