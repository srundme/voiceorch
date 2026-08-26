/** Send booking mail as the connected calendar user (not platform GMAIL_USER). */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/**
 * RFC 2822 message for Gmail API `users.messages.send` `raw` (base64url).
 * From is always the connected Google account — never platform GMAIL_USER.
 */
export function encodeGmailRawMessage(opts: {
  from: string;
  to: string;
  subject: string;
  html: string;
}): string {
  const subjectB64 = Buffer.from(opts.subject, "utf8").toString("base64");
  const mime = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: =?UTF-8?B?${subjectB64}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    opts.html,
  ].join("\r\n");
  return Buffer.from(mime, "utf8").toString("base64url");
}
