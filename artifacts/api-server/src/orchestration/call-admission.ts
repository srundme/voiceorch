import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

// PostgreSQL is already mandatory for calls. Use it rather than silently
// reverting to per-process limits when optional Redis is not configured.
let initialized: Promise<void> | undefined;
export async function initializeCallAdmission(): Promise<void> {
  if (!initialized) initialized = (async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL statement_timeout = '5s'");
      await c.query("SELECT pg_advisory_xact_lock(74192013)");
      await c.query(`CREATE TABLE IF NOT EXISTS voice_call_leases (
        token text PRIMARY KEY, tenant text NOT NULL, external_key text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL)`);
      await c.query("CREATE INDEX IF NOT EXISTS voice_call_leases_tenant_idx ON voice_call_leases (tenant)");
      await c.query("COMMIT");
    } catch (err) { await c.query("ROLLBACK"); throw err; }
    finally { c.release(); }
  })().catch(err => { initialized = undefined; throw err; });
  await initialized;
}

export interface CallLease { assertOwned(): void; release(): Promise<void>; }
export async function reserveCall(tenant: string, externalKey: string, limit: number, onLost: () => void): Promise<CallLease> {
  await initializeCallAdmission();
  const reservationStarted = Date.now();
  const token = randomUUID();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL statement_timeout = '5s'");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [tenant]);
    await c.query("DELETE FROM voice_call_leases WHERE tenant=$1 AND expires_at <= now()", [tenant]);
    const count = await c.query("SELECT count(*)::int AS n FROM voice_call_leases WHERE tenant=$1", [tenant]);
    if (count.rows[0].n >= limit) throw new Error(`Concurrent call limit reached (${limit})`);
    await c.query("INSERT INTO voice_call_leases VALUES ($1,$2,$3,now()+interval '45 seconds')", [token, tenant, `${tenant}:${externalKey}`]);
    await c.query("COMMIT");
  } catch (err) { await c.query("ROLLBACK"); throw err; }
  finally { c.release(); }
  let lost = false;
  let released = false;
  let busy = false;
  let validUntil = reservationStarted + 25000;
  // Stop locally well before the lease can expire and be acquired elsewhere.
  let watchdog: ReturnType<typeof setTimeout>;
  const lose = () => {
    if (released || lost) return;
    lost = true;
    clearInterval(heartbeat);
    clearTimeout(watchdog);
    onLost();
  };
  const armWatchdog = () => { clearTimeout(watchdog); watchdog = setTimeout(lose, Math.max(1, validUntil - Date.now())); watchdog.unref(); };
  const heartbeat = setInterval(() => {
    if (busy || released || lost) return;
    busy = true;
    const renewalStarted = Date.now();
    void pool.query("UPDATE voice_call_leases SET expires_at=now()+interval '45 seconds' WHERE token=$1 AND expires_at>now()", [token])
      .then(r => { if (!r.rowCount) lose(); else if (!released && !lost) { validUntil = renewalStarted + 25000; armWatchdog(); } })
      .catch(err => { logger.error({ err }, "Call ownership heartbeat failed"); lose(); })
      .finally(() => { busy = false; });
  }, 10000);
  heartbeat.unref();
  armWatchdog();
  return {
    assertOwned() { if (Date.now() >= validUntil) lose(); if (lost || released) throw new Error("Call ownership lease lost"); },
    async release() {
      released = true;
      clearInterval(heartbeat); clearTimeout(watchdog);
      await pool.query("DELETE FROM voice_call_leases WHERE token=$1", [token]).catch(err => logger.warn({ err }, "Call lease release failed; expiry will reclaim it"));
    },
  };
}
