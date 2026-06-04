/**
 * Google Calendar + Meet — SaaS multi-tenant OAuth
 *
 * Architecture:
 *  - ONE platform-level Google OAuth app (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET env vars)
 *  - End-users click "Connect with Google" — no developer setup needed
 *  - Each connected Google account is stored in `google_calendar_connections`
 *  - Multiple Google accounts per user are supported
 *  - Scheduling calendars can be mapped to a specific connection via google_calendar_connection_id
 */

import { google, type calendar_v3 } from "googleapis";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { encryptKey, decryptKey } from "../../lib/crypto.js";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
];

// ── Calendar sync result + error classification ──────────────────────────────

/** Structured description of a Google Calendar API failure. */
export type GcalErrorInfo = {
  /** HTTP status code from Google (e.g. 401, 403), when available. */
  code: number | null;
  /** Google API reason / OAuth error string (e.g. "insufficientPermissions", "invalid_grant"). */
  reason: string;
  /** Human-readable message. */
  message: string;
  /** True when the failure means the user must disconnect & reconnect (scope/revoked). */
  needsReconnect: boolean;
};

/** Discriminated result of a create/update calendar event call. */
export type CalendarEventResult =
  | { ok: true; meetLink: string | null; eventId: string }
  | { ok: false; error: GcalErrorInfo };

/**
 * Classify an error thrown by googleapis (or token refresh) into a structured
 * shape, deciding whether the underlying Google connection needs the user to
 * reconnect (insufficient scope / revoked / expired refresh token).
 */
export function classifyGcalError(err: unknown): GcalErrorInfo {
  const anyErr = err as {
    code?: number | string;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
    response?: { status?: number; data?: { error?: unknown; error_description?: string } };
  };

  const rawCode = anyErr?.code ?? anyErr?.response?.status ?? null;
  const code = typeof rawCode === "number" ? rawCode : (typeof rawCode === "string" && /^\d+$/.test(rawCode) ? Number(rawCode) : null);

  const dataError = anyErr?.response?.data?.error;
  const reason =
    anyErr?.errors?.[0]?.reason ??
    (typeof dataError === "string" ? dataError : undefined) ??
    (typeof rawCode === "string" && !/^\d+$/.test(rawCode) ? rawCode : undefined) ??
    "unknown";

  const message =
    anyErr?.errors?.[0]?.message ??
    anyErr?.response?.data?.error_description ??
    anyErr?.message ??
    String(err);

  const reasonStr = String(reason).toLowerCase();
  const messageStr = String(message).toLowerCase();

  const needsReconnect =
    code === 401 ||
    reasonStr.includes("invalid_grant") ||
    messageStr.includes("invalid_grant") ||
    reasonStr.includes("insufficient") ||
    messageStr.includes("insufficient") ||
    messageStr.includes("scope") ||
    (code === 403 && (reasonStr.includes("permission") || messageStr.includes("permission")));

  return { code, reason: String(reason), message: String(message), needsReconnect };
}

/** Flag a connection as needing reconnection so the dashboard can prompt the user. */
async function markConnectionReconnect(connectionId: string, reason: string): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE google_calendar_connections
      SET needs_reconnect = true, reconnect_reason = ${reason.slice(0, 500)}, updated_at = NOW()
      WHERE id = ${connectionId}
    `);
  } catch (err) {
    logger.warn({ err, connectionId }, "Failed to mark Google connection needs_reconnect");
  }
}

/** Clear the needs-reconnect flag after a successful API call. */
async function clearConnectionReconnect(connectionId: string): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE google_calendar_connections
      SET needs_reconnect = false, reconnect_reason = NULL, updated_at = NOW()
      WHERE id = ${connectionId} AND needs_reconnect = true
    `);
  } catch { /* best effort */ }
}

// ── Platform-level OAuth client ──────────────────────────────────────────────

function callbackUrl(): string {
  // Prefer an explicitly-set redirect URI (works for both dev and production).
  // Set GOOGLE_REDIRECT_URI = https://<your-domain>/api/scheduling/google/callback
  if (process.env["GOOGLE_REDIRECT_URI"]) {
    return process.env["GOOGLE_REDIRECT_URI"];
  }
  // Auto-detect from REPLIT_DOMAINS (works in dev; may differ in production)
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  return domain
    ? `https://${domain}/api/scheduling/google/callback`
    : "http://localhost:80/api/scheduling/google/callback";
}

