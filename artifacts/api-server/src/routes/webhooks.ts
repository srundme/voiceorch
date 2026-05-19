import { Router, type IRouter } from "express";
import { getTwilioVoiceTwiML } from "../orchestration/telephony/twilio.js";
import { getPlivoAnswerXML } from "../orchestration/telephony/plivo.js";
import { getVobizConnectResponse } from "../orchestration/telephony/vobiz.js";
import { db, agentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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
 * POST /api/webhooks/vobiz/voice?agentId=<id>
 * Vobiz calls this when a call arrives; expects JSON response.
 */
router.post("/webhooks/vobiz/voice", async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.query["agentId"] ?? req.body?.agentId ?? "0"), 10);

  if (!agentId) {
    res.status(400).json({ error: "agentId is required" });
    return;
  }

  const wsBaseUrl = getWsBaseUrl(req);
  res.json(getVobizConnectResponse(wsBaseUrl, agentId));
});

// ── Twilio status callbacks ──────────────────────────────────────────────────

router.post("/webhooks/twilio/status", (req, res): void => {
  // Twilio posts call status updates here — log and acknowledge
  req.log.info({ body: req.body }, "Twilio status callback");
  res.sendStatus(204);
});

export default router;
