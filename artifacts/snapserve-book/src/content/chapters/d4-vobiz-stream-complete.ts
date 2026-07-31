import type { Chapter } from "../types";

export const vobizStreamComplete: Chapter = {
  slug: "vobiz-stream-complete",
  moduleId: "d4",
  number: "20.1",
  title: "The VoBiz Audio Stream, End to End",
  summary:
    "Walk the whole VoBiz WebSocket handler: LINEAR16 8 kHz little-endian frames both directions, the answer-anchor query params, the session race, and the 4010 drop.",
  estMinutes: 22,
  fileRef: "artifacts/api-server/src/orchestration/telephony/vobiz.ts",
  prerequisites: ["audio-ts", "session-and-pipeline"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "VoBiz is our main telephony carrier — the company that owns the phone numbers and physically connects calls. When a call is answered, VoBiz opens a **WebSocket** (a long-lived two-way pipe) to our server and starts shipping the caller's audio in real time. Our job is to feed that audio to the pipeline, and ship the agent's voice back the same way.",
        "This file, `vobiz.ts`, is that bridge. It is small but every line is load-bearing: get the audio format wrong and the caller hears static; open the socket a moment too slow and the carrier hangs up; forget one edge case and a call is stuck `in_progress` forever in the database.",
        "We will read the file top to bottom. By the end you will have seen every important part: the audio format note, the two send helpers, the giant `start` handler, the media/stop/close paths, and the answer-XML generator. Along the way we hit four famous gotchas: **L16 8 kHz little-endian frames both ways**, the **session race** (`sessionEndedBeforeReady`), the **answer-anchor** (`?ans=`), and the **4010 drop**.",
      ],
    },
    {
      kind: "concept",
      title: "LINEAR16 (L16) vs μ-law, and why 8 kHz",
      body: [
        "Phone calls are **8 kHz** — 8000 audio samples per second. That is fixed by the telephone network; we cannot change it.",
        "There are two common ways to encode those samples. **μ-law** (mulaw) packs each sample into 1 byte — that is what Twilio and Plivo use. **LINEAR16** (also written L16 or PCM16) uses 2 bytes per sample, so it is raw and uncompressed. VoBiz sends L16.",
        "Two bytes per sample means **byte order** suddenly matters. Little-endian means the low byte comes first; big-endian is the reverse. If the two ends disagree, every sample is scrambled and you get loud garble. VoBiz's docs *say* big-endian, but in practice the wire is little-endian — a trap this file documents in a comment.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/vobiz.ts",
      language: "typescript",
      intro:
        "The file opens with the two facts that shape everything else: VoBiz denoises audio at the carrier, and its Media-Streams protocol looks like Twilio's but carries L16, not μ-law.",
      code: `const VOBIZ_FORCE_SOFTWARE_NC = process.env["VOBIZ_FORCE_SOFTWARE_NC"] === "1";

/**
 * Vobiz WebSocket handler
 *
 * Vobiz uses a Twilio-like Media Streams protocol but with LINEAR16 PCM audio,
 * NOT mulaw. Key differences from Twilio:
 *
 * Inbound event flow (Vobiz -> server):
 *   { event: "connected" }
 *   { event: "start",  start: { callId, streamId, ..., mediaFormat: { encoding: "audio/x-l16", sampleRate: 8000 } } }
 *   { event: "media",  media: { payload: "<base64 LINEAR16 PCM 8kHz>" } }
 *   { event: "stop" }
 *
 * Outbound (server -> Vobiz) to play audio to caller:
 *   { event: "playAudio", media: { contentType: "audio/x-l16", sampleRate: 8000, payload: "<base64 PCM>" } }
 *
 * Barge-in: send { event: "clearAudio", streamId } to discard Vobiz's playback buffer.`,
      lines: [
        {
          lines: "1",
          label: "the software-noise-cancel escape hatch",
          explanation:
            "VoBiz cleans up background noise inside its own network, so our software noise gate is normally skipped for VoBiz calls. `VOBIZ_FORCE_SOFTWARE_NC=1` is an environment-variable override to turn our gate back on if the carrier cleanup ever proves too weak in the field.",
        },
        {
          lines: "5-6",
          label: "Twilio-like, but L16",
          explanation:
            "The event names (`connected`, `start`, `media`, `stop`) mirror Twilio's Media Streams, so the handler shape is familiar. The one big difference — spelled out here so nobody forgets — is the audio: **LINEAR16 PCM**, not μ-law.",
        },
        {
          lines: "8-13",
          label: "the four inbound events",
          explanation:
            "Every VoBiz call sends these in order: `connected` (socket handshake), `start` (call metadata + the negotiated `mediaFormat`), a long stream of `media` frames (base64 L16 8 kHz), then `stop` when the call ends.",
        },
        {
          lines: "15-19",
          label: "how we send audio back",
          explanation:
            "To play the agent's voice, we wrap PCM bytes in a `playAudio` event. To interrupt playback the instant the caller talks over the agent (**barge-in**), we send `clearAudio` so VoBiz throws away whatever it had buffered.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/vobiz.ts",
      language: "typescript",
      intro:
        "The handler takes a pile of parameters, most threaded in from the answer webhook via the WebSocket URL. Two of the most important are the call UUID and the answer time.",
      code: `export async function handleVobizWebSocket(
  ws: WebSocket,
  agentId: number,
  platformTelephony = false,
  campaignLeadId?: number,
  urlFrom?: string,
  urlTo?: string,
  voicemailDelivery = false,
  urlCallUuid?: string,
  callDirection: "inbound" | "outbound" = "inbound",
  corrToken?: string,
  callbackId?: number,
  urlAnsweredAt?: number,
  amdMachineHint = false,
  amdArmed = false,
): Promise<void> {
  let sessionId: string | null = null;
  let streamId: string | null = null;
  let sessionEndedBeforeReady = false;`,
      lines: [
        {
          lines: "9",
          label: "urlCallUuid — the canonical call id",
          explanation:
            "This is the VoBiz `CallUUID` from the HTTP answer webhook, passed here in the WS URL as `?callUuid=...`. It is the ONLY id the `/Call/{uuid}/Transfer/` endpoint accepts. `msg.start.callId` may be a stream-scoped id that differs, so this one wins as the `externalCallId`.",
        },
        {
          lines: "11",
          label: "corrToken — the correlation token",
          explanation:
            "An opaque token minted at outbound dial time. The dial API only returns a `request_uuid`, not the live CallUUID, so we cannot match the pre-created call record by UUID yet. `corrToken` links the WS session back to that pre-created `exec_*` row instead.",
        },
        {
          lines: "13",
          label: "urlAnsweredAt — the answer anchor",
          explanation:
            "Epoch-millisecond timestamp captured at the HTTP answer webhook (the instant the callee picked up), threaded here via `?ans=...`. Forwarded to `createSession` so both the billing clock and the recording timeline start at the real answer instant — not several seconds later when this media stream finally connects.",
        },
        {
          lines: "17-19",
          label: "the three pieces of local state",
          explanation:
            "`sessionId` is null until `createSession` finishes. `streamId` is needed for barge-in. `sessionEndedBeforeReady` is the flag that solves the session race — we'll see it fire below.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/vobiz.ts",
      language: "typescript",
      intro:
        "The outbound send helper. This is where the little-endian gotcha lives. The pipeline hands us raw 8 kHz L16 bytes; we base64 them and ship them as-is.",
      code: `  function sendAudioToVobiz(pcmChunk: Buffer): void {
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

  function sendBargeIn(): void {
    if (!streamId || ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ event: "clearAudio", streamId }));
    logger.info({ streamId }, "Vobiz clearAudio sent (barge-in)");
  }`,
      lines: [
        {
          lines: "1-2",
          label: "guard on socket state",
          explanation:
            "If the socket isn't OPEN, drop the chunk silently. Sending on a closing socket throws — this guard keeps a dying call from crashing the handler.",
        },
        {
          lines: "3-9",
          label: "playAudio with L16 8 kHz, sent as-is",
          explanation:
            "The pipeline produces raw little-endian PCM (the session config sets `rawPcmOutput: true`). We do **not** byte-swap even though `audio/x-l16` is nominally big-endian per RFC 2586. Byte-swapping VoBiz audio causes silence or garble — the wire is little-endian in practice.",
        },
        {
          lines: "13-16",
          label: "sendBargeIn → clearAudio",
          explanation:
            "When the pipeline detects the caller talking over the agent, it calls this. `clearAudio` tells VoBiz to dump its playback buffer immediately so the agent stops mid-word and the caller feels heard. It needs `streamId`, which only arrives on the `start` event.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Little-endian both ways — do not byte-swap",
      body: [
        "VoBiz's own docs describe `audio/x-l16` as big-endian, and RFC 2586 agrees. But the actual bytes on the WebSocket — inbound AND outbound — are **little-endian**. Someone confirmed this by ear: byte-swapping produced silence or garble.",
        "So the rule is: pass inbound `media` bytes straight to the pipeline, and pass pipeline output straight into `playAudio`. No swapping anywhere. This is the kind of thing you only learn by trusting the code comment over the vendor doc.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/vobiz.ts",
      language: "typescript",
      intro:
        "The message loop. Every WebSocket frame lands here as JSON. We switch on the event type. First: the `start` event, where the session is born.",
      code: `  ws.on("message", async (raw: Buffer | string) => {
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
        const resolvedCallId = urlCallUuid ?? callId ?? null;

        const params = msg.start?.customParameters ?? {};
        const fromNumber = urlFrom ?? msg.start?.from ?? params["From"] ?? "+10000000000";
        const toNumber   = urlTo   ?? msg.start?.to   ?? params["To"]   ?? "+10000000001";`,
      lines: [
        {
          lines: "2-6",
          label: "parse or bail",
          explanation:
            "Every frame is JSON. If parsing throws (a malformed frame), we `return` and wait for the next one — one bad frame never kills the call.",
        },
        {
          lines: "14-16",
          label: "resolve the call id",
          explanation:
            "Priority order for the call id: the answer-webhook `urlCallUuid` first (transfer-capable), then the stream's `callId` as a last resort. `resolvedCallId` becomes the session's `externalCallId`.",
        },
        {
          lines: "18-20",
          label: "resolve From/To with fallbacks",
          explanation:
            "Numbers come from three sources in priority order: the URL query params (most reliable), then `start.from/to`, then `customParameters`. If all are missing we use placeholder sentinels (`+10000000000` / `...001`) — which caller-memory deliberately refuses to key on, avoiding cross-caller bleed.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/vobiz.ts",
      language: "typescript",
      intro:
        "Before creating the session there is a duplicate-stream guard — a VoBiz retry can open a SECOND socket for the same call, which on the voicemail path caused overlapping 'helicopter' audio.",
      code: `        if (resolvedCallId && (amdArmed || amdMachineHint || voicemailDelivery)) {
          const existing = getSessionByExternalCallId(resolvedCallId);
          if (existing) {
            logger.warn(
              { agentId, resolvedCallId, existingCallId: existing.callId, streamId },
              "Vobiz start: live session already exists for this CallUUID (AMD/voicemail path) - closing duplicate media stream, no second playback",
            );
            ws.close();
            break;
          }
        }

        const sessionSetupStartedAt = Date.now();`,
      lines: [
        {
          lines: "1-2",
          label: "scoped to the AMD / voicemail path",
          explanation:
            "The session map is keyed by our internal sessionId, so nothing else stops two live sessions for one CallUUID. We only guard the AMD-armed / voicemail path (`amdArmed`, `amdMachineHint`, `voicemailDelivery`) because that is where the damage — two voicemail playbacks at once — actually happened. Normal calls are untouched.",
        },
        {
          lines: "3-10",
          label: "close the duplicate",
          explanation:
            "If a session already exists for this CallUUID, this second socket is a retry. We close it and `break` so there is no second frame-sender and no doubled voicemail.",
        },
        {
          lines: "13",
          label: "start the setup timer",
          explanation:
            "`sessionSetupStartedAt` measures the window between the `start` event and the session being ready. We log it as `setupMs` — watch it in prod to catch slow DB setup, during which the caller must hear ambient (not dead air).",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/vobiz.ts",
      language: "typescript",
      intro:
        "Creating a session takes a few seconds (DB reads). VoBiz drops the call after ~2 s of no audio, so we start ambient keepalive the instant the stream opens — covered in depth in the next chapter.",
      code: `        const earlyAmbient = startEarlyAmbientKeepalive({
          agentId,
          format: "pcm16",
          send: (chunk) => {
            if (ws.readyState === ws.OPEN) sendAudioToVobiz(chunk);
          },
        });
        const stopSilence = (): void => { earlyAmbient.stop(); };`,
      lines: [
        {
          lines: "1-6",
          label: "start ambient immediately",
          explanation:
            "`startEarlyAmbientKeepalive` sends real comfort noise (not dead silence) every 20 ms while the session sets up. `format: \"pcm16\"` because VoBiz consumes L16, not μ-law. Without this the caller hears silence and VoBiz's ~2 s idle timer may fire (hangup 4010).",
        },
        {
          lines: "8",
          label: "stopSilence handle",
          explanation:
            "A tiny wrapper we call the moment real audio takes over — either when the pipeline emits its first frame, or as a safety net once the session is ready with no audio yet.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/vobiz.ts",
      language: "typescript",
      intro:
        "The createSession call. Note the three callbacks that wire the socket to the pipeline: audio out, call end, and barge-in. Then the session-race resolution.",
      code: `          const { sessionId: sid } = await createSession({
            agentId,
            telephonyProvider: "vobiz",
            toNumber,
            fromNumber,
            externalCallId: resolvedCallId ?? undefined,
            corrToken,
            callDirection,
            answeredAt: urlAnsweredAt,
            onAudioOut: (audio: Buffer) => {
              stopSilence();            // first real audio -> drop silence immediately
              sendAudioToVobiz(audio);
            },
            onCallEnd: () => {
              stopSilence();
              const sess = sessionId ? getSession(sessionId) : null;
              if (sess?.wasTransferred) {
                logger.info({ sessionId }, "Vobiz onCallEnd: skipping ws.close() - call is being transferred");
                return;
              }
              ws.close();
            },
            onBargeIn: sendBargeIn,
          });
          stopSilence();                // safety-net: session ready with no audio yet
          sessionId = sid;
          if (sessionEndedBeforeReady) {
            logger.warn({ sessionId, agentId }, "Vobiz session ended before setup completed - ending immediately");
            await endSession(sessionId);
          }`,
      lines: [
        {
          lines: "6-9",
          label: "externalCallId, corrToken, answeredAt",
          explanation:
            "The three identity/timing values threaded from the webhook. `answeredAt` (the `?ans=` anchor) is what makes the billed duration and recording line up with the real call, not the media-connect moment.",
        },
        {
          lines: "10-13",
          label: "onAudioOut",
          explanation:
            "The pipeline calls this with every frame of the agent's voice. The first call also kills the ambient keepalive (`stopSilence`) so the two senders never overlap, then ships the frame to VoBiz.",
        },
        {
          lines: "14-21",
          label: "onCallEnd — the transfer race",
          explanation:
            "When the pipeline ends the call it normally closes the WS. But if the call `wasTransferred`, VoBiz is mid-redirect to a human agent; sending a close frame now makes VoBiz treat the whole call as hung up and aborts the transfer. So we skip `ws.close()` in that case.",
        },
        {
          lines: "26-30",
          label: "the session race resolved",
          explanation:
            "Here is the payoff. If VoBiz sent `stop` or closed the socket **while** `createSession` was still awaiting, `sessionId` was null then, so `endSession` was skipped and the DB row would be stuck `in_progress`. `sessionEndedBeforeReady` records that; now that `sessionId` exists, we end the session immediately.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "The session race, in one sentence",
      body: [
        "Session setup is `await`-ed and takes seconds; the caller can hang up during that window. Because the `stop`/`close`/`error` handlers all check `if (sessionId)` — and `sessionId` is still null mid-setup — they cannot end a session that does not exist yet.",
        "The fix is a boolean latch, `sessionEndedBeforeReady`. Those handlers set it instead of silently doing nothing, and the moment `createSession` returns we notice the latch and call `endSession`. No orphaned `in_progress` rows.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/vobiz.ts",
      language: "typescript",
      intro:
        "The remaining events: media (caller audio → pipeline), stop, and the close/error handlers where the race latch is set.",
      code: `      case "media": {
        if (!sessionId || !msg.media?.payload) break;
        if (msg.media.track && msg.media.track !== "inbound") break;
        const session = getSession(sessionId);
        if (!session) break;
        const pcm8k = Buffer.from(msg.media.payload, "base64");
        session.pipeline.onRawPcm8kIn(pcm8k, VOBIZ_FORCE_SOFTWARE_NC ? undefined : false);
        break;
      }

      case "stop":
        logger.info({ sessionId }, "Vobiz stream stopped");
        if (sessionId) {
          getSession(sessionId)?.pipeline.noteMediaDropIfWaitingForReply();
          await endSession(sessionId);
        } else {
          sessionEndedBeforeReady = true;
        }
        break;
    }
  });

  ws.on("close", () => {
    if (sessionId) {
      getSession(sessionId)?.pipeline.noteMediaDropIfWaitingForReply();
      endSession(sessionId).catch(() => {});
    } else {
      sessionEndedBeforeReady = true;
    }
  });`,
      lines: [
        {
          lines: "2-3",
          label: "only inbound caller audio",
          explanation:
            "Skip if there's no session yet or no payload. Also skip any track that isn't `inbound` — VoBiz can mirror the outbound (agent) track back, and feeding our own voice into STT would be chaos.",
        },
        {
          lines: "6-7",
          label: "decode base64, feed the pipeline",
          explanation:
            "Base64 → raw L16 bytes → `onRawPcm8kIn`. The `false` second argument means 'do not run software noise-cancel' (VoBiz already denoised at the carrier). If the escape-hatch env var is set, we pass `undefined` to let the pipeline's normal gate run.",
        },
        {
          lines: "11-18",
          label: "stop → end, or latch",
          explanation:
            "`stop` ends the call. `noteMediaDropIfWaitingForReply` tells the pipeline the media went away mid-turn (used to decide whether to schedule a network-drop callback). If `sessionId` is still null, we latch `sessionEndedBeforeReady` instead — the race again.",
        },
        {
          lines: "22-29",
          label: "close mirrors stop",
          explanation:
            "The raw socket `close` handler does the same thing as `stop`: end if we can, otherwise latch. Belt and suspenders — VoBiz sometimes closes without a clean `stop`.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/vobiz.ts",
      language: "typescript",
      intro:
        "Finally, the answer XML — what we return from the HTTP answer webhook to tell VoBiz to open this WebSocket. The `?ans=` anchor and the XML-escape are both here.",
      code: `  const wsUrl = \`\${wsBaseUrl}/api/ws/vobiz/\${agentId}\${qs}\`;
  const wsUrlXml = wsUrl.replace(/&/g, "&amp;");
  return \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=8000">\${wsUrlXml}</Stream>
</Response>\`;`,
      lines: [
        {
          lines: "1",
          label: "the WS URL carries all the query params",
          explanation:
            "`qs` is a `?from=...&to=...&callUuid=...&ans=...&corr=...` string built earlier. This is how the webhook (an HTTP request) hands data to the WebSocket handler (a different connection) — you cannot pass function arguments across that boundary, so you smuggle them in the URL.",
        },
        {
          lines: "2",
          label: "XML-escape the ampersands",
          explanation:
            "A bare `&` in XML text is a parse error. With multiple query params the URL is full of them, and VoBiz would reject the whole XML with HangupCauseCode 8011 'Invalid Answer XML' — dropping the call before the socket ever opens. Replacing `&` with `&amp;` fixes it; VoBiz decodes it back when it reads the URL.",
        },
        {
          lines: "5",
          label: "the Stream element — URL as TEXT",
          explanation:
            "The WebSocket URL is the **text content** of `<Stream>`, not an attribute. `bidirectional=\"true\"` = two-way audio. `keepCallAlive=\"true\"` asks VoBiz to hold the line. `contentType=\"audio/x-l16;rate=8000\"` locks L16 8 kHz for both directions — omit it and VoBiz may default to μ-law and mis-decode our PCM, producing the 'tractor/glitch' artifact.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "The 4010 drop — remember this number",
      body: [
        "VoBiz hangup code **4010** means 'End Of XML Instructions' — VoBiz decided the audio bridge went idle and tore the call down. It fires after roughly **2 seconds** of receiving no audio, even with `keepCallAlive=\"true\"`.",
        "That is why silence is dangerous on a VoBiz call: a natural caller pause, a slow first TTS byte, or a gap between sentences can all cross the 2 s line. The whole keepalive machinery in the next chapter exists to make sure a real audio frame always goes out inside that window.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "The VoBiz handler sits between the carrier and the pipeline, fed by the answer webhook. Click to explore neighbours.",
      nodes: [
        { id: "webhook", label: "answer webhook", sublabel: "/webhooks/vobiz/voice", chapterSlug: "webhooks-and-xml", current: false },
        { id: "xml", label: "getVobizAnswerXML", sublabel: "returns <Stream>", chapterSlug: "webhooks-and-xml" },
        { id: "vobiz", label: "handleVobizWebSocket", sublabel: "vobiz.ts — THIS FILE", current: true },
        { id: "ambient", label: "early-ambient", sublabel: "keepalive during setup", chapterSlug: "keepalive-and-audio-continuity" },
        { id: "session", label: "createSession", sublabel: "builds the pipeline", chapterSlug: "session-and-pipeline" },
        { id: "audio", label: "audio.ts", sublabel: "8 kHz decode/encode", chapterSlug: "audio-ts" },
      ],
      edges: [
        { from: "webhook", to: "xml", label: "calls" },
        { from: "xml", to: "vobiz", label: "<Stream> URL opens WS" },
        { from: "vobiz", to: "ambient", label: "start on connect" },
        { from: "vobiz", to: "session", label: "createSession()" },
        { from: "vobiz", to: "audio", label: "onRawPcm8kIn" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "VoBiz sends `audio/x-l16` audio. How does the handler treat the byte order?",
          choices: [
            "It byte-swaps inbound audio to little-endian and outbound to big-endian.",
            "It passes bytes straight through both ways as little-endian — no byte-swap — because the wire is little-endian in practice despite the docs.",
            "It converts everything to μ-law first.",
            "It only swaps outbound audio.",
          ],
          correctIndex: 1,
          explanation:
            "Despite the docs and RFC 2586 calling audio/x-l16 big-endian, VoBiz's wire is little-endian both ways. Inbound media goes straight to the pipeline and pipeline output goes straight into playAudio; byte-swapping causes silence or garble.",
        },
        {
          prompt: "What problem does the `sessionEndedBeforeReady` flag solve?",
          choices: [
            "It prevents the caller from hearing dead air.",
            "It detects the wrong language code.",
            "The caller can hang up while `createSession` is still awaiting; the stop/close handlers can't end a session whose id is still null, so this latch ends it the moment the id is assigned — avoiding a stuck `in_progress` row.",
            "It re-sends the answer XML.",
          ],
          correctIndex: 2,
          explanation:
            "createSession is awaited and slow. If stop/close fire during setup, sessionId is null so endSession is skipped. The latch records that and endSession runs as soon as sessionId exists.",
        },
        {
          prompt: "Why does `getVobizAnswerXML` replace `&` with `&amp;` in the WebSocket URL?",
          choices: [
            "To hide the query parameters from logs.",
            "Because a bare `&` in XML text is a parse error; a multi-param URL would make VoBiz reject the XML with code 8011 'Invalid Answer XML' and drop the call before opening the socket.",
            "Because VoBiz requires all URLs to be uppercase.",
            "To compress the URL.",
          ],
          correctIndex: 1,
          explanation:
            "The URL is XML text content. Multiple query params mean multiple ampersands; unescaped, VoBiz rejects the whole answer XML (HangupCauseCode 8011) and the call drops before the WebSocket connects.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "VoBiz uses a Twilio-like Media-Streams protocol but carries LINEAR16 (L16) PCM at 8 kHz, little-endian in BOTH directions — never byte-swap.",
        "The HTTP answer webhook smuggles call data (`from`, `to`, `callUuid`, `ans`, `corr`) into the WebSocket URL's query string; the handler reads them before the `start` event.",
        "`?ans=` anchors the billing clock and recording timeline to the real answer instant, not the later media-connect moment.",
        "`sessionEndedBeforeReady` latches a hang-up that happens mid-`createSession` so the call record never gets stuck `in_progress`.",
        "Hangup code 4010 ('End Of XML Instructions') fires after ~2 s of silence — the reason every gap must be filled with audio.",
        "The answer XML puts the WS URL as the TEXT of `<Stream>`, locks `contentType=\"audio/x-l16;rate=8000\"`, and XML-escapes `&` to avoid a code-8011 rejection.",
      ],
    },
  ],
};
