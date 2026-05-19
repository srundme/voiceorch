import type { WebSocket } from "ws";
import { createSession, endSession, failSession } from "../session.js";
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
 *   { event: "start",  start: { callSid, from, to, ... } }
 *   { event: "media",  media: { payload: "<base64 mulaw>" } }
 *   { event: "stop" }
 *
 * Outbound (server → Vobiz) to play audio to caller:
 *   { event: "media", media: { payload: "<base64 mulaw>" } }
 *
 * Docs: https://docs.vobiz.ai/guides/ai-voice-agent
 */

interface VobizMessage {
  event: "connected" | "start" | "media" | "stop";
  start?: {
    callSid?: string;
    from?: string;
    to?: string;
    streamSid?: string;
  };
  media?: {
    payload: string; // base64 µ-law
  };
}

export async function handleVobizWebSocket(
  ws: WebSocket,
  agentId: number
): Promise<void> {
  let sessionId: string | null = null;

  function sendAudioToVobiz(audio: Buffer): void {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({
      event: "media",
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
        const fromNumber = msg.start?.from ?? "+10000000000";
        const toNumber   = msg.start?.to   ?? "+10000000001";
        const callSid    = msg.start?.callSid ?? msg.start?.streamSid;

        try {
          const { sessionId: sid } = await createSession({
            agentId,
            telephonyProvider: "vobiz",
            toNumber,
            fromNumber,
            externalCallId: callSid,
            onAudioOut: sendAudioToVobiz,
            onCallEnd: () => ws.close(),
          });
          sessionId = sid;
          logger.info({ sessionId, agentId, fromNumber, toNumber }, "Vobiz session started");
        } catch (err) {
          logger.error({ err, agentId }, "Failed to create Vobiz session");
          ws.close();
        }
        break;
      }

      case "media": {
        if (!sessionId || !msg.media?.payload) break;
        const { getSession } = await import("../session.js");
        const session = getSession(sessionId);
        if (session) session.pipeline.onAudioIn(Buffer.from(msg.media.payload, "base64"));
        break;
      }

      case "stop":
        if (sessionId) await endSession(sessionId);
        break;
    }
  });

  ws.on("close", async () => {
    if (sessionId) await endSession(sessionId);
  });

  ws.on("error", async (err: unknown) => {
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
