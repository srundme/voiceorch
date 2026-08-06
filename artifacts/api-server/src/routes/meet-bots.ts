// Meeting bots (Recall.ai): send a voice agent into a Google Meet / Zoom / Teams.
// Public:  GET  /meet-bots/page?mb=<token>   — the webpage the Recall bot renders
// Authed:  POST /meet-bots                   — { agentId, meetingUrl } → create bot
//          GET  /meet-bots/:botId            — status
//          DELETE /meet-bots/:botId          — bot leaves the meeting
import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
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
  getMeetBotIdentity,
} from "../services/meet-bots.js";
import {
  bindMeetRosterBot,
  createMeetRoster,
  handleRecallParticipantEvent,
  recallRealtimeEvents,
  scheduleDiarizedTranscriptArchive,
} from "../services/meet-roster.js";
import {
  parseMeetingsConfig,
  resolveMeetRuntimeAgentId,
} from "../services/meeting-runtime.js";

const router: IRouter = Router();

const MEET_URL_RE = /^https:\/\/(meet\.google\.com|[a-z0-9.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\//i;
// The bot loads the page within a minute of launch, but may reconnect mid-
// meeting — keep the token valid for a long meeting, no longer.
const PAGE_TOKEN_TTL_MS = 4 * 60 * 60 * 1000;

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

// ── Public: Recall realtime events (participants + diarized transcript) ──────
// Auth = the same signed launch token, carried in the webhook URL we gave
// Recall at bot creation. Always 200s (Recall retries on non-2xx; a forged or
// expired token should be dropped silently, not hammered).
router.post("/meet-bots/recall-events", (req, res) => {
  res.json({ ok: true });
  try {
    const token = typeof req.query["mb"] === "string" ? req.query["mb"] : "";
    const payload = token ? verifyMeetBotToken(token) : null;
    if (!payload?.mid) return;
    handleRecallParticipantEvent(payload.mid, req.body);
  } catch (err) {
    logger.warn({ err }, "Recall realtime event handling failed");
  }
});

// ── Authed: bot identity (email for admit / calendar invites) ────────────────
router.get("/meet-bots/identity", requireAuth, (_req, res) => {
  res.json(getMeetBotIdentity());
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
      .select({
        userId: agentsTable.userId,
        name: agentsTable.name,
        agentConfig: agentsTable.agentConfig,
      })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId));
    const agent = rows[0];
    if (!agent || agent.userId !== userId) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    // Channels → Meetings: whoJoins=delegate swaps the runtime agent that enters the room.
    const meetings = parseMeetingsConfig(agent.agentConfig);
    let runtimeAgentId = resolveMeetRuntimeAgentId(agentId, agent.agentConfig);
    let botName = agent.name || "Voice Agent";
    if (runtimeAgentId !== agentId) {
      const [delegate] = await db
        .select({
          userId: agentsTable.userId,
          name: agentsTable.name,
          agentConfig: agentsTable.agentConfig,
        })
        .from(agentsTable)
        .where(eq(agentsTable.id, runtimeAgentId));
      if (!delegate || delegate.userId !== userId) {
        res.status(400).json({ error: "Meeting delegate agent not found or not owned by you" });
        return;
      }
      botName = delegate.name || botName;
    }

    const mid = randomUUID();
    const token = signMeetBotToken({
      agentId: runtimeAgentId,
      userId,
      exp: Date.now() + PAGE_TOKEN_TTL_MS,
      mid,
      passMemory: meetings.passMemory,
      passCallContext: meetings.passCallContext,
    });
    const base = getSelfBaseUrl();
    const pageUrl = `${base}/api/meet-bots/page?mb=${encodeURIComponent(token)}`;
    // Speaker identification: register the roster BEFORE the bot exists so the
    // earliest participant webhooks land on a live entry.
    createMeetRoster(mid, botName);
    const bot = await createRecallBot({
      meetingUrl,
      botName,
      pageUrl,
      ownerUserId: userId,
      agentId: runtimeAgentId,
      eventsUrl: `${base}/api/meet-bots/recall-events?mb=${encodeURIComponent(token)}`,
      eventsList: recallRealtimeEvents(),
    });
    bindMeetRosterBot(mid, bot.id);
    logger.info(
      { userId, agentId, runtimeAgentId, botId: bot.id, whoJoins: meetings.whoJoins },
      "Meeting bot created",
    );
    res.json({
      botId: bot.id,
      status: bot.statusCode ?? "created",
      agentId: runtimeAgentId,
      configuredAgentId: agentId,
    });
  } catch (err) {
    logger.error({ err, userId, agentId }, "Meeting bot creation failed");
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to create meeting bot" });
  }
});

/** Fetch the bot from Recall and enforce ownership via creation metadata. */
async function getOwnedBot(botId: string, userId: string) {
  const bot = await getRecallBot(botId);
  if (!bot.ownerUserId || bot.ownerUserId !== userId) return null; // fail closed
  return bot;
}

router.get("/meet-bots/:botId", requireAuth, async (req, res) => {
  const userId = (req as unknown as { clerkUserId: string }).clerkUserId;
  try {
    const bot = await getOwnedBot(String(req.params["botId"]), userId);
    if (!bot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }
    res.json({ botId: bot.id, status: bot.statusCode });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to fetch bot status" });
  }
});

router.delete("/meet-bots/:botId", requireAuth, async (req, res) => {
  const userId = (req as unknown as { clerkUserId: string }).clerkUserId;
  try {
    const bot = await getOwnedBot(String(req.params["botId"]), userId);
    if (!bot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }
    await leaveRecallBot(bot.id);
    scheduleDiarizedTranscriptArchive(bot.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to remove bot" });
  }
});

export default router;
