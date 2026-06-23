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
  campaignLeadId?: number,
  urlFrom?: string,
  urlTo?: string,
): Promise<void> {
  let sessionId: string | null = null;
  let streamId: string | null = null;
  // True when VoBiz sent "stop" or closed the socket while createSession was still
  // awaiting.  In that case sessionId was null at the time, so endSession was
  // skipped.  We detect this and call endSession immediately once sessionId is set.
  let sessionEndedBeforeReady = false;

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
        // Priority: URL query params (most reliable) → start.from/to → customParameters → fallback
        const fromNumber = urlFrom ?? msg.start?.from ?? params["From"] ?? "+10000000000";
        const toNumber   = urlTo   ?? msg.start?.to   ?? params["To"]   ?? "+10000000001";

        logger.info({ agentId, streamId, callId, fromNumber, toNumber, encoding: msg.start?.mediaFormat?.encoding }, "Vobiz start event");

        // ── Silence keepalive during session init ───────────────────────────
        // VoBiz drops the call if the audio bridge receives no data for ~2 s
        // even with keepCallAlive="true". This happens when createSession is
        // slow due to DB pool latency or cold connections. Sending 20 ms
        // silence frames (PCM zeros) keeps the VoBiz bridge alive until the
        // first real pipeline audio arrives via onAudioOut.
        const SILENCE_MS      = 20;
        const SILENCE_SAMPLES = (8000 * SILENCE_MS) / 1000;           // 160 @ 8 kHz
        const silenceFrame    = Buffer.alloc(SILENCE_SAMPLES * 2, 0);  // 16-bit LE PCM
        let silenceTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
          if (ws.readyState === ws.OPEN) sendAudioToVobiz(silenceFrame);
        }, SILENCE_MS);
        const stopSilence = (): void => {
          if (silenceTimer) { clearInterval(silenceTimer); silenceTimer = null; }
        };

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
            onAudioOut: (audio: Buffer) => {
              stopSilence();            // first real audio → drop silence immediately
              sendAudioToVobiz(audio);
            },
            onCallEnd: () => { stopSilence(); ws.close(); },
            onBargeIn: sendBargeIn,
          });
          stopSilence();                // safety-net: session ready with no audio yet
          sessionId = sid;
          if (sessionEndedBeforeReady) {
            // VoBiz sent stop/closed the socket while createSession was still
            // setting up.  sessionId was null then so endSession was skipped —
            // call it now so the record is not stuck in_progress.
            logger.warn({ sessionId, agentId }, "Vobiz session ended before setup completed — ending immediately");
            await endSession(sessionId);
          } else {
            logger.info({ sessionId, agentId, fromNumber, toNumber, streamId }, "Vobiz session started");
          }
        } catch (err) {
          stopSilence();
          logger.error(
            { err, agentId, externalCallId: callId, streamId, provider: "vobiz", reason: toReadableError(err, "Vobiz session setup failed") },
            "Failed to create Vobiz session — closing socket before greeting",
          );
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
        if (sessionId) {
          await endSession(sessionId);
        } else {
          sessionEndedBeforeReady = true;
        }
        break;
    }
  });

  ws.on("close", async () => {
    logger.info({ sessionId }, "Vobiz WS closed");
    if (sessionId) {
      await endSession(sessionId);
    } else {
      sessionEndedBeforeReady = true;
    }
  });

  ws.on("error", async (err: unknown) => {
    logger.error({ sessionId, err }, "Vobiz WS error");
    if (sessionId) {
      await failSession(sessionId, toReadableError(err, "Telephony error"));
    } else {
      sessionEndedBeforeReady = true;
    }
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
  // Embed From/To in the WebSocket URL query string — the most reliable way to
  // pass caller/callee numbers.  VoBiz POSTs them to the answer URL, we encode
  // them here, and our WS handler reads them from the URL before the start event
  // arrives (VoBiz's start.from/to and customParameters support is inconsistent).
  if (opts.from) qsParts.push(`from=${encodeURIComponent(opts.from)}`);
  if (opts.to)   qsParts.push(`to=${encodeURIComponent(opts.to)}`);
  const qs = qsParts.length ? `?${qsParts.join("&")}` : "";
  const wsUrl = `${wsBaseUrl}/api/ws/vobiz/${agentId}${qs}`;
  // XML-escape the URL before embedding in the <Stream> text node.  Bare "&" in
  // XML text content is a parse error; when the query string has multiple params
  // (e.g. ?from=917971543255&to=916383653279) VoBiz's parser rejects the whole
  // XML with HangupCauseCode 8011 "Invalid Answer XML" and drops the call before
  // opening the WebSocket.  VoBiz decodes &amp; back to & when it reads the URL.
  const wsUrlXml = wsUrl.replace(/&/g, "&amp;");
  // contentType="audio/x-l16;rate=8000" explicitly negotiates LINEAR16 8kHz for
  // both the inbound stream and the outbound playAudio events.  Without this,
  // Vobiz may default to µ-law, which causes it to mis-decode our LINEAR16
  // playAudio payload — producing the "tractor/glitch" audio artifact on the
  // caller side.  Per Vobiz docs the playAudio contentType must match the
  // stream-negotiated format, so locking it here fixes the outbound path.
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=8000">${wsUrlXml}</Stream>
</Response>`;
}
