import type { Chapter } from "../types";

export const ttsPipelinePath: Chapter = {
  slug: "tts-pipeline-path",
  moduleId: "d2",
  number: "18.1",
  title: "From LLM Sentences to Audio: The TTS Pipeline Path",
  summary:
    "How a streaming LLM reply becomes spoken audio — sentence splitting, N+1 prefetch pipelining, playback drain, the tail-drain that stops final words clipping, and ttsSpeed.",
  estMinutes: 22,
  fileRef: "artifacts/api-server/src/orchestration/pipeline.ts",
  prerequisites: ["stt-adapters"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "TTS (text-to-speech) is the mouth of the agent. But the TTS adapter is only half the story. Before any adapter is called, the pipeline has to solve a hard problem: the LLM streams text one token at a time, and the caller wants to hear the reply **as it's being written** — not after the whole paragraph is done.",
        "This chapter is about the **pipeline path**: the code in `pipeline.ts` that sits between the LLM's stream of tokens and the TTS adapter. It answers four questions: (1) how do we cut a growing stream of text into speakable sentences? (2) how do we synthesize sentence N+1 while sentence N is still playing, so there's no gap? (3) how do we play the audio out at exactly real-time speed? and (4) how do we stop the carrier from clipping the last word?",
        "We'll walk `pipeline.ts` top-to-bottom through the TTS-relevant pieces: `extractSentences`, the `TtsSentenceJob` type, `startSentenceSynthesis`, `drainSentenceJob`, the `playTask` loop, and `drainPlaybackTail`. Each is a real function copied from the repo.",
      ],
    },
    {
      kind: "concept",
      title: "Streaming, pipelining, and 'real-time' audio",
      body: [
        "**Streaming** means the LLM hands us text a little at a time. We don't have the full reply up front. So we must decide, on the fly, when we have enough text to start speaking — that's **sentence splitting**.",
        "**Pipelining** is the trick that hides latency. Synthesizing a sentence takes a network round-trip (100–800ms). If we synthesized sentence 2 only *after* sentence 1 finished playing, the caller would hear a gap. Instead we start sentence 2's synthesis the moment we split it off, *while* sentence 1 is still playing. By the time sentence 1 ends, sentence 2's audio is already arriving. This is called **N+1 prefetch**.",
        "**Real-time pacing** means we send audio to the phone carrier at exactly the speed it plays — 20 milliseconds of audio every 20 milliseconds. If we dumped it all at once, the carrier's small playback buffer would overflow and drop frames (choppy audio).",
      ],
    },
    {
      kind: "analogy",
      title: "A kitchen pass, not a single cook",
      body: [
        "Imagine a restaurant. A slow way to serve a 3-course meal: cook course 1, serve it, wait for the plate to come back, THEN start cooking course 2. The diner sits hungry between courses.",
        "A fast kitchen **pipelines**: while course 1 is being eaten, course 2 is already on the stove. The pass (the counter where finished plates wait) is drained in strict order — course 1, then 2, then 3 — but the cooking overlaps. `startSentenceSynthesis` is the stove (starts early, out of order is fine); `drainSentenceJob` is the pass (plays strictly in order).",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "First, splitting. `extractSentences` scans growing LLM text and pulls off complete sentences, leaving a `remainder` for the next call. Here is the top of the scan loop — the `!`/`?` and ellipsis cases.",
      code: `export function extractSentences(text: string, minCommaClauseChars = 8): { sentences: string[]; remainder: string } {
  const sentences: string[] = [];
  let i = 0;
  let segStart = 0;

  while (i < text.length) {
    const ch = text[i]!;

    if (ch === '!' || ch === '?') {
      // Consume run of consecutive !/?
      while (i + 1 < text.length && (text[i + 1] === '!' || text[i + 1] === '?')) i++;
      const s = text.slice(segStart, i + 1).trim();
      // Min 10 chars (or minCommaClauseChars) so short Indic phrases accumulate smoothly without micro-chunking
      if (s.length >= Math.min(10, minCommaClauseChars)) sentences.push(s);
      i++;
      while (i < text.length && text[i] === ' ') i++;
      segStart = i;
    } else if (ch === '\\u0964') {
      // Devanagari / Indic danda (।) — sentence boundary in Hindi, Tamil-mixed, etc.
      const s = text.slice(segStart, i + 1).trim();
      if (s.length >= 4) sentences.push(s);
      i++;
      while (i < text.length && text[i] === ' ') i++;
      segStart = i;`,
      lines: [
        {
          lines: "1",
          label: "signature",
          explanation:
            "`text` is the accumulated LLM output so far. It returns `sentences` (complete, ready to speak) and `remainder` (leftover text that isn't a full sentence yet — carried into the next call). `minCommaClauseChars` maps to the dashboard setting **TTS Early Dispatch Threshold**.",
        },
        {
          lines: "3-4",
          label: "two cursors",
          explanation:
            "`i` walks character by character; `segStart` marks where the current segment began. When we hit a boundary, everything from `segStart` to `i` becomes one sentence.",
        },
        {
          lines: "8-15",
          label: "! and ? boundaries",
          explanation:
            "A run of `!!!` or `?!` collapses into one boundary. The `Math.min(10, minCommaClauseChars)` guard stops tiny fragments (like a lone `Ok?`) from being sent as their own micro-sentence, which would waste the per-turn sentence budget.",
        },
        {
          lines: "16-22",
          label: "the Indic danda (।)",
          explanation:
            "Hindi, Tamil-mixed, and other Indic scripts end sentences with `।` (U+0964), not a period. Without this branch, Indic replies would never split and would be spoken as one giant run-on — a real bug this line fixes.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "The period case is the trickiest — periods appear in abbreviations, decimals, and URLs too. We skip the ellipsis and end-of-string handling (they're short) and jump to the core split decision.",
      code: `        const shouldSplit = afterSpace === undefined || /[A-Z"'(\\u2018\\u201C\\u0900-\\u0D7F]/.test(afterSpace);

        if (shouldSplit) {
          const wordBefore = text.slice(segStart, i).match(/([A-Za-z]+)$/)?.[1];
          const isAbbrev = wordBefore !== undefined && wordBefore.length <= 2;
          if (!isAbbrev) {
            const s = text.slice(segStart, i + 1).trim();
            if (s.length >= 4) sentences.push(s);
            segStart = j;
            i = j;
          } else {
            i++;
          }
        } else {
          i++;
        }`,
      lines: [
        {
          lines: "1",
          label: "when to split on a period",
          explanation:
            "Split if nothing follows yet (`afterSpace === undefined` — the period is at the tail of the current chunk) OR the next real character looks like a sentence start: an uppercase letter, an opening quote/paren, or any Indic script character (range `\\u0900-\\u0D7F`). Indic scripts have no uppercase, so without that range Tamil/Hindi sentences would never split on a period.",
        },
        {
          lines: "3-5",
          label: "abbreviation guard",
          explanation:
            "Look at the whole Latin word before the period. If it's ≤2 characters (`Mr`, `Dr`, `vs`, `St`), treat it as an abbreviation and DON'T split — otherwise `Dr. Kumar` would become two sentences. Longer words like `kare` are safe to split.",
        },
        {
          lines: "6-11",
          label: "commit the sentence",
          explanation:
            "Push the trimmed sentence and jump both cursors past the whitespace (`j`) to the start of the next sentence.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "Early phrase dispatch — speaking before a full sentence",
      body: [
        "After scanning for `.!?`, `extractSentences` calls `tryEarlyPhraseDispatch` on the remainder. This is the Vapi/Bolna trick: if the leftover text already has a comma break and is long enough, speak that first clause NOW rather than waiting for the sentence to end.",
        "The threshold is the dashboard's **TTS Early Dispatch Threshold (chars)** (`ttsMinSentenceChars`, default 18). Lower it and the agent starts talking sooner (lower latency) but in choppier fragments; raise it for smoother but later speech.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "Each split-off sentence becomes a `TtsSentenceJob`. This type is the heart of pipelining — it separates 'synthesis started' from 'audio played'.",
      code: `type TtsSentenceJob = {
  text: string;
  turnNumber: number;
  /** Bolna sequence_id — stale frames from invalidated turns are BLOCKed. */
  sequenceId: number;
  /** True if this.tts.synthesizeStream was used (vs the one-shot synthesize()). */
  streaming: boolean;
  /** Streaming path: 4-byte-aligned pcm16k blocks awaiting drain-time processing. */
  pcmQueue: Buffer[];
  /** True once the TTS request has fully settled (success, error, or abort). */
  synthDone: boolean;
  synthError: unknown;
  /** Set once synthDone; total audio duration computed from received bytes. */
  audioDurationMs: number | undefined;
  /** Non-streaming path: the full synthesized PCM buffer, once synthDone. */
  nonStreamAudio: Buffer | null;
  /** Resolves once synthDone is true. */
  ready: Promise<void>;
};`,
      lines: [
        {
          lines: "4",
          label: "sequenceId",
          explanation:
            "A monotonically-increasing turn id. If the caller barges in, the pipeline bumps the sequence and every job with an old `sequenceId` is BLOCKed at drain time — so stale audio from an interrupted turn never plays.",
        },
        {
          lines: "8",
          label: "pcmQueue — the buffer that makes prefetch safe",
          explanation:
            "As TTS bytes stream in, they're aligned to 4 bytes and pushed here. This lets synthesis run ahead and fill the queue while a *different* job is still playing. The audio is buffered, not yet sent.",
        },
        {
          lines: "10-13",
          label: "synthDone / synthError",
          explanation:
            "`synthDone` flips true when the TTS request finishes (success, error, or abort). `synthError` carries a real failure so `drainSentenceJob` can surface it. The drain loop watches `synthDone` to know when no more bytes are coming.",
        },
        {
          lines: "18",
          label: "ready promise",
          explanation:
            "Resolves once synthesis settles. The drain code `await`s this so a real TTS error is never swallowed even if playback exited early via barge-in.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "`startSentenceSynthesis` kicks off the TTS request immediately and returns the job. Read its doc comment carefully — it explains *why* synthesis and playback are split.",
      code: `  /**
   * Starts TTS synthesis for \`text\` immediately and returns a handle that can
   * be drained (played) later via drainSentenceJob. This lets the turn
   * sentence-queues start synthesizing sentence N+1 while sentence N is still
   * playing, so N+1's network/firstByteMs latency is absorbed during N's
   * playback instead of opening an audible gap after it.
   *
   * Only the network fetch + 4-byte alignment happen here — nothing with a
   * real-world side effect (recording, ambient mixing, wire encoding, pacing)
   * runs until drainSentenceJob actually plays the job. That split matters:
   * synthesis for sentence N+1 can finish (or run) WHILE sentence N is still
   * draining, and if recording/ambient mixing happened here they'd fire out
   * of chronological order — corrupting the recording ...
   */
  private startSentenceSynthesis(
    text: string,
    turnNumber: number,
    sequenceId: number,
    turnContextId?: string,
    emotions?: string[],
  ): TtsSentenceJob {`,
      lines: [
        {
          lines: "2-6",
          label: "the whole point of prefetch",
          explanation:
            "Synthesis starts *now* and the network latency of sentence N+1 is 'absorbed' during sentence N's playback. This closes the audible gap between sentences in a multi-sentence reply.",
        },
        {
          lines: "8-13",
          label: "why only the fetch runs here",
          explanation:
            "Anything with a real-world side effect — recording the call, mixing ambient background noise, encoding to the wire format, pacing — is DEFERRED to `drainSentenceJob`. If those ran here, sentence N+1's recording would be written before sentence N had even played, corrupting the recording. Ordering correctness demands the split.",
        },
        {
          lines: "19",
          label: "turnContextId",
          explanation:
            "Only used by Cartesia: all sentences in one LLM turn share a `context_id` so prosody flows naturally across sentence boundaries. Other adapters ignore it. (Covered in the Cartesia chapter.)",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "Inside `startSentenceSynthesis`, the streaming path. As TTS bytes arrive they're accumulated and flushed into the job's `pcmQueue` — pure buffering, no playback.",
      code: `      const onTtsChunk = (chunk: Buffer): void => {
        if (this.closed || this.bargeInRequested) return;
        if (this._tTurnTtsFirstByte === null) this._tTurnTtsFirstByte = performance.now();
        if (_ttsFirstByteMs === null) _ttsFirstByteMs = Date.now() - _ttsReqStart;
        _ttsTotalBytes += chunk.length;
        clearTimeout(ttsTimerId); // connection is alive — reset the hung-API timer
        accum.push(chunk);
        accumSize += chunk.length;
        if (accumSize >= STREAM_ACCUM_BYTES) flush();
      };
      const onTtsDone = (_characters: number): void => { flush(); };
      // Cartesia turn-level continuations: share one context_id per LLM
      // turn with manual flushing to maintain prosody across sentences.
      if (turnContextId && ttsAdapter instanceof CartesiaTTS) {
        await ttsAdapter.synthesizeStreamInContext(turnContextId, text, onTtsChunk, onTtsDone, ttsAbort.signal, emotions);
      } else {
        await synthesizeStream(text, onTtsChunk, onTtsDone, ttsAbort.signal);
      }`,
      lines: [
        {
          lines: "1-2",
          label: "abort-aware",
          explanation:
            "Every incoming chunk first checks `closed` / `bargeInRequested`. The moment the caller interrupts, incoming TTS bytes are dropped on the floor.",
        },
        {
          lines: "4",
          label: "first-byte timing (TTFB)",
          explanation:
            "`_ttsFirstByteMs` records how long from request-sent to first audio byte — the TTS Time-To-First-Byte. This is the number you watch when the agent feels slow to start speaking.",
        },
        {
          lines: "6",
          label: "hung-API timer reset",
          explanation:
            "Each chunk clears the abort timer. If TTS goes silent (a hung Cartesia/ElevenLabs fetch), the timer fires, aborts the request, and the caller doesn't sit in dead silence forever.",
        },
        {
          lines: "13-17",
          label: "Cartesia gets special routing",
          explanation:
            "If this is a Cartesia adapter with a turn context, use `synthesizeStreamInContext` (shared prosody). Everything else uses the plain `synthesizeStream`. This is the one place the pipeline knows about a specific adapter — a deliberate exception for Cartesia's per-turn context feature.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "`drainSentenceJob` is the 'pass' — it plays one job at a time, in strict order. Here's the real-time send loop for the streaming path.",
      code: `      // Drift-compensated pacing: track the "ideal" next send time and adjust
      // each sleep so that accumulated setTimeout jitter is self-corrected.
      let nextTick = Date.now() + 20;
      while (!this.closed && !this.bargeInRequested) {
        // ... BLOCK / WAIT sequence checks omitted ...
        if (wireQueue.length === 0) processNextBlock();
        if (wireQueue.length > 0) {
          const chunk = wireQueue.shift()!;
          if (this.bargeInRequested || !this.interruptionMgr.isValidSequence(job.sequenceId)) break;
          this.markFirstAudioSent();
          this.config.onAudioOut(outChunk);
          noteSent(outChunk);
          this.lastTtsFrameAt = Date.now(); // mark real audio out for the keepalive watchdog
          if (job.synthDone && pcmIdx >= job.pcmQueue.length && wireQueue.length === 0) break;
          const delay = Math.max(0, nextTick - Date.now());
          nextTick += 20;
          if (nextTick < Date.now() - 40) nextTick = Date.now() + 20;
          await new Promise<void>((r) => setTimeout(r, delay));
        } else if (job.synthDone) {
          break; // no more buffered blocks and TTS finished — we're done
        }
      }`,
      lines: [
        {
          lines: "1-3",
          label: "drift-compensated pacing",
          explanation:
            "`nextTick` is the *ideal* send time. Timers fire a bit late; if we just slept 20ms each time, delivery would slowly drift below real-time and the carrier's playout buffer would underrun (gaps). Tracking the ideal target and computing `delay = nextTick - now` self-corrects the jitter.",
        },
        {
          lines: "6",
          label: "produce on demand",
          explanation:
            "`processNextBlock` converts the next buffered pcm16k block into wire-ready 20ms chunks — this is where recording, ambient mixing, and mulaw/PCM encoding actually happen, at real 'now', in play order.",
        },
        {
          lines: "9",
          label: "the final mute gate",
          explanation:
            "Right before sending, re-check barge-in and sequence validity. This closes a tiny race where a barge-in flag flips between loop iterations — no audio ever goes out after an interruption.",
        },
        {
          lines: "13",
          label: "the no-trailing-sleep break",
          explanation:
            "When TTS is done and this was the last chunk, break IMMEDIATELY without the trailing 20ms sleep. That skipped 20ms is why `drainPlaybackTail` (below) exists — the loop exits the instant the last byte is handed off, so the carrier still holds a tail.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "The `playTask` loop ties it together: it walks the sentence queue, playing each job in order, while `enqueue` keeps starting synthesis for new sentences behind it.",
      code: `    const playTask = async (): Promise<void> => {
      let idx = 0;
      while (true) {
        if (idx < sentenceQueue.length) {
          const job = sentenceQueue[idx++]!;
          this.bargeInHoldUntil = Date.now() + this.bargeInEchoGraceMs;
      this.isPlaying = true;
          try {
            await this.playJob(job);
          } catch (err) {
            // A single sentence's TTS request failing must not end the whole call
            const reason = toReadableError(err, "TTS error");
            logger.error({ callId: this.config.callId, err, text: job.text.slice(0, 40) }, reason);
            this.reportTtsFailure(reason, { where: "sentence", text: job.text.slice(0, 40) });
          }
          if (this.bargeInRequested) break;
          if (this.endAfterCurrentSentence) break;
        } else if (allEnqueued) {
          break;
        } else {
          await new Promise<void>((r) => { wakePlayer = r; });
        }
      }
      this.isPlaying = false;
      this.armTailEchoGrace();
      await this.drainPlaybackTail();
    };`,
      lines: [
        {
          lines: "4-5",
          label: "consume in order",
          explanation:
            "`idx` walks the queue. Each job is played with `playJob` (which calls `drainSentenceJob`) strictly in the order it was enqueued — even though the jobs were *synthesized* out of order via prefetch.",
        },
        {
          lines: "10-14",
          label: "one bad sentence ≠ dead call",
          explanation:
            "If a single sentence's synthesis throws (Cartesia rejects an emotion, a network blip), we log it and call `reportTtsFailure` — but we do NOT hang up. The agent skips that sentence and keeps talking. `reportTtsFailure` also fires an `onProviderIssue` toast so operators see it.",
        },
        {
          lines: "17-20",
          label: "wait for the next sentence",
          explanation:
            "If the queue is empty but more text is coming (`!allEnqueued`), the player parks on a promise. `enqueue` calls `wakePlayer()` the instant a new sentence arrives — this is the producer/consumer handshake between the LLM stream and playback.",
        },
        {
          lines: "24-25",
          label: "the tail drain fires here",
          explanation:
            "After the last sentence plays, `armTailEchoGrace` prevents the agent's own trailing echo from triggering a false barge-in, and `drainPlaybackTail` sends silence to flush the carrier's buffer — the fix for clipped final words.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Final words clipping — and the tail drain that fixes it",
      body: [
        "`drainSentenceJob` resolves the instant the last audio chunk is *handed off* to the carrier — but the carrier's jitter buffer still holds ~100–300ms of unplayed audio. If we called `onCallEnd()` or went back to listening immediately, that tail would be dropped and the caller would hear the goodbye cut off mid-word.",
        "Worse: on VoBiz, when audio simply *stops arriving*, the carrier can close its playout window early and clip even sooner. A passive `sleep` isn't enough.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "`drainPlaybackTail` sends real silence frames at real-time rate to keep the carrier's playout buffer ticking until it's fully drained. Its length is the dashboard's Telephony Tail Drain setting.",
      code: `  private async drainPlaybackTail(): Promise<void> {
    if (this.closed || this.bargeInRequested) return;
    const FRAME_MS      = 20;
    const FRAME_BYTES   = this.config.rawPcmOutput
      ? FRAME_MS * 8 * 2   // 20 ms × 8000 Hz × 2 bytes  = 320 B (16-bit PCM)
      : FRAME_MS * 8;      // 20 ms × 8000 Hz × 1 byte   = 160 B (µ-law)
    const silenceFrame  = Buffer.alloc(FRAME_BYTES, 0);
    const frames        = Math.ceil(
      (this.agent.telephonyTailDrainMs ?? TELEPHONY_TAIL_DRAIN_MS_DEFAULT) / FRAME_MS,
    );
    let nextTick        = Date.now() + FRAME_MS;
    for (let i = 0; i < frames && !this.closed && !this.bargeInRequested; i++) {
      let frame: Buffer = silenceFrame;
      if (this.ambientStream) {
        frame = this.config.rawPcmOutput
          ? this.ambientStream.nextPcmChunk()
          : this.ambientStream.nextMulawChunk();
      }
      this.config.onAudioOut(frame);
      const delay = Math.max(0, nextTick - Date.now());
      nextTick += FRAME_MS;
      await new Promise<void>((r) => setTimeout(r, delay));
    }
  }`,
      lines: [
        {
          lines: "2",
          label: "no-op on barge-in",
          explanation:
            "If the caller is already speaking (barge-in) or the call is closed, skip the drain — we must stop immediately, not keep the line busy.",
        },
        {
          lines: "8-10",
          label: "how many silence frames",
          explanation:
            "The drain length is `telephonyTailDrainMs` (dashboard: **Telephony Tail Drain (ms)**, default 400ms) divided into 20ms frames. Raise it if final words still clip; it does NOT affect mid-call turn latency — it only runs at the *end* of a turn.",
        },
        {
          lines: "13-18",
          label: "carry ambient through the drain",
          explanation:
            "If an ambient background bed is enabled, send ambient chunks instead of pure zeros. A run of digital-silence frames looks 'inactive' to a mobile carrier's VAD/DTX, which then gates the ambient bed. Keeping ambient flowing keeps the channel 'active'.",
        },
        {
          lines: "19-22",
          label: "real-time pacing again",
          explanation:
            "Same drift-compensated 20ms cadence as the main drain loop. Sending frames at real-time rate is what keeps VoBiz/Twilio/Plivo playout buffers from clipping.",
        },
      ],
    },
    {
      kind: "concept",
      title: "ttsSpeed — one knob, three adapters",
      body: [
        "The dashboard's **TTS Playback Speed** (`ttsSpeed`, default 1.0) is passed into `createTTSAdapter(...)` as the last argument. Each adapter clamps it to its own supported range and skips it when it's exactly 1.0.",
        "It is NOT applied by resampling audio in the pipeline — it's a *provider-side* speed control. Sarvam maps it to Bulbul's `pace`, Cartesia to `generation_config.speed` (range 0.6–1.5), ElevenLabs to `voice_settings.speed` (range 0.7–1.2). Providers without a speed control (OpenAI, Azure, Deepgram) simply don't receive it.",
        "Values around 1.05–1.2 make the agent sound slightly quicker and more energetic without sounding rushed. Below the range the audio would sound sluggish; above it, robotic. That's why each adapter clamps.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "The TTS pipeline path sits between the LLM's token stream and the individual TTS adapters. Click to explore.",
      nodes: [
        { id: "llm", label: "LLM adapter", sublabel: "streams tokens", chapterSlug: "llm-adapters" },
        { id: "extract", label: "extractSentences()", sublabel: "split into sentences", current: true },
        { id: "start", label: "startSentenceSynthesis()", sublabel: "prefetch N+1", current: true },
        { id: "drain", label: "drainSentenceJob()", sublabel: "play in order, real-time", current: true },
        { id: "tail", label: "drainPlaybackTail()", sublabel: "stop final-word clipping", current: true },
        { id: "sarvam", label: "SarvamTTS", sublabel: "Bulbul adapter", chapterSlug: "sarvam-tts-complete" },
        { id: "cartesia", label: "CartesiaTTS", sublabel: "Sonic adapter", chapterSlug: "cartesia-tts-complete" },
        { id: "carrier", label: "onAudioOut", sublabel: "phone carrier" },
      ],
      edges: [
        { from: "llm", to: "extract", label: "growing text" },
        { from: "extract", to: "start", label: "one sentence" },
        { from: "start", to: "sarvam", label: "synthesizeStream" },
        { from: "start", to: "cartesia", label: "synthesizeStreamInContext" },
        { from: "start", to: "drain", label: "TtsSentenceJob" },
        { from: "drain", to: "carrier", label: "20ms frames" },
        { from: "drain", to: "tail", label: "after last sentence" },
        { from: "tail", to: "carrier", label: "silence frames" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why does the pipeline split synthesis (startSentenceSynthesis) from playback (drainSentenceJob)?",
          choices: [
            "To save memory.",
            "So sentence N+1's network latency is absorbed while sentence N is still playing (prefetch), while recording/ambient/encoding still run strictly in play order at drain time.",
            "Because Cartesia requires it.",
            "To avoid using WebSockets.",
          ],
          correctIndex: 1,
          explanation:
            "Synthesis can safely run ahead (network fetch only), closing the gap between sentences. But side-effects like recording and ambient mixing must run in chronological play order, so they're deferred to drainSentenceJob.",
        },
        {
          prompt: "The caller hears the last word of the goodbye clipped. Which mechanism is responsible for preventing this?",
          choices: [
            "extractSentences",
            "The KeepAlive frame",
            "drainPlaybackTail sending silence frames for telephonyTailDrainMs to flush the carrier's jitter buffer",
            "ttsSpeed",
          ],
          correctIndex: 2,
          explanation:
            "drainSentenceJob resolves the instant the last chunk is handed off, but the carrier still buffers ~100-300ms. drainPlaybackTail sends real-time silence frames (length = Telephony Tail Drain ms) so the carrier plays out the tail before teardown.",
        },
        {
          prompt: "How is ttsSpeed applied?",
          choices: [
            "By resampling the audio in the pipeline.",
            "It's passed to createTTSAdapter and each adapter maps/clamps it to its own provider speed control (Sarvam pace, Cartesia generation_config.speed, ElevenLabs voice_settings.speed); unsupported providers ignore it.",
            "It changes the sample rate.",
            "It only works on OpenAI.",
          ],
          correctIndex: 1,
          explanation:
            "ttsSpeed is a provider-side control. It's forwarded to adapters that support it and clamped to each provider's valid range; OpenAI/Azure/Deepgram don't receive it.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "`extractSentences` splits streaming LLM text on `.!?`, ellipsis, and the Indic danda (।), guarding against abbreviations and micro-fragments; `tryEarlyPhraseDispatch` speaks the first comma-clause early (threshold = ttsMinSentenceChars / TTS Early Dispatch Threshold).",
        "A `TtsSentenceJob` decouples 'synthesis started' from 'audio played' — the key to N+1 prefetch pipelining.",
        "`startSentenceSynthesis` does only the network fetch + byte alignment (safe to run ahead); `drainSentenceJob` does recording, ambient mixing, encoding, and real-time pacing, strictly in play order.",
        "The drain loop sends 20ms frames with drift-compensated pacing so the carrier's playout buffer never underruns (choppy audio) or overruns (dropped frames).",
        "`drainPlaybackTail` sends silence frames for `telephonyTailDrainMs` (dashboard: Telephony Tail Drain) to flush the carrier tail and stop final-word clipping.",
        "`ttsSpeed` is forwarded to `createTTSAdapter` and clamped per-provider (Sarvam pace, Cartesia speed, ElevenLabs speed); unsupported providers ignore it.",
      ],
    },
  ],
};
