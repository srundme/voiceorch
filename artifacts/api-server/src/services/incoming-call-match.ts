/**
 * Incoming call → campaign matching.
 *
 * When a lead calls us back (inbound), the call lands in Call History but the
 * campaign's "Incoming" tab reads from incoming_calls — which nothing was
 * populating. This service links inbound calls to campaign leads by phone so
 * campaign owners never miss a callback:
 *   - matchInboundCallToCampaigns: live, right after an inbound call ends
 *   - syncCampaignIncomingCalls:   idempotent backfill for one campaign,
 *     run when the Incoming tab loads (covers historical calls too)
 *
 * Matching key: last 10 digits of the caller number vs the lead phone.
 */
import { db, incomingCallsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

function last10Digits(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/**
 * Match one just-ended inbound call to the caller's most recent campaign lead
 * owned by this user. No-op when the caller is not a known campaign lead or
 * the call is already recorded.
 */
export async function matchInboundCallToCampaigns(opts: {
  callId: number;
  userId: string;
  callerPhone: string;
}): Promise<{ campaignId: number; leadId: number } | null> {
  const key = last10Digits(opts.callerPhone);
  if (!key) return null;

  const [existing] = await db
    .select({ id: incomingCallsTable.id })
    .from(incomingCallsTable)
    .where(eq(incomingCallsTable.callId, opts.callId))
    .limit(1);
  if (existing) return null;

  const matched = await db.execute(sql`
    select l.id as lead_id, l.campaign_id, l.batch_id
    from campaign_leads l
    join campaigns c on c.id = l.campaign_id
    where c.user_id = ${opts.userId}
      and right(regexp_replace(l.phone, '\\D', '', 'g'), 10) = ${key}
    order by l.id desc
    limit 1
  `);
  const rows = (matched as unknown as { rows?: Array<{ lead_id: number; campaign_id: number; batch_id: number | null }> }).rows ?? [];
  const lead = rows[0];
  if (!lead) return null;

  await db.insert(incomingCallsTable).values({
    userId: opts.userId,
    phone: opts.callerPhone,
    normalizedPhone: key,
    campaignId: lead.campaign_id,
    batchId: lead.batch_id ?? null,
    leadId: lead.lead_id,
    callId: opts.callId,
    incomingCallStatus: "unreviewed",
    matchedAt: new Date(),
  });

  logger.info(
    { callId: opts.callId, campaignId: lead.campaign_id, leadId: lead.lead_id },
    "incoming-call-match: inbound call linked to campaign lead",
  );
  return { campaignId: lead.campaign_id, leadId: lead.lead_id };
}

/**
 * Backfill: link every historical inbound call from this user that matches a
 * lead of the given campaign. Idempotent (keyed on call_id) — safe to run on
 * every Incoming-tab load. Excludes webcalls and campaign-dialled calls.
 */
export async function syncCampaignIncomingCalls(
  campaignId: number,
  userId: string,
): Promise<number> {
  try {
    const result = await db.execute(sql`
      insert into incoming_calls
        (user_id, phone, normalized_phone, campaign_id, batch_id, lead_id, call_id,
         incoming_call_status, matched_at, created_at)
      select distinct on (c.id)
        ${userId},
        c.from_number,
        right(regexp_replace(c.from_number, '\\D', '', 'g'), 10),
        l.campaign_id,
        l.batch_id,
        l.id,
        c.id,
        'unreviewed',
        now(),
        c.created_at
      from calls c
      join campaign_leads l
        on right(regexp_replace(l.phone, '\\D', '', 'g'), 10)
         = right(regexp_replace(c.from_number, '\\D', '', 'g'), 10)
      where l.campaign_id = ${campaignId}
        and c.user_id = ${userId}
        and c.from_number not like 'webcall%'
        and c.to_number not like 'webcall%'
        and length(regexp_replace(c.from_number, '\\D', '', 'g')) >= 10
        -- inbound: explicit metadata direction, or no direction recorded
        -- (mirrors deriveDirection's default for non-campaign phone calls)
        and (
          c.metadata is null
          or c.metadata like '%"direction":"inbound"%'
          or c.metadata not like '%"direction"%'
        )
        -- not a campaign-dialled (outbound) call
        and not exists (select 1 from call_executions ce where ce.call_id = c.id)
        and not exists (select 1 from campaign_leads cl2 where cl2.call_id = c.id)
        -- not already recorded
        and not exists (select 1 from incoming_calls ic where ic.call_id = c.id)
      order by c.id, l.id desc
    `);
    const inserted = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    if (inserted > 0) {
      logger.info({ campaignId, inserted }, "incoming-call-match: backfilled inbound calls");
    }
    return inserted;
  } catch (err) {
    logger.warn({ campaignId, err }, "incoming-call-match: sync failed");
    return 0;
  }
}
