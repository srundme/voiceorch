import type { WebSocket } from "ws";
import { createSession, getSession, endSession, failSession } from "../session.js";
import { encodeMulaw, decodeMulaw } from "../audio.js";
import { toReadableError } from "../utils.js";
import { logger } from "../../lib/logger.js";
import { db, scheduledCallbacksTable, callsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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
  agentId: number,
  campaignLeadId?: number,
  callDirection: "inbound" | "outbound" = "inbound",
  callbackId?: number,
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

  /**
   * Barge-in: tell Plivo to discard any audio it has buffered for playback.
   * Plivo's AudioSocket protocol accepts { event: "clear" } from the server
   * to immediately stop ongoing playback and flush its buffer.
   * Ref: https://www.plivo.com/docs/voice/xml/stream/#websocket-messages
   */
  function sendBargeIn(): void {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ event: "clear" }));
    logger.info({ sessionId }, "Plivo clear sent (barge-in)");
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
            toNumber,
            fromNumber,
            externalCallId: callId,
            callDirection,
            campaignLeadId,
            resumeContext,
            sourceCallbackReason,
            scheduledCallbackId: callbackId,
            onAudioOut: sendAudioToPlivo,
            onCallEnd: () => ws.close(),
            onBargeIn: sendBargeIn,
          });
          sessionId = sid;
          logger.info({ sessionId, agentId }, "Plivo session started");
        } catch (err) {
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

  ws.on("close", () => {
    if (sessionId) {
      endSession(sessionId).catch((err: unknown) =>
        logger.error({ sessionId, err }, "Plivo WS close: endSession failed"),
      );
    }
  });

  ws.on("error", (err: unknown) => {
    logger.error({ sessionId, err }, "Plivo WS error");
    if (sessionId) {
      failSession(sessionId, toReadableError(err, "Telephony error")).catch((e: unknown) =>
        logger.error({ sessionId, err: e }, "Plivo WS error: failSession failed"),
      );
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
): string {
  const parts: string[] = [];
  if (campaignLeadId) parts.push(`campaignLeadId=${campaignLeadId}`);
  if (callDirection === "outbound") parts.push("dir=out");
  if (callbackId) parts.push(`cbId=${callbackId}`);
  const qs = parts.length ? `?${parts.join("&")}` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream keepCallAlive="true" streamTimeout="600" contentType="audio/x-mulaw;rate=8000" bidirectional="true">
    <WebSocket url="${wsBaseUrl}/api/ws/plivo/${agentId}${qs}"/>
  </Stream>
</Response>`;
}
