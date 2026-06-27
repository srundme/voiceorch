import type { Chapter } from "../types";

export const sttAdapters: Chapter = {
  slug: "stt-adapters",
  moduleId: "m5",
  number: "5.2",
  title: "Speech-to-Text Adapters",
  summary:
    "Streaming transcription over WebSockets — Deepgram, Azure, and the Sarvam Indic-language models.",
  estMinutes: 18,
  fileRef: "artifacts/api-server/src/orchestration/adapters/stt/deepgram.ts",
  prerequisites: ["adapter-pattern", "audio-ts"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "An STT (speech-to-text) adapter is the ear of the agent. Its job: take the stream of audio bytes coming off the phone line and turn it into words the LLM can read. Get this wrong and nothing downstream works — the smartest LLM in the world is useless if it's fed garbled transcripts.",
        "The hard part isn't accuracy — the vendors handle that. The hard part is **speed**. A caller pauses for half a second and expects a reply. We can't wait until they hang up to transcribe; we need words *as they speak them*. That means **streaming** transcription over a long-lived WebSocket, not a one-shot HTTP upload.",
        "In this chapter we walk the **Deepgram** streaming adapter end to end, then peek at the **Sarvam** adapter — the one that handles Tamil, Hindi, and ten other Indic languages, with a pile of hard-won WebSocket gotchas baked into its comments.",
      ],
    },
    {
      kind: "concept",
      title: "Batch vs streaming, and what a WebSocket is",
      body: [
        "A normal HTTP request is **batch**: you send the whole audio file, wait, and get the whole transcript back. Fine for a recording, far too slow for a live call.",
        "A **WebSocket** is a different kind of connection: instead of one request → one response, it stays **open** and lets both sides send messages whenever they like, in both directions, for as long as the call lasts. We push raw audio chunks in; the vendor pushes transcript fragments back — all over the same pipe.",
        "Streaming STT sends two flavours of transcript: **interim** results (rough, live guesses that keep changing as you speak) and **final** results (polished, won't change). The `isFinal` flag in the adapter's callback tells them apart. The pipeline ignores interims for the LLM but can use them for barge-in detection.",
      ],
    },
    {
      kind: "analogy",
      title: "A court stenographer, not a transcription service",
      body: [
        "A transcription service is batch: you mail them a tape, they mail back a document days later. A court **stenographer** is streaming: they type every word *as it's spoken*, and you can read the live feed scrolling by — corrections and all.",
        "Deepgram is our stenographer. Audio flows in continuously, words scroll out continuously, and a little flag marks which lines are finalized versus still being revised.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/deepgram.ts",
      language: "typescript",
      intro:
        "Opening the WebSocket. The query string IS the configuration — encoding, sample rate, language, and endpointing mode all ride in the URL.",
      code: `transcribeStream(
  onTranscript: (text: string, isFinal: boolean) => void,
  onClose?: () => void,
): StreamSTT {
  const model = this.model ?? "nova-2";
  const useSmartEndpointing = this.cfg.smartEndpointing !== "off";

  const params = new URLSearchParams({
    model,
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    punctuate: "true",
    smart_format: "true",
  });

  const dgLang = normaliseDeepgramLang(this.cfg.language ?? null);
  if (dgLang) params.set("language", dgLang);
  if (this.cfg.backgroundDenoising) params.set("noise_reduction", "true");`,
      lines: [
        {
          lines: "1-4",
          label: "the streaming entry point",
          explanation:
            "This is the `transcribeStream?` method from the `STTAdapter` interface, now made concrete. It takes the pipeline's `onTranscript` callback and returns a `StreamSTT` handle. Every word Deepgram recognizes will arrive through `onTranscript`.",
        },
        {
          lines: "5-6",
          label: "model + endpointing mode",
          explanation:
            "Defaults to Deepgram's `nova-2` model. `smartEndpointing` decides *how* we detect end-of-turn — vendor VAD events vs simple silence timing. We'll see both branches shortly.",
        },
        {
          lines: "8-15",
          label: "encoding: linear16, sample_rate: 16000",
          explanation:
            "Deepgram needs to be told exactly what bytes to expect: 16-bit linear PCM at 16 kHz, mono. This must match what the pipeline sends after upsampling phone audio (recall `audio.ts` decodes 8 kHz μ-law, then upsamples to 16 kHz for STT).",
        },
        {
          lines: "17-18",
          label: "language normalisation",
          explanation:
            "Deepgram is picky about language codes. `normaliseDeepgramLang` converts our BCP-47 tags (like `hi-IN`) into what Deepgram accepts. Skip this and the WebSocket slams shut the instant it opens — see the gotcha below.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Wrong language code → instant WebSocket close",
      body: [
        "Deepgram accepts regional English (`en-US`, `en-IN`) but for most other languages it wants the **bare** ISO code: `hi`, not `hi-IN`; `ta`, not `ta-IN`. Pass the wrong tag and the WebSocket closes immediately — no error message, just a dead connection and a silent call.",
        "That's why `normaliseDeepgramLang` exists: it keeps a whitelist of full locales Deepgram supports and strips everything else down to the bare code. A tiny function guarding against a very confusing failure.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/deepgram.ts",
      language: "typescript",
      intro:
        "The endpointing branch — the single most latency-critical decision in the adapter. 'Endpointing' means deciding when the caller has finished a sentence.",
      code: `  if (useSmartEndpointing) {
    // VAPI/LiveKit mode — use Deepgram's VAD utterance-end events (ML-based endpointing)
    params.set("vad_events", "true");
    params.set("utterance_end_ms", String(this.cfg.endOfTurnTimeout));
    params.set("interim_results", "true");
    // …
  } else {
    // Standard silence-based endpointing — Deepgram caps at 2000 ms;
    // values above 2000 cause the WS to close immediately.
    const endpointing = Math.min(this.cfg.endOfTurnTimeout, 2000);
    params.set("endpointing", String(endpointing));
  }`,
      lines: [
        {
          lines: "1-5",
          label: "smart endpointing (ML-based)",
          explanation:
            "In smart mode we ask Deepgram for `vad_events` — its neural network fires an `UtteranceEnd` event when it's confident the caller has stopped. `interim_results` streams the rough live guesses we accumulate until that event lands. More accurate, fewer mid-sentence cut-offs.",
        },
        {
          lines: "7-11",
          label: "standard silence endpointing",
          explanation:
            "Simpler mode: tell Deepgram 'after N ms of silence, finalize the phrase.' Crude but predictable.",
        },
        {
          lines: "8-10",
          label: "the Math.min(…, 2000) cap",
          explanation:
            "A real, documented gotcha: Deepgram silently rejects any `endpointing` value above 2000 ms by closing the WebSocket. So we clamp it. The comment was written by someone who got burned — clamping prevents a hung call.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/deepgram.ts",
      language: "typescript",
      intro:
        "Once the URL is built, we open the socket and — crucially — keep it alive during silence.",
      code: `  const ws = new WebSocket(wsUrl, {
    headers: { Authorization: \`Token \${this.key}\` },
  });

  // Deepgram closes idle connections after ~10 s of no audio.
  // Send a KeepAlive frame every 8 s so the WS stays open during the
  // agent's greeting / TTS playback when the user isn't speaking yet.
  const keepAliveInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "KeepAlive" }));
    }
  }, 8_000);

  ws.on("open", () => {
    wsReady = true;
    for (const chunk of audioQueue.splice(0)) ws.send(chunk);
    // …
  });`,
      lines: [
        {
          lines: "1-3",
          label: "open with auth header",
          explanation:
            "The API key rides in an `Authorization: Token …` header on the WebSocket handshake. No key in the URL — URLs get logged, headers usually don't.",
        },
        {
          lines: "5-12",
          label: "the KeepAlive heartbeat",
          explanation:
            "Another field-tested gotcha: Deepgram hangs up after ~10 s of silence. But during the agent's greeting or while the caller is just listening, **no audio flows**. So a timer sends a tiny `KeepAlive` JSON frame every 8 s to keep the pipe open. Without it the STT dies mid-call.",
        },
        {
          lines: "14-18",
          label: "flush the audio queue on open",
          explanation:
            "Opening a WebSocket isn't instant. Audio that arrived before `open` fired was stashed in `audioQueue`; the moment we're connected we replay it all with `splice(0)`. No first words lost to connection lag.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/deepgram.ts",
      language: "typescript",
      intro:
        "The message handler: how raw vendor JSON becomes a clean `onTranscript(text, isFinal)` call. This runs on every frame Deepgram sends back.",
      code: `  // ── UtteranceEnd event (smart endpointing: vapi/livekit mode) ──────────
  if (msg.type === "UtteranceEnd" && useSmartEndpointing) {
    const text = pendingInterim.trim();
    pendingInterim = "";
    if (text) {
      onTranscript(text, true);
    }
    return;
  }

  if (msg.type !== "Results") return;

  const alt = msg.channel?.alternatives?.[0];
  if (!alt?.transcript) return;

  const confidence = alt.confidence ?? 1;`,
      lines: [
        {
          lines: "2-9",
          label: "UtteranceEnd → flush the final",
          explanation:
            "In smart mode, interim fragments pile up in `pendingInterim`. When Deepgram's VAD declares the turn over (`UtteranceEnd`), we emit the accumulated text with `isFinal = true` and clear the buffer. That's the moment the pipeline starts thinking.",
        },
        {
          lines: "11",
          label: "ignore non-Results messages",
          explanation:
            "Deepgram sends metadata, speech-started events, and more. We only care about `Results` (transcript) and `UtteranceEnd`. Everything else is dropped with an early `return` — a clean guard.",
        },
        {
          lines: "13-14",
          label: "dig out the transcript",
          explanation:
            "The transcript is buried in `channel.alternatives[0]`. The `?.` optional-chaining safely returns `undefined` if any layer is missing, so a malformed message can't crash the handler. Empty transcript → return.",
        },
        {
          lines: "16",
          label: "confidence",
          explanation:
            "Each transcript carries a confidence score. The adapter compares it to a configurable threshold and **drops** low-confidence guesses — better to hear nothing than to feed the LLM a hallucinated word.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/deepgram.ts",
      language: "typescript",
      intro:
        "Finally, the returned `StreamSTT` handle — the two methods the pipeline uses to push audio and close down.",
      code: `  return {
    sendAudio(chunk: Buffer): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      } else if (!wsReady) {
        audioQueue.push(chunk);
      }
    },
    close(): void {
      clearInterval(keepAliveInterval);
      if (ws.readyState < WebSocket.CLOSING) ws.close();
    },
  };`,
      lines: [
        {
          lines: "2-8",
          label: "sendAudio",
          explanation:
            "The pipeline calls this with every audio chunk. If the socket is open, send immediately. If we're still connecting, queue it (that's the buffer the `open` handler drains). This race-proofing is why no audio is ever dropped.",
        },
        {
          lines: "9-12",
          label: "close",
          explanation:
            "On call end, kill the KeepAlive timer (or it leaks forever) and close the socket — but only if it isn't already closing. Clean teardown matters: thousands of calls a day means thousands of sockets to not leak.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/sarvam.ts",
      language: "typescript",
      intro:
        "Sarvam is the Indic-language specialist (Tamil, Hindi, Telugu, +9 more). Its file opens with a protocol cheat-sheet full of gotchas discovered by live probing — the kind of knowledge that's gold.",
      code: ` * ── Audio message (JSON text, sent as each PCM chunk arrives) ────────────────
 *   { audio: { data: "<base64 raw PCM>", encoding: "audio/wav", sample_rate: 16000 } }
 *   NOTE: encoding enum MUST be "audio/wav" — "pcm_s16le" is rejected by Sarvam's
 *   Pydantic model even though the URL param \`input_audio_codec=pcm_s16le\` sets
 *   the actual codec. Confirmed via live WebSocket probe (June 2026).
 *
 * ── Close codes ──────────────────────────────────────────────────────────────
 *   1000 Normal closure (intentional)
 *   1001 Going away        — reconnect
 *   1006 Abnormal (no close frame) — reconnect with backoff
 *   1011 Server error      — reconnect with backoff
 *   4xxx Auth / quota      — do NOT retry; fix first`,
      lines: [
        {
          lines: "1-2",
          label: "audio as base64 JSON",
          explanation:
            "Unlike Deepgram (which takes raw binary), Sarvam wants each audio chunk wrapped in a JSON message with the bytes base64-encoded. Different vendor, different dialect — exactly why we hide each behind the same `StreamSTT` interface.",
        },
        {
          lines: "3-5",
          label: "the encoding-enum trap",
          explanation:
            "A perfect example of an undocumented gotcha: the `encoding` field must literally say `\"audio/wav\"` even though the audio is raw PCM. Sending the technically-correct `\"pcm_s16le\"` gets rejected. Someone discovered this by probing the live socket — and wrote it down so you don't have to.",
        },
        {
          lines: "7-12",
          label: "close-code playbook",
          explanation:
            "WebSockets close with a numeric code. This table encodes the recovery policy: 1001/1006/1011 are transient — reconnect with backoff. But 4xxx means auth or quota: retrying is pointless and just burns money, so the adapter does NOT retry those.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Same interface, wildly different protocols",
      body: [
        "Deepgram takes raw binary frames; Sarvam takes base64 JSON. Deepgram needs a KeepAlive every 8 s; Sarvam emits `START_SPEECH`/`END_SPEECH` VAD signals and self-calibrates a coalescing window to the caller's pause rhythm. The protocols couldn't be more different.",
        "Yet the pipeline calls `sendAudio()` and receives `onTranscript()` from both, identically. **That** is the adapter pattern earning its keep — all this per-vendor chaos stays trapped inside the adapter file.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "An STT adapter sits between cleaned caller audio and the thinking step. Click to explore neighbours.",
      nodes: [
        { id: "audio", label: "audio.ts", sublabel: "decode + upsample to 16 kHz", chapterSlug: "audio-ts" },
        { id: "pipeline", label: "OrchestrationPipeline", sublabel: "pushes audio, awaits text", chapterSlug: "session-and-pipeline" },
        { id: "factory", label: "createSTTAdapter()", sublabel: "picks the vendor", chapterSlug: "adapter-pattern" },
        { id: "deepgram", label: "DeepgramSTT", sublabel: "deepgram.ts — THIS FILE", current: true },
        { id: "sarvam", label: "SarvamSTT", sublabel: "Indic languages — same file family", current: true },
        { id: "endpointing", label: "Endpointing", sublabel: "when is the turn over?", chapterSlug: "endpointing" },
        { id: "llm", label: "LLM adapter", sublabel: "reads the transcript", chapterSlug: "llm-adapters" },
      ],
      edges: [
        { from: "audio", to: "pipeline", label: "16 kHz PCM" },
        { from: "factory", to: "deepgram", label: "creates" },
        { from: "factory", to: "sarvam", label: "creates" },
        { from: "pipeline", to: "deepgram", label: "sendAudio()" },
        { from: "deepgram", to: "endpointing", label: "isFinal transcript" },
        { from: "endpointing", to: "llm", label: "caller's words" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why does the Deepgram adapter send a `KeepAlive` frame every 8 seconds?",
          choices: [
            "To measure latency.",
            "Deepgram closes idle connections after ~10 s of no audio, and during the agent's greeting no audio flows — the heartbeat keeps the socket alive.",
            "To bill the customer per second.",
            "It re-sends the API key.",
          ],
          correctIndex: 1,
          explanation:
            "When the caller is silent (e.g. listening to the greeting), no audio is sent. Without a KeepAlive, Deepgram would hang up after ~10 s and the STT would die mid-call.",
        },
        {
          prompt: "What does the `isFinal` flag in `onTranscript(text, isFinal)` distinguish?",
          choices: [
            "Whether the call has ended.",
            "A polished, won't-change final transcript versus a rough live interim guess.",
            "Whether the audio was loud enough.",
            "English versus a regional language.",
          ],
          correctIndex: 1,
          explanation:
            "Streaming STT emits interim results (live, still changing) and final results (committed). `isFinal` tells them apart so the pipeline only sends finals to the LLM.",
        },
        {
          prompt: "Sarvam's protocol requires the audio `encoding` field to be `\"audio/wav\"` even though the bytes are raw PCM. Why is this captured in a code comment?",
          choices: [
            "It's a typo nobody fixed.",
            "It's a non-obvious vendor quirk discovered by live probing — sending the 'correct' value gets rejected, so the comment saves the next developer hours.",
            "WAV is always required by WebSockets.",
            "The comment is auto-generated.",
          ],
          correctIndex: 1,
          explanation:
            "It's an undocumented Sarvam gotcha confirmed by a live WebSocket probe. Documenting these traps in the adapter is exactly how per-vendor pain stays contained.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "STT adapters stream over a long-lived WebSocket so words arrive as the caller speaks, not after they hang up.",
        "`isFinal` separates rough interim guesses from committed final transcripts; only finals reach the LLM.",
        "Deepgram quirks: bare language codes (not BCP-47), an `endpointing` cap of 2000 ms, and a mandatory KeepAlive every 8 s.",
        "Sarvam handles 12 Indic languages and has its own dialect: base64-JSON audio with the `encoding` enum forced to `\"audio/wav\"`.",
        "WebSocket close codes drive recovery: 1006/1011 reconnect with backoff; 4xxx (auth/quota) must NOT retry.",
        "Every adapter exposes the same `sendAudio()` / `onTranscript()` shape, hiding wildly different vendor protocols behind one interface.",
      ],
    },
  ],
};
