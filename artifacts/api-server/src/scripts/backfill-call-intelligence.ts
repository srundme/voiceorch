/**
 * Backfill conversation intelligence (sentiment / intent / topics) for
 * campaign calls that already have a transcript but no sentiment yet.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run backfill-call-intelligence
 *   CAMPAIGN_ID=123 pnpm --filter @workspace/api-server run backfill-call-intelligence
 *   FORCE=1 LIMIT=200 pnpm --filter @workspace/api-server run backfill-call-intelligence
 *
 * Env: DATABASE_URL + a managed LLM key (same as disposition).
 */
import { db, campaignsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { backfillCampaignIntelligence } from "../services/analyze-call-intelligence.js";

async function main(): Promise<void> {
  const force = process.env["FORCE"] === "1" || process.env["FORCE"] === "true";
  const limit = Math.min(Math.max(Number(process.env["LIMIT"] ?? 500), 1), 5000);
  const onlyId = process.env["CAMPAIGN_ID"] ? Number(process.env["CAMPAIGN_ID"]) : null;

  let campaigns: Array<{ id: number; name: string; status: string }>;
  if (onlyId != null && Number.isFinite(onlyId)) {
    const [one] = await db
      .select({ id: campaignsTable.id, name: campaignsTable.name, status: campaignsTable.status })
      .from(campaignsTable)
      .where(eq(campaignsTable.id, onlyId));
    campaigns = one ? [one] : [];
  } else {
    // Prefer completed / stopped / active campaigns that already dialled leads
    campaigns = await db
      .select({ id: campaignsTable.id, name: campaignsTable.name, status: campaignsTable.status })
      .from(campaignsTable)
      .orderBy(desc(campaignsTable.updatedAt))
      .limit(200);
  }

  console.log(
    `[backfill-call-intelligence] ${campaigns.length} campaign(s), force=${force}, limit/campaign=${limit}`,
  );

  let totalAnalysed = 0;
  let totalFailed = 0;

  for (const c of campaigns) {
    process.stdout.write(`  campaign ${c.id} (${c.name}, ${c.status}) … `);
    try {
      const result = await backfillCampaignIntelligence(c.id, { force, limit, concurrency: 2 });
      totalAnalysed += result.analysed;
      totalFailed += result.failed;
      console.log(
        `scanned=${result.scanned} analysed=${result.analysed} skipped=${result.skipped} failed=${result.failed}`,
      );
    } catch (err) {
      totalFailed++;
      console.log(`ERROR ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`[backfill-call-intelligence] done. analysed=${totalAnalysed} failed=${totalFailed}`);
  process.exit(totalFailed > 0 && totalAnalysed === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
