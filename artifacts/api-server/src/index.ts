import http from "http";
import { WebSocketServer } from "ws";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { handleTwilioWebSocket } from "./orchestration/telephony/twilio.js";
import { handlePlivoWebSocket } from "./orchestration/telephony/plivo.js";
import { handleVobizWebSocket } from "./orchestration/telephony/vobiz.js";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

// Use a raw HTTP server so we can attach the WebSocket server to the same port
const server = http.createServer(app);

// ── WebSocket Server ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = request.url ?? "";

  // Match /api/ws/<provider>/<agentId>
  const match = url.match(/^\/api\/ws\/(twilio|plivo|vobiz)\/(\d+)/);
  if (!match) {
    socket.destroy();
    return;
  }

  const provider = match[1] as "twilio" | "plivo" | "vobiz";
  const agentId = parseInt(match[2]!, 10);

  wss.handleUpgrade(request, socket, head, (ws: import("ws").WebSocket) => {
    logger.info({ provider, agentId, url }, "WebSocket connection upgraded");
    switch (provider) {
      case "twilio":
        void handleTwilioWebSocket(ws, agentId);
        break;
      case "plivo":
        void handlePlivoWebSocket(ws, agentId);
        break;
      case "vobiz":
        void handleVobizWebSocket(ws, agentId);
        break;
    }
  });
});

server.listen(port, () => {
  logger.info({ port }, "Server listening");
});
