import { Router, type IRouter } from "express";
import { getTwilioVoiceTwiML } from "../orchestration/telephony/twilio.js";
import { getPlivoAnswerXML } from "../orchestration/telephony/plivo.js";
import { getVobizAnswerXML } from "../orchestration/telephony/vobiz.js";
import { db, agentsTable, callsTable, phoneNumbersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router: IRouter = Router();

/** Resolve the public WebSocket base URL from the request */
function getWsBaseUrl(req: Parameters<Parameters<IRouter["post"]>[1]>[0]): string {
  const host = req.headers["x-forwarded-host"] ?? req.hostname;
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  const wsProto = proto === "https" ? "wss" : "ws";
  return `${wsProto}://${host}`;
}

// ── Twilio ──────────────────────────────────────────────────────────────────

/**
 * POST /api/webhooks/twilio/voice?agentId=<id>
 * Twilio calls this when a call arrives. We respond with TwiML that opens a Media Stream.
 */
router.post("/webhooks/twilio/voice", async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.query["agentId"] ?? req.body?.agentId ?? "0"), 10);

  if (!agentId) {
    res.status(400).send("<Response><Say>Agent not configured.</Say><Hangup/></Response>");
    return;
  }

  const [agent] = await db.select({ id: agentsTable.id }).from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) {
    res.status(404).send("<Response><Say>Agent not found.</Say><Hangup/></Response>");
    return;
  }

  const wsBaseUrl = getWsBaseUrl(req);
  const twiml = getTwilioVoiceTwiML(wsBaseUrl, agentId);

  res.set("Content-Type", "text/xml").send(twiml);
});

// ── Plivo ────────────────────────────────────────────────────────────────────

/**
 * POST /api/webhooks/plivo/voice?agentId=<id>
 * Plivo calls this when a call arrives.
 */
router.post("/webhooks/plivo/voice", async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.query["agentId"] ?? req.body?.agentId ?? "0"), 10);

  if (!agentId) {
    res.status(400).set("Content-Type", "text/xml").send("<Response><Speak>Agent not configured.</Speak><Hangup/></Response>");
    return;
  }

  const wsBaseUrl = getWsBaseUrl(req);
  const xml = getPlivoAnswerXML(wsBaseUrl, agentId);

  res.set("Content-Type", "text/xml").send(xml);
});

// ── Vobiz ────────────────────────────────────────────────────────────────────

