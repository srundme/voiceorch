/**
 * Self-serve Recall Calendar V2 — Google OAuth connect + event bot toggles.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext } from "../middlewares/clientContext.js";
import { getAppOrigins, getSelfBaseUrl } from "../lib/app-domain.js";
import { logger } from "../lib/logger.js";
import {
  connectMeetCalendarForUser,
  disconnectMeetCalendar,
  exchangeMeetCalendarCode,
  getConnectionForUser,
  getMeetCalendarAuthUrl,
  getRecallCalendarEvent,
  isSupportedMeetingUrl,
  listEnabledEventBots,
  listRecallCalendarEvents,
  meetCalendarRedirectUri,
  removeBotFromCalendarEvent,
  resyncEnabledBotsForCalendar,
  scheduleBotForCalendarEvent,
  syncCalendarStatusFromRecall,
  verifyOAuthState,
  verifySvixWebhook,
} from "../services/recall-calendar.js";

const router: IRouter = Router();

function isTrustedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return false;
    if (process.env["APP_BASE_URL"]) {
      try {
        if (new URL(process.env["APP_BASE_URL"]).hostname === url.hostname) return true;
      } catch {
        /* ignore */
      }
    }
    const trusted = getAppOrigins().map((o) => {
      try {
        return new URL(o).hostname;
      } catch {
        return "";
      }
    }).filter(Boolean);
    if (trusted.includes(url.hostname)) return true;
    if (/^[a-z0-9-]+-\d{2}-[a-z0-9]+\.sisko\.replit\.dev$/.test(url.hostname)) return true;
    if (/^[a-z0-9-]+\.replit\.dev$/.test(url.hostname)) return true;
    if (url.hostname === "localhost") return true;
    return false;
  } catch {
    return false;
  }
}

function deriveRedirectUri(req: Request): string {
  if (process.env["GOOGLE_MEET_CALENDAR_REDIRECT_URI"]) {
    return process.env["GOOGLE_MEET_CALENDAR_REDIRECT_URI"];
  }
  const forwardedHost = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim();
  const forwardedProto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? "https";
  const host = forwardedHost ?? req.hostname;
  if (host && isTrustedOrigin(`${forwardedProto}://${host}`)) {
    return `${forwardedProto}://${host}/api/meet-calendar/google/callback`;
  }
  return meetCalendarRedirectUri();
}

function dashboardBase(returnOrigin?: string): string {
  if (returnOrigin && isTrustedOrigin(returnOrigin)) return returnOrigin.replace(/\/$/, "");
  if (process.env["APP_BASE_URL"]) return process.env["APP_BASE_URL"].replace(/\/$/, "");
  return getSelfBaseUrl();
}

// ── Public webhook (Svix; uses req.rawBody from express.json verify) ─────────

router.post(
  "/meet-calendar/recall-webhooks",
  async (req: Request, res: Response): Promise<void> => {
    const rawBuf = (req as Request & { rawBody?: Buffer }).rawBody;
    const rawBody =
      rawBuf
        ? rawBuf.toString("utf8")
        : typeof req.body === "string"
          ? req.body
          : JSON.stringify(req.body ?? {});

    const ok = verifySvixWebhook(rawBody, {
      id: req.header("svix-id") ?? undefined,
      timestamp: req.header("svix-timestamp") ?? undefined,
      signature: req.header("svix-signature") ?? undefined,
    });
    if (!ok) {
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }

    let payload: { event?: string; data?: { calendar_id?: string; last_updated_ts?: string } };
    try {
      payload = JSON.parse(rawBody) as typeof payload;
    } catch {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }

    const calendarId = payload.data?.calendar_id;
    if (!calendarId) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    try {
      if (payload.event === "calendar.update") {
        await syncCalendarStatusFromRecall(calendarId);
      } else if (payload.event === "calendar.sync_events") {
        await resyncEnabledBotsForCalendar(calendarId, payload.data?.last_updated_ts);
      }
      res.status(200).json({ ok: true });
    } catch (err) {
      logger.error({ err, calendarId, event: payload.event }, "Meet calendar webhook failed");
      res.status(500).json({ error: "Webhook processing failed" });
    }
  },
);

