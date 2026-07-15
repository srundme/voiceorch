/**
 * fix-phone-number-pricing.ts
 *
 * One-time correction for phone_numbers rows whose monthly_rate_cents /
 * renewal_rate_cents don't match the canonical INR flat rates.
 *
 * Canonical (paise):
 *   monthly_rate_cents  = 80000  (₹800 base)
 *   renewal_rate_cents  = 94400  (₹800 + 18% GST)
 *
 * Usage:
 *   DATABASE_URL=<url> pnpm --filter @workspace/scripts run fix-phone-number-pricing
 *   DATABASE_URL=<url> pnpm --filter @workspace/scripts run fix-phone-number-pricing -- --apply
 */

import { db, pool, phoneNumbersTable } from "@workspace/db";
import { and, eq, ne, or } from "drizzle-orm";

const FLAT_MONTHLY_RATE_CENTS = 80_000; // ₹800 base
const RENEWAL_RATE_CENTS = 94_400;      // ₹800 + 18% GST

async function main() {
  const apply = process.argv.includes("--apply");

  const mismatched = await db
    .select()
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

  if (mismatched.length === 0) {
    console.log("No active phone numbers need rate correction.");
    await pool.end();
    return;
  }

  console.log(`Found ${mismatched.length} active number(s) with non-canonical rates:`);
  for (const row of mismatched) {
    console.log(
      `  #${row.id} ${row.number}: monthly=${row.monthlyRateCents} renewal=${row.renewalRateCents}` +
        ` → monthly=${FLAT_MONTHLY_RATE_CENTS} renewal=${RENEWAL_RATE_CENTS}`,
    );
  }

  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to write corrections.");
    await pool.end();
    return;
  }

  for (const row of mismatched) {
    await db
      .update(phoneNumbersTable)
      .set({
        monthlyRateCents: FLAT_MONTHLY_RATE_CENTS,
        renewalRateCents: RENEWAL_RATE_CENTS,
      })
      .where(eq(phoneNumbersTable.id, row.id));
  }

  console.log(`\nUpdated ${mismatched.length} row(s).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
