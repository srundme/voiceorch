import nodemailer from "nodemailer";
import { db, platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import type { AlertType } from "./usage/alert-engine.js";

const ALERT_EMAIL_KEY = "alert_notification_email";
const ALERT_SLACK_KEY = "alert_slack_webhook_url";
const ALERT_MIN_SEVERITY_KEY = "alert_min_severity";

const SEVERITY_RANK: Record<string, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

function getTransporter() {
  const user = process.env["GMAIL_USER"];
  const pass = process.env["GMAIL_APP_PASSWORD"];
  if (!user || !pass) return null;
  return nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
}

async function getNotificationSettings(): Promise<{
  email: string | null;
  slackWebhook: string | null;
  minSeverity: string;
}> {
  const [emailRow, slackRow, severityRow] = await Promise.all([
    db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, ALERT_EMAIL_KEY))
      .then(([r]) => r),
    db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, ALERT_SLACK_KEY))
      .then(([r]) => r),
    db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, ALERT_MIN_SEVERITY_KEY))
      .then(([r]) => r),
  ]);

  return {
    email: emailRow?.value ?? null,
    slackWebhook: slackRow?.value ?? null,
    minSeverity: severityRow?.value ?? "warning",
  };
}

function formatAlertEmail(opts: {
  type: AlertType;
  severity: string;
  title: string;
  message: string;
  service?: string | null;
  provider?: string | null;
}): { subject: string; text: string; html: string } {
  const severityLabel = opts.severity.toUpperCase();
  const subject = `[VoiceOrch Alert][${severityLabel}] ${opts.title}`;

  const lines = [
    `Alert Severity: ${severityLabel}`,
    `Alert Type:     ${opts.type}`,
    opts.service ? `Service:        ${opts.service.toUpperCase()}` : null,
    opts.provider ? `Provider:       ${opts.provider}` : null,
    ``,
    opts.message,
    ``,
    `—`,
    `VoiceOrch Platform Ops`,
  ].filter((l) => l !== null);

  const text = lines.join("\n");
  const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">
  <div style="margin-bottom:16px">
    <span style="display:inline-block;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:600;background:${opts.severity === "critical" ? "#fee2e2" : "#fef9c3"};color:${opts.severity === "critical" ? "#991b1b" : "#854d0e"}">${severityLabel}</span>
  </div>
  <h2 style="margin:0 0 8px 0;font-size:18px">${opts.title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</h2>
  <p style="color:#555;margin:0 0 16px 0">${opts.message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
  ${opts.service || opts.provider ? `<table style="border-collapse:collapse;font-size:13px;color:#374151">${opts.service ? `<tr><td style="padding:2px 12px 2px 0;color:#6b7280">Service</td><td>${opts.service.toUpperCase()}</td></tr>` : ""}${opts.provider ? `<tr><td style="padding:2px 12px 2px 0;color:#6b7280">Provider</td><td>${opts.provider}</td></tr>` : ""}</table>` : ""}
  <hr style="margin-top:24px;border:none;border-top:1px solid #e5e7eb"/>
  <p style="color:#888;font-size:12px;margin-top:12px">Powered by VoiceOrch — <a href="#" style="color:#888">View in Admin</a></p>
</div>`;

  return { subject, text, html };
}

async function sendSlackNotification(
  webhookUrl: string,
  opts: {
    severity: string;
    title: string;
    message: string;
    service?: string | null;
    provider?: string | null;
  },
): Promise<void> {
  const color = opts.severity === "critical" ? "#ef4444" : opts.severity === "warning" ? "#f59e0b" : "#3b82f6";
  const body = {
    attachments: [
      {
        color,
        title: `[${opts.severity.toUpperCase()}] ${opts.title}`,
        text: opts.message,
        fields: [
          opts.service ? { title: "Service", value: opts.service.toUpperCase(), short: true } : null,
          opts.provider ? { title: "Provider", value: opts.provider, short: true } : null,
        ].filter(Boolean),
        footer: "VoiceOrch Alert Engine",
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Slack webhook responded with ${res.status}`);
  }
}

/**
 * Dispatches email and/or Slack notifications for a newly-fired alert.
 * Best-effort: never throws — caller must not block on this.
 */
export async function dispatchAlertNotification(opts: {
  type: AlertType;
  severity: string;
  title: string;
  message: string;
  service?: string | null;
  provider?: string | null;
}): Promise<void> {
  try {
    const settings = await getNotificationSettings();

    const minRank = SEVERITY_RANK[settings.minSeverity] ?? 1;
    const alertRank = SEVERITY_RANK[opts.severity] ?? 0;
    if (alertRank < minRank) return;

    const { subject, text, html } = formatAlertEmail(opts);

    const emailP = settings.email
      ? (async () => {
          const transporter = getTransporter();
          if (!transporter) {
            logger.warn("GMAIL_USER or GMAIL_APP_PASSWORD not set — skipping alert email");
            return;
          }
          await transporter.sendMail({
            from: process.env["GMAIL_USER"],
            to: settings.email!,
            subject,
            text,
            html,
          });
          logger.info({ severity: opts.severity, type: opts.type, to: settings.email }, "Alert email sent");
        })().catch((err) => logger.warn({ err, type: opts.type }, "Alert email send failed"))
      : Promise.resolve();

    const slackP = settings.slackWebhook
      ? sendSlackNotification(settings.slackWebhook, opts).catch((err) =>
          logger.warn({ err, type: opts.type }, "Alert Slack notification failed"),
        )
      : Promise.resolve();

    await Promise.all([emailP, slackP]);
  } catch (err) {
    logger.warn({ err, type: opts.type }, "dispatchAlertNotification unexpected error");
  }
}