// ── OAuth ────────────────────────────────────────────────────────────────────

router.get("/meet-calendar/google/connect-url", requireAuth, clientContext, (req, res): void => {
  try {
    const userId = (req as unknown as { clerkUserId: string }).clerkUserId;
    const returnOrigin = req.query["returnOrigin"] as string | undefined;
    const redirectUri = deriveRedirectUri(req);
    const url = getMeetCalendarAuthUrl({
      userId,
      returnOrigin,
      redirectUri,
    });
    res.json({ url });
  } catch (err) {
    logger.error({ err }, "meet-calendar connect-url failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to start OAuth" });
  }
});

router.get("/meet-calendar/google/callback", async (req, res): Promise<void> => {
  const state = verifyOAuthState(req.query["state"] as string | undefined);
  const code = typeof req.query["code"] === "string" ? req.query["code"] : "";
  const errParam = typeof req.query["error"] === "string" ? req.query["error"] : "";

  const returnOrigin = state?.returnOrigin;
  const base = dashboardBase(returnOrigin);
  const donePath = `${base}/app/meet?calendar=`;

  if (errParam || !state || !code) {
    res.redirect(`${donePath}error`);
    return;
  }

  try {
    const redirectUri = deriveRedirectUri(req);
    const tokens = await exchangeMeetCalendarCode(code, redirectUri);
    await connectMeetCalendarForUser({
      userId: state.clerkId,
      refreshToken: tokens.refreshToken,
      email: tokens.email,
      scopes: tokens.grantedScopes,
    });
    // Notify opener popup if present
    res.status(200).send(`<!DOCTYPE html><html><body><script>
      try {
        if (window.opener) {
          window.opener.postMessage({ type: "meet-calendar-oauth", ok: true }, "*");
          try { new BroadcastChannel("meet-calendar-oauth").postMessage({ ok: true }); } catch (e) {}
        }
      } catch (e) {}
      location.replace(${JSON.stringify(`${donePath}connected`)});
    </script><p>Connected. You can close this window.</p></body></html>`);
  } catch (err) {
    logger.error({ err }, "meet-calendar OAuth callback failed");
    res.redirect(`${donePath}error`);
  }
});

// ── Connection CRUD ──────────────────────────────────────────────────────────

router.get("/meet-calendar/connection", requireAuth, clientContext, async (req, res): Promise<void> => {
  const userId = (req as unknown as { clerkUserId: string }).clerkUserId;
  const conn = await getConnectionForUser(userId);
  if (!conn) {
    res.json({ connected: false });
    return;
  }
  res.json({
    connected: true,
    id: conn.id,
    email: conn.platformEmail || conn.email,
    status: conn.status,
    recallCalendarId: conn.recallCalendarId,
    connectedAt: conn.createdAt,
  });
});

router.delete("/meet-calendar/connection", requireAuth, clientContext, async (req, res): Promise<void> => {
  const userId = (req as unknown as { clerkUserId: string }).clerkUserId;
  try {
    await disconnectMeetCalendar(userId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userId }, "meet-calendar disconnect failed");
    res.status(502).json({ error: err instanceof Error ? err.message : "Disconnect failed" });
  }
});

// ── Events + bot toggle ──────────────────────────────────────────────────────

