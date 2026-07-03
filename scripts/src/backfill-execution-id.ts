/**
 * backfill-execution-id.ts
 *
 * Populates `calls.execution_id` for every pre-existing row where it is
 * NULL or empty. Every call-creation path now generates a real
 * `exec_xxxxxxxx` id at insert time (routes/calls.ts, orchestration/
 * session.ts createSession), so this is a one-time catch-up for historical
 * rows created before that was universally true.
 *
 * Guarantees:
 *   - Never touches a row that already has a non-empty execution_id.
 *   - Every generated id is checked for uniqueness against BOTH existing
 *     ids in the table and ids generated earlier in the same run, so no
 *     duplicates are ever produced.
 *   - Idempotent: rows already backfilled (or created after this fix
 *     shipped) are skipped on re-run — running it twice is a no-op.
 *
 * Usage:
 *   DATABASE_URL=<url> pnpm --filter @workspace/scripts run backfill-execution-id
 */

import { db, pool, callsTable } from "@workspace/db";
import { isNull, or, eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";

function generateExecutionId(): string {
  return `exec_${randomBytes(4).toString("hex")}`;
}

async function main(): Promise<void> {
  const rows = await db
    .select({ id: callsTable.id })
    .from(callsTable)
    .where(or(isNull(callsTable.executionId), eq(callsTable.executionId, "")));

  if (rows.length === 0) {
    console.log("No calls rows missing execution_id — nothing to backfill.");
    return;
  }

  console.log(`Found ${rows.length} call(s) missing execution_id. Backfilling...`);

  const existingIds = new Set(
    (
      await db
        .select({ executionId: callsTable.executionId })
        .from(callsTable)
        .where(sql`${callsTable.executionId} IS NOT NULL AND ${callsTable.executionId} != ''`)
    ).map((r) => r.executionId as string),
  );

  let updated = 0;
  for (const row of rows) {
    let candidate = generateExecutionId();
    while (existingIds.has(candidate)) {
      candidate = generateExecutionId();
    }
    existingIds.add(candidate);

    // Re-assert the NULL/empty guard in the UPDATE itself so a concurrent
    // writer that already set an execution_id between our SELECT and this
    // UPDATE is never overwritten.
    const result = await db
      .update(callsTable)
      .set({ executionId: candidate })
      .where(
        sql`${callsTable.id} = ${row.id} AND (${callsTable.executionId} IS NULL OR ${callsTable.executionId} = '')`,
      )
      .returning({ id: callsTable.id });

    if (result.length > 0) updated++;
  }

  console.log(`Backfill complete. ${updated} row(s) updated.`);
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error("Backfill failed:", err);
    return pool.end().finally(() => process.exit(1));
  });
