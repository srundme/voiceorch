import type { Chapter } from "../types";

export const sessionAndPipeline: Chapter = {
  slug: "session-and-pipeline",
  moduleId: "m4",
  number: "4.2",
  title: "The Session & the Pipeline",
  summary:
    "The object that holds one call's entire state, and the loop that drives every conversational turn.",
  estMinutes: 20,
  fileRef: "artifacts/api-server/src/orchestration/pipeline.ts",
  prerequisites: ["audio-ts"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "In the last chapter we turned a phone call into numbers. Now we have to turn those numbers into a **conversation**. That's the job of `pipeline.ts` — the single biggest, busiest file in the whole codebase (over 4,000 lines). One instance, called the `OrchestrationPipeline`, is created for **every live call** and lives for exactly as long as that call.",
        "Think of it as the call's brain stem. It receives audio frames, decides when the caller has stopped talking, ships the audio to speech-to-text, feeds the transcript to the LLM, streams the LLM's reply into text-to-speech, and pushes the resulting audio back down the phone line — all while juggling barge-in, echo rejection, language detection, tool calls, and a dozen other concerns. We can't read all 4,000 lines, but we don't need to. The **shape** of the file is simple, and once you see it, the rest is detail.",
      ],
    },
    {
      kind: "concept",
      title: "The turn loop: STT → LLM → TTS",
      body: [
        "A phone conversation is just **turns**: you talk, I listen; then I talk, you listen. The pipeline models one full turn as three stages chained together.",
        "**STT** (speech-to-text) takes the caller's buffered audio and returns a transcript — words. **LLM** (the large language model) takes those words plus the conversation history and streams back a reply, token by token. **TTS** (text-to-speech) takes the reply text and synthesizes audio, which we encode back to μ-law and send to the caller.",
        "The hard part isn't the three stages — it's the **timing**. We don't wait for the whole LLM reply before speaking; we start synthesizing the first sentence while the model is still writing the second. We don't wait forever for the caller to finish; an adaptive silence timer decides when their turn is over. Everything in this file exists to make that loop feel instant and human.",
      ],
    },
    {
      kind: "analogy",
      title: "The pipeline is a short-order kitchen",
      body: [
        "Orders (caller audio) come in off the wire. A prep cook (`decodeMulaw`) unpacks the raw ingredients. A timer on the pass decides when an order ticket is **complete** (endpointing). The line cook (STT) reads the ticket. The chef (LLM) plates the dish one component at a time. And the runner (TTS) carries each plate out the second it's ready — never waiting for the whole table's food to be done.",
        "The `OrchestrationPipeline` object is the kitchen itself: it owns the timers, the half-finished plates, and the memory of every order placed so far this service. Close the restaurant (`close()`) and the whole kitchen tears down.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "First, the session state. These are the fields every method reads and writes — the call's entire working memory lives here.",
      code: `export class OrchestrationPipeline {
  private config: SessionConfig;
  private agent: AgentConfig;
  private stt: ReturnType<typeof createSTTAdapter>;
  private llm: ReturnType<typeof createLLMAdapter>;
  private fallbackLlm: ReturnType<typeof createLLMAdapter> | null = null;
  private tts: ReturnType<typeof createTTSAdapter>;

  private audioBuffer: Buffer[] = [];
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;
  // …
  private conversationHistory: ConversationTurn[] = [];
  private closed = false;`,
      lines: [
        {
          lines: "1",
          label: "class OrchestrationPipeline",
          explanation:
            "A **class**, not a function, because a call is deeply **stateful** — it has to remember everything between audio frames. One instance is created per call in `session.ts` and lives for the call's lifetime.",
        },
        {
          lines: "2-3",
          label: "config + agent",
          explanation:
            "`config` is the `SessionConfig` passed in at construction (call id, callbacks like `onTranscript`/`onCallEnd`, the telephony provider). `agent` is the agent's saved settings — which providers to use, the system prompt, VAD tuning, and so on.",
        },
        {
          lines: "4-7",
          label: "the three adapters",
          explanation:
            "`stt`, `llm`, and `tts` are the swappable vendor adapters built in the constructor. The pipeline calls them through a uniform interface and never cares which vendor is behind them (that's Module 5). `fallbackLlm` is a backup LLM used if the primary fails before producing a token.",
        },
        {
          lines: "9",
          label: "audioBuffer: Buffer[]",
          explanation:
            "The accumulating chunks of the caller's **current** utterance. We keep pushing decoded audio here while they speak, then flush the whole array to STT once they go silent.",
        },
        {
          lines: "10",
          label: "silenceTimer",
          explanation:
            "The handle for the adaptive 'have they stopped talking yet?' countdown. `null` when no countdown is running. We'll see it armed in `scheduleSilenceFlush()`.",
        },
        {
          lines: "11",
          label: "isProcessing",
          explanation:
            "A one-bit lock. While a turn is being processed (STT→LLM→TTS in flight) this is `true`, and new audio frames are ignored for turn-taking so we don't start a second turn on top of the first.",
        },
        {
          lines: "13-14",
          label: "conversationHistory + closed",
          explanation:
            "`conversationHistory` is the running list of `{ role, content }` turns sent to the LLM each turn — the call's actual memory. `closed` flips to `true` at teardown; nearly every method bails early with `if (this.closed) return;`.",
        },
      ],
    },
    {
      kind: "code",
      filename: "orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "Audio enters here. `onAudioIn` is called by the telephony layer for every μ-law chunk off the wire — this is the front door of the whole engine.",
      code: `onAudioIn(mulawChunk: Buffer): void {
  if (this.closed) return;
  const callId = String(this.config.callId);
  const pcm8k = decodeMulaw(mulawChunk);
  // Record raw caller audio (before noise cancellation)
  this.recording.addCallerChunk(pcm8k);
  // Voice-intelligence tap — runs outside the main audio pipeline
  this.config.callerAudioTap?.(pcm8k);
  processAudioIn(callId, mulawChunk, this.agent.noiseCancellationEnabled)
    .then((result) => this.handleProcessedAudio(result))
    .catch((err) => logger.error({ callId: this.config.callId, err }, "Audio worker error (mulaw)"));
}`,
      lines: [
        {
          lines: "2",
          label: "if (this.closed) return",
          explanation:
            "The guard you'll see everywhere. Once the call is torn down, late audio frames are dropped instead of crashing on freed state.",
        },
        {
          lines: "4",
          label: "decodeMulaw(mulawChunk)",
          explanation:
            "Straight from the previous chapter: the very first thing we do to incoming phone audio is turn 8-bit μ-law into 16-bit linear PCM. Everything downstream needs PCM.",
        },
        {
          lines: "6",
          label: "recording.addCallerChunk",
          explanation:
            "We save the **raw** caller audio (before noise cancellation) into the stereo WAV recorder, so the saved recording matches what the human actually said.",
        },
        {
          lines: "9-11",
          label: "processAudioIn(...) on a worker",
          explanation:
            "The heavy DSP (noise cancellation + VAD) is offloaded to a worker-thread pool so it never blocks the call's main loop. When it resolves, `handleProcessedAudio` runs with the cleaned audio and a `hasSpeech` flag; errors are logged, never thrown.",
        },
      ],
    },
    {
      kind: "code",
      filename: "orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "After processing, the batch path decides what to do with each frame. This is the core of turn-taking: accumulate while speaking, and arm the silence timer the moment they pause.",
      code: `if (this.isProcessing) return;

if (hasSpeech) {
  // …KB prefetch on the first speech frame of a new utterance…
  this.audioBuffer.push(pcm8k);
  this.resetSilenceTimer();
} else if (this.audioBuffer.length > 0) {
  this.audioBuffer.push(pcm8k);
  this.scheduleSilenceFlush();
}`,
      lines: [
        {
          lines: "1",
          label: "if (this.isProcessing) return",
          explanation:
            "If a turn is already being handled, don't start collecting a new utterance yet — the lock keeps turns from overlapping.",
        },
        {
          lines: "3-6",
          label: "hasSpeech → keep buffering",
          explanation:
            "The caller is talking: push the frame onto `audioBuffer` and **reset** the silence countdown (every new speech frame pushes 'they're done' further out). The elided line kicks off a knowledge-base prefetch on the first frame so the lookup overlaps the utterance.",
        },
        {
          lines: "7-9",
          label: "silence after speech → schedule flush",
          explanation:
            "A silent frame, but we have buffered audio — the caller may have just paused. Push the (silent) frame and call `scheduleSilenceFlush()`, which starts the adaptive 'is the turn over?' timer. If they resume talking, the `hasSpeech` branch resets it again.",
        },
      ],
    },
    {
      kind: "code",
      filename: "orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "How long do we wait before deciding the turn is over? Not a fixed number — an adaptive one. This is where the pipeline hands off to the endpointing module.",
      code: `private scheduleSilenceFlush(): void {
  if (this.silenceTimer) return;
  // ── Adaptive endpoint window ───────────────────────────────────────────
  const lastAgentText = [...this.conversationHistory].reverse()
    .find(t => t.role === "assistant")?.content ?? "";
  const partialTranscript = this.pendingTranscriptQueue.length > 0 ? this.pendingTranscriptQueue[this.pendingTranscriptQueue.length - 1].text : "";
  // audioBuffer holds 8kHz 8-bit PCM: 8000 bytes/s → 1 ms ≈ 8 bytes
  const audioBufferMs = Math.round(
    this.audioBuffer.reduce((s, b) => s + b.length, 0) / 8
  );
  const { ms, reason } = computeEndpointMs({
    lastAgentText,
    partialTranscript,
    audioBufferMs,
    baseSilenceMs: this.vadSilenceMs,
  });
  this._lastEndpointMs = ms;
  this._lastEndpointReason = reason;
  this.silenceTimer = setTimeout(() => {
    this.silenceTimer = null;
    void this.flushAndProcess();
  }, ms);
}`,
      lines: [
        {
          lines: "2",
          label: "if (this.silenceTimer) return",
          explanation:
            "Idempotent: a countdown is already running, so don't start a second one. (`resetSilenceTimer`, called on speech frames, is what clears it so a fresh one can be armed.)",
        },
        {
          lines: "4-5",
          label: "lastAgentText",
          explanation:
            "Find the agent's most recent line. Why? Because if the agent just asked 'what's your policy number?', the caller will read digits slowly and we must wait **longer**. Context changes the silence window.",
        },
        {
          lines: "8-10",
          label: "audioBufferMs",
          explanation:
            "Estimate how long the caller has been speaking from the buffered byte count (8 bytes ≈ 1 ms at 8 kHz, 8-bit). A short burst is probably a quick 'yes' — flush fast.",
        },
        {
          lines: "11-16",
          label: "computeEndpointMs({ ... })",
          explanation:
            "Hand all that context to the endpointing module, which returns `{ ms, reason }`: how many milliseconds of silence to wait, plus a label for the logs. This is the seam between the pipeline and the endpointing chapter.",
        },
        {
          lines: "19-22",
          label: "setTimeout → flushAndProcess",
          explanation:
            "Arm the timer for `ms`. If no new speech resets it, it fires, clears itself, and calls `flushAndProcess()` — which ships the buffered audio to STT and begins the turn.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Two STT paths: batch vs streaming",
      body: [
        "What you just saw is the **batch** path: buffer audio locally, run our own VAD, flush on silence. But when the agent uses a streaming provider (like Deepgram live), the pipeline feeds every frame straight to the provider over a WebSocket and lets **their** endpointing decide — `handleProcessedAudio` returns early via `if (this.streamSTT) { … return; }`.",
        "Both paths converge on the same `processTurn()`. That's the elegance: no matter how a transcript was produced, the LLM→TTS half of the loop is identical.",
      ],
    },
    {
      kind: "concept",
      title: "Streaming the reply: a producer/consumer queue",
      body: [
        "Here's the trick that makes SnapServe feel fast. The LLM streams its reply token by token. Rather than wait for the full reply, the pipeline runs **two things at once**: a *producer* that watches the token stream and chops it into complete sentences, and a *consumer* that synthesizes and plays each sentence the instant it lands.",
        "They're connected by a tiny in-memory queue (`sentenceQueue`) and a one-shot wake-up function (`wakePlayer`). The producer pushes a sentence and 'rings the bell'; the consumer, which was asleep awaiting the bell, wakes up and speaks it. When the producer is done, it flips `allEnqueued = true` so the consumer knows to stop after draining the queue.",
        "This is the classic **producer/consumer** pattern, built from nothing but a `Promise` and a callback — no library needed.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "Inside processTurn: the queue, the producer's enqueue(), and the consumer's playTask() loop.",
      code: `const sentenceQueue: string[] = [];
let wakePlayer: (() => void) | null = null;

const enqueue = (text: string): void => {
  // …record first-clause timing…
  sentenceQueue.push(text);
  if (wakePlayer) {
    const wake = wakePlayer;
    wakePlayer = null;
    // …honor agent.incrementalDelay…
    wake();
  }
};

const playTask = async (): Promise<void> => {
  let idx = 0;
  while (true) {
    if (idx < sentenceQueue.length) {
      const text = sentenceQueue[idx++];
      this.bargeInHoldUntil = Date.now() + this.bargeInEchoGraceMs;
      this.isPlaying = true;
      try {
        await this.playSentence(text);
      } catch (err) {
        // …log the TTS error + onFatalError…
      }
      if (this.bargeInRequested) break;
    } else if (allEnqueued) {
      break;
    } else {
      await new Promise<void>((r) => { wakePlayer = r; });
    }
  }
  this.isPlaying = false;
  this.armTailEchoGrace();
  await this.drainPlaybackTail();
};

const playPromise = playTask();`,
      lines: [
        {
          lines: "1-2",
          label: "the shared channel",
          explanation:
            "`sentenceQueue` holds sentences waiting to be spoken. `wakePlayer` is a 'doorbell': when the consumer has nothing to do, it parks a resolve function here and falls asleep.",
        },
        {
          lines: "4-13",
          label: "enqueue — the producer side",
          explanation:
            "Push a finished sentence, then if the consumer is parked, grab its wake function, clear the slot, and call it. The `incrementalDelay` lets an agent pace its sentences slightly for a more natural cadence.",
        },
        {
          lines: "18-20",
          label: "speak the next sentence",
          explanation:
            "If there's a sentence ready, take it, set `isPlaying = true`, and (re)arm the echo-grace window so the carrier's echo of our own voice isn't mistaken for the caller barging in.",
        },
        {
          lines: "22-26",
          label: "await playSentence + barge-in check",
          explanation:
            "Synthesize and stream the sentence to the caller. If the caller interrupted (`bargeInRequested`), break out immediately — stop talking and listen.",
        },
        {
          lines: "27-31",
          label: "the wait/finish branches",
          explanation:
            "Queue is empty: if the producer signalled `allEnqueued`, we're done. Otherwise, park `wakePlayer` and `await` — the consumer sleeps with zero CPU until `enqueue` rings the bell.",
        },
        {
          lines: "33-36",
          label: "tail drain",
          explanation:
            "When the loop ends, clear `isPlaying`, arm a tail echo grace, and `drainPlaybackTail()` — send real silence so the carrier's jitter buffer plays out the final word instead of clipping it.",
        },
        {
          lines: "38",
          label: "const playPromise = playTask()",
          explanation:
            "Crucially, we **don't await** here. The consumer starts running in the background while the LLM stream (the producer) is still being consumed below.",
        },
      ],
    },
    {
      kind: "code",
      filename: "orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "And here's the producer feeding it: the LLM token callback. Every token the model emits passes through this — the live bridge from LLM to TTS.",
      code: `await this.llm.chat(
  historyForLlm,
  systemPromptForTurn,
  (token) => {
    if (!llmFirstTokenAt) {
      llmFirstTokenAt = Date.now();
      // LLM responded in time — cancel the dead-air filler before it fires
      if (fillerTimer) { clearTimeout(fillerTimer); fillerTimer = null; }
    }
    llmResponse += token;                  // keep raw response (incl. think blocks)
    const afterThink = filterThinkToken(token);
    if (!afterThink) return;               // token was entirely inside a think block
    // …strip <function=…> tags, markup, [instruction] leaks…
    pendingText += afterBrackets;
    const { sentences, remainder } = extractSentences(pendingText, this.agent.ttsMinSentenceChars);
    for (const s of sentences) { const g = stepGuard.push(s); if (g) enqueue(g); }
    pendingText = remainder;
  },
  (fullText) => { llmResponse = fullText; },
  // …tool defs + onUsage…
);`,
      lines: [
        {
          lines: "1-3",
          label: "this.llm.chat(history, prompt, …)",
          explanation:
            "Call the LLM adapter with the (possibly trimmed) conversation history and the assembled system prompt for this turn. The next argument is the per-token callback.",
        },
        {
          lines: "5-9",
          label: "first-token housekeeping",
          explanation:
            "On the very first token, record the time (for latency metrics) and cancel the dead-air filler timer — the model is talking, so we no longer need to play a 'one sec…' filler.",
        },
        {
          lines: "10-13",
          label: "filter pipeline",
          explanation:
            "Keep the raw token for the stored transcript, then run it through filters that strip `<think>` blocks, inline `<function=…>` tags, markup, and leaked `[instructions]` — none of that should be spoken aloud.",
        },
        {
          lines: "14-17",
          label: "extractSentences → enqueue",
          explanation:
            "Append the clean token to `pendingText`, then pull any **complete** sentences out of it. Each completed sentence is pushed through the one-step guard and `enqueue`d — instantly waking the player. The leftover partial stays in `pendingText` for the next token. This is why audio starts before the model finishes.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "The half-duplex self-echo gate",
      body: [
        "On telephony (non-webcall) paths there's no acoustic echo cancellation, so the carrier echoes the agent's own TTS back as 'caller audio'. Fed to STT, it gets transcribed as a phantom caller turn that interrupts the agent (this really happened — call 772 killed its own greeting).",
        "The fix in `handleProcessedAudio` is a **selective** gate: while the agent is playing (or within the post-playback tail), drop incoming frames **unless** they exceed the high barge-in energy threshold. A genuinely loud caller still gets through; only the quiet carrier echo of our own voice is suppressed. Web calls rely on browser AEC and stay full-duplex, so the gate is restricted to `telephonyProvider !== \"webcall\"`.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "The pipeline is the hub the whole call rotates around. Click any box to jump to its chapter.",
      nodes: [
        { id: "provider", label: "Telephony provider", sublabel: "Twilio / Plivo / VoBiz", chapterSlug: "telephony-overview" },
        { id: "audio", label: "decodeMulaw / encodeMulaw", sublabel: "audio.ts", chapterSlug: "audio-ts" },
        { id: "pipeline", label: "OrchestrationPipeline", sublabel: "pipeline.ts — THIS FILE", current: true },
        { id: "endpoint", label: "computeEndpointMs()", sublabel: "endpointing.ts", chapterSlug: "endpointing" },
        { id: "stt", label: "STT adapter", sublabel: "speech → text", chapterSlug: "stt-adapters" },
        { id: "llm", label: "LLM adapter", sublabel: "text → reply tokens", chapterSlug: "llm-adapters" },
        { id: "tts", label: "TTS adapter", sublabel: "reply → speech", chapterSlug: "tts-adapters" },
      ],
      edges: [
        { from: "provider", to: "pipeline", label: "μ-law frames (onAudioIn)" },
        { from: "pipeline", to: "audio", label: "decode in / encode out" },
        { from: "pipeline", to: "endpoint", label: "is the turn over?" },
        { from: "pipeline", to: "stt", label: "buffered audio" },
        { from: "stt", to: "pipeline", label: "transcript" },
        { from: "pipeline", to: "llm", label: "history + prompt" },
        { from: "llm", to: "pipeline", label: "reply tokens" },
        { from: "pipeline", to: "tts", label: "sentences" },
        { from: "tts", to: "pipeline", label: "audio chunks" },
        { from: "pipeline", to: "provider", label: "reply audio" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why is `OrchestrationPipeline` a class with one instance per call rather than a set of shared functions?",
          choices: [
            "Classes are faster in Node.",
            "A call is deeply stateful — audio buffer, conversation history, timers, and locks must persist across thousands of frames for that one call.",
            "TypeScript requires classes for async code.",
            "So it can be exported.",
          ],
          correctIndex: 1,
          explanation:
            "Every method reads and writes per-call state (audioBuffer, conversationHistory, isProcessing, timers). One instance owns that state for the call's lifetime, then tears down at `close()`.",
        },
        {
          prompt: "What does `const playPromise = playTask();` (without `await`) accomplish?",
          choices: [
            "It runs the player synchronously, blocking the LLM stream.",
            "It starts the TTS consumer running in the background so it can speak sentences while the LLM is still producing them.",
            "It cancels the previous turn.",
            "Nothing — it's a no-op.",
          ],
          correctIndex: 1,
          explanation:
            "Not awaiting lets the consumer (`playTask`) run concurrently with the producer (the LLM token callback). The producer `enqueue`s sentences and the consumer speaks them in parallel — that overlap is what cuts perceived latency.",
        },
        {
          prompt: "Why does `scheduleSilenceFlush` ask `computeEndpointMs` for the wait time instead of using a fixed constant?",
          choices: [
            "To save memory.",
            "Because the right amount of silence depends on context — a slow digit read needs a longer wait than a quick 'yes'.",
            "Because timers can't use constants.",
            "To make the logs longer.",
          ],
          correctIndex: 1,
          explanation:
            "Endpointing is adaptive: it factors in what the agent last asked, any partial transcript, and how long the caller spoke. A fixed window would either cut people off or leave dead air.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "One `OrchestrationPipeline` instance is created per call and holds all of its state: audio buffer, conversation history, timers, and locks.",
        "`onAudioIn` is the front door: decode μ-law, record, then offload DSP/VAD to a worker that calls back into `handleProcessedAudio`.",
        "Turn-taking is buffer-while-speaking, then arm an **adaptive** silence timer (`scheduleSilenceFlush` → `computeEndpointMs`) that fires `flushAndProcess`.",
        "`processTurn` runs a producer/consumer: the LLM token callback chops the stream into sentences and `enqueue`s them; `playTask` speaks each one the moment it arrives.",
        "Starting `playTask()` without `await` is what lets TTS overlap LLM generation — the core latency trick.",
        "A selective half-duplex gate drops the carrier's echo of the agent's own voice on telephony paths, while letting a genuinely loud caller barge in.",
      ],
    },
  ],
};
