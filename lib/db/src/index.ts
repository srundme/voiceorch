import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// ── Pool sizing / warmth knobs ───────────────────────────────────────────────
// Defaults keep connections WARM across the gap between calls. Previously the
// pool closed every idle connection after 30 s with no `min`, so any call more
// than ~30 s after the last one drained the pool to zero and createSession's
// first ~6 sequential setup queries each re-paid fresh Postgres connect + TLS +
// auth (1–3 s apiece cross-region on Railway). That setup runs BEFORE the
// pipeline (and its ambient bed) is constructed, so the caller heard pure
// dead air — no ambient, no agent — for several seconds after answer, then
// everything started together the instant setup finished. Same cold-pool
// disease as the outbound HTTP keep-alive pool, on the Postgres side.
const POOL_MAX = Number(process.env["DB_POOL_MAX"] ?? 50);
// Keep idle connections alive far longer than the typical inter-call gap; TCP
// keepalive (below) stops Railway from silently killing them.
const POOL_IDLE_TIMEOUT_MS = Number(process.env["DB_POOL_IDLE_TIMEOUT_MS"] ?? 300_000);
const POOL_CONNECT_TIMEOUT_MS = Number(process.env["DB_POOL_CONNECT_TIMEOUT_MS"] ?? 5_000);
// Warm floor: how many connections to keep established + validated during quiet
// periods, and how often to refresh them. createSession fires a burst of ~4
// concurrent setup queries (Promise.all), so keep at least that many warm so
// the burst never cold-opens. Set DB_POOL_WARM_MIN=0 to disable the keepalive.
const POOL_WARM_MIN = Number(process.env["DB_POOL_WARM_MIN"] ?? 4);
const POOL_WARM_PING_MS = Number(process.env["DB_POOL_WARM_PING_MS"] ?? 20_000);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: POOL_MAX,                              // allow up to N concurrent DB connections
  idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,    // keep idle connections warm across inter-call gaps
  connectionTimeoutMillis: POOL_CONNECT_TIMEOUT_MS, // fail fast rather than queue indefinitely
  keepAlive: true,                            // send TCP keepalives so Railway doesn't silently kill idle connections
  keepAliveInitialDelayMillis: 10_000,        // start keepalives after 10 s idle
  // Let a process exit once its work is done even though warm idle connections
  // remain in the pool. The long-running API server stays alive via its HTTP
  // listeners (so the warm floor persists), while short-lived CLI scripts that
  // import @workspace/db (backfill/wipe/merge) still exit cleanly instead of
  // hanging for the full idle timeout on the warmed connections.
  allowExitOnIdle: true,
});

// A pooled idle connection that the server (Railway/pg) closes out-of-band emits
// an 'error' event on the Pool. Without a listener Node treats it as unhandled
// and can crash the process — more likely now that connections idle far longer.
// Log and swallow: pg discards the dead client and opens a fresh one on demand,
// and the critical setup queries already run under withDbRetry.
pool.on("error", (err) => {
  // lib/db has no logger dependency (the singleton logger lives in api-server);
  // console is the only option this low in the stack.
  // eslint-disable-next-line no-console
  console.error("[db] idle pool client error (connection will be recycled):", err instanceof Error ? err.message : err);
});

export const db = drizzle(pool, { schema });

// ── Warm-pool keepalive ──────────────────────────────────────────────────────
// node-postgres' Pool has no `min` option, so we maintain a warm floor manually:
// fire POOL_WARM_MIN trivial queries concurrently on an interval. Each keeps a
// connection established + validated in the idle pool (idleTimeout >> interval,
// so they persist between pings), ensuring the concurrent burst of setup queries
// in createSession never pays cold connect + TLS latency. Unref'd so it never
// keeps a short-lived script/CLI process alive just for warmups.
if (POOL_WARM_MIN > 0 && POOL_WARM_PING_MS > 0) {
  const warmPool = (): void => {
    for (let i = 0; i < POOL_WARM_MIN; i++) {
      void pool.query("SELECT 1").catch(() => { /* transient — connection recycled on next use */ });
    }
  };
  const warmTimer = setInterval(warmPool, POOL_WARM_PING_MS);
  warmTimer.unref?.();
  warmPool(); // prime immediately so the first call after startup is already warm
}

export * from "./schema";
export * from "./identity-merge";
export * from "./caller-identity";
