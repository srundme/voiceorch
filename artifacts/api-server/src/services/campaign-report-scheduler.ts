/**
 * Weekly scheduled campaign analytics report emails.
 * Trigger: report.email.trigger === "schedule" && cron === "weekly_monday"
 */
import { db, campaignReportDefinitionsTable, campaignsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { renderCampaignReport } from "./campaign-report-render.js";
import { sendCampaignReportEmail } from "./campaign-report-email.js";
import { logger } from "../lib/logger.js";

function weekKey(d = new Date()): string {
  const onejan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - onejan.getTime()) / 86400000) + onejan.getUTCDay() + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export async function runScheduledCampaignReports(): Promise<void> {
  const now = new Date();
  // Monday UTC ≈ weekly_monday
  if (now.getUTCDay() !== 1) return;

  const rows = await db
    .select({
      report: campaignReportDefinitionsTable,
      campaignUserId: campaignsTable.userId,
    })
    .from(campaignReportDefinitionsTable)
    .innerJoin(campaignsTable, eq(campaignsTable.id, campaignReportDefinitionsTable.campaignId))
    .where(sql`(${campaignReportDefinitionsTable.email}->>'enabled')::boolean = true
      and ${campaignReportDefinitionsTable.email}->>'trigger' = 'schedule'`);

  const wk = weekKey(now);
  for (const { report, campaignUserId } of rows) {
    const email = report.email;
    if (!email?.enabled || email.trigger !== "schedule") continue;
    const cron = email.cron ?? "weekly_monday";
    if (cron !== "weekly_monday" && cron !== "weekly") continue;
    const recipients = (email.recipients ?? []).filter((e) => e.includes("@"));
    if (!recipients.length) continue;

    const dedupeKey = `campaign_report_sched_${report.id}_${wk}`;
    try {
      const rendered = await renderCampaignReport({ definition: report, days: 7 });
      await sendCampaignReportEmail({
        to: recipients,
        subject: `${rendered.name} — weekly · ${rendered.campaignName}`,
        html: rendered.html,
        campaignId: report.campaignId,
        reportId: report.id,
        userId: campaignUserId,
        dedupeKey,
      });
    } catch (err) {
      logger.warn({ err: String(err), reportId: report.id }, "scheduled campaign report failed");
    }
  }
}
