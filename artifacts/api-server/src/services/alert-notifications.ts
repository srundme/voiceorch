import nodemailer from "nodemailer";
import { db, platformSettingsTable, alertNotificationLogTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import type { AlertType } from "./usage/alert-engine.js";

const ALERT_EMAIL_KEY = "alert_notification_email";
const ALERT_SLACK_KEY = "alert_slack_webhook_url";
const ALERT_MIN_SEVERITY_KEY = "alert_min_severity";
const ALERT_COOLDOWN_KEY = "alert_notification_cooldown_minutes";
const ALERT_LAST_NOTIFIED_AT_KEY = "alert_last_notified_at";
const ALERT_LAST_NOTIFIED_SEVERITY_KEY = "alert_last_notified_severity";
const DEFAULT_COOLDOWN_MINUTES = 10;

/**
 * In-process cooldown state. Seeded from DB on first dispatch (lazy, one-time).
 * Always holds the most recent known timestamp regardless of DB write success.
 */
let _lastNotifiedAt: number | null = null;
/** Severity of the most recently dispatched notification. Used to detect severity escalation. */
let _lastNotifiedSeverity: string | null = null;
/** Whether we've loaded persisted cooldown state from the DB yet. */
let _cooldownStateLoaded = false;

/** Count of notifications suppressed by the cooldown rate limiter since last reset. */
let _suppressedCount = 0;

/** Returns current cooldown stats (suppressed count + when the cooldown window expires). */
export function getAlertCooldownStats(): { suppressedCount: number; cooldownExpiresAt: number | null } {
  return {
    suppressedCount: _suppressedCount,
    cooldownExpiresAt: _lastNotifiedAt !== null ? _lastNotifiedAt + DEFAULT_COOLDOWN_MINUTES * 60 * 1000 : null,
  };
}

/** Resets the suppressed-notification counter. */
export function resetAlertSuppressedCount(): void {
  _suppressedCount = 0;
}

/** @internal Reset in-process cooldown state. Used in unit tests only. */
export function __resetCooldownState(): void {
  _lastNotifiedAt = null;
  _lastNotifiedSeverity = null;
  _suppressedCount = 0;
}

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
  cooldownMinutes: number;
}> {
  const [emailRow, slackRow, severityRow, cooldownRow] = await Promise.all([
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
    db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, ALERT_COOLDOWN_KEY))
      .then(([r]) => r),
  ]);

  const parsedCooldown = cooldownRow?.value ? parseInt(cooldownRow.value, 10) : NaN;
  return {
    email: emailRow?.value ?? null,
    slackWebhook: slackRow?.value ?? null,
    minSeverity: severityRow?.value ?? "warning",
    cooldownMinutes: Number.isFinite(parsedCooldown) && parsedCooldown >= 0 ? parsedCooldown : DEFAULT_COOLDOWN_MINUTES,
  };
}

/**
 * Loads persisted cooldown state from the DB into in-process variables.
 * Called lazily on the first dispatch attempt so restarts pick up where they left off.
 */
async function loadCooldownState(): Promise<void> {
  if (_cooldownStateLoaded) return;
  _cooldownStateLoaded = true;

  try {
    const [atRow, severityRow] = await Promise.all([
      db
        .select({ value: platformSettingsTable.value })
        .from(platformSettingsTable)
        .where(eq(platformSettingsTable.key, ALERT_LAST_NOTIFIED_AT_KEY))
        .then(([r]) => r),
      db
        .select({ value: platformSettingsTable.value })
        .from(platformSettingsTable)
        .where(eq(platformSettingsTable.key, ALERT_LAST_NOTIFIED_SEVERITY_KEY))
        .then(([r]) => r),
    ]);

    if (atRow?.value) {
      const parsed = parseInt(atRow.value, 10);
      if (Number.isFinite(parsed)) {
        _lastNotifiedAt = parsed;
      }
    }
    if (severityRow?.value) {
      _lastNotifiedSeverity = severityRow.value;
    }

    logger.info(
      { lastNotifiedAt: _lastNotifiedAt, lastNotifiedSeverity: _lastNotifiedSeverity },
      "Alert cooldown state loaded from DB",
    );
  } catch (err) {
    logger.warn({ err }, "Failed to load alert cooldown state from DB — starting fresh");
  }
}

/**
 * Persists the current cooldown state to the DB so it survives server restarts.
 */
