import type { Chapter } from "../types";

export const httpKeepalivePool: Chapter = {
  slug: "http-keepalive-pool",
  moduleId: "m5",
  number: "6.6",
  title: "The Hidden Tax: HTTP Keep-Alive",
  summary:
    "Every LLM and TTS call is an HTTPS request. Open a fresh connection each time and you pay a handshake tax on every single turn. One tiny file makes that tax disappear process-wide.",
  fileRef: "artifacts/api-server/src/orchestration/http/pool.ts",
  estMinutes: 13,
  prerequisites: ["adapter-pattern"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "A tax you can't see in the diagram",
      paragraphs: [
        "On the architecture diagram, an LLM call is just an arrow from our server to OpenAI. In reality, that arrow is an HTTPS request — and before a single byte of your prompt is sent, the two computers must perform a **handshake**: open a TCP connection, then negotiate TLS encryption. That handshake costs roughly 100–300 milliseconds. Pay it once and it's nothing. Pay it on **every turn of every call**, for the LLM *and* the TTS *and* the STT REST call, and you've quietly added a third of a second of dead air to each exchange.",
        "This chapter is about a single small file — `orchestration/http/pool.ts` — that eliminates that tax everywhere at once. It's a perfect example of a high-leverage, low-visibility optimization. Read it on GitHub at `srundme/voiceorch` → `artifacts/api-server/src/orchestration/http/pool.ts`.",
      ],
    },
    {
      kind: "analogy",
      title: "Don't hang up between sentences",
      body: [
        "Imagine you and a colleague need to exchange ten quick messages. You could phone them, say one thing, hang up, then redial for the next message — paying the dialling-and-greeting ritual ten times. Or you could call once and **keep the line open** for all ten. Obviously the second way.",
        "A fresh HTTPS request per turn is option one: redial every time. **Keep-alive** is option two: hold the connection open between requests so the next one skips the handshake. The pool just makes 'keep the line open' the default for the whole process.",
      ],
    },
    {
      kind: "concept",
      title: "Why the default isn't good enough",
      body: [
        "Node's networking already pools connections — but with a default idle timeout of only about **4 seconds**. On a voice call, the gap between turns is routinely longer than that: the caller pauses to think, reads out a number, or just breathes. So the pooled socket goes idle, gets dropped at 4 s, and the next provider call re-pays the full handshake anyway. The default is tuned for fast web traffic, not the slow, bursty rhythm of conversation.",
        "The fix is to install **one shared connection pool** with a much longer idle timeout (30 s by default), so sockets stay warm across realistic between-turn gaps.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/http/pool.ts",
      language: "typescript",
      intro:
        "The whole mechanism is a few lines: build one Agent with a long keep-alive timeout, then make it the GLOBAL dispatcher so every outbound request uses it.",
      code: `export function installSharedHttpPool(): Agent {
  if (installed && sharedAgent) return sharedAgent;
  sharedAgent = new Agent({
    keepAliveTimeout: KEEPALIVE_TIMEOUT_MS,      // default 30_000 (vs undici's ~4s)
    keepAliveMaxTimeout: KEEPALIVE_MAX_TIMEOUT_MS,
    connections: CONNECTIONS,                     // max sockets per origin
    pipelining: PIPELINING,                       // keep at 1 for HTTP/1.1
  });
  setGlobalDispatcher(sharedAgent);
  subscribeConnectionDiagnostics();
  installed = true;
  return sharedAgent;
}`,
      lines: [
        {
          lines: "2",
          label: "idempotent",
          explanation:
            "Guarded so it only ever installs once, no matter how many times it's called at startup. Returns the existing Agent on repeat calls.",
        },
        {
          lines: "4",
          label: "the one knob that matters",
          explanation:
            "keepAliveTimeout of 30 s comfortably exceeds normal between-turn gaps, so the socket to each provider stays warm and the next call skips the TCP+TLS handshake.",
        },
        {
          lines: "9",
          label: "setGlobalDispatcher — the magic word",
          explanation:
            "This is what makes it process-wide. undici's global dispatcher is what native fetch and the provider SDKs route through, so swapping it transparently upgrades every outbound HTTP call at once.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Process-wide, for free",
      body: [
        "Because `setGlobalDispatcher` replaces the dispatcher that **all** of undici (and therefore native `fetch` and the OpenAI/Google SDKs) uses, this single install covers far more than the LLM/TTS/STT adapters. Telephony provider REST calls (Plivo/Vobiz/Twilio call control), self-webhook dispatch, the memory proxy, Google Calendar, object storage — every outbound HTTP request in the process gets warm-socket reuse without any of that code being touched.",
        "One important exception: **WebSocket** streaming paths (streaming STT/TTS) don't go through this dispatcher, so they're unaffected — and they don't need it, since a WS connection is already long-lived by nature.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Shut down with close(), never destroy()",
      body: [
        "Graceful shutdown matters here. When the platform redeploys, it sends the process a SIGTERM. If we ripped the pool down with `destroy()`, any provider call **in flight on a live call** — like an LLM mid-stream — would be aborted, dropping a real conversation. So shutdown uses `Agent.close()`, which drains in-flight requests first and only then closes idle sockets. The caller's turn finishes; the redeploy waits the extra moment.",
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "How to know it's actually working",
      body: [
        "The file subscribes to undici's connection diagnostics and logs an `http_pool_connect` line every time a brand-new socket is opened. On a healthy warm pool that should be **rare** — roughly one per provider origin, even across many turns. If you see that count climbing during a single call, the keep-alive timeout is too low for that call's pacing and should be raised. The optimization comes with its own built-in proof.",
      ],
    },
    {
      kind: "connections",
      title: "Where the pool sits",
      intro: "It's invisible to the adapters — it lives underneath every outbound HTTP call they make.",
      nodes: [
        { id: "adapters", label: "Provider adapters", sublabel: "LLM / TTS / STT REST", chapterSlug: "adapter-pattern" },
        { id: "pool", label: "Shared HTTP pool", sublabel: "THIS CHAPTER", current: true },
        { id: "providers", label: "Provider APIs", sublabel: "OpenAI, ElevenLabs…" },
        { id: "fallback", label: "Fallback chains", sublabel: "also benefit", chapterSlug: "fallback-chains" },
      ],
      edges: [
        { from: "adapters", to: "pool", label: "fetch()" },
        { from: "pool", to: "providers", label: "warm socket" },
        { from: "fallback", to: "pool", label: "retries reuse sockets" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "What 'tax' does the HTTP keep-alive pool eliminate?",
          choices: [
            "The per-token cost of the LLM.",
            "The TCP + TLS handshake (~100–300 ms) paid when opening a fresh connection on every provider call.",
            "The cost of storing recordings.",
            "Database query time.",
          ],
          correctIndex: 1,
          explanation:
            "Each new HTTPS connection needs a handshake. Keeping sockets warm between turns lets subsequent calls skip it, removing that recurring latency.",
        },
        {
          prompt: "Why isn't Node's default connection pooling sufficient for voice calls?",
          choices: [
            "It doesn't pool at all.",
            "Its idle timeout (~4 s) is shorter than the gaps between conversational turns, so warm sockets get dropped and the next call re-handshakes.",
            "It only works for WebSockets.",
            "It's disabled in production.",
          ],
          correctIndex: 1,
          explanation:
            "The ~4 s default is tuned for fast web traffic. Voice turns are often longer apart, so the pool drops sockets right when the next turn needs them. A longer timeout (30 s) fixes it.",
        },
        {
          prompt: "Why does the pool shut down with close() instead of destroy()?",
          choices: [
            "close() is faster.",
            "close() drains in-flight requests first, so a provider call on a live call (e.g. an LLM mid-stream) finishes instead of being aborted during a redeploy.",
            "destroy() doesn't exist.",
            "To save memory.",
          ],
          correctIndex: 1,
          explanation:
            "On SIGTERM, destroy() would abort active calls. close() lets in-flight requests complete so a real conversation isn't dropped mid-turn during a deploy.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Every LLM/TTS/STT REST call is HTTPS; a fresh connection pays a 100–300 ms handshake tax.",
        "Node's default keep-alive timeout (~4 s) is shorter than between-turn gaps, so sockets get dropped and re-handshaken.",
        "One shared Agent with a 30 s timeout, installed via setGlobalDispatcher, keeps sockets warm process-wide.",
        "It covers ALL outbound HTTP (telephony REST, webhooks, calendar, storage), not just the adapters; WebSockets are unaffected.",
        "Shutdown uses Agent.close() so in-flight calls survive a redeploy; an http_pool_connect log proves reuse.",
      ],
    },
  ],
};
