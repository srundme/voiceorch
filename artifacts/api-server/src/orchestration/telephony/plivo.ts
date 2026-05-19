import type { WebSocket } from "ws";
import { createSession, getSession, endSession, failSession } from "../session.js";
import { encodeMulaw, decodeMulaw } from "../audio.js";
import { logger } from "../../lib/logger.js";

/**
 * Plivo AudioSocket / Multistream WebSocket handler
 *
 * Flow:
 *   1. Plivo calls POST /api/webhooks/plivo/voice
 *   2. We return XML with <MultiPartyCall> or <Stream> element
 *   3. Plivo opens WS → sends JSON events + binary audio
 *   4. We process audio and send audio back
 *
 * Plivo sends binary frames for audio, JSON frames for events.
 * Audio format: PCMU (mulaw) 8kHz, 8-bit, mono
 */

interface PlivoEvent {
  event: "start" | "media" | "stop" | "playback_begin" | "playback_end";
  stream_id?: string;
  call_id?: string;
  media?: {
    payload: string; // base64 mulaw
    chunk: number;
    timestamp: string;
  };
  start?: {
    call_id: string;
    stream_id: string;
    from: string;
    to: string;
  };
}

export async function handlePlivoWebSocket(
  ws: WebSocket,
  agentId: number
): Promise<void> {
  let sessionId: string | null = null;
  let streamId: string | null = null;

  function sendAudioToPlivo(audio: Buffer): void {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({
      event: "playback",
      media: { payload: audio.toString("base64") },
    }));
  }

  ws.on("message", async (raw: Buffer | string) => {
    // Plivo can send binary audio directly or JSON events
    if (Buffer.isBuffer(raw)) {
      if (!sessionId) return;
      const session = getSession(sessionId);
      if (session) session.pipeline.onAudioIn(raw);
      return;
    }

    let event: PlivoEvent;
    try {
      event = JSON.parse(raw.toString()) as PlivoEvent;
    } catch {
      return;
    }

    switch (event.event) {
      case "start": {
        streamId = event.start?.stream_id ?? event.stream_id ?? null;
        const fromNumber = event.start?.from ?? "+10000000000";
        const toNumber = event.start?.to ?? "+10000000001";
        const callId = event.start?.call_id ?? event.call_id;

        try {
          const { sessionId: sid } = await createSession({
            agentId,
            telephonyProvider: "plivo",
            toNumber,
            fromNumber,
            externalCallId: callId,
            onAudioOut: sendAudioToPlivo,
            onCallEnd: () => ws.close(),
          });
          sessionId = sid;
          logger.info({ sessionId, agentId }, "Plivo session started");
        } catch (err) {
          logger.error({ err, agentId }, "Failed to create Plivo session");
          ws.close();
        }
        break;
      }

      case "media": {
        if (!sessionId || !event.media) break;
        const session = getSession(sessionId);
        if (!session) break;
        const chunk = Buffer.from(event.media.payload, "base64");
        session.pipeline.onAudioIn(chunk);
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

/** Generate Plivo Answer XML to connect call to WebSocket stream */
export function getPlivoAnswerXML(wsBaseUrl: string, agentId: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream keepCallAlive="true" streamTimeout="600" contentType="audio/x-mulaw;rate=8000" bidirectional="true">
    <WebSocket url="${wsBaseUrl}/api/ws/plivo/${agentId}"/>
  </Stream>
</Response>`;
}
