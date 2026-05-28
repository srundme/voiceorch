import type { WebSocket } from "ws";
import { createSession, getSession, endSession, failSession } from "../session.js";
import { decodeMulaw } from "../audio.js";
import { toReadableError } from "../utils.js";
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
 *   { event: "playAudio", media: { contentType: "audio/x-l16", sampleRate: 8000, payload: "<base64 PCM>" } }
 *
 * Barge-in: send { event: "clearAudio", streamId } to discard Vobiz's playback buffer.
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
  agentId: number,
  platformTelephony = false,
  campaignLeadId?: number
): Promise<void> {
  let sessionId: string | null = null;
  let streamId: string | null = null;

  /**
   * Send audio to Vobiz caller via the playAudio WebSocket event.
   * Pipeline delivers mulaw chunks; decode them back to LINEAR16 PCM (audio/x-l16).
   */
  function sendAudioToVobiz(mulawChunk: Buffer): void {
    if (ws.readyState !== ws.OPEN) return;
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

  /**
   * Barge-in: tell Vobiz to immediately discard any buffered playback audio.
   * Called by the pipeline when the caller speaks during agent playback.
   */
  function sendBargeIn(): void {
    if (!streamId || ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ event: "clearAudio", streamId }));
    logger.info({ streamId }, "Vobiz clearAudio sent (barge-in)");
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
            platformTelephony,
            customParameters: params,
            campaignLeadId,
            onAudioOut: sendAudioToVobiz,
            onCallEnd: () => ws.close(),
            onBargeIn: sendBargeIn,
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
        if (msg.media.track && msg.media.track !== "inbound") break;
        const session = getSession(sessionId);
        if (!session) break;
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
    if (sessionId) await failSession(sessionId, toReadableError(err, "Telephony error"));
  });
}

/**
 * Return VoiceXML telling Vobiz to open a bidirectional WebSocket stream.
 * P2-C: pass recordingCallbackUrl to prepend a <Record> element.
 */
export function getVobizAnswerXML(
  wsBaseUrl: string,
  agentId: number,
  platformTelephony = false,
  opts: { recordingCallbackUrl?: string; campaignLeadId?: number } = {},
): string {
  const qsParts: string[] = [];
  if (platformTelephony) qsParts.push("pt=1");
  if (opts.campaignLeadId) qsParts.push(`campaignLeadId=${opts.campaignLeadId}`);
  const qs = qsParts.length ? `?${qsParts.join("&")}` : "";
  const wsUrl = `${wsBaseUrl}/api/ws/vobiz/${agentId}${qs}`;
  const recordTag = opts.recordingCallbackUrl
    ? `\n  <Record action="${opts.recordingCallbackUrl}" method="POST" maxLength="3600" redirect="false" />`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>${recordTag}
  <Stream bidirectional="true" keepCallAlive="true">${wsUrl}</Stream>
</Response>`;
}
