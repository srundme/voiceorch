/**
 * Recompute campaign_leads.operational_outcome for existing leads.
 *
 * Historical leads were stamped when the positive-disposition check could never
 * match: meaningFlagsForOutcome always returned a Set, which suppressed the
 * platform defaults, and the comparison ran against the whole "primary: sub"
 * label instead of its segments. Both are fixed going forward, but leads
 * already written keep their stale outcome — so campaigns that clearly had
 * interested leads still report a 0% success rate until this runs.
 *
 * Dry run by default; nothing is written without --apply.
 *
 *   tsx src/scripts/backfill-operational-outcomes.ts                 # all campaigns, preview
 *   tsx src/scripts/backfill-operational-outcomes.ts --campaign=42   # one campaign, preview
 *   tsx src/scripts/backfill-operational-outcomes.ts --apply         # write
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  db,
  campaignsTable,
  campaignLeadsTable,
  bookingsTable,
  leadTransfersTable,
  scheduledCallbacksTable,
  callCallbacksTable,
} from "@workspace/db";
import { computeOperationalOutcome, setOperationalOutcome } from "../services/operational-outcome.js";
import { loadAgentMeaningMap, meaningFlagsForOutcome } from "../services/disposition-meaning.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const campaignArg = args.find((a) => a.startsWith("--campaign="));
const onlyCampaignId = campaignArg ? parseInt(campaignArg.split("=")[1]!, 10) : null;

/** Set-based lookups so a large campaign costs a handful of queries, not one per lead. */
async function loadSignals(leadIds: number[], callIds: number[]) {
  const bookingCallIds = new Set<number>();
  const transferLeadIds = new Set<number>();
  const callbackLeadIds = new Set<number>();

  if (callIds.length > 0) {
    const rows = await db
      .select({ callId: bookingsTable.callId })
      .from(bookingsTable)
      .where(inArray(bookingsTable.callId, callIds));
    for (const r of rows) if (r.callId != null) bookingCallIds.add(Number(r.callId));
  }

  if (leadIds.length > 0) {
    const xfers = await db
      .select({ leadId: leadTransfersTable.leadId })
      .from(leadTransfersTable)
      .where(and(
        inArray(leadTransfersTable.leadId, leadIds),
        eq(leadTransfersTable.outcome, "completed"),
      ));
    for (const r of xfers) if (r.leadId != null) transferLeadIds.add(Number(r.leadId));

    const scheduled = await db
      .select({ leadId: scheduledCallbacksTable.campaignLeadId })
      .from(scheduledCallbacksTable)
      .where(and(
        inArray(scheduledCallbacksTable.campaignLeadId, leadIds),
        eq(scheduledCallbacksTable.status, "pending"),
      ));
    for (const r of scheduled) if (r.leadId != null) callbackLeadIds.add(Number(r.leadId));

    const legacy = await db
      .select({ leadId: callCallbacksTable.leadId })
      .from(callCallbacksTable)
      .where(and(
        inArray(callCallbacksTable.leadId, leadIds),
        eq(callCallbacksTable.status, "pending"),
      ));
    for (const r of legacy) if (r.leadId != null) callbackLeadIds.add(Number(r.leadId));
  }

  return { bookingCallIds, transferLeadIds, callbackLeadIds };
}

async function processCampaign(campaign: {
  id: number;
  agentId: number | null;
  maxAttempts: number | null;
  name: string | null;
}) {
  const leads = await db
    .select({
      id: campaignLeadsTable.id,
      callId: campaignLeadsTable.callId,
      disposition: campaignLeadsTable.disposition,
      callStatus: campaignLeadsTable.callStatus,
      callAttempts: campaignLeadsTable.callAttempts,
      operationalOutcome: campaignLeadsTable.operationalOutcome,
    })
    .from(campaignLeadsTable)
    .where(eq(campaignLeadsTable.campaignId, campaign.id));

  if (leads.length === 0) return { scanned: 0, changed: 0, transitions: new Map<string, number>() };

  const map = campaign.agentId ? await loadAgentMeaningMap(campaign.agentId) : null;
  const maxAttempts = campaign.maxAttempts ?? 1;

  const { bookingCallIds, transferLeadIds, callbackLeadIds } = await loadSignals(
    leads.map((l) => l.id),
    leads.map((l) => (l.callId != null ? Number(l.callId) : null)).filter((x): x is number => x != null),
  );

  const transitions = new Map<string, number>();
  let changed = 0;

  for (const lead of leads) {
    const flags = meaningFlagsForOutcome(null, map, lead.disposition);
    const next = computeOperationalOutcome({
      callStatus: lead.callStatus,
      disposition: lead.disposition,
      hasBooking: lead.callId != null && bookingCallIds.has(Number(lead.callId)),
      hasCompletedTransfer: transferLeadIds.has(lead.id),
      hasPendingCallback: callbackLeadIds.has(lead.id),
      maxAttemptsReached: (lead.callAttempts ?? 0) >= maxAttempts,
      isDncBlocked: false,
      positiveDispositions: flags.positiveDispositions,
      dispositionIsDnc: flags.isDncFromMeaning,
      dispositionIsCallback: flags.isCallbackFromMeaning,
      dispositionIsInterested: flags.meaning === "interested",
    });

    if (next === lead.operationalOutcome) continue;

    changed++;
    const key = `${lead.operationalOutcome} → ${next}`;
    transitions.set(key, (transitions.get(key) ?? 0) + 1);

    if (apply) {
      await setOperationalOutcome(db, lead.id, campaign.id, next);
    }
  }

  return { scanned: leads.length, changed, transitions };
}

async function main() {
  const campaigns = await db
    .select({
      id: campaignsTable.id,
      name: campaignsTable.name,
      agentId: campaignsTable.agentId,
      maxAttempts: campaignsTable.maxAttempts,
    })
    .from(campaignsTable)
    .where(onlyCampaignId ? eq(campaignsTable.id, onlyCampaignId) : isNotNull(campaignsTable.id));

  console.log(
    `\n${apply ? "APPLYING" : "DRY RUN (pass --apply to write)"} — ${campaigns.length} campaign(s)\n`,
  );

  let totalScanned = 0;
  let totalChanged = 0;
  const allTransitions = new Map<string, number>();

  for (const c of campaigns) {
    const { scanned, changed, transitions } = await processCampaign(c);
    totalScanned += scanned;
    totalChanged += changed;
    for (const [k, v] of transitions) allTransitions.set(k, (allTransitions.get(k) ?? 0) + v);

    if (changed > 0) {
      console.log(`campaign ${c.id} "${c.name ?? ""}" — ${changed}/${scanned} leads change`);
      for (const [k, v] of [...transitions].sort((a, z) => z[1] - a[1])) {
        console.log(`         ${String(v).padStart(6)}  ${k}`);
      }
    }
  }

  console.log(`\nscanned ${totalScanned} leads, ${totalChanged} would change\n`);
  for (const [k, v] of [...allTransitions].sort((a, z) => z[1] - a[1])) {
    console.log(`${String(v).padStart(8)}  ${k}`);
  }
  if (!apply && totalChanged > 0) console.log(`\nRe-run with --apply to write these.\n`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
