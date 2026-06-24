// trigger rebuild — dynamic billing display fix (dashboard Vite bundle)
import http from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { WebSocketServer } from "ws";
import * as agnost from "agnostai";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { installSharedHttpPool, closeSharedHttpPool } from "./orchestration/http/pool.js";
import { initAudioPool } from "./orchestration/audioPool.js";
import { startCallbackPoller } from "./orchestration/callbackScheduler.js";
import { startSpikeChecker } from "./services/spike-checker.js";
import { startAlertSweep } from "./services/usage/alert-engine.js";
import { startRateLimitCleanup } from "./services/rate-limit-cleanup.js";
import { startBatchScheduler } from "./services/batchScheduler.js";
import { startDpdpRetentionSweep } from "./services/dpdpRetention.js";
import { handleTwilioWebSocket } from "./orchestration/telephony/twilio.js";
import { handlePlivoWebSocket } from "./orchestration/telephony/plivo.js";
import { handleVobizWebSocket } from "./orchestration/telephony/vobiz.js";
import { handleWebcallWebSocket } from "./orchestration/telephony/webcall.js";
import { verifySessionToken } from "./lib/session.js";
import { warmSileroVAD } from "./orchestration/silero-vad.js";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@workspace/db";
import { platformSettingsTable, agentsTable, usersTable, walletTransactionsTable } from "@workspace/db";
import { eq, sql, lt } from "drizzle-orm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerFile = join(__dirname, "orchestration", "audioWorker.mjs");

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

// Global safety-nets: prevent unhandled async rejections from crashing the process.
// Node.js 15+ exits on unhandledRejection by default — one transient DB timeout in
// a ws.on("close") async callback would kill the server and 502 all in-flight calls.
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection — caught at process level (process kept alive)");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — caught at process level (process kept alive)");
});

// Install the shared keep-alive HTTP pool as the global dispatcher BEFORE any
// outbound provider call can happen. Keeps sockets warm across turn gaps so
// repeat LLM/TTS/STT calls skip the TCP+TLS handshake. Process-wide: also covers
// telephony REST, webhooks, memory proxy, etc. WebSocket streaming is unaffected.
installSharedHttpPool();

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

// ── WebSocket per-IP rate limiter ─────────────────────────────────────────────
// Limits the number of WS upgrade attempts per remote IP to prevent credential
// burning / resource exhaustion via the unauthenticated upgrade path.
const WS_RATE_WINDOW_MS   = 60_000; // 1-minute window
const WS_RATE_MAX_PER_MIN = 20;     // max new connections per IP per window
const wsRateMap = new Map<string, { count: number; resetAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of wsRateMap) {
    if (entry.resetAt <= now) wsRateMap.delete(ip);
  }
}, WS_RATE_WINDOW_MS).unref();

function isWsRateLimited(ip: string): boolean {
  const now = Date.now();
  let entry = wsRateMap.get(ip);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + WS_RATE_WINDOW_MS };
    wsRateMap.set(ip, entry);
  }
  entry.count++;
  return entry.count > WS_RATE_MAX_PER_MIN;
}