/**
 * Build an OAuth2 client. When `redirectUri` is supplied (derived from the
 * current request's externally-visible host) it takes precedence over the
 * static env-var / REPLIT_DOMAINS fallbacks so the same URI is used on both
 * legs of the flow (Google requires an exact match).
 */
export function makePlatformOAuth2Client(redirectUri?: string) {
  const clientId     = process.env["GOOGLE_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in environment");
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri ?? callbackUrl());
}

// ── Auth URL generation ──────────────────────────────────────────────────────

/**
 * Generate the Google OAuth consent screen URL.
 * `state` is a JSON object `{ clerkId, returnTo? }` so the callback can map
 * the account AND redirect back to whichever page initiated the flow.
 */
export function getAuthUrl(
  clerkId: string,
  returnTo?: string,
  returnOrigin?: string,
  redirectUri?: string,
): string {
  const client = makePlatformOAuth2Client(redirectUri);
  const state = JSON.stringify({
    clerkId,
    returnTo: returnTo ?? "conferencing",
    // Pass the caller's origin so the callback can redirect back to the right domain
    // (dev preview vs production). Validated in the callback before use.
    ...(returnOrigin ? { returnOrigin } : {}),
  });
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",   // force refresh_token on every connect
    state,
  });
}

// ── Code exchange ────────────────────────────────────────────────────────────

export async function exchangeCode(code: string, redirectUri?: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiry: Date;
  email: string;
}> {
  const client = makePlatformOAuth2Client(redirectUri);
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) {
    throw new Error("Missing access_token from Google OAuth response");
  }

  // Fetch email via direct Bearer fetch (most reliable)
  const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userInfoRes.ok) throw new Error(`Google userinfo error: ${userInfoRes.status}`);
  const userInfo = await userInfoRes.json() as { email?: string };
  if (!userInfo.email) throw new Error("No email returned from Google");

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? "",
    expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600_000),
    email: userInfo.email,
  };
}

// ── Connection CRUD ──────────────────────────────────────────────────────────

export type GoogleConnection = {
  id: string;
  userId: string;
  email: string;
  tokenExpiry: Date | null;
  createdAt: Date;
  needsReconnect: boolean;
  reconnectReason: string | null;
};

export async function listConnectionsForUser(userId: string): Promise<GoogleConnection[]> {
  const rows = await db.execute(
    sql`SELECT id, user_id, email, token_expiry, created_at, needs_reconnect, reconnect_reason
        FROM google_calendar_connections
        WHERE user_id = ${userId}
        ORDER BY created_at ASC`,
  );
  return (rows.rows as any[]).map(r => ({
    id: r.id,
    userId: r.user_id,
    email: r.email,
    tokenExpiry: r.token_expiry ? new Date(r.token_expiry) : null,
    createdAt: new Date(r.created_at),
    needsReconnect: r.needs_reconnect === true,
    reconnectReason: r.reconnect_reason ?? null,
  }));
}

export async function upsertConnection(
  userId: string,
  email: string,
  accessToken: string,
  refreshToken: string,
  expiry: Date,
): Promise<string> {
  const encAccess  = encryptKey(accessToken);
  const encRefresh = refreshToken ? encryptKey(refreshToken) : "";
  const rows = await db.execute(sql`
    INSERT INTO google_calendar_connections (user_id, email, access_token, refresh_token, token_expiry)
    VALUES (${userId}, ${email}, ${encAccess}, ${encRefresh}, ${expiry})
    ON CONFLICT (user_id, email) DO UPDATE
      SET access_token  = EXCLUDED.access_token,
          refresh_token = CASE WHEN EXCLUDED.refresh_token != '' THEN EXCLUDED.refresh_token ELSE google_calendar_connections.refresh_token END,
          token_expiry  = EXCLUDED.token_expiry,
          needs_reconnect = false,
          reconnect_reason = NULL,
          updated_at    = NOW()
    RETURNING id
  `);
  return (rows.rows[0] as any).id as string;
}

