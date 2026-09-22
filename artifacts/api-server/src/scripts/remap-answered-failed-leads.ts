/**
 * Optional one-time remap: legacy answered_ever + call_status=failed → pending/completed.
 *
 * Run AFTER CAMPAIGN_LEAD_STATE_V2 writers are on and KPIs look healthy.
 * Dry-run by default; pass --apply to write.
 *
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/remap-answered-failed-leads.ts
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/remap-answered-failed-leads.ts --apply
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/remap-answered-failed-leads.ts --apply --campaign=449
 */
import { db, campaignLeadsTable, callRetriesTable, campaignsTable } from "@workspace/db";
import { and, eq, count } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");
const campaignArg = process.argv.find((a) => a.startsWith("--campaign="));
const campaignId = campaignArg ? parseInt(campaignArg.split("=")[1]!, 10) : null;

async function main() {
  const where = and(
    eq(campaignLeadsTable.answeredEver, true),
    eq(campaignLeadsTable.callStatus, "failed"),
    ...(campaignId && Number.isFinite(campaignId)
      ? [eq(campaignLeadsTable.campaignId, campaignId)]
      : []),
  );

  const [summary] = await db
    .select({ c: count() })
    .from(campaignLeadsTable)
    .where(where);

  const total = Number(summary?.c ?? 0);
  console.log(
    `\nLegacy answered+failed leads: ${total}`
    + (campaignId ? ` (campaign ${campaignId})` : " (all campaigns)")
    + `\nMode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`,
  );

  if (total === 0) {
    console.log("Nothing to remap.");
    return;
  }

  if (!APPLY) {
    console.log("Re-run with --apply to park as pending (if attempts remain) or completed.");
    return;
  }

  const leads = await db
    .select({
      id: campaignLeadsTable.id,
      campaignId: campaignLeadsTable.campaignId,
      callAttempts: campaignLeadsTable.callAttempts,
      batchId: campaignLeadsTable.batchId,
    })
    .from(campaignLeadsTable)
    .where(where)
    .limit(5000);

  let pending = 0;
  let completed = 0;

  for (const lead of leads) {
    const [campaign] = await db
      .select({ maxAttempts: campaignsTable.maxAttempts })
      .from(campaignsTable)
      .where(eq(campaignsTable.id, lead.campaignId))
      .limit(1);
    const maxAttempts = campaign?.maxAttempts ?? 1;
    const attempts = lead.callAttempts ?? 0;
    const hasAttemptsLeft = attempts < maxAttempts;

    const [pendingRetry] = await db
      .select({ c: count() })
      .from(callRetriesTable)
      .where(and(
        eq(callRetriesTable.leadId, lead.id),
        eq(callRetriesTable.status, "pending"),
      ));
    const alreadyQueued = Number(pendingRetry?.c ?? 0) > 0;

    const nextStatus = (hasAttemptsLeft || alreadyQueued) ? "pending" : "completed";

    await db.update(campaignLeadsTable)
      .set({
        callStatus: nextStatus,
        notes: `Remapped answered+failed → ${nextStatus} (legacy cleanup)`,
      })
      .where(and(
        eq(campaignLeadsTable.id, lead.id),
        eq(campaignLeadsTable.callStatus, "failed"),
        eq(campaignLeadsTable.answeredEver, true),
      ));

    if (nextStatus === "pending") pending++;
    else completed++;
  }

  console.log(`Remapped ${leads.length}: pending=${pending}, completed=${completed}`);
  if (leads.length >= 5000) {
    console.log("Hit 5k batch limit — re-run until dry-run shows 0.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
