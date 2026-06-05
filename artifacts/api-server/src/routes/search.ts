/**
 * Global Search — GET /api/search?q=<query>
 * Searches across: leads, campaigns, batches, bookings, callbacks.
 * Returns up to 5 grouped results per category, each with a deep link URL.
 */

import { Router, type IRouter } from "express";
import { getAuth } from "../lib/auth-compat.js";
import {
  db, campaignsTable, campaignLeadsTable, campaignBatchesTable,
  callBookingsTable, callCallbacksTable,
} from "@workspace/db";
import { eq, and, or, ilike, sql, inArray, isNotNull } from "drizzle-orm";

const router: IRouter = Router();

router.get("/search", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const q = (req.query["q"] as string | undefined)?.trim() ?? "";
  if (q.length < 2) { res.json({ leads: [], campaigns: [], batches: [], bookings: [], callbacks: [] }); return; }

  const like = `%${q}%`;

  // Get user's campaign IDs (needed for filtering owned data)
  const userCampaigns = await db
    .select({ id: campaignsTable.id, name: campaignsTable.name, status: campaignsTable.status, totalLeads: campaignsTable.totalLeads })
    .from(campaignsTable)
    .where(and(eq(campaignsTable.userId, userId), ilike(campaignsTable.name, like)))
    .limit(5);

  const allCampaignIds = await db
    .select({ id: campaignsTable.id })
    .from(campaignsTable)
    .where(eq(campaignsTable.userId, userId));
  const campaignIds = allCampaignIds.map(c => c.id);

  // Parallel queries
  const [leads, batches, bookings, callbacks] = await Promise.all([

    // Leads — search by phone, name, email
    campaignIds.length === 0 ? [] :
    db.select({
      id:           campaignLeadsTable.id,
      campaignId:   campaignLeadsTable.campaignId,
      campaignName: campaignsTable.name,
      phone:        campaignLeadsTable.phone,
      name:         campaignLeadsTable.name,
      email:        campaignLeadsTable.email,
      callStatus:   campaignLeadsTable.callStatus,
      operationalOutcome: campaignLeadsTable.operationalOutcome,
    }).from(campaignLeadsTable)
      .innerJoin(campaignsTable, eq(campaignLeadsTable.campaignId, campaignsTable.id))
      .where(and(
        inArray(campaignLeadsTable.campaignId, campaignIds),
        or(
          ilike(campaignLeadsTable.phone, like),
          ilike(campaignLeadsTable.name, like),
          ilike(campaignLeadsTable.email, like),
        ),
      ))
      .limit(5),

    // Batches — search by name (within user's campaigns)
    campaignIds.length === 0 ? [] :
    db.select({
      id:           campaignBatchesTable.id,
      campaignId:   campaignBatchesTable.campaignId,
      campaignName: campaignsTable.name,
      name:         campaignBatchesTable.name,
      status:       campaignBatchesTable.status,
      totalLeads:   campaignBatchesTable.totalLeads,
    }).from(campaignBatchesTable)
      .innerJoin(campaignsTable, eq(campaignBatchesTable.campaignId, campaignsTable.id))
      .where(and(
        inArray(campaignBatchesTable.campaignId, campaignIds),
        ilike(campaignBatchesTable.name, like),
      ))
      .limit(5),

    // Bookings — join to leads for phone/name search
    campaignIds.length === 0 ? [] :
    db.select({
      id:          callBookingsTable.id,
      leadId:      callBookingsTable.leadId,
      campaignId:  callBookingsTable.campaignId,
      leadName:    campaignLeadsTable.name,
      leadPhone:   campaignLeadsTable.phone,
      meetingStatus: callBookingsTable.meetingStatus,
      meetingTime: callBookingsTable.meetingTime,
      notes:       callBookingsTable.notes,
    }).from(callBookingsTable)
      .innerJoin(campaignLeadsTable, eq(callBookingsTable.leadId, campaignLeadsTable.id))
      .where(and(
        inArray(callBookingsTable.campaignId, campaignIds),
        or(
          ilike(campaignLeadsTable.phone, like),
          ilike(campaignLeadsTable.name, like),
          ilike(callBookingsTable.notes, like),
        ),
      ))
      .limit(5),

    // Callbacks — join to leads for phone/name search
    campaignIds.length === 0 ? [] :
    db.select({
      id:          callCallbacksTable.id,
      leadId:      callCallbacksTable.leadId,
      campaignId:  callCallbacksTable.campaignId,
      leadName:    campaignLeadsTable.name,
      leadPhone:   campaignLeadsTable.phone,
      status:      callCallbacksTable.status,
      reason:      callCallbacksTable.reason,
      callbackAt:  callCallbacksTable.callbackAt,
    }).from(callCallbacksTable)
      .innerJoin(campaignLeadsTable, eq(callCallbacksTable.leadId, campaignLeadsTable.id))
      .where(and(
        inArray(callCallbacksTable.campaignId, campaignIds),
        or(
          ilike(campaignLeadsTable.phone, like),
          ilike(campaignLeadsTable.name, like),
          ilike(callCallbacksTable.reason, like),
        ),
      ))
      .limit(5),
  ]);

  res.json({
    campaigns: userCampaigns.map(c => ({
      id:       c.id,
      title:    c.name,
      subtitle: `${c.totalLeads ?? 0} leads · ${c.status}`,
      url:      `/app/campaigns/${c.id}`,
      type:     "campaign" as const,
    })),

    leads: leads.map(l => ({
      id:       l.id,
      title:    l.name ?? l.phone,
      subtitle: `${l.phone}${l.name ? ` · ${l.campaignName}` : ""}`,
      badge:    l.operationalOutcome,
      url:      `/app/campaigns/${l.campaignId}/leads/${l.id}`,
      type:     "lead" as const,
    })),

    batches: batches.map(b => ({
      id:       b.id,
      title:    b.name,
      subtitle: `${b.campaignName} · ${b.totalLeads ?? 0} leads · ${b.status}`,
      url:      `/app/campaigns/${b.campaignId}/batches/${b.id}`,
      type:     "batch" as const,
    })),

    bookings: bookings.map(b => ({
      id:       b.id,
      title:    b.leadName ?? b.leadPhone ?? "Booking",
      subtitle: b.meetingTime
        ? `Meeting ${new Date(b.meetingTime).toLocaleDateString()} · ${b.meetingStatus}`
        : b.meetingStatus,
      url:      `/app/campaigns/${b.campaignId}/leads/${b.leadId}`,
      type:     "booking" as const,
    })),

    callbacks: callbacks.map(c => ({
      id:       c.id,
      title:    c.leadName ?? c.leadPhone ?? "Callback",
      subtitle: c.reason ?? c.status,
      badge:    c.status,
      url:      `/app/campaigns/${c.campaignId}/leads/${c.leadId}`,
      type:     "callback" as const,
    })),
  });
});

export default router;