/** Returns a valid access token for the connection, auto-refreshing if needed. */
export async function getValidAccessToken(connectionId: string): Promise<{
  accessToken: string;
  email: string;
} | null> {
  const rows = await db.execute(
    sql`SELECT id, user_id, email, access_token, refresh_token, token_expiry
        FROM google_calendar_connections WHERE id = ${connectionId}`,
  );
  const row = rows.rows[0] as any;
  if (!row) return null;

  const accessToken  = decryptKey(row.access_token);
  const refreshToken = row.refresh_token ? decryptKey(row.refresh_token) : "";

  const now    = Date.now();
  const expiry = row.token_expiry ? new Date(row.token_expiry).getTime() : 0;

  // Refresh if less than 5 minutes remaining
  if (expiry - now < 5 * 60 * 1000 && refreshToken) {
    try {
      const client = makePlatformOAuth2Client();
      client.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await client.refreshAccessToken();
      if (credentials.access_token) {
        const encNew = encryptKey(credentials.access_token);
        await db.execute(sql`
          UPDATE google_calendar_connections
          SET access_token = ${encNew},
              token_expiry = ${credentials.expiry_date ? new Date(credentials.expiry_date) : null},
              updated_at   = NOW()
          WHERE id = ${connectionId}
        `);
        return { accessToken: credentials.access_token, email: row.email };
      }
    } catch (err) {
      const info = classifyGcalError(err);
      logger.error(
        { connectionId, code: info.code, reason: info.reason, message: info.message },
        "Failed to refresh Google token",
      );
      if (info.needsReconnect) {
        await markConnectionReconnect(connectionId, `token refresh failed: ${info.reason}`);
        // Stale/expired access token is unusable — signal "no token" to callers.
        return null;
      }
    }
  }

  return { accessToken, email: row.email };
}

export async function revokeConnection(connectionId: string): Promise<void> {
  const rows = await db.execute(
    sql`SELECT access_token FROM google_calendar_connections WHERE id = ${connectionId}`,
  );
  const row = rows.rows[0] as any;
  if (row?.access_token) {
    try {
      const client = makePlatformOAuth2Client();
      await client.revokeToken(decryptKey(row.access_token));
    } catch { /* best effort */ }
  }
  await db.execute(sql`DELETE FROM google_calendar_connections WHERE id = ${connectionId}`);
}

// ── Calendar listing ─────────────────────────────────────────────────────────

/**
 * List the sub-calendars (Personal, Work, etc.) visible to this Google account.
 * Returns null on failure (token / API error).
 */
export async function listConnectionCalendars(connectionId: string): Promise<Array<{
  googleCalendarId: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  backgroundColor: string | null;
}> | null> {
  const tokens = await getValidAccessToken(connectionId);
  if (!tokens) return null;
  const client = makePlatformOAuth2Client();
  client.setCredentials({ access_token: tokens.accessToken });
  const calendar = google.calendar({ version: "v3", auth: client });
  try {
    const res = await calendar.calendarList.list({ minAccessRole: "writer", showHidden: false });
    return (res.data.items ?? []).map(c => ({
      googleCalendarId: c.id ?? "",
      summary: c.summaryOverride ?? c.summary ?? "(Untitled)",
      primary: Boolean(c.primary),
      accessRole: c.accessRole ?? "reader",
      backgroundColor: c.backgroundColor ?? null,
    })).filter(c => c.googleCalendarId);
  } catch (err) {
    logger.warn({ err, connectionId }, "Failed to list Google calendars");
    return null;
  }
}

// ── Calendar event creation ──────────────────────────────────────────────────

/**
 * Create a Google Calendar event with a Meet link on the specified connection.
 * Returns null if the connection is missing or the API call fails.
 */
const _EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Split a raw string on commas, semicolons, or whitespace and return trimmed non-empty parts. */
function _splitRawEmails(raw: string): string[] {
  return raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
}

/**
 * Collect, dedupe and normalize host attendee emails (primary + additional),
 * excluding the attendee's own email to avoid duplicate attendees.
 * Each entry is split on commas/semicolons/whitespace so that legacy combined
 * strings (e.g. "a@example.com, b@example.com") are handled correctly.
 * Individual addresses that fail basic email validation are silently dropped so
 * that one malformed address cannot prevent the whole event from being created.
 */
