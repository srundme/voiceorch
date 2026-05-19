import type { WebSocket } from "ws";
import { createSession, getSession, endSession, failSession } from "../session.js";
import { logger } from "../../lib/logger.js";

/**
 * Vobiz WebSocket handler
 *
 * Vobiz uses the same Media Streams protocol as Twilio:
 *   • JSON events over WebSocket
 *   • Audio: base64-encoded µ-law 8 kHz mono (G.711 PCMU), 20 ms chunks
 *
 * Inbound event flow from Vobiz → server:
 *   { event: "connected" }
 *   { event: "start",  streamSid: "MZ...", start: { callSid, streamSid, from, to, ... } }
 *   { event: "media",  streamSid: "MZ...", media: { payload: "<base64 mulaw>" } }
 *   { event: "stop" }
 *
 * Outbound (server → Vobiz) to play audio to caller:
 *   { event: "media", streamSid: "MZ...", media: { payload: "<base64 mulaw>" } }
 *
 * Docs: https://docs.vobiz.ai/guides/ai-voice-agent
 */

interface VobizMessage {
  event: "connected" | "start" | "media" | "stop";
  streamSid?: string;
  start?: {
    callSid?: string;
    streamSid?: string;
    from?: string;
    to?: string;
    customParameters?: Record<string, string>;
  };
  media?: {
    track?: string;
    payload: string; // base64 µ-law
  };
}

export async function handleVobizWebSocket(
  ws: WebSocket,
  agentId: number
): Promise<void> {
  let sessionId: string | null = null;
  let streamSid: string | null = null;

  function sendAudioToVobiz(audio: Buffer): void {
    if (!streamSid || ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({
      event: "media",
      streamSid,
      media: { payload: audio.toString("base64") },
    }));
  }

  ws.on("message", async (raw: Buffer | string) => {
    let msg: VobizMessage;
    try {
      msg = JSON.parse(raw.toString()) as VobizMessage;
    } catch {
      return;
    }

    switch (msg.event) {
      case "connected":
        logger.info({ agentId }, "Vobiz WebSocket connected");
        break;

      case "start": {
        // Capture streamSid from top-level or nested start object (mirrors Twilio protocol)
        streamSid = msg.streamSid ?? msg.start?.streamSid ?? null;
        const callSid = msg.start?.callSid ?? streamSid;

        const params = msg.start?.customParameters ?? {};
        const fromNumber = msg.start?.from ?? params["From"] ?? "+10000000000";
        const toNumber   = msg.start?.to   ?? params["To"]   ?? "+10000000001";

        logger.info({ agentId, streamSid, callSid, fromNumber, toNumber }, "Vobiz start event");

        try {
          const { sessionId: sid } = await createSession({
            agentId,
            telephonyProvider: "vobiz",
            toNumber,
            fromNumber,
            externalCallId: callSid ?? undefined,
            onAudioOut: sendAudioToVobiz,
            onCallEnd: () => ws.close(),
          });
          sessionId = sid;
          logger.info({ sessionId, agentId, fromNumber, toNumber, streamSid }, "Vobiz session started");
        } catch (err) {
          logger.error({ err, agentId }, "Failed to create Vobiz session");
          ws.close();
        }
        break;
      }

      case "media": {
        if (!sessionId || !msg.media?.payload) break;
        // Only process inbound audio (ignore outbound echo if track is specified)
        if (msg.media.track && msg.media.track !== "inbound") break;
        const session = getSession(sessionId);
        if (session) session.pipeline.onAudioIn(Buffer.from(msg.media.payload, "base64"));
        break;
      }

      case "stop":
        logger.info({ sessionId }, "Vobiz stream stopped");
        if (sessionId) await endSession(sessionId);
        break;
    }
  });

  ws.on("close", async () => {
    logger.info({ sessionId }, "Vobiz WS closed");
    if (sessionId) await endSession(sessionId);
  });

  ws.on("error", async (err: unknown) => {
    logger.error({ sessionId, err }, "Vobiz WS error");
    if (sessionId) await failSession(sessionId, String(err));
  });
}

/**
 * Return VoiceXML telling Vobiz to open a bidirectional WebSocket stream.
 * Vobiz uses the same <Stream> directive as Twilio.
 */
export function getVobizAnswerXML(wsBaseUrl: string, agentId: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true">${wsBaseUrl}/api/ws/vobiz/${agentId}</Stream>
</Response>`;
}
