import { Router, type IRouter } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { getTwilioVoiceTwiML } from "../orchestration/telephony/twilio.js";
import { getPlivoAnswerXML } from "../orchestration/telephony/plivo.js";
import { getVobizAnswerXML } from "../orchestration/telephony/vobiz.js";
import { resolveAmdConfig } from "../orchestration/telephony/dial.js";
import { getSessionByCallId, getSessionByExternalCallId } from "../orchestration/session.js";
import { db, agentsTable, callsTable, phoneNumbersTable, providersTable, scheduledCallbacksTable, campaignLeadsTable, leadTimelineTable, campaignsTable, canonicalizeCallerKey } from "@workspace/db";
import { eq, sql, and, gte, inArray } from "drizzle-orm";
import { decryptKey } from "../lib/crypto.js";
import { validateTwilioSignature, validatePlivoSignature } from "../lib/webhook-signature.js";
import { logger } from "../lib/logger.js";
import { scheduleNextRedial, scheduleNoAnswerRedial, cancelPendingRedials } from "../services/autoRedial.js";
import { scheduleRetry, resolveRetryConfig } from "../services/retryEngine.js";
import { refillCampaignConcurrency, reconcileCampaignBatches } from "../services/batchScheduler.js";
import { computeOperationalOutcome, setOperationalOutcome } from "../services/operational-outcome.js";
import { APP_SECRET } from "../lib/app-secret.js";

const router: IRouter = Router();

const IS_PROD = process.env["NODE_ENV"] === "production";

// ── Auto-redial: handle no-answer status callbacks ───────────────────────────

const NO_ANSWER_STATUSES = new Set(["no-answer", "no_answer", "busy", "failed", "noanswer"]);

/** Constant-time string comparison for status-callback secrets. */
function secretsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

async function handleNoAnswerStatus(opts: {
  cbId: number | null;
  cbSecret: string | null;
  agentId: number | null;
  callStatus: string;
  toNumber: string;
}): Promise<void> {
  if (!NO_ANSWER_STATUSES.has(opts.callStatus.toLowerCase())) return;

  try {
    if (opts.cbId) {
      // This was a scheduler-fired callback — look up row and validate the
      // per-row secret before scheduling the next retry.  This prevents
      // enumeration of serial cbId values to trigger arbitrary outbound calls.
      const [cb] = await db
        .select()
        .from(scheduledCallbacksTable)
        .where(eq(scheduledCallbacksTable.id, opts.cbId));
      if (!cb) {
        logger.warn({ cbId: opts.cbId }, "handleNoAnswerStatus: cbId not found — ignoring");
        return;
      }
      // Validate secret if the row has one (new rows always will; legacy rows
      // without a secret are still accepted so existing redialing isn't broken).
      if (cb.callbackSecret && !secretsMatch(cb.callbackSecret, opts.cbSecret ?? "")) {
        logger.warn({ cbId: opts.cbId }, "handleNoAnswerStatus: cbSecret mismatch — ignoring (possible forged webhook)");
        return;
      }
      await scheduleNextRedial(cb);
      return;
    }

    // First outbound call (no cbId) — start a retry chain if we have agentId + toNumber.
    // Caller is already guarded by the (agentId, toNumber) call-record existence check
    // performed before invoking this helper from the status route handlers.
    if (opts.agentId && opts.toNumber) {
      await scheduleNoAnswerRedial({ agentId: opts.agentId, toNumber: opts.toNumber });
    }
  } catch (err) {
    logger.error({ err, ...opts }, "handleNoAnswerStatus error");
  }
}

/** Normalize a raw provider status: lowercase, trim, collapse spaces/underscores to "-". */
function normalizeRawStatus(raw: string): string {
  return (raw ?? "").toLowerCase().trim().replace(/[\s_]+/g, "-");
}

/**
 * Statuses that mean the call is still progressing or has connected. These are
 * NOT non-connected terminal events: a connected call is moved to its terminal
 * state by endSession() (which owns its lifecycle), and an in-progress call has
 * not freed its slot yet. Marking either here would clobber a live/connected
 * call and corrupt the concurrency count, so they are explicitly ignored.
 */
const NON_TERMINAL_OR_CONNECTED_STATUSES = new Set<string>([
  "", "queued", "initiated", "trying", "early", "early-media", "ringing",
  "in-progress", "inprogress", "answered", "answer", "connected", "started",
  "live", "completed", "complete", "hangup", "normal-clearing",
]);

const NO_PICKUP_STATUSES = new Set<string>([
  "no-answer", "noanswer", "not-reachable", "unreachable", "no-pickup",
  "timeout", "timed-out", "timeout-on-answer", "temporarily-unavailable",
  "subscriber-absent", "originator-cancel", "allotted-timeout",
]);

const FAILED_STATUSES = new Set<string>([
  "failed", "fail", "canceled", "cancelled", "cancel", "congestion",
  "rejected", "declined", "call-rejected", "unallocated", "unallocated-number",
  "error", "invalid", "invalid-number", "no-route-destination",
  "no-route-to-destination", "machine", "voicemail", "blocked", "forbidden",
]);

/**
 * Map a raw telephony call status to the campaign lead callStatus value.
 *  - a terminal non-connected status → "no_pickup" | "busy" | "failed"
 *  - a still-progressing / connected status → "ignore" (owned by endSession)
 *  - anything unrecognized → null (caller decides based on the lead's state)
 *
 * Providers (Twilio/Plivo/VoBiz) emit overlapping but inconsistent vocabularies,
 * so the families above are broadened and the unknown case is surfaced rather
 * than silently swallowed — an unmapped terminal status used to leave the lead
 * stuck in "calling", inflating the active count and starving rolling refill.
 */
function mapRawStatusToLeadStatus(raw: string): "no_pickup" | "busy" | "failed" | "ignore" | null {
  const s = normalizeRawStatus(raw);
  if (NON_TERMINAL_OR_CONNECTED_STATUSES.has(s)) return "ignore";
  if (s === "busy" || s === "busy-here" || s === "user-busy" || s === "user-busy-here") return "busy";
  if (NO_PICKUP_STATUSES.has(s)) return "no_pickup";
  if (FAILED_STATUSES.has(s)) return "failed";
  return null;
}

/**
 * Update a campaign lead that resulted in a non-connected terminal call status
 * (busy, no-answer, failed, etc.) and schedule a retry if attempts remain.
 * Does NOT require a `calls` table record to exist.
 */
