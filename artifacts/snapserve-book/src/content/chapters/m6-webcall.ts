import type { Chapter } from "../types";

export const webcall: Chapter = {
  slug: "webcall",
  moduleId: "m6",
  number: "6.4",
  title: "Web Calls: Testing in the Browser",
  summary:
    "The thin WebSocket transport that runs the exact same pipeline from a browser mic — no phone needed.",
  estMinutes: 16,
  fileRef: "artifacts/api-server/src/orchestration/telephony/webcall.ts",
  prerequisites: ["telephony-overview", "twilio-deep-dive"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "How do you test a voice agent without dialing a real phone number and paying per minute? You talk to it **from your browser**. The dashboard's 'Live Test' button opens your microphone, streams audio to the server over a WebSocket, and plays the AI's reply through your speakers — a full conversation, no phone network involved.",
        "`webcall.ts` is the server side of that. And it teaches the single most important design lesson in the whole telephony module: **do not re-implement the pipeline**. An earlier 'Webcall 1.0' tried to, and drifted out of parity — bugs fixed for phone calls didn't reach web calls, and vice versa. The rewrite (2.0) is a deliberately *thin* transport over the exact same `createSession` and pipeline the phone providers use. Every fix to the shared core lands here for free.",
      ],
    },
    {
      kind: "concept",
      title: "A browser is just another transport",
      body: [
        "From the pipeline's point of view, the browser is the same as Twilio: audio frames come in, audio frames go out. The differences are all at the edges. The browser sends **16 kHz PCM** (its mic's native rate) as raw binary WebSocket frames, while telephony is 8 kHz. So before feeding the pipeline, webcall **downsamples** 16 kHz → 8 kHz.",
        "Output is raw PCM too (`rawPcmOutput: true`), sent as binary frames the browser queues and plays. Control messages — 'ready', 'call_end', 'clear', live transcript lines — travel as JSON text frames on the same socket. So the wire has two kinds of frames: **binary = audio**, **text = control**.",
        "There's one more browser superpower: the browser already runs **acoustic echo cancellation (AEC)** and noise suppression in WebRTC before sending audio. That replaces the fragile echo detection 1.0 needed — and it's why webcall tells the pipeline to skip its own server-side noise gate.",
      ],
    },
    {
      kind: "analogy",
      title: "The same kitchen, a different delivery window",
      body: [
        "Picture a restaurant kitchen (the pipeline) that cooks identically for everyone. Phone calls are the drive-through; web calls are the walk-up window. The food, the chefs, the recipes — all identical. Only the little window where orders come in and plates go out changes shape.",
        "Webcall 1.0 was the mistake of building a *second kitchen* for walk-ups. It slowly served different food. Webcall 2.0 tore that down and just added a window to the one good kitchen.",
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "The whole design philosophy, in one comment",
      body: [
        "The file's header says it best: 'do NOT reimplement the orchestration pipeline. This is a thin transport adapter over the SAME createSession / OrchestrationPipeline used by telephony.' Barge-in, endpointing safety-nets, recording, sentence flush — all live in the shared core, 'so this transport inherits every fix for free and can never drift out of parity with the phone path.'",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/webcall.ts",
      language: "typescript",
      intro:
        "Three tiny helpers define the wire. sendJson packages control messages as text; sendAudio sends raw binary; requestEnd cleanly tears the call down (and handles the setup race).",
      code: `function sendJson(obj: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

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
}`,
      lines: [
        {
          lines: "1-3",
          label: "sendJson — text frames",
          explanation:
            "Control messages (ready, clear, transcript, call_end) go out as JSON strings. `ws.send` of a string produces a text frame the browser reads as a control message, not audio.",
        },
        {
          lines: "5-7",
          label: "sendAudio — binary frames",
          explanation:
            "Reply audio goes out as the raw Buffer — `ws.send(buffer)` produces a binary frame. The browser queues these and plays them. This is the function injected as `onAudioOut`.",
        },
        {
          lines: "9-17",
          label: "requestEnd — idempotent teardown",
          explanation:
            "The `ending` guard means calling this twice (client says 'end' AND the socket closes) is harmless. If the session exists, end it; if it doesn't yet, set `endedBeforeReady` so setup ends it the moment it finishes — the same async-race pattern as VoBiz.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/webcall.ts",
      language: "typescript",
      intro:
        "The message handler. The key decision on every frame: is this binary (audio) or text (control)? The `isBinary` flag is the only reliable way to tell.",
      code: `ws.on("message", (raw: Buffer, isBinary: boolean) => {
  if (isBinary) {
    if (!sessionId) return; // dropped until session ready — acceptable
    const session = getSession(sessionId);
    if (!session) return;
    const pcm16k = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBufferLike);
    if (pcm16k.length < 2) return;
    session.pipeline.onRawPcm8kIn(downsample16to8(pcm16k), false);
    return;
  }
  // Text = control message.
  let msg: { type?: string };
  try { msg = JSON.parse(raw.toString()) as { type?: string }; } catch { return; }
  if (msg.type === "end") {
    logger.info({ sessionId, agentId }, "Webcall client requested end");
    requestEnd();
  }
});`,
      lines: [
        {
          lines: "2",
          label: "isBinary is the discriminator",
          explanation:
            "The `ws` library hands you both audio and text as a Buffer, so `Buffer.isBuffer(raw)` is true either way — useless for telling them apart. `isBinary` is the only reliable signal: true = audio, false = control text.",
        },
        {
          lines: "3-4",
          label: "drop audio until ready",
          explanation:
            "Audio frames that arrive before the session exists are simply dropped — acceptable, since it's just the first few milliseconds. Same defensive guard as every provider.",
        },
        {
          lines: "6-7",
          label: "normalize and sanity-check",
          explanation:
            "Coerce to a Buffer and skip frames under 2 bytes (less than one 16-bit sample — junk). Small guards like this keep a malformed frame from poisoning the pipeline.",
        },
        {
          lines: "8",
          label: "downsample16to8(...), false",
          explanation:
            "The two browser-specific touches in one line: `downsample16to8` converts the mic's 16 kHz down to the pipeline's 8 kHz (the resampler from the audio.ts chapter), and the `false` tells `onRawPcm8kIn` to skip server-side noise cancellation — the browser already did it.",
        },
        {
          lines: "12-17",
          label: "text → control",
          explanation:
            "Non-binary frames are parsed as JSON control messages. The only one the client sends is `{ type: 'end' }` (the user hung up), which triggers `requestEnd`. Malformed JSON is swallowed, never fatal.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Why pass noiseCancel = false",
      body: [
        "The browser's WebRTC already applied echo cancellation and noise suppression before sending. The server-side gate's threshold is calibrated for **telephony**, not clean mic audio — running it on top zeroes out quiet-but-valid speech, causing the 'only loud speech works' bug. So webcall explicitly passes `false`. Same door (`onRawPcm8kIn`) as VoBiz, opposite noise setting.",
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "Listeners are attached BEFORE the await",
      body: [
        "The socket can close, error, or send 'end' while `createSession` is still awaiting a slow provider setup. If listeners were attached *after* the await, those events would be lost. So webcall registers `message`/`close`/`error` first; if one fires before the session id exists, `endedBeforeReady` remembers it and setup ends the session immediately. Listeners-first is the rule for any async transport.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/webcall.ts",
      language: "typescript",
      intro:
        "Finally, booting the shared session — the same createSession the phone providers call, with browser-shaped callbacks and the rawPcmOutput flag flipped on.",
      code: `const { sessionId: sid } = await createSession({
  agentId,
  telephonyProvider: "webcall",
  toNumber: \`webcall-agent-\${agentId}\`,
  fromNumber: \`webcall-user-\${userId}\`,
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
sendJson({ type: "ready" });`,
      lines: [
        {
          lines: "4-5",
          label: "synthetic phone numbers",
          explanation:
            "There's no real phone number, so webcall invents stable identifiers like `webcall-user-<id>`. session.ts maps these to a `webcall:user_<id>` key so caller memory is still captured per logged-in user — a web call you've had before is remembered.",
        },
        {
          lines: "6",
          label: "rawPcmOutput: true",
          explanation:
            "Flip the engine's output encoding to raw 16-bit PCM instead of μ-law — exactly what `sendAudio` forwards to the browser. One boolean reroutes the entire output format.",
        },
        {
          lines: "7-10",
          label: "browser-shaped callbacks",
          explanation:
            "`onAudioOut` is `sendAudio` (binary). `onCallEnd` tells the browser to drain and tear down. `onBargeIn` sends `{ type: 'clear' }` so the browser flushes its playback queue when you interrupt. `onTranscript` — used only here — streams live transcript lines so the UI can render the conversation.",
        },
        {
          lines: "12-17",
          label: "the race check, then ready",
          explanation:
            "Capture the id, then check `endedBeforeReady`: if the socket already closed during setup, end now and return. Otherwise send `{ type: 'ready' }` to tell the browser the greeting is incoming. This is the same race guard as VoBiz, in webcall clothing.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "why",
      title: "Why caller memory still works for web calls",
      body: [
        "It would be easy to skip memory for 'just a test'. But because webcall is authenticated (the index.ts upgrade verifies the user owns the agent), it can key memory on the real user id. So a returning tester is greeted like a returning caller — and you're testing the *real* memory path, not a stub.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro: "Webcall is the browser's window into the shared pipeline. Click a box to jump to its chapter.",
      nodes: [
        { id: "browser", label: "Browser mic + speakers", sublabel: "16 kHz PCM, WebRTC AEC" },
        { id: "upgrade", label: "WS upgrade (auth'd)", sublabel: "verifies JWT + ownership", chapterSlug: "telephony-overview" },
        { id: "webcall", label: "handleWebcallWebSocket()", sublabel: "webcall.ts — THIS FILE", current: true },
        { id: "downsample", label: "downsample16to8()", sublabel: "audio.ts resampler", chapterSlug: "audio-ts" },
        { id: "pcmdoor", label: "onRawPcm8kIn(…, false)", sublabel: "PCM door, no gate", chapterSlug: "session-and-pipeline" },
        { id: "session", label: "createSession()", sublabel: "rawPcmOutput: true", chapterSlug: "session-and-pipeline" },
      ],
      edges: [
        { from: "browser", to: "upgrade", label: "WebSocket + ?token=" },
        { from: "upgrade", to: "webcall", label: "verified user id" },
        { from: "browser", to: "webcall", label: "binary 16 kHz PCM" },
        { from: "webcall", to: "downsample", label: "16 kHz → 8 kHz" },
        { from: "downsample", to: "pcmdoor", label: "8 kHz PCM" },
        { from: "webcall", to: "session", label: "createSession + callbacks" },
        { from: "session", to: "webcall", label: "onAudioOut → binary frame" },
        { from: "webcall", to: "browser", label: "PCM audio + JSON control" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "On the webcall socket, how does the handler tell audio frames from control messages?",
          choices: [
            "By checking Buffer.isBuffer(raw).",
            "By the `isBinary` flag — binary is audio, text is a JSON control message.",
            "By the frame size.",
            "Audio and control use separate sockets.",
          ],
          correctIndex: 1,
          explanation:
            "The `ws` library delivers both as Buffers, so `Buffer.isBuffer` is true for both. `isBinary` is the only reliable discriminator: true = audio, false = control text.",
        },
        {
          prompt: "Why does webcall pass `false` for noise cancellation into onRawPcm8kIn?",
          choices: [
            "To save CPU.",
            "The browser's WebRTC already did echo/noise suppression; the server gate is tuned for telephony and would zero out quiet-but-valid speech.",
            "Because PCM can't be noise-cancelled.",
            "To make the audio louder.",
          ],
          correctIndex: 1,
          explanation:
            "Double-gating clean mic audio with a telephony-tuned threshold causes the 'only loud speech works' bug. The browser already cleaned the audio, so the server skips its gate.",
        },
        {
          prompt: "What is the core design lesson of Webcall 2.0?",
          choices: [
            "Browsers are too slow for real-time audio.",
            "Be a thin transport over the shared pipeline — never re-implement orchestration, so every fix is inherited and parity never drifts.",
            "Always convert audio to μ-law.",
            "Web calls should skip caller memory.",
          ],
          correctIndex: 1,
          explanation:
            "Webcall 1.0 re-implemented the pipeline and drifted out of parity. 2.0 is a thin adapter over the same createSession/pipeline, so phone and web share every fix.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Webcall is a thin transport over the same createSession/pipeline as telephony — it never re-implements orchestration.",
        "Wire format: binary frames = audio, text frames = JSON control (ready, clear, transcript, call_end).",
        "Browser mic is 16 kHz PCM, so webcall `downsample16to8`s before the PCM door (`onRawPcm8kIn`).",
        "It passes `noiseCancel = false` because the browser's WebRTC already did echo/noise suppression.",
        "`rawPcmOutput: true` makes the engine emit raw PCM the browser plays directly — no μ-law.",
        "Listeners are attached before the `await`, and `endedBeforeReady` handles a socket that closes mid-setup.",
      ],
    },
  ],
};
