import type { WebSocket } from "ws";
import { createSession, getSession, endSession, failSession } from "../session.js";
import { logger } from "../../lib/logger.js";

/**
 * Vobiz WebSocket handler
 *
 * Vobiz uses a JSON+binary hybrid protocol similar to Twilio Media Streams.
 * Audio format: PCM μ-law 8kHz mono (PCMU G.711)
 *
 * Flow:
 *   1. Vobiz calls POST /api/webhooks/vobiz/voice
 *   2. We return JSON with WebSocket URL
 *   3. Vobiz opens WS → sends events
 */

interface VobizEvent {
  event: "session.start" | "audio.in" | "session.end" | "error";
  session_id?: string;
  call_id?: string;
  from?: string;
  to?: string;
  agent_id?: number;
  audio?: string; // base64 mulaw
  error?: string;
}

export async function handleVobizWebSocket(
  ws: WebSocket,
  agentId: number
): Promise<void> {
  let sessionId: string | null = null;

  function sendAudioToVobiz(audio: Buffer): void {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({
      event: "audio.out",
      audio: audio.toString("base64"),
      encoding: "mulaw",
      sample_rate: 8000,
    }));
  }

  ws.on("message", async (raw: Buffer | string) => {
    // Binary frames = raw mulaw audio
    if (Buffer.isBuffer(raw)) {
      if (!sessionId) return;
      const session = getSession(sessionId);
      if (session) session.pipeline.onAudioIn(raw);
      return;
    }

    let event: VobizEvent;
    try {
      event = JSON.parse(raw.toString()) as VobizEvent;
    } catch {
      return;
    }

    switch (event.event) {
      case "session.start": {
        const fromNumber = event.from ?? "+10000000000";
        const toNumber = event.to ?? "+10000000001";

        try {
          const { sessionId: sid } = await createSession({
            agentId,
            telephonyProvider: "vobiz",
            toNumber,
            fromNumber,
            externalCallId: event.call_id,
            onAudioOut: sendAudioToVobiz,
            onCallEnd: () => ws.close(),
          });
          sessionId = sid;

          // Acknowledge session start
          ws.send(JSON.stringify({ event: "session.ready", session_id: sessionId }));
          logger.info({ sessionId, agentId }, "Vobiz session started");
        } catch (err) {
          logger.error({ err, agentId }, "Failed to create Vobiz session");
          ws.send(JSON.stringify({ event: "error", message: String(err) }));
          ws.close();
        }
        break;
      }

      case "audio.in": {
        if (!sessionId || !event.audio) break;
        const session = getSession(sessionId);
        if (!session) break;
        const chunk = Buffer.from(event.audio, "base64");
        session.pipeline.onAudioIn(chunk);
        break;
      }

      case "session.end":
        if (sessionId) await endSession(sessionId);
        break;

      case "error":
        logger.error({ sessionId, error: event.error }, "Vobiz reported error");
        if (sessionId) await failSession(sessionId, event.error ?? "Unknown Vobiz error");
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

/** Return JSON config for Vobiz to connect to our WebSocket */
export function getVobizConnectResponse(wsBaseUrl: string, agentId: number) {
  return {
    action: "connect",
    websocket_url: `${wsBaseUrl}/api/ws/vobiz/${agentId}`,
    audio_format: {
      encoding: "mulaw",
      sample_rate: 8000,
      channels: 1,
    },
  };
}
