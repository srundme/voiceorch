import type { WebSocket } from "ws";
import { createSession, getSession, endSession, failSession } from "../session.js";
import { downsample16to8 } from "../audio.js";
import { toReadableError } from "../utils.js";
import { logger } from "../../lib/logger.js";

/**
 * Browser "Live Test" WebSocket handler — Webcall 2.0.
 *
 * THE design lesson from the deleted 1.0: do NOT reimplement the orchestration
 * pipeline. This is a thin transport adapter over the SAME createSession /
 * OrchestrationPipeline used by telephony. Barge-in, endpointing safety-nets,
 * recording, greeting markup stripping, sentence flush and TTS tail-drain all
 * live in the shared pipeline core, so this transport inherits every fix for
 * free and can never drift out of parity with the phone path.
 *
 * Wire protocol
 *   Client → server:
 *     • binary frame            → PCM16 16 kHz LE mic audio (downsampled to 8 kHz here)
 *     • {"type":"end"}          → caller hung up
 *   Server → client:
 *     • binary frame            → PCM16 8 kHz LE agent audio (rawPcmOutput)
 *     • {"type":"ready"}        → session established, greeting incoming
 *     • {"type":"transcript",speaker,text}
 *     • {"type":"clear"}        → BARGE-IN: client MUST flush its playback queue now
 *     • {"type":"call_end"}     → call ended; client drains then tears down
 *     • {"type":"error",message}
 *
 * Audio is PCM both directions (rawPcmOutput:true). Browser AEC
 * (echoCancellation in getUserMedia) keeps the agent's speaker output from
 * echoing back into the mic — the transport-native replacement for 1.0's
 * fragile content-based echo detection.
 */
