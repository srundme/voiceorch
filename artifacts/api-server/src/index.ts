// trigger rebuild — campaigns list CSV export button (dashboard Vite bundle)
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
import { startEmailScheduler } from "./services/onboarding-emails.js";
import { startBatchScheduler } from "./services/batchScheduler.js";
import { startDpdpRetentionSweep } from "./services/dpdpRetention.js";
import { startPhoneRenewalSweep } from "./services/phone-renewal.js";
import { startVobizWalletMonitor } from "./services/vobiz-wallet-monitor.js";
import { startStaleCallCleanup } from "./services/stale-call-cleanup.js";
import { startKbEmbedMaintenance } from "./services/kb-embeddings.js";
import { handleTwilioWebSocket } from "./orchestration/telephony/twilio.js";
import { handlePlivoWebSocket } from "./orchestration/telephony/plivo.js";
import { handleVobizWebSocket } from "./orchestration/telephony/vobiz.js";
import { handleWebcallWebSocket } from "./orchestration/telephony/webcall.js";
import { verifySessionToken } from "./lib/session.js";
import { warmSileroVAD } from "./orchestration/silero-vad.js";
import { probeGenderService } from "./orchestration/genderService.js";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@workspace/db";
import { platformSettingsTable, agentsTable, usersTable, walletTransactionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

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
  const vobizFrom         = qs.get("from")     ?? undefined;
  const vobizTo           = qs.get("to")       ?? undefined;
  const vobizCallUuid     = qs.get("callUuid") ?? undefined;
  const vobizCorrToken    = qs.get("corr")     ?? undefined;
  const vobizCallbackId   = qs.has("cbId") ? (parseInt(qs.get("cbId")!, 10) || undefined) : undefined;
  // Carrier answer/bridge time (epoch ms) captured at the answer webhook and
  // threaded here via ?ans=... so the session anchors duration + recording to
  // the actual answer instant, not media-stream connect. The value is attacker-
  // controllable (query param), so clamp it to a sane window: a real answer→WS
  // gap is a few seconds, never > a couple minutes, and never in the future.
  // Anything outside the window is dropped → falls back to session-creation time.
  const vobizAnsweredAt   = (() => {
    if (!qs.has("ans")) return undefined;
    const v = parseInt(qs.get("ans")!, 10);
    const now = Date.now();
    if (!Number.isFinite(v) || v <= 0 || v > now + 5_000 || v < now - 120_000) return undefined;
    return v;
  })();
  const voicemailDelivery = qs.get("vm") === "1";
  // amdHint=machine → the answer webhook reported an unreliable VoBiz "machine"
  // flag. The session opens normally but confirms acoustically before enacting any
  // voicemail action (see confirmAmdMachineThenBranch).
  const amdMachineHint = qs.get("amdHint") === "machine";
  // amdArm=1 → AMD is enabled for this outbound call; acoustic confirmation is
  // armed UNCONDITIONALLY at session start (VoBiz's real verdict arrives via the
  // async machine_detection_url callback, not the answer webhook, so waiting for
  // a hint would mean voicemail is never detected).
  const amdArmed = qs.get("amdArm") === "1";
  // dir=out is appended by every outbound dial site (calls/campaign/callback/meta)
  // so the WS handler keys caller memory off the dialed party, not the shared
  // platform number. Absent → inbound (the provider dialed us).
  const callDirection: "inbound" | "outbound" = qs.get("dir") === "out" ? "outbound" : "inbound";

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
    // Balance gate — must match the REST POST /calls check
    try {
      const walletRows = await db
        .select({ walletBalanceCents: usersTable.walletBalanceCents })
        .from(usersTable)
        .where(eq(usersTable.clerkId, payload.sub));
      const walletUser = walletRows[0];
      if (walletUser && walletUser.walletBalanceCents <= 0) {
        logger.warn({ agentId, sub: payload.sub }, "Webcall upgrade rejected — insufficient balance");
        socket.write("HTTP/1.1 402 Payment Required\r\nContent-Type: application/json\r\nContent-Length: 63\r\n\r\n{\"error\":\"Insufficient balance. Please top up your wallet.\"}");
        socket.destroy();
        return;
      }
    } catch (err) {
      logger.error({ err, agentId }, "Webcall upgrade — wallet balance check failed");
      socket.write("HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
    webcallUserId = payload.sub;
  }

  wss.handleUpgrade(request, socket, head, (ws: import("ws").WebSocket) => {
    logger.info({ provider, agentId, platformTelephony, campaignLeadId, url: safeUrl }, "WebSocket upgraded");
    switch (provider) {
      case "twilio":   void handleTwilioWebSocket(ws, agentId, campaignLeadId, callDirection, vobizCallbackId);                       break;
      case "plivo":    void handlePlivoWebSocket(ws, agentId, campaignLeadId, callDirection, vobizCallbackId);                        break;
      case "vobiz":    void handleVobizWebSocket(ws, agentId, platformTelephony, campaignLeadId, vobizFrom, vobizTo, voicemailDelivery, vobizCallUuid, callDirection, vobizCorrToken, vobizCallbackId, vobizAnsweredAt, amdMachineHint, amdArmed); break;
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
    { hash: "85a77e1b389b63f8986490059ec5ccfc14b0d8f9b8d4a4de6013f8ef5a9bc717", created_at: 1782200000000 },
    { hash: "49bf89f18404779fed92ffa5d52cb21a8fac3d97832c4ccc0a51268fe7f3c0ef", created_at: 1782300000000 },
    { hash: "61096716f909fbf441e9d86d394610c34c609a61c5187d7b5ea44da8b6c155f9", created_at: 1782450000000 },
    { hash: "10cdf0f11d4b32a99a83120159c12d4f38cf92d0433cf213e92249898a4af4bb", created_at: 1782550000000 },
    { hash: "5777062b222dbbb7ea2bfe16ac7cd52307d9f96e65b218a57a997ce91ab25e6a", created_at: 1782600000000 },
    { hash: "2c95503f6ee011ce09931986a4bfb26f1efbfc27e7e47cd92f3e6c731bc3f18e", created_at: 1782700000000 },
    { hash: "98312c514d3863f9906626aaf3d7d000db0ef056aa9a5bb8c15b3a79866318ed", created_at: 1782800000000 },
    { hash: "f8353d8cb55b98bf5a9f6ca61e4aa537c56c38f611c439f4f0efadd86264755a", created_at: 1782900000000 },
    { hash: "ff7ec8a49a89fb19ccf732b26251b102883d7fcf15c86c32240c87fae87ee1db", created_at: 1782950000000 },
    { hash: "9cecf0a9ff59de25eac233ab2c702ba12a4d66e70e387402d10cfd613fabb9a3", created_at: 1783000000000 },
    { hash: "9f147d5488b5cb867a64ad352f454c1c3fb911e5996ffdab42003ef47fd49286", created_at: 1783100000000 },
    { hash: "489a528b35915b97b95f0569307d77b5a471dfdb66a1580cd15ebc2c30e31268", created_at: 1783200000000 },
    { hash: "a9960290220153c3bc4816e2bc70d61e82cd0efba7fce84ef5c00fa8eec4df97", created_at: 1783300000000 },
    { hash: "6e9f06d45bd38d4420101dbb379fe8ff4ce3019fd11cdec163b62e6efc641579", created_at: 1783400000000 },
    { hash: "b96a84b5463b771a99a0044bc9434b14f52f9b05df0e939ebae1a5a07d08d0f8", created_at: 1783500000000 },
    { hash: "748d6e4ad9dda2210f2108c10fb0d08f018ec63e17de02576f4f1c7399ecb141", created_at: 1783600000000 },
    { hash: "aef703f685a7eda4b8dc37612df9c35ed0b546394b38acffe2265635dd5e1ba5", created_at: 1783700000000 },
    { hash: "1f30d5ab411004dbd15940afb61228fe90613bba08ee144e50c41b5d5f4394ea", created_at: 1783800000000 },
    { hash: "3925e814461aebc3e5d03a2d4afa90bb4e38e85026df4d43daef95704bcce622", created_at: 1783900000000 },
    { hash: "ccae596f828efe4c651a9ef033199849656880a2f41e327ab630ee058ea99e61", created_at: 1784000000000 },
    { hash: "0a5017bd9d95c131fe2f47b9cf7baf254e2d16f7a255ca5b262321b26f8c1728", created_at: 1784100000000 },
    { hash: "8b70762b3bb4436a8d9ea298abcf518fff450692f0172f63a456c944f73315f6", created_at: 1784200000000 },
    { hash: "578737fd983531ecc83e8cad0db9ea04a9df4e846d6a1a184fabe3013cc7cb05", created_at: 1784300000000 },
    { hash: "17625d5f238b6093eac79a3a859a4d5b0b3d63824ec721ac6c574ca8c62927ce", created_at: 1784400000000 },
    { hash: "1905b4dcdac6fd302fda5ba59085bc13f6a30391abdf2571414f07e531a294d6", created_at: 1784500000000 },
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
  void probeGenderService(); // loudly log the resolved gender-service URL + reachability so misconfig isn't silent

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
      void seedManagedKeyFromEnv("managed_gemini_key",   "GEMINI_API_KEY");
      void seedManagedKeyFromEnv("managed_together_key",   "TOGETHER_API_KEY");
      void seedManagedKeyFromEnv("managed_openrouter_key", "OPENROUTER_API_KEY");
      void seedManagedKeyFromEnv("zelto_api_key",          "ZELTO_API_KEY");
      void migrateSaarikaToSaaras();
      startCallbackPoller();
      startSpikeChecker();
      startAlertSweep();
      startRateLimitCleanup();
      startEmailScheduler();
      startBatchScheduler();
      startDpdpRetentionSweep();
      startPhoneRenewalSweep();
      startVobizWalletMonitor();
      startStaleCallCleanup();
      startKbEmbedMaintenance();
    })
    .catch((err: unknown) => {
      // Log but do NOT exit — keeps the process alive so Railway's healthcheck
      // passes and we can inspect the error in the Console tab.
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ err, migrationsFolder }, "DB migration failed — server will stay up for diagnostics");
      logger.info(`DB migration error detail: ${errMsg.slice(0, 800)}`);
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
