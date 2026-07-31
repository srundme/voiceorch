import type { Chapter } from "../types";

export const cartesiaTtsComplete: Chapter = {
  slug: "cartesia-tts-complete",
  moduleId: "d2",
  number: "18.3",
  title: "The Cartesia (Sonic) TTS Adapter, End to End",
  summary:
    "Cartesia's Sonic engine walked top to bottom: one persistent WebSocket per call, generation_config speed/emotion, per-turn context_id with manual flush and flush_done, and the per-sentence retry-without-controls fallback that keeps one bad emotion from ending a call.",
  estMinutes: 24,
  fileRef: "artifacts/api-server/src/orchestration/adapters/tts/cartesia.ts",
  prerequisites: ["tts-pipeline-path", "sarvam-tts-complete"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Cartesia's **Sonic** is the fast, expressive English (and multilingual) voice. Its adapter is the second-largest TTS file and has two features the others don't: **emotion control** (a caller-facing agent can sound happy, apologetic, curious) and **per-turn prosody continuity** (all sentences in one reply flow together instead of sounding like separate clips glued end to end).",
        "Both features run over ONE persistent WebSocket per call. The key idea is the **context**: each unit of synthesis carries a `context_id`. Single sentences get a throwaway context; a whole LLM turn can share one context so Sonic keeps the intonation flowing across sentence boundaries, using a **manual flush** to mark each sentence's audio boundary.",
        "The most important robustness feature is the **retry-without-controls fallback**: if Cartesia rejects a sentence's emotion or voice controls, the adapter retries that one sentence with the controls stripped — instead of failing and killing the call. We'll walk the whole file, ending there.",
      ],
    },
    {
      kind: "concept",
      title: "context_id, continue, and flush",
      body: [
        "A **context_id** is Cartesia's handle for a synthesis stream. Send a transcript with a context_id and audio comes back tagged with that same id, so the adapter can route chunks to the right callback even when several are in flight (prefetch).",
        "**continue: true** tells Sonic 'more text for this context is coming' — keep the prosody state warm. **continue: false** finalizes it. A single sentence uses `continue: false` (self-contained). A turn context sends each sentence with `continue: true` and finalizes once at the end.",
        "**flush** is a message that says 'draw a boundary here — the audio up to this point is one discrete unit.' Each flush increments a **flush_id**. The adapter mirrors that counter client-side so it can match returned chunks (tagged with `flush_id`) to the right pending sentence. Cartesia acks a completed flush with a **flush_done** message.",
      ],
    },
    {
      kind: "analogy",
      title: "One phone call vs redialing per sentence",
      body: [
        "The other adapters (mostly) place a fresh 'call' to the TTS API per sentence. Cartesia keeps ONE call open for the whole conversation — no redial cost per sentence.",
        "Within that call, a turn context is like reading a paragraph aloud in one breath: the reader (Sonic) keeps the tone flowing across sentences. The manual **flush** is the reader briefly pausing so you can note 'that was sentence one' — the flow continues, but you got a clean marker (`flush_id`) for where each sentence ended.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/cartesia.ts",
      language: "typescript",
      intro:
        "The file header states the architecture: WS primary, REST fallback, and the crucial `max_buffer_delay_ms: 0` and per-context muxing.",
      code: `/**
 * Cartesia — Sonic TTS
 *
 * Primary path: WebSocket (\`/tts/websockets\`)
 *   - One persistent WS connection per call (lazy-opened on first sentence).
 *   - No per-sentence TCP/TLS handshake → saves ~30–80ms per sentence.
 *   - max_buffer_delay_ms: 0 → Cartesia synthesises immediately, no server-side batching.
 *   - Each sentence gets its own context_id so concurrent prefetch sentences are muxed safely.
 *
 * Fallback: REST (\`/tts/bytes\`) — used if WS open fails or errors mid-call.
 */`,
      lines: [
        {
          lines: "5-6",
          label: "one WS per call",
          explanation:
            "Lazy-opened on the first sentence (or pre-warmed via `warmup()`). Reusing it saves the ~30–80ms handshake on every subsequent sentence.",
        },
        {
          lines: "7",
          label: "max_buffer_delay_ms: 0",
          explanation:
            "Tells Sonic to synthesize immediately with no server-side batching delay — lowest possible first-byte latency, at the cost of slightly smaller audio chunks.",
        },
        {
          lines: "8",
          label: "context muxing",
          explanation:
            "Because prefetch means several sentences can be in flight at once over the SAME socket, each carries its own context_id. Returned chunks are routed by context_id so nobody's audio gets crossed.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/cartesia.ts",
      language: "typescript",
      intro:
        "Emotion handling starts with normalization. Cartesia's spec accepts ONE emotion enum; the codebase's older callers passed arrays of `family:level` tags, so `normalizeEmotion` bridges both shapes.",
      code: `function normalizeEmotion(emotions?: string[]): string | undefined {
  const first = emotions?.[0]?.trim().toLowerCase();
  if (!first) return undefined;
  const base = first.split(":")[0]!.trim();
  if (CARTESIA_EMOTIONS.has(base)) return base;
  const mapped = LEGACY_EMOTION_MAP[base];
  return mapped && CARTESIA_EMOTIONS.has(mapped) ? mapped : undefined;
}

function isInvalidVoiceControlsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /invalid voice controls|invalid emotion|generation_config/i.test(msg);
}`,
      lines: [
        {
          lines: "3-4",
          label: "take the first, drop the level",
          explanation:
            "Only the first emotion is used, lowercased. `family:level` (e.g. `positivity:high`) is split on `:` — only the family survives, because the new spec has no levels.",
        },
        {
          lines: "5-7",
          label: "enum check + legacy map",
          explanation:
            "If the base is a current enum (`happy`, `angry`, ...), pass it through. Otherwise map legacy names (`positivity`→`happy`, `sadness`→`sad`). Unknown emotions return `undefined` and are simply dropped.",
        },
        {
          lines: "10-13",
          label: "isInvalidVoiceControlsError",
          explanation:
            "A regex that recognizes the family of 400 errors Cartesia throws when it dislikes an emotion or generation_config value (e.g. after deprecating an emotion level). This is the trigger for the retry-without-controls fallback we'll reach at the end.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/cartesia.ts",
      language: "typescript",
      intro:
        "The constructor clamps speed to Cartesia's documented range and picks a valid model. Note the default voice fallback and the speed range.",
      code: `    this.key = apiKey;
    // Treat null, undefined, and empty string the same — fall back to Arushi.
    this.voiceId = (voice && voice.trim()) ? voice : "2ee87190-8f84-4925-97da-e52547f9462c";
    // generation_config.speed documented range is [0.6, 1.5] — out-of-range
    // values are rejected, so clamp instead of forwarding raw agent config.
    this.speed = (speed != null && Number.isFinite(speed) && speed !== 1)
      ? Math.min(1.5, Math.max(0.6, speed))
      : null;
    const VALID = new Set([
      "sonic-3.5", "sonic-3.5-2026-05-04", "sonic-latest",
      // ... more model ids ...
    ]);
    this.modelId = model && VALID.has(model) ? model : "sonic-3.5";
    this.language = language ? language.split("-")[0] : null;`,
      lines: [
        {
          lines: "3",
          label: "default voice",
          explanation:
            "A missing/blank voice falls back to a known-good Cartesia voice UUID (Arushi). This is the exact UUID the Sarvam adapter's `looksLikeUuid` guard is designed to reject if pasted into a Sarvam field.",
        },
        {
          lines: "6-8",
          label: "speed clamp to [0.6, 1.5]",
          explanation:
            "The dashboard's TTS Playback Speed (`ttsSpeed`) is clamped to Cartesia's documented `generation_config.speed` range. Out-of-range values are rejected by the API, so clamping avoids a needless 400. Exactly 1.0 → `null` (omit it).",
        },
        {
          lines: "14",
          label: "language is the base code",
          explanation:
            "`hi-IN` → `hi`. Cartesia wants the bare language code, so the region suffix is stripped. `setLanguage` does the same on a mid-call switch.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/cartesia.ts",
      language: "typescript",
      intro:
        "`buildGenerationConfig` assembles the top-level object that carries speed and emotion. This is the 2026-03-01 spec — the old `voice.__experimental_controls` is gone.",
      code: `  private buildGenerationConfig(emotions?: string[]): Record<string, unknown> | undefined {
    const gc: Record<string, unknown> = {};
    if (this.speed != null) gc.speed = this.speed;
    const emotion = normalizeEmotion(emotions);
    if (emotion) {
      gc.emotion = emotion;
      logger.info({ evt: "cartesia_emotion_controls", emotion }, "Injecting emotion into Cartesia generation_config");
    }
    return Object.keys(gc).length > 0 ? gc : undefined;
  }`,
      lines: [
        {
          lines: "3",
          label: "speed",
          explanation:
            "Only added when non-null (i.e. not the default 1.0). This is the clamped `ttsSpeed`.",
        },
        {
          lines: "4-8",
          label: "single emotion enum",
          explanation:
            "The normalized emotion (one enum string, not an array) is added and logged. The `cartesia_emotion_controls` log line is how you confirm an emotion actually reached Sonic when auditing a call.",
        },
        {
          lines: "9",
          label: "undefined when empty",
          explanation:
            "If neither speed nor emotion applies, return `undefined` so the caller omits `generation_config` entirely — a clean payload with no empty objects.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/cartesia.ts",
      language: "typescript",
      intro:
        "The single WebSocket message handler. It routes by context_id AND flush_id — the flush-tracked path (turn contexts) is checked before the per-sentence path.",
      code: `    const contextId = msg["context_id"] as string | undefined;
    if (!contextId) return;

    const type = msg["type"] as string | undefined;
    const flushId = msg["flush_id"] as number | undefined;

    // Route to flush-tracked pending (turn-level contexts using manual flushing).
    if (flushId != null) {
      const key = \`\${contextId}:\${flushId}\`;
      const flushCtx = this.flushPending.get(key);
      if (flushCtx) {
        if (type === "chunk") {
          const b64 = msg["data"] as string | undefined;
          if (b64) flushCtx.onChunk(Buffer.from(b64, "base64"));
        } else if (type === "done" || type === "flush_done") {
          // "flush_done" is the documented per-flush ack; "done" kept for
          // compatibility with servers that send per-flush dones.
          this.flushPending.delete(key);
          flushCtx.resolve();
        } else if (type === "error") {
          this.flushPending.delete(key);
          flushCtx.reject(new Error(\`Cartesia WS turn error: \${String(msg["error"] ?? "unknown")}\`));
        }
        return;
      }
    }`,
      lines: [
        {
          lines: "1-2",
          label: "context_id required",
          explanation:
            "Every routable message has a context_id. Without one there's nothing to route to, so bail. Malformed JSON was already dropped above.",
        },
        {
          lines: "8-10",
          label: "the flush key",
          explanation:
            "For turn contexts, pending sentences are stored under `contextId:flushId`. The `flush_id` on the message picks exactly which sentence's callbacks to fire — this is how one shared context stays sorted into per-sentence streams.",
        },
        {
          lines: "12-14",
          label: "chunk → onChunk",
          explanation:
            "A `chunk` message carries base64 PCM in `data`. Decode and hand to that sentence's `onChunk`. (The pipeline buffers these into the job's pcmQueue.)",
        },
        {
          lines: "14-18",
          label: "flush_done resolves the sentence",
          explanation:
            "`flush_done` is the documented per-flush completion ack. When it arrives, delete the pending entry and resolve — this sentence is fully synthesized. `done` is accepted too, for servers that send a plain done per flush.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/cartesia.ts",
      language: "typescript",
      intro:
        "The per-sentence (no flushing) routing — used for single sentences with a throwaway context_id. This is the second half of `handleWsMessage`.",
      code: `    // Route to per-sentence pending (single-sentence contexts, no flushing).
    const ctx = this.pending.get(contextId);
    if (!ctx) return;

    if (type === "chunk") {
      const b64 = msg["data"] as string | undefined;
      if (b64) ctx.onChunk(Buffer.from(b64, "base64"));
    } else if (type === "done") {
      this.pending.delete(contextId);
      ctx.resolve();
    } else if (type === "error") {
      this.pending.delete(contextId);
      ctx.reject(new Error(\`Cartesia WS synthesis error: \${String(msg["error"] ?? "unknown")}\`));
    }`,
      lines: [
        {
          lines: "2-3",
          label: "per-context pending map",
          explanation:
            "Single-sentence syntheses register in `this.pending` keyed by their unique context_id. If there's no entry (stale/late message), ignore it.",
        },
        {
          lines: "5-10",
          label: "chunk then done",
          explanation:
            "Same shape as the flush path but without flush_id: chunks stream, then a single `done` resolves the sentence and removes it from the map.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/cartesia.ts",
      language: "typescript",
      intro:
        "`synthesizeViaWsInContext` is the turn-context synthesis. It increments the client-side flush counter, registers a pending entry, then sends a transcript (continue:true) followed by a flush.",
      code: `    const flushId = (this.turnFlushCounters.get(turnContextId) ?? 0) + 1;
    this.turnFlushCounters.set(turnContextId, flushId);
    const pendingKey = \`\${turnContextId}:\${flushId}\`;

    return new Promise<void>((resolve, reject) => {
      // ... abort wiring omitted ...
      this.flushPending.set(pendingKey, {
        onChunk,
        resolve: () => cleanup(() => { onDone(safeText.length); resolve(); }),
        reject: (err) => cleanup(() => reject(err)),
      });

      const transcriptMsg: Record<string, unknown> = {
        context_id: turnContextId,
        model_id: this.modelId,
        transcript: safeText,
        voice: this.buildVoice(),
        output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 16000 },
        continue: true,
        max_buffer_delay_ms: 0,
      };
      const gcCtx = this.buildGenerationConfig(emotions);
      if (gcCtx) transcriptMsg.generation_config = gcCtx;
      if (this.language) transcriptMsg.language = this.language;

      const flushMsg: Record<string, unknown> = {
        context_id: turnContextId,
        transcript: "",
        continue: true,
        flush: true,
      };

      try {
        ws.send(JSON.stringify(transcriptMsg));
        ws.send(JSON.stringify(flushMsg));
      } catch (err) {
        cleanup(() => reject(err));
      }
    });`,
      lines: [
        {
          lines: "1-3",
          label: "mirror the server's flush counter",
          explanation:
            "The server increments flush_id on each flush. We keep an identical client-side counter per turn context so we register the pending entry under the SAME key the response chunks will carry. Off-by-one here = chunks routed to the wrong sentence.",
        },
        {
          lines: "7-11",
          label: "register before sending",
          explanation:
            "The pending entry MUST be in the map before we send, because chunks can arrive immediately. On resolve it calls `onDone` then resolves; on reject it cleans up.",
        },
        {
          lines: "13-24",
          label: "transcript with continue:true",
          explanation:
            "The sentence's text is sent with `continue: true` — Sonic keeps the prosody state warm for the next sentence. `generation_config` (speed/emotion) and `language` are attached only if present. Output is raw pcm_s16le at 16kHz.",
        },
        {
          lines: "26-35",
          label: "the manual flush",
          explanation:
            "An empty transcript with `flush: true` draws the boundary. This makes THIS sentence's audio a discrete stream tagged with our flush_id, preserving the per-sentence drainSentenceJob architecture even though prosody flows across the whole turn.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/cartesia.ts",
      language: "typescript",
      intro:
        "`finalizeTurnContext` closes out the turn once all sentences are dispatched — the pipeline calls this at the end of a turn (`finalizeTurnCtx`).",
      code: `  finalizeTurnContext(turnContextId: string): void {
    this.turnFlushCounters.delete(turnContextId);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({
          context_id: turnContextId,
          transcript: "",
          continue: false,
        }));
      } catch { /* WS closing, fine */ }
    }
  }`,
      lines: [
        {
          lines: "2",
          label: "drop the counter",
          explanation:
            "The turn is over; forget its flush counter so memory doesn't grow per turn across a long call.",
        },
        {
          lines: "5-8",
          label: "continue: false",
          explanation:
            "An empty transcript with `continue: false` tells Sonic no more input is coming for this context — it can release the prosody state. Wrapped in try/catch because the socket might be closing.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Text without terminal punctuation can distort",
      body: [
        "Cartesia's docs warn that a transcript with no ending `.`, `?`, or `!` can produce an oddly-ended or distorted clip — Sonic may treat it as 'still incoming'. `ensureTerminalPunctuation` adds a period when the last printable character isn't already sentence-ending punctuation.",
        "It's careful with trailing tags: `Your ID is <spell>AB12</spell>` becomes `... </spell>.` and `Great question! [laughter]` becomes `... [laughter].` — the punctuation goes at the very end, and already-ended text (`How can I help you?`) is left alone.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/tts/cartesia.ts",
      language: "typescript",
      intro:
        "The public entry point `synthesizeStreamInContext` — this is where the retry-without-controls fallback lives. Read the fallback ladder carefully.",
      code: `  async synthesizeStreamInContext(
    turnContextId: string,
    text: string,
    onChunk: (pcm16k: Buffer) => void,
    onDone: (characters: number) => void,
    signal?: AbortSignal,
    emotions?: string[],
  ): Promise<void> {
    if (!this.wsFailedPermanently) {
      try {
        const ws = await this.getOrOpenWs();
        return await this.synthesizeViaWsInContext(ws, turnContextId, text, onChunk, onDone, signal, emotions);
      } catch (err) {
        if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) throw err;
        // Cartesia rejected the emotion/voice controls for this sentence — retry
        // once on the same WS with plain (no-emotion) voice controls instead of
        // aborting the whole call. See isInvalidVoiceControlsError.
        if (emotions && emotions.length > 0 && isInvalidVoiceControlsError(err)) {
          try {
            const ws = await this.getOrOpenWs();
            return await this.synthesizeViaWsInContext(ws, turnContextId, text, onChunk, onDone, signal, undefined);
          } catch (retryErr) {
            if (signal?.aborted || (retryErr instanceof DOMException && retryErr.name === "AbortError")) throw retryErr;
            this.wsFailedPermanently = true;
          }
        } else {
          this.wsFailedPermanently = true;
        }
      }
    }
    // WS permanently failed — fall back to REST ...
    try {
      return await this.synthesizeViaRest(text, onChunk, onDone, signal, emotions);
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) throw err;
      if (emotions && emotions.length > 0 && isInvalidVoiceControlsError(err)) {
        return this.synthesizeViaRest(text, onChunk, onDone, signal, undefined);
      }
      throw err;
    }
  }`,
      lines: [
        {
          lines: "14",
          label: "abort is not a failure",
          explanation:
            "A barge-in abort re-throws immediately — we must NOT treat an interruption as a synthesis error to retry. This check appears at every layer of the ladder.",
        },
        {
          lines: "18-21",
          label: "the retry-without-controls fallback",
          explanation:
            "If the error is an invalid-voice-controls 400 AND we sent emotions, retry the SAME sentence on the SAME WS with `emotions` set to `undefined`. The caller still hears the sentence — just without the rejected styling — instead of the whole call dying over one emotion tag.",
        },
        {
          lines: "22-24",
          label: "give up on WS → REST",
          explanation:
            "If even the stripped retry fails (or the error wasn't controls-related), mark the WS permanently failed so all further sentences skip straight to REST.",
        },
        {
          lines: "31-39",
          label: "REST has the same fallback",
          explanation:
            "The REST fallback path repeats the trick: if REST rejects the controls, retry REST without them. Defense in depth — a bad emotion can't break the call on either transport.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "why",
      title: "Why one bad emotion must never end a call",
      body: [
        "Emotions come from `<emotion>` tags the LLM writes into its reply. The LLM can hallucinate an emotion Cartesia doesn't accept, or Cartesia can deprecate an emotion level between deploys. Either way, the sentence is fine — only the *styling* is bad.",
        "Ending a live customer call because the agent tried to sound 'enthusiastic' with a value the API renamed would be an awful failure mode. The strip-and-retry fallback turns a fatal 400 into a slightly-less-expressive sentence the caller never notices. The pipeline's `playTask` catch is the last net; this per-sentence retry is the first.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "Cartesia is the only adapter the pipeline knows about by name (for turn contexts). Click to explore.",
      nodes: [
        { id: "pipeline", label: "startSentenceSynthesis()", sublabel: "routes to synthesizeStreamInContext", chapterSlug: "tts-pipeline-path" },
        { id: "cartesia", label: "CartesiaTTS", sublabel: "cartesia.ts — THIS FILE", current: true },
        { id: "wsctx", label: "turn context path", sublabel: "shared context_id + flush", current: true },
        { id: "wssingle", label: "single-sentence path", sublabel: "throwaway context_id", current: true },
        { id: "rest", label: "REST /tts/bytes", sublabel: "fallback", current: true },
        { id: "sarvam", label: "SarvamTTS", sublabel: "the Indic adapter", chapterSlug: "sarvam-tts-complete" },
        { id: "troub", label: "Troubleshooting", sublabel: "mute agent, robotic voice", chapterSlug: "tts-troubleshooting" },
      ],
      edges: [
        { from: "pipeline", to: "cartesia", label: "synthesizeStreamInContext" },
        { from: "cartesia", to: "wsctx", label: "turnContextId set" },
        { from: "cartesia", to: "wssingle", label: "single sentence" },
        { from: "cartesia", to: "rest", label: "WS failed / retry" },
        { from: "cartesia", to: "troub", label: "invalid controls" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why does a Cartesia turn context send each sentence with continue:true followed by an empty-transcript flush message?",
          choices: [
            "To reduce API cost.",
            "So all sentences in one LLM turn share prosody (continue:true keeps intonation flowing), while the manual flush draws a per-sentence boundary tagged with flush_id — preserving the per-sentence drain architecture.",
            "Because WebSockets require it.",
            "To change the language mid-turn.",
          ],
          correctIndex: 1,
          explanation:
            "continue:true maintains prosody continuity across the turn; the flush produces a discrete flush_id-tagged stream per sentence so drainSentenceJob can still play them one at a time in order.",
        },
        {
          prompt: "Cartesia returns a 400 'invalid emotion level' for one sentence in a live call. What does the adapter do?",
          choices: [
            "Ends the call.",
            "Retries the SAME sentence with emotions stripped (undefined) on the same WS — and REST does the same — so the caller hears the sentence without the rejected styling.",
            "Skips the sentence entirely.",
            "Switches to Sarvam.",
          ],
          correctIndex: 1,
          explanation:
            "isInvalidVoiceControlsError detects the error; the adapter retries once without controls rather than failing the call. Both the WS and REST paths implement this strip-and-retry fallback.",
        },
        {
          prompt: "What does ensureTerminalPunctuation prevent?",
          choices: [
            "Clicks from WAV headers.",
            "An oddly-ended or distorted clip when text lacks terminal punctuation — Sonic may treat unpunctuated text as still-incoming.",
            "Emotion errors.",
            "WebSocket disconnects.",
          ],
          correctIndex: 1,
          explanation:
            "Cartesia docs warn text without a final .?! can distort. The helper appends a period (after any trailing tags) when the last printable char isn't already sentence-ending punctuation.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Cartesia keeps ONE persistent WebSocket per call (lazy-opened / pre-warmed), saving the ~30–80ms handshake per sentence, with a REST `/tts/bytes` fallback.",
        "Speed and emotion live in a top-level `generation_config` (2026-03-01 spec); speed is clamped to [0.6, 1.5], emotion is a single normalized enum via `normalizeEmotion`.",
        "Each synthesis carries a `context_id`; a turn context shares one id with `continue:true` for prosody continuity, a manual `flush` per sentence (tracked by a mirrored `flush_id` counter), and `flush_done` acks; `finalizeTurnContext` sends `continue:false`.",
        "`handleWsMessage` routes by `context_id` + `flush_id` (turn contexts) or by `context_id` alone (single sentences), so concurrent prefetch sentences never cross wires.",
        "`ensureTerminalPunctuation` appends a period (after trailing tags) so Sonic doesn't distort unpunctuated text.",
        "The retry-without-controls fallback (both WS and REST) turns an `invalid voice controls`/`invalid emotion` 400 into an unstyled-but-spoken sentence — one bad emotion never ends a call.",
      ],
    },
  ],
};
