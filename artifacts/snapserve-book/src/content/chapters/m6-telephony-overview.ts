import type { Chapter } from "../types";

export const telephonyOverview: Chapter = {
  slug: "telephony-overview",
  moduleId: "m6",
  number: "7.1",
  title: "Telephony: The Phone-Network Bridge",
  summary:
    "How a real phone call becomes a WebSocket of audio frames, and what every provider has in common.",
  estMinutes: 14,
  fileRef: "artifacts/api-server/src/orchestration/telephony/",
  prerequisites: ["session-and-pipeline"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "You've met the pipeline — the engine that turns caller audio into a reply. But the pipeline doesn't know what a phone is. It just wants a stream of audio frames coming in and a way to push audio frames back out. **Telephony** is the layer that bridges the messy outside world of phone companies into that clean, uniform stream.",
        "SnapServe supports four 'transports': **Twilio**, **Plivo**, and **VoBiz** for real phone calls, plus **webcall** for testing from a browser. Each one speaks a slightly different dialect on the wire — different JSON shapes, different audio formats, different barge-in messages. The `telephony/` folder is a set of thin **adapters**: one file per provider, each translating that provider's dialect into the *exact same* calls on the shared pipeline.",
        "This chapter is the map. Once you see the shape every provider shares, the next three chapters (Twilio, VoBiz/Plivo, and webcall) are just variations on one theme.",
      ],
    },
    {
      kind: "concept",
      title: "One pipeline, many phone companies",
      body: [
        "When a call comes in, the provider doesn't send us audio over plain HTTP. It opens a **WebSocket** — a long-lived, two-way pipe that stays open for the whole call — and streams tiny audio chunks (typically 20 ms each) as they arrive. We stream our reply audio back down the same pipe.",
        "Every provider handler follows the same four-beat life cycle: (1) a **start** event tells us which call this is and who's on the line; (2) a flood of **media** events carry the caller's audio; (3) we push **audio out** as the AI replies; (4) a **stop**/close event ends the call. The handler's whole job is to translate each provider's version of those four beats into one `createSession` call and the pipeline's two input methods.",
        "The genius is that everything hard — speech recognition, the LLM, text-to-speech, endpointing, barge-in, recording — lives in the shared pipeline. A provider adapter never re-implements any of it. Add a fifth provider tomorrow and you write one small file; the entire conversation engine comes along for free.",
      ],
    },
    {
      kind: "analogy",
      title: "Every airline, one jet bridge",
      body: [
        "Think of the pipeline as the **terminal gate** — it serves passengers identically no matter which plane pulls up. Twilio, Plivo, and VoBiz are different **aircraft**: a 737, an A320, a regional jet. Each has its own door height and latch.",
        "The telephony adapter is the **jet bridge** that extends to meet whatever plane arrives and lines its door up perfectly with the gate. Passengers (audio frames) walk through the same gate every time and never know which aircraft they flew. Webcall is a tiny commuter prop that lands at the same gate — same bridge idea, much smaller plane.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/index.ts",
      language: "typescript",
      intro:
        "It all starts at the WebSocket upgrade. The server reads the provider name out of the URL (e.g. /api/ws/twilio/42) and routes the socket to the matching handler. This switch IS the dispatcher for the whole module.",
      code: `const provider          = match[1] as "twilio" | "plivo" | "vobiz" | "webcall";
const agentId           = parseInt(match[2]!, 10);
// …
wss.handleUpgrade(request, socket, head, (ws: import("ws").WebSocket) => {
  switch (provider) {
    case "twilio":   void handleTwilioWebSocket(ws, agentId, campaignLeadId); break;
    case "plivo":    void handlePlivoWebSocket(ws, agentId, campaignLeadId); break;
    case "vobiz":    void handleVobizWebSocket(ws, agentId, platformTelephony, campaignLeadId, vobizFrom, vobizTo, voicemailDelivery); break;
    case "webcall":  void handleWebcallWebSocket(ws, agentId, webcallUserId!); break;
  }
});`,
      lines: [
        {
          lines: "1",
          label: "provider from the URL",
          explanation:
            "The first path segment after `/api/ws/` is the provider name. It's typed as a union of exactly the four we support, so TypeScript forces the `switch` below to handle each one.",
        },
        {
          lines: "2",
          label: "agentId from the URL",
          explanation:
            "The second segment is the agent id — which AI persona answers this call. Every provider URL embeds it the same way, so routing is uniform.",
        },
        {
          lines: "4",
          label: "wss.handleUpgrade",
          explanation:
            "This is the moment a plain HTTP request becomes a live WebSocket. Once `handleUpgrade` fires, we have a `ws` object we can stream audio over for the rest of the call.",
        },
        {
          lines: "5-10",
          label: "the switch = the jet bridge selector",
          explanation:
            "One line per provider. Each `handleXxxWebSocket` is a self-contained adapter in `telephony/`. Notice they take almost identical arguments — `ws` and `agentId` — because they all feed the same engine. `void` says 'fire this async handler and don't await it here'; the handler owns the socket from now on.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "why",
      title: "Why webcall takes an extra argument",
      body: [
        "Spot the odd one out: `webcall` passes `webcallUserId!`. Real phone providers connect *inbound* and can't present a login token, so they're trusted by URL + webhook signature. The browser, by contrast, **can** authenticate — so before this switch the server verifies a session JWT and that the user owns the agent, then passes the verified user id through. Same engine, stronger door.",
      ],
    },
    {
      kind: "concept",
      title: "The shared contract: callbacks in, audio out",
      body: [
        "Every adapter talks to the engine through one function: `createSession`. You hand it the call's identity (agent, to/from numbers, provider name) plus a small set of **callbacks** — functions the pipeline will call when it has something for you to send to the caller.",
        "This is **dependency injection** in its simplest form. The pipeline doesn't know or care whether 'send this audio' means a Twilio `media` JSON message, a VoBiz `playAudio` event, or a raw binary browser frame. It just calls `onAudioOut(buffer)` and your adapter does the provider-specific packaging. Same for `onCallEnd`, `onBargeIn`, and `onTranscript`.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/session.ts",
      language: "typescript",
      intro:
        "Here's the contract every provider fills in. The fields above the line identify the call; the callbacks below the line are how the engine pushes work back to the transport.",
      code: `export async function createSession(params: {
  agentId: number;
  telephonyProvider: SessionTransport;
  toNumber: string;
  fromNumber: string;
  externalCallId?: string;
  // …
  onAudioOut: (audio: Buffer) => void;
  onCallEnd: () => void;
  onBargeIn?: () => void;
  // …
  onTranscript?: (speaker: "user" | "agent", text: string) => void;
  // …
  rawPcmOutput?: boolean;
  // …
}): Promise<{ sessionId: string; callDbId: number }> {`,
      lines: [
        {
          lines: "2-5",
          label: "who is this call?",
          explanation:
            "`agentId` picks the AI persona; `telephonyProvider` tags the call record; `toNumber`/`fromNumber` are the two phone numbers (used for caller memory and billing). Every adapter fills these in.",
        },
        {
          lines: "7",
          label: "onAudioOut — the only required output",
          explanation:
            "The pipeline calls this with a `Buffer` of reply audio whenever TTS produces a chunk. Twilio wraps it in JSON+base64, VoBiz wraps it in a `playAudio` event, webcall sends raw bytes. The pipeline stays blissfully ignorant.",
        },
        {
          lines: "8-9",
          label: "onCallEnd / onBargeIn",
          explanation:
            "`onCallEnd` lets the engine hang up (usually `ws.close()`). `onBargeIn` fires when the caller interrupts mid-reply — the adapter tells the provider to flush its playback buffer so the AI stops talking instantly.",
        },
        {
          lines: "11",
          label: "onTranscript — optional",
          explanation:
            "Only the browser webcall uses this, to draw a live transcript on screen. Phone adapters omit it. Optional callbacks (`?`) are how one contract serves both rich and bare transports.",
        },
        {
          lines: "13",
          label: "rawPcmOutput",
          explanation:
            "A format switch. Most phone audio is μ-law, but VoBiz and the browser want raw 16-bit PCM. Setting this flips the engine's output encoding — one boolean instead of a whole separate code path.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "And here's the other half of the contract — the two doors caller audio comes in through. Which door an adapter uses depends only on the provider's audio format.",
      code: `/** Incoming mulaw from Twilio / Plivo — offloads decode + noise-cancel + VAD to worker thread */
onAudioIn(mulawChunk: Buffer): void {
  if (this.closed) return;
  const callId = String(this.config.callId);
  const pcm8k = decodeMulaw(mulawChunk);
  // …
}

onRawPcm8kIn(pcm8k: Buffer, noiseCancel?: boolean): void {
  if (this.closed) return;
  const callId = String(this.config.callId);
  // …
  const nc = noiseCancel !== undefined ? noiseCancel : this.agent.noiseCancellationEnabled;
  // …
}`,
      lines: [
        {
          lines: "1-2",
          label: "onAudioIn — the μ-law door",
          explanation:
            "Twilio and Plivo send 8-bit μ-law, so they call this. It immediately runs `decodeMulaw` (the codec from the audio.ts chapter) to turn each byte into a 16-bit sample before anything else.",
        },
        {
          lines: "9",
          label: "onRawPcm8kIn — the PCM door",
          explanation:
            "VoBiz and webcall already deliver 16-bit PCM, so they skip μ-law entirely and pour audio straight in here. Same destination, one less decoding step.",
        },
        {
          lines: "14",
          label: "the noiseCancel knob",
          explanation:
            "Notice `onRawPcm8kIn` takes a `noiseCancel` flag. The browser already cleaned its mic audio with WebRTC, so webcall passes `false` to avoid double-gating. A tiny detail that uses the same door for two very different audio sources.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Two doors in, one door out",
      body: [
        "The whole module reduces to this: μ-law providers (Twilio, Plivo) come in through `onAudioIn`; PCM providers (VoBiz, webcall) come in through `onRawPcm8kIn`; everyone leaves through `onAudioOut`. Learn those three methods and you can read any provider file in minutes.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "The telephony layer sits between the phone network and the pipeline. Click a box to dive into its chapter.",
      nodes: [
        { id: "network", label: "Phone network / browser", sublabel: "Twilio · Plivo · VoBiz · mic" },
        { id: "router", label: "WS upgrade switch", sublabel: "index.ts routes by provider" },
        { id: "telephony", label: "telephony/ adapters", sublabel: "THIS CHAPTER", current: true },
        { id: "twilio", label: "twilio.ts", sublabel: "μ-law media streams", chapterSlug: "twilio-deep-dive" },
        { id: "vobiz", label: "vobiz.ts / plivo.ts", sublabel: "PCM & quirks", chapterSlug: "vobiz-and-plivo" },
        { id: "webcall", label: "webcall.ts", sublabel: "browser transport", chapterSlug: "webcall" },
        { id: "session", label: "createSession()", sublabel: "the shared contract", chapterSlug: "session-and-pipeline" },
        { id: "audio", label: "decodeMulaw()", sublabel: "audio.ts codec", chapterSlug: "audio-ts" },
      ],
      edges: [
        { from: "network", to: "router", label: "WebSocket upgrade" },
        { from: "router", to: "telephony", label: "by provider name" },
        { from: "telephony", to: "twilio" },
        { from: "telephony", to: "vobiz" },
        { from: "telephony", to: "webcall" },
        { from: "twilio", to: "session", label: "createSession + callbacks" },
        { from: "vobiz", to: "session", label: "createSession + callbacks" },
        { from: "webcall", to: "session", label: "createSession + callbacks" },
        { from: "twilio", to: "audio", label: "onAudioIn → μ-law decode" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "What is the single job of every file in the telephony/ folder?",
          choices: [
            "Run speech recognition and the LLM.",
            "Translate one provider's wire protocol into the same createSession + pipeline calls.",
            "Store call recordings in the database.",
            "Generate the AI's text replies.",
          ],
          correctIndex: 1,
          explanation:
            "Adapters are thin translators. All the heavy lifting (STT, LLM, TTS, endpointing, barge-in) lives in the shared pipeline; each provider file just adapts the wire format to the same engine calls.",
        },
        {
          prompt: "A provider sends 16-bit PCM audio (not μ-law). Which pipeline method does its adapter call for incoming audio?",
          choices: [
            "onAudioIn — it always decodes μ-law first.",
            "onRawPcm8kIn — PCM skips μ-law decoding.",
            "onAudioOut — that handles both directions.",
            "createSession — audio goes through it directly.",
          ],
          correctIndex: 1,
          explanation:
            "`onAudioIn` runs `decodeMulaw` first, so it's for μ-law providers (Twilio, Plivo). PCM providers (VoBiz, webcall) use `onRawPcm8kIn`, which skips the decode step.",
        },
        {
          prompt: "Why does the engine take callbacks like onAudioOut and onBargeIn instead of knowing about Twilio directly?",
          choices: [
            "To make the code longer.",
            "So the pipeline stays provider-agnostic — each adapter packages output its own way while the engine calls one uniform function.",
            "Because callbacks are faster than function calls.",
            "TypeScript requires it.",
          ],
          correctIndex: 1,
          explanation:
            "It's dependency injection: the pipeline calls `onAudioOut(buffer)` blindly, and each adapter decides whether that becomes Twilio JSON, a VoBiz playAudio event, or raw browser bytes. One engine, many transports.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Telephony adapters are thin translators: one file per provider, all feeding the same pipeline.",
        "The WS upgrade switch in index.ts routes each socket to its provider handler by URL.",
        "`createSession` is the shared contract — call identity in, callbacks (onAudioOut/onCallEnd/onBargeIn/onTranscript) out.",
        "Caller audio enters through two doors: `onAudioIn` for μ-law, `onRawPcm8kIn` for PCM; everyone exits through `onAudioOut`.",
        "All the hard work (STT, LLM, TTS, barge-in, recording) lives in the pipeline, so a new provider is one small file.",
      ],
    },
  ],
};
