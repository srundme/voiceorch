import type { Chapter } from "../types";

export const sarvamTtsComplete: Chapter = {
  slug: "sarvam-tts-complete",
  moduleId: "d2",
  number: "18.2",
  title: "The Sarvam (Bulbul) TTS Adapter, End to End",
  summary:
    "Sarvam's Indic-language voice engine walked top to bottom: WebSocket-first with HTTP-stream and REST fallbacks, RIFF stripping, speaker resolution, config/text/flush protocol, warm-socket reuse, and parallel-prefetch handling.",
  estMinutes: 24,
  fileRef: "artifacts/api-server/src/orchestration/adapters/tts/sarvam.ts",
  prerequisites: ["tts-pipeline-path", "adapter-pattern"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Sarvam AI's **Bulbul** is the TTS voice for Indian languages — Tamil, Hindi, Telugu, Kannada, Marathi, and more. It's the voice most SnapServe production agents actually use, because it speaks Indic languages natively rather than through an accent.",
        "The adapter is the largest TTS file in the codebase (~700 lines) because Bulbul has **three delivery paths** with a clear preference order, a JSON WebSocket protocol with a config-first handshake, and a pile of real-world quirks (WAV headers that click, warm-socket reuse, parallel-prefetch contention). We'll walk it top to bottom.",
        "The three paths, in preference order: (1) a persistent **WebSocket** (`config` → `text` → `flush`), (2) an **HTTP streaming** POST as fallback, and (3) a one-shot **REST** POST for fillers and caching. This chapter covers all three.",
      ],
    },
    {
      kind: "concept",
      title: "Why a WAV/RIFF header matters",
      body: [
        "The pipeline expects **raw PCM** — bare 16-bit audio samples at 16 kHz, no header. But many TTS APIs wrap their audio in a **WAV/RIFF** container: 44+ bytes of metadata (`RIFF`, chunk sizes, sample rate) at the front.",
        "If those header bytes are fed into the pipeline as if they were audio samples, they play as a sharp **click or crackle** at the very start of every sentence. So the adapter must strip the RIFF header off every chunk before handing it over.",
        "This is trickier than slicing off 44 bytes: some WAV headers are non-canonical (extra chunks before `data`), so the adapter walks the RIFF chunk list to find the real `data` chunk.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/sarvam.ts",
      language: "typescript",
      intro:
        "The file opens with a protocol cheat-sheet — the hard-won rules for using Bulbul's WebSocket. This comment is documentation gold.",
      code: `/**
 * Sarvam AI — Text-to-Speech (Bulbul)
 *
 * Paths (in preference order for live calls):
 *   1. WebSocket  wss://api.sarvam.ai/text-to-speech/ws   (persistent; config → text → flush)
 *   2. HTTP stream POST /text-to-speech/stream            (fallback after WS retries)
 *   3. REST        POST /text-to-speech                    (fillers / cache)
 *
 * Best practices (docs):
 *   - Config message first after connect
 *   - Flush after text so the buffer finishes
 *   - Ping every ~30s (idle close ~1 min)
 *   - send_completion_event=true → wait for event_type=final
 *   - Keep the socket open across utterances; close only on barge-in
 *   - Chunk text <500 chars so barge-in discards less audio
 *   - Reconnect with backoff on 1006/1011; never blind-retry 4xxx
 */`,
      lines: [
        {
          lines: "4-7",
          label: "three paths, one preference order",
          explanation:
            "WebSocket is fastest (no per-sentence handshake) so it's tried first. HTTP stream is the fallback after WS retries are exhausted. Plain REST is only for cacheable fillers.",
        },
        {
          lines: "9-11",
          label: "the handshake rules",
          explanation:
            "Config MUST be the first message. Flush after text or the last buffered audio never comes. Ping every ~30s or the idle socket closes in ~1 minute. These are baked into the code below.",
        },
        {
          lines: "14",
          label: "chunk <500 chars",
          explanation:
            "Short text messages mean a barge-in throws away less already-generated audio — you don't pay to synthesize a paragraph the caller interrupted after two words.",
        },
        {
          lines: "15",
          label: "close-code policy",
          explanation:
            "1006/1011 are transient — reconnect with backoff. 4xxx is auth/quota — retrying is pointless and burns money, so never blind-retry. This policy is enforced by `SarvamWsFatalError` below.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/sarvam.ts",
      language: "typescript",
      intro:
        "The RIFF stripper. Every audio chunk — REST, HTTP-stream, or WebSocket — goes through this so no header bytes ever reach the pipeline.",
      code: `function stripRiffHeader(buf: Buffer): Buffer {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF") return buf;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = Math.min(buf.length, dataStart + size);
    if (id === "data") return buf.subarray(dataStart, dataEnd);
    offset = dataStart + size + (size % 2);
  }
  return buf.length > WAV_HEADER_BYTES ? buf.subarray(WAV_HEADER_BYTES) : buf;
}`,
      lines: [
        {
          lines: "2",
          label: "no RIFF? pass through",
          explanation:
            "If the buffer doesn't start with `RIFF`, it's already raw PCM (Sarvam's `linear16` responses have no header) — return it unchanged.",
        },
        {
          lines: "3-10",
          label: "walk the chunk list",
          explanation:
            "RIFF is a list of chunks: a 4-char id + a 4-byte size + payload. Loop through them until we find the `data` chunk, then return only its payload. Handles non-canonical headers that a blind 44-byte slice would get wrong (causing clicks).",
        },
        {
          lines: "12",
          label: "fallback slice",
          explanation:
            "If we never found a `data` chunk but the buffer is bigger than a canonical 44-byte header, slice those 44 bytes off as a last resort.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Speaker resolution — catalog names vs cloned voices vs stray UUIDs",
      body: [
        "Sarvam voices come in two kinds: built-in **catalog speakers** (named, like `ritu`, `anushka`, `rahul`) and **Creative Studio clones** (custom hyphenated ids). The adapter must accept both — but reject a Cartesia voice UUID that someone pasted into the wrong field.",
        "It also enforces model compatibility: v2-only speaker names are rejected on v3 and vice versa, falling back to a sensible default (`ritu` for v3, `anushka` for v2).",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/sarvam.ts",
      language: "typescript",
      intro:
        "`resolveSpeaker` picks the final speaker id, and `looksLikeUuid` guards against a pasted Cartesia id.",
      code: `function looksLikeUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function resolveSpeaker(voice: string | null, model: string): string {
  const fallback = DEFAULT_SPEAKER[model] ?? "ritu";
  if (!voice) return fallback;
  const trimmed = voice.trim();
  if (!trimmed || looksLikeUuid(trimmed)) return fallback;
  if (model === "bulbul:v2") return V2_SPEAKERS.has(trimmed) ? trimmed : fallback;
  // v3: reject known v2-only names; accept catalog speakers AND Creative Studio
  // cloned speaker ids (hyphenated custom ids are allowed — only UUIDs are rejected).
  if (V2_SPEAKERS.has(trimmed)) return fallback;
  return trimmed;
}`,
      lines: [
        {
          lines: "1-3",
          label: "UUID guard",
          explanation:
            "A Cartesia voice is a UUID like `2ee87190-8f84-...`. If someone pastes that into a Sarvam agent's voice field, Bulbul would reject it. This regex catches it early and falls back to the default speaker instead of failing the call.",
        },
        {
          lines: "9-10",
          label: "v2 strictness",
          explanation:
            "On `bulbul:v2`, only the seven known v2 speakers are allowed; anything else falls back. v2 doesn't know about v3 voices.",
        },
        {
          lines: "11-14",
          label: "v3 openness",
          explanation:
            "On v3, reject v2-only names but otherwise accept anything that isn't a UUID — this is how Creative Studio custom clones (hyphenated ids) are allowed through.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/sarvam.ts",
      language: "typescript",
      intro:
        "The constructor wires up model, language, speaker, and pace from a mix of direct args and a JSON `extraConfig` string (which the pipeline builds for Sarvam).",
      code: `    this.key = apiKey;
    this.model = (model && VALID_MODELS.has(model)) ? model : "bulbul:v3";

    let lang = language ?? null;
    if (extraConfig) {
      try {
        const cfg = JSON.parse(extraConfig) as {
          language?: string;
          model?: string;
          enable_preprocessing?: boolean;
        };
        if (!lang) lang = cfg.language ?? null;
        if (cfg.model && VALID_MODELS.has(cfg.model)) this.model = cfg.model;
        if (typeof cfg.enable_preprocessing === "boolean") {
          this.enablePreprocessing = cfg.enable_preprocessing;
        }
      } catch {
        // ignore malformed extraConfig
      }
    }
    this.langCode = (lang && SARVAM_LANG[lang]) ? SARVAM_LANG[lang]! : "en-IN";
    this.speaker = resolveSpeaker(voice, this.model);
    this.pace = (typeof speed === "number" && Number.isFinite(speed))
      ? Math.min(2, Math.max(0.5, speed))
      : null;`,
      lines: [
        {
          lines: "2",
          label: "model validation",
          explanation:
            "Only `bulbul:v3`, `bulbul:v3-beta`, `bulbul:v2` are accepted; anything else defaults to v3. Guards against a typo'd model reaching the API.",
        },
        {
          lines: "4-20",
          label: "extraConfig JSON",
          explanation:
            "The pipeline builds `extraConfig` as `{ language, enable_preprocessing }` for Sarvam (recall `sarvamIndicNumbers` from the pipeline). Parsing is wrapped in try/catch so a malformed string can't crash construction — it's silently ignored.",
        },
        {
          lines: "21",
          label: "language mapping",
          explanation:
            "`SARVAM_LANG` maps loose codes (`ta`, `en-US`, `or`) to Bulbul's exact target codes (`ta-IN`, `en-IN`, `od-IN`). Note Odia maps `or`→`od-IN`. Unknown → `en-IN`.",
        },
        {
          lines: "23-25",
          label: "pace = ttsSpeed",
          explanation:
            "The `speed` arg is the dashboard's TTS Playback Speed. Sarvam clamps it to Bulbul's `pace` range [0.5, 2] and stores `null` if it wasn't a finite number — `null` means 'don't send pace at all'.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/sarvam.ts",
      language: "typescript",
      intro:
        "`buildConfigPayload` is the FIRST WebSocket message. `applyPace` only sends `pace` when it meaningfully differs from 1.0. `setLanguage` shows why the warm socket is dropped on a language change.",
      code: `  setLanguage(lang: string): void {
    const next = SARVAM_LANG[lang] ?? SARVAM_LANG[lang.split("-")[0]!] ?? "en-IN";
    if (next === this.langCode) return;
    this.langCode = next;
    // Config on the warm socket is stale — next synth opens a fresh connection.
    this.dropWarmWs();
  }

  private applyPace(body: Record<string, unknown>): void {
    if (this.pace !== null && Math.abs(this.pace - 1) > 0.001) body["pace"] = this.pace;
  }

  private buildConfigPayload(): Record<string, unknown> {
    const data: Record<string, unknown> = {
      speaker: this.speaker,
      target_language_code: this.langCode,
      speech_sample_rate: "16000",
      output_audio_codec: "linear16",
      min_buffer_size: 100,
      max_chunk_length: 500,
    };
    this.applyPace(data);
    return data;
  }`,
      lines: [
        {
          lines: "1-7",
          label: "language change drops the socket",
          explanation:
            "A mid-call language switch (auto-detect) makes the warm socket's config stale — its `target_language_code` is now wrong. `dropWarmWs()` closes it so the next synthesis opens a fresh, correctly-configured connection.",
        },
        {
          lines: "9-11",
          label: "applyPace skips 1.0",
          explanation:
            "Only send `pace` when it's meaningfully off 1.0 (`> 0.001` difference). At normal speed we omit it entirely, keeping the payload clean and using Bulbul's native default rate.",
        },
        {
          lines: "16-20",
          label: "sample rate as a STRING",
          explanation:
            "`speech_sample_rate: \"16000\"` is a string, not a number — Sarvam's OpenAPI enum requires it. Output codec is `linear16` (raw PCM, no header). `max_chunk_length: 500` reduces mid-sentence prosody seams that sound like glitches.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/sarvam.ts",
      language: "typescript",
      intro:
        "Opening a configured socket. Note how the config message is sent immediately on `open`, and how close code 4xxx becomes a fatal error that will NOT be retried.",
      code: `      ws.once("open", () => {
        try {
          // Config MUST be the first message after connect.
          ws.send(JSON.stringify({ type: "config", data: this.buildConfigPayload() }));
        } catch (err) {
          settle(() => {
            try { ws.close(); } catch { /* ignore */ }
            reject(err instanceof Error ? err : new Error(String(err)));
          });
          return;
        }
        settle(() => resolve(ws));
      });

      ws.once("close", (code, reason) => {
        const reasonStr = reason?.toString?.() ?? "";
        settle(() => {
          if (code >= 4000 && code <= 4999) {
            reject(new SarvamWsFatalError(
              \`SarvamTTS: WS auth/quota close \${code}\${reasonStr ? \`: \${reasonStr}\` : ""}\`,
              code,
            ));
          } else {
            reject(new Error(\`SarvamTTS: WS closed during connect (\${code})\`));
          }
        });
      });`,
      lines: [
        {
          lines: "1-4",
          label: "config first, always",
          explanation:
            "The instant the socket opens, the config message goes out. Send any `text` before config and Bulbul rejects the stream. This ordering is non-negotiable.",
        },
        {
          lines: "12",
          label: "resolve only after config sent",
          explanation:
            "The connect promise resolves only once config is successfully sent — so callers get a socket that's already configured and ready for text.",
        },
        {
          lines: "17-22",
          label: "4xxx → SarvamWsFatalError",
          explanation:
            "Close codes 4000–4999 mean auth or quota problems. They're wrapped in `SarvamWsFatalError`, a distinct class the retry loop recognizes and refuses to retry — retrying a bad API key just wastes attempts.",
        },
      ],
    },
    {
      kind: "concept",
      title: "Warm socket reuse and the ping heartbeat",
      body: [
        "Opening a WebSocket costs a TCP + TLS + WS handshake (~30–80ms). Doing that per sentence would add latency to every turn. So Sarvam keeps ONE socket warm and reuses it across sentences and turns.",
        "But Bulbul closes an idle socket after ~1 minute. During a pause — the caller is thinking, the agent isn't speaking — no traffic flows. So a **ping** is sent every ~30s to keep it alive (`startWarmPing`).",
        "`warmup()` (called at session start by the pipeline) pre-opens this socket so even the greeting doesn't pay the handshake cost. `parkWarmWs` returns a socket to the warm pool after an utterance finishes.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/sarvam.ts",
      language: "typescript",
      intro:
        "The ping heartbeat and taking the warm socket. `takeWs` hands out the warm socket if it's open, otherwise opens a fresh one.",
      code: `  private startWarmPing(ws: WebSocket): void {
    if (this.warmPingTimer) clearInterval(this.warmPingTimer);
    this.warmPingTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        this.dropWarmWs();
        return;
      }
      try { ws.send(JSON.stringify({ type: "ping" })); } catch { this.dropWarmWs(); }
    }, WS_PING_INTERVAL_MS);
    this.warmPingTimer.unref?.();
  }

  private async takeWs(): Promise<WebSocket> {
    if (this.warmWs && this.warmWs.readyState === WebSocket.OPEN) {
      const ws = this.warmWs;
      if (this.warmPingTimer) {
        clearInterval(this.warmPingTimer);
        this.warmPingTimer = null;
      }
      this.warmWs = null;
      return ws;
    }
    return this.openConfiguredWs();
  }`,
      lines: [
        {
          lines: "3-9",
          label: "30s ping",
          explanation:
            "`WS_PING_INTERVAL_MS` is 30_000. Every 30s, send a `{ type: \"ping\" }`. If the socket isn't open or the send throws, drop the warm socket so the next synth opens fresh.",
        },
        {
          lines: "10",
          label: "unref the timer",
          explanation:
            "`unref()` lets Node exit even if this timer is pending — a background heartbeat should never keep the process alive on its own.",
        },
        {
          lines: "13-23",
          label: "take vs open",
          explanation:
            "`takeWs` grabs the warm socket (stopping its ping — it's now 'in use') or opens a fresh configured one. Taking it clears `warmWs` so a parallel prefetch can't grab the same socket.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/sarvam.ts",
      language: "typescript",
      intro:
        "`synthesizeStream` is the entry point the pipeline calls. It handles the parallel-prefetch case, WebSocket retries with backoff, and the HTTP-stream fallback.",
      code: `    if (this.wsInUse) {
      logger.info("SarvamTTS WS busy — parallel synth via HTTP stream");
      await this.synthesizeViaHttpStream(text, onChunk, signal);
      onDone(text.length);
      return;
    }

    this.wsInUse = true;
    try {
      let lastErr: unknown;
      for (let attempt = 0; attempt < WS_RETRY_MAX; attempt++) {
        if (signal?.aborted) throw abortError();
        try {
          await this.synthesizeViaWs(text, onChunk, signal);
          onDone(text.length);
          return;
        } catch (err) {
          if (isAbort(err)) throw err;
          lastErr = err;
          if (err instanceof SarvamWsFatalError) {
            logger.warn({ err }, "SarvamTTS WS fatal (auth/quota) — not retrying WS");
            break;
          }
          if (attempt + 1 < WS_RETRY_MAX) {
            const delay = retryDelayMs(attempt);
            logger.warn({ err, attempt, delay }, "SarvamTTS WS failed — reconnect backoff");
            await sleep(delay);
          }
        }
      }

      logger.warn({ err: lastErr }, "SarvamTTS WS exhausted — falling back to HTTP stream");
      await this.synthesizeViaHttpStream(text, onChunk, signal);
      onDone(text.length);
    } finally {
      this.wsInUse = false;
    }`,
      lines: [
        {
          lines: "1-6",
          label: "parallel prefetch → HTTP stream",
          explanation:
            "Because of N+1 prefetch, sentence N+1 may start synthesizing while sentence N still owns the WS. Two utterances fighting over one socket spiked firstByteMs to ~1s. So if `wsInUse`, sentence N+1 uses the HTTP stream instead of stealing the socket.",
        },
        {
          lines: "8",
          label: "claim the socket",
          explanation:
            "Set `wsInUse = true` so any concurrent prefetch takes the HTTP path. Released in the `finally` block no matter what.",
        },
        {
          lines: "19-22",
          label: "fatal → stop retrying",
          explanation:
            "A `SarvamWsFatalError` (4xxx auth/quota) breaks the retry loop immediately — retrying a bad key is pointless. Only transient failures get the backoff retries.",
        },
        {
          lines: "24-28",
          label: "exponential backoff",
          explanation:
            "`retryDelayMs(attempt)` grows the delay per attempt with jitter, capped at `WS_RETRY_MAX_MS`. After `WS_RETRY_MAX` (3) attempts, fall through to the HTTP stream fallback — the caller always gets audio if any path works.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/sarvam.ts",
      language: "typescript",
      intro:
        "Inside `synthesizeViaWs`, the message handler. This is where audio chunks, the `final` completion event, and the socket-parking happen.",
      code: `        if (msg.type === "audio") {
          const b64 = msg.data?.["audio"];
          if (typeof b64 === "string" && b64.length > 0) {
            // Each WS audio message can arrive WAV-wrapped — strip any RIFF
            // header or it plays as a click at sentence start.
            const pcm = pcmFromSarvamAudio(b64);
            if (pcm.length > 0) onChunk(pcm);
          }
          return;
        }

        if (msg.type === "event") {
          // send_completion_event=true → final marks end of this utterance.
          if (msg.data?.["event_type"] === "final") {
            settle(() => {
              this.parkWarmWs(ws); // keep connection for the next sentence
              resolve();
            });
          }
          return;
        }`,
      lines: [
        {
          lines: "1-9",
          label: "base64 audio → strip RIFF → onChunk",
          explanation:
            "Sarvam sends audio as base64 inside a JSON `audio` message. Decode it, strip any RIFF header (`pcmFromSarvamAudio`), and hand the raw PCM to the pipeline's `onChunk`. Skip the RIFF strip and you get a click at every sentence start.",
        },
        {
          lines: "12-19",
          label: "the final event",
          explanation:
            "Because the URL sets `send_completion_event=true`, Bulbul sends `{ type: \"event\", data: { event_type: \"final\" } }` when the utterance is fully synthesized. That's the signal to resolve — and to PARK the socket for reuse rather than closing it.",
        },
        {
          lines: "16",
          label: "parkWarmWs — reuse, don't close",
          explanation:
            "On `final`, the socket is parked back into the warm pool (ping restarted) instead of being torn down. The next sentence reuses it, skipping the handshake. It's closed only on barge-in or idle timeout.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/sarvam.ts",
      language: "typescript",
      intro:
        "Sending the text and the mandatory flush, plus the barge-in abort. Text is pre-split into ≤500-char parts so a barge-in wastes less audio.",
      code: `      const onAbort = () => {
        // Barge-in: close socket so server stops generating; next reply opens fresh.
        settle(() => {
          try { ws.close(1000, "barge-in"); } catch { /* ignore */ }
          reject(abortError());
        });
      };
      // ...
      try {
        for (const part of parts) {
          ws.send(JSON.stringify({ type: "text", data: { text: part } }));
        }
        // Flush so remaining buffer is processed even below min_buffer_size.
        ws.send(JSON.stringify({ type: "flush" }));
      } catch (err) {
        settle(() => reject(err instanceof Error ? err : new Error(String(err))));
      }`,
      lines: [
        {
          lines: "1-7",
          label: "barge-in closes the socket",
          explanation:
            "When the caller interrupts, the abort signal fires: close the socket with code 1000 (normal). Closing tells Bulbul to STOP generating — you don't keep paying for audio the caller interrupted. The next reply opens a fresh socket.",
        },
        {
          lines: "9-12",
          label: "text messages",
          explanation:
            "`parts` was pre-split to ≤500 chars (`MAX_WS_TEXT_CHARS`). Each is sent as a `{ type: \"text\", data: { text } }` message. Smaller chunks = less wasted audio on barge-in.",
        },
        {
          lines: "13-14",
          label: "the mandatory flush",
          explanation:
            "After all text, send `{ type: \"flush\" }`. Without it, the last buffered audio (below `min_buffer_size`) is never emitted and the sentence's tail goes silent — a classic 'why did the end get cut off' bug.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "The HTTP-stream RIFF header can span multiple reads",
      body: [
        "On the HTTP-stream fallback path, the WAV/RIFF header may be split across the first few network reads — you can't strip it from the first chunk alone. `httpStreamOne` buffers incoming bytes until it has at least 64 bytes, strips the header once, then passes everything after straight through.",
        "This is why `headBuf` exists: it accumulates until there's enough to safely identify and skip the header. A tiny stream that never reaches 64 bytes is flushed at the end.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/sarvam.ts",
      language: "typescript",
      intro:
        "The one-shot REST path (`synthesizeOne`) — used for fillers and caching. It's the simplest of the three: POST, check status, decode base64 audio.",
      code: `  private async synthesizeOne(text: string): Promise<Buffer> {
    const body: Record<string, unknown> = {
      inputs: [text],
      target_language_code: this.langCode,
      speaker: this.speaker,
      model: this.model,
      enable_preprocessing: this.enablePreprocessing,
      speech_sample_rate: "16000",
      output_audio_codec: "linear16",
    };
    this.applyPace(body);

    const resp = await fetch(\`\${BASE}/text-to-speech\`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(\`Sarvam TTS error \${resp.status}: \${err}\`);
    }

    const json = (await resp.json()) as { audios?: string[] };
    if (!json.audios?.[0]) throw new Error("Sarvam TTS: no audio in response");

    return pcmFromSarvamAudio(json.audios[0]);
  }`,
      lines: [
        {
          lines: "7",
          label: "enable_preprocessing",
          explanation:
            "This is `sarvamIndicNumbers` from the dashboard. When true, Bulbul expands digits to spoken Indic forms (`500` → `paanch sau`). Turn it off if you want raw English digit pronunciation embedded in Indic sentences.",
        },
        {
          lines: "23-24",
          label: "audio is base64 in `audios[0]`",
          explanation:
            "The REST response returns a JSON `audios` array; the first entry is base64 audio. Guard against an empty response.",
        },
        {
          lines: "26",
          label: "same RIFF strip",
          explanation:
            "`pcmFromSarvamAudio` decodes and strips RIFF — the same treatment as every other path. Consistency: no matter which of the three paths produced the bytes, the pipeline always gets clean raw PCM.",
        },
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "Sarvam is created by the TTS factory and driven by the pipeline's prefetch machinery. Click to explore.",
      nodes: [
        { id: "factory", label: "createTTSAdapter()", sublabel: "tts/index.ts", chapterSlug: "other-tts-adapters" },
        { id: "pipeline", label: "startSentenceSynthesis()", sublabel: "prefetch driver", chapterSlug: "tts-pipeline-path" },
        { id: "sarvam", label: "SarvamTTS", sublabel: "sarvam.ts — THIS FILE", current: true },
        { id: "ws", label: "WebSocket path", sublabel: "config→text→flush", current: true },
        { id: "http", label: "HTTP stream path", sublabel: "parallel prefetch fallback", current: true },
        { id: "rest", label: "REST path", sublabel: "fillers / cache", current: true },
        { id: "cartesia", label: "CartesiaTTS", sublabel: "the other big adapter", chapterSlug: "cartesia-tts-complete" },
      ],
      edges: [
        { from: "factory", to: "sarvam", label: "new SarvamTTS(...)" },
        { from: "pipeline", to: "sarvam", label: "synthesizeStream()" },
        { from: "sarvam", to: "ws", label: "preferred" },
        { from: "sarvam", to: "http", label: "wsInUse / WS exhausted" },
        { from: "sarvam", to: "rest", label: "synthesize()" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "During N+1 prefetch, sentence N still owns the warm WebSocket. What does sentence N+1 do?",
          choices: [
            "It waits for the socket to free up.",
            "It opens a second WebSocket.",
            "It synthesizes via the HTTP stream path instead, because two utterances contending for one WS spiked first-byte latency to ~1s.",
            "It fails.",
          ],
          correctIndex: 2,
          explanation:
            "`wsInUse` guards the socket. When busy, the parallel sentence takes the HTTP stream path. Contention on a single WS previously caused ~1s firstByteMs spikes.",
        },
        {
          prompt: "Why must every Sarvam audio chunk pass through stripRiffHeader?",
          choices: [
            "To compress it.",
            "Because a WAV/RIFF header fed into the pipeline as PCM plays as a click/crackle at the start of every sentence.",
            "To change the language.",
            "To add the flush marker.",
          ],
          correctIndex: 1,
          explanation:
            "Sarvam can return WAV-wrapped audio. The 44+ header bytes, if treated as samples, produce an audible click. Stripping is applied on the REST, HTTP-stream, and WebSocket paths alike.",
        },
        {
          prompt: "What happens when the WebSocket closes with code 4001 (auth/quota)?",
          choices: [
            "It reconnects with exponential backoff.",
            "It's wrapped in SarvamWsFatalError, which breaks the retry loop immediately — auth/quota errors are never blind-retried.",
            "It falls back to REST silently.",
            "It pings the server.",
          ],
          correctIndex: 1,
          explanation:
            "Codes 4000-4999 signal auth/quota problems. SarvamWsFatalError stops the retry loop so we don't waste attempts (or money) retrying a bad key. Transient codes (1006/1011) get the backoff retries.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Sarvam Bulbul has three paths in preference order: persistent WebSocket → HTTP stream fallback → one-shot REST for fillers.",
        "The WebSocket protocol is config-first, then text, then a MANDATORY flush; `send_completion_event=true` means wait for the `final` event.",
        "One warm socket is reused across sentences and turns (saving the handshake), kept alive by a 30s ping, pre-opened by `warmup()`, and dropped on language change or barge-in.",
        "N+1 prefetch contention is avoided by routing the parallel sentence to the HTTP stream when `wsInUse` is set.",
        "Every path strips the WAV/RIFF header (walking the chunk list for the `data` chunk) so no click reaches the pipeline; the HTTP header can span reads, so bytes are buffered to ≥64 before stripping.",
        "`enable_preprocessing` = `sarvamIndicNumbers` (Indic number expansion); `pace` = clamped `ttsSpeed`; `resolveSpeaker` accepts catalog + clone ids but rejects pasted Cartesia UUIDs; 4xxx closes are fatal and never retried.",
      ],
    },
  ],
};
