/**
 * CRM call-outcome writeback
 * Called fire-and-forget after a call completes.
 * Looks up the campaign lead for the call, checks if it was imported from
 * HubSpot or Zoho, and pushes a note/activity to the matching CRM record.
 *
 * SECURITY: ownership is enforced by verifying crmConnection.userId === call.userId.
 * The call's userId is server-assigned and not user-supplied, so leadData CRM fields
 * cannot be spoofed to access another tenant's OAuth tokens.
 */

import { db, crmConnectionsTable, campaignLeadsTable, callsTable, callBookingsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { pushHubSpotCallOutcome, updateHubSpotContactStatus } from "./hubspot.js";
import { pushZohoCallOutcome, updateZohoContactStatus } from "./zoho.js";

export async function writeCrmCallOutcome(callId: number): Promise<void> {
  try {
    // Fetch the call first — its userId is server-assigned and authoritative
    const [call] = await db.select().from(callsTable).where(eq(callsTable.id, callId));
    if (!call) return;
    const callUserId = call.userId;
    if (!callUserId) return;

    // Find campaign lead linked to this call
    const [lead] = await db.select().from(campaignLeadsTable)
      .where(eq(campaignLeadsTable.callId, callId));

    if (!lead) return; // Not a campaign call

    const leadData = (lead.leadData ?? {}) as Record<string, string>;
    const crmConnectionId = leadData["__crm_connection_id"];
    const crmContactId    = leadData["__crm_contact_id"];
    const crmProvider     = leadData["__crm_provider"];

    if (!crmConnectionId || !crmContactId || !crmProvider) return; // Not a CRM-sourced lead

    const connId = Number(crmConnectionId);
    if (isNaN(connId)) return;

    // SECURITY: verify ownership — connection must belong to the same user as the call.
    // This prevents a malicious leadData payload from accessing another tenant's OAuth tokens.
    const [conn] = await db.select().from(crmConnectionsTable)
      .where(and(
        eq(crmConnectionsTable.id, connId),
        eq(crmConnectionsTable.userId, callUserId),  // tenant isolation
      ));

    if (!conn) {
      logger.warn({ callId, connId, callUserId }, "CRM writeback aborted — connection not found or ownership mismatch");
      return;
    }

    const rawDisp = call.dispositionResult ?? lead.disposition ?? null;
    const disposition = rawDisp == null
      ? null
      : typeof rawDisp === "string"
        ? rawDisp
        : JSON.stringify(rawDisp);

    // Look up any booking created during this call for richer note content
    const [booking] = await db.select().from(callBookingsTable)
      .where(eq(callBookingsTable.callId, callId));
    const bookingDetail = booking
      ? { meetingTime: booking.meetingTime, meetingLink: booking.meetingLink, status: booking.meetingStatus }
      : null;

    const opts = {
      connectionId:    connId,
      contactId:       crmContactId,
      callStatus:      call.status ?? null,
      summary:         call.callSummary ?? null,
      disposition,
      durationSeconds: call.durationSeconds ?? 0,
      recordingUrl:    call.recordingUrl ?? null,
      callAt:          call.createdAt ?? new Date(),
      booking:         bookingDetail,
    };

    if (crmProvider === "hubspot") {
      await pushHubSpotCallOutcome(opts);
    } else if (crmProvider === "zoho") {
      await pushZohoCallOutcome(opts);
    }

    // Optional status-field update
    // fieldMapping.__writeback_status_field = CRM property name (e.g. "hs_lead_status")
    // fieldMapping.__writeback_status_<disposition> = value to write (e.g. "CONVERTED")
    const fieldMapping = (conn.fieldMapping ?? {}) as Record<string, string>;
    const statusField  = fieldMapping["__writeback_status_field"];
    if (statusField && disposition) {
      const statusKey   = `__writeback_status_${disposition.toLowerCase().replace(/[\s-]+/g, "_")}`;
      const statusValue = fieldMapping[statusKey];
      if (statusValue) {
        try {
          if (crmProvider === "hubspot") {
            await updateHubSpotContactStatus({
              connectionId: connId,
              contactId:    crmContactId,
              propertyName: statusField,
              propertyValue: statusValue,
            });
          } else if (crmProvider === "zoho") {
            await updateZohoContactStatus({
              connectionId: connId,
              contactId:    crmContactId,
              fieldName:    statusField,
              fieldValue:   statusValue,
            });
          }
          logger.info({ callId, connId, crmProvider, disposition, statusField, statusValue }, "CRM contact status updated");
        } catch (statusErr) {
          logger.warn({ statusErr, callId, crmProvider }, "CRM status field update failed (note was already created)");
        }
      }
    }

    logger.info({ callId, connId, crmProvider, contactId: crmContactId }, "CRM call outcome written back");
  } catch (err) {
    logger.warn({ err, callId }, "CRM writeback failed (non-fatal)");
  }
}
