import http from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { WebSocketServer } from "ws";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { initAudioPool } from "./orchestration/audioPool.js";
import { handleTwilioWebSocket } from "./orchestration/telephony/twilio.js";
import { handlePlivoWebSocket } from "./orchestration/telephony/plivo.js";
import { handleVobizWebSocket } from "./orchestration/telephony/vobiz.js";
import { handleWebCallWebSocket } from "./orchestration/telephony/webcall.js";

// Initialise the audio worker pool before any WebSocket connections arrive.
// Both dev (build+start) and prod run from dist/, where esbuild emits the worker as
// dist/orchestration/audioWorker.mjs.
const __dirname = dirname(fileURLToPath(import.meta.url));
const workerFile = join(__dirname, "orchestration", "audioWorker.mjs");
initAudioPool(new URL(`file://${workerFile}`));

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = request.url ?? "";

  // Match /api/ws/<provider>/<agentId>[?pt=1]
  const match = url.match(/^\/api\/ws\/(twilio|plivo|vobiz|webcall)\/(\d+)/);
  if (!match) {
    socket.destroy();
    return;
  }

  const provider          = match[1] as "twilio" | "plivo" | "vobiz" | "webcall";
  const agentId           = parseInt(match[2]!, 10);
  const platformTelephony = url.includes("pt=1");

  wss.handleUpgrade(request, socket, head, (ws: import("ws").WebSocket) => {
    logger.info({ provider, agentId, platformTelephony, url }, "WebSocket upgraded");
    switch (provider) {
      case "twilio":   void handleTwilioWebSocket(ws, agentId);                      break;
      case "plivo":    void handlePlivoWebSocket(ws, agentId);                       break;
      case "vobiz":    void handleVobizWebSocket(ws, agentId, platformTelephony);    break;
      case "webcall":  void handleWebCallWebSocket(ws, agentId);                     break;
    }
  });
});

server.listen(port, () => {
  logger.info({ port }, "Server listening");
});