server.on("upgrade", (request, socket, head) => { void (async () => {
  const url = request.url ?? "";

  // Redact the session JWT (and any future secret query params) before ANY logging
  // — the webcall transport carries ?token=<JWT> which must never reach the logs,
  // including the rate-limit warning below.
  const safeUrl = url.replace(/([?&](?:token|auth)=)[^&]*/gi, "$1[redacted]");

  // Match /api/ws/<provider>/<agentId>[?pt=1]
  const match = url.match(/^\/api\/ws\/(twilio|plivo|vobiz|webcall)\/(\d+)/);
  if (!match) {
    socket.destroy();
    return;
  }

  // Per-IP rate limiting — apply to all providers to prevent resource exhaustion.
  // Localhost is exempt (load tests, internal services) — in production localhost
  // is never the source of a real user's WebSocket connection.
  const remoteIp =
    (request.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
    (request.socket?.remoteAddress ?? "unknown");
  const isLocalhost = remoteIp === "127.0.0.1" || remoteIp === "::1" || remoteIp === "::ffff:127.0.0.1";
  if (!isLocalhost && isWsRateLimited(remoteIp)) {
    logger.warn({ remoteIp, url: safeUrl }, "WebSocket upgrade rate-limited");
    socket.write("HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }

  const provider          = match[1] as "twilio" | "plivo" | "vobiz" | "webcall";
  const agentId           = parseInt(match[2]!, 10);
  const platformTelephony = url.includes("pt=1");
  const qs                = new URLSearchParams(url.split("?")[1] ?? "");
  const campaignLeadId    = qs.has("campaignLeadId") ? parseInt(qs.get("campaignLeadId")!, 10) : undefined;
  const vobizFrom         = qs.get("from") ?? undefined;
  const vobizTo           = qs.get("to")   ?? undefined;

  // ── Webcall auth (browser "Live Test") ──────────────────────────────────────
  // Unlike telephony providers (which are inbound from the provider and cannot
  // present a bearer token), the browser CAN authenticate. Require a valid session
  // JWT in ?token= AND that the authenticated user owns the agent — enforced BEFORE
  // handleUpgrade so an unauthorized request never allocates a session/socket.
  let webcallUserId: string | null = null;
  if (provider === "webcall") {
    const token   = qs.get("token");
    const payload = token ? verifySessionToken(token) : null;
    if (!payload) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
    let agentRow: { userId: string | null } | undefined;
    try {
      const rows = await db
        .select({ userId: agentsTable.userId })
        .from(agentsTable)
        .where(eq(agentsTable.id, agentId));
      agentRow = rows[0];
    } catch (err) {
      logger.error({ err, agentId }, "Webcall upgrade — agent ownership lookup failed");
      socket.write("HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!agentRow || agentRow.userId !== payload.sub) {
      logger.warn({ agentId, sub: payload.sub }, "Webcall upgrade rejected — agent ownership mismatch");
      socket.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
    webcallUserId = payload.sub;
  }

  wss.handleUpgrade(request, socket, head, (ws: import("ws").WebSocket) => {
    logger.info({ provider, agentId, platformTelephony, campaignLeadId, url: safeUrl }, "WebSocket upgraded");
    switch (provider) {
      case "twilio":   void handleTwilioWebSocket(ws, agentId, campaignLeadId);                                                      break;
      case "plivo":    void handlePlivoWebSocket(ws, agentId, campaignLeadId);                                                       break;
      case "vobiz":    void handleVobizWebSocket(ws, agentId, platformTelephony, campaignLeadId, vobizFrom, vobizTo);              break;
      case "webcall":  void handleWebcallWebSocket(ws, agentId, webcallUserId!);                                                     break;
    }
  });
})(); });

/**
 * One-shot idempotent migration: upgrade agents still using the legacy
 * batch-only saarika:v2.5 model to saaras:v3 (streaming WebSocket).
 * saarika:v2.5 has no transcribeStream support — those agents fell back to the
 * slow VAD-silence batch path (600ms+ latency) instead of the fast streaming path.
 * Safe to keep running on every startup; it becomes a no-op once no rows remain.
 */
async function migrateSaarikaToSaaras(): Promise<void> {
  try {
    const result = await db
      .update(agentsTable)
      .set({ asrModel: "saaras:v3" })
      .where(eq(agentsTable.asrModel, "saarika:v2.5"))
      .returning({ id: agentsTable.id, name: agentsTable.name });
    if (result.length > 0) {
      logger.info(
        { count: result.length, ids: result.map(r => r.id) },
        "Migrated agents from saarika:v2.5 → saaras:v3 (streaming STT)"
      );
    }
  } catch (err) {
    logger.warn({ err }, "saarika→saaras migration failed (non-fatal)");
  }
}

/**
 * One-shot: top every user up to $100 (10000 cents) if they have less.
 * Guarded by a platform_settings flag so it runs exactly once.
 */
async function runBetaCreditMigration(): Promise<void> {
  const FLAG = "beta_credit_v1_done";
  try {
    const [existing] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, FLAG));
    if (existing) {
      logger.info("Beta credit migration already applied — skipping");
      return;
    }

    const users = await db
      .select({ id: usersTable.id, balance: usersTable.walletBalanceCents })
      .from(usersTable)
      .where(lt(usersTable.walletBalanceCents, 10000));

    for (const user of users) {
      const topUpCents = 10000 - user.balance;
      await db
        .update(usersTable)
        .set({ walletBalanceCents: sql`${usersTable.walletBalanceCents} + ${topUpCents}` })
        .where(eq(usersTable.id, user.id));
      await db.insert(walletTransactionsTable).values({
        userId:      user.id,
        type:        "free_credit",
        amountCents: topUpCents,
        description: "Beta credit top-up — $100 welcome balance",
        status:      "completed",
      });
    }

    await db.insert(platformSettingsTable).values({ key: FLAG, value: "done" })
      .onConflictDoNothing();

    logger.info({ usersUpdated: users.length }, "Beta credit migration applied — all users topped up to $100");
  } catch (err) {
    logger.warn({ err }, "Beta credit migration failed (non-fatal)");
  }
}

async function seedManagedKeyFromEnv(dbKey: string, envVar: string): Promise<void> {
  const envKey = (process.env[envVar] ?? "").trim();
  if (!envKey) return;
  try {
    await db
      .insert(platformSettingsTable)
      .values({ key: dbKey, value: envKey })
      .onConflictDoUpdate({
        target: platformSettingsTable.key,
        set: { value: envKey },
        setWhere: sql`${platformSettingsTable.value} IS NULL OR ${platformSettingsTable.value} = ''`,
      });
    logger.info({ dbKey, envVar }, "Managed key seeded from env var (overwrites blank rows)");
  } catch (err) {
    logger.warn({ err, dbKey }, "Failed to seed managed key from env var");
  }
}

const agnostApiKey = process.env["AGNOST_API_KEY"] ?? "";
if (agnostApiKey) {
  agnost.init(agnostApiKey, { debug: process.env["NODE_ENV"] !== "production" });
}

// Warn at startup if email notification env vars are absent — the first booking
// would otherwise silently skip email with only a buried warn inside an async call.
if (!process.env["GMAIL_USER"] || !process.env["GMAIL_APP_PASSWORD"]) {
  logger.warn(
    { hasGmailUser: !!process.env["GMAIL_USER"], hasGmailPassword: !!process.env["GMAIL_APP_PASSWORD"] },
    "GMAIL_USER or GMAIL_APP_PASSWORD not set — booking email notifications will be skipped",
  );
}

// Log which redirect URI will be used for Google Calendar OAuth so mismatches
// are immediately visible in logs without having to trigger the flow first.
if (process.env["GOOGLE_REDIRECT_URI"]) {
  logger.info({ uri: process.env["GOOGLE_REDIRECT_URI"] }, "Google Calendar OAuth: GOOGLE_REDIRECT_URI set");
} else if (process.env["APP_DOMAIN"] ?? process.env["REPLIT_DOMAINS"]) {
  logger.info(
    { domain: process.env["APP_DOMAIN"] ?? process.env["REPLIT_DOMAINS"] },
    "Google Calendar OAuth: GOOGLE_REDIRECT_URI not set — using dynamic redirect URI derivation from APP_DOMAIN / forwarded host",
  );
} else {
  logger.warn(
    "Google Calendar OAuth: neither GOOGLE_REDIRECT_URI nor APP_DOMAIN is set — OAuth flow will likely fail",
  );
}

// Seed the Drizzle migration journal for pre-existing production DBs.
// If the DB was bootstrapped via drizzle-kit push (no journal), mark all known
// historical migrations as already applied so migrate() only runs NEW ones.
// Extend this list whenever a new migration is confirmed applied on all prod DBs.
async function bootstrapMigrationJournal(): Promise<void> {
  const KNOWN = [
    { hash: "e2b1a59f6d146aa9caa4a43233e860debafcf1655f7286a07f2c7c3c2519f559", created_at: 1781539061605 },
    { hash: "b7c04adb1d16b404a9cd1e22d854e7db01af1846504f561990a4b70bcf1a3b91", created_at: 1781693800000 },
    { hash: "03e45f9b6656453f1448ab5719eef5e8a5182d075c5f5d7becfd5dab64d4bbbf", created_at: 1781722900000 },
    { hash: "8ca3b3f19137ceab328011596551cd460d7867e52c45d43ae98f998f906d404f", created_at: 1781746700000 },
    { hash: "323b47d5f4c8b169d2ae7e44b7a943782383961a0512877cc578f2695cdd365a", created_at: 1781747200000 },
    { hash: "953ef28a6884c0110d2a1a4c06c0f4cf0508e412a46db271600789d6a5527581", created_at: 1781766600000 },
    { hash: "0534e771db66625444151d9a7968caee950ebf49015d0e2ce98af400cf8c3018", created_at: 1781800000000 },
    { hash: "d3ff2d6870fb28a57098fb713f847ed4feb49078a43d32c512747771848dc470", created_at: 1781900000000 },
    { hash: "6583f0bbf516191499036d864174bf2a682ef18553e2395248953f1ce2472a7a", created_at: 1782000000000 },
    { hash: "73113b9037eebaef3316e263fa2374fade6f98c0d27b0e2fbf5f5cf201f7513c", created_at: 1782100000000 },
  ];

  // Check if the users table exists (= DB was created outside of migrations)
  const { rows: tables } = await db.execute(sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  `);
  if (tables.length === 0) return; // fresh DB — let migrate() do all the work

  // Ensure the drizzle journal schema + table exist
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id      SERIAL PRIMARY KEY,
      hash    text   NOT NULL,
      created_at bigint
    )
  `);

  // Insert any missing journal entries (idempotent)
  for (const m of KNOWN) {
    const { rows } = await db.execute(sql`
      SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = ${m.hash}
    `);
    if (rows.length === 0) {
      await db.execute(sql`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${m.hash}, ${m.created_at})
      `);
      logger.info({ hash: m.hash.slice(0, 12) }, "Migration journal: seeded pre-existing migration");
    }
  }
}

// Start server first so the healthcheck probe can reach /api/healthz immediately.
// Migrations run in the background after the port is bound.
server.listen(port, () => {
  logger.info({ port }, "Server listening");
  initAudioPool(new URL(`file://${workerFile}`));
  void warmSileroVAD(); // preload Silero VAD ONNX session so first call doesn't pay load cost

  // Run DB migrations after the port is open so Railway's health-check passes
  // while the schema is being applied. Services that need tables will become
  // available within seconds; the server gracefully exits if migration fails.
  const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "../../../lib/db/drizzle");
  bootstrapMigrationJournal()
    .then(() => migrate(db, { migrationsFolder }))
    .then(() => {
      logger.info({ migrationsFolder }, "DB migrations applied");
      void seedManagedKeyFromEnv("managed_qwen_key",     "GROQ_API_KEY");
      void seedManagedKeyFromEnv("managed_sarvam_key",   "SARVAM_API_KEY");
      void seedManagedKeyFromEnv("managed_cartesia_key", "CARTESIA_API_KEY");
      void migrateSaarikaToSaaras();
      void runBetaCreditMigration();
      startCallbackPoller();
      startSpikeChecker();
      startAlertSweep();
      startRateLimitCleanup();
      startBatchScheduler();
      startDpdpRetentionSweep();
    })
    .catch((err: unknown) => {
      // Log but do NOT exit — keeps the process alive so Railway's healthcheck
      // passes and we can inspect the error in the Console tab.
      logger.error({ err, migrationsFolder }, "DB migration failed — server will stay up for diagnostics");
    });
});

let isShuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return; // ignore repeated SIGTERM/SIGINT during drain
  isShuttingDown = true;
  logger.info({ signal }, "Received shutdown signal, closing server");
  void agnost.shutdown();

  // Hard backstop: force exit if a drain step hangs past the deploy grace window.
  const force = setTimeout(() => {
    logger.warn("Forcing exit after timeout");
    process.exit(1);
  }, 10_000);
  force.unref();

  // 1) Stop accepting new connections.
  server.close((err) => {
    if (err) logger.error({ err }, "Error closing server");
    else logger.info("Server closed cleanly");
  });

  // 2) Drain in-flight outbound provider HTTP before exiting. close() (not
  //    destroy()) lets an LLM/TTS call mid-response on a live call finish rather
  //    than being aborted by a Railway SIGTERM redeploy. Bounded so a stuck
  //    socket can't block past the backstop above.
  try {
    await Promise.race([
      closeSharedHttpPool(),
      new Promise((resolve) => setTimeout(resolve, 8_000)),
    ]);
  } catch (err: unknown) {
    logger.warn({ err }, "Error draining HTTP pool on shutdown");
  }

  clearTimeout(force);
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