async function persistCooldownState(lastNotifiedAt: number, lastNotifiedSeverity: string): Promise<void> {
  await Promise.all([
    db
      .insert(platformSettingsTable)
      .values({ key: ALERT_LAST_NOTIFIED_AT_KEY, value: String(lastNotifiedAt) })
      .onConflictDoUpdate({
        target: platformSettingsTable.key,
        set: { value: String(lastNotifiedAt), updatedAt: sql`now()` },
      }),
    db
      .insert(platformSettingsTable)
      .values({ key: ALERT_LAST_NOTIFIED_SEVERITY_KEY, value: lastNotifiedSeverity })
      .onConflictDoUpdate({
        target: platformSettingsTable.key,
        set: { value: lastNotifiedSeverity, updatedAt: sql`now()` },
      }),
  ]);
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

async function logDelivery(channel: "email" | "slack", status: "sent" | "failed", alertId?: number | null, errorMessage?: string): Promise<void> {
  try {
    await db.insert(alertNotificationLogTable).values({
      alertId: alertId ?? null,
      channel,
      status,
      errorMessage: errorMessage ?? null,
    });
  } catch (err) {
    logger.warn({ err }, "Failed to write alert_notification_log entry");
  }
}

/**
 * Sends a synthetic test notification to all configured channels.
 * Unlike dispatchAlertNotification, this bypasses severity filtering and throws on failure.
 * Returns a summary of what was attempted.
 */
export async function sendTestAlertNotification(): Promise<{ email: boolean; slack: boolean }> {
  const settings = await getNotificationSettings();

  const testOpts = {
    type: "test" as AlertType,
    severity: "info",
    title: "Test Notification",
    message: "This is a test notification from VoiceOrch. Your alert notification setup is working correctly.",
    service: null,
    provider: null,
  };

  const { subject, text, html } = formatAlertEmail(testOpts);

  let emailSent = false;
  let slackSent = false;

  if (settings.email) {
    const transporter = getTransporter();
    if (!transporter) {
      throw new Error("GMAIL_USER or GMAIL_APP_PASSWORD env vars are not set — cannot send test email");
    }
    await transporter.sendMail({
      from: process.env["GMAIL_USER"],
      to: settings.email,
      subject,
      text,
      html,
    });
    logger.info({ to: settings.email }, "Test alert email sent");
    emailSent = true;
  }

  if (settings.slackWebhook) {
    await sendSlackNotification(settings.slackWebhook, testOpts);
    logger.info("Test alert Slack notification sent");
    slackSent = true;
  }

  return { email: emailSent, slack: slackSent };
}

/**
 * Dispatches email and/or Slack notifications for a newly-fired alert.
 * Best-effort: never throws — caller must not block on this.
 *
 * Rate-limited by `alert_notification_cooldown_minutes` platform setting (default 10 min).
 * At most one notification batch is dispatched within the cooldown window regardless of
 * how many alerts fire simultaneously (prevents inbox flooding during outages).
 * Exception: if the new alert has higher severity than the last dispatched one, the cooldown
 * is bypassed so critical escalations are never silenced.
 * Logs each delivery attempt (sent / failed) to alert_notification_log.
 *
 * Cooldown state (`last_notified_at`, `last_notified_severity`) is persisted to the
 * `platform_settings` table so a server restart does not reset the rate limiter.
 */
export async function dispatchAlertNotification(opts: {
  type: AlertType;
  severity: string;
  title: string;
  message: string;
  service?: string | null;
  provider?: string | null;
  alertId?: number | null;
}): Promise<void> {
  try {
    await loadCooldownState();

    const settings = await getNotificationSettings();

    const minRank = SEVERITY_RANK[settings.minSeverity] ?? 1;
    const alertRank = SEVERITY_RANK[opts.severity] ?? 0;
    if (alertRank < minRank) return;

    const cooldownMs = settings.cooldownMinutes * 60 * 1000;
    if (cooldownMs > 0 && _lastNotifiedAt !== null) {
      const elapsed = Date.now() - _lastNotifiedAt;
      if (elapsed < cooldownMs) {
        const lastRank = SEVERITY_RANK[_lastNotifiedSeverity ?? ""] ?? -1;
        const isEscalation = alertRank > lastRank;
        if (!isEscalation) {
          _suppressedCount++;
          logger.info(
            { type: opts.type, elapsedMs: elapsed, cooldownMs, severity: opts.severity, lastSeverity: _lastNotifiedSeverity, suppressedCount: _suppressedCount },
            "Alert notification suppressed by cooldown rate limit",
          );
          return;
        }
        logger.info(
          { type: opts.type, severity: opts.severity, lastSeverity: _lastNotifiedSeverity },
          "Alert severity escalated — bypassing cooldown and dispatching immediately",
        );
      }
    }

    const { subject, text, html } = formatAlertEmail(opts);

    let emailSent = false;
    let slackSent = false;

    const emailP = settings.email
      ? (async () => {
          const transporter = getTransporter();
          if (!transporter) {
            logger.warn("GMAIL_USER or GMAIL_APP_PASSWORD not set — skipping alert email");
            await logDelivery("email", "failed", opts.alertId, "GMAIL_USER or GMAIL_APP_PASSWORD not configured");
            return;
          }
          try {
            await transporter.sendMail({
              from: process.env["GMAIL_USER"],
              to: settings.email!,
              subject,
              text,
              html,
            });
            emailSent = true;
            logger.info({ severity: opts.severity, type: opts.type, to: settings.email }, "Alert email sent");
            await logDelivery("email", "sent", opts.alertId);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn({ err, type: opts.type }, "Alert email send failed");
            await logDelivery("email", "failed", opts.alertId, msg);
          }
        })()
      : Promise.resolve();

    const slackP = settings.slackWebhook
      ? (async () => {
          try {
            await sendSlackNotification(settings.slackWebhook!, opts);
            slackSent = true;
            await logDelivery("slack", "sent", opts.alertId);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn({ err, type: opts.type }, "Alert Slack notification failed");
            await logDelivery("slack", "failed", opts.alertId, msg);
          }
        })()
      : Promise.resolve();

    await Promise.all([emailP, slackP]);

    const channelsConfigured = Boolean(settings.email) || Boolean(settings.slackWebhook);
    if (!channelsConfigured || emailSent || slackSent) {
      const notifiedAt = Date.now();
      _lastNotifiedAt = notifiedAt;
      _lastNotifiedSeverity = opts.severity;
      persistCooldownState(notifiedAt, opts.severity).catch((err) =>
        logger.warn({ err }, "Failed to persist alert cooldown state to DB"),
      );
    }
  } catch (err) {
    logger.warn({ err, type: opts.type }, "dispatchAlertNotification unexpected error");
  }
}
