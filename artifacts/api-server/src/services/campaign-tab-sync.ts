import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export type CampaignCallContext = {
  leadId: number;
  campaignId: number;
  batchId: number | null;
};

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] })?.rows ?? []);
}

/** Resolve the campaign lead for either the latest lead call or any execution attempt. */
export async function resolveCampaignCallContext(callId: number): Promise<CampaignCallContext | null> {
  const result = await db.execute(sql`
    select cl.id as "leadId", cl.campaign_id as "campaignId", cl.batch_id as "batchId"
    from campaign_leads cl
    left join call_executions ce on ce.lead_id = cl.id
    where cl.call_id = ${callId} or ce.call_id = ${callId}
    order by case when cl.call_id = ${callId} then 0 else 1 end, ce.id desc nulls last
    limit 1
  `);
  const row = rowsOf<{ leadId: number; campaignId: number; batchId: number | null }>(result)[0];
  return row
    ? { leadId: Number(row.leadId), campaignId: Number(row.campaignId), batchId: row.batchId == null ? null : Number(row.batchId) }
    : null;
}

/** Mirror a scheduling booking into the campaign Bookings tab. */
export async function syncCampaignBooking(opts: {
  callId: number;
  bookingId: number;
  meetingTime: Date;
  meetingLink?: string | null;
  status: string;
}): Promise<void> {
  const context = await resolveCampaignCallContext(opts.callId);
  if (!context) return;

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      update call_bookings
      set meeting_time = ${opts.meetingTime},
          meeting_link = ${opts.meetingLink ?? null},
          meeting_status = ${opts.status},
          updated_at = now()
      where scheduling_booking_id = ${opts.bookingId}
    `);
    await tx.execute(sql`
      insert into call_bookings (
        lead_id, campaign_id, batch_id, call_id, scheduling_booking_id,
        meeting_time, meeting_link, meeting_status, calendar_provider,
        booking_source, booked_by
      )
      select ${context.leadId}, ${context.campaignId}, ${context.batchId}, ${opts.callId},
             ${opts.bookingId}, ${opts.meetingTime}, ${opts.meetingLink ?? null},
             ${opts.status}, 'google', 'voice_agent', 'agent'
      where not exists (
        select 1 from call_bookings where scheduling_booking_id = ${opts.bookingId}
      )
    `);
    await tx.execute(sql`
      update campaign_leads
      set operational_outcome = 'booking_created', updated_at = now()
      where id = ${context.leadId}
    `);
  });
}

/** Repair historical bookings so the Bookings tab never depends on a live hook succeeding. */
export async function reconcileCampaignBookings(campaignId: number): Promise<void> {
  await db.execute(sql`
    with linked_calls as (
      select cl.id as lead_id, cl.campaign_id, cl.batch_id, cl.call_id
      from campaign_leads cl
      where cl.campaign_id = ${campaignId} and cl.call_id is not null
      union
      select ce.lead_id, ce.campaign_id, ce.batch_id, ce.call_id
      from call_executions ce
      where ce.campaign_id = ${campaignId} and ce.call_id is not null
    )
    insert into call_bookings (
      lead_id, campaign_id, batch_id, call_id, scheduling_booking_id,
      meeting_time, meeting_link, meeting_status, calendar_provider,
      booking_source, booked_by
    )
    select distinct on (b.id)
      lc.lead_id, lc.campaign_id, lc.batch_id, b.call_id, b.id,
      b.slot_start, b.meet_link, b.status, 'google', 'voice_agent', 'agent'
    from bookings b
    join linked_calls lc on lc.call_id = b.call_id
    where lc.campaign_id = ${campaignId}
      and b.call_id is not null
      and not exists (
        select 1 from call_bookings cb where cb.scheduling_booking_id = b.id
      )
    order by b.id
  `);
  await db.execute(sql`
    update call_bookings cb
    set meeting_time = b.slot_start,
        meeting_link = b.meet_link,
        meeting_status = b.status,
        updated_at = now()
    from bookings b
    where cb.campaign_id = ${campaignId}
      and cb.scheduling_booking_id = b.id
      and (
        cb.meeting_time is distinct from b.slot_start
        or cb.meeting_link is distinct from b.meet_link
        or cb.meeting_status is distinct from b.status
      )
  `);
}

/** Mirror a caller-requested callback into the campaign Callbacks tab. */
export async function syncCampaignCallback(opts: {
  context: CampaignCallContext;
  callId?: number | null;
  scheduledAt: Date;
  notes?: string | null;
}): Promise<void> {
  const { context } = opts;
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      insert into call_callbacks (
        lead_id, campaign_id, call_id, callback_at, response_due_by,
        reason, raw_extract, status
      )
      select ${context.leadId}, ${context.campaignId}, ${opts.callId ?? null},
             ${opts.scheduledAt}, ${opts.scheduledAt},
             'callback_requested', ${opts.notes ?? null}, 'pending'
      where not exists (
        select 1
        from call_callbacks
        where lead_id = ${context.leadId}
          and status = 'pending'
          and callback_at = ${opts.scheduledAt}
      )
    `);
    await tx.execute(sql`
      update campaign_leads
      set operational_outcome = 'callback_requested', updated_at = now()
      where id = ${context.leadId}
    `);
  });
}

