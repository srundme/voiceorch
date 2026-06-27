import type { Chapter } from "../types";

export const vobizAndPlivo: Chapter = {
  slug: "vobiz-and-plivo",
  moduleId: "m6",
  number: "6.3",
  title: "VoBiz & Plivo",
  summary:
    "The other two providers, their quirks (byte order, session races), and why audio details matter.",
  estMinutes: 14,
  fileRef: "artifacts/api-server/src/orchestration/telephony/vobiz.ts",
  prerequisites: ["telephony-overview", "twilio-deep-dive"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Now that Twilio is in your bones, the other two providers are easy — they're the same four-beat life cycle with different quirks. **Plivo** is almost a Twilio clone (μ-law, JSON events). **VoBiz** is the interesting one: it sends raw 16-bit PCM, has a habit of dropping calls during slow setup, and is fussy about XML escaping. Every quirk in `vobiz.ts` is a battle-scar from a real production bug.",
        "This chapter is where you learn that **audio details matter**. A single wrong assumption about byte order, or a 2-second pause during call setup, is the difference between a crisp conversation and a dropped call or a 'tractor engine' noise on the line. The comments in this file are a goldmine — they document exactly which mistake caused which symptom.",
      ],
    },
    {
      kind: "concept",
      title: "PCM, byte order, and why VoBiz is different",
      body: [
        "Twilio and Plivo send μ-law (8-bit, compressed). VoBiz sends **LINEAR16 PCM** at 8 kHz — the same raw 16-bit samples from the audio.ts chapter, uncompressed. That means VoBiz audio skips μ-law decoding and goes straight into the pipeline's `onRawPcm8kIn` door.",
        "But there's a catch with 16-bit audio: **byte order** (endianness). A 16-bit sample is two bytes, and you can store the low byte first (**little-endian**) or the high byte first (**big-endian**). Get it wrong and every sample is scrambled into noise. The audio format VoBiz negotiates, `audio/x-l16`, is *nominally* big-endian per the RFC — but VoBiz actually sends and expects **little-endian**. The file leans into this on purpose: it does NOT byte-swap, because swapping produces silence/garble.",
        "There's also a **timing** hazard. VoBiz drops the call if its audio bridge gets no data for ~2 seconds — even during setup. But `createSession` can take longer than that on a cold database connection. So VoBiz needs a clever keepalive trick the other providers don't.",
      ],
    },
    {
      kind: "analogy",
      title: "Endianness is which end of the word you read first",
      body: [
        "Imagine writing the number 'twelve' as two digit-cards: a '1' card and a '2' card. Little-endian hands you the cards least-significant-first ('2' then '1'); big-endian hands them most-significant-first ('1' then '2'). Both encode twelve — but if the reader guesses the wrong order, they read twenty-one.",
        "VoBiz's docs say 'big-endian' but it actually deals little-endian. If we trusted the label and flipped the bytes, every audio sample would come out as nonsense — that's the 'garble' the comment warns about.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/vobiz.ts",
      language: "typescript",
      intro:
        "Sending audio to VoBiz: a `playAudio` event with the PCM payload base64-encoded. The doc comment above it is the whole byte-order lesson in three sentences.",
      code: `function sendAudioToVobiz(pcmChunk: Buffer): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({
    event: "playAudio",
    media: {
      contentType: "audio/x-l16",
      sampleRate: 8000,
      payload: pcmChunk.toString("base64"),
    },
  }));
}`,
      lines: [
        {
          lines: "4",
          label: "event: playAudio",
          explanation:
            "VoBiz's name for 'play this to the caller' — different from Twilio's `media` event but the same idea. Naming differences like this are exactly why each provider needs its own adapter.",
        },
        {
          lines: "6-7",
          label: "contentType + sampleRate",
          explanation:
            "We explicitly declare `audio/x-l16` at 8000 Hz so VoBiz decodes our payload correctly. (As the file comment notes, VoBiz accepts this as little-endian despite x-l16 being nominally big-endian — byte-swapping would cause silence/garble.)",
        },
        {
          lines: "8",
          label: "payload as base64",
          explanation:
            "The raw PCM Buffer, base64-encoded into the JSON message. No μ-law encoding step — VoBiz wants linear PCM, which is why the session runs with `rawPcmOutput: true`.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Don't byte-swap VoBiz audio",
      body: [
        "The single most counter-intuitive line in the file: VoBiz negotiates `audio/x-l16`, which RFC 2586 says is **big-endian**, but VoBiz actually wants **little-endian** — the same order our pipeline already produces. So we send it as-is. Helpfully 'fixing' the byte order to match the spec is what produces the garbled/silent audio the comment warns about.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/vobiz.ts",
      language: "typescript",
      intro:
        "The keepalive trick. While createSession is still booting, VoBiz hears nothing and may hang up. So we stream 20 ms frames of pure silence until the first real audio arrives.",
      code: `const SILENCE_MS      = 20;
const SILENCE_SAMPLES = (8000 * SILENCE_MS) / 1000;           // 160 @ 8 kHz
const silenceFrame    = Buffer.alloc(SILENCE_SAMPLES * 2, 0);  // 16-bit LE PCM
let silenceTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
  if (ws.readyState === ws.OPEN) sendAudioToVobiz(silenceFrame);
}, SILENCE_MS);
const stopSilence = (): void => {
  if (silenceTimer) { clearInterval(silenceTimer); silenceTimer = null; }
};`,
      lines: [
        {
          lines: "1-2",
          label: "frame math",
          explanation:
            "At 8 kHz, 20 ms of audio is 160 samples. This is the standard telephony frame size — small enough to feel real-time, big enough to be efficient.",
        },
        {
          lines: "3",
          label: "Buffer.alloc(…, 0) — silence",
          explanation:
            "`Buffer.alloc` zeroes the memory, and a 16-bit sample of 0 is silence. `* 2` because each sample is 2 bytes. This is one frame of digital quiet, ready to send on repeat.",
        },
        {
          lines: "4-6",
          label: "the keepalive timer",
          explanation:
            "Every 20 ms, push a silence frame so VoBiz's bridge keeps hearing data and won't drop the call during slow setup. This is the trick Twilio and Plivo don't need — VoBiz is uniquely impatient.",
        },
        {
          lines: "7-9",
          label: "stopSilence()",
          explanation:
            "The instant real audio is ready, we call this to clear the timer. The session wiring calls `stopSilence()` the moment `onAudioOut` first fires — silence yields immediately to the real greeting.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/vobiz.ts",
      language: "typescript",
      intro:
        "The session-race fix. A flag, declared up top, that remembers if VoBiz hung up *before* createSession finished — because at that moment we had no session id to end.",
      code: `// True when VoBiz sent "stop" or closed the socket while createSession was still
// awaiting.  In that case sessionId was null at the time, so endSession was
// skipped.  We detect this and call endSession immediately once sessionId is set.
let sessionEndedBeforeReady = false;
// …
stopSilence();                // safety-net: session ready with no audio yet
sessionId = sid;
if (sessionEndedBeforeReady) {
  logger.warn({ sessionId, agentId }, "Vobiz session ended before setup completed — ending immediately");
  await endSession(sessionId);
} else {
  logger.info({ sessionId, agentId, fromNumber, toNumber, streamId }, "Vobiz session started");
}`,
      lines: [
        {
          lines: "1-4",
          label: "the race, explained",
          explanation:
            "`createSession` is `await`ed — it takes time. If VoBiz sends `stop` or the socket closes during that wait, the normal cleanup runs while `sessionId` is still `null`, so `endSession` gets skipped and the call record is stuck 'in_progress' forever.",
        },
        {
          lines: "7",
          label: "sessionId = sid",
          explanation:
            "The first moment we actually have a session id. Everything before this line ran without one — which is the whole reason the flag exists.",
        },
        {
          lines: "8-11",
          label: "drain the deferred end",
          explanation:
            "If the flag was set while we were awaiting, we end the session right now — finalizing the record instead of leaking it. This is a classic async race: an event fired before the thing it needed to act on existed.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "Async setup is a race waiting to happen",
      body: [
        "Any time you `await` something slow while events can still arrive, ask: 'what if an event fires *during* the await?' VoBiz's `sessionEndedBeforeReady` flag is the answer here — webcall has the same pattern with `endedBeforeReady`. Whenever a socket can close mid-setup, you need a way to remember it and act once setup completes.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/vobiz.ts",
      language: "typescript",
      intro:
        "Incoming VoBiz audio. Because it's already PCM, it skips μ-law and pours straight into the PCM door — note onRawPcm8kIn, not onAudioIn.",
      code: `case "media": {
  if (!sessionId || !msg.media?.payload) break;
  if (msg.media.track && msg.media.track !== "inbound") break;
  const session = getSession(sessionId);
  if (!session) break;
  const pcm8k = Buffer.from(msg.media.payload, "base64");
  session.pipeline.onRawPcm8kIn(pcm8k);
  break;
}`,
      lines: [
        {
          lines: "2-3",
          label: "guards (same shape as Twilio)",
          explanation:
            "Bail if there's no session or payload yet, and ignore any non-`inbound` track. Identical defensive logic to Twilio — the four-beat pattern carries over.",
        },
        {
          lines: "6-7",
          label: "onRawPcm8kIn — the PCM door",
          explanation:
            "Here's the key difference from Twilio: VoBiz audio is already 16-bit PCM, so we base64-decode it and feed `onRawPcm8kIn` directly. No `decodeMulaw` call — the byte order we discussed flows straight through unchanged.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/vobiz.ts",
      language: "typescript",
      intro:
        "The XML answer that opens VoBiz's stream — and a tiny string-replace that prevents a whole class of dropped calls.",
      code: `const wsUrl = \`\${wsBaseUrl}/api/ws/vobiz/\${agentId}\${qs}\`;
// …
const wsUrlXml = wsUrl.replace(/&/g, "&amp;");
// …
return \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=8000">\${wsUrlXml}</Stream>
</Response>\`;`,
      lines: [
        {
          lines: "3",
          label: "escape & → &amp;",
          explanation:
            "When the URL has multiple query params it contains bare `&` characters, which are illegal inside XML text. If you don't escape them, VoBiz rejects the whole document with HangupCauseCode 8011 'Invalid Answer XML' and drops the call before the socket even opens. One `.replace` saves the call.",
        },
        {
          lines: "7",
          label: "contentType locks the format",
          explanation:
            "`audio/x-l16;rate=8000` explicitly negotiates LINEAR16 8 kHz for both directions. Without it, VoBiz may default to μ-law and mis-decode our PCM playAudio — producing the infamous 'tractor/glitch' artifact on the caller's side.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/plivo.ts",
      language: "typescript",
      intro:
        "Plivo's one structural twist: it can send audio as raw binary frames OR as JSON events. The handler branches on that first, before anything else.",
      code: `ws.on("message", async (raw: Buffer | string) => {
  // Plivo can send binary audio directly or JSON events
  if (Buffer.isBuffer(raw)) {
    if (!sessionId) return;
    const session = getSession(sessionId);
    if (session) session.pipeline.onAudioIn(raw);
    return;
  }
  // …
});`,
      lines: [
        {
          lines: "3",
          label: "Buffer.isBuffer(raw)",
          explanation:
            "If the frame is binary, it's raw μ-law audio — handle it and return early. JSON events fall through to a `switch` below (start/media/stop), just like Twilio.",
        },
        {
          lines: "6",
          label: "onAudioIn — the μ-law door",
          explanation:
            "Plivo is a μ-law provider like Twilio, so binary audio goes straight to `onAudioIn` (which decodes μ-law). The difference from Twilio is purely *transport* (binary frames vs base64-in-JSON), not format.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Same engine, three personalities",
      body: [
        "Plivo = Twilio with binary frames (μ-law, `onAudioIn`). VoBiz = PCM, `onRawPcm8kIn`, plus a silence keepalive, a session-race guard, and strict XML escaping. The pipeline never changes — only the wrapping paper does. That's the adapter pattern paying rent.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro: "VoBiz and Plivo feed the same pipeline through different doors. Click a box to jump to its chapter.",
      nodes: [
        { id: "vobiz-net", label: "VoBiz", sublabel: "PCM, x-l16" },
        { id: "plivo-net", label: "Plivo", sublabel: "μ-law, binary/JSON" },
        { id: "vobiz", label: "vobiz.ts", sublabel: "THIS FILE", current: true },
        { id: "plivo", label: "plivo.ts", sublabel: "THIS FILE", current: true },
        { id: "pcmdoor", label: "onRawPcm8kIn()", sublabel: "PCM door", chapterSlug: "session-and-pipeline" },
        { id: "mulawdoor", label: "onAudioIn → decodeMulaw()", sublabel: "μ-law door", chapterSlug: "audio-ts" },
        { id: "overview", label: "telephony overview", sublabel: "the shared contract", chapterSlug: "telephony-overview" },
      ],
      edges: [
        { from: "vobiz-net", to: "vobiz", label: "playAudio / media events" },
        { from: "plivo-net", to: "plivo", label: "binary + JSON" },
        { from: "vobiz", to: "pcmdoor", label: "16-bit PCM (LE)" },
        { from: "plivo", to: "mulawdoor", label: "μ-law bytes" },
        { from: "vobiz", to: "overview", label: "createSession" },
        { from: "plivo", to: "overview", label: "createSession" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "VoBiz negotiates `audio/x-l16`, which the RFC calls big-endian. What does vobiz.ts actually do with byte order?",
          choices: [
            "Byte-swaps every sample to big-endian to follow the spec.",
            "Sends little-endian as-is — VoBiz actually wants LE, and swapping causes silence/garble.",
            "Converts the audio to μ-law first.",
            "Lets VoBiz pick the order automatically.",
          ],
          correctIndex: 1,
          explanation:
            "Despite the x-l16 label, VoBiz deals in little-endian — the same order the pipeline produces. The file deliberately does NOT swap; swapping would garble or silence the audio.",
        },
        {
          prompt: "Why does VoBiz need a silence-frame keepalive timer during setup?",
          choices: [
            "To warm up the speakers.",
            "VoBiz drops the call if its bridge gets no audio for ~2s, and createSession can take longer on a cold DB connection.",
            "To measure network latency.",
            "Because PCM requires constant data by spec.",
          ],
          correctIndex: 1,
          explanation:
            "VoBiz hangs up after ~2s of no data even with keepCallAlive. Streaming 20 ms silence frames keeps the bridge alive until the first real pipeline audio arrives.",
        },
        {
          prompt: "What does the `sessionEndedBeforeReady` flag protect against?",
          choices: [
            "Audio arriving in the wrong byte order.",
            "VoBiz hanging up while createSession is still awaiting, when sessionId is null and endSession would be skipped.",
            "Two calls using the same agent.",
            "Invalid XML in the answer document.",
          ],
          correctIndex: 1,
          explanation:
            "It's an async race: if the socket closes during the `await createSession`, there's no session id to end. The flag remembers this and ends the session the instant the id becomes available, so the record isn't stuck in_progress.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Plivo is μ-law like Twilio (uses `onAudioIn`) but can send audio as binary frames or JSON events.",
        "VoBiz sends 16-bit LINEAR16 PCM (uses `onRawPcm8kIn`) — no μ-law decode step.",
        "Endianness gotcha: x-l16 is nominally big-endian but VoBiz wants little-endian; don't byte-swap.",
        "VoBiz needs a 20 ms silence keepalive during setup or it drops the call after ~2s of no data.",
        "Async race: `sessionEndedBeforeReady` ends a session that closed during the `await createSession`.",
        "XML escaping (`&` → `&amp;`) and an explicit contentType prevent dropped calls and garbled 'tractor' audio.",
      ],
    },
  ],
};
