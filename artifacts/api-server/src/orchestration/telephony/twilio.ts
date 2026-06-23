import type { WebSocket } from "ws";
import { createSession, getSession, endSession, failSession } from "../session.js";
import { toReadableError } from "../utils.js";
import { logger } from "../../lib/logger.js";

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
  campaignLeadId?: number
): Promise<void> {
  let sessionId: string | null = null;
  let streamSid: string | null = null;
  let callSid: string | null = null;

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

        try {
          const { sessionId: sid } = await createSession({
            agentId,
            telephonyProvider: "twilio",
            toNumber,
            fromNumber,
            externalCallId: callSid ?? undefined,
            campaignLeadId,
            onAudioOut: sendAudioToTwilio,
            onCallEnd: () => ws.close(),
            onBargeIn: () => {
              // Clear any audio Twilio has buffered but not yet played
              if (streamSid && ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ event: "clear", streamSid }));
              }
            },
          });
          sessionId = sid;
          logger.info({ sessionId, callSid, agentId }, "Twilio session started");
        } catch (err) {
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
        if (sessionId) await endSession(sessionId);
        break;
    }
  });

  ws.on("close", () => {
    logger.info({ sessionId }, "Twilio WS closed");
    if (sessionId) {
      endSession(sessionId).catch((err: unknown) =>
        logger.error({ sessionId, err }, "Twilio WS close: endSession failed"),
      );
    }
  });

  ws.on("error", (err: unknown) => {
    logger.error({ sessionId, err }, "Twilio WS error");
    if (sessionId) {
      failSession(sessionId, toReadableError(err, "Telephony error")).catch((e: unknown) =>
        logger.error({ sessionId, err: e }, "Twilio WS error: failSession failed"),
      );
    }
  });
}

/** Generate TwiML to connect call to Media Streams WebSocket */
export function getTwilioVoiceTwiML(wsBaseUrl: string, agentId: number, campaignLeadId?: number): string {
  const qs = campaignLeadId ? `?campaignLeadId=${campaignLeadId}` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsBaseUrl}/api/ws/twilio/${agentId}${qs}">
      <Parameter name="agentId" value="${agentId}"/>
    </Stream>
  </Connect>
</Response>`;
}
