import type { WebSocket } from "ws";
import { createSession, getSession, endSession, failSession } from "../session.js";
import { encodeMulaw, decodeMulaw } from "../audio.js";
import { toReadableError } from "../utils.js";
import { logger } from "../../lib/logger.js";
import { db, scheduledCallbacksTable, callsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { startEarlyAmbientKeepalive } from "./early-ambient.js";

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
  event: "start" | "media" | "dtmf" | "stop" | "playback_begin" | "playback_end";
  // Plivo sends camelCase (streamId/callId); keep snake_case fallbacks for safety.
  streamId?: string;
  stream_id?: string;
  call_id?: string;
  media?: {
    payload: string; // base64 mulaw
    chunk: number;
    timestamp: string;
    /** When present, only `inbound` is caller audio (mirror Twilio/Vobiz). */
    track?: string;
  };
  start?: {
    callId?: string;
    streamId?: string;
    call_id?: string;
    stream_id?: string;
    /** NOTE: per Plivo Stream docs the start event does NOT carry from/to —
     *  we thread them through the WS URL query string instead (like VoBiz). */
    from?: string;
    to?: string;
  };
}

export async function handlePlivoWebSocket(
  ws: WebSocket,
  agentId: number,
  campaignLeadId?: number,
  callDirection: "inbound" | "outbound" = "inbound",
  callbackId?: number,
  fromNumber?: string,
  toNumber?: string,
  callUuid?: string,
  answeredAt?: number,
): Promise<void> {
  let sessionId: string | null = null;
  let streamId: string | null = null;
  // True when Plivo sent "stop"/closed the socket while createSession was still
  // awaiting. sessionId was null then so endSession was skipped — detect it and end
  // the session as soon as sessionId is assigned so the record isn't stuck in_progress.
  let sessionEndedBeforeReady = false;

  // True once Plivo's "start" event arrives. Session setup begins at WS-open
  // for latency, but playAudio/clearAudio are only valid after stream start —
  // pre-start frames (early ambient ticks) are deterministically dropped.
  let streamStarted = false;

  function sendAudioToPlivo(audio: Buffer): void {
    if (ws.readyState !== ws.OPEN || !streamStarted) return;
    // Per official Plivo bidirectional-stream docs, agent→Plivo audio uses
    // event "playAudio" with explicit contentType + sampleRate. Unknown events
    // ("playback", "media") are silently dropped → connected-but-mute agent.
    ws.send(JSON.stringify({
      event: "playAudio",
      media: {
        contentType: "audio/x-mulaw",
        sampleRate: 8000,
        payload: audio.toString("base64"),
      },
    }));
  }

  /**
   * Barge-in: tell Plivo to discard any audio it has buffered for playback.
   * Plivo's AudioSocket protocol accepts { event: "clear" } from the server
   * to immediately stop ongoing playback and flush its buffer.
   * Ref: https://www.plivo.com/docs/voice/xml/stream/#websocket-messages
   */
  function sendBargeIn(): void {
    if (ws.readyState !== ws.OPEN || !streamStarted) return;
    // Per official Plivo docs, interruption/flush is event "clearAudio".
    ws.send(JSON.stringify({ event: "clearAudio", streamId: streamId ?? undefined }));
    logger.info({ sessionId, streamId }, "Plivo clearAudio sent (barge-in)");
  }

  // ── Immediate session setup ──────────────────────────────────────────────
  // Previously all setup waited for Plivo's "start" event. Everything the
  // session needs (from/to/callUuid/answeredAt) is already threaded through the
  // WS URL by the answer webhook, so start comfort noise and createSession the
  // moment the socket opens — this shaves the answer→start gap off the caller's
  // perceived dead air. The "start" event now only captures streamId.
  const earlyAmbient = startEarlyAmbientKeepalive({
    agentId,
    format: "mulaw",
    send: sendAudioToPlivo,
  });
  const stopEarlyAmbient = (): void => { earlyAmbient.stop(); };

  void (async () => {
    const from = fromNumber ?? "+10000000000";
    const to   = toNumber   ?? "+10000000001";

    // Load resume context and callback reason from prior call when this is a callback
    let resumeContext: Parameters<typeof createSession>[0]["resumeContext"] | undefined;
    let sourceCallbackReason: string | undefined;
    if (callbackId) {
      try {
        const [cbRow] = await db
          .select({ reason: scheduledCallbacksTable.reason, createdFromCallId: scheduledCallbacksTable.createdFromCallId })
          .from(scheduledCallbacksTable)
          .where(eq(scheduledCallbacksTable.id, callbackId));
        sourceCallbackReason = cbRow?.reason ?? undefined;
        if (cbRow?.reason === "network_drop" && cbRow.createdFromCallId) {
          const [priorCall] = await db
            .select({ resumeContext: callsTable.resumeContext })
            .from(callsTable)
            .where(eq(callsTable.id, cbRow.createdFromCallId));
          if (priorCall?.resumeContext) resumeContext = priorCall.resumeContext;
        }
      } catch (rcErr) {
        logger.warn({ callbackId, rcErr }, "Plivo: failed to load resume context — proceeding without it");
      }
    }

    try {
      const { sessionId: sid } = await createSession({
        agentId,
        telephonyProvider: "plivo",
        toNumber: to,
        fromNumber: from,
        externalCallId: callUuid,
        callDirection,
        campaignLeadId,
        resumeContext,
        sourceCallbackReason,
        scheduledCallbackId: callbackId,
        answeredAt,
        onAudioOut: (audio: Buffer) => {
          stopEarlyAmbient();
          sendAudioToPlivo(audio);
        },
        onCallEnd: () => {
          stopEarlyAmbient();
          // Do NOT close the WS if the call was transferred — the provider is
          // redirecting the leg to the human agent; a close frame aborts it.
          const sess = sessionId ? getSession(sessionId) : null;
          if (sess?.wasTransferred) {
            logger.info({ sessionId }, "Plivo onCallEnd: skipping ws.close() — call is being transferred");
            return;
          }
          ws.close();
        },
        onBargeIn: sendBargeIn,
      });
      stopEarlyAmbient();
      sessionId = sid;
      if (sessionEndedBeforeReady) {
        logger.warn({ sessionId, agentId }, "Plivo session ended before setup completed — ending immediately");
        await endSession(sessionId);
      } else {
        logger.info({ sessionId, agentId }, "Plivo session started");
      }
    } catch (err) {
      stopEarlyAmbient();
      logger.error(
        { err, agentId, externalCallId: callUuid, streamId, provider: "plivo", reason: toReadableError(err, "Plivo session setup failed") },
        "Failed to create Plivo session — closing socket before greeting",
      );
      ws.close();
    }
  })();

  ws.on("message", async (raw: Buffer | string, isBinary?: boolean) => {
    // NOTE: the `ws` library delivers TEXT frames as Buffer too — a bare
    // Buffer.isBuffer() check swallowed every JSON event (start/media/stop),
    // so no session was ever created. Only treat true binary frames as audio;
    // everything else is parsed as a JSON event (mirrors the VoBiz handler).
    if (isBinary) {
      if (!sessionId) return;
      const session = getSession(sessionId);
      if (session) session.pipeline.onAudioIn(Buffer.isBuffer(raw) ? raw : Buffer.from(raw));
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
        // Session setup already began at WS open (see above) — the start event
        // only supplies the streamId (needed for clearAudio barge-in).
        streamId = event.start?.streamId ?? event.streamId ?? event.start?.stream_id ?? event.stream_id ?? null;
        streamStarted = true;
        logger.info({ agentId, streamId, sessionId }, "Plivo stream started");
        break;
      }

      case "media": {
        if (!sessionId || !event.media) break;
        if (event.media.track && event.media.track !== "inbound") break;
        const session = getSession(sessionId);
        if (!session) break;
        const chunk = Buffer.from(event.media.payload, "base64");
        session.pipeline.onAudioIn(chunk);
        break;
      }

      case "stop":
        if (sessionId) {
          getSession(sessionId)?.pipeline.noteMediaDropIfWaitingForReply();
          await endSession(sessionId);
        } else sessionEndedBeforeReady = true;
        break;
    }
  });

  ws.on("close", () => {
    if (sessionId) {
      getSession(sessionId)?.pipeline.noteMediaDropIfWaitingForReply();
      endSession(sessionId).catch((err: unknown) =>
        logger.error({ sessionId, err }, "Plivo WS close: endSession failed"),
      );
    } else {
      sessionEndedBeforeReady = true;
    }
  });

  ws.on("error", (err: unknown) => {
    logger.error({ sessionId, err }, "Plivo WS error");
    if (sessionId) {
      failSession(sessionId, toReadableError(err, "Telephony error")).catch((e: unknown) =>
        logger.error({ sessionId, err: e }, "Plivo WS error: failSession failed"),
      );
    } else {
      sessionEndedBeforeReady = true;
    }
  });
}

