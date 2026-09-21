/**
 * Telephony dial helpers — shared between the outbound call route and the
 * callback scheduler so neither duplicates the API call logic.
 */

import { logger } from "../../lib/logger.js";

/**
 * Resolve whether AMD (answering-machine / voicemail detection) is enabled for
 * an agent and, for Twilio, which synchronous detection mode to request.
 *
 * The dashboard writes the voicemail config in two different shapes:
 *   • assistants.tsx  → `voicemailDetection: boolean` + `machineDetectionMode: "Enable" | "DetectMessageEnd"`
 *   • builder.tsx / edit.tsx → `machineDetectionMode: "disabled" | "enable" | "detect_message_end"` (no bool)
 * This helper normalises both so every outbound path enables AMD consistently.
 */
export function resolveAmdConfig(agentConfig: Record<string, unknown> | null | undefined): {
  enabled: boolean;
  twilioMode: "Enable" | "DetectMessageEnd";
} {
  const cfg = agentConfig ?? {};
  const modeRaw = String(cfg["machineDetectionMode"] ?? "").toLowerCase();
  const vmDetection = cfg["voicemailDetection"] === true;
  const enabledByMode =
    modeRaw === "enable" || modeRaw === "detect_message_end" || modeRaw === "detectmessageend";
  const enabled = vmDetection || enabledByMode;
  const twilioMode: "Enable" | "DetectMessageEnd" =
    modeRaw === "detect_message_end" || modeRaw === "detectmessageend" ? "DetectMessageEnd" : "Enable";
  return { enabled, twilioMode };
}

export async function dialTwilio(opts: {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  toNumber: string;
  webhookUrl: string;
  statusCallbackUrl: string;
  /** Max call duration in seconds. Twilio hangs up at this limit. */
  maxDurationSeconds?: number;
  /**
   * AMD — omit to disable. Synchronous detection: Twilio delays the voice
   * webhook (Url) until detection completes and includes `AnsweredBy` in that
   * request body. We do NOT use AsyncAmd, so no separate callback URL is needed.
   */
  machineDetection?: "Enable" | "DetectMessageEnd";
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
    // Synchronous AMD (no AsyncAmd): Twilio blocks the voice webhook until it
    // resolves AnsweredBy, which the voice handler reads to gate the AI stream.
    body.append("MachineDetection", opts.machineDetection);
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
  /**
   * URL Plivo POSTs to when the call terminates (busy/failed/no-answer/completed).
   * Required for campaign status callbacks so `handleCampaignLeadTerminalStatus`
   * can update the lead and schedule retries.
   */
  hangupUrl?: string;
  /** Max call duration in seconds. Plivo hangs up at this limit. */
  maxDurationSeconds?: number;
  /**
   * AMD — omit to disable. Synchronous detection: Plivo resolves the result
   * before invoking answer_url and passes it as the `Machine` parameter on that
   * request, which the answer handler reads to gate the AI stream.
   */
  machineDetectionEnabled?: boolean;
}): Promise<string> {
  const url   = `https://api.plivo.com/v1/Account/${opts.authId}/Call/`;
  const creds = Buffer.from(`${opts.authId}:${opts.authToken}`).toString("base64");
  const callBody: Record<string, string | boolean | number> = {
    to: opts.toNumber, from: opts.fromNumber,
    answer_url: opts.answerUrl, answer_method: "POST",
  };
  if (opts.hangupUrl) {
    callBody["hangup_url"] = opts.hangupUrl;
    callBody["hangup_method"] = "POST";
  }
  if (opts.maxDurationSeconds && opts.maxDurationSeconds > 0) {
    callBody["time_limit"] = Math.floor(opts.maxDurationSeconds);
  }
  if (opts.machineDetectionEnabled) {
    // Synchronous detection: result passed to answer_url as the `Machine` param.
    callBody["machine_detection"] = "true";
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
  /**
   * AMD — omit to disable. Per VoBiz's Machine Detection docs, the verdict is
   * delivered via the ASYNCHRONOUS `machine_detection_url` callback (POST with
   * `Machine`, `CallUUID`, `RequestUUID`, `Event=MachineDetection`), NOT on the
   * answer webhook (that was a Plivo-compat assumption — VoBiz does not send the
   * flag there). We still request `machine_detection=true` and treat any flag
   * that does appear on answer_url as a bonus hint.
   */
  machineDetectionEnabled?: boolean;
  /**
   * Async AMD callback URL (VoBiz `machine_detection_url`). VoBiz POSTs the
   * verdict here when detection completes. Only sent when
   * `machineDetectionEnabled` is true.
   */
  machineDetectionUrl?: string;
}): Promise<{ requestUuid: string | null; callUuid: string | null }> {
  const url  = `https://api.vobiz.ai/api/v1/Account/${opts.authId}/Call/`;
  const body: Record<string, string | number> = {
    to: opts.toNumber, from: opts.fromNumber,
    answer_url: opts.answerUrl, answer_method: "POST",
    hangup_url: opts.hangupUrl, hangup_method: "POST",
  };
  if (opts.maxDurationSeconds && opts.maxDurationSeconds > 0) {
    // Vobiz max is 86400 s (24 h); cap to avoid 400 on large wallet balances
    body["time_limit"] = Math.min(Math.floor(opts.maxDurationSeconds), 86400);
  }
  // Carrier-side VoBiz AMD (`machine_detection=true`) delays the answer webhook
  // by ~5–10s, so it stays OFF by default. Outbound voicemail gating runs in
  // pipeline.confirmAmdMachineThenBranch() after the media stream opens
  // (acoustic continuous-greeting vs short "hello?"). Set AMD_VOBIZ_CARRIER=1
  // to also request VoBiz async machine_detection_url corroboration (accepts
  // the connect delay).
  if (opts.machineDetectionEnabled && process.env["AMD_VOBIZ_CARRIER"] === "1") {
    body["machine_detection"] = "true";
    const rawTime = Number(process.env["AMD_VOBIZ_DETECTION_TIME_MS"]) || 3000;
    body["machine_detection_time"] = Math.min(10000, Math.max(2000, Math.floor(rawTime)));
    if (opts.machineDetectionUrl) {
      body["machine_detection_url"] = opts.machineDetectionUrl;
      body["machine_detection_method"] = "POST";
    }
  } else if (opts.machineDetectionEnabled) {
    logger.info(
      { to: opts.toNumber, from: opts.fromNumber },
      "VoBiz dial: AMD enabled — using in-pipeline acoustic confirmation (carrier machine_detection omitted; set AMD_VOBIZ_CARRIER=1 to opt in)",
    );
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
  // DIAGNOSTIC: VoBiz's synchronous dial response returns a `request_uuid` (an
  // identifier for THIS outbound API request), NOT the live `call_uuid`. The live
  // `call_uuid` arrives later on the answer webhook as `CallUUID` and is the ONLY
  // identifier the /Call/{uuid}/Transfer/ endpoint accepts (a request_uuid 404s).
  // We therefore record the request_uuid only as a correlation key, never as a
  // transfer-capable call id.
  logger.info(
    { to: opts.toNumber, from: opts.fromNumber, dial_request_uuid: data.request_uuid ?? null, dial_call_uuid: data.call_uuid ?? null },
    "VoBiz dial response",
  );
  return { requestUuid: data.request_uuid ?? null, callUuid: data.call_uuid ?? null };
}
