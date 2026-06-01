/**
 * GET /webcall-notify
 * Server-Sent Events stream for incoming webcall callback notifications.
 * The dashboard subscribes here so the callback poller can ring the browser
 * when a scheduled webcall callback comes due.
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { registerSseClient } from "../services/webcall-notify.js";

const router = Router();

router.get("/webcall-notify", (req, res): void => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Keep-alive ping every 20 s to prevent proxy timeouts
  const keepAlive = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { /* closed */ }
  }, 20_000);

  const unregister = registerSseClient(userId, res);

  req.on("close", () => {
    clearInterval(keepAlive);
    unregister();
  });
});

export default router;
