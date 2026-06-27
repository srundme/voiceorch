import type { Chapter } from "../types";

export const ttsAdapters: Chapter = {
  slug: "tts-adapters",
  moduleId: "m5",
  number: "6.4",
  title: "Text-to-Speech Adapters",
  summary:
    "Turning the reply into a voice — ElevenLabs, Cartesia, and streaming audio back with minimal latency.",
  estMinutes: 16,
  fileRef: "artifacts/api-server/src/orchestration/adapters/tts/elevenlabs.ts",
  prerequisites: ["adapter-pattern", "llm-adapters"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "The TTS (text-to-speech) adapter is the **mouth** of the agent. The LLM just streamed a sentence; now we have to turn those words into actual sound and push it down the phone line — and we have to do it *fast*, because the caller is sitting in silence waiting to hear a human-sounding voice.",
        "The metric that matters here is **TTFAB** — time to first audio byte. The caller doesn't care how long the whole sentence takes to synthesize; they care how long until they hear *something*. So just like the LLM streams tokens, the TTS adapter **streams audio**: it starts sending sound chunks the moment the first ones are ready, instead of waiting for the entire clip to render.",
        "We'll walk the **ElevenLabs** adapter (the high-quality voice default), then peek at **Cartesia** — the ultra-low-latency option with a clever retry wrapper and an India-based endpoint. Both produce the exact same thing the pipeline expects: raw 16 kHz PCM chunks.",
      ],
    },
    {
      kind: "concept",
      title: "Streaming a response body, and why raw PCM",
      body: [
        "When you `fetch` a streaming endpoint, the response has a `body` you can read incrementally with a **reader**: `resp.body.getReader()`. Calling `reader.read()` gives you the next chunk of bytes as it arrives over the wire, plus a `done` flag that turns true at the end. Loop on it and you process audio in real time.",
        "The audio format matters. The phone pipeline works in **raw PCM** — uncompressed 16-bit samples — because that's what it can mix, resample, and re-encode to the phone's μ-law format. If a vendor sent compressed **MP3** instead, the pipeline would feed those compressed bytes into a raw-PCM decoder and produce pure static. So every TTS adapter must request raw PCM at 16 kHz.",
        "Because the format contract is identical across vendors, the pipeline's audio code (from the `audio.ts` chapter) doesn't know or care whether ElevenLabs or Cartesia produced the bytes. The adapter guarantees the shape.",
      ],
    },
    {
      kind: "analogy",
      title: "A sight-reader, not a studio recording",
      body: [
        "A studio audiobook is batch: the narrator records the whole chapter, it's mastered, and then you get the file. A **sight-reader** reads aloud the instant they see each line — you hear the story unfold in real time, with no wait for the 'final cut.'",
        "TTS streaming is the sight-reader. The first words leave the adapter's mouth (the network socket) while the rest of the sentence is still being synthesized. That's how the caller hears a reply ~100 ms after the LLM finishes, instead of two seconds later.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/elevenlabs.ts",
      language: "typescript",
      intro:
        "Setup: parse the voice, fix the model, and build the URL. The URL-building hides one of the nastiest gotchas in the whole adapter layer.",
      code: `  constructor(apiKey: string, voice: string | null) {
    this.key = apiKey;
    // voice can be "VoiceName:voice_id" or just a voice_id
    const parts = (voice ?? "Rachel:21m00Tcm4TlvDq8ikWAM").split(":");
    this.voiceId = parts[1] ?? parts[0] ?? "21m00Tcm4TlvDq8ikWAM";
    this.modelId = "eleven_turbo_v2_5";
  }

  /** Build the full URL with output_format as a query parameter (required by ElevenLabs API). */
  private buildUrl(path: string): string {
    const url = new URL(\`https://api.elevenlabs.io/v1/text-to-speech/\${this.voiceId}\${path}\`);
    url.searchParams.set("output_format", "pcm_16000");
    return url.toString();
  }`,
      lines: [
        {
          lines: "3-5",
          label: "voice parsing",
          explanation:
            "The UI stores a voice as `\"Rachel:21m00Tcm4TlvDq8ikWAM\"` — a friendly name plus the real ID, colon-separated. We `split(\":\")` and take the ID (`parts[1]`), falling back to the whole string if there's no colon, and finally to a hard-coded default. Defensive layering so a malformed config never crashes the call.",
        },
        {
          lines: "6",
          label: "eleven_turbo_v2_5",
          explanation:
            "The model is fixed to the turbo model — chosen specifically for low latency on phone calls. Quality models exist but add hundreds of ms of TTFAB.",
        },
        {
          lines: "11-13",
          label: "output_format as a QUERY param",
          explanation:
            "We build the URL and attach `output_format=pcm_16000` as a query-string parameter — raw 16 kHz PCM, exactly what the pipeline wants. The comment shouts 'required by ElevenLabs API' for a reason: putting it anywhere else silently fails. See the gotcha below.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "output_format must be a query param — or you get MP3 static",
      body: [
        "This is a real, documented trap straight from the file's header comment: ElevenLabs wants `output_format` in the **URL query string**, NOT the JSON body. And if you set an `Accept: audio/mpeg` header, that *overrides* `output_format` and the API hands back compressed MP3.",
        "The pipeline then decodes those MP3 bytes as if they were raw PCM — producing garbage static down the phone line. The fix is exactly what you see: format in the query string, and no `Accept` header forcing MP3. A one-character mistake here equals an unintelligible call.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/elevenlabs.ts",
      language: "typescript",
      intro:
        "The streaming method — the heart of the adapter. POST to the `/stream` endpoint, then drain the response body chunk by chunk.",
      code: `  async synthesizeStream(
    text: string,
    onChunk: (pcm16k: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const resp = await fetch(this.buildUrl("/stream"), {
      method: "POST",
      headers: this.commonHeaders,
      body: this.buildBody(text),
      signal,
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(\`ElevenLabs TTS stream error \${resp.status}: \${err}\`);
    }

    if (!resp.body) throw new Error("ElevenLabs TTS: no response body");

    const reader = resp.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.length) onChunk(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    onDone(text.length);
  }`,
      lines: [
        {
          lines: "1-5",
          label: "the streaming signature",
          explanation:
            "This is `TTSAdapter.synthesizeStream?` made concrete. `onChunk` fires per audio fragment; `onDone` fires once with the character count (for billing); `signal` is an `AbortSignal` so the pipeline can cancel synthesis instantly when the caller barges in.",
        },
        {
          lines: "7-12",
          label: "POST to /stream with the abort signal",
          explanation:
            "Hit the `/stream` endpoint built by `buildUrl`. Passing `signal` is what makes barge-in possible: if the caller interrupts, the pipeline aborts this fetch and the half-spoken sentence stops mid-word.",
        },
        {
          lines: "18",
          label: "guard the body",
          explanation:
            "A streaming response with no `body` is unusable, so we fail fast rather than crash inside the loop. Small guard, clear error.",
        },
        {
          lines: "20-29",
          label: "the reader loop",
          explanation:
            "`getReader()` gives us incremental access. Each `await reader.read()` yields the next `value` (bytes) and a `done` flag. We wrap each chunk in a `Buffer` and hand it to `onChunk` — this is the line that ships audio to the caller before synthesis finishes. The `finally` releases the lock no matter what, even if the caller aborts.",
        },
        {
          lines: "30",
          label: "onDone with the character count",
          explanation:
            "Once the stream is drained, report `text.length` characters. TTS is billed per character, so this number flows straight into the call's cost record.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/cartesia.ts",
      language: "typescript",
      intro:
        "Cartesia is the low-latency alternative. Two things stand out: an India-based endpoint and a retry wrapper around every fetch.",
      code: `/** India endpoint by default for lowest latency; override via CARTESIA_BASE_URL env var. */
const CARTESIA_BASE_URL = (process.env["CARTESIA_BASE_URL"] ?? "https://api-india.cartesia.ai").replace(/\\/+$/, "");

/** Retry a fetch call on transient network failures (ETIMEDOUT, ECONNRESET, etc.). */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = MAX_RETRIES,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      // Only retry on network-level errors (TypeError: fetch failed / ETIMEDOUT).
      // Don't retry on AbortError (caller cancelled).
      const isNetwork = err instanceof TypeError && !(err.name === "AbortError");
      if (!isNetwork || attempt === retries) throw err;
      await new Promise<void>((r) => setTimeout(r, RETRY_BASE_MS * 2 ** attempt));
    }
  }
  throw lastErr;
}`,
      lines: [
        {
          lines: "1-2",
          label: "India-first base URL",
          explanation:
            "SnapServe's callers are mostly in India, so Cartesia defaults to its Mumbai endpoint to shave round-trip latency. The `replace(/\\/+$/, \"\")` trims any trailing slashes so URL-joining stays clean. An env var can override it per deployment.",
        },
        {
          lines: "11-13",
          label: "the retry loop",
          explanation:
            "Wrap `fetch` in a loop that retries on transient failures. A flaky network blip shouldn't drop a live call if a quick retry can save it.",
        },
        {
          lines: "16-19",
          label: "retry only network errors, never AbortError",
          explanation:
            "Crucial nuance: only retry genuine network failures (a `TypeError` from fetch). If the error is an `AbortError`, the caller *deliberately* cancelled (barge-in) — retrying would re-speak audio the caller interrupted. So abort is never retried.",
        },
        {
          lines: "20",
          label: "exponential backoff",
          explanation:
            "Between attempts, wait `RETRY_BASE_MS * 2 ** attempt` — 300 ms, then 600 ms. Backing off avoids hammering an endpoint that's already struggling.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Same PCM contract, different trade-offs",
      body: [
        "ElevenLabs leans on voice quality; Cartesia leans on raw latency with retries and a regional endpoint. Cartesia even requests `{ container: \"raw\", encoding: \"pcm_s16le\", sample_rate: 16000 }` in its body — a different request shape entirely.",
        "But both stream **raw 16 kHz PCM** through `onChunk`, so the pipeline swaps one for the other with a single config change. The vendor-specific cleverness — query-param formats, retry loops, India endpoints — stays sealed inside each adapter.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "The TTS adapter turns the LLM's words into audio bytes the pipeline plays down the line. Click to explore.",
      nodes: [
        { id: "llm", label: "LLM adapter", sublabel: "streams reply tokens", chapterSlug: "llm-adapters" },
        { id: "pipeline", label: "OrchestrationPipeline", sublabel: "feeds sentences, plays chunks", chapterSlug: "session-and-pipeline" },
        { id: "factory", label: "createTTSAdapter()", sublabel: "picks the voice vendor", chapterSlug: "adapter-pattern" },
        { id: "eleven", label: "ElevenLabsTTS", sublabel: "elevenlabs.ts — THIS FILE", current: true },
        { id: "cartesia", label: "CartesiaTTS", sublabel: "low-latency India endpoint", current: true },
        { id: "audio", label: "audio.ts", sublabel: "PCM → μ-law for the phone", chapterSlug: "audio-ts" },
        { id: "telephony", label: "Telephony", sublabel: "down the phone line", chapterSlug: "telephony-overview" },
      ],
      edges: [
        { from: "llm", to: "pipeline", label: "sentence text" },
        { from: "factory", to: "eleven", label: "creates" },
        { from: "factory", to: "cartesia", label: "creates" },
        { from: "pipeline", to: "eleven", label: "synthesizeStream(text)" },
        { from: "eleven", to: "audio", label: "onChunk (16 kHz PCM)" },
        { from: "audio", to: "telephony", label: "μ-law frames" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why does the TTS adapter stream audio chunks instead of returning the whole clip at once?",
          choices: [
            "To save bandwidth.",
            "To minimize TTFAB (time to first audio byte) — the caller hears the reply start almost immediately instead of waiting for full synthesis.",
            "Because ElevenLabs charges less for streaming.",
            "To support stereo audio.",
          ],
          correctIndex: 1,
          explanation:
            "Streaming sends the first audio bytes the moment they're ready, so the caller hears a response ~100 ms after the LLM finishes rather than seconds later.",
        },
        {
          prompt: "ElevenLabs requires `output_format` to be a URL query parameter. What happens if you instead send `Accept: audio/mpeg`?",
          choices: [
            "Nothing changes.",
            "It overrides output_format and returns compressed MP3, which the pipeline decodes as raw PCM → garbage static.",
            "The request is rejected with a 400.",
            "You get higher-quality audio.",
          ],
          correctIndex: 1,
          explanation:
            "An `Accept: audio/mpeg` header overrides `output_format`, yielding MP3. The pipeline expects raw PCM, so it decodes the compressed bytes incorrectly and produces static.",
        },
        {
          prompt: "Cartesia's `fetchWithRetry` retries network errors but deliberately does NOT retry an `AbortError`. Why?",
          choices: [
            "AbortErrors are rare.",
            "An AbortError means the caller intentionally cancelled (barge-in); retrying would re-speak audio the caller just interrupted.",
            "Retrying aborts is too slow.",
            "AbortErrors aren't real errors.",
          ],
          correctIndex: 1,
          explanation:
            "An abort is a deliberate cancellation — usually barge-in. Retrying it would resend audio the caller chose to interrupt, so the retry logic skips AbortError.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "TTS adapters stream raw 16 kHz PCM via `onChunk` to minimize TTFAB — the caller hears the reply almost instantly.",
        "Streaming reads the response body with `resp.body.getReader()` and loops on `reader.read()` until `done`.",
        "ElevenLabs gotcha: `output_format` MUST be a query param, and an `Accept: audio/mpeg` header silently forces MP3 → static.",
        "An `AbortSignal` flows into the fetch so barge-in can cancel synthesis mid-sentence.",
        "Cartesia adds a retry-with-backoff wrapper and an India-first endpoint, but never retries an AbortError.",
        "Every vendor returns the identical PCM contract, so swapping ElevenLabs for Cartesia is a one-line config change.",
      ],
    },
  ],
};
