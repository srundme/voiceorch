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

import { google } from "googleapis";
import { db, googleCalendarConnectionsTable } from "@workspace/db";
import { eq, asc, sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { logger } from "../../lib/logger.js";
import { encryptKey, decryptKey } from "../../lib/crypto.js";
import { getSelfBaseUrl } from "../../lib/app-domain.js";

const SCOPES = [
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
  // Auto-detect from APP_DOMAIN (set in .env for local dev, in Railway for production)
  return `${getSelfBaseUrl()}/api/scheduling/google/callback`;
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
  connectionId?: string,
): string {
  const client = makePlatformOAuth2Client(redirectUri);
  const state = JSON.stringify({
    clerkId,
    returnTo: returnTo ?? "conferencing",
    // Pass the caller's origin so the callback can redirect back to the right domain
    // (dev preview vs production). Validated in the callback before use.
    ...(returnOrigin ? { returnOrigin } : {}),
    // When re-authorizing an existing connection, pass its ID so the callback
    // updates the row in-place instead of inserting a duplicate.
    ...(connectionId ? { connectionId } : {}),
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
  const rows = await db
    .select({
      id: googleCalendarConnectionsTable.id,
      userId: googleCalendarConnectionsTable.userId,
      email: googleCalendarConnectionsTable.email,
      tokenExpiry: googleCalendarConnectionsTable.tokenExpiry,
      createdAt: googleCalendarConnectionsTable.createdAt,
    })
    .from(googleCalendarConnectionsTable)
    .where(eq(googleCalendarConnectionsTable.userId, userId))
    .orderBy(asc(googleCalendarConnectionsTable.createdAt));
  return rows.map(r => ({
    id: r.id,
    userId: r.userId,
    email: r.email,
    tokenExpiry: r.tokenExpiry,
    createdAt: r.createdAt,
  }));
}

export async function upsertConnection(
  userId: string,
  email: string,
  accessToken: string,
  refreshToken: string,
  expiry: Date,
  existingId?: string,
): Promise<string> {
  const encAccess  = encryptKey(accessToken);
  const encRefresh = refreshToken ? encryptKey(refreshToken) : "";

  // If a specific connection ID is provided (re-auth flow), update it in place
  // to avoid duplicate rows when the user reconnects the same Google account.
  // Scope the UPDATE to both id AND userId to prevent cross-tenant row overwrite.
  if (existingId) {
    const { and } = await import("drizzle-orm");
    const result = await db
      .update(googleCalendarConnectionsTable)
      .set({
        email,
        accessToken: encAccess,
        refreshToken: encRefresh
          ? encRefresh
          : sql`google_calendar_connections.refresh_token`,
        tokenExpiry: expiry,
        updatedAt: new Date(),
      })
      .where(and(
        eq(googleCalendarConnectionsTable.id, existingId),
        eq(googleCalendarConnectionsTable.userId, userId),
      ))
      .returning({ id: googleCalendarConnectionsTable.id });
    if (result.length > 0) {
      return existingId;
    }
    // existingId not found or doesn't belong to userId — fall through to normal upsert
    logger.warn({ existingId, userId }, "upsertConnection: existingId not found or userId mismatch — falling through to normal upsert");
  }

  const rows = await db
    .insert(googleCalendarConnectionsTable)
    .values({ userId, email, accessToken: encAccess, refreshToken: encRefresh, tokenExpiry: expiry })
    .onConflictDoUpdate({
      target: [googleCalendarConnectionsTable.userId, googleCalendarConnectionsTable.email],
      set: {
        accessToken: encAccess,
        // Preserve existing refresh token when the new one is empty (Google doesn't
        // always re-issue a refresh token on repeat consent flows)
        refreshToken: sql`CASE WHEN ${encRefresh} != '' THEN ${encRefresh} ELSE google_calendar_connections.refresh_token END`,
        tokenExpiry: expiry,
        updatedAt: new Date(),
      },
    })
    .returning({ id: googleCalendarConnectionsTable.id });
  return rows[0].id;
}

/** Returns a valid access token for the connection, auto-refreshing if needed. */
export async function getValidAccessToken(connectionId: string): Promise<{
  accessToken: string;
  email: string;
} | null> {
  const rows = await db
    .select({
      id: googleCalendarConnectionsTable.id,
      email: googleCalendarConnectionsTable.email,
      accessToken: googleCalendarConnectionsTable.accessToken,
      refreshToken: googleCalendarConnectionsTable.refreshToken,
      tokenExpiry: googleCalendarConnectionsTable.tokenExpiry,
    })
    .from(googleCalendarConnectionsTable)
    .where(eq(googleCalendarConnectionsTable.id, connectionId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    logger.error({ connectionId }, "Google connection not found in DB — connectionId references a row that does not exist; check if the connection was deleted");
    return null;
  }

  const accessToken  = decryptKey(row.accessToken);
  const refreshToken = row.refreshToken ? decryptKey(row.refreshToken) : "";

  const now    = Date.now();
  const expiry = row.tokenExpiry ? row.tokenExpiry.getTime() : 0;
  const msUntilExpiry = expiry - now;

  // Log token state to help diagnose auth failures for specific connections
  logger.info(
    {
      connectionId,
      email: row.email,
      tokenExpiryMs: expiry,
      msUntilExpiry,
      hasRefreshToken: !!refreshToken,
      isExpiredOrExpiringSoon: msUntilExpiry < 5 * 60 * 1000,
    },
    "getValidAccessToken: resolved connection token state",
  );

  // Refresh if less than 5 minutes remaining
  if (msUntilExpiry < 5 * 60 * 1000 && refreshToken) {
    try {
      const client = makePlatformOAuth2Client();
      client.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await client.refreshAccessToken();
      if (credentials.access_token) {
        const encNew = encryptKey(credentials.access_token);
        await db
          .update(googleCalendarConnectionsTable)
          .set({
            accessToken: encNew,
            tokenExpiry: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
            updatedAt: new Date(),
          })
          .where(eq(googleCalendarConnectionsTable.id, connectionId));
        return { accessToken: credentials.access_token, email: row.email };
      }
      // Refresh succeeded but returned no access_token — do not return stale token
      logger.error(
        { connectionId, email: row.email },
        "Google token refresh returned no access_token — returning null to prevent stale-token 401",
      );
      return null;
    } catch (err) {
      logger.error(
        { err, errStack: (err as any)?.stack, googleApiError: (err as any)?.response?.data, connectionId },
        "Failed to refresh Google token — token may be revoked or OAuth grant expired; returning null",
      );
      return null;
    }
  }

  // Token is expired and there is no refresh token — cannot make API calls
  if (msUntilExpiry < 0 && !refreshToken) {
    logger.error(
      { connectionId, email: row.email, msUntilExpiry },
      "Google access token is expired and no refresh token is stored — returning null",
    );
    return null;
  }

  return { accessToken, email: row.email };
}

export async function revokeConnection(connectionId: string): Promise<void> {
  const rows = await db
    .select({ accessToken: googleCalendarConnectionsTable.accessToken })
    .from(googleCalendarConnectionsTable)
    .where(eq(googleCalendarConnectionsTable.id, connectionId))
    .limit(1);
  const row = rows[0];
  if (row?.accessToken) {
    try {
      const client = makePlatformOAuth2Client();
      await client.revokeToken(decryptKey(row.accessToken));
    } catch { /* best effort */ }
  }
  await db
    .delete(googleCalendarConnectionsTable)
    .where(eq(googleCalendarConnectionsTable.id, connectionId));
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
  onError?: (detail: { errorCode: string; status?: number; googleError?: string; googleErrorDescription?: string; message?: string }) => void;
}): Promise<{ meetLink: string | null; eventId: string } | null> {
  const tokens = await getValidAccessToken(params.connectionId);
  if (!tokens) {
    params.onError?.({
      errorCode: "token_expired_refresh_failed",
      message: "getValidAccessToken returned null — token is expired or refresh failed; re-authorize this Google connection",
    });
    return null;
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

  // Use local datetime strings (no Z/offset) + timeZone field — this is the correct
  // Google Calendar API format. Passing .toISOString() (UTC with Z) alongside timeZone
  // causes the API to ignore the timezone hint and can produce a 30-minute offset for
  // attendees whose calendar locale differs from IST (UTC+5:30 ≠ full-hour boundary).
  const localStart = formatInTimeZone(params.startTime, params.timezone, "yyyy-MM-dd'T'HH:mm:ss");
  const localEnd   = formatInTimeZone(params.endTime,   params.timezone, "yyyy-MM-dd'T'HH:mm:ss");

  try {
    const event = await calendar.events.insert({
      calendarId: "primary",
      conferenceDataVersion: 1,
      // sendUpdates: "all" causes Google Calendar to email invitations to every
      // attendee (and organizer). Without it Google silently skips the emails.
      sendUpdates: "all",
      requestBody: {
        summary: params.summary,
        description: params.description,
        start: { dateTime: localStart, timeZone: params.timezone },
        end:   { dateTime: localEnd,   timeZone: params.timezone },
        attendees,
        conferenceData: {
          createRequest: {
            requestId: `voiceorch-${Date.now()}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
        reminders: { useDefault: true },
      },
    });

    const statusCode = event.data.conferenceData?.createRequest?.status?.statusCode;
    const eventId  = event.data.id ?? "";
    let meetLink = event.data.conferenceData?.entryPoints?.find(e => e.entryPointType === "video")?.uri ?? null;

    // Google Calendar generates Meet links asynchronously — the initial insert
    // response often has statusCode="pending" with no entryPoints. Retry up to
    // twice (2 s apart) to give Google's async Meet link generation time to complete.
    for (let attempt = 1; attempt <= 2 && (meetLink === null || statusCode === "pending") && eventId; attempt++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      try {
        const fetched = await calendar.events.get({
          calendarId: "primary",
          eventId,
          conferenceDataVersion: 1,
        });
        const retryLink = fetched.data.conferenceData?.entryPoints?.find(e => e.entryPointType === "video")?.uri ?? null;
        if (retryLink) meetLink = retryLink;
        logger.info(
          { connectionId: params.connectionId, eventId, statusCode, meetLink, attempt },
          "Google Calendar Meet link retry fetch complete",
        );
      } catch (fetchErr) {
        logger.warn(
          { connectionId: params.connectionId, eventId, fetchErr: (fetchErr as any)?.message, attempt },
          "Meet link retry fetch failed — proceeding with initial response",
        );
      }
    }

    logger.info(
      { connectionId: params.connectionId, eventId, meetLink, statusCode,
        organizerEmail: tokens.email, attendeeEmail: params.attendeeEmail,
        localStart, localEnd, timezone: params.timezone },
      "Google Calendar event created",
    );
    return { meetLink, eventId };
  } catch (err) {
    const status: number | undefined            = (err as any)?.response?.status;
    const googleError: string | undefined      = (err as any)?.response?.data?.error;
    const googleErrorDesc: string | undefined  = (err as any)?.response?.data?.error_description;
    logger.error(
      {
        err,
        errMessage: (err as any)?.message,
        errStack: (err as any)?.stack,
        googleApiError: (err as any)?.response?.data,
        errDetails: (err as any)?.errors,
        connectionId: params.connectionId,
        attendeeEmail: params.attendeeEmail,
        summary: params.summary,
        httpStatus: status,
      },
      "Failed to create Google Calendar event",
    );
    params.onError?.({
      errorCode: "google_api_error",
      status,
      googleError,
      googleErrorDescription: googleErrorDesc,
      message: (err as any)?.message,
    });
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
    requestBody["start"] = {
      dateTime: formatInTimeZone(params.startTime, params.timezone, "yyyy-MM-dd'T'HH:mm:ss"),
      timeZone: params.timezone,
    };
  }
  if (params.endTime !== undefined && params.timezone !== undefined) {
    requestBody["end"] = {
      dateTime: formatInTimeZone(params.endTime, params.timezone, "yyyy-MM-dd'T'HH:mm:ss"),
      timeZone: params.timezone,
    };
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
      conferenceDataVersion: 1,
      sendUpdates: "all",
      requestBody,
    });
    const meetLink = event.data.conferenceData?.entryPoints?.find(e => e.entryPointType === "video")?.uri ?? null;
    const eventId  = event.data.id ?? params.eventId;
    logger.info(
      { connectionId: params.connectionId, eventId, meetLink,
        organizerEmail: tokens.email, attendeeEmail: params.attendeeEmail,
        newStart: requestBody["start"], newEnd: requestBody["end"] },
      "Google Calendar event updated (reschedule patch)",
    );
    return { meetLink, eventId };
  } catch (err) {
    logger.error(
      {
        err,
        errMessage: (err as any)?.message,
        errStack: (err as any)?.stack,
        googleApiError: (err as any)?.response?.data,
        errDetails: (err as any)?.errors,
        connectionId: params.connectionId,
        eventId: params.eventId,
      },
      "Failed to update Google Calendar event",
    );
    return null;
  }
}

// ── Legacy helpers (keep for backward compat during migration) ──────────────

/** Returns the first connection for a user, or null. Used as fallback. */
export async function getFirstConnectionForUser(userId: string): Promise<{ id: string; email: string } | null> {
  const rows = await db
    .select({
      id: googleCalendarConnectionsTable.id,
      email: googleCalendarConnectionsTable.email,
    })
    .from(googleCalendarConnectionsTable)
    .where(eq(googleCalendarConnectionsTable.userId, userId))
    .orderBy(asc(googleCalendarConnectionsTable.createdAt))
    .limit(1);
  const row = rows[0];
  return row ? { id: row.id, email: row.email } : null;
}
