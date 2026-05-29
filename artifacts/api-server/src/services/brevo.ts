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
