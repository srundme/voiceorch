/**
 * Shared Meet/Zoom/Teams bot launch used by HTTP routes and workflow steps.
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, agentsTable } from "@workspace/db";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import {
  signMeetBotToken,
  meetBotTokenExp,
  createRecallBot,
  normalizeMeetingUrl,
  isRecallConfigured,
} from "./meet-bots.js";
import {
  bindMeetRosterBot,
  createMeetRoster,
  recallRealtimeEvents,
} from "./meet-roster.js";
import {
  parseMeetingsConfig,
  resolveMeetBotDisplayName,
  resolveMeetRuntimeAgentId,
} from "./meeting-runtime.js";
import { prepareMeetPresentationAtLaunch } from "./meet-presentation.js";

const MEET_URL_RE = /^https:\/\/(meet\.google\.com|[a-z0-9.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\//i;

export async function launchMeetingBotForAgent(opts: {
  userId: string;
  configuredAgentId: number;
  meetingUrl: string;
}): Promise<{ botId: string; runtimeAgentId: number }> {
  const meetingUrl = normalizeMeetingUrl(opts.meetingUrl);
  if (!MEET_URL_RE.test(meetingUrl)) {
    throw new Error("meetingUrl must be a Google Meet, Zoom, or Teams link");
  }
  if (!(await isRecallConfigured())) {
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
  let runtimeName = agent.name || "Voice Agent";
  let runtimeMeetings = meetings;
  if (runtimeAgentId !== opts.configuredAgentId) {
    const [delegate] = await db
      .select({
        userId: agentsTable.userId,
        name: agentsTable.name,
        agentConfig: agentsTable.agentConfig,
      })
      .from(agentsTable)
      .where(eq(agentsTable.id, runtimeAgentId))
      .limit(1);
    if (!delegate || delegate.userId !== opts.userId) {
      throw new Error("Meeting delegate agent not found or not owned");
    }
    runtimeName = delegate.name || runtimeName;
    runtimeMeetings = parseMeetingsConfig(delegate.agentConfig);
  }
  const botName = resolveMeetBotDisplayName(runtimeMeetings, runtimeName);

  const mid = randomUUID();
  const token = signMeetBotToken({
    agentId: runtimeAgentId,
    userId: opts.userId,
    exp: meetBotTokenExp(),
    mid,
    meetUrl: meetingUrl,
    passMemory: meetings.passMemory,
    passCallContext: meetings.passCallContext,
  });
  const base = getSelfBaseUrl();
  const pageUrl = `${base}/api/meet-bots/page?mb=${encodeURIComponent(token)}`;
  createMeetRoster(mid, botName);
  const { screensharePageUrl } = prepareMeetPresentationAtLaunch({
    mid,
    token,
    baseUrl: base,
    presentationUrl: meetings.presentationUrl,
    presentationAutoStart: meetings.presentationAutoStart,
  });
  const bot = await createRecallBot({
    meetingUrl,
    botName,
    pageUrl,
    ownerUserId: opts.userId,
    agentId: runtimeAgentId,
    eventsUrl: `${base}/api/meet-bots/recall-events?mb=${encodeURIComponent(token)}`,
    eventsList: recallRealtimeEvents(),
    ...(screensharePageUrl ? { screensharePageUrl } : {}),
  });
  bindMeetRosterBot(mid, bot.id);

  return { botId: bot.id, runtimeAgentId };
}
