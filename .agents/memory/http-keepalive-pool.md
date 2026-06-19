---
name: Shared HTTP keep-alive pool
description: How/why outbound provider HTTP is pooled process-wide; the global-dispatcher scope and shutdown contract.
---

`orchestration/http/pool.ts` installs ONE shared `undici.Agent` as the global
dispatcher (`setGlobalDispatcher`) at api-server startup, before any provider
call.

**Why:** In Node 24, native `fetch`, the OpenAI SDK v6, and `@google/generative-ai`
all route through undici's global dispatcher. undici's default
`keepAliveTimeout` is ~4s — shorter than the silences between conversational
turns on a voice call — so pooled sockets die in the gap and every turn re-pays a
~100–300ms TCP+TLS handshake. A longer keepAliveTimeout (default 30s, env
`HTTP_POOL_KEEPALIVE_TIMEOUT_MS`) keeps them warm. Demonstrated: 4 sequential
requests to one origin → 1 socket opened.

**How to apply:**
- It's HTTP/1.1 keep-alive reuse only. Do NOT force h2 — these provider REST
  endpoints don't reliably negotiate it over undici.
- The dispatcher is **process-wide**: it also covers telephony provider REST,
  self-webhooks, memory proxy, Google Calendar, object storage — not just the
  five adapter families. WebSocket streaming STT/TTS bypass it and are untouched.
- No per-adapter edits needed; one install covers everything. Don't create a
  pool per adapter or per call.
- Shutdown MUST `await` `closeSharedHttpPool()` before `process.exit` (it uses
  `Agent.close()`, not `destroy()`) so an in-flight LLM/TTS call on a live call
  survives a Railway SIGTERM redeploy. Keep the hard-timeout backstop.
- `http_pool_connect` log lines (one per new socket) are the reuse telemetry;
  if a single origin's `opensToOrigin` keeps climbing mid-call, raise the
  keepAliveTimeout.
