/**
 * Recall Calendar V2 — create calendars from Google OAuth refresh tokens,
 * list events, schedule/remove SnapServe meet-bots on opt-in events.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { google } from "googleapis";
import {
  db,
  recallCalendarConnectionsTable,
  recallCalendarEventBotsTable,
  agentsTable,
} from "@workspace/db";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { logger } from "../lib/logger.js";
import {
  buildRecallBotConfig,
  recallFetchV2,
  signMeetBotToken,
  meetBotTokenExp,
  detectMeetingPlatform,
} from "./meet-bots.js";
import {
  bindMeetRosterBot,
  createMeetRoster,
  recallRealtimeEvents,
} from "./meet-roster.js";
import { parseMeetingsConfig, resolveMeetBotDisplayName } from "./meeting-runtime.js";
import { prepareMeetPresentationAtLaunch } from "./meet-presentation.js";
import { signOAuthState, verifyOAuthState } from "./scheduling/google-calendar.js";

const MEET_URL_RE =
  /^https:\/\/(meet\.google\.com|[a-z0-9.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\//i;

/**
 * Same scopes as booking Google Calendar OAuth (already Google-verified for SnapServe).
 * Recall Calendar V2 accepts full `calendar` (superset of events.readonly).
 * Using a separate readonly scope triggered "Google hasn't verified this app".
 */
export const MEET_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
];

function googleClientCreds(): { clientId: string; clientSecret: string } {
  const clientId = process.env["GOOGLE_CLIENT_ID"]?.trim();
  const clientSecret = process.env["GOOGLE_CLIENT_SECRET"]?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
  }
  return { clientId, clientSecret };
}

export function meetCalendarRedirectUri(reqHostFallback?: string): string {
  if (process.env["GOOGLE_MEET_CALENDAR_REDIRECT_URI"]) {
    return process.env["GOOGLE_MEET_CALENDAR_REDIRECT_URI"];
  }
  if (reqHostFallback) return reqHostFallback;
  return `${getSelfBaseUrl()}/api/meet-calendar/google/callback`;
}

export function getMeetCalendarAuthUrl(opts: {
  userId: string;
  returnOrigin?: string;
  redirectUri: string;
}): string {
  const { clientId } = googleClientCreds();
  const state = signOAuthState({
    clerkId: opts.userId,
    returnTo: "meet-calendar",
    ...(opts.returnOrigin ? { returnOrigin: opts.returnOrigin } : {}),
  });
  const client = new google.auth.OAuth2(clientId, googleClientCreds().clientSecret, opts.redirectUri);
  return client.generateAuthUrl({
    access_type: "offline",
    scope: MEET_CALENDAR_SCOPES,
    prompt: "consent",
    state,
  });
}

export async function exchangeMeetCalendarCode(
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; email: string; grantedScopes: string }> {
  const { clientId, clientSecret } = googleClientCreds();
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh_token. Revoke SnapServe access in Google Account → Security → Third-party access, then connect again.",
    );
  }
  if (!tokens.access_token) throw new Error("Missing access_token from Google");
  const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userInfoRes.ok) throw new Error(`Google userinfo error: ${userInfoRes.status}`);
  const userInfo = (await userInfoRes.json()) as { email?: string };
  if (!userInfo.email) throw new Error("No email returned from Google");
  return {
    refreshToken: tokens.refresh_token,
    email: userInfo.email,
    grantedScopes: tokens.scope ?? MEET_CALENDAR_SCOPES.join(" "),
  };
}

export { verifyOAuthState };

export type RecallCalendarRecord = {
  id: string;
  status: string;
  platformEmail: string | null;
  oauthEmail: string | null;
};

