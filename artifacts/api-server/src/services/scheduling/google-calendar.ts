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
};

export async function listConnectionsForUser(userId: string): Promise<GoogleConnection[]> {
  const rows = await db.execute(
    sql`SELECT id, user_id, email, token_expiry, created_at
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
      logger.warn({ err, connectionId }, "Failed to refresh Google token");
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
/**
 * Collect, dedupe and normalize host attendee emails (primary + additional),
 * excluding the attendee's own email to avoid duplicate attendees.
 */
function hostAttendeeEmails(
  hostEmail: string | null | undefined,
  additionalHosts: string[] | null | undefined,
  attendeeEmail?: string,
): string[] {
  const all: string[] = [];
  if (hostEmail) all.push(hostEmail);
  if (additionalHosts) all.push(...additionalHosts);
  const seen = new Set<string>();
  if (attendeeEmail) seen.add(attendeeEmail.trim().toLowerCase());
  const out: string[] = [];
  for (const raw of all) {
    const e = raw.trim();
    if (!e) continue;
    const key = e.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
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
}): Promise<{ meetLink: string | null; eventId: string } | null> {
  const tokens = await getValidAccessToken(params.connectionId);
  if (!tokens) return null;

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
    return { meetLink, eventId };
  } catch (err) {
    logger.warn({ err, connectionId: params.connectionId }, "Failed to create Google Calendar event");
    return null;
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
  } catch (err) {
    logger.warn({ err, connectionId, eventId }, "Failed to delete Google Calendar event");
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
}): Promise<{ meetLink: string | null; eventId: string } | null> {
  const tokens = await getValidAccessToken(params.connectionId);
  if (!tokens) return null;

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
    return { meetLink, eventId };
  } catch (err) {
    logger.warn({ err, connectionId: params.connectionId, eventId: params.eventId }, "Failed to update Google Calendar event");
    return null;
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
