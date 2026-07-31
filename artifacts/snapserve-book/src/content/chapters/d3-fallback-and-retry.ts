import type { Chapter } from "../types";

export const fallbackAndRetry: Chapter = {
  slug: "fallback-and-retry",
  moduleId: "d3",
  number: "19.5",
  title: "LLM Fallback and Transient Retry",
  summary:
    "The llmFirstTokenAt gate, the bounded same-provider retry for transient errors, the TTFT-fallback timer that cancels a slow primary, and the secondary fallback LLM adapter.",
  estMinutes: 18,
  fileRef: "artifacts/api-server/src/orchestration/pipeline.ts",
  prerequisites: ["llm-pipeline-path", "fallback-chains"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "LLM providers have bad moments. A 503, a rate-limit 429, a stalled connection. On a phone call there's no 'try again' button — silence is a failed call. So the pipeline has three layers of protection around the LLM call: a **bounded same-provider retry** for momentary blips, a **TTFT-fallback timer** that cancels a too-slow primary, and a **secondary fallback LLM** (a different provider) for hard failures.",
        "All three layers hinge on one variable you met in chapter 19.1: `llmFirstTokenAt`. If it's still `null`, no token has streamed, nothing has been spoken, and we can safely retry or switch. Once it's set, we've started speaking — retrying now would make the agent say the reply twice. This chapter reads the real retry/fallback code.",
      ],
    },
    {
      kind: "concept",
      title: "Transient vs deterministic errors",
      body: [
        "A **transient** error is momentary and usually fixed by trying again: 429 (rate limit), 5xx (server overloaded), a socket reset, a DNS hiccup, a timeout. Retrying makes sense.",
        "A **deterministic** error will fail identically no matter how many times you retry: 400 (bad request), 401 (bad auth), quota exhausted. Retrying just wastes time and money.",
        "The pipeline classifies errors with `isRetryableLlmError()`. Only transient errors get a same-provider retry; deterministic ones go straight to the fallback LLM (or fail the turn).",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "The transient-error classifier. It sniffs the error message for known momentary-failure signatures.",
      code: `function isRetryableLlmError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  if (!msg) return false;
  if (/\\b(429|500|502|503|504)\\b/.test(msg)) return true;
  return (
    msg.includes("service unavailable") ||
    msg.includes("high demand") ||
    msg.includes("overloaded") ||
    msg.includes("try again") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up") ||
    msg.includes("fetch failed")
  );
}`,
      lines: [
        {
          lines: "4",
          label: "HTTP status codes",
          explanation:
            "429 (rate limit) and 5xx (server errors) are the classic transient codes — all worth a quick retry.",
        },
        {
          lines: "5-16",
          label: "message signatures",
          explanation:
            "Providers phrase transient failures differently ('overloaded', 'high demand', 'try again later') and network faults surface as `econnreset`/`socket hang up`/`fetch failed`. Matching these strings catches errors that don't carry a clean status code.",
        },
        {
          lines: "1-17",
          label: "everything else is NOT retryable",
          explanation:
            "Deterministic 4xx (bad request, auth, quota-exhausted) return false — they'd fail identically on retry, so we don't waste a turn on them.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "The retry loop: 1 initial attempt + up to 2 same-provider retries. Between attempts it resets per-attempt stream state and backs off.",
      code: `    const MAX_LLM_ATTEMPTS = 3;
    let llmErr: unknown = null;
    // ...
    for (let llmAttempt = 1; llmAttempt <= MAX_LLM_ATTEMPTS; llmAttempt++) {
    if (llmAttempt > 1) {
      llmResponse = "";
      pendingText  = "";
      triggeredToolName = null;
      triggeredToolArgs = {};
      await new Promise<void>((r) => setTimeout(r, 300 * (llmAttempt - 1)));
      logWarningEvent(this.logFn, EXEC_COMPONENTS.LLM, "LLM Retry", ["llm_retry"], {
        provider: this.agent.llmProvider,
        retryCount: llmAttempt - 1,
        detail: { event: "LLM Retry (same provider, transient error)", attempt: llmAttempt },
      });
    }`,
      lines: [
        {
          lines: "1",
          label: "3 attempts total",
          explanation:
            "`MAX_LLM_ATTEMPTS = 3` — one initial try plus two retries. Bounded so a persistently-failing provider can't loop forever on a live call.",
        },
        {
          lines: "6-9",
          label: "reset per-attempt state",
          explanation:
            "On a retry, the per-attempt stream buffers (`llmResponse`, `pendingText`) and tool state are cleared. This is safe ONLY because we only reach here when no token had streamed — see the gate below.",
        },
        {
          lines: "10",
          label: "linear backoff",
          explanation:
            "A short 300 ms × (attempt−1) backoff gives the provider a moment to recover. The ambient/keepalive audio pump keeps the phone line alive during this sub-second window.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "The catch block: the llmFirstTokenAt gate decides whether a retry is even legal.",
      code: `    } catch (err) {
      llmErr = err;
      clearTtftFallbackTimer();
      if (fillerTimer) { clearTimeout(fillerTimer); fillerTimer = null; }
      if (llmAttempt < MAX_LLM_ATTEMPTS && llmFirstTokenAt === null && isRetryableLlmError(err)) {
        continue;
      }
      break;
    }
    } // end LLM attempt loop`,
      lines: [
        {
          lines: "5-7",
          label: "the retry gate",
          explanation:
            "Three conditions must ALL hold to retry: attempts remain, `llmFirstTokenAt === null` (no token streamed → no double-speak risk), and the error is transient. If any fails, break out and let the fallback logic run.",
        },
        {
          lines: "8",
          label: "break otherwise",
          explanation:
            "A deterministic error, exhausted attempts, or an error AFTER tokens started → stop retrying. `llmErr` is still set, so the fallback-LLM block runs next.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "why",
      title: "Why `llmFirstTokenAt === null` guards every recovery",
      body: [
        "Retrying (or switching to the fallback) means re-running the LLM from scratch. If the first attempt had already streamed tokens — and therefore already spoken sentences to the caller — a fresh run would speak the whole reply AGAIN.",
        "So every recovery path is gated on `llmFirstTokenAt === null`: recover only if nothing has been spoken yet. Once one token is out, an error mid-stream just propagates; we accept a partial reply over a double reply.",
      ],
    },
    {
      kind: "concept",
      title: "The TTFT-fallback timer",
      body: [
        "A retry handles a provider that ERRORS. But what about a provider that just goes SLOW — accepts the request and then stalls, never erroring? A voice caller won't wait 10 seconds in silence.",
        "So the pipeline arms a timer (`LLM_TTFT_FALLBACK_MS`, default 1200 ms). If the primary hasn't produced a first token by then, the timer CANCELS the in-flight primary request (`cancelInFlight()`), which surfaces as an error and lets the fallback LLM take over.",
        "The timer only arms when a fallback LLM exists and we're on the primary. It's cancelled the instant the first token arrives.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "Arming the TTFT-fallback timer, and cancelling it on the first token.",
      code: `    const armTtftFallbackTimer = () => {
      clearTtftFallbackTimer();
      if (!this.fallbackLlm || effectiveLlm !== this.llm) return;
      ttftFallbackTimer = setTimeout(() => {
        if (llmFirstTokenAt || this.bargeInRequested || this.closed) return;
        logger.warn(
          { callId: this.config.callId, thresholdMs: LLM_TTFT_FALLBACK_MS, provider: this.agent.llmProvider },
          "Primary LLM TTFT exceeded — cancelling in-flight request for fallback",
        );
        this.llm.cancelInFlight?.();
      }, LLM_TTFT_FALLBACK_MS);
    };`,
      lines: [
        {
          lines: "3",
          label: "only when it makes sense",
          explanation:
            "No fallback configured, or we're already replaying a speculative prefill (`effectiveLlm !== this.llm`)? Then don't arm — there's nothing to fall back to, or the reply is already flowing.",
        },
        {
          lines: "5",
          label: "double-check on fire",
          explanation:
            "When the timer fires, re-check: if a token already arrived, or the caller barged in, or the call closed, do nothing. This avoids cancelling a request that just succeeded.",
        },
        {
          lines: "10",
          label: "cancelInFlight()",
          explanation:
            "Cancels the stalled primary request (Krutrim's AbortController, for example). That surfaces as an error, which drops us into the fallback-LLM block below.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "The fallback LLM is initialised once at session start, only if the agent configured one and its key is available.",
      code: `    if (this.agent.fallbackLlmProvider) {
      const fallbackKey = keys.get(this.agent.fallbackLlmProvider);
      if (fallbackKey) {
        this.fallbackLlm = createLLMAdapter(this.agent.fallbackLlmProvider, fallbackKey, this.agent.fallbackLlmModel ?? null, undefined, this.agent.llmGenerationParams, config.callId);
        logger.info({ callId: config.callId, fallbackProvider: this.agent.fallbackLlmProvider }, "Fallback LLM adapter initialised");
      }
    }`,
      lines: [
        {
          lines: "1-2",
          label: "configured provider + key",
          explanation:
            "The fallback is a SECOND provider (e.g. primary Gemini, fallback Groq). It's built only if `fallbackLlmProvider` is set AND a key for it exists — no key, no fallback.",
        },
        {
          lines: "4",
          label: "same factory",
          explanation:
            "`createLLMAdapter` is the same factory used for the primary, so the fallback is a fully-featured adapter with the same generation params and call id.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "After the retry loop, if the primary still failed with no token streamed, the fallback LLM runs the same turn.",
      code: `    if (llmErr) {
      if (this.fallbackLlm && llmFirstTokenAt === null) {
        logger.warn({ callId: this.config.callId, err: llmErr, fallbackProvider: this.agent.fallbackLlmProvider }, "Primary LLM failed (no tokens) — retrying with fallback LLM");
        llmResponse = "";
        pendingText  = "";
        llmFirstSentenceProcessed = false; // reset so fallback can also suppress its leading ack
        try {
          await this.fallbackLlm.chat(
            historyForLlm,
            systemPromptForTurn,
            (token) => { /* same filter chain + enqueue as the primary */ },
            (fullText) => { llmResponse = fullText; },
            { onUsage: (usage) => { /* accumulate tokens */ } },
          );
          logger.info({ callId: this.config.callId }, "Fallback LLM succeeded");
        } catch (fallbackErr) {
          // both providers failed → fatal for this turn
          this.config.onFatalError?.(toReadableError(fallbackErr, "Fallback LLM error"));
          throw fallbackErr;
        }
      }
    }`,
      lines: [
        {
          lines: "2",
          label: "the same gate again",
          explanation:
            "The fallback only runs if a fallback adapter exists AND no token has streamed. If the primary already spoke, we don't re-run — same double-speak protection.",
        },
        {
          lines: "8-13",
          label: "identical call shape",
          explanation:
            "The fallback gets the EXACT same history, system prompt, and callbacks as the primary. The `onToken` runs the same filter chain and sentence enqueue, so the caller can't tell which provider answered.",
        },
        {
          lines: "16-19",
          label: "both failed → fatal",
          explanation:
            "If the fallback ALSO throws, both providers are down for this turn. There's nothing left to try, so `onFatalError` fires and the error propagates to end the turn cleanly.",
        },
      ],
    },
    {
      kind: "analogy",
      title: "A backup generator, not a second attempt",
      body: [
        "Same-provider retry is like flicking a flaky light switch a couple of times — often the power's fine, it just glitched. The TTFT timer is the fuse: if the lights don't come on within 1.2 seconds, stop waiting.",
        "The fallback LLM is the backup generator: a completely separate power source (a different provider). You only start it when the mains are truly down, and only if nothing important has already been said in the dark.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      nodes: [
        { id: "turn", label: "processTurn()", sublabel: "retry loop", chapterSlug: "llm-pipeline-path" },
        { id: "gate", label: "llmFirstTokenAt", sublabel: "the recovery gate", current: true },
        { id: "retry", label: "isRetryableLlmError", sublabel: "transient?", current: true },
        { id: "timer", label: "TTFT timer", sublabel: "cancelInFlight()", current: true },
        { id: "fallback", label: "fallbackLlm", sublabel: "second provider", current: true },
        { id: "adapter", label: "LLM adapters", sublabel: "primary + fallback", chapterSlug: "openai-compat-adapters" },
      ],
      edges: [
        { from: "turn", to: "retry", label: "on error" },
        { from: "retry", to: "gate", label: "checks" },
        { from: "timer", to: "adapter", label: "cancels slow primary" },
        { from: "gate", to: "fallback", label: "null → allowed" },
        { from: "fallback", to: "adapter", label: "second chat()" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why is every LLM recovery path gated on `llmFirstTokenAt === null`?",
          choices: [
            "To save tokens.",
            "Because once a token has streamed, sentences have already been spoken; re-running the LLM would make the agent say the reply twice.",
            "Because null means the call ended.",
            "To measure latency.",
          ],
          correctIndex: 1,
          explanation:
            "A retry or fallback re-runs the LLM from scratch. If speech already started, that would double-speak — so recovery is only allowed before the first token.",
        },
        {
          prompt: "What does the TTFT-fallback timer do that a same-provider retry does NOT?",
          choices: [
            "Nothing, they're identical.",
            "It handles a primary that goes SLOW (stalls without erroring) by cancelling the in-flight request after ~1200 ms so the fallback LLM can take over.",
            "It retries deterministic 4xx errors.",
            "It speeds up TTS.",
          ],
          correctIndex: 1,
          explanation:
            "A retry reacts to an error; the TTFT timer reacts to silence — it cancels a stalled-but-not-errored primary so a fallback can respond in time.",
        },
        {
          prompt: "When does the fallback LLM adapter get created?",
          choices: [
            "On every turn.",
            "Once at session start, only if the agent configured a `fallbackLlmProvider` AND a key for that provider is available.",
            "Only after the primary fails 3 times.",
            "Never — it's the same as the primary.",
          ],
          correctIndex: 1,
          explanation:
            "It's built once during session init via `createLLMAdapter`, guarded on both a configured provider and an available key.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "`isRetryableLlmError` distinguishes transient (429/5xx/network) from deterministic (4xx/auth/quota) errors — only transient ones get retried.",
        "The retry loop allows 1 initial + 2 same-provider retries with linear backoff, resetting per-attempt buffers between tries.",
        "Every recovery path (retry AND fallback) is gated on `llmFirstTokenAt === null` to prevent double-speaking a reply that already started.",
        "The TTFT-fallback timer cancels a stalled-but-not-errored primary after ~1200 ms via `cancelInFlight()`, surfacing an error so the fallback can take over.",
        "The fallback LLM is a second provider, built once at session start (needs both a configured provider and a key), and runs the identical call shape so the caller can't tell who answered.",
        "If both primary and fallback fail with no token streamed, the turn is fatal (`onFatalError`).",
      ],
    },
  ],
};
