import type { Chapter } from "../types";

export const sarvamDeepDive: Chapter = {
  slug: "sarvam-deep-dive",
  moduleId: "m13",
  number: "14.2",
  title: "Sarvam: STT, TTS, and LLM for Indian Languages",
  summary:
    "A practical guide to Sarvam's three APIs — saarika STT, bulbul TTS, and the chat completions LLM — including the version quirks, streaming limitations, and WebSocket protocol details.",
  estMinutes: 16,
  fileRef: "artifacts/api-server/src/orchestration",
  prerequisites: ["stt-adapters", "tts-adapters", "llm-adapters", "language-detection"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "Why Sarvam?",
      paragraphs: [
        "Sarvam AI is an Indian AI company that has trained speech and language models specifically on Indian languages: Hindi, Tamil, Telugu, Kannada, Bengali, Marathi, Gujarati, Odia, Punjabi, and Malayalam. For SnapServe deployments targeting Indian callers, Sarvam provides significantly better transcription accuracy and more natural TTS voices than general-purpose English-centric providers.",
        "SnapServe integrates all three Sarvam APIs: **saarika** for STT, **bulbul** for TTS, and **sarvam-m1** for LLM. Each has its own endpoint, authentication pattern, and set of version-specific quirks that differ substantially from the API documentation.",
        "The key rule when working with Sarvam APIs: always test against a specific model version, because voice IDs, model names, and streaming behavior change between versions without deprecation notices.",
      ],
    },
    {
      kind: "concept",
      title: "Sarvam STT: saarika models",
      body: [
        "The valid streaming STT models are `saarika:v2.5` and `saaras:v3`. Earlier versions (`saarika:v1`, `saarika:v2`) are no longer available on the streaming endpoint.",
        "Audio must be wrapped in a JSON `AudioContent` object: `{ data: base64String, encoding: 'audio/wav', sample_rate: 8000 }`. Unlike Deepgram (which accepts raw binary frames), Sarvam's streaming endpoint expects JSON messages with base64-encoded WAV data.",
        "The WAV wrapper must include a valid RIFF header — Sarvam rejects raw PCM bytes even if `encoding: 'audio/wav'` is specified. SnapServe wraps each audio chunk with `wrapInWav(chunk, sampleRate)` before base64-encoding.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/stt/sarvam.ts",
      language: "typescript",
      intro: "Sending an audio frame to the Sarvam STT WebSocket — WAV-wrap then base64-encode.",
      code: `function sendAudioChunk(ws: WebSocket, pcm: Buffer, sampleRate: number): void {
  // Sarvam requires WAV-wrapped audio, not raw PCM
  const wav = wrapInWav(pcm, sampleRate);
  const b64 = wav.toString("base64");

  ws.send(JSON.stringify({
    audio_content: {
      data:        b64,
      encoding:    "audio/wav",
      sample_rate: sampleRate,
    },
  }));
}

function wrapInWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.allocUnsafe(44);
  const dataLen = pcm.length;
  const fileLen = dataLen + 36;
  // RIFF header
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(fileLen, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);      // PCM chunk size
  header.writeUInt16LE(1,  20);      // PCM format
  header.writeUInt16LE(1,  22);      // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2,  32);      // block align
  header.writeUInt16LE(16, 34);      // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, pcm]);
}`,
      lines: [
        {
          lines: "3-4",
          label: "WAV wrap required",
          explanation:
            "Sarvam rejects raw PCM. The 44-byte RIFF/WAV header tells the decoder the sample rate, bit depth, and channel count. Without it, Sarvam either errors or produces garbage transcripts.",
        },
        {
          lines: "6-13",
          label: "JSON message structure",
          explanation:
            "The field is `audio_content` (snake_case). The `encoding` must be `'audio/wav'` — not `'pcm'` or `'LINEAR16'`. `sample_rate` must match the actual audio sample rate (8000 for telephony, 16000 for browser).",
        },
      ],
    },
    {
      kind: "concept",
      title: "Sarvam TTS: bulbul versions and speaker sets",
      body: [
        "`bulbul:v1` no longer exists on the Sarvam API. Requests to `bulbul:v1` return 404. The current versions are `bulbul:v2` (7 voices) and `bulbul:v3` (38 voices). Speaker IDs are NOT interchangeable between versions — a voice ID valid for `bulbul:v2` may not exist in `bulbul:v3` or may map to a completely different voice.",
        "The streaming endpoint (`/v1/text-to-speech/streaming`) also returns 404 — Sarvam TTS is batch-only. SnapServe calls the standard endpoint (`/v1/text-to-speech`), gets back a complete audio buffer, and streams it in chunks to the caller. This means the first TTS chunk arrives slightly later than streaming providers (Cartesia, ElevenLabs), but the quality is significantly better for Indian languages.",
        "The API returns audio in the format specified by `target_sample_rate` and `speech_sample_rate`. For telephony (8 kHz), set both to `8000`. The response is a JSON object with a `audios` array — each element is a base64-encoded WAV string. Concatenate all elements for the full response.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/tts/sarvam.ts",
      language: "typescript",
      intro: "Calling the Sarvam TTS API and decoding the response.",
      code: `async function synthesizeSarvam(
  text:   string,
  config: SarvamTtsConfig,
): Promise<Buffer> {
  const body = {
    inputs:              [text],
    target_sample_rate:  config.sampleRate ?? 8000,
    speech_sample_rate:  config.sampleRate ?? 8000,
    speaker:             config.voiceId,
    model:               config.model ?? "bulbul:v2",
    enable_preprocessing: true,
  };

  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": config.apiKey,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json() as { audios: string[] };

  // Decode base64 WAV strings and concatenate
  const chunks = json.audios.map(b64 => Buffer.from(b64, "base64"));
  return Buffer.concat(chunks);
}`,
      lines: [
        {
          lines: "6-7",
          label: "target_sample_rate and speech_sample_rate",
          explanation:
            "Both must be set to the same value. `target_sample_rate` controls the output format; `speech_sample_rate` controls the synthesis rate. Setting only one and not the other results in resampling artifacts.",
        },
        {
          lines: "9",
          label: "model default: bulbul:v2",
          explanation:
            "Default to `bulbul:v2` rather than `bulbul:v3` because v2 has a well-documented, stable speaker set. v3 speakers are still being added; the list changes between API releases. Always test your chosen speaker ID against the model version you specify.",
        },
        {
          lines: "24-25",
          label: "audios array",
          explanation:
            "The response is `{ audios: string[] }`. Each element is a base64-encoded WAV. For short texts there is typically one element; for longer texts Sarvam may split into multiple. Concatenate all before returning.",
        },
      ],
    },
    {
      kind: "concept",
      title: "Sarvam LLM: sarvam-m1 quirks",
      body: [
        "Sarvam's LLM API is OpenAI-compatible — it accepts the same request shape as `POST /v1/chat/completions`. However, there are two key quirks.",
        "First, **tool calls in streaming mode**: the Sarvam streaming SSE never emits `delta.tool_calls` in the stream chunks. If your agent uses tools (calendar, CRM, schedule_callback), you MUST use `stream: false` for tool-capable turns. The non-streaming response has `message.tool_calls` correctly populated. For non-tool turns (pure conversation), streaming works correctly.",
        "Second, **thinking mode**: Sarvam's sarvam-m1 model supports chain-of-thought reasoning but it defaults to OFF (`reasoning_effort: null`). Setting `reasoning_effort: 'high'` dramatically improves quality for complex reasoning tasks but adds 1–2 seconds of latency — acceptable for async tasks (summaries, fact extraction) but not for real-time conversation turns.",
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "Tool calls: use stream: false",
      body: [
        "If your agent has tools configured and you use Sarvam as the LLM provider, the pipeline must set `stream: false` when tools are available (when the conversation could elicit a tool call). The streaming SSE endpoint silently drops `tool_calls` — the model calls the tool internally but doesn't surface it in the stream. The non-streaming response includes them correctly in `response.choices[0].message.tool_calls`.",
        "SnapServe's Sarvam LLM adapter handles this automatically: if the request includes `tools` and `tool_choice != 'none'`, it forces `stream: false` and processes the response synchronously.",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "A Sarvam TTS request with `model: 'bulbul:v1'` returns 404. Why?",
          choices: [
            "The API key is wrong — v1 uses a different key format",
            "bulbul:v1 no longer exists on the Sarvam API — use bulbul:v2 or bulbul:v3",
            "v1 requires a different endpoint path",
            "v1 is only available in India-region API keys",
          ],
          correctIndex: 1,
          explanation:
            "`bulbul:v1` has been retired. All requests to it return 404 regardless of key, endpoint, or region. Upgrade to `bulbul:v2` (7 stable voices) or `bulbul:v3` (38 voices, but speaker list is still evolving).",
        },
        {
          prompt: "Your Sarvam LLM agent has a `schedule_callback` tool. The caller says 'call me back in 5 minutes'. Why might the tool never fire?",
          choices: [
            "Sarvam LLM doesn't support tools — use OpenAI instead",
            "The streaming endpoint silently drops tool_calls — you must use stream: false for tool turns",
            "The tool payload exceeds Sarvam's 4096-token context limit",
            "Sarvam requires tools to be in Hindi to work correctly",
          ],
          correctIndex: 1,
          explanation:
            "Sarvam's streaming SSE drops `delta.tool_calls`. The model internally calls the tool, but the stream doesn't surface it. The SnapServe Sarvam adapter forces `stream: false` when tools are present — but if you build a custom integration without this guard, tool calls will silently disappear.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Valid Sarvam STT streaming models: `saarika:v2.5` and `saaras:v3` — earlier versions retired",
        "STT audio must be WAV-wrapped and base64-encoded JSON — raw PCM rejected",
        "`bulbul:v1` is gone; v2 has 7 voices, v3 has 38 — speaker IDs are NOT cross-version",
        "TTS streaming endpoint returns 404 — always use batch endpoint",
        "Sarvam LLM streaming drops tool_calls — use `stream: false` for tool-capable turns",
        "`reasoning_effort: 'high'` improves quality but adds 1-2s latency — use only for async tasks",
      ],
    },
  ],
};
