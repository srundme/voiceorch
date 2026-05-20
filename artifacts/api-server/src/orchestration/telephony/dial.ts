/**
 * Telephony dial helpers — shared between the outbound call route and the
 * callback scheduler so neither duplicates the API call logic.
 */

export async function dialTwilio(opts: {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  toNumber: string;
  webhookUrl: string;
  statusCallbackUrl: string;
}): Promise<string> {
  const url   = `https://api.twilio.com/2010-04-01/Accounts/${opts.accountSid}/Calls.json`;
  const creds = Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString("base64");
  const body  = new URLSearchParams({
    To: opts.toNumber, From: opts.fromNumber,
    Url: opts.webhookUrl, StatusCallback: opts.statusCallbackUrl,
    StatusCallbackMethod: "POST",
  });
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) throw new Error(`Twilio API error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json() as { sid: string };
  return data.sid;
}

export async function dialPlivo(opts: {
  authId: string;
  authToken: string;
  fromNumber: string;
  toNumber: string;
  answerUrl: string;
}): Promise<string> {
  const url   = `https://api.plivo.com/v1/Account/${opts.authId}/Call/`;
  const creds = Buffer.from(`${opts.authId}:${opts.authToken}`).toString("base64");
  const resp  = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to: opts.toNumber, from: opts.fromNumber, answer_url: opts.answerUrl, answer_method: "POST" }),
  });
  if (!resp.ok) throw new Error(`Plivo API error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json() as { request_uuid: string };
  return data.request_uuid;
}

export async function dialVobiz(opts: {
  authId: string;
  authToken: string;
  fromNumber: string;
  toNumber: string;
  answerUrl: string;
  hangupUrl: string;
}): Promise<string> {
  const url  = `https://api.vobiz.ai/api/v1/Account/${opts.authId}/Call/`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "X-Auth-ID": opts.authId, "X-Auth-Token": opts.authToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: opts.toNumber, from: opts.fromNumber,
      answer_url: opts.answerUrl, hangup_url: opts.hangupUrl,
    }),
  });
  if (!resp.ok) throw new Error(`Vobiz API error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json() as { call_uuid?: string; request_uuid?: string };
  return data.call_uuid ?? data.request_uuid ?? "unknown";
}
