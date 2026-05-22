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

/**
 * POST /api/webhooks/vobiz/voice
 * Vobiz calls this when a call arrives.
 * Resolution order:
 *   1. ?agentId= query param (legacy / outbound callback)
 *   2. `To` body field → look up managed phone number → get assigned agentId
 */
router.post("/webhooks/vobiz/voice", async (req, res): Promise<void> => {
  const wsBaseUrl = getWsBaseUrl(req);

  // 1. Explicit agentId param (outbound / legacy)
  let agentId = parseInt(String(req.query["agentId"] ?? "0"), 10);

  let platformTelephony = false;

  if (!agentId) {
    // 2. Managed number routing — look up the "To" number (platform telephony)
    const toNumber: string = String(req.body?.To ?? req.body?.to ?? "").trim();
    if (toNumber) {
      const [pn] = await db
        .select({ agentId: phoneNumbersTable.agentId })
        .from(phoneNumbersTable)
        .where(eq(phoneNumbersTable.number, toNumber));
      if (pn?.agentId) {
        agentId = pn.agentId;
        platformTelephony = true; // using our carrier, charge $0.005/min surcharge
      }
    }
  }

  if (!agentId) {
    res.status(400).set("Content-Type", "text/xml").send("<Response><Speak>Agent not configured for this number.</Speak><Hangup/></Response>");
    return;
  }

  res.set("Content-Type", "text/xml").send(getVobizAnswerXML(wsBaseUrl, agentId, platformTelephony));
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
