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

/**
 * Sends a transactional email via Brevo, optionally with file attachments.
 * Requires BREVO_API_KEY environment variable.
 */
export async function sendBrevoEmail(
  to: string,
  subject: string,
  htmlBody: string,
  attachments?: BrevoAttachment[],
): Promise<void> {
  const apiKey = process.env["BREVO_API_KEY"];
  if (!apiKey) throw new Error("BREVO_API_KEY is not configured. Add it to the environment secrets.");

  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key":      apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender:  { name: "SnapServe", email: "noreply@snapserve.ai" },
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
    logger.warn({ status: resp.status, to }, `Brevo email failed: ${text}`);
    throw new Error(`Brevo email error ${resp.status}: ${text}`);
  }

  logger.info({ to }, "Brevo email sent");
}
