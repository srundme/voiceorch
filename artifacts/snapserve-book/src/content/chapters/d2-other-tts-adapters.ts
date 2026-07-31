import type { Chapter } from "../types";

export const otherTtsAdapters: Chapter = {
  slug: "other-tts-adapters",
  moduleId: "d2",
  number: "18.4",
  title: "The Other TTS Adapters: ElevenLabs, OpenAI, Azure, Deepgram + the Factory",
  summary:
    "The shorter adapters and their one distinctive trick each — ElevenLabs' output_format query-param trap, OpenAI's 24→16 kHz downsample, Azure's SSML escaping, Deepgram Aura's raw-PCM simplicity — plus the createTTSAdapter factory that picks between them all.",
  estMinutes: 16,
  fileRef: "artifacts/api-server/src/orchestration/adapters/tts/index.ts",
  prerequisites: ["sarvam-tts-complete", "cartesia-tts-complete"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Sarvam and Cartesia are the heavyweights. The remaining adapters are much smaller because they lean on simple HTTP APIs — but each has ONE distinctive detail worth knowing, usually a trap that produces garbage audio if you get it wrong.",
        "We'll start with the **factory** (`createTTSAdapter`) that decides which adapter to build, then take each remaining adapter's most interesting part: ElevenLabs (a query-param trap), OpenAI (sample-rate conversion), Azure (SSML escaping), and Deepgram Aura (the simplest of all).",
        "Notice which adapters implement `synthesizeStream` (streaming) and which only implement `synthesize` (one-shot). Streaming lowers time-to-first-byte; the one-shot-only adapters wait for the whole clip before any audio plays.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/index.ts",
      language: "typescript",
      intro:
        "The factory. This is the single switch statement that maps a provider string to a constructed adapter — and shows exactly which constructor args each adapter cares about.",
      code: `export function createTTSAdapter(
  provider: string,
  apiKey: string,
  voice: string | null,
  model: string | null = null,
  extraConfig?: string | null,
  language?: string | null,
  speed?: number | null,
): TTSAdapter {
  if (STUB_PROVIDERS_ENABLED) return createStubTTS();
  switch (provider.toLowerCase()) {
    case "elevenlabs":
      return new ElevenLabsTTS(apiKey, voice, speed);
    case "cartesia":
      return new CartesiaTTS(apiKey, voice, model, language, speed);
    case "sarvam":
      return new SarvamTTS(apiKey, voice, extraConfig, language, model, speed);
    case "openai":
    case "openai_tts":
      return new OpenAITTS(apiKey, voice, model);
    case "azure":
    case "azure_tts":
      return new AzureTTS(apiKey, voice, extraConfig);
    case "deepgram":
    case "deepgram_aura":
      return new DeepgramTTS(apiKey, voice);
    default:
      throw new Error(\`Unknown TTS provider: \${provider}\`);
  }
}`,
      lines: [
        {
          lines: "10",
          label: "stub short-circuit",
          explanation:
            "In test/dev with `STUB_PROVIDERS_ENABLED`, return a fake adapter — no real API key or network needed. Every factory in the codebase has this escape hatch.",
        },
        {
          lines: "13-17",
          label: "who gets speed",
          explanation:
            "Only ElevenLabs, Cartesia, and Sarvam receive `speed` — the three providers with a speed control. OpenAI, Azure, and Deepgram are constructed without it (they have no speed knob), which is why the pipeline chapter said ttsSpeed is silently ignored there.",
        },
        {
          lines: "16",
          label: "Sarvam's extra args",
          explanation:
            "Sarvam is the only one taking `extraConfig` AND `language` AND `model` AND `speed` — it's the most configurable adapter (recall the JSON extraConfig with `enable_preprocessing`).",
        },
        {
          lines: "27",
          label: "unknown provider throws",
          explanation:
            "A typo'd provider name fails loudly at construction rather than silently producing no audio mid-call — fail fast.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "ElevenLabs: output_format is a QUERY param, not a body field",
      body: [
        "The single most important comment in the ElevenLabs adapter: `output_format` must be a URL query parameter, NOT a JSON body field. And you must NOT set `Accept: audio/mpeg` — that overrides output_format and returns compressed MP3, which the pipeline would then decode as raw PCM → garbage noise.",
        "Get either wrong and the caller hears static. The adapter builds the URL with `output_format=pcm_16000` as a query param and sends no Accept header.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/elevenlabs.ts",
      language: "typescript",
      intro:
        "ElevenLabs URL building and body. The clamp on speed and the query-param output_format are the two things to remember.",
      code: `  constructor(apiKey: string, voice: string | null, speed?: number | null) {
    this.key = apiKey;
    // voice can be "VoiceName:voice_id" or just a voice_id
    const parts = (voice ?? "Rachel:21m00Tcm4TlvDq8ikWAM").split(":");
    this.voiceId = parts[1] ?? parts[0] ?? "21m00Tcm4TlvDq8ikWAM";
    this.modelId = "eleven_turbo_v2_5";
    // ElevenLabs voice_settings.speed only accepts 0.7-1.2; clamp and skip at default.
    this.speed = (speed != null && Number.isFinite(speed) && speed !== 1)
      ? Math.min(1.2, Math.max(0.7, speed))
      : null;
  }

  private buildUrl(path: string): string {
    const url = new URL(\`https://api.elevenlabs.io/v1/text-to-speech/\${this.voiceId}\${path}\`);
    url.searchParams.set("output_format", "pcm_16000");
    return url.toString();
  }

  private buildBody(text: string): string {
    return JSON.stringify({
      text,
      model_id: this.modelId,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        ...(this.speed != null ? { speed: this.speed } : {}),
      },
    });
  }`,
      lines: [
        {
          lines: "3-5",
          label: "voice can be name:id",
          explanation:
            "ElevenLabs voices are often stored as `Rachel:21m00Tcm4TlvDq8ikWAM`. The adapter takes the part after the colon (the id), or the whole string if there's no colon.",
        },
        {
          lines: "7-10",
          label: "speed clamp [0.7, 1.2]",
          explanation:
            "ElevenLabs' `voice_settings.speed` range is narrower than Cartesia's or Sarvam's. Same pattern: clamp `ttsSpeed` and use `null` (omit) at exactly 1.0.",
        },
        {
          lines: "13-16",
          label: "output_format in the URL",
          explanation:
            "The whole point of the gotcha: `output_format=pcm_16000` is a query param on the URL. `buildUrl(\"/stream\")` adds it for the streaming endpoint too.",
        },
        {
          lines: "23-26",
          label: "stability / similarity_boost",
          explanation:
            "ElevenLabs' two core voice knobs, hardcoded to sensible defaults. Speed is spread in only when non-null.",
        },
      ],
    },
    {
      kind: "concept",
      title: "Sample rate: why OpenAI needs a downsample",
      body: [
        "The pipeline works in **16 kHz** PCM everywhere. STT wants 16 kHz, the drain code assumes 16 kHz. So every TTS adapter must ultimately produce 16 kHz.",
        "Most adapters ask the API for 16 kHz directly (`sample_rate=16000`). But OpenAI's TTS only returns **24 kHz** PCM. Feeding 24 kHz audio into code that expects 16 kHz would play it too fast and high-pitched (chipmunk).",
        "So the OpenAI adapter downsamples 24 → 16 kHz using the shared anti-aliasing converter in `audio.ts`. 'Anti-aliasing' means filtering out frequencies too high to represent at the lower rate, so the conversion doesn't introduce buzzing artifacts.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/openai.ts",
      language: "typescript",
      intro:
        "The entire OpenAI adapter's synthesize method — note the response_format and the downsample. It's one-shot only (no synthesizeStream).",
      code: `import { downsample24to16 } from "../../audio.js";

// ...

  async synthesize(text: string): Promise<{ audio: Buffer; characters: number }> {
    const resp = await this.client.audio.speech.create({
      model: this.model,
      voice: this.voice as "alloy",
      input: text,
      response_format: "pcm",
    });
    const pcm24k = Buffer.from(await resp.arrayBuffer());
    return { audio: downsample24to16(pcm24k), characters: text.length };
  }`,
      lines: [
        {
          lines: "1",
          label: "shared converter",
          explanation:
            "`downsample24to16` is imported from `audio.ts` — the same windowed-sinc anti-alias converter used across the codebase. Adapters don't reinvent resampling.",
        },
        {
          lines: "10",
          label: "response_format: pcm",
          explanation:
            "Ask OpenAI for raw PCM (not MP3/Opus). This returns 24 kHz 16-bit PCM.",
        },
        {
          lines: "12-13",
          label: "the 24→16 conversion",
          explanation:
            "Convert 24 kHz to the pipeline's 16 kHz before returning. Skip this and OpenAI voices would sound sped-up and high-pitched. This is OpenAI's one distinctive detail.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "Azure: unescaped text breaks the SSML XML",
      body: [
        "Azure TTS takes **SSML** — an XML document — not plain text. If the LLM's reply contains `<`, `>`, `&`, `'`, or `\"`, those characters break the XML and Azure rejects the request (or mangles the output).",
        "So the Azure adapter escapes them to XML entities (`&lt;`, `&gt;`, `&amp;`, etc.) before embedding the text inside the `<voice>` tag. A caller asking about 'AT&T' would otherwise crash synthesis.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/azure.ts",
      language: "typescript",
      intro:
        "Azure's SSML builder and language detection. The escaping map inline is the key defensive detail.",
      code: `function buildSsml(text: string, voice: string, lang: string): string {
  return [
    \`<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="\${lang}">\`,
    \`  <voice name="\${voice}">\${text.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] ?? c))}</voice>\`,
    \`</speak>\`,
  ].join("\\n");
}

function detectLang(voice: string): string {
  const match = /^([a-z]{2}-[A-Z]{2})/.exec(voice);
  return match ? match[1] : "en-US";
}`,
      lines: [
        {
          lines: "4",
          label: "the escape map",
          explanation:
            "`text.replace(/[<>&'\"]/g, ...)` swaps every XML-special character for its entity. This is the difference between a working request and a 400 when a caller mentions 'R&D' or 'a < b'.",
        },
        {
          lines: "9-12",
          label: "language from the voice name",
          explanation:
            "Azure Neural voice names encode their locale, e.g. `en-US-AriaNeural`. This regex pulls the `en-US` prefix to set `xml:lang`, defaulting to `en-US`. No separate language config needed.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/azure.ts",
      language: "typescript",
      intro:
        "Azure's synthesize — the header `X-Microsoft-OutputFormat` is how it gets raw 16 kHz PCM directly, so no downsample is needed.",
      code: `    const url = \`https://\${this.region}.tts.speech.microsoft.com/cognitiveservices/v1\`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": this.key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "raw-16khz-16bit-mono-pcm",
        "User-Agent": "VoiceOrch/1.0",
      },
      body: ssml,
    });

    if (!resp.ok) throw new Error(\`Azure TTS \${resp.status}: \${await resp.text()}\`);
    return { audio: Buffer.from(await resp.arrayBuffer()), characters: text.length };`,
      lines: [
        {
          lines: "1",
          label: "region in the URL",
          explanation:
            "The endpoint hostname includes the Azure region (from `extraConfig` JSON `{ region }`, default `eastus`). Wrong region = connection refused.",
        },
        {
          lines: "7",
          label: "raw-16khz-16bit-mono-pcm",
          explanation:
            "This output format header makes Azure return exactly what the pipeline wants — 16 kHz mono PCM, no header, no conversion. That's why Azure needs no downsample step (unlike OpenAI).",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/deepgram.ts",
      language: "typescript",
      intro:
        "Deepgram Aura is the simplest adapter — and it DOES implement streaming. Here's the streaming method in full; everything rides in query params.",
      code: `  async synthesizeStream(
    text: string,
    onChunk: (chunk: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const url = new URL("https://api.deepgram.com/v1/speak");
    url.searchParams.set("model", this.model);
    url.searchParams.set("encoding", "linear16");
    url.searchParams.set("sample_rate", "16000");
    url.searchParams.set("container", "none");

    const resp = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: \`Token \${this.key}\`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
      signal,
    });

    if (!resp.ok) throw new Error(\`Deepgram TTS stream \${resp.status}: \${await resp.text()}\`);
    if (!resp.body) throw new Error("Deepgram TTS: no response body");

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
          lines: "8-11",
          label: "config as query params",
          explanation:
            "`model` (e.g. `aura-2-en` — the voice IS the model), `encoding: linear16`, `sample_rate: 16000`, and crucially `container: none`. That last one means NO WAV header — raw PCM straight through, so no RIFF stripping needed.",
        },
        {
          lines: "16",
          label: "Token auth",
          explanation:
            "Same `Authorization: Token …` scheme as Deepgram's STT adapter. One vendor, one auth style across both directions.",
        },
        {
          lines: "26-34",
          label: "plain reader loop",
          explanation:
            "Read the response body stream and hand each chunk to `onChunk`, then `onDone`. No base64, no header — the cleanest streaming loop of all the adapters. Deepgram Aura returns exactly the format the pipeline wants.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Same interface, five different personalities",
      body: [
        "ElevenLabs hides config in a URL query param and clamps speed to [0.7, 1.2]. OpenAI returns 24 kHz and must downsample. Azure speaks XML (SSML) and escapes it. Deepgram Aura returns raw 16 kHz PCM with `container: none` and needs nothing.",
        "Yet the pipeline calls `synthesize()` / `synthesizeStream()` on all of them identically. Every vendor's format war, auth scheme, and sample-rate quirk stays trapped inside its adapter file — the same adapter-pattern payoff you saw in STT.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "The factory picks one adapter; the pipeline drives it through the same interface regardless. Click to explore.",
      nodes: [
        { id: "factory", label: "createTTSAdapter()", sublabel: "tts/index.ts — THIS FILE", current: true },
        { id: "eleven", label: "ElevenLabsTTS", sublabel: "query-param output_format", current: true },
        { id: "openai", label: "OpenAITTS", sublabel: "24→16 kHz downsample", current: true },
        { id: "azure", label: "AzureTTS", sublabel: "SSML + escaping", current: true },
        { id: "deepgram", label: "DeepgramTTS", sublabel: "raw PCM, container:none", current: true },
        { id: "sarvam", label: "SarvamTTS", sublabel: "the Indic heavyweight", chapterSlug: "sarvam-tts-complete" },
        { id: "cartesia", label: "CartesiaTTS", sublabel: "the Sonic heavyweight", chapterSlug: "cartesia-tts-complete" },
        { id: "pipeline", label: "pipeline", sublabel: "same interface for all", chapterSlug: "tts-pipeline-path" },
      ],
      edges: [
        { from: "factory", to: "eleven", label: "'elevenlabs'" },
        { from: "factory", to: "openai", label: "'openai'" },
        { from: "factory", to: "azure", label: "'azure'" },
        { from: "factory", to: "deepgram", label: "'deepgram'" },
        { from: "factory", to: "sarvam", label: "'sarvam'" },
        { from: "factory", to: "cartesia", label: "'cartesia'" },
        { from: "pipeline", to: "factory", label: "provider string" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why does the OpenAI TTS adapter call downsample24to16?",
          choices: [
            "To save bandwidth.",
            "OpenAI TTS returns 24 kHz PCM but the pipeline works in 16 kHz; without conversion the voice would sound sped-up and high-pitched.",
            "To add emotion.",
            "Because OpenAI requires it.",
          ],
          correctIndex: 1,
          explanation:
            "The pipeline is 16 kHz end to end. OpenAI only returns 24 kHz, so the adapter downsamples with the shared anti-aliasing converter from audio.ts.",
        },
        {
          prompt: "For ElevenLabs, where must output_format go, and why avoid Accept: audio/mpeg?",
          choices: [
            "In the JSON body; Accept doesn't matter.",
            "As a URL query parameter; Accept: audio/mpeg would override it and return MP3, which the pipeline decodes as raw PCM → garbage audio.",
            "In a header called output_format.",
            "It's optional.",
          ],
          correctIndex: 1,
          explanation:
            "ElevenLabs takes output_format as a query param. Setting Accept: audio/mpeg overrides it to MP3; the pipeline expects raw PCM, so it would play as noise.",
        },
        {
          prompt: "Which of these adapters needs NO WAV-header stripping and NO sample-rate conversion?",
          choices: [
            "OpenAI",
            "Sarvam",
            "Deepgram Aura (container:none, sample_rate=16000 → raw 16 kHz PCM straight through)",
            "Azure only after downsampling",
          ],
          correctIndex: 2,
          explanation:
            "Deepgram Aura's query params (encoding=linear16, sample_rate=16000, container=none) yield raw 16 kHz PCM with no header — the pipeline's exact format, no post-processing needed.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "`createTTSAdapter` is a single switch mapping a provider string to an adapter; only ElevenLabs, Cartesia, and Sarvam receive `speed`; unknown providers throw at construction.",
        "ElevenLabs: `output_format=pcm_16000` MUST be a URL query param and you must not set `Accept: audio/mpeg` (MP3 → garbage); speed clamps to [0.7, 1.2].",
        "OpenAI returns 24 kHz PCM and downsamples to 16 kHz via the shared `downsample24to16`; it's one-shot only (no streaming).",
        "Azure speaks SSML (XML) and escapes `<>&'\"` before embedding text; the `X-Microsoft-OutputFormat: raw-16khz-16bit-mono-pcm` header yields 16 kHz directly (no downsample).",
        "Deepgram Aura is the simplest: query-param config with `container: none` gives raw 16 kHz PCM straight through — no header stripping, no conversion — and it streams.",
        "All five expose the same `synthesize`/`synthesizeStream` interface, so every vendor quirk stays contained inside its adapter file.",
      ],
    },
  ],
};