router.get("/meet-calendar/events", requireAuth, clientContext, async (req, res): Promise<void> => {
  const userId = (req as unknown as { clerkUserId: string }).clerkUserId;
  const conn = await getConnectionForUser(userId);
  if (!conn) {
    res.status(404).json({ error: "Google calendar not connected for AI meetings" });
    return;
  }
  if (conn.status === "disconnected") {
    res.status(409).json({ error: "Calendar disconnected — reconnect Google" });
    return;
  }
  try {
    const startGte = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const events = await listRecallCalendarEvents(conn.recallCalendarId, {
      startTimeGte: startGte,
    });
    const enabled = await listEnabledEventBots(userId);
    const enabledMap = new Map(enabled.map((e) => [e.recallEventId, e]));
    const upcoming = events
      .filter((e) => !e.isDeleted)
      .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""))
      .slice(0, 50)
      .map((e) => {
        const bot = enabledMap.get(e.id);
        return {
          id: e.id,
          title: e.title ?? "(No title)",
          startTime: e.startTime,
          endTime: e.endTime,
          meetingUrl: e.meetingUrl,
          canJoin: isSupportedMeetingUrl(e.meetingUrl),
          botEnabled: Boolean(bot?.enabled),
          agentId: bot?.agentId ?? null,
          botId: bot?.recallBotId ?? null,
        };
      });
    res.json({ events: upcoming, status: conn.status, email: conn.platformEmail || conn.email });
  } catch (err) {
    logger.error({ err, userId }, "meet-calendar list events failed");
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to list events" });
  }
});

router.post(
  "/meet-calendar/events/:eventId/bot",
  requireAuth,
  clientContext,
  async (req, res): Promise<void> => {
    const userId = (req as unknown as { clerkUserId: string }).clerkUserId;
    const eventIdRaw = req.params["eventId"];
    const eventId = Array.isArray(eventIdRaw) ? eventIdRaw[0] : eventIdRaw;
    const agentId = Number(req.body?.agentId);
    if (!eventId) {
      res.status(400).json({ error: "eventId required" });
      return;
    }
    if (!Number.isInteger(agentId) || agentId <= 0) {
      res.status(400).json({ error: "agentId is required" });
      return;
    }
    const conn = await getConnectionForUser(userId);
    if (!conn) {
      res.status(404).json({ error: "Google calendar not connected for AI meetings" });
      return;
    }
    try {
      const ev = await getRecallCalendarEvent(eventId);
      if (!ev || ev.isDeleted) {
        res.status(404).json({ error: "Calendar event not found" });
        return;
      }
      if (!ev.meetingUrl || !isSupportedMeetingUrl(ev.meetingUrl)) {
        res.status(400).json({ error: "Event has no Google Meet, Zoom, or Teams link" });
        return;
      }
      const result = await scheduleBotForCalendarEvent({
        userId,
        agentId,
        eventId,
        meetingUrl: ev.meetingUrl,
        startsAt: ev.startTime ? new Date(ev.startTime) : null,
        eventTitle: ev.title,
        recallCalendarId: conn.recallCalendarId,
      });
      res.json({
        ok: true,
        botId: result.botId,
        agentId: result.agentId,
        eventId,
        meetingUrl: ev.meetingUrl,
      });
    } catch (err) {
      logger.error({ err, userId, eventId }, "meet-calendar schedule bot failed");
      res.status(502).json({ error: err instanceof Error ? err.message : "Failed to schedule bot" });
    }
  },
);

router.delete(
  "/meet-calendar/events/:eventId/bot",
  requireAuth,
  clientContext,
  async (req, res): Promise<void> => {
    const userId = (req as unknown as { clerkUserId: string }).clerkUserId;
    const eventIdRaw = req.params["eventId"];
    const eventId = Array.isArray(eventIdRaw) ? eventIdRaw[0] : eventIdRaw;
    if (!eventId) {
      res.status(400).json({ error: "eventId required" });
      return;
    }
    try {
      await removeBotFromCalendarEvent({ userId, eventId });
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err, userId, eventId }, "meet-calendar remove bot failed");
      res.status(502).json({ error: err instanceof Error ? err.message : "Failed to remove bot" });
    }
  },
);

export default router;
