import type { WebSocket } from "ws";
import { createSession, getSession, endSession, failSession } from "../session.js";
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
   * Pipeline delivers raw 8kHz LINEAR16 LE PCM (rawPcmOutput: true in session config).
   * Vobiz accepts the payload as-is in little-endian format despite audio/x-l16 being
   * nominally big-endian per RFC 2586 — byte-swapping causes silence/garble.
   */
  function sendAudioToVobiz(pcmChunk: Buffer): void {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({
      event: "playAudio",
      media: {
        contentType: "audio/x-l16",
        sampleRate: 8000,
        payload: pcmChunk.toString("base64"),
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
        // Vobiz sends inbound audio as little-endian LINEAR16 PCM (same as outbound).
        // Pass directly to pipeline — no byte-swap needed.
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
 * Recording is handled server-side via RecordingBuffer — no <Record> verb
 * needed here (it causes a beep tone and can conflict with <Stream> audio routing).
 */
export function getVobizAnswerXML(
  wsBaseUrl: string,
  agentId: number,
  platformTelephony = false,
  opts: { campaignLeadId?: number; from?: string; to?: string } = {},
): string {
  const qsParts: string[] = [];
  if (platformTelephony) qsParts.push("pt=1");
  if (opts.campaignLeadId) qsParts.push(`campaignLeadId=${opts.campaignLeadId}`);
  const qs = qsParts.length ? `?${qsParts.join("&")}` : "";
  const wsUrl = `${wsBaseUrl}/api/ws/vobiz/${agentId}${qs}`;
  // contentType="audio/x-l16;rate=8000" explicitly negotiates LINEAR16 8kHz for
  // both the inbound stream and the outbound playAudio events.  Without this,
  // Vobiz may default to µ-law, which causes it to mis-decode our LINEAR16
  // playAudio payload — producing the "tractor/glitch" audio artifact on the
  // caller side.  Per Vobiz docs the playAudio contentType must match the
  // stream-negotiated format, so locking it here fixes the outbound path.
  //
  // From/To are embedded as <Parameter> child elements (Twilio-compatible syntax
  // that Vobiz echoes back in customParameters of the start event) so the session
  // can store the real caller/callee numbers instead of +10000000000 fallbacks.
  const fromParam = opts.from ? `\n  <Parameter name="From" value="${opts.from.replace(/"/g, "&quot;")}"/>` : "";
  const toParam   = opts.to   ? `\n  <Parameter name="To"   value="${opts.to.replace(/"/g, "&quot;")}"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=8000">${wsUrl}${fromParam}${toParam}</Stream>
</Response>`;
}