/** Resolve HTTP base URL (for VoiceXML action / redirect attributes) */
function getHttpBaseUrl(req: Parameters<Parameters<IRouter["post"]>[1]>[0]): string {
  const host  = req.headers["x-forwarded-host"] ?? req.hostname;
  const proto = (req.headers["x-forwarded-proto"] ?? "https") as string;
  return `${proto}://${host}`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * POST /api/webhooks/vobiz/voice
 * Resolution order:
 *   1. ?agentId= query param (outbound / legacy)
 *   2. `To` body → managed phone number → assigned agentId
 * Then applies P2-F routing rules → P2-E queue → P2-D IVR → P2-C recording.
 */
router.post("/webhooks/vobiz/voice", async (req, res): Promise<void> => {
  const wsBaseUrl = getWsBaseUrl(req);
  const httpBase  = getHttpBaseUrl(req);

  let agentId = parseInt(String(req.query["agentId"] ?? "0"), 10);
  let platformTelephony = false;
  type RoutingRule = {
    condition: "caller_prefix" | "time_range" | "always";
    value?: string; startHour?: number; endHour?: number; targetAgentId: number;
  };
  let routingRules: RoutingRule[] | null = null;

  if (!agentId) {
    const toNumber: string = String(req.body?.To ?? req.body?.to ?? "").trim();
    if (toNumber) {
      const [pn] = await db
        .select({ agentId: phoneNumbersTable.agentId, routingRules: phoneNumbersTable.routingRules })
        .from(phoneNumbersTable)
        .where(eq(phoneNumbersTable.number, toNumber));
      if (pn?.agentId) {
        agentId = pn.agentId;
        platformTelephony = true;
        routingRules = (pn.routingRules as RoutingRule[] | null) ?? null;
      }
    }
  }

  if (!agentId) {
    res.status(400).set("Content-Type", "text/xml")
      .send("<Response><Speak>Agent not configured for this number.</Speak><Hangup/></Response>");
    return;
  }

  // P2-F: Evaluate inbound routing rules (first match wins)
  if (routingRules && routingRules.length > 0) {
    const callerNumber = String(req.body?.From ?? req.body?.from ?? "");
    const nowHour = new Date().getUTCHours();
    for (const rule of routingRules) {
      if (rule.condition === "caller_prefix" && rule.value && callerNumber.startsWith(rule.value)) {
        agentId = rule.targetAgentId; break;
      } else if (rule.condition === "time_range" && rule.startHour !== undefined && rule.endHour !== undefined) {
        if (nowHour >= rule.startHour && nowHour < rule.endHour) { agentId = rule.targetAgentId; break; }
      } else if (rule.condition === "always") {
        agentId = rule.targetAgentId; break;
      }
    }
  }

  // Fetch agent config for P2-C/D/E features
  const [agent] = await db
    .select({ agentConfig: agentsTable.agentConfig })
    .from(agentsTable)
    .where(eq(agentsTable.id, agentId));
  const cfg = (agent?.agentConfig ?? {}) as Record<string, unknown>;

  // P2-E: Queue — check if agent is at capacity, hold caller if so
  if (cfg["queueEnabled"] === true) {
    const maxConcurrent = Number(cfg["queueMaxConcurrent"] ?? 1);
    const waitSec       = Number(cfg["queueWaitSeconds"] ?? 30);
    const holdUrl       = String(cfg["queueHoldMusicUrl"] ?? "");
    const [countRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(callsTable)
      .where(sql`agent_id = ${agentId} AND status = 'active'`);
    if ((countRow?.n ?? 0) >= maxConcurrent) {
      const holdPart = holdUrl
        ? `\n  <Play loop="10">${escapeXml(holdUrl)}</Play>`
        : `\n  <Speak>All agents are busy. Please hold.</Speak>\n  <Wait length="${waitSec}" />`;
      const redirectUrl = `${httpBase}/api/webhooks/vobiz/voice?agentId=${agentId}`;
      res.set("Content-Type", "text/xml").send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${holdPart}\n  <Redirect method="POST">${escapeXml(redirectUrl)}</Redirect>\n</Response>`
      );
      return;
    }
  }

  // P2-D: IVR — play a DTMF menu before connecting to the AI session
  if (cfg["ivrEnabled"] === true) {
    const greeting = String(cfg["ivrGreeting"] ?? "Welcome. Please press a key to be connected.");
    const ivrOpts  = (cfg["ivrOptions"] as Array<{ digit: string; label: string }> | undefined) ?? [];
    const menuText = ivrOpts.map(o => `Press ${o.digit} for ${o.label}.`).join(" ");
    const spoken   = escapeXml(`${greeting}${menuText ? " " + menuText : ""}`);
    const ivrAction   = `${httpBase}/api/webhooks/vobiz/ivr?agentId=${agentId}`;
    const fallbackUrl = `${httpBase}/api/webhooks/vobiz/voice?agentId=${agentId}`;
    res.set("Content-Type", "text/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <GetDigits action="${escapeXml(ivrAction)}" method="GET" timeout="5" numDigits="1" retries="2">\n    <Speak>${spoken}</Speak>\n  </GetDigits>\n  <Redirect method="POST">${escapeXml(fallbackUrl)}</Redirect>\n</Response>`
    );
    return;
  }

  // P2-C: Recording — prepend <Record> to answer XML if enabled
  const recordingCallbackUrl = cfg["recordingEnabled"] === true
    ? `${httpBase}/api/webhooks/vobiz/recording`
    : undefined;

  res.set("Content-Type", "text/xml").send(
    getVobizAnswerXML(wsBaseUrl, agentId, platformTelephony, { recordingCallbackUrl })
  );
});

// ── P2-C: Recording callback ──────────────────────────────────────────────────
// VoBiz POSTs here when a recording completes; we save the URL to the call record.

router.post("/webhooks/vobiz/recording", async (req, res): Promise<void> => {
  const recordUrl = String(req.body?.RecordUrl ?? req.body?.record_url ?? "");
  const callUuid  = String(req.body?.CallUUID  ?? req.body?.call_uuid  ?? "");
  req.log.info({ recordUrl, callUuid }, "VoBiz recording callback");
  if (recordUrl && callUuid) {
    try {
      await db.update(callsTable)
        .set({ recordingUrl: recordUrl })
        .where(sql`metadata::text like ${"%" + callUuid + "%"}`);
    } catch (err) {
      req.log.error({ err }, "Failed to save recording URL");
    }
  }
  res.sendStatus(204);
});

// ── P2-D: IVR / DTMF callback ─────────────────────────────────────────────────
// VoBiz calls this GET when the caller presses a digit after <GetDigits>.
// We look up the IVR option and redirect to the matched agent's stream.

router.get("/webhooks/vobiz/ivr", async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.query["agentId"] ?? "0"), 10);
  const digits  = String(req.query["Digits"] ?? req.query["digits"] ?? "");
  req.log.info({ agentId, digits }, "VoBiz IVR digit received");

  let targetAgentId = agentId;
  if (agentId && digits) {
    const [ag] = await db.select({ agentConfig: agentsTable.agentConfig })
      .from(agentsTable).where(eq(agentsTable.id, agentId));
    const ivrOpts = ((ag?.agentConfig as Record<string, unknown> | null)?.["ivrOptions"] as
      Array<{ digit: string; targetAgentId?: number }> | undefined) ?? [];
    const match = ivrOpts.find(o => o.digit === digits);
    if (match?.targetAgentId) targetAgentId = match.targetAgentId;
  }

  const wsBase = getWsBaseUrl(req);
  res.set("Content-Type", "text/xml").send(getVobizAnswerXML(wsBase, targetAgentId));
});

