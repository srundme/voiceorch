import type { WebSocket } from "ws";
import { PlaybackCheckpoints } from "./playback-checkpoints.js";
import { createSession, getSession, getSessionByCampaignLeadId, getSessionByExternalCallId, endSession, failSession } from "../session.js";
import { toReadableError } from "../utils.js";
import { logger } from "../../lib/logger.js";
import { db, scheduledCallbacksTable, callsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { startEarlyAmbientKeepalive } from "./early-ambient.js";
import { decideVobizDuplicateStart, vobizDuplicateLegKey } from "./vobiz-duplicate-stream.js";

/** Serializes createSession for a VoBiz CallUUID so two answer-webhook retries
 *  cannot both pass the live-session check before either session is registered. */
const vobizCallUuidStartsInFlight = new Set<string>();
/** Same campaign dial can mint two CallUUIDs (two answer webhooks). */
const vobizLegStartsInFlight = new Set<string>();

/**
 * The agent's Noise Cancellation toggle is honored here; this integration
 * does not establish whether carrier-side denoising is present. The handler
 * passes no noiseCancel flag and lets the pipeline (classic or Gemini Live)
 * apply resolveSoftwareNoiseGate. Hardcoding false here used to make the
 * toggle a silent no-op for every VoBiz agent. See orchestration/noise-gate.ts.
 */

/**
 * Vobiz WebSocket handler
 *
 * This integration requests LINEAR16 PCM8k input. Vobiz also supports other
 * inbound formats; do not assume they are interchangeable with this path.
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
 * Docs: https://www.vobiz.ai/docs/concepts/streaming-websockets
 */

interface VobizMessage {
  event: "connected" | "start" | "media" | "stop" | "mark" | "playedStream" | "clearedAudio";
  name?: string;
  sequenceNumber?: number;
  streamId?: string;
  mark?: {
    name: string;
  };
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
  voicemailDelivery = false,
  /**
   * The VoBiz call_uuid from the HTTP answer-webhook body (req.body.CallUUID).
   * Passed here via the WebSocket URL query string (?callUuid=...) by the
   * answer webhook handler.  This is the canonical REST API identifier — used
   * as externalCallId in preference to msg.start.callId, which may be a
   * stream-scoped session ID rather than the REST call_uuid that the
   * /Call/{uuid}/Transfer/ endpoint expects.
   */
  urlCallUuid?: string,
  callDirection: "inbound" | "outbound" = "inbound",
  /**
   * Opaque per-call correlation token minted at outbound dial time (calls.ts) and
   * threaded through the answer webhook → answer XML → this WS URL. Forwarded to
   * createSession so the pre-created outbound exec_* record (keyed by corrToken,
   * NOT by the live CallUUID it does not yet hold) is matched and updated in place.
   */
  corrToken?: string,
  /**
   * Scheduled-callback row ID, present when this call was fired by the callback
   * poller (network_drop or callback_requested reason). Used to load
   * resumeContext from the originating call and inject it into the session.
   */
  callbackId?: number,
  /**
   * Carrier answer/bridge time (epoch ms) captured at the HTTP answer webhook
   * and threaded here via the WS URL (?ans=...). Forwarded to createSession to
   * anchor both the call duration clock and the recording timeline, so the gap
   * between carrier answer and this media-stream connect is counted and padded.
   */
  urlAnsweredAt?: number,
  /**
   * When true, the answer webhook reported an UNRELIABLE VoBiz "machine" flag
   * (threaded here via the WS URL ?amdHint=machine). The session opens normally
   * but confirms the machine verdict acoustically before enacting any voicemail
   * action, so a live human is never harmed. See confirmAmdMachineThenBranch.
   */
  amdMachineHint = false,
  /**
   * When true, AMD is enabled for this outbound call and acoustic confirmation
   * must be armed UNCONDITIONALLY at session start (threaded via ?amdArm=1) —
   * VoBiz's verdict arrives on the async machine_detection_url callback, not the
   * answer webhook, so waiting for a hint means voicemail is never detected.
   */
  amdArmed = false,
): Promise<void> {
  let sessionId: string | null = null;
  let streamId: string | null = null;
  let myEpoch = 1;
  // True when VoBiz sent "stop" or closed the socket while createSession was still
  // awaiting.  In that case sessionId was null at the time, so endSession was
  // skipped.  We detect this and call endSession immediately once sessionId is set.
  let sessionEndedBeforeReady = false;
  const playback = new PlaybackCheckpoints((name) => {
    if (!streamId || ws.readyState !== ws.OPEN) throw new Error("Vobiz socket not open");
    ws.send(JSON.stringify({ event: "checkpoint", streamId, name }));
  });
  let sessionStarting = false;
  function ownsMedia(): boolean {
    if (!sessionId) return true;
    const sess = getSession(sessionId);
    return !sess || sess.mediaEpoch === myEpoch;
  }
  // Caller audio can arrive while DB/config/provider setup is awaited. Retain
  // at most 5 seconds of PCM8k, not an unbounded queue during a stuck setup.
  const pendingInput: Buffer[] = [];
  let pendingInputBytes = 0;
  const maxPendingInputBytes = 8000 * 2 * 5;
  function clearPendingInput(): void {
    pendingInput.length = 0;
    pendingInputBytes = 0;
  }

  /**
   * Send audio to Vobiz caller via the playAudio WebSocket event.
   * Pipeline delivers raw 8kHz LINEAR16 LE PCM (rawPcmOutput: true in session config).
   * Vobiz accepts the payload as-is in little-endian format despite audio/x-l16 being
   * nominally big-endian per RFC 2586 — byte-swapping causes silence/garble.
   */
  function sendAudioToVobiz(pcmChunk: Buffer): void {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > 64 * 1024) {
      logger.error({ streamId, bufferedBytes: ws.bufferedAmount }, "Vobiz output backpressure exceeded; closing stalled transport");
      ws.close(1013, "Audio transport overloaded");
      return;
    }
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
    playback.clear();
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

        // The live VoBiz call_uuid — the ONLY identifier /Call/{uuid}/Transfer/
        // accepts — is delivered on the HTTP answer webhook as `CallUUID` and
        // forwarded here as `urlCallUuid`. The dial-API response only returns a
        // `request_uuid` (a request id that 404s on Transfer), so it is NEVER used
        // as the transfer call_uuid; it survives only as a correlation key on the
        // call record. `msg.start.callId` is a stream-session id and is a last
        // resort only. Priority: answer-webhook CallUUID → stream callId.
        const resolvedCallId = urlCallUuid ?? callId ?? null;

        const params = msg.start?.customParameters ?? {};
        // Priority: URL query params (most reliable) → start.from/to → customParameters → fallback
        const fromNumber = urlFrom ?? msg.start?.from ?? params["From"] ?? "+10000000000";
        const toNumber   = urlTo   ?? msg.start?.to   ?? params["To"]   ?? "+10000000001";

        // DIAGNOSTIC: prove which id is used for Transfer. `resolvedCallId` (the
        // answer-webhook CallUUID) is what /Transfer/ uses; `streamCallId` is the
        // WS stream-session id and `corrToken` links back to the dial request_uuid.
        logger.info({ agentId, streamId, streamCallId: callId, resolvedCallId, urlCallUuid: urlCallUuid ?? null, corrToken: corrToken ?? null, fromNumber, toNumber, encoding: msg.start?.mediaFormat?.encoding }, "Vobiz start event");

        // ── Duplicate-stream guard ───────────────────────────────────────────
        // A VoBiz answer-webhook retry can open a SECOND media WebSocket for the
        // same CallUUID. The session map is keyed by internal sessionId, so
        // nothing else prevents two live sessions (= two greetings + two TTS
        // senders). That overlapping audio is what callers hear as a "broken"
        // voice. Squad live handoff reuses this socket and does not emit a
        // second start — it is not blocked. A later reconnect is allowed once
        // the previous session has left the map (endSession).
        const legKey = vobizDuplicateLegKey({ campaignLeadId, corrToken });
        const existing = resolvedCallId ? getSessionByExternalCallId(resolvedCallId) : undefined;
        const existingLeg = campaignLeadId != null ? getSessionByCampaignLeadId(campaignLeadId) : undefined;
        const decision = decideVobizDuplicateStart({
          callUuid: resolvedCallId,
          hasLiveSession: !!existing,
          startInFlight: resolvedCallId ? vobizCallUuidStartsInFlight.has(resolvedCallId) : false,
          legKey,
          hasLiveLeg: !!existingLeg,
          legStartInFlight: legKey ? vobizLegStartsInFlight.has(legKey) : false,
        });
        if (decision.close) {
          const live = existing ?? existingLeg;
          if (live?.voiceStack === "personaplex") {
            myEpoch = live.retargetAudioOut((audio) => sendAudioToVobiz(audio));
            sessionId = live.sessionId;
            logger.warn(
              {
                agentId,
                resolvedCallId,
                callId: live.callId,
                sessionId,
                streamId,
                mediaEpoch: myEpoch,
                reason: decision.reason,
              },
              "Vobiz start: second media socket — moved Irfan audio onto this stream",
            );
            break;
          }
          logger.warn(
            {
              agentId,
              resolvedCallId,
              existingCallId: existing?.callId ?? existingLeg?.callId ?? null,
              campaignLeadId: campaignLeadId ?? null,
              streamId,
              reason: decision.reason,
            },
            "Vobiz start: live session already exists for this CallUUID — closing duplicate media stream, no second playback",
          );
          ws.close();
          break;
        }
        if (resolvedCallId) vobizCallUuidStartsInFlight.add(resolvedCallId);
        if (legKey) vobizLegStartsInFlight.add(legKey);
        sessionStarting = true;

        // Measures the pre-pipeline setup window (WS start → session ready).
        // Watch setupMs in prod for DB/setup latency; caller should hear ambient
        // (not dead air) during this window via early-ambient keepalive below.
        const sessionSetupStartedAt = Date.now();

        // ── Ambient keepalive during session init ───────────────────────────
        // VoBiz drops the call if the audio bridge receives no data for ~2 s
        // even with keepCallAlive="true". Previously we sent PCM zeros — the
        // caller heard pure dead air (no agent bg noise either) until
        // createSession finished and the pipeline started. Early ambient sends
        // real comfort/agent ambient from WS start so that gap is never silent.
        const earlyAmbient = startEarlyAmbientKeepalive({
          agentId,
          format: "pcm16",
          send: (chunk) => {
            if (ws.readyState === ws.OPEN) sendAudioToVobiz(chunk);
          },
        });
        const stopSilence = (): void => { earlyAmbient.stop(); };

        // Load resumeContext and callback reason from the originating call if this is a callback
        let priorResumeContext: Parameters<typeof createSession>[0]["resumeContext"] | undefined;
        let sourceCallbackReason: string | undefined;
        if (callbackId) {
          try {
            const [cbRow] = await db.select({ createdFromCallId: scheduledCallbacksTable.createdFromCallId, reason: scheduledCallbacksTable.reason })
              .from(scheduledCallbacksTable)
              .where(eq(scheduledCallbacksTable.id, callbackId));
            sourceCallbackReason = cbRow?.reason ?? undefined;
            if (cbRow?.reason === "network_drop" && cbRow.createdFromCallId) {
              const [srcCall] = await db.select({ resumeContext: callsTable.resumeContext })
                .from(callsTable)
                .where(eq(callsTable.id, cbRow.createdFromCallId));
              if (srcCall?.resumeContext) priorResumeContext = srcCall.resumeContext;
            }
          } catch (ctxErr) {
            logger.warn({ callbackId, ctxErr }, "Vobiz: failed to load resumeContext from prior call — continuing without it");
          }
        }

        try {
          const { sessionId: sid } = await createSession({
            awaitPlaybackReceipt: () => playback.wait(),
            agentId,
            telephonyProvider: "vobiz",
            toNumber,
            fromNumber,
            externalCallId: resolvedCallId ?? undefined,
            corrToken,
            platformTelephony,
            callDirection,
            customParameters: params,
            campaignLeadId,
            voicemailDelivery,
            amdMachineHint,
            amdArmed,
            resumeContext: priorResumeContext,
            sourceCallbackReason,
            scheduledCallbackId: callbackId,
            answeredAt: urlAnsweredAt,
            onAudioOut: (audio: Buffer) => {
              stopSilence();            // first real audio → drop silence immediately
              sendAudioToVobiz(audio);
            },
            onCallEnd: () => {
              stopSilence();
              // Do NOT close the WS if the call was transferred — VoBiz has
              // already closed the AI stream (sent "stop") and is in the process
              // of redirecting the call leg to the human agent via the Transfer API.
              // Sending a WS close frame at this point makes VoBiz treat the
              // call itself as hung-up, aborting the in-flight transfer.
              const sess = sessionId ? getSession(sessionId) : null;
              if (sess?.wasTransferred) {
                logger.info({ sessionId }, "Vobiz onCallEnd: skipping ws.close() — call is being transferred");
                return;
              }
              ws.close();
            },
            onBargeIn: sendBargeIn,
          });
          stopSilence();                // safety-net: session ready with no audio yet
          sessionId = sid;
          if (sessionEndedBeforeReady) {
            clearPendingInput();
            // VoBiz sent stop/closed the socket while createSession was still
            // setting up.  sessionId was null then so endSession was skipped —
            // call it now so the record is not stuck in_progress.
            logger.warn({ sessionId, agentId }, "Vobiz session ended before setup completed — ending immediately");
            await endSession(sessionId);
          } else {
            const readySession = getSession(sid);
            for (const pcm of pendingInput) readySession?.pipeline.onRawPcm8kIn(pcm);
            if (pendingInputBytes > 0) {
              logger.info({ sessionId, bufferedInputMs: pendingInputBytes / 16 }, "Vobiz: delivered caller audio retained during session setup");
            }
            clearPendingInput();
            logger.info({ sessionId, agentId, fromNumber, toNumber, streamId, setupMs: Date.now() - sessionSetupStartedAt }, "Vobiz session started");
          }
        } catch (err) {
          stopSilence();
          logger.error(
            { err, agentId, externalCallId: callId, streamId, provider: "vobiz", reason: toReadableError(err, "Vobiz session setup failed") },
            "Failed to create Vobiz session — closing socket before greeting",
          );
          ws.close();
        } finally {
          sessionStarting = false;
          clearPendingInput();
          if (resolvedCallId) vobizCallUuidStartsInFlight.delete(resolvedCallId);
          if (legKey) vobizLegStartsInFlight.delete(legKey);
        }
        break;
      }

      case "media": {
        if (!ownsMedia()) break;
        if (!msg.media?.payload || sessionEndedBeforeReady) break;
        if (msg.media.track && msg.media.track !== "inbound") break;
        if (!sessionId) {
          if (!sessionStarting) break;
          const pcm = Buffer.from(msg.media.payload, "base64");
          if (pcm.length === 0 || pcm.length % 2 !== 0) break;
          // Oversized messages retain only a bounded, sample-aligned tail.
          const bounded = Buffer.from(pcm.subarray(Math.max(0, pcm.length - maxPendingInputBytes)));
          pendingInput.push(bounded);
          pendingInputBytes += bounded.length;
          while (pendingInputBytes > maxPendingInputBytes) pendingInputBytes -= pendingInput.shift()!.length;
          break;
        }
        const session = getSession(sessionId);
        if (!session) break;
        // Vobiz sends inbound audio as little-endian LINEAR16 PCM (same as outbound).
        // Pass directly to pipeline — no byte-swap needed.
        const pcm8k = Buffer.from(msg.media.payload, "base64");
        // No noiseCancel argument: the pipeline (classic or Gemini Live) applies
        // the agent's Noise Cancellation toggle via noise-gate.ts.
        session.pipeline.onRawPcm8kIn(pcm8k);
        break;
      }

      case "playedStream": {
        if (msg.name) playback.acknowledge(msg.name);
        break;
      }
      case "clearedAudio":
        // Local clearAudio already invalidated outstanding receipts. Do not
        // clear again: a delayed carrier confirmation may belong to an old turn.
        break;
      case "mark": {
        if (sessionId && msg.mark?.name) {
          const session = getSession(sessionId);
          if (session) {
            (session as any).pipeline?.onAudioMarkAck?.(msg.mark.name);
          }
        }
        break;
      }

      case "stop":
        playback.close();
        clearPendingInput();
        logger.info({ sessionId }, "Vobiz stream stopped");
        if (sessionId) {
          if (!ownsMedia()) {
            logger.info({ sessionId, myEpoch }, "Vobiz stop after media handoff — session stays on the new socket");
            break;
          }
          getSession(sessionId)?.pipeline.noteMediaDropIfWaitingForReply();
          await endSession(sessionId);
        } else {
          sessionEndedBeforeReady = true;
        }
        break;
    }
  });

  ws.on("close", () => {
    playback.close();
    clearPendingInput();
    logger.info({ sessionId }, "Vobiz WS closed");
    if (sessionId) {
      if (!ownsMedia()) {
        logger.info({ sessionId, myEpoch }, "Vobiz WS closed after media handoff — session stays live");
        return;
      }
      getSession(sessionId)?.pipeline.noteMediaDropIfWaitingForReply();
      endSession(sessionId).catch((err: unknown) =>
        logger.error({ sessionId, err }, "Vobiz WS close: endSession failed"),
      );
    } else {
      sessionEndedBeforeReady = true;
    }
  });

  ws.on("error", (err: unknown) => {
    playback.close();
    clearPendingInput();
    logger.error({ sessionId, err }, "Vobiz WS error");
    if (sessionId) {
      if (!ownsMedia()) return;
      failSession(sessionId, toReadableError(err, "Telephony error")).catch((e: unknown) =>
        logger.error({ sessionId, err: e }, "Vobiz WS error: failSession failed"),
      );
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
  opts: { campaignLeadId?: number; from?: string; to?: string; voicemailDelivery?: boolean; amdMachineHint?: boolean; amdArm?: boolean; callUuid?: string; corr?: string; callDirection?: "inbound" | "outbound"; cbId?: number; answeredAt?: number } = {},
): string {
  const qsParts: string[] = [];
  if (platformTelephony) qsParts.push("pt=1");
  if (opts.campaignLeadId) qsParts.push(`campaignLeadId=${opts.campaignLeadId}`);
  // dir=out marks an outbound call so the WS handler keys caller memory off the
  // dialed party (To), not the shared platform From number.
  if (opts.callDirection === "outbound") qsParts.push("dir=out");
  // vm=1 routes the WS handler into voicemail-delivery mode: it listens for the
  // answering machine's greeting to end, then speaks the full message once.
  if (opts.voicemailDelivery) qsParts.push("vm=1");
  // amdHint=machine routes the WS handler into acoustic AMD confirmation: the normal
  // media stream is opened, but the pipeline confirms the machine verdict acoustically
  // before enacting any voicemail action (VoBiz's raw machine flag is unreliable).
  if (opts.amdMachineHint) qsParts.push("amdHint=machine");
  // amdArm=1 arms hint-INDEPENDENT acoustic AMD confirmation: set for every
  // AMD-enabled VoBiz outbound call regardless of any answer-webhook flag, since
  // per VoBiz docs the verdict arrives via the async machine_detection_url
  // callback (which corroborates the acoustic analysis mid-window), not here.
  if (opts.amdArm) qsParts.push("amdArm=1");
  // Embed From/To in the WebSocket URL query string — the most reliable way to
  // pass caller/callee numbers.  VoBiz POSTs them to the answer URL, we encode
  // them here, and our WS handler reads them from the URL before the start event
  // arrives (VoBiz's start.from/to and customParameters support is inconsistent).
  if (opts.from) qsParts.push(`from=${encodeURIComponent(opts.from)}`);
  if (opts.to)   qsParts.push(`to=${encodeURIComponent(opts.to)}`);
  // Embed the VoBiz call_uuid from the HTTP answer-webhook body so the WS handler
  // can use it as externalCallId — the canonical REST API identifier needed for
  // the /Call/{uuid}/Transfer/ endpoint (msg.start.callId may differ).
  if (opts.callUuid) qsParts.push(`callUuid=${encodeURIComponent(opts.callUuid)}`);
  // Opaque per-call correlation token minted at outbound dial time (calls.ts).
  // The WS handler forwards it to createSession so the pre-created exec_* row can
  // be matched and updated in place with the live CallUUID (the dial response only
  // carried a request_uuid, which can never match providerCallId === CallUUID).
  if (opts.corr) qsParts.push(`corr=${encodeURIComponent(opts.corr)}`);
  // Embed cbId so the WS handler can load prior call's resumeContext for inject.
  if (opts.cbId) qsParts.push(`cbId=${opts.cbId}`);
  // Carrier answer/bridge time (epoch ms) captured at the answer webhook. The WS
  // handler forwards it to createSession so the call duration clock and recording
  // timeline are anchored to the actual answer instant, not media-stream connect.
  if (opts.answeredAt) qsParts.push(`ans=${opts.answeredAt}`);
  const qs = qsParts.length ? `?${qsParts.join("&")}` : "";
  const wsUrl = `${wsBaseUrl}/api/ws/vobiz/${agentId}${qs}`;
  // XML-escape the URL before embedding in the <Stream> text node.  Bare "&" in
  // XML text content is a parse error; when the query string has multiple params
  // (e.g. ?from=917971543255&to=916383653279) VoBiz's parser rejects the whole
  // XML with HangupCauseCode 8011 "Invalid Answer XML" and drops the call before
  // opening the WebSocket.  VoBiz decodes &amp; back to & when it reads the URL.
  const wsUrlXml = wsUrl.replace(/&/g, "&amp;");
  // keepCallAlive=true so a brief WS blip does not drop the PSTN leg. Closing
  // the socket therefore does NOT hang up — session.ts must DELETE /Call/{uuid}
  // on agent end_call (call 25223 stayed live after goodbye).
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=8000">${wsUrlXml}</Stream>
</Response>`;
}
