import type { WebSocket } from "ws";
import { createSession, getSession, endSession, failSession } from "../session.js";
import { toReadableError } from "../utils.js";
import { logger } from "../../lib/logger.js";
import { db, scheduledCallbacksTable, callsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { startEarlyAmbientKeepalive } from "./early-ambient.js";

/**
 * Twilio Media Streams WebSocket handler
 *
 * Flow:
 *   1. Twilio calls POST /api/webhooks/twilio/voice
 *   2. We return TwiML <Connect><Stream> pointing to this WS endpoint
 *   3. Twilio opens WS and sends base64 mulaw audio chunks
 *   4. We process audio → STT → LLM → TTS → send back mulaw
 *
 * Protocol: https://www.twilio.com/docs/voice/twiml/stream#message-types
 */

interface TwilioEvent {
  event: "connected" | "start" | "media" | "stop" | "mark";
  streamSid?: string;
  start?: {
    callSid: string;
    streamSid: string;
    accountSid: string;
    customParameters?: Record<string, string>;
  };
  media?: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string; // base64 mulaw
  };
}

export async function handleTwilioWebSocket(
  ws: WebSocket,
  agentId: number,
  campaignLeadId?: number,
  callDirection: "inbound" | "outbound" = "inbound",
  callbackId?: number,
): Promise<void> {
  let sessionId: string | null = null;
  let streamSid: string | null = null;
  let callSid: string | null = null;
  // True when Twilio sent "stop"/closed the socket while createSession was still
  // awaiting. sessionId was null then so endSession was skipped — detect it and end
  // the session as soon as sessionId is assigned so the record isn't stuck in_progress.
  let sessionEndedBeforeReady = false;

  function sendAudioToTwilio(audio: Buffer): void {
    if (!streamSid || ws.readyState !== ws.OPEN) return;
    const payload = audio.toString("base64");
    ws.send(JSON.stringify({
      event: "media",
      streamSid,
      media: { payload },
    }));
  }

  ws.on("message", async (raw: Buffer | string) => {
    let event: TwilioEvent;
    try {
      event = JSON.parse(raw.toString()) as TwilioEvent;
    } catch {
      return;
    }

    switch (event.event) {
      case "connected":
        logger.info({ agentId }, "Twilio WS connected");
        break;

      case "start": {
        streamSid = event.start?.streamSid ?? event.streamSid ?? null;
        callSid = event.start?.callSid ?? null;
        const params = event.start?.customParameters ?? {};
        const toNumber = params["To"] ?? "+10000000000";
        const fromNumber = params["From"] ?? "+10000000001";

        // Load resume context from prior call when this is a network-drop callback
        let resumeContext: Parameters<typeof createSession>[0]["resumeContext"] | undefined;
        if (callbackId) {
          try {
            const [cbRow] = await db
              .select({ reason: scheduledCallbacksTable.reason, createdFromCallId: scheduledCallbacksTable.createdFromCallId })
              .from(scheduledCallbacksTable)
              .where(eq(scheduledCallbacksTable.id, callbackId));
            if (cbRow?.reason === "network_drop" && cbRow.createdFromCallId) {
              const [priorCall] = await db
                .select({ resumeContext: callsTable.resumeContext })
                .from(callsTable)
                .where(eq(callsTable.id, cbRow.createdFromCallId));
              if (priorCall?.resumeContext) resumeContext = priorCall.resumeContext;
            }
          } catch (rcErr) {
            logger.warn({ callbackId, rcErr }, "Twilio: failed to load resume context — proceeding without it");
          }
        }

        // Also thread the callback reason into session state so endSession can
        // guard against re-scheduling another callback (single-retry invariant).
        let sourceCallbackReason: string | undefined;
        try {
          if (callbackId) {
            const [cbRow] = await db
              .select({ reason: scheduledCallbacksTable.reason })
              .from(scheduledCallbacksTable)
              .where(eq(scheduledCallbacksTable.id, callbackId));
            sourceCallbackReason = cbRow?.reason ?? undefined;
          }
        } catch { /* non-critical */ }

        // Ambient during createSession — Twilio previously sent nothing until the
        // pipeline existed, so the caller heard pure dead air (no agent bg noise).
        const earlyAmbient = startEarlyAmbientKeepalive({
          agentId,
          format: "mulaw",
          send: sendAudioToTwilio,
        });
        const stopEarlyAmbient = (): void => { earlyAmbient.stop(); };

        try {
          const { sessionId: sid } = await createSession({
            agentId,
            telephonyProvider: "twilio",
            toNumber,
            fromNumber,
            externalCallId: callSid ?? undefined,
            callDirection,
            campaignLeadId,
            resumeContext,
            sourceCallbackReason,
            scheduledCallbackId: callbackId,
            onAudioOut: (audio: Buffer) => {
              stopEarlyAmbient();
              sendAudioToTwilio(audio);
            },
            onCallEnd: () => {
              stopEarlyAmbient();
              // Do NOT close the WS if the call was transferred — the provider is
              // redirecting the leg to the human agent; a close frame aborts it.
              const sess = sessionId ? getSession(sessionId) : null;
              if (sess?.wasTransferred) {
                logger.info({ sessionId }, "Twilio onCallEnd: skipping ws.close() — call is being transferred");
                return;
              }
              ws.close();
            },
            onBargeIn: () => {
              // Clear any audio Twilio has buffered but not yet played
              if (streamSid && ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ event: "clear", streamSid }));
              }
            },
          });
          stopEarlyAmbient();
          sessionId = sid;
          if (sessionEndedBeforeReady) {
            logger.warn({ sessionId, agentId }, "Twilio session ended before setup completed — ending immediately");
            await endSession(sessionId);
          } else {
            logger.info({ sessionId, callSid, agentId }, "Twilio session started");
          }
        } catch (err) {
          stopEarlyAmbient();
          logger.error(
            { err, agentId, externalCallId: callSid, streamSid, provider: "twilio", reason: toReadableError(err, "Twilio session setup failed") },
            "Failed to create Twilio session — closing socket before greeting",
          );
          ws.close();
        }
        break;
      }

      case "media": {
        if (!sessionId || !event.media) break;
        const session = getSession(sessionId);
        if (!session) break;

        if (event.media.track === "inbound") {
          const chunk = Buffer.from(event.media.payload, "base64");
          session.pipeline.onAudioIn(chunk);
        }
        break;
      }

      case "stop":
        logger.info({ sessionId }, "Twilio stream stopped");
        if (sessionId) {
          getSession(sessionId)?.pipeline.noteMediaDropIfWaitingForReply();
          await endSession(sessionId);
        } else sessionEndedBeforeReady = true;
        break;
    }
  });

  ws.on("close", () => {
    logger.info({ sessionId }, "Twilio WS closed");
    if (sessionId) {
      getSession(sessionId)?.pipeline.noteMediaDropIfWaitingForReply();
      endSession(sessionId).catch((err: unknown) =>
        logger.error({ sessionId, err }, "Twilio WS close: endSession failed"),
      );
    } else {
      sessionEndedBeforeReady = true;
    }
  });

  ws.on("error", (err: unknown) => {
    logger.error({ sessionId, err }, "Twilio WS error");
    if (sessionId) {
      failSession(sessionId, toReadableError(err, "Telephony error")).catch((e: unknown) =>
        logger.error({ sessionId, err: e }, "Twilio WS error: failSession failed"),
      );
    } else {
      sessionEndedBeforeReady = true;
    }
  });
}

/** Generate TwiML to connect call to Media Streams WebSocket */
export function getTwilioVoiceTwiML(
  wsBaseUrl: string,
  agentId: number,
  campaignLeadId?: number,
  callDirection: "inbound" | "outbound" = "inbound",
  callbackId?: number,
): string {
  const parts: string[] = [];
  if (campaignLeadId) parts.push(`campaignLeadId=${campaignLeadId}`);
  if (callDirection === "outbound") parts.push("dir=out");
  if (callbackId) parts.push(`cbId=${callbackId}`);
  const qs = parts.length ? `?${parts.join("&")}` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsBaseUrl}/api/ws/twilio/${agentId}${qs}">
      <Parameter name="agentId" value="${agentId}"/>
    </Stream>
  </Connect>
</Response>`;
}
