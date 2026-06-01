/**
 * GET /webcall-notify
 * Server-Sent Events stream for incoming webcall callback notifications.
 * The dashboard subscribes here so the callback poller can ring the browser
 * when a scheduled webcall callback comes due.
 *
 * Auth note: EventSource cannot set custom headers, so the dashboard passes a
 * short-lived Clerk JWT as ?token=<jwt>.  We verify it via authenticateRequest
 * with a synthetic Request that carries the token as a Bearer header.
 */
import { Router } from "express";
import { getAuth, authenticateRequest, clerkClient } from "@clerk/express";
import { registerSseClient } from "../services/webcall-notify.js";

const router = Router();

router.get("/webcall-notify", async (req, res): Promise<void> => {
  let userId: string | null = null;

  const token = typeof req.query["token"] === "string" ? req.query["token"] : null;

  if (token) {
    // EventSource cannot set Authorization headers — token is passed as ?token=<jwt>
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fetchReq = new globalThis.Request("https://placeholder.local/webcall-notify", {
        headers: { Authorization: `Bearer ${token}` },
      }) as any;
      const state = await authenticateRequest({
        clerkClient,
        request: fetchReq,
        options: {
          publishableKey: process.env["CLERK_PUBLISHABLE_KEY"],
          secretKey:      process.env["CLERK_SECRET_KEY"],
        },
      });
      userId = state.toAuth()?.userId ?? null;
    } catch { /* invalid / expired token */ }
  }

  // Fallback: standard cookie/header auth already set by clerkMiddleware
  if (!userId) {
    userId = getAuth(req)?.userId ?? null;
  }

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
