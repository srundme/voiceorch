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
  /** Max call duration in seconds. Twilio hangs up at this limit. */
  maxDurationSeconds?: number;
  /** AMD — omit to disable */
  machineDetection?: "Enable" | "DetectMessageEnd";
  machineDetectionUrl?: string;
  /** Recording */
  recordingEnabled?: boolean;
  recordingStatusCallbackUrl?: string;
}): Promise<string> {
  const url   = `https://api.twilio.com/2010-04-01/Accounts/${opts.accountSid}/Calls.json`;
  const creds = Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString("base64");
  const body  = new URLSearchParams({
    To: opts.toNumber, From: opts.fromNumber,
    Url: opts.webhookUrl, StatusCallback: opts.statusCallbackUrl,
    StatusCallbackMethod: "POST",
  });
  if (opts.maxDurationSeconds && opts.maxDurationSeconds > 0) {
    body.append("TimeLimit", String(Math.floor(opts.maxDurationSeconds)));
  }
  if (opts.machineDetection) {
    body.append("MachineDetection", opts.machineDetection);
    if (opts.machineDetectionUrl) body.append("MachineDetectionUrl", opts.machineDetectionUrl);
  }
  if (opts.recordingEnabled) {
    body.append("Record", "true");
    if (opts.recordingStatusCallbackUrl) body.append("RecordingStatusCallback", opts.recordingStatusCallbackUrl);
    body.append("RecordingStatusCallbackMethod", "POST");
  }
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
  /** Max call duration in seconds. Plivo hangs up at this limit. */
  maxDurationSeconds?: number;
  /** AMD — omit to disable */
  machineDetectionEnabled?: boolean;
  machineDetectionUrl?: string;
}): Promise<string> {
  const url   = `https://api.plivo.com/v1/Account/${opts.authId}/Call/`;
  const creds = Buffer.from(`${opts.authId}:${opts.authToken}`).toString("base64");
  const callBody: Record<string, string | boolean | number> = {
    to: opts.toNumber, from: opts.fromNumber,
    answer_url: opts.answerUrl, answer_method: "POST",
  };
  if (opts.maxDurationSeconds && opts.maxDurationSeconds > 0) {
    callBody["time_limit"] = Math.floor(opts.maxDurationSeconds);
  }
  if (opts.machineDetectionEnabled) {
    callBody["machine_detection"] = "enable";
    if (opts.machineDetectionUrl) callBody["machine_detection_url"] = opts.machineDetectionUrl;
  }
  const resp  = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/json" },
    body: JSON.stringify(callBody),
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
  /** Max call duration in seconds. Vobiz hangs up at this limit (time_limit param). */
  maxDurationSeconds?: number;
  /** P2-B: AMD options — omit to disable machine detection */
  machineDetection?: "Enable" | "DetectMessageEnd";
  machineDetectionUrl?: string;
}): Promise<string> {
  const url  = `https://api.vobiz.ai/api/v1/Account/${opts.authId}/Call/`;
  const body: Record<string, string> = {
    to: opts.toNumber, from: opts.fromNumber,
    answer_url: opts.answerUrl, hangup_url: opts.hangupUrl,
  };
  if (opts.maxDurationSeconds && opts.maxDurationSeconds > 0) {
    body["time_limit"] = String(Math.floor(opts.maxDurationSeconds));
  }
  if (opts.machineDetection) {
    body["machine_detection"]        = opts.machineDetection;
    body["machine_detection_method"] = "POST";
    if (opts.machineDetectionUrl) {
      body["machine_detection_url"] = opts.machineDetectionUrl;
    }
  }
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "X-Auth-ID": opts.authId, "X-Auth-Token": opts.authToken,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Vobiz API error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json() as { call_uuid?: string; request_uuid?: string };
  return data.call_uuid ?? data.request_uuid ?? "unknown";
}
