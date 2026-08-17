import { db, platformEmailsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

/**
 * Sends a transactional SMS via Brevo (formerly Sendinblue).
 * Requires BREVO_API_KEY environment variable.
 */
export async function sendBrevoSms(to: string, content: string): Promise<void> {
  const apiKey = process.env["BREVO_API_KEY"];
  if (!apiKey) throw new Error("BREVO_API_KEY is not configured. Add it to the environment secrets.");

  const resp = await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
    method: "POST",
    headers: {
      "api-key":      apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender:    "SnapServe",
      recipient: to,
      content,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    logger.warn({ status: resp.status, to }, `Brevo SMS failed: ${text}`);
    throw new Error(`Brevo SMS error ${resp.status}: ${text}`);
  }

  logger.info({ to }, "Brevo SMS sent");
}

export interface BrevoAttachment {
  /** Base64-encoded file content. */
  content: string;
  /** File name shown in the email (e.g. "invoice.pdf"). */
  name: string;
}

/** Metadata for admin Email Reports (`platform_emails`). */
export interface BrevoEmailMeta {
  emailType: string;
  toUserId?: string | null;
  toName?: string | null;
  sentBy?: string;
  /**
   * When true, caller inserts into `platform_emails` itself (admin compose).
   * Default false — every Brevo send is logged for the email report.
   */
  skipLog?: boolean;
  /** Override platform From (used for white-label partner mail). */
  sender?: { name: string; email: string };
  replyTo?: { name?: string; email: string };
}

async function logPlatformEmail(row: {
  toEmail: string;
  toUserId?: string | null;
  toName?: string | null;
  subject: string;
  htmlBody: string;
  sentBy: string;
  emailType: string;
  status: string;
  errorMessage?: string | null;
}): Promise<void> {
  try {
    await db.insert(platformEmailsTable).values({
      toEmail: row.toEmail,
      toUserId: row.toUserId ?? null,
      toName: row.toName ?? null,
      subject: row.subject,
      htmlBody: row.htmlBody,
      sentBy: row.sentBy,
      emailType: row.emailType,
      status: row.status,
      errorMessage: row.errorMessage ?? null,
    });
  } catch (err) {
    logger.warn({ err, to: row.toEmail, emailType: row.emailType }, "Failed to log platform email");
  }
}

/**
 * Platform From identity for transactional mail.
 *
 * IMPORTANT: Brevo will silently rewrite From to something like
 * `noreply@<id>.brevosend.com` when `snapserve.ai` is not authenticated
 * (DKIM / Brevo code / DMARC) in that Brevo account — even though we always
 * request noreply@snapserve.ai. Authenticate the domain under
 * Brevo → Senders, Domains & Dedicated IPs → Domains.
 */
function brevoSender(): { name: string; email: string } {
  const email = (process.env["BREVO_SENDER_EMAIL"] ?? "noreply@snapserve.ai").trim();
  const name = (process.env["BREVO_SENDER_NAME"] ?? "SnapServe").trim() || "SnapServe";
  return { name, email: email || "noreply@snapserve.ai" };
}

/**
 * Sends a transactional email via Brevo, optionally with file attachments.
 * Requires BREVO_API_KEY environment variable.
 *
 * When `meta` is provided (recommended), the send is written to `platform_emails`
 * for the admin Email Reports page. OTP bodies are redacted before storage.
 */
export async function sendBrevoEmail(
  to: string,
  subject: string,
  htmlBody: string,
  attachments?: BrevoAttachment[],
  meta?: BrevoEmailMeta,
): Promise<void> {
  const apiKey = process.env["BREVO_API_KEY"];
  if (!apiKey) throw new Error("BREVO_API_KEY is not configured. Add it to the environment secrets.");

  const emailType = meta?.emailType ?? "transactional";
  const sentBy = meta?.sentBy ?? "system";
  const shouldLog = !meta?.skipLog;
  const sender = meta?.sender ?? brevoSender();
  const replyTo = meta?.replyTo;
  // Never persist OTP / password-reset HTML (contains one-time codes).
  const logBody =
    emailType === "password_reset"
      ? "<p>[redacted — password reset OTP]</p>"
      : htmlBody;

  let status = "sent";
  let errorMessage: string | null = null;

  try {
    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key":      apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender,
        ...(replyTo?.email ? { replyTo: { email: replyTo.email, name: replyTo.name || sender.name } } : {}),
        to:      [{ email: to }],
        subject,
        htmlContent: htmlBody,
        ...(attachments && attachments.length > 0
          ? { attachment: attachments.map((a) => ({ content: a.content, name: a.name })) }
          : {}),
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.warn({ status: resp.status, to, emailType }, `Brevo email failed: ${text}`);
      status = "failed";
      errorMessage = `Brevo email error ${resp.status}: ${text}`;
      throw new Error(errorMessage);
    }

    logger.info({ to, emailType }, "Brevo email sent");
  } catch (err) {
    status = "failed";
    errorMessage = err instanceof Error ? err.message : String(err);
    if (shouldLog) {
      await logPlatformEmail({
        toEmail: to,
        toUserId: meta?.toUserId,
        toName: meta?.toName,
        subject,
        htmlBody: logBody,
        sentBy,
        emailType,
        status,
        errorMessage,
      });
    }
    throw err;
  }

  if (shouldLog) {
    await logPlatformEmail({
      toEmail: to,
      toUserId: meta?.toUserId,
      toName: meta?.toName,
      subject,
      htmlBody: logBody,
      sentBy,
      emailType,
      status,
      errorMessage: null,
    });
  }
}
