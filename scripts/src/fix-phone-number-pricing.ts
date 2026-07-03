/**
 * fix-phone-number-pricing.ts
 *
 * One-time correction for phone_numbers rows whose monthly_rate_cents /
 * renewal_rate_cents were persisted with a pre-markup value.
 *
 * Background: `phone-numbers.ts`'s purchase route has always written a flat,
 * reseller-marked-up price at insert time (currently 1000 cents = $10.00
 * first-purchase fee, 800 cents = $8.00 recurring monthly renewal — see
 * FLAT_MONTHLY_RATE_CENTS / RENEWAL_RATE_CENTS in
 * artifacts/api-server/src/routes/phone-numbers.ts). Numbers purchased before
 * that markup existed can still carry the raw carrier fee (e.g. an INR
 * monthly_fee written straight into monthly_rate_cents), which shows up in
 * the UI as a wildly wrong price like "$850.00/mo" instead of "$10.00/mo".
 *
 * This script finds any ACTIVE phone_numbers row whose monthly_rate_cents or
 * renewal_rate_cents don't match the canonical flat values and corrects them.
 * It does NOT touch nextRenewalAt/lastRenewalAt and does NOT refund/reverse
 * any past wallet debits charged at the old (wrong) rate — it only fixes the
 * rate going forward and the displayed price.
 *
 * Usage:
 *   # dry-run (default, read-only) — prints the plan and exits
 *   DATABASE_URL=<url> pnpm --filter @workspace/scripts run fix-phone-number-pricing
 *
 *   # apply the correction
 *   DATABASE_URL=<url> pnpm --filter @workspace/scripts run fix-phone-number-pricing -- --apply
 *
 * Idempotent — a second run finds nothing left to fix.
 * Apply requires a confirmed DB backup first.
 */

import { db, pool, phoneNumbersTable } from "@workspace/db";
import { and, eq, ne, or } from "drizzle-orm";

// Keep in sync with artifacts/api-server/src/routes/phone-numbers.ts
const FLAT_MONTHLY_RATE_CENTS = 1000; // $10.00 USD — first-purchase fee
const RENEWAL_RATE_CENTS = 800; // $8.00 USD — recurring monthly renewal

async function main() {
  const apply = process.argv.includes("--apply");
  const host = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "(local)";

  console.log("\n=== SnapServe — Phone Number Pricing Correction ===");
  console.log(`DATABASE_URL host: ${host}`);
  console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN (read-only)"}\n`);

  const wrong = await db
    .select({
      id: phoneNumbersTable.id,
      number: phoneNumbersTable.number,
      userId: phoneNumbersTable.userId,
      status: phoneNumbersTable.status,
      monthlyRateCents: phoneNumbersTable.monthlyRateCents,
      renewalRateCents: phoneNumbersTable.renewalRateCents,
    })
    .from(phoneNumbersTable)
    .where(
      and(
        eq(phoneNumbersTable.status, "active"),
        or(
          ne(phoneNumbersTable.monthlyRateCents, FLAT_MONTHLY_RATE_CENTS),
          ne(phoneNumbersTable.renewalRateCents, RENEWAL_RATE_CENTS),
        ),
      ),
    );

  if (wrong.length === 0) {
    console.log("Nothing to fix — all active phone numbers already have canonical pricing.\n");
    await pool.end();
    return;
  }

  console.log(`Found ${wrong.length} active phone number(s) with non-canonical pricing:\n`);
  for (const row of wrong) {
    console.log(
      `  #${row.id} ${row.number} (user ${row.userId}): ` +
        `monthlyRateCents ${row.monthlyRateCents} → ${FLAT_MONTHLY_RATE_CENTS}, ` +
        `renewalRateCents ${row.renewalRateCents} → ${RENEWAL_RATE_CENTS}`,
    );
  }

  if (!apply) {
    console.log("\nDry-run only — no changes made. Re-run with -- --apply to correct these rows.\n");
    await pool.end();
    return;
  }

  for (const row of wrong) {
    await db
      .update(phoneNumbersTable)
      .set({ monthlyRateCents: FLAT_MONTHLY_RATE_CENTS, renewalRateCents: RENEWAL_RATE_CENTS })
      .where(eq(phoneNumbersTable.id, row.id));
  }

  console.log(`\nCorrected ${wrong.length} phone number(s).\n`);
  await pool.end();
}

main().catch((err) => {
  console.error("Phone number pricing correction failed:", err);
  process.exit(1);
});