async function handleCampaignLeadTerminalStatus(opts: {
  campaignLeadId: number;
  rawCallStatus: string;
}): Promise<void> {
  const { campaignLeadId, rawCallStatus } = opts;

  const mapped = mapRawStatusToLeadStatus(rawCallStatus);

  // Still progressing or connected — owned by endSession(), never mark here.
  if (mapped === "ignore") {
    logger.debug({ campaignLeadId, rawCallStatus }, "Campaign lead terminal status: still in progress / connected — skipping");
    return;
  }

  const [lead] = await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.id, campaignLeadId));
  if (!lead) {
    logger.warn({ campaignLeadId }, "Campaign lead terminal status: lead not found — ignoring");
    return;
  }

  // Only update if still 'calling' or 'connected' — avoid clobbering completed/skipped/already-updated leads
  if (lead.callStatus !== "calling" && lead.callStatus !== "connected") {
    logger.info({ campaignLeadId, callStatus: lead.callStatus }, "Campaign lead terminal status: lead not in active state — skipping");
    return;
  }

  // Resolve the unknown case. An unrecognized status that arrives while the lead
  // is still 'calling' (never connected) is treated as a non-connected failure
  // so the slot is freed and rolling refill is not starved. If the lead has
  // 'connected', endSession() owns its terminal transition — leave it alone.
  let leadStatus: "no_pickup" | "busy" | "failed";
  if (mapped === null) {
    if (lead.callStatus === "connected") {
      logger.info({ campaignLeadId, rawCallStatus }, "Campaign lead terminal status: unknown status on a connected lead — deferring to endSession");
      return;
    }
    leadStatus = "failed";
    logger.warn({ campaignLeadId, rawCallStatus }, "Campaign lead terminal status: unknown provider status on calling lead — treating as failed to free slot");
  } else {
    leadStatus = mapped;
  }

  await db.update(campaignLeadsTable)
    .set({ callStatus: leadStatus })
    .where(eq(campaignLeadsTable.id, campaignLeadId));

  // Mirror the terminal status onto the calls table row so the Calls Log shows
  // the real outcome instead of staying "in_progress" forever.
  // Only do this when the lead was in "calling" state (never connected) — if it
  // was "connected", endSession() owns the calls row and will update it itself.
  if (lead.callId && lead.callStatus === "calling") {
    await db.update(callsTable)
      .set({ status: leadStatus, endedAt: new Date() })
      .where(and(
        eq(callsTable.id, lead.callId),
        eq(callsTable.status, "in_progress"),
      ));
  }

  await db.insert(leadTimelineTable).values({
    leadId:     campaignLeadId,
    campaignId: lead.campaignId,
    eventType:  "call_ended",
    data:       { callStatus: rawCallStatus, leadStatus },
  });

  // Schedule a retry if the campaign allows more attempts
  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, lead.campaignId));
  let retryScheduled = false;
  if (campaign) {
    const { maxAttempts, retryDelayMinutes } = await resolveRetryConfig(lead.batchId, campaign);
    retryScheduled = await scheduleRetry({
      leadId:            campaignLeadId,
      campaignId:        lead.campaignId,
      currentAttempts:   lead.callAttempts ?? 0,
      maxAttempts,
      retryDelayMinutes,
      reason:            leadStatus,
    });
  }

  // Compute and persist operational outcome for no-contact / failed cases.
  // If a retry was scheduled the outcome stays "pending"; once attempts are
  // exhausted it moves to "no_contact" (busy/no_pickup) or "failed".
  try {
    const maxAttemptsReached = !retryScheduled && campaign != null;
    const outcome = computeOperationalOutcome({
      callStatus:           leadStatus,
      disposition:          null,
      hasBooking:           false,
      hasCompletedTransfer: false,
      hasPendingCallback:   false,
      maxAttemptsReached,
      isDncBlocked:         false,
    });
    if (outcome !== "pending") {
      await setOperationalOutcome(db, campaignLeadId, lead.campaignId, outcome);
    }
  } catch (outcomeErr) {
    logger.warn({ campaignLeadId, outcomeErr }, "Failed to set operational outcome after terminal status");
  }

  logger.info({ campaignLeadId, rawCallStatus, leadStatus, retryScheduled }, "Campaign lead updated to terminal status");

  // Rolling concurrency: a slot just freed (lead left the active calling/connected
  // count), so immediately top the campaign back up to its limit instead of
  // waiting for the next 60 s poll. Fire-and-forget — never block the webhook.
  void refillCampaignConcurrency(lead.campaignId);
  // ...then reconcile so a now-finished batch/campaign flips to "completed" right
  // away. Runs AFTER retry scheduling above, so a scheduled retry (pending
  // call_retries row) correctly keeps the batch open. Fire-and-forget.
  void reconcileCampaignBatches(lead.campaignId);
}

/**
 * Fetch the decrypted provider auth token for a given agent + provider type.
 * Returns null if the agent or key is not found.
 */
async function getAgentProviderToken(agentId: number, provider: "twilio" | "plivo"): Promise<string | null> {
  try {
    const [agent] = await db
      .select({ userId: agentsTable.userId })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId));
    if (!agent?.userId) return null;
    const [row] = await db
      .select({ apiKey: providersTable.apiKey })
      .from(providersTable)
      .where(
        and(
          eq(providersTable.userId, agent.userId),
          eq(providersTable.providerName, provider),
          eq(providersTable.isActive, true),
        ),
      );
    if (!row) return null;
    return decryptKey(row.apiKey);
  } catch {
    return null;
  }
}

/** Resolve the public WebSocket base URL from the request */
function getWsBaseUrl(req: Parameters<Parameters<IRouter["post"]>[1]>[0]): string {
  // WEBHOOK_BASE_URL pins us to the Railway prod host (avoids Replit dev mTLS block)
  const fixed = process.env["WEBHOOK_BASE_URL"];
  if (fixed) return fixed.replace(/^http/, "ws").replace(/\/$/, "");
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

  // ── Twilio signature validation ────────────────────────────────────────────
  // Twilio signs every inbound request with HMAC-SHA1 over the full URL
  // (including query string) + sorted POST body params.
  const twilioSig = String(req.headers["x-twilio-signature"] ?? "");
  if (twilioSig) {
    const authToken = await getAgentProviderToken(agentId, "twilio");
    if (!authToken) {
      // Signature was sent but we have no key to verify it — treat as unverifiable.
      logger.warn({ agentId }, "Twilio signature present but no provider key found — rejected");
      if (IS_PROD) {
        res.status(403).send("<Response><Say>Forbidden.</Say><Hangup/></Response>");
        return;
      }
    } else {
      const proto = String(req.headers["x-forwarded-proto"] ?? "https");
      const host  = String(req.headers["x-forwarded-host"] ?? req.hostname);
      // Twilio includes query-string params in the URL it signs (for POST requests
      // the query string appears in the URL, body params are signed separately).
      const queryStr = req.url?.split("?")[1] ?? "";
      const fullUrl = `${proto}://${host}${req.path}${queryStr ? "?" + queryStr : ""}`;
      const bodyParams: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.body as Record<string, unknown>)) {
        if (typeof v === "string") bodyParams[k] = v;
      }
      const valid = validateTwilioSignature(authToken, fullUrl, bodyParams, twilioSig);
      if (!valid) {
        logger.warn({ agentId, fullUrl }, "Twilio signature validation failed");
        if (IS_PROD) {
          res.status(403).send("<Response><Say>Forbidden.</Say><Hangup/></Response>");
          return;
        }
      }
    }
  } else if (IS_PROD) {
    // In production, missing signature header = reject
    logger.warn({ agentId }, "Twilio voice webhook missing X-Twilio-Signature — rejected");
    res.status(403).send("<Response><Say>Forbidden.</Say><Hangup/></Response>");
    return;
  }

  const [agent] = await db.select({ id: agentsTable.id }).from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) {
    res.status(404).send("<Response><Say>Agent not found.</Say><Hangup/></Response>");
    return;
  }

  // ── AMD gating ───────────────────────────────────────────────────────────
  // Synchronous AMD: Twilio includes AnsweredBy in this request when machine
  // detection was requested. Branch before opening the AI media stream.
  const amdHandled = await applyAmdGate({
    res, log: req.log, agentId,
    providerCallId: String(req.body?.CallSid ?? ""),
    result: parseTwilioAnsweredBy(String(req.body?.AnsweredBy ?? "")),
    speakTag: "Say",
  });
  if (amdHandled) return;

  const wsBaseUrl = getWsBaseUrl(req);
  const campaignLeadId = req.query["campaignLeadId"] ? parseInt(String(req.query["campaignLeadId"]), 10) : undefined;
  const callDirection = req.query["dir"] === "out" ? "outbound" : "inbound";
  const twilioAnswerCbId = req.query["cbId"] ? (parseInt(String(req.query["cbId"]), 10) || undefined) : undefined;
  const twiml = getTwilioVoiceTwiML(wsBaseUrl, agentId, campaignLeadId, callDirection, twilioAnswerCbId);

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

  // ── Plivo v2 signature validation ─────────────────────────────────────────
  // Plivo signs every inbound request with HMAC-SHA256 over (nonce + uri).
  const plivoSig   = String(req.headers["x-plivo-signature-v2"] ?? "");
  const plivoNonce = String(req.headers["x-plivo-signature-v2-nonce"] ?? "");
  if (plivoSig && plivoNonce) {
    const authToken = await getAgentProviderToken(agentId, "plivo");
    if (!authToken) {
      logger.warn({ agentId }, "Plivo signature present but no provider key found — rejected");
      if (IS_PROD) {
        res.status(403).set("Content-Type", "text/xml").send("<Response><Speak>Forbidden.</Speak><Hangup/></Response>");
        return;
      }
    } else {
      const valid = validatePlivoSignature(authToken, plivoNonce, req.path, plivoSig);
      if (!valid) {
        logger.warn({ agentId }, "Plivo signature validation failed");
        if (IS_PROD) {
          res.status(403).set("Content-Type", "text/xml").send("<Response><Speak>Forbidden.</Speak><Hangup/></Response>");
          return;
        }
      }
    }
  } else if (IS_PROD) {
    logger.warn({ agentId }, "Plivo voice webhook missing signature headers — rejected");
    res.status(403).set("Content-Type", "text/xml").send("<Response><Speak>Forbidden.</Speak><Hangup/></Response>");
    return;
  }

  // ── AMD gating ───────────────────────────────────────────────────────────
  // Synchronous AMD: Plivo passes the `Machine` flag on this answer request when
  // machine_detection was requested. Branch before opening the AI media stream.
  const amdHandled = await applyAmdGate({
    res, log: req.log, agentId,
    providerCallId: String(req.body?.CallUUID ?? req.body?.call_uuid ?? ""),
    result: parseMachineFlag(req.body?.Machine ?? req.body?.machine),
    speakTag: "Speak",
  });
  if (amdHandled) return;

  const wsBaseUrl = getWsBaseUrl(req);
  const campaignLeadId = req.query["campaignLeadId"] ? parseInt(String(req.query["campaignLeadId"]), 10) : undefined;
  const callDirection = req.query["dir"] === "out" ? "outbound" : "inbound";
  const plivoAnswerCbId = req.query["cbId"] ? (parseInt(String(req.query["cbId"]), 10) || undefined) : undefined;
  const xml = getPlivoAnswerXML(wsBaseUrl, agentId, campaignLeadId, callDirection, plivoAnswerCbId);

  res.set("Content-Type", "text/xml").send(xml);
});

