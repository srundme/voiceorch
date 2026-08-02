// Meeting bots (Recall.ai): send a voice agent into a Google Meet / Zoom / Teams.
// Public:  GET  /meet-bots/page?mb=<token>   — the webpage the Recall bot renders
// Authed:  POST /meet-bots                   — { agentId, meetingUrl } → create bot
//          GET  /meet-bots/:botId            — status
//          DELETE /meet-bots/:botId          — bot leaves the meeting
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, agentsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import {
  signMeetBotToken,
  verifyMeetBotToken,
  buildMeetBotPageHtml,
  createRecallBot,
  getRecallBot,
  leaveRecallBot,
} from "../services/meet-bots.js";

const router: IRouter = Router();

const MEET_URL_RE = /^https:\/\/(meet\.google\.com|[a-z0-9.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\//i;
// Bots can sit in a long meeting — token must outlive it comfortably.
const PAGE_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

// ── Public: bot page ─────────────────────────────────────────────────────────
router.get("/meet-bots/page", async (req, res) => {
  const token = typeof req.query["mb"] === "string" ? req.query["mb"] : "";
  const payload = token ? verifyMeetBotToken(token) : null;
  if (!payload) {
    res.status(401).send("Invalid or expired meeting-bot token");
    return;
  }
  let agentName = "Voice Agent";
  try {
    const rows = await db
      .select({ name: agentsTable.name })
      .from(agentsTable)
      .where(eq(agentsTable.id, payload.agentId));
    if (rows[0]?.name) agentName = rows[0].name;
  } catch (err) {
    logger.warn({ err, agentId: payload.agentId }, "meet-bots page: agent name lookup failed");
  }
  res
    .set("Content-Type", "text/html; charset=utf-8")
    .set("Cache-Control", "no-store")
    .send(buildMeetBotPageHtml({ agentId: payload.agentId, token, agentName }));
});

// ── Authed: launch a bot ─────────────────────────────────────────────────────
router.post("/meet-bots", requireAuth, async (req, res) => {
  const userId = (req as unknown as { clerkUserId: string }).clerkUserId;
  const agentId = Number(req.body?.agentId);
  const meetingUrl = typeof req.body?.meetingUrl === "string" ? req.body.meetingUrl.trim() : "";

  if (!Number.isInteger(agentId) || agentId <= 0) {
    res.status(400).json({ error: "agentId is required" });
    return;
  }
  if (!MEET_URL_RE.test(meetingUrl)) {
    res.status(400).json({ error: "meetingUrl must be a Google Meet, Zoom, or Teams link" });
    return;
  }
  if (!process.env["RECALL_API_KEY"]) {
    res.status(503).json({ error: "Meeting bots are not configured (missing Recall API key)" });
    return;
  }

  try {
    const rows = await db
      .select({ userId: agentsTable.userId, name: agentsTable.name })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId));
    const agent = rows[0];
    if (!agent || agent.userId !== userId) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const token = signMeetBotToken({ agentId, userId, exp: Date.now() + PAGE_TOKEN_TTL_MS });
    const pageUrl = `${getSelfBaseUrl()}/api/meet-bots/page?mb=${encodeURIComponent(token)}`;
    const bot = await createRecallBot({
      meetingUrl,
      botName: agent.name || "Voice Agent",
      pageUrl,
    });
    logger.info({ userId, agentId, botId: bot.id }, "Meeting bot created");
    res.json({ botId: bot.id, status: bot.statusCode ?? "created" });
  } catch (err) {
    logger.error({ err, userId, agentId }, "Meeting bot creation failed");
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to create meeting bot" });
  }
});

router.get("/meet-bots/:botId", requireAuth, async (req, res) => {
  try {
    const bot = await getRecallBot(String(req.params["botId"]));
    res.json({ botId: bot.id, status: bot.statusCode });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to fetch bot status" });
  }
});

router.delete("/meet-bots/:botId", requireAuth, async (req, res) => {
  try {
    await leaveRecallBot(String(req.params["botId"]));
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to remove bot" });
  }
});

export default router;
