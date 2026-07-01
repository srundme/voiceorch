---
name: DB pool cold-start dead air
description: Why outbound calls open with silence (no ambient, no agent) and how the warm Postgres pool floor fixes it
---

# Outbound-call opening dead air = cold DB pool during pre-pipeline setup

**Symptom:** On an outbound call, after the callee answers there are several
seconds of PURE silence — NO ambient bed AND no agent — then everything starts
together.

**Why it points at pre-pipeline setup (not greeting latency):** the ambient
noise bed lives INSIDE the OrchestrationPipeline, which is constructed at the
very END of `createSession`. `createSession` first runs a handful of sequential
DB round trips (load agent, load user, KB source ids, a `Promise.all` prefetch,
platform settings, find+insert call record). During that window the telephony
transport (`vobiz.ts`) only emits PCM-zero silence frames to keep the carrier
bridge alive — so "no ambient for the whole window" proves the delay is
pre-pipeline setup. Greeting latency would have the ambient bed playing under it.

**Root cause:** node-postgres `Pool` had `idleTimeoutMillis` 30s and no warm
floor. When calls are >30s apart the pool drains to zero, so each of those setup
queries re-pays a fresh Postgres connect + TLS + auth (1–3s each cross-region on
Railway) → several seconds of dead air.

**Fix (`lib/db/src/index.ts`):**
- Raise `idleTimeoutMillis` (env `DB_POOL_IDLE_TIMEOUT_MS`, default 5min) so
  warm connections survive inter-call gaps.
- Add a `pool.on("error")` handler — with long-lived idle conns, an out-of-band
  server close emits an error on the Pool; no listener = process crash.
- **node-postgres Pool has NO `min` option.** Maintain a warm floor yourself: an
  unref'd `setInterval` that fires `DB_POOL_WARM_MIN` (default 4) concurrent
  `SELECT 1` queries every `DB_POOL_WARM_PING_MS` (default 20s), primed once at
  startup. 4 matches the ~4-wide `Promise.all` burst in createSession.

**Why `allowExitOnIdle: true` is mandatory here:** the warmup runs on module
import and `warmTimer.unref()` does NOT stop pg's idle sockets from keeping Node
alive. Without `allowExitOnIdle`, every short-lived CLI that imports
`@workspace/db` (backfill/wipe/merge) hangs for the full idle timeout (now 5min)
after finishing. The long-running API server stays up via its HTTP listeners, so
its warm floor persists regardless.

**Verifying in prod:** `vobiz.ts` logs `setupMs` on "Vobiz session started"
(WS start → session ready). If it collapses to <1s after this change the dead
air was cold DB setup; if it stays high the delay is elsewhere (e.g. the media
bridge BEFORE the WS start event — that window is not covered here).

**Relation:** analogous to `http-keepalive-pool.md` (undici keep-alive for
outbound provider HTTP). Same principle — keep the connection warm across the
idle gap between calls/turns instead of re-paying the handshake.
