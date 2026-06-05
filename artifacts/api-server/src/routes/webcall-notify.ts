/**
 * GET /webcall-notify
 * Server-Sent Events stream for incoming webcall callback notifications.
 * The dashboard subscribes here so the callback poller can ring the browser
 * when a scheduled webcall callback comes due.
 *
 * Auth note: EventSource cannot set custom headers, so the dashboard passes the
 * platform session token as ?token=<jwt>. `attachSession` (app-level) already
 * accepts the token via either Authorization: Bearer or ?token=, so by the time
 * we get here `req.clerkUserId` is populated if the token is valid.
 */
import { Router } from "express";
import { registerSseClient } from "../services/webcall-notify.js";

const router = Router();

router.get("/webcall-notify", async (req, res): Promise<void> => {
  const userId = (req as unknown as { clerkUserId?: string }).clerkUserId ?? null;

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
