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
 *
 * We always use legs:"aleg" because the CallUUID stored in params.externalCallId
 * is always the A-leg UUID from VoBiz's perspective (it comes from the answer
 * webhook's CallUUID param for both inbound and outbound calls).
 */
export async function transferVobizCall(opts: {
  authId: string;
  authToken: string;
  callUuid: string;
  xmlUrl: string;
  callDirection?: "inbound" | "outbound";
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
  // Log the response body (capped) so we can see whether VoBiz accepted the warm-transfer
  // XML — in particular whether it honours the <Number url="…"> operator-whisper attribute.
  // Redact the capability token from the logged URL so it never lands in logs.
  const redactedXmlUrl = opts.xmlUrl.replace(/([?&]token=)[^&]*/gi, "$1REDACTED");
  logger.info(
    { callUuid: opts.callUuid, xmlUrl: redactedXmlUrl, status: resp.status, response: text.slice(0, 500) },
    "VoBiz transfer initiated",
  );
}

/**
 * VoBiz cold transfer XML — dials the target number.
 * VoBiz (Plivo-compatible) requires <Number> inside <Dial>;
 * bare <Dial>NUMBER</Dial> is Twilio syntax and causes VoBiz to drop the call.
 */
export function buildTransferXml(target: string, callerId?: string): string {
  const e = xmlEscape(normalizePhone(target));
  // VoBiz requires a callerId on <Dial> for the outbound bridge to the human
  // agent — it must be a VoBiz-provisioned number on the account (our platform
  // number).  Without it the outbound dial is rejected and the caller is dropped.
  const c = callerId ? ` callerId="${xmlEscape(normalizePhone(callerId))}"` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Dial${c}>\n    <Number>${e}</Number>\n  </Dial>\n</Response>`;
}

/**
 * Warm transfer XML for VoBiz/Plivo — dials the operator and plays a briefing
 * (fetched from whisperUrl) to the operator only before bridging both legs.
 */
export function buildVobizWarmTransferXml(target: string, whisperUrl: string, callerId?: string): string {
  const e = xmlEscape(normalizePhone(target));
  const w = xmlEscape(whisperUrl);
  const c = callerId ? ` callerId="${xmlEscape(normalizePhone(callerId))}"` : "";
  // VoBiz is Plivo-compatible. The per-<Number> `url` attribute is a TWILIO-ONLY
  // whisper convention that Plivo/VoBiz silently IGNORE — which is exactly why the
  // operator was being bridged with NO briefing. The Plivo-standard operator whisper
  // is the `confirmSound` attribute on <Dial>: the provider fetches that URL when the
  // operator answers and plays the returned <Speak> to the OPERATOR ONLY, then bridges
  // the caller automatically. We deliberately omit `confirmKey` so no DTMF acceptance
  // is required (a missing confirmKey ⇒ auto-connect after the sound, per Plivo XML).
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Dial${c} confirmSound="${w}">\n    <Number>${e}</Number>\n  </Dial>\n</Response>`;
}

/** Stable VoBiz conference name — alphanumeric, case-sensitive, no spaces. */
export function vobizMergeRoom(callId: number, transferId: number): string {
  return `ssmerge${callId}t${transferId}`;
}

/**
 * Customer joins first and waits (hold XML) until sales starts the room.
 * stayAlone so they are not dropped before sales answers.
 * endConferenceOnExit=false so kicking/hanging the AI stream later does not
 * tear down customer+sales (the AI is not a conference member anyway).
 */
export function buildVobizMergeCustomerXml(opts: {
  room: string;
  waitSoundUrl: string;
  callbackUrl: string;
}): string {
  const room = xmlEscape(opts.room);
  const wait = xmlEscape(opts.waitSoundUrl);
  const cb = xmlEscape(opts.callbackUrl);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Conference startConferenceOnEnter="false" stayAlone="true" endConferenceOnExit="false" timeLimit="3600" waitSound="${wait}" callbackUrl="${cb}" callbackMethod="POST">${room}</Conference>
</Response>`;
}

/** Sales answers and starts the conference so the waiting customer is bridged. */
export function buildVobizMergeSalesXml(opts: {
  room: string;
  callbackUrl: string;
}): string {
  const room = xmlEscape(opts.room);
  const cb = xmlEscape(opts.callbackUrl);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Conference startConferenceOnEnter="true" stayAlone="true" endConferenceOnExit="false" timeLimit="3600" callbackUrl="${cb}" callbackMethod="POST">${room}</Conference>
</Response>`;
}

export function buildVobizMergeWaitXml(holdText = "Please hold while we connect you with a specialist."): string {
  const t = xmlEscape(holdText);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak loop="0">${t}</Speak>
</Response>`;
}

/** Play TTS to every conference member (VoBiz has no room-wide Speak — use member_id=all). */
export async function speakVobizConference(opts: {
  authId: string;
  authToken: string;
  room: string;
  text: string;
}): Promise<void> {
  const room = encodeURIComponent(opts.room);
  const url = `https://api.vobiz.ai/api/v1/Account/${opts.authId}/Conference/${room}/Member/all/Speak/`;
  const text = opts.text.slice(0, 800);
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "X-Auth-ID": opts.authId,
      "X-Auth-Token": opts.authToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, voice: "WOMAN", language: "en-US" }),
  });
  const body = await resp.text();
  if (!resp.ok) throw new Error(`VoBiz conference Speak ${resp.status}: ${body}`);
  logger.info({ room: opts.room, status: resp.status }, "VoBiz merge: intro spoken into conference");
}

export async function hangupVobizCall(opts: {
  authId: string;
  authToken: string;
  callUuid: string;
}): Promise<void> {
  const url = `https://api.vobiz.ai/api/v1/Account/${opts.authId}/Call/${opts.callUuid}/`;
  const resp = await fetch(url, {
    method: "DELETE",
    headers: {
      "X-Auth-ID": opts.authId,
      "X-Auth-Token": opts.authToken,
    },
  });
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`VoBiz hangup ${resp.status}: ${await resp.text()}`);
  }
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
  // Same root-cause fix as VoBiz: <Number url="…"> is a Twilio-only whisper and is
  // silently ignored by Plivo. The Plivo-standard operator whisper is `confirmSound`
  // on <Dial>, which plays to the operator only then auto-bridges (no `confirmKey`).
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Dial confirmSound="${w}">\n    <Number>${e}</Number>\n  </Dial>\n</Response>`;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  // Escapes both element text AND attribute values (callerId is query-derived and
  // lands in a `callerId="..."` attribute, so quotes must be escaped too).
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Normalise a phone number for use in XML or API bodies:
 * strip whitespace and common formatting characters (spaces, dashes, parentheses).
 * Preserves leading + for E.164 numbers.
 */
function normalizePhone(s: string): string {
  return s.replace(/[\s\-().]/g, "");
}