export async function createRecallCalendar(opts: {
  refreshToken: string;
  email: string;
  userId: string;
}): Promise<RecallCalendarRecord> {
  const { clientId, clientSecret } = googleClientCreds();
  const res = await recallFetchV2("/calendars/", {
    method: "POST",
    body: JSON.stringify({
      platform: "google_calendar",
      oauth_client_id: clientId,
      oauth_client_secret: clientSecret,
      oauth_refresh_token: opts.refreshToken,
      oauth_email: opts.email,
      metadata: { snapserveUserId: opts.userId },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Recall create calendar failed (${res.status}): ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    id: string;
    status?: string;
    platform_email?: string | null;
    oauth_email?: string | null;
  };
  return {
    id: data.id,
    status: data.status ?? "connecting",
    platformEmail: data.platform_email ?? null,
    oauthEmail: data.oauth_email ?? opts.email,
  };
}

export async function updateRecallCalendarRefreshToken(
  recallCalendarId: string,
  refreshToken: string,
  email: string,
): Promise<RecallCalendarRecord> {
  const { clientId, clientSecret } = googleClientCreds();
  const res = await recallFetchV2(`/calendars/${encodeURIComponent(recallCalendarId)}/`, {
    method: "PATCH",
    body: JSON.stringify({
      oauth_client_id: clientId,
      oauth_client_secret: clientSecret,
      oauth_refresh_token: refreshToken,
      oauth_email: email,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Recall update calendar failed (${res.status}): ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    id: string;
    status?: string;
    platform_email?: string | null;
    oauth_email?: string | null;
  };
  return {
    id: data.id,
    status: data.status ?? "connecting",
    platformEmail: data.platform_email ?? null,
    oauthEmail: data.oauth_email ?? email,
  };
}

export async function deleteRecallCalendarRemote(recallCalendarId: string): Promise<void> {
  const res = await recallFetchV2(`/calendars/${encodeURIComponent(recallCalendarId)}/`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`Recall delete calendar failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

export async function retrieveRecallCalendar(recallCalendarId: string): Promise<RecallCalendarRecord> {
  const res = await recallFetchV2(`/calendars/${encodeURIComponent(recallCalendarId)}/`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Recall get calendar failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    id: string;
    status?: string;
    platform_email?: string | null;
    oauth_email?: string | null;
  };
  return {
    id: data.id,
    status: data.status ?? "unknown",
    platformEmail: data.platform_email ?? null,
    oauthEmail: data.oauth_email ?? null,
  };
}

export type RecallCalendarEvent = {
  id: string;
  title: string | null;
  startTime: string | null;
  endTime: string | null;
  meetingUrl: string | null;
  isDeleted: boolean;
  raw?: unknown;
};

function extractMeetingUrl(ev: Record<string, unknown>): string | null {
  const direct = ev["meeting_url"];
  if (typeof direct === "string" && MEET_URL_RE.test(direct)) return direct.trim();
  if (direct && typeof direct === "object") {
    const nested = (direct as { meeting_id?: string; url?: string }).url;
    if (typeof nested === "string" && MEET_URL_RE.test(nested)) return nested.trim();
  }
  const conf = ev["conference_data"] ?? ev["conferenceData"];
  if (conf && typeof conf === "object") {
    const entryPoints = (conf as { entry_points?: Array<{ uri?: string }> }).entry_points
      ?? (conf as { entryPoints?: Array<{ uri?: string }> }).entryPoints;
    if (Array.isArray(entryPoints)) {
      for (const ep of entryPoints) {
        if (typeof ep?.uri === "string" && MEET_URL_RE.test(ep.uri)) return ep.uri.trim();
      }
    }
  }
  const loc = ev["location"];
  if (typeof loc === "string") {
    const m = loc.match(/https:\/\/(?:meet\.google\.com|[a-z0-9.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\/[^\s]+/i);
    if (m) return m[0];
  }
  const desc = ev["description"];
  if (typeof desc === "string") {
    const m = desc.match(/https:\/\/(?:meet\.google\.com|[a-z0-9.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\/[^\s<>"]+/i);
    if (m) return m[0];
  }
  return null;
}

function mapEvent(ev: Record<string, unknown>): RecallCalendarEvent {
  const start =
    (typeof ev["start_time"] === "string" && ev["start_time"])
    || (typeof ev["start"] === "string" && ev["start"])
    || null;
  const end =
    (typeof ev["end_time"] === "string" && ev["end_time"])
    || (typeof ev["end"] === "string" && ev["end"])
    || null;
  return {
    id: String(ev["id"] ?? ""),
    title: typeof ev["title"] === "string" ? ev["title"] : (typeof ev["summary"] === "string" ? ev["summary"] : null),
    startTime: start,
    endTime: end,
    meetingUrl: extractMeetingUrl(ev),
    isDeleted: ev["is_deleted"] === true,
    raw: ev,
  };
}

export async function listRecallCalendarEvents(
  recallCalendarId: string,
  opts?: { updatedAtGte?: string; startTimeGte?: string },
): Promise<RecallCalendarEvent[]> {
  const params = new URLSearchParams();
  params.set("calendar_id", recallCalendarId);
  params.set("is_deleted", "false");
  if (opts?.updatedAtGte) params.set("updated_at__gte", opts.updatedAtGte);
  if (opts?.startTimeGte) params.set("start_time__gte", opts.startTimeGte);
  const out: RecallCalendarEvent[] = [];
  let path: string | null = `/calendar-events/?${params.toString()}`;
  let pages = 0;
  while (path && pages < 20) {
    pages += 1;
    const res = await recallFetchV2(path);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Recall list calendar events failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      results?: Record<string, unknown>[];
      next?: string | null;
    };
    for (const ev of data.results ?? []) {
      const mapped = mapEvent(ev);
      if (mapped.id) out.push(mapped);
    }
    if (data.next) {
      try {
        const u = new URL(data.next);
        path = `${u.pathname.replace(/^\/api\/v2/, "")}${u.search}`;
      } catch {
        path = null;
      }
    } else {
      path = null;
    }
  }
  return out;
}

export async function getRecallCalendarEvent(eventId: string): Promise<RecallCalendarEvent | null> {
  const res = await recallFetchV2(`/calendar-events/${encodeURIComponent(eventId)}/`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Recall get calendar event failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return mapEvent((await res.json()) as Record<string, unknown>);
}

/** Connect flow: create Recall calendar then persist (refresh token never stored). */
export async function connectMeetCalendarForUser(opts: {
  userId: string;
  refreshToken: string;
  email: string;
  scopes: string;
}): Promise<typeof recallCalendarConnectionsTable.$inferSelect> {
  const existing = await db
    .select()
    .from(recallCalendarConnectionsTable)
    .where(eq(recallCalendarConnectionsTable.userId, opts.userId))
    .limit(1);
  const row = existing[0];

  let recall: RecallCalendarRecord;
  if (row?.recallCalendarId && row.status !== "disconnected") {
    try {
      recall = await updateRecallCalendarRefreshToken(
        row.recallCalendarId,
        opts.refreshToken,
        opts.email,
      );
    } catch {
      recall = await createRecallCalendar({
        refreshToken: opts.refreshToken,
        email: opts.email,
        userId: opts.userId,
      });
    }
  } else {
    recall = await createRecallCalendar({
      refreshToken: opts.refreshToken,
      email: opts.email,
      userId: opts.userId,
    });
  }

  if (row) {
    if (row.recallCalendarId !== recall.id) {
      try {
        await deleteRecallCalendarRemote(row.recallCalendarId);
      } catch {
        /* ignore */
      }
      await db
        .delete(recallCalendarEventBotsTable)
        .where(eq(recallCalendarEventBotsTable.userId, opts.userId));
    }
    const [updated] = await db
      .update(recallCalendarConnectionsTable)
      .set({
        email: opts.email,
        platformEmail: recall.platformEmail,
        recallCalendarId: recall.id,
        status: recall.status || "connected",
        oauthScopes: opts.scopes,
      })
      .where(eq(recallCalendarConnectionsTable.id, row.id))
      .returning();
    return updated!;
  }

  const [inserted] = await db
    .insert(recallCalendarConnectionsTable)
    .values({
      userId: opts.userId,
      email: opts.email,
      platformEmail: recall.platformEmail,
      recallCalendarId: recall.id,
      status: recall.status || "connecting",
      oauthScopes: opts.scopes,
    })
    .returning();
  return inserted!;
}

export async function getConnectionForUser(userId: string) {
  const [row] = await db
    .select()
    .from(recallCalendarConnectionsTable)
    .where(eq(recallCalendarConnectionsTable.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function getConnectionByRecallCalendarId(recallCalendarId: string) {
  const [row] = await db
    .select()
    .from(recallCalendarConnectionsTable)
    .where(eq(recallCalendarConnectionsTable.recallCalendarId, recallCalendarId))
    .limit(1);
  return row ?? null;
}

export async function disconnectMeetCalendar(userId: string): Promise<void> {
  const row = await getConnectionForUser(userId);
  if (!row) return;
  try {
    await deleteRecallCalendarRemote(row.recallCalendarId);
  } catch (err) {
    logger.warn({ err, recallCalendarId: row.recallCalendarId }, "Recall calendar delete failed");
  }
  await db
    .delete(recallCalendarEventBotsTable)
    .where(eq(recallCalendarEventBotsTable.userId, userId));
  await db
    .delete(recallCalendarConnectionsTable)
    .where(eq(recallCalendarConnectionsTable.id, row.id));
}

async function prepareBotConfigForEvent(opts: {
  userId: string;
  agentId: number;
  meetingUrl: string;
  /** Event start — the token must outlive the meeting, not the opt-in click. */
  startsAt?: Date | null;
}): Promise<{ botConfig: Record<string, unknown>; runtimeAgentId: number; botName: string }> {
  const [agent] = await db
    .select({
      userId: agentsTable.userId,
      name: agentsTable.name,
      agentConfig: agentsTable.agentConfig,
    })
    .from(agentsTable)
    .where(eq(agentsTable.id, opts.agentId))
    .limit(1);
  if (!agent || agent.userId !== opts.userId) {
    throw new Error("Agent not found");
  }
  const meetings = parseMeetingsConfig(agent.agentConfig);
  const runtimeAgentId = opts.agentId; // calendar opt-in: honor selected agent
  const botName = resolveMeetBotDisplayName(meetings, agent.name || "Voice Agent");
  const mid = cryptoRandomId();
  const token = signMeetBotToken({
    agentId: runtimeAgentId,
    userId: opts.userId,
    exp: meetBotTokenExp(opts.startsAt),
    mid,
    meetUrl: opts.meetingUrl,
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
  const botConfig = buildRecallBotConfig({
    meetingUrl: opts.meetingUrl,
    botName,
    pageUrl,
    ownerUserId: opts.userId,
    agentId: runtimeAgentId,
    eventsUrl: `${base}/api/meet-bots/recall-events?mb=${encodeURIComponent(token)}`,
    eventsList: recallRealtimeEvents(),
    ...(screensharePageUrl ? { screensharePageUrl } : {}),
    forCalendarEvent: true,
  });
  // Stash mid on metadata so we can bind roster when bot id returns
  const meta = (botConfig["metadata"] as Record<string, string>) ?? {};
  meta["meetMid"] = mid;
  botConfig["metadata"] = meta;
  return { botConfig, runtimeAgentId, botName };
}

function cryptoRandomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function scheduleBotForCalendarEvent(opts: {
  userId: string;
  agentId: number;
  eventId: string;
  meetingUrl: string;
  startsAt?: Date | null;
  eventTitle?: string | null;
  recallCalendarId: string;
}): Promise<{ botId: string | null; agentId: number }> {
  if (!MEET_URL_RE.test(opts.meetingUrl)) {
    throw new Error("Event has no supported Meet / Zoom / Teams link");
  }
  if (!process.env["RECALL_API_KEY"]) {
    throw new Error("Meeting bots are not configured (missing Recall API key)");
  }
  // Prefer first-enabled owner: if another SnapServe user already enabled this event, block.
  const others = await db
    .select()
    .from(recallCalendarEventBotsTable)
    .where(
      and(
        eq(recallCalendarEventBotsTable.recallEventId, opts.eventId),
        eq(recallCalendarEventBotsTable.enabled, true),
      ),
    )
    .limit(5);
  const otherOwner = others.find((r) => r.userId !== opts.userId);
  if (otherOwner) {
    throw new Error("Another SnapServe workspace already scheduled a bot for this event");
  }

  const { botConfig, runtimeAgentId } = await prepareBotConfigForEvent({
    userId: opts.userId,
    agentId: opts.agentId,
    meetingUrl: opts.meetingUrl,
    startsAt: opts.startsAt ?? null,
  });
  const dedupeKey = `snapserve:${opts.userId}:${opts.eventId}`;
  const res = await recallFetchV2(
    `/calendar-events/${encodeURIComponent(opts.eventId)}/bot/`,
    {
      method: "POST",
      body: JSON.stringify({
        deduplication_key: dedupeKey,
        bot_config: botConfig,
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Schedule bot for event failed (${res.status}): ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    bots?: Array<{ bot_id?: string; id?: string }>;
    bot_id?: string;
  };
  const botId =
    data.bot_id
    ?? data.bots?.[0]?.bot_id
    ?? data.bots?.[0]?.id
    ?? null;

  const mid = (botConfig["metadata"] as { meetMid?: string } | undefined)?.meetMid;
  if (botId && mid) bindMeetRosterBot(mid, botId);

  const existing = await db
    .select()
    .from(recallCalendarEventBotsTable)
    .where(
      and(
        eq(recallCalendarEventBotsTable.userId, opts.userId),
        eq(recallCalendarEventBotsTable.recallEventId, opts.eventId),
      ),
    )
    .limit(1);
  if (existing[0]) {
    await db
      .update(recallCalendarEventBotsTable)
      .set({
        enabled: true,
        agentId: runtimeAgentId,
        recallBotId: botId,
        meetingUrl: opts.meetingUrl,
        startsAt: opts.startsAt ?? null,
        eventTitle: opts.eventTitle ?? null,
        recallCalendarId: opts.recallCalendarId,
      })
      .where(eq(recallCalendarEventBotsTable.id, existing[0].id));
  } else {
    await db.insert(recallCalendarEventBotsTable).values({
      userId: opts.userId,
      recallCalendarId: opts.recallCalendarId,
      recallEventId: opts.eventId,
      recallBotId: botId,
      agentId: runtimeAgentId,
      enabled: true,
      meetingUrl: opts.meetingUrl,
      startsAt: opts.startsAt ?? null,
      eventTitle: opts.eventTitle ?? null,
    });
  }
  logger.info(
    { userId: opts.userId, eventId: opts.eventId, botId, agentId: runtimeAgentId },
    "Scheduled calendar event bot",
  );
  return { botId, agentId: runtimeAgentId };
}

export async function removeBotFromCalendarEvent(opts: {
  userId: string;
  eventId: string;
}): Promise<void> {
  const res = await recallFetchV2(
    `/calendar-events/${encodeURIComponent(opts.eventId)}/bot/`,
    { method: "DELETE" },
  );
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`Remove bot from event failed (${res.status}): ${text.slice(0, 200)}`);
  }
  await db
    .delete(recallCalendarEventBotsTable)
    .where(
      and(
        eq(recallCalendarEventBotsTable.userId, opts.userId),
        eq(recallCalendarEventBotsTable.recallEventId, opts.eventId),
      ),
    );
}

export async function listEnabledEventBots(userId: string) {
  return db
    .select()
    .from(recallCalendarEventBotsTable)
    .where(
      and(
        eq(recallCalendarEventBotsTable.userId, userId),
        eq(recallCalendarEventBotsTable.enabled, true),
      ),
    );
}

/** Re-schedule bots for events that changed (webhook sync). */
export async function resyncEnabledBotsForCalendar(
  recallCalendarId: string,
  updatedAtGte?: string,
): Promise<void> {
  const conn = await getConnectionByRecallCalendarId(recallCalendarId);
  if (!conn) return;

  const events = await listRecallCalendarEvents(recallCalendarId, {
    updatedAtGte,
  });
  const byId = new Map(events.map((e) => [e.id, e]));

  const enabled = await db
    .select()
    .from(recallCalendarEventBotsTable)
    .where(
      and(
        eq(recallCalendarEventBotsTable.recallCalendarId, recallCalendarId),
        eq(recallCalendarEventBotsTable.enabled, true),
      ),
    );

  for (const row of enabled) {
    const ev = byId.get(row.recallEventId) ?? (await getRecallCalendarEvent(row.recallEventId));
    if (!ev || ev.isDeleted) {
      await db
        .delete(recallCalendarEventBotsTable)
        .where(eq(recallCalendarEventBotsTable.id, row.id));
      continue;
    }
    if (!ev.meetingUrl || !row.agentId) continue;
    try {
      await scheduleBotForCalendarEvent({
        userId: row.userId,
        agentId: row.agentId,
        eventId: row.recallEventId,
        meetingUrl: ev.meetingUrl,
        startsAt: ev.startTime ? new Date(ev.startTime) : null,
        eventTitle: ev.title,
        recallCalendarId,
      });
    } catch (err) {
      logger.warn(
        { err, eventId: row.recallEventId, userId: row.userId },
        "Failed to resync calendar event bot",
      );
    }
  }
}

export async function syncCalendarStatusFromRecall(recallCalendarId: string): Promise<void> {
  const conn = await getConnectionByRecallCalendarId(recallCalendarId);
  if (!conn) return;
  try {
    const remote = await retrieveRecallCalendar(recallCalendarId);
    await db
      .update(recallCalendarConnectionsTable)
      .set({
        status: remote.status,
        platformEmail: remote.platformEmail ?? conn.platformEmail,
      })
      .where(eq(recallCalendarConnectionsTable.id, conn.id));
  } catch (err) {
    logger.warn({ err, recallCalendarId }, "Failed to sync calendar status");
  }
}

/**
 * Verify Svix webhook signature when RECALL_CALENDAR_WEBHOOK_SECRET is set.
 * Secret format: whsec_<base64>
 */
export function verifySvixWebhook(
  rawBody: string,
  headers: { id?: string; timestamp?: string; signature?: string },
): boolean {
  const secret = (process.env["RECALL_CALENDAR_WEBHOOK_SECRET"] ?? "").trim();
  if (!secret) return true; // allow in dev when unset
  const id = headers.id;
  const ts = headers.timestamp;
  const sigHeader = headers.signature;
  if (!id || !ts || !sigHeader) return false;
  // Reject stale timestamps (>5 min)
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) return false;

  let key = secret;
  if (key.startsWith("whsec_")) key = key.slice(6);
  const secretBytes = Buffer.from(key, "base64");
  const signed = `${id}.${ts}.${rawBody}`;
  const expected = createHmac("sha256", secretBytes).update(signed).digest("base64");
  const versions = sigHeader.split(" ");
  for (const part of versions) {
    const [ver, sig] = part.split(",");
    if (ver !== "v1" || !sig) continue;
    try {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    } catch {
      /* continue */
    }
  }
  return false;
}

export function isSupportedMeetingUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && MEET_URL_RE.test(url);
}

export { detectMeetingPlatform };