// ── VoBiz status callbacks ───────────────────────────────────────────────────

router.post("/webhooks/vobiz/status", (req, res): void => {
  req.log.info({ body: req.body }, "VoBiz status callback");
  res.sendStatus(204);
});

// ── Twilio status callbacks ──────────────────────────────────────────────────

router.post("/webhooks/twilio/status", (req, res): void => {
  // Twilio posts call status updates here — log and acknowledge
  req.log.info({ body: req.body }, "Twilio status callback");
  res.sendStatus(204);
});

// ── P2-B: AMD / Voicemail Detection callback ─────────────────────────────────
// VoBiz POSTs here when machine_detection fires.
// Body fields: MachineDetected ("true"/"false"), CallUUID, To, From.
// Query param: agentId (set when initiating the outbound call).

router.post("/webhooks/vobiz/amd", async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.query["agentId"] ?? req.body?.agentId ?? "0"), 10);
  const machineDetected = String(req.body?.MachineDetected ?? "").toLowerCase() === "true";
  const callUuid        = String(req.body?.CallUUID ?? req.body?.call_uuid ?? "");

  req.log.info({ agentId, machineDetected, callUuid }, "VoBiz AMD callback");

  // Mark the call record with AMD result
  if (callUuid) {
    try {
      await db.update(callsTable)
        .set({ amdResult: machineDetected ? "machine" : "human" })
        .where(sql`metadata::text like ${"%" + callUuid + "%"}`);
    } catch { /* non-critical */ }
  }

  if (!machineDetected) {
    // Human answered — continue with normal VoBiz stream
    const wsBase = getWsBaseUrl(req);
    res.set("Content-Type", "text/xml").send(getVobizAnswerXML(wsBase, agentId));
    return;
  }

  // Machine detected — look up agent config for voicemailAction
  let voicemailAction: string = "hangup";
  let voicemailMessage: string = "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you.";
  let continueWithStream = false;

  if (agentId) {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    if (agent?.agentConfig) {
      const cfg = agent.agentConfig as Record<string, unknown>;
      voicemailAction  = (cfg["voicemailAction"]  as string | undefined) ?? "hangup";
      voicemailMessage = (cfg["voicemailMessage"]  as string | undefined) ?? voicemailMessage;
    }
  }

  if (voicemailAction === "leave_message") {
    const safeMsg = voicemailMessage
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    res.set("Content-Type", "text/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Speak>${safeMsg}</Speak>\n  <Hangup/>\n</Response>`
    );
  } else if (voicemailAction === "continue") {
    continueWithStream = true;
    const wsBase = getWsBaseUrl(req);
    res.set("Content-Type", "text/xml").send(getVobizAnswerXML(wsBase, agentId));
  } else {
    // "hangup" (default)
    res.set("Content-Type", "text/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Hangup/>\n</Response>`
    );
  }

  void continueWithStream; // suppress unused warning
});

// ── P2-A: Transfer XML callback ───────────────────────────────────────────────
// VoBiz fetches this URL after a transfer is initiated via the REST API.
// Returns VoiceXML with a <Dial> to connect the caller to the target number.

import { buildTransferXml } from "../orchestration/telephony/transfer.js";

router.get("/webhooks/vobiz/transfer-xml", (req, res): void => {
  const target = String(req.query["target"] ?? "").trim();
  if (!target) {
    res.status(400).set("Content-Type", "text/xml")
      .send("<Response><Speak>Transfer target missing.</Speak><Hangup/></Response>");
    return;
  }
  res.set("Content-Type", "text/xml").send(buildTransferXml(target));
});

export default router;
