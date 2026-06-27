import type { Chapter } from "../types";

export const twilioDeepDive: Chapter = {
  slug: "twilio-deep-dive",
  moduleId: "m6",
  number: "7.2",
  title: "Twilio, Frame by Frame",
  summary:
    "Reading the Twilio media-stream protocol and wiring it into the shared pipeline.",
  estMinutes: 16,
  fileRef: "artifacts/api-server/src/orchestration/telephony/twilio.ts",
  prerequisites: ["telephony-overview", "audio-ts"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Twilio is the world's most popular phone API, and it's the cleanest example of the adapter pattern in SnapServe. `twilio.ts` is small — about 150 lines — yet it handles a real phone call end to end. If you read one telephony file closely, make it this one.",
        "Twilio's feature is called **Media Streams**: instead of recording a call and POSTing you a file afterward, it opens a WebSocket and streams the live audio as tiny base64 chunks while the call is happening. Our handler reads those chunks, feeds them to the pipeline, and streams the AI's reply back down the same socket. Let's read it frame by frame.",
      ],
    },
    {
      kind: "concept",
      title: "The Media Streams handshake",
      body: [
        "Before any audio flows, there's a handshake. When someone dials a Twilio number, Twilio first makes an ordinary HTTP POST to our voice webhook. We reply with a snippet of **TwiML** — Twilio's little XML dialect — that says, in effect, 'open a media stream to this WebSocket URL.'",
        "Twilio then opens the WebSocket and starts sending JSON messages. There are five message types, but only four matter to us: `connected` (socket is up), `start` (here's who's calling), `media` (a chunk of audio), and `stop` (call ended). Every message is JSON; the audio inside a `media` message is **base64-encoded μ-law**.",
        "So the file is really just a `switch` over those message types, plus a function to send audio back. That's the whole protocol.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/twilio.ts",
      language: "typescript",
      intro:
        "First, the TypeScript shape of an incoming Twilio message. Writing the wire format as an interface means the compiler catches typos like `event.medai` for us.",
      code: `interface TwilioEvent {
  event: "connected" | "start" | "media" | "stop" | "mark";
  streamSid?: string;
  start?: {
    callSid: string;
    streamSid: string;
    accountSid: string;
    customParameters?: Record<string, string>;
  };
  media?: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string; // base64 mulaw
  };
}`,
      lines: [
        {
          lines: "2",
          label: "the event discriminator",
          explanation:
            "Every Twilio message has an `event` field naming its type. This union of five string literals is what the `switch` later branches on — a classic **discriminated union**.",
        },
        {
          lines: "3",
          label: "streamSid",
          explanation:
            "Twilio's id for this particular media stream. We must echo it back on every audio message we send, so Twilio knows which call the audio belongs to. Optional here (`?`) because it only appears on some message types.",
        },
        {
          lines: "4-9",
          label: "the start payload",
          explanation:
            "Only present on the `start` event. `callSid` identifies the call; `customParameters` is a bag of key/value pairs we asked Twilio to pass through (we use it to recover the To/From numbers).",
        },
        {
          lines: "10-15",
          label: "the media payload",
          explanation:
            "`track` says inbound (caller) or outbound; `payload` is the actual audio — base64-encoded μ-law, as the inline comment notes. This is the byte stream the whole pipeline runs on.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/twilio.ts",
      language: "typescript",
      intro:
        "Every WebSocket message lands here. Step one is always: try to parse JSON, bail silently on garbage, then branch on the event type.",
      code: `ws.on("message", async (raw: Buffer | string) => {
  let event: TwilioEvent;
  try {
    event = JSON.parse(raw.toString()) as TwilioEvent;
  } catch {
    return;
  }

  switch (event.event) {
    case "connected":
      logger.info({ agentId }, "Twilio WS connected");
      break;`,
      lines: [
        {
          lines: "1",
          label: "the message listener",
          explanation:
            "`ws.on('message', …)` fires for every frame Twilio sends — dozens per second once audio is flowing. `raw` arrives as a Buffer or string; `raw.toString()` normalizes it to text for JSON parsing.",
        },
        {
          lines: "3-6",
          label: "parse defensively",
          explanation:
            "If a frame isn't valid JSON, the `catch` just `return`s — drop it and wait for the next one. Never let one malformed frame crash a live call. This pattern repeats in every provider file.",
        },
        {
          lines: "9-12",
          label: "branch on event.event",
          explanation:
            "The `switch` is the whole protocol. `connected` is just a heartbeat we log and move past — no session yet, because we don't know who's calling until `start`.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/twilio.ts",
      language: "typescript",
      intro:
        "The start event is where a call becomes a session. We pull the call's identity out of the message and hand it to the shared createSession — wiring Twilio-specific output functions into the generic callbacks.",
      code: `case "start": {
  streamSid = event.start?.streamSid ?? event.streamSid ?? null;
  callSid = event.start?.callSid ?? null;
  const params = event.start?.customParameters ?? {};
  const toNumber = params["To"] ?? "+10000000000";
  const fromNumber = params["From"] ?? "+10000000001";

  try {
    const { sessionId: sid } = await createSession({
      agentId,
      telephonyProvider: "twilio",
      toNumber,
      fromNumber,
      externalCallId: callSid ?? undefined,
      campaignLeadId,
      onAudioOut: sendAudioToTwilio,
      onCallEnd: () => ws.close(),
      onBargeIn: () => {
        if (streamSid && ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ event: "clear", streamSid }));
        }
      },
    });
    sessionId = sid;`,
      lines: [
        {
          lines: "2-3",
          label: "capture the ids",
          explanation:
            "Save `streamSid` and `callSid` into the closure's outer variables so later messages (and the audio-sender) can use them. The `??` chain falls back gracefully if Twilio nests the id differently.",
        },
        {
          lines: "4-6",
          label: "recover the phone numbers",
          explanation:
            "Twilio doesn't put To/From in the start event directly — we passed them as `customParameters` in the TwiML. The `?? '+1000…'` fallbacks are placeholder numbers so the call still works if a param is missing.",
        },
        {
          lines: "9-14",
          label: "createSession — the handoff",
          explanation:
            "This single call boots the entire engine: STT, LLM, TTS, endpointing. We tag `telephonyProvider: 'twilio'` and pass the identity we just gathered.",
        },
        {
          lines: "15",
          label: "onAudioOut: sendAudioToTwilio",
          explanation:
            "Here's the dependency injection in action — we hand the pipeline our Twilio-specific sender (next code block). When TTS produces audio, the pipeline calls this and Twilio receives properly-packaged JSON.",
        },
        {
          lines: "17-21",
          label: "onBargeIn → the clear event",
          explanation:
            "When the caller interrupts, the pipeline calls this. We send Twilio `{ event: 'clear', streamSid }`, which tells it to instantly drop any audio it has buffered but not yet played — so the AI shuts up the moment the human starts talking.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Only inbound audio is real caller audio",
      body: [
        "Twilio can stream both the inbound track (the caller) and the outbound track (what Twilio is playing). If you fed both to the pipeline you'd hear the AI transcribing **itself**. The media handler guards with `event.media.track === 'inbound'` — process the caller, ignore the echo.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/twilio.ts",
      language: "typescript",
      intro:
        "Once the session exists, media events pour in. Each one is decoded from base64 and pushed into the pipeline's μ-law door. The stop event tears the call down.",
      code: `case "media": {
  if (!sessionId || !event.media) break;
  const session = getSession(sessionId);
  if (!session) break;

  if (event.media.track === "inbound") {
    const chunk = Buffer.from(event.media.payload, "base64");
    session.pipeline.onAudioIn(chunk);
  }
  break;
}

case "stop":
  logger.info({ sessionId }, "Twilio stream stopped");
  if (sessionId) await endSession(sessionId);
  break;`,
      lines: [
        {
          lines: "2-4",
          label: "guard before touching the pipeline",
          explanation:
            "If the session isn't ready yet (a media frame can arrive a hair before `start` finishes), `break`. `getSession` looks up the live session by id; if it's gone, bail. Defensive guards keep a fast stream from crashing on edge timing.",
        },
        {
          lines: "6-8",
          label: "base64 → Buffer → onAudioIn",
          explanation:
            "The heart of the inbound path. `Buffer.from(payload, 'base64')` turns the text back into raw μ-law bytes, and `onAudioIn` feeds them to the pipeline (which decodes μ-law and runs VAD). Three lines connect Twilio to the entire AI engine.",
        },
        {
          lines: "14-17",
          label: "stop → endSession",
          explanation:
            "When Twilio says the call ended, we call `endSession`, which finalizes the recording, runs disposition, and bills the call. The `if (sessionId)` guard avoids ending a session that never started.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/twilio.ts",
      language: "typescript",
      intro:
        "The outbound direction — the function we injected as onAudioOut. It's the mirror image of the inbound media handler.",
      code: `function sendAudioToTwilio(audio: Buffer): void {
  if (!streamSid || ws.readyState !== ws.OPEN) return;
  const payload = audio.toString("base64");
  ws.send(JSON.stringify({
    event: "media",
    streamSid,
    media: { payload },
  }));
}`,
      lines: [
        {
          lines: "2",
          label: "two guards before sending",
          explanation:
            "No `streamSid` means we don't yet know which stream to target; a non-OPEN socket means the call is gone. Either way, drop the audio silently rather than throw.",
        },
        {
          lines: "3",
          label: "Buffer → base64",
          explanation:
            "Twilio wants audio as base64 text inside JSON, so we encode the reply Buffer. (The pipeline already μ-law-encoded it, since Twilio is a μ-law provider.)",
        },
        {
          lines: "4-8",
          label: "wrap and send",
          explanation:
            "Package it as a `media` event with the `streamSid` echoed back, and `ws.send`. This is the exact inverse of the inbound handler — same protocol, opposite direction.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/telephony/twilio.ts",
      language: "typescript",
      intro:
        "Finally, the TwiML that started it all — the XML we return to Twilio's HTTP webhook to open the media stream in the first place.",
      code: `export function getTwilioVoiceTwiML(wsBaseUrl: string, agentId: number, campaignLeadId?: number): string {
  const qs = campaignLeadId ? \`?campaignLeadId=\${campaignLeadId}\` : "";
  return \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="\${wsBaseUrl}/api/ws/twilio/\${agentId}\${qs}">
      <Parameter name="agentId" value="\${agentId}"/>
    </Stream>
  </Connect>
</Response>\`;
}`,
      lines: [
        {
          lines: "3-4",
          label: "<Connect><Stream>",
          explanation:
            "This TwiML verb tells Twilio: don't play a message, **connect** the call to a bidirectional media stream at this WebSocket URL. That URL is exactly what the index.ts router matches on.",
        },
        {
          lines: "5",
          label: "the WS URL carries the agentId",
          explanation:
            "`/api/ws/twilio/${agentId}` — the provider name and agent id are baked into the path. This closes the loop: the URL here is what the upgrade switch in the overview chapter parses.",
        },
        {
          lines: "6",
          label: "<Parameter>",
          explanation:
            "Custom parameters ride along into the `start` event's `customParameters`. That's how the To/From numbers reach the handler when Twilio doesn't expose them directly.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "The mental model: two mirrored handlers",
      body: [
        "Inbound: `media` event → base64-decode → `onAudioIn`. Outbound: `onAudioOut` → base64-encode → `media` event. Everything else (start/stop/clear) is bookkeeping around that loop. Hold those two mirror images in your head and `twilio.ts` is trivial.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro: "Where twilio.ts sits in a live call. Click a box to jump to its chapter.",
      nodes: [
        { id: "twilio-net", label: "Twilio", sublabel: "phone network" },
        { id: "twiml", label: "getTwilioVoiceTwiML()", sublabel: "twilio.ts — THIS FILE", current: true },
        { id: "handler", label: "handleTwilioWebSocket()", sublabel: "twilio.ts — THIS FILE", current: true },
        { id: "session", label: "createSession()", sublabel: "the shared contract", chapterSlug: "session-and-pipeline" },
        { id: "audio", label: "onAudioIn → decodeMulaw()", sublabel: "audio.ts codec", chapterSlug: "audio-ts" },
        { id: "overview", label: "WS upgrade switch", sublabel: "routes by provider", chapterSlug: "telephony-overview" },
      ],
      edges: [
        { from: "twilio-net", to: "twiml", label: "HTTP voice webhook" },
        { from: "twiml", to: "twilio-net", label: "<Connect><Stream> XML" },
        { from: "twilio-net", to: "overview", label: "opens WebSocket" },
        { from: "overview", to: "handler", label: "routes ws" },
        { from: "handler", to: "session", label: "start → createSession" },
        { from: "handler", to: "audio", label: "media → onAudioIn" },
        { from: "session", to: "handler", label: "onAudioOut → media event" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Inside a Twilio `media` event, what format is the audio in `payload`?",
          choices: [
            "Raw 16-bit PCM.",
            "Base64-encoded μ-law.",
            "An MP3 file.",
            "Plain text transcript.",
          ],
          correctIndex: 1,
          explanation:
            "Twilio streams base64-encoded μ-law. The handler does `Buffer.from(payload, 'base64')` to get raw μ-law bytes, then `onAudioIn` decodes the μ-law.",
        },
        {
          prompt: "Why does the media handler check `event.media.track === 'inbound'`?",
          choices: [
            "To skip every other frame for performance.",
            "To process only the caller's audio and ignore the outbound track, avoiding the AI transcribing itself.",
            "Because inbound frames are smaller.",
            "It's required by the WebSocket spec.",
          ],
          correctIndex: 1,
          explanation:
            "Twilio can stream both tracks. Only `inbound` is the caller; feeding the outbound track back in would make the AI hear its own voice.",
        },
        {
          prompt: "How does the AI's reply audio get back to the caller?",
          choices: [
            "The pipeline calls onAudioOut → sendAudioToTwilio, which base64-encodes it into a `media` event sent over the same socket.",
            "It's saved to a file and Twilio fetches it.",
            "Through a separate HTTP POST per chunk.",
            "Twilio polls the database for new audio.",
          ],
          correctIndex: 0,
          explanation:
            "We injected `sendAudioToTwilio` as the `onAudioOut` callback. It base64-encodes the reply and sends it as a `media` event echoing the `streamSid` — the mirror image of the inbound path.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Twilio Media Streams sends live audio over a WebSocket as base64 μ-law inside JSON messages.",
        "The handler is a `switch` over four events: connected, start, media, stop — plus a sender function.",
        "`start` recovers the call identity and calls `createSession`, injecting Twilio-specific output callbacks.",
        "Inbound: media → base64-decode → `onAudioIn`; outbound: `onAudioOut` → base64-encode → media. Two mirrored handlers.",
        "Only the `inbound` track is processed; barge-in sends `{ event: 'clear' }` to flush Twilio's playback buffer.",
        "`getTwilioVoiceTwiML` returns the `<Connect><Stream>` XML that opens the socket and passes To/From as parameters.",
      ],
    },
  ],
};
