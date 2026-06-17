// trigger rebuild — multilingual complete (pipeline + session + webcall)
import http from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { WebSocketServer } from "ws";
import * as agnost from "agnostai";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { initAudioPool } from "./orchestration/audioPool.js";
import { startCallbackPoller } from "./orchestration/callbackScheduler.js";
import { startSpikeChecker } from "./services/spike-checker.js";
import { startAlertSweep } from "./services/usage/alert-engine.js";
import { startRateLimitCleanup } from "./services/rate-limit-cleanup.js";
import { startBatchScheduler } from "./services/batchScheduler.js";
import { handleTwilioWebSocket } from "./orchestration/telephony/twilio.js";
import { handlePlivoWebSocket } from "./orchestration/telephony/plivo.js";
import { handleVobizWebSocket } from "./orchestration/telephony/vobiz.js";
import { handleWebCallWebSocket } from "./orchestration/telephony/webcall.js";
import { verifySessionToken } from "./lib/session.js";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@workspace/db";
import { platformSettingsTable, agentsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerFile = join(__dirname, "orchestration", "audioWorker.mjs");

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

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

  // Match /api/ws/<provider>/<agentId>[?pt=1]
  const match = url.match(/^\/api\/ws\/(twilio|plivo|vobiz|webcall)\/(\d+)/);
  if (!match) {
    socket.destroy();
    return;
  }

  // Per-IP rate limiting — apply to all providers to prevent resource exhaustion
  const remoteIp =
    (request.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
    (request.socket?.remoteAddress ?? "unknown");
  if (isWsRateLimited(remoteIp)) {
    logger.warn({ remoteIp, url }, "WebSocket upgrade rate-limited");
    socket.write("HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }

  const provider          = match[1] as "twilio" | "plivo" | "vobiz" | "webcall";
  const agentId           = parseInt(match[2]!, 10);
  const platformTelephony = url.includes("pt=1");
  const qs                = new URLSearchParams(url.split("?")[1] ?? "");
  const campaignLeadId    = qs.has("campaignLeadId") ? parseInt(qs.get("campaignLeadId")!, 10) : undefined;
  // callerId: Clerk userId of the dashboard user initiating the webcall.
  // Passed as ?callerId=<clerkId> so the callback poller can ring the right browser tab.
  const callerId          = qs.get("callerId") ?? undefined;
  const callbackId        = qs.has("callbackId") ? parseInt(qs.get("callbackId")!, 10) : undefined;
  const promptVariables: Record<string, string> | undefined = qs.has("variables")
    ? (() => { try { return JSON.parse(qs.get("variables")!) as Record<string, string>; } catch { return undefined; } })()
    : undefined;

  // ── Webcall JWT authentication ─────────────────────────────────────────────
  // Twilio/Plivo/VoBiz upgrades come from the telephony provider (server-to-server)
  // and are not user-initiated, so we skip JWT enforcement for those providers.
  // Webcall connections are initiated directly from a user's browser and MUST
  // carry a valid platform session token to prevent API-key burning.
  if (provider === "webcall") {
    const token = qs.get("token") ?? "";
    const payload = token ? verifySessionToken(token) : null;
    if (!payload) {
      logger.warn({ agentId, remoteIp }, "Webcall WebSocket rejected: missing or invalid JWT");
      socket.write("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
    // Verify the authenticated user actually owns this agent — prevents one
    // tenant from burning another tenant's API keys by guessing agentIds.
    try {
      const [agent] = await db
        .select({ userId: agentsTable.userId })
        .from(agentsTable)
        .where(eq(agentsTable.id, agentId));
      // NOTE: platform-managed agents have userId = null and correctly fail
      // this check. If public/demo agents are ever needed, add an explicit
      // allow path (e.g. agent.webcallPublic flag or admin-role bypass).
      if (!agent || agent.userId !== payload.sub) {
        logger.warn({ agentId, sub: payload.sub, agentUserId: agent?.userId }, "Webcall WebSocket rejected: agent ownership mismatch");
        socket.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
        socket.destroy();
        return;
      }
    } catch (err) {
      logger.error({ err, agentId }, "Webcall ownership check failed");
      socket.write("HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
  }

  wss.handleUpgrade(request, socket, head, (ws: import("ws").WebSocket) => {
    logger.info({ provider, agentId, platformTelephony, campaignLeadId, url }, "WebSocket upgraded");
    switch (provider) {
      case "twilio":   void handleTwilioWebSocket(ws, agentId, campaignLeadId);                                                      break;
      case "plivo":    void handlePlivoWebSocket(ws, agentId, campaignLeadId);                                                       break;
      case "vobiz":    void handleVobizWebSocket(ws, agentId, platformTelephony, campaignLeadId);                                    break;
      case "webcall":  void handleWebCallWebSocket(ws, agentId, callerId, callbackId, promptVariables);                              break;
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

// Log which redirect URI will be used for Google Calendar OAuth so mismatches
// are immediately visible in logs without having to trigger the flow first.
if (process.env["GOOGLE_REDIRECT_URI"]) {
  logger.info({ uri: process.env["GOOGLE_REDIRECT_URI"] }, "Google Calendar OAuth: GOOGLE_REDIRECT_URI set");
} else if (process.env["REPLIT_DOMAINS"]) {
  logger.info(
    { domains: process.env["REPLIT_DOMAINS"] },
    "Google Calendar OAuth: GOOGLE_REDIRECT_URI not set — using dynamic redirect URI derivation from REPLIT_DOMAINS / forwarded host",
  );
} else {
  logger.warn(
    "Google Calendar OAuth: neither GOOGLE_REDIRECT_URI nor REPLIT_DOMAINS is set — OAuth flow will likely fail",
  );
}

// Start server first so the healthcheck probe can reach /api/healthz immediately.
// Migrations run in the background after the port is bound.
server.listen(port, () => {
  logger.info({ port }, "Server listening");
  initAudioPool(new URL(`file://${workerFile}`));

  // Run DB migrations after the port is open so Railway's health-check passes
  // while the schema is being applied. Services that need tables will become
  // available within seconds; the server gracefully exits if migration fails.
  const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "../../../lib/db/drizzle");
  migrate(db, { migrationsFolder })
    .then(() => {
      logger.info({ migrationsFolder }, "DB migrations applied");
      void seedManagedKeyFromEnv("managed_qwen_key",     "GROQ_API_KEY");
      void seedManagedKeyFromEnv("managed_sarvam_key",   "SARVAM_API_KEY");
      void seedManagedKeyFromEnv("managed_cartesia_key", "CARTESIA_API_KEY");
      void migrateSaarikaToSaaras();
      startCallbackPoller();
      startSpikeChecker();
      startAlertSweep();
      startRateLimitCleanup();
      startBatchScheduler();
    })
    .catch((err: unknown) => {
      // Log but do NOT exit — keeps the process alive so Railway's healthcheck
      // passes and we can inspect the error in the Console tab.
      logger.error({ err, migrationsFolder }, "DB migration failed — server will stay up for diagnostics");
    });
});

function gracefulShutdown(signal: string) {
  logger.info({ signal }, "Received shutdown signal, closing server");
  void agnost.shutdown();
  server.close((err) => {
    if (err) {
      logger.error({ err }, "Error closing server");
      process.exit(1);
    }
    logger.info("Server closed cleanly");
    process.exit(0);
  });

  // Force exit after 10 seconds if connections don't drain
  setTimeout(() => {
    logger.warn("Forcing exit after timeout");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