function hostAttendeeEmails(
  hostEmail: string | null | undefined,
  additionalHosts: string[] | null | undefined,
  attendeeEmail?: string,
): string[] {
  const rawEntries: string[] = [];
  if (hostEmail) rawEntries.push(hostEmail);
  if (additionalHosts) rawEntries.push(...additionalHosts);
  const seen = new Set<string>();
  if (attendeeEmail) seen.add(attendeeEmail.trim().toLowerCase());
  const out: string[] = [];
  for (const entry of rawEntries) {
    for (const e of _splitRawEmails(entry)) {
      if (!_EMAIL_RE.test(e)) continue;
      const key = e.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
  }
  return out;
}

export async function createCalendarEvent(params: {
  connectionId: string;
  summary: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  attendeeEmail: string;
  attendeeName: string;
  timezone: string;
  hostEmail?: string | null;
  additionalHosts?: string[] | null;
  addMeet?: boolean;
  location?: { type: "google_meet" | "in_person"; address?: string | null } | null;
}): Promise<CalendarEventResult> {
  const tokens = await getValidAccessToken(params.connectionId);
  if (!tokens) {
    return {
      ok: false,
      error: {
        code: null,
        reason: "no_valid_token",
        message: "No valid Google access token for this connection (token missing, expired, or revoked).",
        needsReconnect: true,
      },
    };
  }

  const client = makePlatformOAuth2Client();
  client.setCredentials({ access_token: tokens.accessToken });

  const calendar = google.calendar({ version: "v3", auth: client });

  const attendees: { email: string; displayName?: string }[] = [
    { email: params.attendeeEmail, displayName: params.attendeeName },
  ];
  for (const email of hostAttendeeEmails(params.hostEmail, params.additionalHosts, params.attendeeEmail)) {
    attendees.push({ email });
  }

  const isInPerson = params.location?.type === "in_person";
  // Generate a Meet link only for non-in-person events when the host has enabled Google Meet.
  const addMeet = !isInPerson && (params.addMeet ?? false);

  try {
    const requestBody: calendar_v3.Schema$Event = {
      summary: params.summary,
      description: params.description,
      start: { dateTime: params.startTime.toISOString(), timeZone: params.timezone },
      end:   { dateTime: params.endTime.toISOString(),   timeZone: params.timezone },
      attendees,
      reminders: { useDefault: true },
    };
    if (isInPerson) {
      if (params.location?.address) requestBody.location = params.location.address;
    } else if (addMeet) {
      requestBody.conferenceData = {
        createRequest: {
          requestId: `voiceorch-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      };
    }

    const event = await calendar.events.insert({
      calendarId: "primary",
      conferenceDataVersion: addMeet ? 1 : 0,
      requestBody,
    });

    const meetLink = event.data.conferenceData?.entryPoints?.find(e => e.entryPointType === "video")?.uri ?? null;
    const eventId  = event.data.id ?? "";
    logger.info({ connectionId: params.connectionId, eventId, meetLink }, "Google Calendar event created");
    void clearConnectionReconnect(params.connectionId);
    return { ok: true, meetLink, eventId };
  } catch (err) {
    const info = classifyGcalError(err);
    logger.error(
      { connectionId: params.connectionId, code: info.code, reason: info.reason, message: info.message, needsReconnect: info.needsReconnect },
      "Failed to create Google Calendar event",
    );
    if (info.needsReconnect) {
      await markConnectionReconnect(params.connectionId, `events.insert failed: ${info.reason}`);
    }
    return { ok: false, error: info };
  }
}

export async function deleteCalendarEvent(connectionId: string, eventId: string): Promise<void> {
  const tokens = await getValidAccessToken(connectionId);
  if (!tokens) return;
  const client = makePlatformOAuth2Client();
  client.setCredentials({ access_token: tokens.accessToken });
  const calendar = google.calendar({ version: "v3", auth: client });
  try {
    await calendar.events.delete({ calendarId: "primary", eventId });
    logger.info({ connectionId, eventId }, "Google Calendar event deleted");
    void clearConnectionReconnect(connectionId);
  } catch (err) {
    const info = classifyGcalError(err);
    // 410 Gone / 404 = event already deleted — not a real failure, don't alarm.
    if (info.code === 404 || info.code === 410) {
      logger.info({ connectionId, eventId, code: info.code }, "Google Calendar event already gone");
      return;
    }
    logger.error(
      { connectionId, eventId, code: info.code, reason: info.reason, message: info.message, needsReconnect: info.needsReconnect },
      "Failed to delete Google Calendar event",
    );
    if (info.needsReconnect) {
      await markConnectionReconnect(connectionId, `events.delete failed: ${info.reason}`);
    }
  }
}

/**
 * Update an existing Google Calendar event in-place (patch).
 * Returns null if the connection is missing or the API call fails.
 */
export async function updateCalendarEvent(params: {
  connectionId: string;
  eventId: string;
  summary?: string;
  description?: string;
  startTime?: Date;
  endTime?: Date;
  attendeeEmail?: string;
  attendeeName?: string;
  timezone?: string;
  hostEmail?: string | null;
  additionalHosts?: string[] | null;
}): Promise<CalendarEventResult> {
  const tokens = await getValidAccessToken(params.connectionId);
  if (!tokens) {
    return {
      ok: false,
      error: {
        code: null,
        reason: "no_valid_token",
        message: "No valid Google access token for this connection (token missing, expired, or revoked).",
        needsReconnect: true,
      },
    };
  }

  const client = makePlatformOAuth2Client();
  client.setCredentials({ access_token: tokens.accessToken });
  const calendar = google.calendar({ version: "v3", auth: client });

  const requestBody: Record<string, unknown> = {};
  if (params.summary !== undefined) requestBody["summary"] = params.summary;
  if (params.description !== undefined) requestBody["description"] = params.description;
  if (params.startTime !== undefined && params.timezone !== undefined) {
    requestBody["start"] = { dateTime: params.startTime.toISOString(), timeZone: params.timezone };
  }
  if (params.endTime !== undefined && params.timezone !== undefined) {
    requestBody["end"] = { dateTime: params.endTime.toISOString(), timeZone: params.timezone };
  }
  if (params.attendeeEmail !== undefined) {
    const attendees: { email: string; displayName?: string }[] = [
      { email: params.attendeeEmail, displayName: params.attendeeName },
    ];
    for (const email of hostAttendeeEmails(params.hostEmail, params.additionalHosts, params.attendeeEmail)) {
      attendees.push({ email });
    }
    requestBody["attendees"] = attendees;
  }

  try {
    const event = await calendar.events.patch({
      calendarId: "primary",
      eventId: params.eventId,
      requestBody,
    });
    const meetLink = event.data.conferenceData?.entryPoints?.find(e => e.entryPointType === "video")?.uri ?? null;
    const eventId  = event.data.id ?? params.eventId;
    logger.info({ connectionId: params.connectionId, eventId, meetLink }, "Google Calendar event updated");
    void clearConnectionReconnect(params.connectionId);
    return { ok: true, meetLink, eventId };
  } catch (err) {
    const info = classifyGcalError(err);
    logger.error(
      { connectionId: params.connectionId, eventId: params.eventId, code: info.code, reason: info.reason, message: info.message, needsReconnect: info.needsReconnect },
      "Failed to update Google Calendar event",
    );
    if (info.needsReconnect) {
      await markConnectionReconnect(params.connectionId, `events.patch failed: ${info.reason}`);
    }
    return { ok: false, error: info };
  }
}

// ── Free/Busy query ──────────────────────────────────────────────────────────

export interface BusyPeriod {
  start: Date;
  end: Date;
}

/**
 * Fetch busy time periods from the Google Calendar free/busy API for a given
 * connection. Returns an array of `{ start, end }` windows during which the
 * calendar is occupied. Gracefully returns an empty array on any API failure
 * so availability degrades to schedule-only rather than crashing.
 *
 * @param connectionId  - The `google_calendar_connections.id` to use.
 * @param startTime     - Range start (UTC).
 * @param endTime       - Range end (UTC).
 * @param googleCalendarId - Specific sub-calendar ID to query (defaults to "primary").
 */
export async function fetchGcalBusyPeriods(
  connectionId: string,
  startTime: Date,
  endTime: Date,
  googleCalendarId = "primary",
): Promise<BusyPeriod[]> {
  const tokens = await getValidAccessToken(connectionId);
  if (!tokens) {
    logger.warn({ connectionId }, "fetchGcalBusyPeriods: no valid token, returning empty");
    return [];
  }

  const client = makePlatformOAuth2Client();
  client.setCredentials({ access_token: tokens.accessToken });
  const calendar = google.calendar({ version: "v3", auth: client });

  try {
    const res = await calendar.freebusy.query({
      requestBody: {
        timeMin: startTime.toISOString(),
        timeMax: endTime.toISOString(),
        items: [{ id: googleCalendarId }],
      },
    });

    const busy = res.data.calendars?.[googleCalendarId]?.busy ?? [];
    return busy
      .filter((p) => p.start && p.end)
      .map((p) => ({ start: new Date(p.start!), end: new Date(p.end!) }));
  } catch (err) {
    const info = classifyGcalError(err);
    logger.warn(
      { connectionId, calendarId: googleCalendarId, code: info.code, reason: info.reason, message: info.message },
      "fetchGcalBusyPeriods: freebusy query failed, returning empty",
    );
    return [];
  }
}

// ── Legacy helpers (keep for backward compat during migration) ──────────────

/** Returns the first connection for a user, or null. Used as fallback. */
export async function getFirstConnectionForUser(userId: string): Promise<{ id: string; email: string } | null> {
  const rows = await db.execute(
    sql`SELECT id, email FROM google_calendar_connections WHERE user_id = ${userId} ORDER BY created_at ASC LIMIT 1`,
  );
  const row = rows.rows[0] as any;
  return row ? { id: row.id, email: row.email } : null;
}