/** Generate Plivo Answer XML to connect call to WebSocket stream */
export function getPlivoAnswerXML(
  wsBaseUrl: string,
  agentId: number,
  campaignLeadId?: number,
  callDirection: "inbound" | "outbound" = "inbound",
  callbackId?: number,
  from?: string,
  to?: string,
  callUuid?: string,
  answeredAt?: number,
): string {
  const parts: string[] = [];
  if (campaignLeadId) parts.push(`campaignLeadId=${campaignLeadId}`);
  if (callDirection === "outbound") parts.push("dir=out");
  if (callbackId) parts.push(`cbId=${callbackId}`);
  // CallUUID + answer instant from the answer webhook — lets the WS handler
  // create the session immediately on connect (no waiting for the start event)
  // and anchor duration/recording to the real answer time (clamped in index.ts).
  if (callUuid) parts.push(`callUuid=${encodeURIComponent(callUuid)}`);
  if (answeredAt) parts.push(`ans=${answeredAt}`);
  // Embed From/To in the WS URL — Plivo's start event does not carry them,
  // and the answer webhook is the only place we see the real numbers.
  if (from) parts.push(`from=${encodeURIComponent(from)}`);
  if (to)   parts.push(`to=${encodeURIComponent(to)}`);
  const qs = parts.length ? `?${parts.join("&")}` : "";
  // Per Plivo Stream XML docs, the WebSocket URL is the TEXT CONTENT of
  // <Stream>, not a child element. The previous <WebSocket url="..."/> child
  // was silently ignored by Plivo → no media stream ever connected → the call
  // sat in silence for a few seconds and dropped. XML-escape "&" in the query
  // string (bare & is an XML parse error; Plivo decodes &amp; back).
  const wsUrl = `${wsBaseUrl}/api/ws/plivo/${agentId}${qs}`.replace(/&/g, "&amp;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream keepCallAlive="true" streamTimeout="86400" contentType="audio/x-mulaw;rate=8000" bidirectional="true">${wsUrl}</Stream>
</Response>`;
}