// ── Plivo campaign status callback ────────────────────────────────────────────

/**
 * POST /api/webhooks/plivo/campaign-status
 *
 * Plivo POSTs here when a campaign call terminates (busy / no-answer / failed /
 * completed). We validate the HMAC-signed `campaignLeadSig` embedded in the
 * URL at call-creation time, then call `handleCampaignLeadTerminalStatus` so
 * the lead is updated and a retry is scheduled when attempts remain.
 *
 * Plivo body fields of interest:
 *   CallStatus — "busy" | "failed" | "no-answer" | "completed" | ...
 *   CallUUID   — Plivo call identifier (attacker-controlled, not trusted here)
 */
router.post("/webhooks/plivo/campaign-status", (req, res): void => {
  req.log.info({ body: req.body, query: req.query }, "Plivo campaign status callback");
  res.sendStatus(204);

  (async () => {
    const campaignLeadId  = parseInt(String(req.query["campaignLeadId"]  ?? "0"), 10) || 0;
    const campaignLeadSig = String(req.query["campaignLeadSig"] ?? "");
    const callStatus      = String(req.body?.CallStatus ?? req.body?.call_status ?? "");

    if (campaignLeadId <= 0) {
      logger.warn({ query: req.query }, "Plivo campaign-status: missing campaignLeadId — ignoring");
      return;
    }

    const expectedSig = createHmac("sha256", APP_SECRET).update(`campaignlead:${campaignLeadId}`).digest("hex");
    const sigValid =
      campaignLeadSig.length === expectedSig.length &&
      timingSafeEqual(Buffer.from(campaignLeadSig), Buffer.from(expectedSig));
    if (!sigValid) {
      logger.warn({ campaignLeadId }, "Plivo campaign-status: campaignLeadSig invalid — ignoring");
      return;
    }

    await handleCampaignLeadTerminalStatus({ campaignLeadId, rawCallStatus: callStatus });
  })().catch((err) => logger.error({ err }, "Plivo campaign-status webhook handler error"));
});

// ── Vobiz ────────────────────────────────────────────────────────────────────

/** Resolve HTTP base URL (for VoiceXML action / redirect attributes) */
function getHttpBaseUrl(req: Parameters<Parameters<IRouter["post"]>[1]>[0]): string {
  const fixed = process.env["WEBHOOK_BASE_URL"];
  if (fixed) return fixed.replace(/\/$/, "");
  const host  = req.headers["x-forwarded-host"] ?? req.hostname;
  const proto = (req.headers["x-forwarded-proto"] ?? "https") as string;
  return `${proto}://${host}`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── AMD / voicemail gating (synchronous) ─────────────────────────────────────
// AMD now completes BEFORE the AI conversation begins: each provider performs
// synchronous detection and delivers the result on the answer/voice webhook.
// We read it here and branch the call flow — human → open the AI media stream;
// machine → enact the configured voicemailAction and never start the agent.

const DEFAULT_VOICEMAIL_MESSAGE =
  "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you.";

// Lead-in pause (seconds) before speaking the voicemail message so the answering
// machine's outgoing greeting + record beep finish first and the whole message
// is captured. Configurable per agent via `voicemailLeadInSeconds`.
const DEFAULT_VOICEMAIL_LEAD_IN_SECONDS = 2;

type AmdResult = "human" | "machine" | "unknown";

/**
 * Parse Twilio's `AnsweredBy` field into a normalised AMD result.
 * Returns null when the field is absent (AMD not requested) so callers skip
 * gating entirely and incur zero added work for non-AMD calls.
 */
function parseTwilioAnsweredBy(answeredBy: string | undefined): AmdResult | null {
  if (!answeredBy) return null;
  const v = answeredBy.toLowerCase();
  if (v === "human") return "human";
  if (v.startsWith("machine") || v === "fax") return "machine";
  return "unknown"; // "unknown" / anything else → treated as human downstream
}

/**
 * Parse a Plivo/Vobiz boolean-style machine flag ("true"/"false") into a result.
 * Returns null when no flag is present (AMD not requested).
 */
function parseMachineFlag(raw: unknown): AmdResult | null {
  if (raw === undefined || raw === null || raw === "") return null;
  return String(raw).toLowerCase() === "true" ? "machine" : "human";
}

/** Best-effort persistence of the AMD result on the matching call record. */
async function persistAmdResult(providerCallId: string, result: AmdResult): Promise<void> {
  if (!providerCallId) return;
  try {
    await db.update(callsTable)
      .set({ amdResult: result })
      .where(sql`metadata::text like ${"%" + providerCallId + "%"}`);
  } catch { /* non-critical */ }
}

/**
 * Build the XML enacting the configured voicemailAction for a detected machine.
 * `speakTag` is "Say" (Twilio TwiML) or "Speak" (Plivo/Vobiz XML).
 * Returns null for the "continue" action (caller should open the stream anyway).
 */
function buildVoicemailXml(
  action: string,
  message: string,
  speakTag: "Say" | "Speak",
  leadInSeconds = DEFAULT_VOICEMAIL_LEAD_IN_SECONDS,
): string | null {
  if (action === "continue") return null;
  if (action === "leave_message") {
    const text = message && message.trim() ? message : DEFAULT_VOICEMAIL_MESSAGE;
    // Pause before speaking so the machine's greeting + beep complete first and
    // the entire message lands in the recording. Twilio TwiML uses <Pause>,
    // Plivo/Vobiz XML uses <Wait>.
    const seconds = Math.max(0, Math.round(leadInSeconds));
    const waitTag = speakTag === "Say" ? "Pause" : "Wait";
    const lead = seconds > 0 ? `\n  <${waitTag} length="${seconds}"/>` : "";
    return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${lead}\n  <${speakTag}>${escapeXml(text)}</${speakTag}>\n  <Hangup/>\n</Response>`;
  }
  // "hangup" (default)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Hangup/>\n</Response>`;
}

/**
 * Apply AMD gating in an answer/voice handler.
 *   • result === null → AMD not requested; returns false (proceed normally).
 *   • human/unknown   → persists result, returns false (open the AI stream).
 *   • machine (trusted provider — Twilio/Plivo) → persists result, sends the
 *     voicemailAction XML and returns true, UNLESS the action is "continue".
 *   • machine (untrusted provider — VoBiz, via `acousticConfirmXml`) → does NOT
 *     persist the raw flag and does NOT enact the action. Opens the media stream
 *     with a machine hint so the pipeline can confirm the verdict acoustically
 *     and only THEN enact + persist the confirmed result. Returns true.
 * `preloadedCfg` lets the Vobiz handler reuse the agentConfig it already loaded.
 */
async function applyAmdGate(opts: {
  res: Parameters<Parameters<IRouter["post"]>[1]>[1];
  log: { info: (o: unknown, m?: string) => void };
  agentId: number;
  providerCallId: string;
  result: AmdResult | null;
  speakTag: "Say" | "Speak";
  preloadedCfg?: Record<string, unknown>;
  /** UNTRUSTED-provider path (VoBiz). VoBiz's synchronous machine flag is unreliable —
   *  it false-positives on live humans. When provided, a "machine" result opens the
   *  media stream using THIS builder's XML (which carries an `amdHint=machine` marker)
   *  instead of enacting the voicemail action. The pipeline then confirms the verdict
   *  acoustically and persists the CONFIRMED result — never the raw flag. Twilio/Plivo
   *  omit this and keep their trusted-AMD behaviour. */
  acousticConfirmXml?: () => string;
}): Promise<boolean> {
  const { res, log, agentId, providerCallId, result, speakTag, preloadedCfg, acousticConfirmXml } = opts;
  if (result === null) return false; // AMD not requested — no behaviour change
  if (result !== "machine") {
    // human / unknown → safe to persist and open the AI stream immediately.
    await persistAmdResult(providerCallId, result);
    log.info({ agentId, providerCallId, amdResult: result }, "AMD result on answer webhook");
    return false;
  }

  // Untrusted provider AMD (VoBiz): a "machine" verdict here is too often a false
  // positive on a live human. Do NOT persist the raw flag and do NOT enact the
  // voicemail action. Open the normal media stream with a machine HINT so the
  // pipeline confirms acoustically first (never harming a human) and persists the
  // acoustically-confirmed verdict.
  if (acousticConfirmXml) {
    log.info(
      { agentId, providerCallId },
      "AMD machine hint (untrusted provider) — opening stream for acoustic confirmation; action deferred to pipeline",
    );
    res.set("Content-Type", "text/xml").send(acousticConfirmXml());
    return true;
  }

  // Trusted provider (Twilio/Plivo): the flag is reliable — persist + enact directly.
  await persistAmdResult(providerCallId, result);
  log.info({ agentId, providerCallId, amdResult: result }, "AMD result on answer webhook");

  let cfg = preloadedCfg;
  if (!cfg) {
    const [agent] = await db
      .select({ agentConfig: agentsTable.agentConfig })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId));
    cfg = (agent?.agentConfig ?? {}) as Record<string, unknown>;
  }
  const action  = (cfg["voicemailAction"]  as string | undefined) ?? "hangup";
  const message = (cfg["voicemailMessage"] as string | undefined) ?? DEFAULT_VOICEMAIL_MESSAGE;

  // Trusted providers (Twilio/Plivo) enact via static XML: an optional lead-in
  // <Pause>/<Wait> so the machine's greeting + beep complete, then the message and
  // hangup. (VoBiz never reaches here — its unreliable flag routes through the
  // acousticConfirmXml path above, where the pipeline confirms + delivers acoustically.)
  const leadInRaw = cfg["voicemailLeadInSeconds"];
  const leadIn = typeof leadInRaw === "number" && Number.isFinite(leadInRaw)
    ? leadInRaw
    : DEFAULT_VOICEMAIL_LEAD_IN_SECONDS;
  const xml = buildVoicemailXml(action, message, speakTag, leadIn);
  if (xml === null) return false; // "continue" → fall through and open the stream
  res.set("Content-Type", "text/xml").send(xml);
  return true;
}

