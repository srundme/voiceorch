import type { Chapter } from "../types";

export const otherSttAdapters: Chapter = {
  slug: "d1-other-stt-adapters",
  moduleId: "d1",
  number: "17.4",
  title: "The Other STT Adapters at a Glance",
  summary:
    "The distinctive parts of Deepgram, Cartesia, Google Speech, AssemblyAI, and Gemini — each solving one problem its own way.",
  estMinutes: 20,
  fileRef: "artifacts/api-server/src/orchestration/adapters/stt/deepgram.ts",
  prerequisites: ["d1-sarvam-stt-complete", "d1-azure-stt-complete"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Sarvam and Azure got full chapters because they carry the most call traffic and the most hard-won logic. But the stack ships five more STT adapters, each with one or two ideas worth knowing. This chapter shows the *distinctive* code of each — not a full walkthrough.",
        "A key split emerges: **Deepgram is the only other streaming adapter**; Cartesia, Google, AssemblyAI, and Gemini are all **batch** adapters (`transcribe()` only). Batch adapters are driven by the pipeline's own voice-activity detection — the pipeline buffers a chunk of speech, then hands the whole buffer over at once.",
      ],
    },
    {
      kind: "concept",
      title: "Streaming vs batch, one more time",
      body: [
        "A **streaming** adapter implements `transcribeStream()` and keeps a WebSocket open; the vendor pushes transcripts back as the caller speaks. Sarvam, Azure, and Deepgram do this.",
        "A **batch** adapter implements only `transcribe(audioBuffer)`: the pipeline decides when the caller stopped, then sends the whole utterance in one HTTP request and waits for the answer. Simpler, but higher latency and no live barge-in. Cartesia, Google, AssemblyAI, and Gemini are batch-only.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/deepgram.ts",
      language: "typescript",
      intro:
        "Deepgram's signature is its two endpointing modes. Both share one hard-coded lesson: value caps that, if exceeded, slam the WebSocket shut.",
      code: `    if (useSmartEndpointing) {
      const utteranceEndMs = Math.min(
        this.cfg.endpointingSilenceMs ?? this.cfg.endOfTurnTimeout,
        5000,
      );
      params.set("vad_events", "true");
      params.set("utterance_end_ms", String(utteranceEndMs));
      params.set("interim_results", "true");
    } else {
      // Standard silence-based endpointing — Deepgram caps at 2000 ms;
      // values above 2000 cause the WS to close immediately.
      const endpointing = Math.min(
        this.cfg.endpointingSilenceMs ?? this.cfg.endOfTurnTimeout,
        2000,
      );
      params.set("endpointing", String(endpointing));
    }`,
      lines: [
        {
          lines: "1-8",
          label: "smart endpointing (ML)",
          explanation:
            "In smart mode Deepgram uses `vad_events` — a neural network fires an `UtteranceEnd` event when it's confident the caller stopped. `utterance_end_ms` is capped at 5000. `interim_results` streams the live guesses we accumulate until that event.",
        },
        {
          lines: "10-16",
          label: "the 2000 ms cap",
          explanation:
            "In plain silence mode, `endpointing` is capped at 2000 ms because Deepgram silently rejects anything higher by closing the socket. A `Math.min` clamp turns a mystery hung call into predictable behaviour.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/deepgram.ts",
      language: "typescript",
      intro:
        "Deepgram's other trademark: the KeepAlive heartbeat and bare-language-code normalisation.",
      code: `const DEEPGRAM_FULL_LOCALES = new Set([
  "en", "en-US", "en-AU", "en-GB", "en-NZ", "en-IN", "en-IE",
  "es-419", "es-LATAM", "es-US", "fr-CA", "pt-BR", "pt-PT", "zh-CN", "zh-TW",
]);

function normaliseDeepgramLang(code: string | null): string | null {
  if (!code) return null;
  if (DEEPGRAM_FULL_LOCALES.has(code)) return code;
  const bare = code.split("-")[0];
  return bare ?? code;
}

// Deepgram closes idle connections after ~10 s of no audio.
const keepAliveInterval = setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "KeepAlive" }));
  }
}, 8_000);`,
      lines: [
        {
          lines: "1-4",
          label: "the full-locale whitelist",
          explanation:
            "Deepgram accepts regional English and a few others as full tags, but wants the bare ISO code for everything else (`hi`, not `hi-IN`).",
        },
        {
          lines: "6-11",
          label: "normalise or the socket closes",
          explanation:
            "If the code isn't whitelisted, strip to the bare form. Pass an unsupported BCP-47 tag like `ta-IN` and the streaming WebSocket closes instantly — a silent, confusing failure.",
        },
        {
          lines: "13-18",
          label: "the 8-second KeepAlive",
          explanation:
            "Deepgram hangs up after ~10 s of silence. During the agent's greeting no caller audio flows, so a `KeepAlive` JSON frame every 8 s keeps the pipe open. Without it, STT dies mid-call.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/cartesia.ts",
      language: "typescript",
      intro:
        "Cartesia is batch-only. Its distinctive bits: a pinned version header, bare language codes, and a family-coerced model.",
      code: `const CARTESIA_VERSION = "2026-03-01";

    this.model = model && model.startsWith("ink-whisper") ? model : "ink-whisper";

    // Cartesia takes ISO-639-1 base codes ("hi"), not BCP-47 ("hi-IN").
    const lang = this.cfg.language?.split("-")[0]?.toLowerCase();
    if (lang) formData.append("language", lang);

    const base = (process.env["CARTESIA_BASE_URL"] ?? "https://api-india.cartesia.ai").replace(/\\/+$/, "");
    const resp = await fetch(\`\${base}/stt\`, {
      method: "POST",
      headers: {
        "Authorization": \`Bearer \${this.key}\`,
        "Cartesia-Version": CARTESIA_VERSION,
      },
      body: formData,
    });`,
      lines: [
        {
          lines: "1",
          label: "pinned API version",
          explanation:
            "Cartesia requires a `Cartesia-Version` header pinned to a date. It's kept in sync with the TTS adapter's version so both halves of Cartesia speak the same API generation.",
        },
        {
          lines: "3",
          label: "model coerced to the ink-whisper family",
          explanation:
            "The batch endpoint only accepts `ink-whisper*`. Anything else (a legacy `whisper-1`, a streaming-only `ink-2`) is coerced to `ink-whisper` so a bad config can't 400 the request.",
        },
        {
          lines: "5-7",
          label: "bare language codes",
          explanation:
            "Like Deepgram, Cartesia wants ISO-639-1 (`hi`), so the adapter splits off the region. Streaming Cartesia is a separate WS protocol and is deliberately not implemented — this is a batch-only provider here.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/google-speech.ts",
      language: "typescript",
      intro:
        "Google Speech's signature feature: alternativeLanguageCodes — it auto-detects among several Indian languages in one request.",
      code: `    const primaryLang = this.cfg.language || "hi-IN";
    const altLangs = ["en-IN", "ta-IN", "te-IN", "mr-IN", "bn-IN", "gu-IN", "kn-IN", "ml-IN"].filter(
      (l) => l !== primaryLang,
    );

    body: JSON.stringify({
      config: {
        encoding: "LINEAR16",
        sampleRateHertz: sampleRate,
        languageCode: primaryLang,
        alternativeLanguageCodes: altLangs,
        model: this.model,
        useEnhanced: true,
      },
      audio: { content: base64Pcm },
    }),`,
      lines: [
        {
          lines: "1-4",
          label: "primary + alternatives",
          explanation:
            "Google lets you name one primary language plus a list of alternatives. It picks whichever fits best per utterance — real language identification, useful for mixed Indian calls.",
        },
        {
          lines: "10-13",
          label: "useEnhanced + telephony model",
          explanation:
            "`model` defaults to `telephony` (tuned for phone audio) and `useEnhanced: true` opts into Google's higher-accuracy models. Note the audio is sent as base64 in the JSON body — a batch request, not a stream.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/assemblyai.ts",
      language: "typescript",
      intro:
        "AssemblyAI is unusual: it's a THREE-step batch flow — upload, submit, then poll. This is the polling loop.",
      code: `    if (this.cfg.language) body.language_code = this.cfg.language;
    if (this.cfg.keyterms.length > 0) body.word_boost = this.cfg.keyterms;

    // Step 3: Poll for completion (max 30s)
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const pollResp = await fetch(\`https://api.assemblyai.com/v2/transcript/\${id}\`, {
        headers: { Authorization: this.key },
      });
      const result = (await pollResp.json()) as { status: string; text?: string; confidence?: number };
      if (result.status === "completed") {
        if (result.confidence !== undefined && result.confidence < this.cfg.confidenceThreshold) {
          return "";
        }
        return result.text?.trim() ?? "";
      }
      if (result.status === "error") throw new Error("AssemblyAI transcription failed");
    }`,
      lines: [
        {
          lines: "1-2",
          label: "word_boost = keyterms",
          explanation:
            "AssemblyAI biases recognition toward key terms via `word_boost` — its version of Azure's phrase list or Deepgram's keywords.",
        },
        {
          lines: "4-9",
          label: "poll once a second, up to 30 s",
          explanation:
            "After uploading the audio and submitting the job, the adapter polls the transcript endpoint every second. This makes AssemblyAI the highest-latency STT here — fine for offline use, poor for live turns.",
        },
        {
          lines: "11-15",
          label: "confidence gate",
          explanation:
            "Once completed, a below-threshold confidence returns an empty string rather than a shaky transcript. Note this is a hard gate — unlike Azure's floored soft gate.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/gemini.ts",
      language: "typescript",
      intro:
        "Gemini is the odd one out: it's an LLM used as STT. You transcribe by PROMPTING it to transcribe.",
      code: `    if (audioBuffer.length < 2400) return "";

    const prompt = this.cfg.language
      ? \`Transcribe the audio accurately in \${this.cfg.language}. Output ONLY the exact transcription text.\`
      : "Transcribe the audio accurately. Automatically detect spoken language (English, Hindi, Tamil, Telugu, Marathi, etc.). Output ONLY the exact transcription text.";

    body: JSON.stringify({
      contents: [{ role: "user", parts: [
        { inlineData: { mimeType: "audio/wav", data: base64Wav } },
        { text: prompt },
      ] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 500,
        thinkingConfig: geminiThinkingConfig(this.model),
      },
    }),`,
      lines: [
        {
          lines: "1",
          label: "minimum audio guard",
          explanation:
            "Under ~0.15 s of audio returns empty immediately — no point prompting an LLM with a click.",
        },
        {
          lines: "3-5",
          label: "the transcription IS a prompt",
          explanation:
            "There is no STT API here. The audio is attached inline and Gemini is *asked* to transcribe, told to output ONLY the text. Language is either forced or auto-detected in the prompt itself.",
        },
        {
          lines: "12-15",
          label: "low temperature, minimal thinking",
          explanation:
            "`temperature: 0.1` keeps it faithful, not creative. `thinkingConfig` forces minimal/no reasoning because in-call STT is latency-sensitive. Gemini shines as a high-precision fallback, not a primary streaming ear.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Five providers, five personalities",
      body: [
        "Deepgram: fast streaming, two endpointing modes, bare language codes, KeepAlive required. Cartesia: batch, pinned version header, ink-whisper family. Google: batch, multi-language auto-detect via alternatives. AssemblyAI: batch, three-step poll (slowest), word_boost. Gemini: an LLM prompted to transcribe, best as a precise fallback.",
        "All five hide behind the same `STTAdapter` interface, so the pipeline never knows or cares which one it's talking to. That is the adapter pattern doing its job.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro: "Streaming vs batch, and who owns end-of-turn.",
      nodes: [
        { id: "factory", label: "createSTTAdapter()", sublabel: "picks the vendor", chapterSlug: "adapter-pattern" },
        { id: "deepgram", label: "DeepgramSTT", sublabel: "streaming", current: true },
        { id: "cartesia", label: "CartesiaSTT", sublabel: "batch", current: true },
        { id: "google", label: "GoogleSpeechSTT", sublabel: "batch, multi-lang", current: true },
        { id: "assembly", label: "AssemblyAISTT", sublabel: "batch, poll", current: true },
        { id: "gemini", label: "GeminiSTT", sublabel: "LLM-as-STT", current: true },
        { id: "pipeline", label: "pipeline VAD", sublabel: "drives batch adapters", chapterSlug: "d1-stt-pipeline-path" },
      ],
      edges: [
        { from: "factory", to: "deepgram", label: "creates" },
        { from: "factory", to: "cartesia", label: "creates" },
        { from: "factory", to: "google", label: "creates" },
        { from: "factory", to: "assembly", label: "creates" },
        { from: "factory", to: "gemini", label: "creates" },
        { from: "pipeline", to: "cartesia", label: "transcribe(buffer)" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Which of these adapters is a streaming adapter (implements transcribeStream)?",
          choices: [
            "AssemblyAI",
            "Gemini",
            "Deepgram",
            "Cartesia",
          ],
          correctIndex: 2,
          explanation:
            "Only Deepgram (alongside Sarvam and Azure) streams. Cartesia, Google, AssemblyAI, and Gemini are batch-only and are driven by the pipeline's own VAD.",
        },
        {
          prompt: "Why is a `Math.min(..., 2000)` clamp applied to Deepgram's `endpointing` value?",
          choices: [
            "To save money on longer transcripts.",
            "Deepgram silently rejects endpointing values above 2000 ms by closing the WebSocket, so the clamp prevents a hung call.",
            "2000 ms is the maximum call length.",
            "It's the confidence threshold.",
          ],
          correctIndex: 1,
          explanation:
            "The comment is explicit: values above 2000 cause the WS to close immediately. Clamping turns a mysterious dead connection into predictable behaviour.",
        },
        {
          prompt: "How does the Gemini adapter actually produce a transcript?",
          choices: [
            "It opens a WebSocket to a speech endpoint.",
            "It uploads audio and polls a transcript job.",
            "It attaches the audio inline and PROMPTS the Gemini LLM to transcribe, asking for only the text.",
            "It uses Google Speech under the hood.",
          ],
          correctIndex: 2,
          explanation:
            "Gemini is an LLM used as STT: the audio is inlined and the model is instructed via a prompt to output only the transcription. Low temperature and minimal thinking keep it fast and faithful.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Deepgram is streaming with two endpointing modes (smart VAD vs silence), needs bare language codes, an 8 s KeepAlive, and a 2000 ms endpointing cap.",
        "Cartesia is batch-only: pinned `Cartesia-Version` header, ISO-639-1 codes, model coerced to the ink-whisper family.",
        "Google Speech is batch with `alternativeLanguageCodes` for real multi-language auto-detection, plus the telephony model and useEnhanced.",
        "AssemblyAI is a three-step batch flow (upload → submit → poll every 1 s, max 30 s) with `word_boost` for key terms — the highest-latency option.",
        "Gemini is an LLM prompted to transcribe, tuned with low temperature and minimal thinking; best as a precise fallback, not a streaming primary.",
        "All five share the same STTAdapter interface, so the pipeline is provider-agnostic.",
      ],
    },
  ],
};
