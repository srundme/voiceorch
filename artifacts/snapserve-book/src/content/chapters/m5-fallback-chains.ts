import type { Chapter } from "../types";

export const fallbackChains: Chapter = {
  slug: "fallback-chains",
  moduleId: "m5",
  number: "6.5",
  title: "Fallback Chains: When a Provider Fails",
  summary:
    "How the pipeline survives a provider outage mid-call by failing over to a backup.",
  estMinutes: 12,
  fileRef: "artifacts/api-server/src/orchestration/pipeline.ts",
  prerequisites: ["llm-adapters", "stt-adapters"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Every adapter we've built so far assumes the vendor *answers*. But real APIs fail. OpenAI has an outage. Deepgram's WebSocket dies. Cartesia times out. When that happens in the middle of a live phone call, you can't show the caller a 'try again later' page — they're a human holding a phone, and silence means a lost customer.",
        "So SnapServe builds **fallback chains**: if the primary provider fails, automatically retry with a pre-configured backup, fast enough that the caller never notices. This is the safety net that turns a vendor outage from a dropped call into a barely-perceptible hiccup.",
        "Thanks to the adapter pattern, fallback is almost free: the backup is just another `LLMAdapter` built by the same factory. The pipeline holds two adapters — a primary and a fallback — and switches between them when needed. Let's see exactly how, and why the *timing* of the switch is everything.",
      ],
    },
    {
      kind: "concept",
      title: "Graceful degradation and the 'no tokens yet' rule",
      body: [
        "**Graceful degradation** means a system keeps working — maybe a little slower or simpler — when a part of it breaks, instead of collapsing entirely. A fallback chain is graceful degradation for providers: lose the best vendor, drop to the next-best, keep the call alive.",
        "But there's a subtle trap with **streaming**. If the primary LLM already streamed half a sentence to the caller's ear before it crashed, you *can't* cleanly retry — the caller already heard 'Your appointment is booked for…' and a fresh attempt would start a different sentence on top of it. Double audio, gibberish.",
        "So the golden rule: only fail over if the primary failed **before producing any tokens**. The pipeline tracks `llmFirstTokenAt` — the timestamp of the first streamed token. If it's still `null` when the error hits, nothing was spoken yet and a clean retry is safe. If it's set, the turn is already committed and we surface the error instead.",
      ],
    },
    {
      kind: "analogy",
      title: "The backup generator",
      body: [
        "A hospital doesn't go dark when the grid fails — a backup generator kicks in within seconds. But here's the nuance: the generator catches you at the *start* of an outage. If the surgeon is already mid-incision when the lights flicker, you don't 'restart the surgery' on the generator — you finish carefully.",
        "The LLM fallback is that generator: it fires instantly when the primary dies, but only if the turn hasn't 'started' yet — i.e., no tokens have been spoken. Once words are flowing, you ride it out rather than start over.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "Setup happens once, when the pipeline initializes: build the fallback adapter alongside the primary — but only if the agent configured one and its key exists.",
      code: `    this.llm = createLLMAdapter(this.agent.llmProvider, llmKey, this.agent.llmModel, undefined, this.agent.llmGenerationParams);
    // P0-B: Initialise fallback LLM adapter if the agent has one configured and the key is available
    if (this.agent.fallbackLlmProvider) {
      const fallbackKey = keys.get(this.agent.fallbackLlmProvider);
      if (fallbackKey) {
        this.fallbackLlm = createLLMAdapter(this.agent.fallbackLlmProvider, fallbackKey, this.agent.fallbackLlmModel ?? null, undefined, this.agent.llmGenerationParams);
        logger.info({ callId: config.callId, fallbackProvider: this.agent.fallbackLlmProvider }, "Fallback LLM adapter initialised");
      }
    }`,
      lines: [
        {
          lines: "1",
          label: "the primary",
          explanation:
            "The main brain, built by the same `createLLMAdapter` factory from the adapter-pattern chapter. Stored as `this.llm`.",
        },
        {
          lines: "3-4",
          label: "is a fallback configured?",
          explanation:
            "Fallback is opt-in per agent. If `fallbackLlmProvider` is set, we look up its API key. No provider configured → no fallback, and `this.fallbackLlm` stays `null`.",
        },
        {
          lines: "5-6",
          label: "build the backup with the SAME factory",
          explanation:
            "The beauty of the adapter pattern: the fallback is just another `LLMAdapter` from the identical factory — could be DeepSeek backing up OpenAI, or Sarvam backing up Groq. The pipeline treats both adapters identically because they share the interface.",
        },
        {
          lines: "5",
          label: "guard on the key",
          explanation:
            "We only build the fallback if its key is actually present (`if (fallbackKey)`). A configured-but-keyless fallback would just fail again — better to skip it than create a useless adapter.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "The failover itself lives in the `catch` block around the primary LLM call. This is where the backup generator kicks in.",
      code: `    } catch (llmErr) {
      if (fillerTimer) { clearTimeout(fillerTimer); fillerTimer = null; }
      _agnostTurn?.end(String(llmErr), false);
      // P0-B: LLM fallback — if primary failed before producing any tokens, retry with fallback adapter
      if (this.fallbackLlm && llmFirstTokenAt === null) {
        logger.warn({ callId: this.config.callId, err: llmErr, fallbackProvider: this.agent.fallbackLlmProvider }, "Primary LLM failed (no tokens) — retrying with fallback LLM");
        // …
        llmResponse = "";
        pendingText  = "";
        try {
          await this.fallbackLlm.chat(
            historyForLlm,
            systemPromptForTurn,
            (token) => {
              if (!llmFirstTokenAt) {
                llmFirstTokenAt = Date.now();
                this._tTurnLlmFirstToken = performance.now();
              }
              llmResponse += token;
              // …
            },
            (fullText) => { llmResponse = fullText; },
            { onUsage: (usage) => { /* …billing… */ } },
          );
          logger.info({ callId: this.config.callId }, "Fallback LLM succeeded");
        } catch (fallbackErr) {
          // …both failed: surface a fatal error…
          throw fallbackErr;
        }
      } else {`,
      lines: [
        {
          lines: "1-3",
          label: "primary threw",
          explanation:
            "The primary `chat()` rejected. First we cancel the filler-sound timer (no 'um, let me check' if we're about to retry) and mark the failed turn for tracing.",
        },
        {
          lines: "5",
          label: "the golden condition",
          explanation:
            "The whole chapter in one line: fail over only if `this.fallbackLlm` exists AND `llmFirstTokenAt === null` (nothing spoken yet). Both must hold. If a token already streamed, this branch is skipped and we fall to the error path instead — no double audio.",
        },
        {
          lines: "9-10",
          label: "reset the buffers",
          explanation:
            "Before retrying, wipe `llmResponse` and `pendingText` so the backup starts from a clean slate. Any partial state from the failed attempt is discarded.",
        },
        {
          lines: "11-24",
          label: "call the fallback adapter",
          explanation:
            "We invoke `this.fallbackLlm.chat(...)` with the SAME history and system prompt — identical call shape to the primary, because both are `LLMAdapter`s. Tokens stream through the same handling: set `llmFirstTokenAt` on the first one, accumulate, sentence-split, enqueue for TTS.",
        },
        {
          lines: "26-30",
          label: "both failed → fatal",
          explanation:
            "If even the backup throws, there's nothing left to try. The inner `catch` surfaces a fatal error to the caller and re-throws. Two providers down is a genuine outage, not a hiccup.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "You can't replay a half-spoken sentence",
      body: [
        "The `llmFirstTokenAt === null` check isn't an optimization — it's a correctness guard. Once the TTS has spoken even one word of the primary's reply, retrying with the fallback would layer a brand-new sentence on top of audio the caller already heard.",
        "That's why failover is strictly a **pre-first-token** rescue. Most LLM failures (auth errors, rate limits, connection refused) happen *before* any token streams, so this catches the vast majority of outages while staying safe.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "LLM isn't the only thing that can fail. The STT stream has its own resilience layer: reconnect with backoff, then fall back to batch transcription.",
      code: `        () => {
          // Stream closed — attempt reconnect unless the call is already over
          if (this.closed) return;
          this.streamSTT = null;
          const MAX_ATTEMPTS = 5;
          if (this.streamSTTReconnectAttempts >= MAX_ATTEMPTS) {
            logger.warn({ callId: this.config.callId }, "Streaming STT: max reconnect attempts reached — falling back to batch STT");
            return;
          }
          const backoffMs = Math.min(1000 * 2 ** this.streamSTTReconnectAttempts, 16000);
          this.streamSTTReconnectAttempts++;`,
      lines: [
        {
          lines: "1-3",
          label: "stream closed unexpectedly",
          explanation:
            "This callback fires when the STT WebSocket drops. If the call is already over (`this.closed`), do nothing. Otherwise clear the dead stream handle and prepare to recover.",
        },
        {
          lines: "5-8",
          label: "give up after 5 tries → batch",
          explanation:
            "After 5 failed reconnects, stop trying to stream and fall back to **batch** STT — slower, but it still transcribes. A different flavour of the same idea: degrade gracefully rather than go deaf.",
        },
        {
          lines: "10-11",
          label: "exponential backoff",
          explanation:
            "Each reconnect waits longer — `1000 * 2 ** attempts`, capped at 16 s. Backing off avoids hammering a provider that's already down, while the attempt counter drives both the cap and the give-up decision.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Resilience in layers",
      body: [
        "Notice there isn't ONE fallback — there are several, stacked. STT first tries to **reconnect** (5 times with backoff), then drops to **batch** transcription. The LLM keeps a whole **backup provider** on standby. Each layer catches a different kind of failure.",
        "This is defense in depth: no single point of failure can silence a call. And every layer is cheap to build precisely because the adapter pattern made providers interchangeable in the first place.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "Fallback logic wraps the adapters the pipeline already holds. Click to revisit the pieces.",
      nodes: [
        { id: "pipeline", label: "OrchestrationPipeline", sublabel: "pipeline.ts — THIS FILE", current: true },
        { id: "factory", label: "createLLMAdapter()", sublabel: "builds primary AND fallback", chapterSlug: "adapter-pattern" },
        { id: "primary", label: "Primary LLM", sublabel: "this.llm", chapterSlug: "llm-adapters" },
        { id: "fallback", label: "Fallback LLM", sublabel: "this.fallbackLlm", chapterSlug: "llm-adapters" },
        { id: "stt", label: "Streaming STT", sublabel: "reconnect → batch", chapterSlug: "stt-adapters" },
        { id: "session", label: "AgentConfig", sublabel: "fallbackLlmProvider setting", chapterSlug: "session-and-pipeline" },
      ],
      edges: [
        { from: "session", to: "pipeline", label: "fallback config" },
        { from: "factory", to: "primary", label: "creates" },
        { from: "factory", to: "fallback", label: "creates" },
        { from: "pipeline", to: "primary", label: "chat()" },
        { from: "primary", to: "fallback", label: "on failure (no tokens yet)" },
        { from: "pipeline", to: "stt", label: "reconnect / batch" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Under what condition does the pipeline fail over to the backup LLM?",
          choices: [
            "Whenever the primary is slow.",
            "Only if a fallback is configured AND the primary failed before streaming any tokens (`llmFirstTokenAt === null`).",
            "After every error, always.",
            "Only on the second turn of the call.",
          ],
          correctIndex: 1,
          explanation:
            "Failover requires both a configured fallback and that no token was spoken yet. If the caller already heard part of the reply, retrying would produce double audio.",
        },
        {
          prompt: "Why can't the pipeline retry once the primary LLM has already streamed some tokens?",
          choices: [
            "The API forbids it.",
            "The caller already heard part of a sentence; a fresh attempt would layer a new sentence on top → garbled double audio.",
            "Tokens are too expensive to regenerate.",
            "The fallback adapter doesn't support streaming.",
          ],
          correctIndex: 1,
          explanation:
            "Once audio has been spoken, the turn is committed. Retrying would overlay a different sentence on what the caller already heard, so failover is strictly pre-first-token.",
        },
        {
          prompt: "How does the streaming STT degrade when its WebSocket keeps dropping?",
          choices: [
            "It ends the call immediately.",
            "It reconnects up to 5 times with exponential backoff, then falls back to batch STT.",
            "It switches to the fallback LLM.",
            "It mutes the caller.",
          ],
          correctIndex: 1,
          explanation:
            "STT first retries the stream (5 attempts, backoff capped at 16 s), then drops to slower batch transcription — graceful degradation rather than going deaf.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Fallback chains keep a call alive when a provider fails mid-conversation — graceful degradation, not a dropped call.",
        "The fallback LLM is built by the same `createLLMAdapter` factory, so it's just another interchangeable `LLMAdapter`.",
        "Golden rule: fail over only if the primary died BEFORE streaming any tokens (`llmFirstTokenAt === null`) — you can't replay a half-spoken sentence.",
        "Failover lives in the `catch` block; if the backup also fails, the pipeline surfaces a fatal error.",
        "STT has its own resilience: reconnect up to 5 times with exponential backoff, then drop to batch transcription.",
        "Resilience is layered (reconnect → batch → backup provider), and it's cheap precisely because the adapter pattern made providers swappable.",
      ],
    },
  ],
};
