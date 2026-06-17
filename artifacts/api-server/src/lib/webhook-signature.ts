/**
 * Webhook signature validation for telephony providers.
 *
 * Twilio:  HMAC-SHA1 of (url + sorted POST params) using the account auth token.
 *          Ref: https://www.twilio.com/docs/usage/webhooks/webhooks-security
 *
 * Plivo v2: HMAC-SHA256 of (nonce + uri) using the auth token.
 *           Ref: https://www.plivo.com/docs/sms/api/message/receiving-messages/#validate-signature
 *
 * VoBiz: No standard webhook signature scheme — skipped.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Reconstruct the full URL that Twilio used when signing the request.
 * Must match exactly what Twilio computed (scheme + host + path + sorted-query).
 */
export function buildWebhookUrl(
  proto: string,
  host: string,
  path: string,
  query: Record<string, string | string[] | undefined>,
): string {
  const base = `${proto}://${host}${path}`;
  const params = Object.entries(query)
    .flatMap(([k, v]) =>
      Array.isArray(v)
        ? v.map((val) => [k, val] as [string, string])
        : v !== undefined
        ? [[k, v] as [string, string]]
        : [],
    )
    .sort(([a], [b]) => a.localeCompare(b));
  if (params.length === 0) return base;
  return base + "?" + params.map(([k, v]) => `${k}=${v}`).join("&");
}

/**
 * Validate a Twilio webhook signature.
 *
 * @param authToken  The Twilio account auth token (raw, not encrypted).
 * @param url        The full URL Twilio posted to (no query string for POST).
 * @param bodyParams The parsed POST body parameters (url-encoded body).
 * @param signature  The value of the X-Twilio-Signature header.
 */
export function validateTwilioSignature(
  authToken: string,
  url: string,
  bodyParams: Record<string, string>,
  signature: string,
): boolean {
  if (!authToken || !signature) return false;
  // Concatenate url + sorted body params (key immediately followed by value, no separator)
  const sorted = Object.entries(bodyParams).sort(([a], [b]) => a.localeCompare(b));
  const data = url + sorted.map(([k, v]) => `${k}${v}`).join("");
  const expected = createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

/**
 * Validate a Plivo v2 webhook signature.
 *
 * @param authToken  The Plivo auth token.
 * @param nonce      Value of X-Plivo-Signature-V2-Nonce header.
 * @param uri        The request URI (path only, no scheme/host).
 * @param signature  Value of X-Plivo-Signature-V2 header.
 */
export function validatePlivoSignature(
  authToken: string,
  nonce: string,
  uri: string,
  signature: string,
): boolean {
  if (!authToken || !nonce || !signature) return false;
  const data = nonce + uri;
  const expected = createHmac("sha256", authToken).update(data, "utf8").digest("base64");
  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}