/**
 * POST /api/webhooks/vobiz/voice
 * Resolution order:
 *   1. ?agentId= query param (outbound / legacy)
 *   2. `To` body → managed phone number → assigned agentId
 * Then applies P2-F routing rules → P2-E queue → P2-D IVR → P2-C recording.
 */
router.post("/webhooks/vobiz/voice", async (req, res): Promise<void> => {
  // Carrier answer/bridge time — captured the instant VoBiz hits the answer
  // webhook (i.e. the callee answered). Threaded into the WS URL (?ans=...) so
  // the session anchors BOTH the call duration clock and the recording timeline
  // to the real answer instant rather than media-stream connect, which arrives
  // several seconds later (answer → return XML → open WS → start → createSession).
  const answeredAtMs = Date.now();
  const wsBaseUrl = getWsBaseUrl(req);
  const httpBase  = getHttpBaseUrl(req);

  // Diagnostic: log every inbound webhook hit so we can confirm VoBiz is calling us
  req.log.info(
    { body: req.body, query: req.query, host: req.headers["x-forwarded-host"] ?? req.hostname, wsBaseUrl },
    "VoBiz voice webhook received"
  );

  let agentId = parseInt(String(req.query["agentId"] ?? "0"), 10);
  // ?pt=1 is appended by the outbound call handler (calls.ts) when the call is
  // made through a platform-managed VoBiz number; parse it here so the WebSocket
  // URL we return also carries pt=1 and the session uses managed provider keys.
  let platformTelephony = req.query["pt"] === "1";
  type RoutingRule = {
    condition: "caller_prefix" | "time_range" | "always";
    value?: string; startHour?: number; endHour?: number; targetAgentId: number;
  };
  let routingRules: RoutingRule[] | null = null;

  if (!agentId) {
    const toRaw: string = String(req.body?.To ?? req.body?.to ?? "").trim();
    if (toRaw) {
      // VoBiz delivers the dialed number in several shapes across carriers/routes:
      // E.164 with '+' ("+917971442376"), bare with country code ("917971442376"),
      // or — the one that used to silently miss — national trunk format with a
      // leading '0' and NO country code ("07971442376"). The DB stores the E.164
      // form, so we build every candidate: raw, the +/no-+ flip, and the canonical
      // form (`canonicalizeCallerKey` drops the trunk 0 and adds the default CC),
      // both with and without a leading '+'. Matching any one resolves the agent.
      const candidates = new Set<string>();
      const addCandidate = (v: string | null | undefined): void => {
        const s = (v ?? "").trim();
        if (s) candidates.add(s);
      };
      addCandidate(toRaw);
      addCandidate(toRaw.startsWith("+") ? toRaw.slice(1) : `+${toRaw}`);
      const canonTo = canonicalizeCallerKey(toRaw); // "07971442376" -> "917971442376"
      addCandidate(canonTo);
      if (canonTo) addCandidate(`+${canonTo}`);
      const [pn] = await db
        .select({ agentId: phoneNumbersTable.agentId, routingRules: phoneNumbersTable.routingRules })
        .from(phoneNumbersTable)
        .where(inArray(phoneNumbersTable.number, [...candidates]));
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

  const campaignLeadId = req.query["campaignLeadId"] ? parseInt(String(req.query["campaignLeadId"]), 10) : undefined;
  // Opaque per-call correlation token minted at outbound dial (calls.ts). Threaded
  // into the answer XML / WS URL so the WS session reconciles the pre-created exec_*
  // record by it. Absent on inbound/campaign calls (those reconcile differently).
  const corr = req.query["corr"] ? String(req.query["corr"]) : undefined;
  const callDirection: "inbound" | "outbound" = req.query["dir"] === "out" ? "outbound" : "inbound";
  // Scheduled callback row ID — present when the call was fired by the callback
  // poller (network_drop / callback_requested). Threaded into the WS URL so the
  // WS handler can load the prior call's resumeContext for context injection.
  const answerCbId = req.query["cbId"] ? (parseInt(String(req.query["cbId"]), 10) || undefined) : undefined;
  const inboundFrom = String(req.body?.From ?? req.body?.from ?? "").trim() || undefined;
  const inboundTo   = String(req.body?.To   ?? req.body?.to   ?? "").trim() || undefined;

  // ── AMD gating ───────────────────────────────────────────────────────────
  // Synchronous AMD (Vobiz Plivo-compatible API): the machine flag is delivered
  // on this answer request. VoBiz's machine detection is UNRELIABLE and false-
  // positives on live humans (answered call → ~12 s dead air + a dropped voicemail
  // message; call 1320), so a "machine" flag is treated as an INITIAL HINT only:
  // the normal media stream is opened (never harming a human) and the pipeline
  // confirms the verdict acoustically before enacting any voicemail action.
  const rawMachineField = req.body?.MachineDetected ?? req.body?.Machine ?? req.body?.machine;
  if (rawMachineField !== undefined && rawMachineField !== null && rawMachineField !== "") {
    req.log.info(
      { agentId, MachineDetected: req.body?.MachineDetected, Machine: req.body?.Machine, machine: req.body?.machine },
      "VoBiz raw machine-detection fields on answer webhook (treated as a HINT — confirmed acoustically in-pipeline)",
    );
  }

  // Hint-INDEPENDENT arming: per VoBiz docs, `machine_detection=true` does NOT
  // deliver the verdict to the answer webhook — it arrives via the asynchronous
  // machine_detection_url callback (handled by /webhooks/vobiz/amd, which feeds
  // the live session). So for every AMD-enabled VoBiz OUTBOUND call we open the
  // media stream with acoustic confirmation armed unconditionally: the pipeline
  // holds the greeting briefly, analyses the callee's speech-energy pattern
  // (Task #1267 heuristics), lets the async callback corroborate mid-window, and
  // only a confirmed machine enacts the configured voicemailAction. A live human
  // resolves within ~1.5 s of silence or a short "hello?" — no perceptible delay.
  // Queue/IVR are inbound-facing features and are intentionally bypassed here
  // (the previous machine-hint path already bypassed them).
  if (callDirection === "outbound" && resolveAmdConfig(cfg).enabled) {
    const answerCallUuid = String(req.body?.CallUUID ?? req.body?.call_uuid ?? "") || undefined;
    req.log.info(
      { agentId, callUuid: answerCallUuid, hint: parseMachineFlag(rawMachineField) },
      "AMD enabled (VoBiz outbound) — arming acoustic confirmation unconditionally; async machine_detection_url callback will corroborate",
    );
    res.set("Content-Type", "text/xml").send(
      getVobizAnswerXML(wsBaseUrl, agentId, platformTelephony, {
        campaignLeadId, from: inboundFrom, to: inboundTo,
        amdArm: true,
        amdMachineHint: parseMachineFlag(rawMachineField) === "machine",
        callDirection, corr,
        callUuid: answerCallUuid,
        cbId: answerCbId,
        answeredAt: answeredAtMs,
      }),
    );
    return;
  }

  const amdHandled = await applyAmdGate({
    res, log: req.log, agentId,
    providerCallId: String(req.body?.CallUUID ?? req.body?.call_uuid ?? ""),
    result: parseMachineFlag(req.body?.MachineDetected ?? req.body?.Machine ?? req.body?.machine),
    speakTag: "Speak",
    preloadedCfg: cfg,
    // VoBiz AMD is unreliable: a "machine" flag opens the normal media stream carrying
    // an amdHint=machine marker so the pipeline confirms the verdict acoustically before
    // enacting any voicemail action — a live human is never harmed.
    acousticConfirmXml: () => getVobizAnswerXML(wsBaseUrl, agentId, platformTelephony, {
      campaignLeadId, from: inboundFrom, to: inboundTo, amdMachineHint: true, callDirection, corr,
      callUuid: String(req.body?.CallUUID ?? req.body?.call_uuid ?? "") || undefined,
      answeredAt: answeredAtMs,
    }),
  });
  if (amdHandled) return;

  // P2-E: Queue — check if agent is at capacity, hold caller if so
  if (cfg["queueEnabled"] === true) {
    const maxConcurrent = Number(cfg["queueMaxConcurrent"] ?? 1);
    const waitSec       = Number(cfg["queueWaitSeconds"] ?? 30);
    const holdUrl       = String(cfg["queueHoldMusicUrl"] ?? "");
    const [countRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(callsTable)
      .where(sql`agent_id = ${agentId} AND status = 'in_progress'`);
    if ((countRow?.n ?? 0) >= maxConcurrent) {
      const holdPart = holdUrl
        ? `\n  <Play loop="10">${escapeXml(holdUrl)}</Play>`
        : `\n  <Speak>All agents are busy. Please hold.</Speak>\n  <Wait length="${waitSec}" />`;
      // Preserve direction + campaign/platform context across the redirect so the
      // re-entry into /vobiz/voice keys caller memory off the correct party.
      const ctxQs = `${platformTelephony ? "&pt=1" : ""}${campaignLeadId ? `&campaignLeadId=${campaignLeadId}` : ""}${callDirection === "outbound" ? "&dir=out" : ""}${corr ? `&corr=${encodeURIComponent(corr)}` : ""}`;
      const redirectUrl = `${httpBase}/api/webhooks/vobiz/voice?agentId=${agentId}${ctxQs}`;
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
    // Preserve direction + campaign/platform context through the IVR menu so the
    // digit-callback and the fallback re-entry both key caller memory correctly.
    const ctxQs = `${platformTelephony ? "&pt=1" : ""}${campaignLeadId ? `&campaignLeadId=${campaignLeadId}` : ""}${callDirection === "outbound" ? "&dir=out" : ""}${corr ? `&corr=${encodeURIComponent(corr)}` : ""}`;
    const ivrAction   = `${httpBase}/api/webhooks/vobiz/ivr?agentId=${agentId}${ctxQs}`;
    const fallbackUrl = `${httpBase}/api/webhooks/vobiz/voice?agentId=${agentId}${ctxQs}`;
    res.set("Content-Type", "text/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <GetDigits action="${escapeXml(ivrAction)}" method="GET" timeout="5" numDigits="1" retries="2">\n    <Speak>${spoken}</Speak>\n  </GetDigits>\n  <Redirect method="POST">${escapeXml(fallbackUrl)}</Redirect>\n</Response>`
    );
    return;
  }

  // Cancel pending auto-redials when the caller rings us first (they're reachable)
  if (inboundFrom) void cancelPendingRedials(agentId, inboundFrom);
  res.set("Content-Type", "text/xml").send(
    getVobizAnswerXML(wsBaseUrl, agentId, platformTelephony, {
      campaignLeadId, from: inboundFrom, to: inboundTo, callDirection, corr,
      callUuid: String(req.body?.CallUUID ?? req.body?.call_uuid ?? "") || undefined,
      cbId: answerCbId,
      answeredAt: answeredAtMs,
    })
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
  // Preserve the call context carried through the IVR menu so caller memory is
  // keyed off the correct party once the AI stream opens. Without dir=out an
  // outbound call routed through IVR would revert to the inbound default and key
  // memory off the shared platform From number.
  const platformTelephony = req.query["pt"] === "1";
  const campaignLeadId = req.query["campaignLeadId"] ? parseInt(String(req.query["campaignLeadId"]), 10) : undefined;
  const corr = req.query["corr"] ? String(req.query["corr"]) : undefined;
  const callDirection: "inbound" | "outbound" = req.query["dir"] === "out" ? "outbound" : "inbound";
  req.log.info({ agentId, digits, callDirection }, "VoBiz IVR digit received");

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
  // After the IVR digit the AI stream is about to open, so the greeting the
  // caller hears starts now — anchor the recording/duration clock here (the
  // pre-menu answer time would count the menu interaction as agent dead air).
  const answeredAtMs = Date.now();
  res.set("Content-Type", "text/xml").send(
    getVobizAnswerXML(wsBase, targetAgentId, platformTelephony, { campaignLeadId, callDirection, corr, answeredAt: answeredAtMs }),
  );
});

// ── VoBiz status callbacks ───────────────────────────────────────────────────

router.post("/webhooks/vobiz/status", (req, res): void => {
  req.log.info({ body: req.body, query: req.query }, "VoBiz status callback");
  res.sendStatus(204);

  // Validate before scheduling any outbound calls. Fire-and-forget so 204 is immediate.
  // cbId path  — look up scheduledCallbacks for agentId+toNumber from DB (trusted); also
  //              pass cbSecret so handleNoAnswerStatus can validate the per-row token.
  // non-cbId   — verify a real call record exists in DB before scheduling any redial;
  //              toNumber always from DB, never from attacker-controlled request body.
  (async () => {
    const cbId            = parseInt(String(req.query["cbId"]            ?? "0"), 10) || null;
    const cbSig           = String(req.query["cbSig"]           ?? "");
    const campaignLeadId  = parseInt(String(req.query["campaignLeadId"]  ?? "0"), 10) || 0;
    const campaignLeadSig = String(req.query["campaignLeadSig"] ?? "");
    const callStatus      = String(req.body?.CallStatus ?? req.body?.callstatus ?? req.body?.call_status ?? "");
    // callUuid is attacker-controlled — used only as a lookup key and length-validated.
    // toNumber is NEVER taken from the request body; always derived from the DB record.
    const callUuid   = String(req.body?.CallUUID ?? req.body?.call_uuid ?? "");

    let agentId: number | null = null;
    let dbToNumber: string | null = null;

    if (cbId) {
      // Scheduler-fired retry path. VoBiz has no request signature, so we rely on a
      // HMAC(APP_SECRET, "cbid:<id>") embedded in the hangupUrl at call-creation time
      // (callbackScheduler.ts). Validate it before any DB read or scheduling action.
      const expectedSig = createHmac("sha256", APP_SECRET).update(`cbid:${cbId}`).digest("hex");
      const sigValid =
        cbSig.length === expectedSig.length &&
        timingSafeEqual(Buffer.from(cbSig), Buffer.from(expectedSig));
      if (!sigValid) {
        logger.warn({ cbId }, "VoBiz status: cbSig invalid or missing — ignoring");
        return;
      }
      const [cb] = await db.select({ agentId: scheduledCallbacksTable.agentId, toNumber: scheduledCallbacksTable.toNumber })
        .from(scheduledCallbacksTable)
        .where(eq(scheduledCallbacksTable.id, cbId));
      if (!cb) {
        logger.warn({ cbId }, "VoBiz status: cbId not found in DB — ignoring");
        return;
      }
      agentId    = cb.agentId;
      dbToNumber = cb.toNumber;
    } else {
      // ── Campaign lead path (busy/no-answer/failed before connection) ──────────
      // Check campaignLeadId FIRST — before requiring CallUUID — because VoBiz
      // may omit CallUUID in the body of a busy/failed status callback, which
      // previously caused the callUuid length gate to silently discard the event
      // and never schedule a retry.
      if (campaignLeadId > 0) {
        const expectedSig = createHmac("sha256", APP_SECRET).update(`campaignlead:${campaignLeadId}`).digest("hex");
        const sigValid =
          campaignLeadSig.length === expectedSig.length &&
          timingSafeEqual(Buffer.from(campaignLeadSig), Buffer.from(expectedSig));
        if (!sigValid) {
          logger.warn({ campaignLeadId }, "VoBiz status: campaignLeadSig invalid — ignoring");
          return;
        }
        await handleCampaignLeadTerminalStatus({ campaignLeadId, rawCallStatus: callStatus });
        return;
      }

      // ── Non-campaign call: must anchor to a call record via CallUUID ──────────
      // Require UUID-length identifier (VoBiz UUIDs are 36 chars) to prevent
      // trivial substring-match attacks with short/common tokens.
      if (!callUuid || callUuid.length < 20) {
        logger.warn({ callUuid, bodyKeys: Object.keys(req.body ?? {}) }, "VoBiz status: missing or too-short CallUUID — ignoring");
        return;
      }
      const [call] = await db.select({ id: callsTable.id, agentId: callsTable.agentId, toNumber: callsTable.toNumber })
        .from(callsTable)
        .where(and(
          sql`metadata::text like ${"%" + callUuid + "%"}`,
          gte(callsTable.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)), // within 24 h
        ))
        .limit(1);
      if (!call) {
        logger.warn({ callUuid }, "VoBiz status: no matching call in DB — ignoring");
        return;
      }
      agentId    = call.agentId;
      dbToNumber = call.toNumber;
      // Update the calls table row so it reflects the real outcome instead of
      // staying "in_progress" forever when a pre-answer rejection arrives here.
      const vobizTerminal = mapRawStatusToLeadStatus(callStatus);
      if (vobizTerminal && vobizTerminal !== "ignore") {
        await db.update(callsTable)
          .set({ status: vobizTerminal, endedAt: new Date() })
          .where(and(eq(callsTable.id, call.id), eq(callsTable.status, "in_progress")));
        logger.info({ callId: call.id, callStatus, vobizTerminal }, "VoBiz status: updated calls table for non-campaign terminal call");
      }
    }

    if (!dbToNumber) {
      logger.warn({ cbId, callUuid, agentId }, "VoBiz status: could not resolve toNumber from DB — ignoring");
      return;
    }

    void handleNoAnswerStatus({ cbId, cbSecret: null, agentId, callStatus, toNumber: dbToNumber });
  })().catch((err) => logger.error({ err }, "VoBiz status webhook handler error"));
});

// ── Twilio status callbacks ──────────────────────────────────────────────────

router.post("/webhooks/twilio/status", async (req, res): Promise<void> => {
  req.log.info({ body: req.body, query: req.query }, "Twilio status callback");

  res.sendStatus(204);

  // Validate before scheduling any outbound calls. Fire-and-forget so 204 is immediate.
  // agentId and toNumber are always resolved from DB — never trusted from query params / body.
  (async () => {
    const cbId            = parseInt(String(req.query["cbId"]            ?? "0"), 10) || null;
    const cbSig           = String(req.query["cbSig"]           ?? "");
    const campaignLeadId  = parseInt(String(req.query["campaignLeadId"]  ?? "0"), 10) || 0;
    const campaignLeadSig = String(req.query["campaignLeadSig"] ?? "");
    const callStatus      = String(req.body?.CallStatus ?? "");
    // CallSid is attacker-controlled in the body — used only as a lookup key and length-validated.
    // toNumber is NEVER taken from the request body; it is always derived from the DB record.
    const callSid    = String(req.body?.CallSid ?? "");

    let agentId: number | null = null;
    let dbToNumber: string | null = null;

    if (cbId) {
      // Scheduler-fired retry: validate the URL-embedded HMAC before any DB read.
      // When authToken is available, Twilio's request signature (validated below) also
      // covers cbId. But cbSig provides defence-in-depth for managed-plan calls where
      // authToken may be absent or unavailable at signature validation time.
      const expectedSig = createHmac("sha256", APP_SECRET).update(`cbid:${cbId}`).digest("hex");
      const sigValid =
        cbSig.length === expectedSig.length &&
        timingSafeEqual(Buffer.from(cbSig), Buffer.from(expectedSig));
      if (!sigValid) {
        logger.warn({ cbId }, "Twilio status: cbSig invalid or missing — ignoring");
        return;
      }
      const [cb] = await db.select({ agentId: scheduledCallbacksTable.agentId, toNumber: scheduledCallbacksTable.toNumber })
        .from(scheduledCallbacksTable)
        .where(eq(scheduledCallbacksTable.id, cbId));
      if (!cb) {
        logger.warn({ cbId }, "Twilio status: cbId not found in DB — ignoring");
        return;
      }
      agentId    = cb.agentId;
      dbToNumber = cb.toNumber;
    } else {
      // Resolve agentId and toNumber from the real call record keyed on Twilio's
      // CallSid — never from the query string, which an attacker controls.
      // Twilio SIDs start with "CA" and are 34 chars; require at least 20 chars to
      // prevent broad substring-match attacks with short/common tokens.
      if (!callSid || callSid.length < 20) {
        logger.warn({ body: req.body }, "Twilio status: missing or too-short CallSid — ignoring");
        return;
      }
      const [call] = await db.select({ id: callsTable.id, agentId: callsTable.agentId, toNumber: callsTable.toNumber })
        .from(callsTable)
        .where(and(
          sql`metadata::text like ${"%" + callSid + "%"}`,
          gte(callsTable.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)), // within 24 h
        ))
        .limit(1);
      if (!call) {
        // No DB call record — this is an unanswered campaign call (busy/no-answer/failed).
        // Validate the HMAC embedded at call-creation time before mutating any state.
        if (campaignLeadId > 0) {
          const expectedSig = createHmac("sha256", APP_SECRET).update(`campaignlead:${campaignLeadId}`).digest("hex");
          const sigValid =
            campaignLeadSig.length === expectedSig.length &&
            timingSafeEqual(Buffer.from(campaignLeadSig), Buffer.from(expectedSig));
          if (!sigValid) {
            logger.warn({ campaignLeadId }, "Twilio status: campaignLeadSig invalid — ignoring");
            return;
          }
          await handleCampaignLeadTerminalStatus({ campaignLeadId, rawCallStatus: callStatus });
        } else {
          logger.warn({ callSid }, "Twilio status: no matching call in DB — ignoring");
        }
        return;
      }
      agentId    = call.agentId;
      dbToNumber = call.toNumber;
      // Update the calls table row so rejected/no-answer calls don't stay "in_progress".
      const twilioTerminal = mapRawStatusToLeadStatus(callStatus);
      if (twilioTerminal && twilioTerminal !== "ignore") {
        await db.update(callsTable)
          .set({ status: twilioTerminal, endedAt: new Date() })
          .where(and(eq(callsTable.id, call.id), eq(callsTable.status, "in_progress")));
        logger.info({ callId: call.id, callStatus, twilioTerminal }, "Twilio status: updated calls table for non-campaign terminal call");
      }
    }

    if (!dbToNumber) {
      logger.warn({ cbId, callSid, agentId }, "Twilio status: could not resolve toNumber from DB — ignoring");
      return;
    }

    // In production, validate the Twilio request signature using the agent's auth token
    if (IS_PROD && agentId) {
      const authToken = await getAgentProviderToken(agentId, "twilio");
      if (authToken) {
        const twilioSig = String(req.headers["x-twilio-signature"] ?? "");
        if (!twilioSig) {
          logger.warn({ agentId, callSid }, "Twilio status: missing X-Twilio-Signature — ignoring");
          return;
        }
        const proto    = String(req.headers["x-forwarded-proto"] ?? "https");
        const host     = String(req.headers["x-forwarded-host"] ?? req.hostname);
        const queryStr = (req.url?.split("?")[1] ?? "");
        const fullUrl  = `${proto}://${host}${req.path}${queryStr ? "?" + queryStr : ""}`;
        const bodyParams: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.body as Record<string, unknown>)) {
          if (typeof v === "string") bodyParams[k] = v;
        }
        if (!validateTwilioSignature(authToken, fullUrl, bodyParams, twilioSig)) {
          logger.warn({ agentId, callSid, fullUrl }, "Twilio status: signature invalid — ignoring");
          return;
        }
      }
    }

    void handleNoAnswerStatus({ cbId, cbSecret: null, agentId, callStatus, toNumber: dbToNumber });
  })().catch((err) => logger.error({ err }, "Twilio status webhook handler error"));
});

// ── P2-B: AMD / Voicemail Detection callback (async, in-call trigger) ────────
// Per VoBiz docs this is the ONLY channel that delivers the machine-detection
// verdict (`machine_detection=true` alone does NOT put it on the answer webhook).
// This is set as `machine_detection_url` on every AMD-enabled outbound dial.
// Body fields: Machine/MachineDetected ("true"/"false"), CallUUID, RequestUUID,
// Event=MachineDetection. Query param: agentId (set at dial time, diagnostic).
//
// Flow: resolve the LIVE session (CallUUID → session.externalCallId, falling
// back to RequestUUID/CallUUID → call-record metadata → session by call id) and
// feed the verdict into the pipeline's acoustic-confirmation state machine via
// onExternalAmdSignal(). The verdict is a corroborating input, NOT blindly
// trusted: a "machine" callback lowers the acoustic bar but still requires
// speech-energy corroboration; a "human" callback resolves human immediately.
// Late/duplicate callbacks after the window has resolved are logged + ignored
// by the pipeline (single-resolution). If no live session is found, fall back
// to best-effort persistence of the raw flag (legacy behavior).

router.post("/webhooks/vobiz/amd", async (req, res): Promise<void> => {
  const machineFlag = parseMachineFlag(req.body?.MachineDetected ?? req.body?.Machine ?? req.body?.machine);
  const callUuid    = String(req.body?.CallUUID    ?? req.body?.call_uuid    ?? "");
  const requestUuid = String(req.body?.RequestUUID ?? req.body?.request_uuid ?? "");
  req.log.info(
    { callUuid, requestUuid, machineFlag, event: req.body?.Event, agentId: req.query["agentId"] ?? null },
    "VoBiz AMD callback received",
  );
  if (!machineFlag) { res.sendStatus(204); return; }

  // 1. Direct match: the answer-webhook CallUUID is threaded into createSession
  //    as externalCallId — the fastest and most common lookup.
  let session = callUuid ? getSessionByExternalCallId(callUuid) : undefined;
  let matchedBy = session ? "callUuid" : null;

  // 2. Fallback: correlate via the call record's metadata (calls.ts persists the
  //    dial-response requestUuid; the WS session writes providerCallId/externalCallId),
  //    then find the live session by DB call id. Covers UUID-plane mismatches.
  if (!session) {
    for (const needle of [requestUuid, callUuid]) {
      if (!needle) continue;
      try {
        const [row] = await db
          .select({ id: callsTable.id })
          .from(callsTable)
          .where(sql`metadata::text like ${"%" + needle + "%"}`)
          .limit(1);
        if (row) {
          session = getSessionByCallId(row.id);
          if (session) { matchedBy = needle === requestUuid ? "requestUuid" : "callUuid-metadata"; break; }
        }
      } catch { /* non-critical — fall through */ }
    }
  }

  if (session) {
    req.log.info(
      { callUuid, requestUuid, matchedBy, machineFlag, callId: session.callId },
      "VoBiz AMD callback → feeding live session's acoustic confirmation",
    );
    // Do NOT persist the raw flag here — the pipeline persists the CONFIRMED
    // verdict once its confirmation window resolves (single resolution).
    session.pipeline.onExternalAmdSignal(machineFlag === "machine" ? "machine" : "human", "vobiz-callback");
    res.sendStatus(204);
    return;
  }

  // No live session (late callback, call already ended, or pre-session race) —
  // best-effort persistence so the call record still reflects the raw verdict.
  req.log.info({ callUuid, requestUuid, machineFlag }, "VoBiz AMD callback — no live session; persistence-only");
  await persistAmdResult(callUuid || requestUuid, machineFlag);
  res.sendStatus(204);
});

// ── P2-A: Transfer XML callbacks ──────────────────────────────────────────────
// Each provider fetches one of these after a transfer is initiated.
// Returns XML/TwiML with a <Dial> to connect the caller to the target number.

import {
  buildTransferXml,
  buildTwilioTransferTwiML,
  buildPlivoTransferXml,
  buildTwilioWarmTransferTwiML,
  buildPlivoWarmTransferXml,
  buildVobizWarmTransferXml,
} from "../orchestration/telephony/transfer.js";
import { callTransfersTable } from "@workspace/db";

router.get("/webhooks/vobiz/transfer-xml", (req, res): void => {
  const target = String(req.query["target"] ?? "").trim();
  const callerId = String(req.query["callerId"] ?? "").trim() || undefined;
  if (!target) {
    res.status(400).set("Content-Type", "text/xml")
      .send("<Response><Speak>Transfer target missing.</Speak><Hangup/></Response>");
    return;
  }
  res.set("Content-Type", "text/xml").send(buildTransferXml(target, callerId));
});

router.get("/webhooks/twilio/transfer-xml", (req, res): void => {
  const target = String(req.query["target"] ?? "").trim();
  if (!target) {
    res.status(400).set("Content-Type", "text/xml")
      .send("<Response><Say>Transfer target missing.</Say><Hangup/></Response>");
    return;
  }
  res.set("Content-Type", "text/xml").send(buildTwilioTransferTwiML(target));
});

router.get("/webhooks/plivo/transfer-xml", (req, res): void => {
  const target = String(req.query["target"] ?? "").trim();
  if (!target) {
    res.status(400).set("Content-Type", "text/xml")
      .send("<Response><Speak>Transfer target missing.</Speak><Hangup/></Response>");
    return;
  }
  res.set("Content-Type", "text/xml").send(buildPlivoTransferXml(target));
});

// ── P2-B: Warm transfer XML — redirects caller leg + sets whisper URL on operator leg ──
// Provider fetches this after onCallTransfer fires with a summary.
// The briefingToken is generated server-side at transfer creation and embedded in this
// URL by session.ts — it is NOT minted here. warm-transfer-xml just passes it through
// to the whisper URL so the warm-briefing-xml endpoint can validate it against the DB.
// This eliminates the HMAC-from-transferId public token oracle: an attacker supplying an
// arbitrary transferId gets nothing useful because no token is computed from it here.

router.get("/webhooks/twilio/warm-transfer-xml", (req, res): void => {
  const target     = String(req.query["target"] ?? "").trim();
  const transferId = String(req.query["transferId"] ?? "").trim();
  const token      = String(req.query["token"] ?? "").trim();
  if (!target || !transferId || !token) {
    res.status(400).set("Content-Type", "text/xml")
      .send("<Response><Say>Warm transfer parameters missing.</Say><Hangup/></Response>");
    return;
  }
  const baseUrl = getSelfBaseUrl();
  const whisperUrl = `${baseUrl}/api/webhooks/twilio/warm-briefing-xml?transferId=${encodeURIComponent(transferId)}&token=${encodeURIComponent(token)}`;
  res.set("Content-Type", "text/xml").send(buildTwilioWarmTransferTwiML(target, whisperUrl));
});

router.get("/webhooks/plivo/warm-transfer-xml", (req, res): void => {
  const target     = String(req.query["target"] ?? "").trim();
  const transferId = String(req.query["transferId"] ?? "").trim();
  const token      = String(req.query["token"] ?? "").trim();
  if (!target || !transferId || !token) {
    res.status(400).set("Content-Type", "text/xml")
      .send("<Response><Speak>Warm transfer parameters missing.</Speak><Hangup/></Response>");
    return;
  }
  const baseUrl = getSelfBaseUrl();
  const whisperUrl = `${baseUrl}/api/webhooks/plivo/warm-briefing-xml?transferId=${encodeURIComponent(transferId)}&token=${encodeURIComponent(token)}`;
  res.set("Content-Type", "text/xml").send(buildPlivoWarmTransferXml(target, whisperUrl));
});

router.get("/webhooks/vobiz/warm-transfer-xml", (req, res): void => {
  const target     = String(req.query["target"] ?? "").trim();
  const transferId = String(req.query["transferId"] ?? "").trim();
  const token      = String(req.query["token"] ?? "").trim();
  const callerId   = String(req.query["callerId"] ?? "").trim() || undefined;
  if (!target || !transferId || !token) {
    res.status(400).set("Content-Type", "text/xml")
      .send("<Response><Speak>Warm transfer parameters missing.</Speak><Hangup/></Response>");
    return;
  }
  const baseUrl = getSelfBaseUrl();
  const whisperUrl = `${baseUrl}/api/webhooks/vobiz/warm-briefing-xml?transferId=${encodeURIComponent(transferId)}&token=${encodeURIComponent(token)}`;
  res.set("Content-Type", "text/xml").send(buildVobizWarmTransferXml(target, whisperUrl, callerId));
});

// ── P2-C: Warm briefing XML — spoken to the OPERATOR only when they answer ────
// Provider fetches this when the <Number url="..."> destination picks up.
// Returns <Say> with the AI-generated summary so the operator is fully briefed
// before the customer is bridged in.
//
// Security: validates the `token` query param against the `briefing_token` column stored
// in the call_transfers row at transfer creation. The token is a 32-byte random hex value
// that is never recomputable from public inputs, so sequential transferId enumeration
// cannot yield a usable token. Without a valid token the endpoint returns 403.

/**
 * Twilio uses <Say>; Plivo & VoBiz (Plivo-compatible) use <Speak>. Emitting the
 * wrong verb is silently ignored by the provider, so the human agent gets bridged
 * in with NO briefing — defeating the whole point of a context-aware/warm transfer.
 */
function speakVerb(provider: "twilio" | "plivo" | "vobiz", text: string): string {
  return provider === "twilio"
    ? `<Say voice="Polly.Joanna">${text}</Say>`
    : `<Speak>${text}</Speak>`;
}

async function warmBriefingXml(
  transferId: number,
  token: string,
  res: import("express").Response,
  provider: "twilio" | "plivo" | "vobiz",
): Promise<void> {
  const forbidden = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  ${speakVerb(provider, "Forbidden.")}\n  <Hangup/>\n</Response>`;
  // Reject immediately if token looks unusable (saves a DB round-trip)
  if (!token || token.length < 32) {
    res.status(403).set("Content-Type", "text/xml").send(forbidden);
    return;
  }


  try {
    const [row] = await db
      .select({ summary: callTransfersTable.summary, briefingToken: callTransfersTable.briefingToken })
      .from(callTransfersTable)
      .where(eq(callTransfersTable.id, transferId));

    // Validate capability token against DB-stored random value using constant-time compare
    const stored = row?.briefingToken ?? "";
    const tokenBuf   = Buffer.from(token);
    const storedBuf  = Buffer.from(stored);
    const tokenValid =
      stored.length > 0 &&
      tokenBuf.length === storedBuf.length &&
      timingSafeEqual(tokenBuf, storedBuf);
    if (!tokenValid) {
      logger.warn({ transferId }, "warm-briefing-xml: invalid or missing token — rejected");
      res.status(403).set("Content-Type", "text/xml").send(forbidden);
      return;
    }

    const summary = row?.summary?.trim()
      || "A customer is being transferred to you. Please assist them.";
    const escaped = summary
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    res.set("Content-Type", "text/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  ${speakVerb(provider, escaped)}\n</Response>`
    );
    // PROOF the provider actually fetched the operator-whisper URL. If this line is
    // absent after a warm transfer, the provider (e.g. VoBiz) silently ignored the
    // <Number url="…"> whisper attribute and the operator was bridged with NO briefing.
    logger.info(
      { transferId, provider, summaryLen: summary.length },
      "warm-briefing-xml: briefing served to operator leg",
    );
    // Mark transfer as connected now that operator answered
    void db.update(callTransfersTable)
      .set({ status: "connected", connectedAt: new Date() })
      .where(eq(callTransfersTable.id, transferId))
      .catch(() => {/* non-fatal */});
  } catch (err) {
    res.set("Content-Type", "text/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  ${speakVerb(provider, "A customer is being transferred to you.")}\n</Response>`
    );
  }
}