export async function handleWebcallWebSocket(
  ws: WebSocket,
  agentId: number,
  userId: string,
  opts?: { guestKey?: string; linkId?: number | null },
): Promise<void> {
  let sessionId: string | null = null;
  // The socket can close / error / send "end" while createSession is still
  // awaiting (slow provider setup). Listeners are attached BEFORE the await so
  // those events are never lost; if one fires before the session id exists we
  // flag it and end the session the instant it becomes available.
  let endedBeforeReady = false;
  // Guards against ending the same session twice (e.g. client sends "end" and
  // then the socket closes). endSession is idempotent, but this avoids the noise.
  let ending = false;
  const guestKey = opts?.guestKey?.trim() || null;

  function sendJson(obj: unknown): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  }

  // Pipeline delivers raw 8 kHz LINEAR16 LE PCM (rawPcmOutput:true). Forward as a
  // binary frame; the browser queues + plays it.
  function sendAudio(pcm8k: Buffer): void {
    if (ws.readyState === ws.OPEN) ws.send(pcm8k);
  }

  function requestEnd(): void {
    if (ending) return;
    ending = true;
    if (sessionId) {
      endSession(sessionId).catch((e: unknown) =>
        logger.error({ sessionId, err: e }, "Webcall endSession failed"));
    } else {
      endedBeforeReady = true;
    }
  }

  // ── Listeners FIRST (before awaiting createSession) ──────────────────────────
  ws.on("message", (raw: Buffer, isBinary: boolean) => {
    // `ws` delivers TEXT frames as a Buffer with isBinary=false, so isBinary is
    // the only reliable discriminator — Buffer.isBuffer() would be true for both.
    if (isBinary) {
      if (!sessionId) return; // dropped until session ready — acceptable
      const session = getSession(sessionId);
      if (!session) return;
      // COPY (not alias) the incoming frame: `raw` may be a view over a buffer
      // that `ws` reuses/overwrites internally for the NEXT frame. The old code
      // only ever read it synchronously (downsample16to8 below), which was safe.
      // Now we also hand a reference to the pipeline's nativePcm16kQueue, which
      // isn't consumed until the async audio worker resolves — an aliased buffer
      // would silently turn into a LATER frame's audio by the time it's used,
      // producing seemingly-random garbled STT output (e.g. "VoBiz" -> "Wabis"/
      // "24"/"obese" with no phonetic relation at all — the classic signature of
      // reading memory that has since been overwritten, not just muffled audio).
      const pcm16k = Buffer.isBuffer(raw)
        ? Buffer.from(raw)
        : Buffer.from(raw as ArrayBufferLike);
      if (pcm16k.length < 2) return;
      // Pass noiseCancel=false: browser WebRTC already applies echo cancellation
      // and noise suppression before sending audio.  Server-side gating on top
      // zeroes out quiet-but-valid speech (the gate threshold is calibrated for
      // telephony, not clean mic audio), causing the "only loud speech works" bug.
      //
      // Also pass the TRUE native 16k buffer alongside the downsampled 8k one.
      // The 8k copy is only needed for the internal VAD/DTMF/energy pipeline;
      // downsample16to8 halves the Nyquist limit to 4kHz, which destroys the
      // high-frequency fricative energy ("v", "z", "s") that distinguishes
      // words like "VoBiz" from "Bobby". If STT only ever saw the 8k→16k
      // round trip (upsample8to16 is pure interpolation, it can't invent lost
      // frequencies back), that information is gone for good. Threading the
      // real 16k mic audio through to the STT feed fixes that misrecognition.
      session.pipeline.onRawPcm8kIn(downsample16to8(pcm16k), false, pcm16k);
      return;
    }
    // Text = control message.
    let msg: { type?: string; data?: string; mimeType?: string };
    try { msg = JSON.parse(raw.toString()) as { type?: string; data?: string; mimeType?: string }; } catch { return; }
    if (msg.type === "end") {
      logger.info({ sessionId, agentId }, "Webcall client requested end");
      requestEnd();
      return;
    }
    if (msg.type === "video_frame" && msg.data) {
      if (!sessionId) return;
      const session = getSession(sessionId);
      if (!session) return;
      session.pipeline.onVideoFrame?.(msg.data, msg.mimeType ?? "image/jpeg");
      return;
    }
  });

  ws.on("close", () => {
    logger.info({ sessionId, agentId }, "Webcall WS closed");
    requestEnd();
  });

  ws.on("error", (err: unknown) => {
    logger.error({ sessionId, agentId, err }, "Webcall WS error");
    if (ending) return;
    ending = true;
    if (sessionId) {
      failSession(sessionId, toReadableError(err, "Webcall transport error")).catch((e: unknown) =>
        logger.error({ sessionId, err: e }, "Webcall failSession failed"));
    } else {
      endedBeforeReady = true;
    }
  });

  // ── Establish the shared pipeline session ────────────────────────────────────
  try {
    const { sessionId: sid } = await createSession({
      agentId,
      telephonyProvider: "webcall",
      // Synthetic identifiers: session.ts maps "webcall-user-<id>" → "webcall:user_<id>"
      // so caller memory IS captured per authenticated user (not skipped).
      // Guests use webcall-guest-* so they don't collide with the agent owner's memory.
      toNumber: `webcall-agent-${agentId}`,
      fromNumber: guestKey ? `webcall-${guestKey}` : `webcall-user-${userId}`,
      rawPcmOutput: true,
      onAudioOut: sendAudio,
      onCallEnd: () => { ending = true; sendJson({ type: "call_end" }); ws.close(); },
      onBargeIn: () => sendJson({ type: "clear" }),
      onTranscript: (speaker, text) => sendJson({ type: "transcript", speaker, text }),
    });
    sessionId = sid;
    if (endedBeforeReady) {
      logger.warn({ sessionId, agentId }, "Webcall ended before setup completed — ending immediately");
      await endSession(sessionId);
      return;
    }
    sendJson({ type: "ready", callId: getSession(sid)?.callId ?? null });
    logger.info({ sessionId, agentId, userId, guest: !!guestKey, linkId: opts?.linkId ?? null }, "Webcall session started");
  } catch (err) {
    const reason = toReadableError(err, "Webcall session setup failed");
    logger.error({ err, agentId, userId, reason }, "Failed to create webcall session");
    sendJson({ type: "error", message: reason });
    ws.close();
  }
}
