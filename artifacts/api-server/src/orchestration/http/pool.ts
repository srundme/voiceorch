import { Agent, setGlobalDispatcher } from "undici";
import diagnosticsChannel from "node:diagnostics_channel";
import { logger } from "../../lib/logger.js";

/**
 * Shared keep-alive HTTP connection pool for ALL outbound provider HTTP calls.
 *
 * Why this exists
 * ---------------
 * In Node 24, native `fetch`, the OpenAI SDK (v6) and the Google GenAI SDK all
 * route through undici's *global dispatcher*. That dispatcher already pools
 * connections, but with undici's default `keepAliveTimeout` of ~4s — shorter
 * than the silences between conversational turns on a voice call. So a pooled
 * socket goes idle, gets dropped, and the next LLM/TTS call pays a fresh
 * TCP + TLS handshake (~100–300ms) again on every turn.
 *
 * Installing one shared Agent with a longer keepAliveTimeout as the global
 * dispatcher keeps sockets warm across turn gaps, eliminating the repeat
 * handshake. This is HTTP/1.1 keep-alive reuse only — we deliberately do NOT
 * force HTTP/2 (these provider REST endpoints don't reliably negotiate h2 over
 * undici, and our call pattern is sequential, not many-concurrent-on-one-conn).
 *
 * Scope note (important for future readers)
 * -----------------------------------------
 * `setGlobalDispatcher` is process-wide. It transparently covers EVERY outbound
 * HTTP call this process makes — not just the LLM/TTS/STT adapters, but also
 * telephony provider REST (Plivo/Vobiz/Twilio call control), self-webhook
 * dispatch, the memory proxy, Google Calendar, object storage, etc. They all
 * benefit from keep-alive reuse too. WebSocket streaming paths (streaming STT /
 * TTS) do NOT use this dispatcher and are unaffected.
 *
 * Env knobs (all optional; sensible defaults below)
 * -------------------------------------------------
 * - HTTP_POOL_KEEPALIVE_TIMEOUT_MS     (default 30000) — how long an idle socket
 *     stays pooled. Must comfortably exceed your real between-turn gaps; tune up
 *     from the reconnect logs if you still see frequent reconnects mid-call.
 * - HTTP_POOL_KEEPALIVE_MAX_TIMEOUT_MS (default 600000) — hard cap on how long a
 *     socket may stay alive regardless of server keep-alive hints.
 * - HTTP_POOL_CONNECTIONS              (default 128) — max connections per origin.
 * - HTTP_POOL_PIPELINING               (default 1) — h1 pipelining depth; keep 1.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const KEEPALIVE_TIMEOUT_MS = envInt("HTTP_POOL_KEEPALIVE_TIMEOUT_MS", 30_000);
const KEEPALIVE_MAX_TIMEOUT_MS = envInt("HTTP_POOL_KEEPALIVE_MAX_TIMEOUT_MS", 600_000);
const CONNECTIONS = envInt("HTTP_POOL_CONNECTIONS", 128);
const PIPELINING = envInt("HTTP_POOL_PIPELINING", 1);

let sharedAgent: Agent | null = null;
let installed = false;

/** Per-origin count of NEW sockets opened — proves keep-alive reuse (few opens, many requests). */
const connectsByOrigin = new Map<string, number>();

/** Held so we can unsubscribe on close and never stack duplicate subscribers across reinstalls. */
let diagnosticsListener: ((message: unknown, name: string | symbol) => void) | null = null;

function subscribeConnectionDiagnostics(): void {
  if (diagnosticsListener) return; // one-time: avoid duplicate subscribers / log spam
  // Fires only when undici opens a brand-new socket. On a warm pool this should
  // be rare: ~1 per provider origin even across many turns. If a given origin's
  // count keeps climbing during a single call, the keepAliveTimeout is too low.
  diagnosticsListener = (message: unknown) => {
    try {
      const cp = (message as { connectParams?: Record<string, unknown> })?.connectParams ?? {};
      const protocol = String(cp["protocol"] ?? "https:");
      const hostname = String(cp["hostname"] ?? cp["host"] ?? "unknown");
      const port = String(cp["port"] ?? "");
      const origin = `${protocol}//${hostname}${port ? `:${port}` : ""}`;
      const count = (connectsByOrigin.get(origin) ?? 0) + 1;
      connectsByOrigin.set(origin, count);
      logger.info(
        { evt: "http_pool_connect", origin, opensToOrigin: count },
        "Opened NEW pooled HTTP socket (subsequent requests to this origin reuse it)",
      );
    } catch {
      // Diagnostics must never break request flow.
    }
  };
  diagnosticsChannel.subscribe("undici:client:connected", diagnosticsListener);
}

/**
 * Build the one shared keep-alive Agent and install it as the global dispatcher.
 * Idempotent: safe to call more than once; only the first call takes effect.
 */
export function installSharedHttpPool(): Agent {
  if (installed && sharedAgent) return sharedAgent;
  sharedAgent = new Agent({
    keepAliveTimeout: KEEPALIVE_TIMEOUT_MS,
    keepAliveMaxTimeout: KEEPALIVE_MAX_TIMEOUT_MS,
    connections: CONNECTIONS,
    pipelining: PIPELINING,
  });
  setGlobalDispatcher(sharedAgent);
  subscribeConnectionDiagnostics();
  installed = true;
  logger.info(
    {
      keepAliveTimeoutMs: KEEPALIVE_TIMEOUT_MS,
      keepAliveMaxTimeoutMs: KEEPALIVE_MAX_TIMEOUT_MS,
      connections: CONNECTIONS,
      pipelining: PIPELINING,
    },
    "Shared HTTP keep-alive pool installed as global dispatcher (covers all outbound HTTP)",
  );
  return sharedAgent;
}

/** The shared Agent (for explicit injection, e.g. OpenAI SDK `fetchOptions.dispatcher`). */
export function getSharedHttpAgent(): Agent {
  return installSharedHttpPool();
}

/**
 * Graceful shutdown: drains in-flight requests, then closes idle sockets.
 *
 * Uses `Agent.close()` (NOT `destroy()`) so a provider call that is mid-flight
 * during a Railway redeploy (SIGTERM) — e.g. an LLM streaming a response on a
 * live call — is allowed to finish rather than being aborted. Resolves once all
 * active requests have completed and sockets are closed.
 */
export async function closeSharedHttpPool(): Promise<void> {
  if (!sharedAgent) return;
  const agent = sharedAgent;
  sharedAgent = null;
  installed = false;
  if (diagnosticsListener) {
    diagnosticsChannel.unsubscribe("undici:client:connected", diagnosticsListener);
    diagnosticsListener = null;
  }
  try {
    await agent.close();
    logger.info("Shared HTTP pool closed gracefully");
  } catch (err: unknown) {
    logger.warn({ err }, "Error while closing shared HTTP pool");
  }
}
