/**
 * Verifies the canonical disposition bucket SQL against the live database and
 * shows how existing lead labels collapse. Read-only.
 *
 *   tsx src/scripts/check-disposition-buckets.ts [campaignId]
 */
import { db, campaignLeadsTable } from "@workspace/db";
import { and, count, eq, isNotNull, sql } from "drizzle-orm";
import { canonicalDispositionFromLabel, dispositionBucketSql } from "../lib/disposition/canonical.js";

async function main() {
  const campaignId = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  const bucketSql = dispositionBucketSql(sql`${campaignLeadsTable.disposition}`);

  const where = and(
    isNotNull(campaignLeadsTable.disposition),
    sql`btrim(${campaignLeadsTable.disposition}) <> ''`,
    ...(campaignId ? [eq(campaignLeadsTable.campaignId, campaignId)] : []),
  );

  const rows = await db
    .select({
      raw: campaignLeadsTable.disposition,
      bucket: bucketSql,
      cnt: count(),
    })
    .from(campaignLeadsTable)
    .where(where)
    .groupBy(campaignLeadsTable.disposition, bucketSql)
    .orderBy(sql`count(*) desc`)
    .limit(200);

  console.log(`\nraw label → bucket (${rows.length} distinct labels)\n`);
  let drift = 0;
  for (const r of rows) {
    const js = canonicalDispositionFromLabel(r.raw);
    const agrees = js === r.bucket;
    if (!agrees) drift++;
    console.log(
      `${String(r.cnt).padStart(6)}  ${String(r.raw).padEnd(42)} → ${String(r.bucket).padEnd(24)}${agrees ? "" : `  ⚠ js=${js}`}`,
    );
  }

  const merged = new Map<string, number>();
  for (const r of rows) merged.set(r.bucket, (merged.get(r.bucket) ?? 0) + Number(r.cnt));

  console.log(`\ncards before: ${rows.length}   cards after: ${merged.size}`);
  console.log(`sql/js agreement: ${rows.length - drift}/${rows.length}\n`);
  for (const [b, c] of [...merged].sort((a, z) => z[1] - a[1])) {
    console.log(`${String(c).padStart(6)}  ${b}`);
  }

  process.exit(drift === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
