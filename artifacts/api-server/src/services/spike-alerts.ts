import nodemailer from "nodemailer";
import { logger } from "../lib/logger.js";

function getTransporter() {
  const user = process.env["GMAIL_USER"];
  const pass = process.env["GMAIL_APP_PASSWORD"];
  if (!user || !pass) return null;
  return nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
}

/**
 * Sends a spike alert email to the admin.
 * Returns `true` if the email was sent, `false` if credentials are not configured (skip OK).
 * Throws if credentials are present but the send fails — caller must not mark as notified.
 */
export async function sendSpikeAlertEmail(opts: {
  adminEmail: string;
  userEmail: string | null;
  userClerkId: string;
  callCount: number;
  threshold: number;
}): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    logger.warn("GMAIL_USER or GMAIL_APP_PASSWORD not set — skipping spike alert email");
    return false;
  }

  const subject = `[VoiceOrch] Usage spike detected — ${opts.userEmail ?? opts.userClerkId}`;
  const body = `Usage spike alert

User: ${opts.userEmail ?? opts.userClerkId}
Calls today: ${opts.callCount} (threshold: ${opts.threshold})

This user has exceeded the daily call threshold. You can review or dismiss this alert on the admin Overview page.

—
VoiceOrch Platform Ops`;

  const htmlBody = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  await transporter.sendMail({
    from: process.env["GMAIL_USER"],
    to: opts.adminEmail,
    subject,
    text: body,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">${htmlBody}<hr style="margin-top:24px;border:none;border-top:1px solid #e5e7eb"/><p style="color:#888;font-size:12px;margin-top:12px">Powered by VoiceOrch</p></div>`,
  });

  logger.info({ userClerkId: opts.userClerkId, callCount: opts.callCount }, "Spike alert email sent");
  return true;
}
