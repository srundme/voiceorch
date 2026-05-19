import type { WebSocket } from "ws";
import { createSession, getSession, endSession, failSession } from "../session.js";
import { decodeMulaw } from "../audio.js";
import { logger } from "../../lib/logger.js";

/**
 * Vobiz WebSocket handler
 *
 * Vobiz uses a Twilio-like Media Streams protocol but with LINEAR16 PCM audio,
 * NOT mulaw. Key differences from Twilio:
 *
 * Inbound event flow (Vobiz → server):
 *   { event: "connected" }
 *   { event: "start",  start: { callId, streamId, accountId, tracks, mediaFormat: { encoding: "audio/x-l16", sampleRate: 8000 } } }
 *   { event: "media",  media: { payload: "<base64 LINEAR16 PCM 8kHz>" } }
 *   { event: "stop" }
 *
 * Outbound (server → Vobiz) to play audio to caller:
 *   { event: "media", streamId: "...", media: { payload: "<base64 LINEAR16 PCM 8kHz>" } }
 *
 * Audio format: LINEAR16 PCM at 8000 Hz (NOT mulaw like Twilio/Plivo)
 *
 * Docs: https://docs.vobiz.ai/guides/ai-voice-agent
 */

interface VobizMessage {
  event: "connected" | "start" | "media" | "stop";
  sequenceNumber?: number;
  streamId?: string;
  start?: {
    callId?: string;
    streamId?: string;
    accountId?: string;
    tracks?: string[];
    mediaFormat?: {
      encoding: string;
      sampleRate: number;
    };
    customParameters?: Record<string, string>;
    from?: string;
    to?: string;
  };
  media?: {
    track?: string;
    payload: string; // base64-encoded LINEAR16 PCM 8kHz
  };
  extra_headers?: string;
}

export async function handleVobizWebSocket(
  ws: WebSocket,
  agentId: number
): Promise<void> {
  let sessionId: string | null = null;
  let streamId: string | null = null;

  /**
   * Send audio to Vobiz caller via the playAudio WebSocket event.
   * Vobiz uses event:"playAudio" (NOT "media" like Twilio) with contentType/sampleRate.
   * Pipeline delivers mulaw chunks; we decode them back to LINEAR16 PCM (audio/x-l16).
   * https://docs.vobiz.ai/xml/stream/play-audio
   */
  function sendAudioToVobiz(mulawChunk: Buffer): void {
    if (ws.readyState !== ws.OPEN) return;
    // Vobiz expects LINEAR16 PCM — decode the mulaw the pipeline produced
    const pcm = decodeMulaw(mulawChunk);
    ws.send(JSON.stringify({
      event: "playAudio",
      media: {
        contentType: "audio/x-l16",
        sampleRate: 8000,
        payload: pcm.toString("base64"),
      },
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
        // Vobiz uses "streamId" (UUID), not Twilio's "streamSid"
        streamId = msg.start?.streamId ?? msg.streamId ?? null;
        const callId = msg.start?.callId ?? null;

        const params = msg.start?.customParameters ?? {};
        const fromNumber = msg.start?.from ?? params["From"] ?? "+10000000000";
        const toNumber   = msg.start?.to   ?? params["To"]   ?? "+10000000001";

        logger.info({ agentId, streamId, callId, fromNumber, toNumber, encoding: msg.start?.mediaFormat?.encoding }, "Vobiz start event");

        try {
          const { sessionId: sid } = await createSession({
            agentId,
            telephonyProvider: "vobiz",
            toNumber,
            fromNumber,
            externalCallId: callId ?? undefined,
            onAudioOut: sendAudioToVobiz,
            onCallEnd: () => ws.close(),
          });
          sessionId = sid;
          logger.info({ sessionId, agentId, fromNumber, toNumber, streamId }, "Vobiz session started");
        } catch (err) {
          logger.error({ err, agentId }, "Failed to create Vobiz session");
          ws.close();
        }
        break;
      }

      case "media": {
        if (!sessionId || !msg.media?.payload) break;
        // Ignore outbound echo tracks
        if (msg.media.track && msg.media.track !== "inbound") break;
        const session = getSession(sessionId);
        if (!session) break;
        // Vobiz sends LINEAR16 PCM — pass directly as raw PCM (bypass mulaw decode)
        const pcm8k = Buffer.from(msg.media.payload, "base64");
        session.pipeline.onRawPcm8kIn(pcm8k);
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
 */
export function getVobizAnswerXML(wsBaseUrl: string, agentId: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true">${wsBaseUrl}/api/ws/vobiz/${agentId}</Stream>
</Response>`;
}