/** Ensure every successful transfer is visible in the campaign Transfers tab. */
export async function syncCampaignTransfer(opts: {
  callId: number;
  context: CampaignCallContext;
  transferTo: string;
  summary?: string | null;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      insert into call_transfers (
        call_id, user_id, transfer_to, summary, status,
        initiated_at, connected_at, completed_at
      )
      select ${opts.callId}, c.user_id, ${opts.transferTo}, ${opts.summary ?? null},
             'completed', now(), now(), now()
      from calls c
      where c.id = ${opts.callId}
        and not exists (
          select 1 from call_transfers
          where call_id = ${opts.callId} and transfer_to = ${opts.transferTo}
        )
    `);
    await tx.execute(sql`
      update call_transfers
      set status = 'completed',
          summary = coalesce(${opts.summary ?? null}, summary),
          connected_at = coalesce(connected_at, now()),
          completed_at = coalesce(completed_at, now())
      where call_id = ${opts.callId} and transfer_to = ${opts.transferTo}
    `);
    await tx.execute(sql`
      update campaign_leads
      set operational_outcome = 'transfer_completed', updated_at = now()
      where id = ${opts.context.leadId}
    `);
  });
}

/** Backfill scheduled callback rows created before campaign mirroring was added. */
export async function reconcileCampaignCallbacks(campaignId: number): Promise<void> {
  await db.execute(sql`
    with linked_calls as (
      select cl.id as lead_id, cl.campaign_id, cl.call_id
      from campaign_leads cl
      where cl.campaign_id = ${campaignId} and cl.call_id is not null
      union
      select ce.lead_id, ce.campaign_id, ce.call_id
      from call_executions ce
      where ce.campaign_id = ${campaignId} and ce.call_id is not null
    )
    update scheduled_callbacks sc
    set campaign_lead_id = lc.lead_id
    from linked_calls lc
    where sc.campaign_lead_id is null
      and sc.created_from_call_id = lc.call_id
  `);
  await db.execute(sql`
    insert into call_callbacks (
      lead_id, campaign_id, call_id, callback_at, response_due_by,
      reason, raw_extract, status
    )
    select sc.campaign_lead_id, cl.campaign_id, sc.created_from_call_id,
           sc.scheduled_at, sc.scheduled_at, sc.reason, sc.notes,
           case when sc.status in ('triggered', 'cancelled', 'failed') then 'completed' else 'pending' end
    from scheduled_callbacks sc
    join campaign_leads cl on cl.id = sc.campaign_lead_id
    where cl.campaign_id = ${campaignId}
      and sc.reason = 'callback_requested'
      and not exists (
        select 1 from call_callbacks cc
        where cc.lead_id = sc.campaign_lead_id
          and cc.callback_at = sc.scheduled_at
      )
  `);
}

/** Backfill successful CRM transfer records into the telephony transfer view. */
export async function reconcileCampaignTransfers(campaignId: number): Promise<void> {
  await db.execute(sql`
    insert into call_transfers (
      call_id, user_id, transfer_to, summary, status,
      initiated_at, connected_at, completed_at
    )
    select ce.call_id, c.user_id, lt.transferred_to, lt.summary, 'completed',
           lt.transfer_time, lt.transfer_time, lt.transfer_time
    from lead_transfers lt
    join call_executions ce on ce.id = lt.call_execution_id
    join calls c on c.id = ce.call_id
    where lt.campaign_id = ${campaignId}
      and ce.call_id is not null
      and not exists (
        select 1 from call_transfers ct
        where ct.call_id = ce.call_id and ct.transfer_to = lt.transferred_to
      )
  `);
}

export async function safelyReconcileCampaignTabs(campaignId: number): Promise<void> {
  const results = await Promise.allSettled([
    reconcileCampaignBookings(campaignId),
    reconcileCampaignCallbacks(campaignId),
    reconcileCampaignTransfers(campaignId),
  ]);
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      logger.warn({ campaignId, area: ["bookings", "callbacks", "transfers"][index], err: result.reason }, "Campaign tab reconciliation failed");
    }
  });
}