router.get("/webhooks/twilio/warm-briefing-xml", async (req, res): Promise<void> => {
  const id    = parseInt(String(req.query["transferId"] ?? ""), 10);
  const token = String(req.query["token"] ?? "");
  if (!id) { res.status(400).send("Missing transferId"); return; }
  await warmBriefingXml(id, token, res, "twilio");
});

router.get("/webhooks/plivo/warm-briefing-xml", async (req, res): Promise<void> => {
  const id    = parseInt(String(req.query["transferId"] ?? ""), 10);
  const token = String(req.query["token"] ?? "");
  if (!id) { res.status(400).send("Missing transferId"); return; }
  await warmBriefingXml(id, token, res, "plivo");
});

router.get("/webhooks/vobiz/warm-briefing-xml", async (req, res): Promise<void> => {
  const id    = parseInt(String(req.query["transferId"] ?? ""), 10);
  const token = String(req.query["token"] ?? "");
  if (!id) { res.status(400).send("Missing transferId"); return; }
  await warmBriefingXml(id, token, res, "vobiz");
});

// ── Recording callbacks ────────────────────────────────────────────────────────

// Twilio posts here when a recording is ready (RecordingStatusCallback).
router.post("/webhooks/twilio/recording", async (req, res): Promise<void> => {
  const recordingUrl = String(req.body?.RecordingUrl ?? "");
  const callSid      = String(req.body?.CallSid ?? "");
  req.log.info({ recordingUrl, callSid }, "Twilio recording callback");
  if (recordingUrl && callSid) {
    try {
      await db.update(callsTable)
        .set({ recordingUrl })
        .where(sql`metadata::text like ${"%" + callSid + "%"}`);
    } catch (err) {
      req.log.error({ err }, "Failed to save Twilio recording URL");
    }
  }
  res.sendStatus(204);
});

