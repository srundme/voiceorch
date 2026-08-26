import type { Chapter } from "../types";

export const llmPipelinePath: Chapter = {
  slug: "llm-pipeline-path",
  moduleId: "d3",
  number: "19.1",
  title: "The LLM Turn Loop in pipeline.ts",
  summary:
    "From final transcript to streamed reply: how processTurn() calls the LLM, splits tokens into sentences, guards tool envelopes, and reuses speculative prefill.",
  estMinutes: 20,
  fileRef: "artifacts/api-server/src/orchestration/pipeline.ts",
  prerequisites: ["session-and-pipeline", "llm-adapters"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "The LLM (Large Language Model — the AI 'brain' that writes the agent's replies) is the middle of every turn. The caller stops speaking, the STT (speech-to-text) engine hands us a **final transcript**, and now `processTurn()` has one job: turn those words into spoken audio, fast.",
        "This chapter walks the part of `processTurn()` that talks to the LLM. It is one method in a very large file (`pipeline.ts` is ~9,300 lines), so we quote only the LLM-relevant slices and skip the audio/barge-in plumbing around them. By the end you will have seen the actual call to `effectiveLlm.chat(...)`, the four callbacks it receives, and the sentence-splitter that feeds TTS (text-to-speech).",
        "The recurring theme is **latency**. Every design choice here — streaming instead of waiting, splitting into sentences, reusing a speculative prefill — exists to shrink the silence between the caller's last word and the agent's first word.",
      ],
    },
    {
      kind: "concept",
      title: "Streaming, tokens, and 'first token' latency",
      body: [
        "The LLM does not write a whole reply and hand it over. It **streams** — emitting a few characters at a time, called **tokens**. Our adapter forwards each token to an `onToken(token)` callback as it arrives.",
        "The moment the very first token arrives is called **TTFT** (Time To First Token). It is the single most important latency number for a voice agent, because we cannot start speaking until we have at least one full sentence of text.",
        "So the pipeline does not wait for the whole reply. It accumulates tokens into `pendingText`, runs a **sentence extractor** over that buffer, and the instant a complete sentence appears it ships that sentence to TTS while the LLM is still writing the rest.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "processTurn() begins by resetting per-turn state and logging. The transcript is the caller's finalized words; sttLatencyMs is how long STT took.",
      code: `private async processTurn(transcript: string, sttLatencyMs: number): Promise<void> {
    this.bargeInRequested = false;
    this.bargeInSpeechFrames = 0;
    this.streamingBargeInWordCount = 0;
    this._currentTurnPlayedSentences = [];
    this.firstAudioSentAt = null;
    const _currentTurnIndex = ++this.turnIndex;
    this._activeTurnIndex = _currentTurnIndex;
    this._tTurnLlmFirstToken  = null;
    this._tTurnLlmFirstClause = null;
    // ...
    logger.info({ callId: this.config.callId, transcript, sttLatencyMs }, "Processing turn");`,
      lines: [
        {
          lines: "1",
          label: "the entry point",
          explanation:
            "`processTurn` is `async` and takes the finalized caller `transcript`. Every agent reply flows through here. It is called once per turn, after STT declares the caller done.",
        },
        {
          lines: "2-7",
          label: "reset barge-in + turn state",
          explanation:
            "**Barge-in** means the caller talking over the agent. Each new turn clears the barge-in flags and per-turn trackers so stale state from the previous turn cannot leak in.",
        },
        {
          lines: "8-12",
          label: "timing anchors",
          explanation:
            "`_tTurnLlmFirstToken` and `_tTurnLlmFirstClause` are reset to null; they get stamped later when the first LLM token and first complete sentence appear. These power the TTFT metrics in the execution log.",
        },
      ],
    },
    {
      kind: "prose",
      paragraphs: [
        "Between reset and the LLM call there is a lot of guarding we will skip: dropping ultra-short noise fragments, a caller-farewell short-circuit that ends the call without the LLM, a garbled-transcript clarification, and a fast guardrail classifier that can answer with a canned phrase. All of these can `return` early so the LLM is never called. We rejoin the code once those pass and the turn genuinely needs the LLM.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "Tool definitions are assembled, the LLM clock starts, and the sentence-buffer variables are declared.",
      code: `    // ── Build tool definitions from agent config ──
    const toolDefs = buildToolDefs(this.agent.tools);
    toolDefs.push(SCHEDULE_CALLBACK_TOOL_DEF);

    const llmStart = Date.now();
    let llmFirstTokenAt: number | null = null;

    let llmResponse = "";
    let pendingText  = "";
    const stepGuard = makeFlowStepGuard({ maxSentences: VOICE_MAX_SENTENCES_PER_TURN });
    let allEnqueued  = false;
    let llmFirstSentenceProcessed = false;
    let triggeredToolName: string | null = null;
    let triggeredToolArgs: Record<string, unknown> = {};`,
      lines: [
        {
          lines: "2-3",
          label: "tools",
          explanation:
            "`buildToolDefs` converts the agent's configured tools (end_call, book_appointment, etc.) into the LLM-facing schema. The schedule-callback tool is always added.",
        },
        {
          lines: "5-6",
          label: "the TTFT gate",
          explanation:
            "`llmStart` is the clock. `llmFirstTokenAt` stays `null` until the first token arrives — this one variable is a **gate** used all over the retry/fallback logic: 'has any token streamed yet?' If null, we can safely retry; if set, retrying would double-speak.",
        },
        {
          lines: "8-9",
          label: "the sentence buffer",
          explanation:
            "`llmResponse` keeps the RAW reply (including think-blocks for logging). `pendingText` is the working buffer the sentence extractor chews on.",
        },
        {
          lines: "10",
          label: "the flow-step guard",
          explanation:
            "`makeFlowStepGuard` caps how many sentences one turn may speak (`VOICE_MAX_SENTENCES_PER_TURN`). It stops the agent from dumping five sentences and two questions in a single breath.",
        },
      ],
    },
    {
      kind: "prose",
      paragraphs: [
        "Next the method assembles the system prompt for this turn (language guard, KB context, gender directive, tool guides, and the date/time tail) and resolves KB retrieval. That assembly is the subject of the next chapter, so we skip it here and jump to the actual LLM call.",
      ],
    },
    {
      kind: "concept",
      title: "Speculative prefill (the 'eager LLM')",
      body: [
        "When the caller is *still* speaking, the pipeline can secretly launch an LLM call on the partial transcript — a **speculative** (a.k.a. eager) prefill. Its tokens are buffered, not spoken.",
        "When the real final transcript arrives, `processTurn` checks: is the partial close enough to the final? If yes, it's a **hit** — replay the already-buffered tokens instantly (near-zero TTFT). If no, it's a **miss** — abort the speculative call and do a normal LLM call.",
        "The clever part: on a hit, the pipeline swaps in a fake adapter (`effectiveLlm`) whose `chat()` just drains the buffered tokens and forwards new ones, so the rest of the turn code is completely unchanged.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "Consuming a speculative prefill. `_spec` is the buffered speculative state; `effectiveLlm` starts as the real adapter and is only replaced when the final transcript hash matches the prefill input.",
      code: `    const _spec = this._specLlmState;
    this._specLlmState = null;
    let effectiveLlm: typeof this.llm = this.llm;
    if (_spec) {
      const recon = reconcileSpeculativePrefill({
        aborted: _spec.aborted,
        hasToolCall: Boolean(_spec.storedToolCall),
        langAtLaunch: _spec.langAtLaunch,
        langNow: this.currentLang,
        inputHash: _spec.inputHash,
        finalTranscript: transcript,
      });
      if (recon.action === "commit") {
        this._eagerLlmHitThisTurn = true;
        const spec = _spec;
        effectiveLlm = {
          chat: async (_h, _s, realOnToken, realOnDone, realOpts) => {
            const buffered = spec.storedTokens.splice(0);
            spec.tokenSink = (t) => realOnToken(t);
            for (const t of buffered) realOnToken(t);
            await spec.completedPromise;
            realOnDone(spec.storedFullText);
            if (spec.storedUsage && realOpts?.onUsage) realOpts.onUsage(spec.storedUsage);
          },
        } as unknown as typeof this.llm;
      } else {
        _spec.aborted = true;
      }
    }`,
      lines: [
        {
          lines: "1-3",
          label: "grab and consume the prefill",
          explanation:
            "`_specLlmState` is read then set to null (consumed once). `effectiveLlm` defaults to the real adapter `this.llm` — only a confirmed hash match replaces it.",
        },
        {
          lines: "5-14",
          label: "the hit conditions",
          explanation:
            "Prefill commits only when `reconcileSpeculativePrefill` returns hash_match: not aborted, no speculative tool call, language unchanged, and SHA-1 of the normalized final equals `inputHash`. Prefix extensions (\"I want to participate in the…\" vs \"…hackathon\") are a discard — those tokens never reach TTS.",
        },
        {
          lines: "16-25",
          label: "the mock adapter",
          explanation:
            "A tiny object with only a `chat()` method. Step 1 drains tokens buffered so far. Step 2 redirects the still-running speculative stream's `tokenSink` to the real `onToken`. Step 3 flushes the buffered tokens. Because JS is single-threaded, the splice+redirect is atomic — no token can slip through the gap. This redirect is the first moment speculative tokens can reach TTS.",
        },
        {
          lines: "26-28",
          label: "miss → abort",
          explanation:
            "On transcript_changed, language_switched, speculative_tool_call, or aborted: discard every buffered token. `effectiveLlm` stays the real adapter and processTurn runs on the authoritative final.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "A language switch makes a prefill wrong, not just slow",
      body: [
        "`reconcileSpeculativePrefill` returns `language_switched` when the prefill's system prompt was built for the language the caller was using *before*. If the caller switched languages on this final transcript, replaying the prefill answers in the WRONG language (this bit us on call 4814: a Tamil caller got an English turn-1 reply).",
        "So a language change is always treated as a miss, even if the buffered reply already finished. Correctness beats the latency win.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "The heart of the turn: the call to effectiveLlm.chat(), and the onToken callback that turns the token stream into TTS sentences. This is inside a retry loop covered in a later chapter.",
      code: `      await effectiveLlm.chat(
        historyForLlm,
        systemPromptForTurn,
        (token) => {
          if (this.bargeInRequested) return;
          if (!llmFirstTokenAt) {
            llmFirstTokenAt = Date.now();
            this._tTurnLlmFirstToken = performance.now();
            clearTtftFallbackTimer();
            this.onLlmFirstTokenReceived();
            if (fillerTimer) { clearTimeout(fillerTimer); fillerTimer = null; }
          }
          llmResponse += token;                  // keep raw response (incl. think blocks)
          const afterThink = filterThinkToken(token);
          if (!afterThink) return;
          const afterFn = filterFnTag(afterThink);
          if (!afterFn) return;
          const afterToolTail = filterToolTail(afterFn);
          if (!afterToolTail) return;
          const filtered = filterMarkup(afterToolTail);
          if (!filtered) return;
          const afterBrackets = filterBrackets(filtered);
          if (!afterBrackets) return;
          const afterEnvelope = envelopeGuard.filter(afterBrackets);
          if (!afterEnvelope) return;
          pendingText += afterEnvelope;
          const { sentences, remainder } = extractSentences(pendingText, this.agent.ttsMinSentenceChars);`,
      lines: [
        {
          lines: "1-3",
          label: "the four positional args",
          explanation:
            "`chat()` receives the conversation `historyForLlm`, the assembled `systemPromptForTurn`, an `onToken` callback (the big arrow function), and — off-screen below — an `onDone` and an `options` object with the tool callbacks.",
        },
        {
          lines: "5",
          label: "barge-in short-circuit",
          explanation:
            "If the caller started talking over the agent, drop the token immediately. We don't want to keep speaking a reply nobody is listening to.",
        },
        {
          lines: "6-12",
          label: "the first-token moment",
          explanation:
            "Only on the FIRST token: stamp `llmFirstTokenAt`, cancel the TTFT-fallback timer (the primary answered in time), and cancel the dead-air filler timer. This is the latency success signal for the whole turn.",
        },
        {
          lines: "13-24",
          label: "the filter chain",
          explanation:
            "Every token runs a gauntlet of filters before it can be spoken: strip `<think>` reasoning blocks, `<function=…>` inline tags, leaked tool-call tails, `<emotion>`/`<break>` markup, long `[instruction…]` bracket leaks, and finally the tool-envelope guard. If any filter fully consumes the token (returns empty), we `return` and speak nothing.",
        },
        {
          lines: "25-26",
          label: "buffer + extract sentences",
          explanation:
            "The cleaned text is appended to `pendingText`, then `extractSentences` pulls out any COMPLETE sentences (respecting `ttsMinSentenceChars`) and leaves the unfinished tail as `remainder`.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "The tool-envelope guard: never speak a tool call aloud",
      body: [
        "`envelopeGuard.filter(...)` is defense-in-depth. Adapters are *supposed* to resolve tool calls via the `onToolCall` callback, never as visible text. But some models (Sarvam especially) sometimes stream a tool call as plain JSON or a `[bracket]` envelope in the content.",
        "If that text reached TTS, the caller would literally hear the agent read out `{\"name\": \"transfer_to_human\"...}`. The guard sniffs the leading characters against the names of the tools offered this turn and withholds a genuine envelope from TTS — while letting ordinary bracketed text stream normally.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "Each extracted sentence passes the step guard and leading-ack suppression, then is enqueued to TTS. Below that: the onDone callback and the tool-call callbacks passed in options.",
      code: `          for (const s of sentences) {
            const g = stepGuard.push(s);
            if (!g) continue;
            if (!llmFirstSentenceProcessed) {
              llmFirstSentenceProcessed = true;
              if ((backchanneledThisTurn || this._fillerPlayedThisTurn) && isLlmLeadingAck(g)) {
                continue;
              }
            }
            enqueue(g);
          }
          pendingText = remainder;
        },
        (fullText) => { llmResponse = fullText; },
        toolDefs.length > 0
          ? {
              tools: toolDefs,
              onToolCall: (name, args) => {
                triggeredToolName = name;
                triggeredToolArgs = args;
              },
              // onToolDetected / onToolParsed / onUsage also passed here
              cacheBase: cacheBaseForTurn,
            }
          : { /* onUsage + cacheBase only */ }
      );`,
      lines: [
        {
          lines: "1-3",
          label: "step guard",
          explanation:
            "`stepGuard.push(s)` returns the sentence to speak, or a falsy value once the turn's sentence budget is spent (suppressing everything after the first natural yield point).",
        },
        {
          lines: "4-8",
          label: "leading-ack suppression",
          explanation:
            "If a filler like 'okay' or 'சரி' already played this turn (backchannel or dead-air) and the LLM's FIRST sentence is itself just an acknowledgment, drop it — otherwise the caller hears a double 'okay … okay'.",
        },
        {
          lines: "10",
          label: "enqueue → TTS",
          explanation:
            "`enqueue(g)` pushes the sentence as a `TtsSentenceJob` whose synthesis starts immediately, so sentence N+1's audio is fetched while sentence N is still playing. This is what closes the gap between sentences.",
        },
        {
          lines: "14",
          label: "onDone",
          explanation:
            "The third positional arg. When the stream finishes, the adapter calls `onDone(fullText)` and we store the final clean reply text.",
        },
        {
          lines: "17-20",
          label: "onToolCall envelope",
          explanation:
            "In `options` (the fourth arg), `onToolCall` fires when the model requests a tool. We just record the name and args here; the actual execution happens after `chat()` returns. `cacheBase` is the Gemini context-cache prefix, honoured only by the Google adapter.",
        },
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "The turn loop sits between STT and TTS, with the LLM adapters and prompt assembly feeding it.",
      nodes: [
        { id: "stt", label: "STT adapter", sublabel: "final transcript", chapterSlug: "stt-adapters" },
        { id: "assembly", label: "Prompt assembly", sublabel: "systemPromptForTurn", chapterSlug: "prompt-assembly" },
        { id: "turn", label: "processTurn()", sublabel: "pipeline.ts — THIS FILE", current: true },
        { id: "adapter", label: "effectiveLlm.chat()", sublabel: "streams tokens", chapterSlug: "gemini-adapter-complete" },
        { id: "fallback", label: "Fallback + retry", sublabel: "llmFirstTokenAt gate", chapterSlug: "fallback-and-retry" },
        { id: "tts", label: "TTS", sublabel: "speaks each sentence", chapterSlug: "tts-adapters" },
      ],
      edges: [
        { from: "stt", to: "turn", label: "transcript" },
        { from: "assembly", to: "turn", label: "system prompt" },
        { from: "turn", to: "adapter", label: "chat()" },
        { from: "adapter", to: "turn", label: "onToken / onToolCall" },
        { from: "turn", to: "fallback", label: "on error" },
        { from: "turn", to: "tts", label: "enqueue(sentence)" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why does the pipeline split the token stream into sentences instead of waiting for the whole reply?",
          choices: [
            "To save memory.",
            "So the first complete sentence can start playing via TTS while the LLM is still writing the rest — cutting the silence the caller hears.",
            "Because the LLM can only return one sentence at a time.",
            "To count words for billing.",
          ],
          correctIndex: 1,
          explanation:
            "Streaming + sentence extraction lets TTS begin on sentence 1 while sentence 2 is still being generated, which is the core latency win of the turn loop.",
        },
        {
          prompt: "What does `envelopeGuard.filter(...)` protect against?",
          choices: [
            "The LLM going over its token budget.",
            "A tool call that the model streamed as visible text (JSON or a bracket envelope) being spoken aloud to the caller.",
            "The caller barging in.",
            "The system prompt being too long.",
          ],
          correctIndex: 1,
          explanation:
            "It's defense-in-depth: if an adapter leaks a serialized tool call into the token stream, the guard withholds it from TTS so the agent never reads a tool call out loud.",
        },
        {
          prompt: "On a speculative-prefill HIT, why can the mock `effectiveLlm.chat()` replay buffered tokens without a race condition?",
          choices: [
            "Because it uses a mutex lock.",
            "Because JavaScript is single-threaded, so the `splice(0)` drain and the `tokenSink` redirect happen atomically — no new token can arrive in between.",
            "Because tokens are stored in a database.",
            "Because the speculative call is paused first.",
          ],
          correctIndex: 1,
          explanation:
            "Single-threaded JS means no other code runs between draining the stored tokens and redirecting the sink, so buffered and future tokens are handed off cleanly.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "`processTurn(transcript, sttLatencyMs)` is the LLM turn loop; it resets per-turn state, then calls `effectiveLlm.chat()` with history, system prompt, `onToken`, `onDone`, and tool callbacks.",
        "`llmFirstTokenAt` is the central gate: null means no token streamed yet (safe to retry), set means we've started speaking (retry would double-speak).",
        "Tokens run a filter chain (think-blocks, function tags, tool tails, markup, brackets, tool-envelope guard) before `extractSentences` produces complete sentences for TTS.",
        "Each sentence passes a step guard and leading-ack suppression, then `enqueue()` starts its TTS synthesis immediately so audio overlaps generation.",
        "Speculative prefill: on a hit, a mock adapter replays buffered tokens for near-zero TTFT; a language switch always forces a miss to avoid wrong-language replies.",
        "The tool-envelope guard ensures a tool call is never spoken aloud even if an adapter leaks it as text.",
      ],
    },
  ],
};
