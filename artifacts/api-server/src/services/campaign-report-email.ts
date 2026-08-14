/**
 * Email delivery for campaign analytics reports (Brevo HTML).
 */
import { sendBrevoEmail } from "./brevo.js";
import { logger } from "../lib/logger.js";
import { db, platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function sendCampaignReportEmail(opts: {
  to: string[];
  subject: string;
  html: string;
  campaignId: number;
  reportId: number;
  userId?: string;
  dedupeKey?: string;
}): Promise<void> {
  if (opts.dedupeKey) {
    const [existing] = await db
      .select({ key: platformSettingsTable.key })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, opts.dedupeKey))
      .limit(1);
    if (existing) {
      logger.info({ key: opts.dedupeKey }, "campaign-report email skipped (already sent)");
      return;
    }
  }

  for (const to of opts.to) {
    await sendBrevoEmail(to, opts.subject, opts.html, undefined, {
      emailType: "campaign_analytics_report",
      sentBy: opts.userId ?? "system",
    });
  }

  if (opts.dedupeKey) {
    await db
      .insert(platformSettingsTable)
      .values({ key: opts.dedupeKey, value: new Date().toISOString() })
      .onConflictDoUpdate({
        target: platformSettingsTable.key,
        set: { value: new Date().toISOString() },
      })
      .catch(() => {
        /* best-effort */
      });
  }

  logger.info(
    { campaignId: opts.campaignId, reportId: opts.reportId, recipients: opts.to.length },
    "campaign-report email sent",
  );
}

/**
 * Fire batch_complete reports for a campaign (default report only).
 */
export async function maybeSendBatchCompleteReports(opts: {
  campaignId: number;
  batchId: number;
  userId: string;
}): Promise<void> {
  const { db: database, campaignReportDefinitionsTable } = await import("@workspace/db");
  const { and, eq } = await import("drizzle-orm");
  const { renderCampaignReport } = await import("./campaign-report-render.js");

  const reports = await database
    .select()
    .from(campaignReportDefinitionsTable)
    .where(and(
      eq(campaignReportDefinitionsTable.campaignId, opts.campaignId),
      eq(campaignReportDefinitionsTable.isDefault, true),
    ));

  for (const def of reports) {
    const email = def.email;
    if (!email?.enabled || email.trigger !== "batch_complete") continue;
    const recipients = (email.recipients ?? []).filter((e) => e.includes("@"));
    if (!recipients.length) continue;

    const dedupeKey = `campaign_report_batch_${opts.batchId}_report_${def.id}`;
    try {
      const rendered = await renderCampaignReport({
        definition: def,
        batchId: opts.batchId,
        days: 90,
      });
      await sendCampaignReportEmail({
        to: recipients,
        subject: `${rendered.name} — ${rendered.campaignName} (batch complete)`,
        html: rendered.html,
        campaignId: opts.campaignId,
        reportId: def.id,
        userId: opts.userId,
        dedupeKey,
      });
    } catch (err) {
      logger.warn(
        { err: String(err), campaignId: opts.campaignId, batchId: opts.batchId, reportId: def.id },
        "batch_complete report email failed",
      );
    }
  }
}
