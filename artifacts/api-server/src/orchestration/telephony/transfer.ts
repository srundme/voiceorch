/**
 * Call Transfer helpers — Twilio, Plivo, VoBiz
 *
 * Each provider exposes a REST endpoint to redirect a live call to a new
 * XML/TwiML URL that returns a <Dial> instruction.
 */

import { logger } from "../../lib/logger.js";

export type TransferType = "warm" | "cold";

// ── VoBiz ────────────────────────────────────────────────────────────────────

/**
 * Calls VoBiz REST API to redirect the active call to a new XML URL.
 * POST https://api.vobiz.ai/api/v1/Account/{auth_id}/Call/{call_uuid}/
 *
 * NOTE: The correct endpoint is /Call/{uuid}/ (no /Transfer/ suffix).
 * VoBiz docs: https://docs.vobiz.ai/call/transfer-call
 */
export async function transferVobizCall(opts: {
  authId: string;
  authToken: string;
  callUuid: string;
  xmlUrl: string;
}): Promise<void> {
  // VoBiz Transfer API: POST /api/v1/Account/{auth_id}/Call/{call_uuid}/
  // (no /Transfer/ suffix — that path 404s)
  const url = `https://api.vobiz.ai/api/v1/Account/${opts.authId}/Call/${opts.callUuid}/`;
  // VoBiz uses custom X-Auth-ID / X-Auth-Token headers (same as its dial API),
  // NOT standard HTTP Basic auth.  Sending Basic auth causes an immediate 401.
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "X-Auth-ID":    opts.authId,
      "X-Auth-Token": opts.authToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ legs: "aleg", aleg_url: opts.xmlUrl, aleg_method: "GET" }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`VoBiz transfer API error ${resp.status}: ${text}`);
  logger.info({ callUuid: opts.callUuid, xmlUrl: opts.xmlUrl }, "VoBiz transfer initiated");
}

/**
 * VoBiz cold transfer XML — dials the target number.
 * VoBiz (Plivo-compatible) requires <Number> inside <Dial>;
 * bare <Dial>NUMBER</Dial> is Twilio syntax and causes VoBiz to drop the call.
 */
export function buildTransferXml(target: string): string {
  const e = xmlEscape(normalizePhone(target));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Dial>\n    <Number>${e}</Number>\n  </Dial>\n</Response>`;
}

/**
 * Warm transfer XML for VoBiz/Plivo — dials the operator and plays a briefing
 * (fetched from whisperUrl) to the operator only before bridging both legs.
 */
export function buildVobizWarmTransferXml(target: string, whisperUrl: string): string {
  const e = xmlEscape(normalizePhone(target));
  const w = xmlEscape(whisperUrl);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Dial>\n    <Number url="${w}" method="GET">${e}</Number>\n  </Dial>\n</Response>`;
}

// ── Twilio ───────────────────────────────────────────────────────────────────

/**
 * Redirect a live Twilio call to a new TwiML URL.
 * POST /2010-04-01/Accounts/{accountSid}/Calls/{callSid}.json  Url=<url>
 */
export async function transferTwilioCall(opts: {
  accountSid: string;
  authToken: string;
  callSid: string;
  xmlUrl: string;
}): Promise<void> {
  const url   = `https://api.twilio.com/2010-04-01/Accounts/${opts.accountSid}/Calls/${opts.callSid}.json`;
  const creds = Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString("base64");
  const body  = new URLSearchParams({ Url: opts.xmlUrl, Method: "GET" });
  const resp  = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Twilio transfer API error ${resp.status}: ${text}`);
  logger.info({ callSid: opts.callSid, xmlUrl: opts.xmlUrl }, "Twilio transfer initiated");
}

/** TwiML response that dials the target number. */
export function buildTwilioTransferTwiML(target: string): string {
  const e = xmlEscape(normalizePhone(target));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Dial>${e}</Dial>\n</Response>`;
}

/**
 * Warm transfer TwiML for Twilio — dials the operator and plays a briefing
 * (fetched from whisperUrl) to the operator only before bridging both legs.
 * Twilio fetches whisperUrl when the <Number> destination answers.
 */
export function buildTwilioWarmTransferTwiML(target: string, whisperUrl: string): string {
  const e = xmlEscape(normalizePhone(target));
  const w = xmlEscape(whisperUrl);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Dial>\n    <Number url="${w}" method="GET">${e}</Number>\n  </Dial>\n</Response>`;
}

// ── Plivo ────────────────────────────────────────────────────────────────────

/**
 * Redirect a live Plivo call to a new answer URL.
 * POST /v1/Account/{authId}/Call/{callUuid}/Transfer/
 */
export async function transferPlivoCall(opts: {
  authId: string;
  authToken: string;
  callUuid: string;
  xmlUrl: string;
}): Promise<void> {
  const url   = `https://api.plivo.com/v1/Account/${opts.authId}/Call/${opts.callUuid}/Transfer/`;
  const creds = Buffer.from(`${opts.authId}:${opts.authToken}`).toString("base64");
  const resp  = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/json" },
    body: JSON.stringify({ legs: "aleg", aleg_url: opts.xmlUrl, aleg_method: "GET" }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Plivo transfer API error ${resp.status}: ${text}`);
  logger.info({ callUuid: opts.callUuid, xmlUrl: opts.xmlUrl }, "Plivo transfer initiated");
}

/**
 * Plivo cold transfer XML — dials the target number.
 * Plivo requires <Number> inside <Dial>; bare <Dial>NUMBER</Dial> is Twilio syntax.
 */
export function buildPlivoTransferXml(target: string): string {
  const e = xmlEscape(normalizePhone(target));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Dial>\n    <Number>${e}</Number>\n  </Dial>\n</Response>`;
}

/**
 * Warm transfer XML for Plivo — dials the operator and plays a briefing
 * (fetched from whisperUrl) to the operator only before bridging both legs.
 */
export function buildPlivoWarmTransferXml(target: string, whisperUrl: string): string {
  const e = xmlEscape(normalizePhone(target));
  const w = xmlEscape(whisperUrl);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Dial>\n    <Number url="${w}" method="GET">${e}</Number>\n  </Dial>\n</Response>`;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Normalise a phone number for use in XML or API bodies:
 * strip whitespace and common formatting characters (spaces, dashes, parentheses).
 * Preserves leading + for E.164 numbers.
 */
function normalizePhone(s: string): string {
  return s.replace(/[\s\-().]/g, "");
}
