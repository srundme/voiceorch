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
): Promise<void> {
  let sessionId: string | null = null;
  let streamId: string | null = null;
  // True when Plivo sent "stop"/closed the socket while createSession was still
  // awaiting. sessionId was null then so endSession was skipped — detect it and end
  // the session as soon as sessionId is assigned so the record isn't stuck in_progress.
  let sessionEndedBeforeReady = false;

  function sendAudioToPlivo(audio: Buffer): void {
    if (ws.readyState !== ws.OPEN) return;
    // Per Plivo Stream docs, agent→Plivo audio uses event "media" (NOT
    // "playback" — Plivo silently drops unknown events, which produced calls
    // where the caller heard only Plivo-side prompts and never the agent).
    ws.send(JSON.stringify({
      event: "media",
      media: { payload: audio.toString("base64") },
    }));
  }

  /**
   * Barge-in: tell Plivo to discard any audio it has buffered for playback.
   * Plivo's AudioSocket protocol accepts { event: "clear" } from the server
   * to immediately stop ongoing playback and flush its buffer.
   * Ref: https://www.plivo.com/docs/voice/xml/stream/#websocket-messages
   */
  function sendBargeIn(): void {
    if (ws.readyState !== ws.OPEN) return;
    // Plivo's clear message requires the streamId of the stream to flush.
    ws.send(JSON.stringify({ event: "clear", streamId: streamId ?? undefined }));
    logger.info({ sessionId, streamId }, "Plivo clear sent (barge-in)");
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
        streamId = event.start?.streamId ?? event.streamId ?? event.start?.stream_id ?? event.stream_id ?? null;
        // from/to come from the WS URL query (the start event doesn't carry them).
        const from = fromNumber ?? event.start?.from ?? "+10000000000";
        const to   = toNumber   ?? event.start?.to   ?? "+10000000001";
        const callId = event.start?.callId ?? event.start?.call_id ?? event.call_id;

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

        // Ambient during createSession — Plivo previously sent nothing until
        // the pipeline existed (pure dead air, including no agent bg noise).
        const earlyAmbient = startEarlyAmbientKeepalive({
          agentId,
          format: "mulaw",
          send: sendAudioToPlivo,
        });
        const stopEarlyAmbient = (): void => { earlyAmbient.stop(); };

        try {
          const { sessionId: sid } = await createSession({
            agentId,
            telephonyProvider: "plivo",
            toNumber: to,
            fromNumber: from,
            externalCallId: callId,
            callDirection,
            campaignLeadId,
            resumeContext,
            sourceCallbackReason,
            scheduledCallbackId: callbackId,
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
            { err, agentId, externalCallId: callId, streamId, provider: "plivo", reason: toReadableError(err, "Plivo session setup failed") },
            "Failed to create Plivo session — closing socket before greeting",
          );
          ws.close();
        }
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
): string {
  const parts: string[] = [];
  if (campaignLeadId) parts.push(`campaignLeadId=${campaignLeadId}`);
  if (callDirection === "outbound") parts.push("dir=out");
  if (callbackId) parts.push(`cbId=${callbackId}`);
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