// Plivo posts here when a recording is ready (record_action / on_record_end).
router.post("/webhooks/plivo/recording", async (req, res): Promise<void> => {
  const recordingUrl = String(req.body?.RecordUrl ?? req.body?.record_url ?? "");
  const callUuid     = String(req.body?.CallUUID ?? req.body?.call_uuid ?? "");
  req.log.info({ recordingUrl, callUuid }, "Plivo recording callback");
  if (recordingUrl && callUuid) {
    try {
      await db.update(callsTable)
        .set({ recordingUrl })
        .where(sql`metadata::text like ${"%" + callUuid + "%"}`);
    } catch (err) {
      req.log.error({ err }, "Failed to save Plivo recording URL");
    }
  }
  res.sendStatus(204);
});

// ── AMD callbacks — Twilio / Plivo ────────────────────────────────────────────

// Twilio posts here when MachineDetection fires (AnsweredBy field).
// AMD is now resolved synchronously on /twilio/voice, which gates the call flow
// there. This async callback is retained only as a best-effort persistence sink.
router.post("/webhooks/twilio/amd", async (req, res): Promise<void> => {
  const result  = parseTwilioAnsweredBy(String(req.body?.AnsweredBy ?? ""));
  const callSid = String(req.body?.CallSid ?? "");
  req.log.info({ callSid, result }, "Twilio AMD callback (persistence-only)");
  if (result) await persistAmdResult(callSid, result);
  res.sendStatus(204);
});

// Plivo posts here when machine_detection fires.
// AMD is now resolved synchronously on /plivo/voice, which gates the call flow
// there. This async callback is retained only as a best-effort persistence sink.
router.post("/webhooks/plivo/amd", async (req, res): Promise<void> => {
  const result   = parseMachineFlag(req.body?.Machine ?? req.body?.machine);
  const callUuid = String(req.body?.CallUUID ?? req.body?.call_uuid ?? "");
  req.log.info({ callUuid, result }, "Plivo AMD callback (persistence-only)");
  if (result) await persistAmdResult(callUuid, result);
  res.sendStatus(204);
});

export default router;
