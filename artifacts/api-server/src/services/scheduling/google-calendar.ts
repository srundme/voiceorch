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
import { createHmac, randomBytes } from "node:crypto";
import { logger } from "../../lib/logger.js";
import { encryptKey, decryptKey } from "../../lib/crypto.js";
import { getSelfBaseUrl } from "../../lib/app-domain.js";
import { APP_SECRET } from "../../lib/app-secret.js";

// ── OAuth state signing ──────────────────────────────────────────────────────
//
// The OAuth `state` parameter is passed through the browser (Google redirects
// it back verbatim). Without a server-side signature an attacker could forge a
// state blob naming a victim's clerkId and bind their own Google account to that
// tenant. We prevent this by HMAC-SHA256-signing the state payload with
// SESSION_SECRET. The callback verifies the signature before trusting any field.
//
// Format: base64url(payload_json) + "." + hmac_hex
// Expiry: 10 minutes — covers any realistic OAuth consent round-trip.

const STATE_HMAC_ALGO  = "sha256";
const STATE_TTL_MS     = 10 * 60 * 1000; // 10 minutes

export interface OAuthStatePayload {
  clerkId: string;
  returnTo: string;
  returnOrigin?: string;
  connectionId?: string;
  /** Unix timestamp (ms) after which this state token is no longer valid. */
  exp: number;
  /** Random nonce to prevent accidental replay within the TTL window. */
  nonce: string;
}

function stateHmac(encodedPayload: string): string {
  return createHmac(STATE_HMAC_ALGO, APP_SECRET)
    .update(encodedPayload)
    .digest("hex");
}

/**
 * Produce a tamper-proof, short-lived state token for the Google OAuth flow.
 * The token is safe to embed as the `state` query parameter sent to Google.
 */
export function signOAuthState(payload: Omit<OAuthStatePayload, "exp" | "nonce">): string {
  const full: OAuthStatePayload = {
    ...payload,
    exp: Date.now() + STATE_TTL_MS,
    nonce: randomBytes(12).toString("hex"),
  };
  const encoded = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig     = stateHmac(encoded);
  return `${encoded}.${sig}`;
}

/**
 * Verify and decode a state token produced by `signOAuthState`.
 * Returns the payload on success, or `null` when the token is missing,
 * malformed, has an invalid signature, or has expired.
 */
export function verifyOAuthState(raw: string | undefined): OAuthStatePayload | null {
  if (!raw) return null;
  const dotIdx = raw.lastIndexOf(".");
  if (dotIdx < 0) return null;

  const encoded = raw.slice(0, dotIdx);
  const sig     = raw.slice(dotIdx + 1);

  const expectedSig = stateHmac(encoded);
  // Constant-time comparison to prevent timing attacks
  if (sig.length !== expectedSig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) {
    diff |= sig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  if (diff !== 0) return null;

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthStatePayload;
  } catch {
    return null;
  }

  if (typeof payload.clerkId !== "string" || !payload.clerkId) return null;
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;

  return payload;
}

// Full calendar scope is required for conferenceDataVersion=1 (Google Meet creation).
// calendar.events alone returns 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT when creating
// events with Meet links. The full `calendar` scope is a superset — it covers events,
// Meet creation, and calendar listing.
const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
];

// Only the full calendar scope allows conferenceDataVersion=1 (Google Meet creation).
// calendar.events is insufficient — it cannot attach Meet links to events.
const FULL_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

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
 * `state` is a signed token (HMAC-SHA256) so the callback can safely map
 * the account AND redirect back to whichever page initiated the flow,
 * without trusting client-supplied data.
 */
export function getAuthUrl(
  clerkId: string,
  returnTo?: string,
  returnOrigin?: string,
  redirectUri?: string,
  connectionId?: string,
): string {
  const client = makePlatformOAuth2Client(redirectUri);
  const state = signOAuthState({
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
  grantedScopes: string;
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

  // `tokens.scope` lists the scopes actually granted (space-separated).
  // Store this so we can later detect scope-insufficient connections without
  // making a live API call.
  const grantedScopes = tokens.scope ?? "";

  logger.info(
    { email: userInfo.email, grantedScopes },
    "Google OAuth code exchanged — granted scopes captured",
  );

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? "",
    expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600_000),
    email: userInfo.email,
    grantedScopes,
  };
}

