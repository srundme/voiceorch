/**
 * Shared Meet/Zoom/Teams bot launch used by HTTP routes and workflow steps.
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, agentsTable } from "@workspace/db";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import {
  signMeetBotToken,
  createRecallBot,
} from "./meet-bots.js";
import {
  createMeetRoster,
  RECALL_PARTICIPANT_EVENTS,
} from "./meet-roster.js";
import {
  parseMeetingsConfig,
  resolveMeetRuntimeAgentId,
} from "./meeting-runtime.js";

const PAGE_TOKEN_TTL_MS = 4 * 60 * 60 * 1000;
const MEET_URL_RE = /^https:\/\/(meet\.google\.com|[a-z0-9.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\//i;

export async function launchMeetingBotForAgent(opts: {
  userId: string;
  configuredAgentId: number;
  meetingUrl: string;
}): Promise<{ botId: string; runtimeAgentId: number }> {
  const meetingUrl = opts.meetingUrl.trim();
  if (!MEET_URL_RE.test(meetingUrl)) {
    throw new Error("meetingUrl must be a Google Meet, Zoom, or Teams link");
  }
  if (!process.env["RECALL_API_KEY"]) {
    throw new Error("Meeting bots are not configured (missing Recall API key)");
  }

  const [agent] = await db
    .select({
      userId: agentsTable.userId,
      name: agentsTable.name,
      agentConfig: agentsTable.agentConfig,
    })
    .from(agentsTable)
    .where(eq(agentsTable.id, opts.configuredAgentId))
    .limit(1);
  if (!agent || agent.userId !== opts.userId) {
    throw new Error("Agent not found");
  }

  const meetings = parseMeetingsConfig(agent.agentConfig);
  let runtimeAgentId = resolveMeetRuntimeAgentId(opts.configuredAgentId, agent.agentConfig);
  let botName = agent.name || "Voice Agent";
  if (runtimeAgentId !== opts.configuredAgentId) {
    const [delegate] = await db
      .select({
        userId: agentsTable.userId,
        name: agentsTable.name,
      })
      .from(agentsTable)
      .where(eq(agentsTable.id, runtimeAgentId))
      .limit(1);
    if (!delegate || delegate.userId !== opts.userId) {
      throw new Error("Meeting delegate agent not found or not owned");
    }
    botName = delegate.name || botName;
  }

  const mid = randomUUID();
  const token = signMeetBotToken({
    agentId: runtimeAgentId,
    userId: opts.userId,
    exp: Date.now() + PAGE_TOKEN_TTL_MS,
    mid,
    passMemory: meetings.passMemory,
    passCallContext: meetings.passCallContext,
  });
  const base = getSelfBaseUrl();
  const pageUrl = `${base}/api/meet-bots/page?mb=${encodeURIComponent(token)}`;
  createMeetRoster(mid, botName);
  const bot = await createRecallBot({
    meetingUrl,
    botName,
    pageUrl,
    ownerUserId: opts.userId,
    agentId: runtimeAgentId,
    eventsUrl: `${base}/api/meet-bots/recall-events?mb=${encodeURIComponent(token)}`,
    eventsList: RECALL_PARTICIPANT_EVENTS,
  });

  return { botId: bot.id, runtimeAgentId };
}