// ── Connection CRUD ──────────────────────────────────────────────────────────

export type GoogleConnection = {
  id: string;
  userId: string;
  email: string;
  tokenExpiry: Date | null;
  createdAt: Date;
  grantedScopes: string | null;
};

export async function listConnectionsForUser(userId: string): Promise<GoogleConnection[]> {
  const rows = await db
    .select({
      id: googleCalendarConnectionsTable.id,
      userId: googleCalendarConnectionsTable.userId,
      email: googleCalendarConnectionsTable.email,
      tokenExpiry: googleCalendarConnectionsTable.tokenExpiry,
      createdAt: googleCalendarConnectionsTable.createdAt,
      grantedScopes: googleCalendarConnectionsTable.grantedScopes,
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
    grantedScopes: r.grantedScopes ?? null,
  }));
}

export async function upsertConnection(
  userId: string,
  email: string,
  accessToken: string,
  refreshToken: string,
  expiry: Date,
  existingId?: string,
  grantedScopes?: string,
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
        ...(grantedScopes !== undefined ? { grantedScopes } : {}),
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
    .values({
      userId,
      email,
      accessToken: encAccess,
      refreshToken: encRefresh,
      tokenExpiry: expiry,
      ...(grantedScopes !== undefined ? { grantedScopes } : {}),
    })
    .onConflictDoUpdate({
      target: [googleCalendarConnectionsTable.userId, googleCalendarConnectionsTable.email],
      set: {
        accessToken: encAccess,
        // Preserve existing refresh token when the new one is empty (Google doesn't
        // always re-issue a refresh token on repeat consent flows)
        refreshToken: sql`CASE WHEN ${encRefresh} != '' THEN ${encRefresh} ELSE google_calendar_connections.refresh_token END`,
        tokenExpiry: expiry,
        ...(grantedScopes !== undefined ? { grantedScopes } : {}),
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

// ── Scope validation ─────────────────────────────────────────────────────────

/**
 * Check whether a connection has the full calendar scope required to create
 * Google Calendar events with Meet links (conferenceDataVersion=1).
 *
 * Only `https://www.googleapis.com/auth/calendar` is accepted.
 * `calendar.events` is insufficient for Meet creation and is treated as invalid.
 * Legacy connections with NULL granted_scopes are treated as false (scope unknown /
 * potentially narrow) so they are flagged and the user is prompted to reconnect
 * rather than risking a 403 from Google at runtime.
 *
 * Returns true only if the full calendar scope is present.
 * Returns false for all other cases (insufficient scopes, missing row, NULL/unknown).
 */
export async function hasRequiredCalendarScopes(connectionId: string): Promise<boolean> {
  const rows = await db
    .select({ grantedScopes: googleCalendarConnectionsTable.grantedScopes })
    .from(googleCalendarConnectionsTable)
    .where(eq(googleCalendarConnectionsTable.id, connectionId))
    .limit(1);
  const row = rows[0];
  if (!row) return false;
  if (!row.grantedScopes) {
    // NULL granted_scopes = legacy connection predating scope capture.
    // Treat as scope-insufficient so the user is prompted to reconnect.
    return false;
  }
  const granted = row.grantedScopes.split(/\s+/);
  return granted.includes(FULL_CALENDAR_SCOPE);
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
  /** Sub-calendar ID within the linked Google account; null/undefined uses the primary calendar */
  googleCalendarId?: string | null;
  onError?: (detail: { errorCode: string; status?: number; googleError?: string; googleErrorDescription?: string; message?: string }) => void;
}): Promise<{ meetLink: string | null; eventId: string } | null> {
  // ── Scope gate ──────────────────────────────────────────────────────────────
  // Require the full calendar scope before making any API call.
  // calendar.events is insufficient for conferenceDataVersion=1 (Meet links).
  // Legacy connections (NULL granted_scopes) also return false — prompt reconnect.
  const scopeCheck = await hasRequiredCalendarScopes(params.connectionId);
  if (!scopeCheck) {
    logger.warn(
      { connectionId: params.connectionId, attendeeEmail: params.attendeeEmail },
      "createCalendarEvent: connection lacks the full calendar scope (required for Meet links) — returning null without API call",
    );
    params.onError?.({
      errorCode: "scope_insufficient",
      message: "This Google Calendar connection was authorized with insufficient scopes. Re-authorize via Settings → Conferencing → Reconnect to grant full calendar access.",
    });
    return null;
  }

  const tokens = await getValidAccessToken(params.connectionId);
  if (!tokens) {
    params.onError?.({
      errorCode: "token_expired_refresh_failed",
      message: "getValidAccessToken returned null — token is expired or refresh failed; re-authorize this Google connection",
    });
    return null;
  }

  logger.info(
    {
      connectionId: params.connectionId,
      attendeeEmail: params.attendeeEmail,
      summary: params.summary,
      startTime: params.startTime.toISOString(),
      endTime: params.endTime.toISOString(),
      timezone: params.timezone,
      scopeCheckResult: scopeCheck,
    },
    "createCalendarEvent: initiating Google Calendar API call",
  );

  const client = makePlatformOAuth2Client();
  client.setCredentials({ access_token: tokens.accessToken });

  const calendar = google.calendar({ version: "v3", auth: client });

  const attendees: { email: string; displayName?: string }[] = [
    { email: params.attendeeEmail, displayName: params.attendeeName },
  ];
  for (const email of hostAttendeeEmails(params.hostEmail, params.additionalHosts, params.attendeeEmail)) {
    attendees.push({ email });
  }
  const meetBotEmail = (process.env["RECALL_BOT_EMAIL"] ?? "").trim().toLowerCase();
  if (
    meetBotEmail
    && !attendees.some((a) => a.email.toLowerCase() === meetBotEmail)
  ) {
    attendees.push({ email: meetBotEmail, displayName: "SnapServe meeting agent" });
  }

  // Use local datetime strings (no Z/offset) + timeZone field — this is the correct
  // Google Calendar API format. Passing .toISOString() (UTC with Z) alongside timeZone
  // causes the API to ignore the timezone hint and can produce a 30-minute offset for
  // attendees whose calendar locale differs from IST (UTC+5:30 ≠ full-hour boundary).
  const localStart = formatInTimeZone(params.startTime, params.timezone, "yyyy-MM-dd'T'HH:mm:ss");
  const localEnd   = formatInTimeZone(params.endTime,   params.timezone, "yyyy-MM-dd'T'HH:mm:ss");

  try {
    const event = await calendar.events.insert({
      calendarId: params.googleCalendarId ?? "primary",
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
    }, { timeout: 12_000 });

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
          calendarId: params.googleCalendarId ?? "primary",
          eventId,
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

export async function deleteCalendarEvent(connectionId: string, eventId: string, googleCalendarId?: string | null): Promise<void> {
  const tokens = await getValidAccessToken(connectionId);
  if (!tokens) return;
  const client = makePlatformOAuth2Client();
  client.setCredentials({ access_token: tokens.accessToken });
  const calendar = google.calendar({ version: "v3", auth: client });
  try {
    await calendar.events.delete({ calendarId: googleCalendarId ?? "primary", eventId, sendUpdates: "all" });
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
  /** Sub-calendar ID within the linked Google account; null/undefined uses the primary calendar */
  googleCalendarId?: string | null;
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
    const meetBotEmail = (process.env["RECALL_BOT_EMAIL"] ?? "").trim().toLowerCase();
    if (
      meetBotEmail
      && !attendees.some((a) => a.email.toLowerCase() === meetBotEmail)
    ) {
      attendees.push({ email: meetBotEmail, displayName: "SnapServe meeting agent" });
    }
    requestBody["attendees"] = attendees;
  }

  try {
    const event = await calendar.events.patch({
      calendarId: params.googleCalendarId ?? "primary",
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
