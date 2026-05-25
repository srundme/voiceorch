import { google } from "googleapis";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { encryptKey, decryptKey } from "../../lib/crypto.js";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

function callbackUrl(): string {
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  return domain
    ? `https://${domain}/api/scheduling/google/callback`
    : "http://localhost:80/api/scheduling/google/callback";
}

export function makeOAuth2Client(clientId: string, clientSecret: string) {
  return new google.auth.OAuth2(clientId, clientSecret, callbackUrl());
}

// ── Per-user credential store ────────────────────────────────────────────────

export async function getOAuthConfig(userId: string): Promise<{ clientId: string; clientSecret: string } | null> {
  const rows = await db.execute(
    sql`SELECT client_id, client_secret FROM user_google_oauth_config WHERE user_id = ${userId}`,
  );
  const row = rows.rows[0] as any;
  if (!row) return null;
  return { clientId: row.client_id, clientSecret: decryptKey(row.client_secret) };
}

export async function saveOAuthConfig(userId: string, clientId: string, clientSecret: string): Promise<void> {
  const encrypted = encryptKey(clientSecret);
  await db.execute(sql`
    INSERT INTO user_google_oauth_config (user_id, client_id, client_secret)
    VALUES (${userId}, ${clientId}, ${encrypted})
    ON CONFLICT (user_id) DO UPDATE
      SET client_id = EXCLUDED.client_id,
          client_secret = EXCLUDED.client_secret,
          updated_at = NOW()
  `);
}

export async function deleteOAuthConfig(userId: string): Promise<void> {
  await db.execute(sql`DELETE FROM user_google_oauth_config WHERE user_id = ${userId}`);
}

// ── Auth URL ────────────────────────────────────────────────────────────────

export function getAuthUrl(clientId: string, clientSecret: string, state: string): string {
  const client = makeOAuth2Client(clientId, clientSecret);
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state,
  });
}

// ── Code exchange ────────────────────────────────────────────────────────────

export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
): Promise<{ accessToken: string; refreshToken: string; expiry: Date; email: string }> {
  const client = makeOAuth2Client(clientId, clientSecret);
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) {
    throw new Error("Missing access_token from Google OAuth response");
  }
  const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userInfoRes.ok) {
    throw new Error(`Failed to fetch Google user info: ${userInfoRes.status}`);
  }
  const userInfo = await userInfoRes.json() as { email?: string };
  if (!userInfo.email) throw new Error("Could not fetch email from Google account");

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? "",
    expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600_000),
    email: userInfo.email,
  };
}

// ── Token store ──────────────────────────────────────────────────────────────

export async function getTokensForUser(userId: string): Promise<{ accessToken: string; refreshToken: string; email: string; clientId: string; clientSecret: string } | null> {
  const config = await getOAuthConfig(userId);
  if (!config) return null;

  const rows = await db.execute(
    sql`SELECT access_token, refresh_token, token_expiry, email FROM google_calendar_tokens WHERE user_id = ${userId}`,
  );
  const row = rows.rows[0] as any;
  if (!row) return null;

  const client = makeOAuth2Client(config.clientId, config.clientSecret);
  client.setCredentials({
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    expiry_date: row.token_expiry ? new Date(row.token_expiry).getTime() : undefined,
  });

  const now = Date.now();
  const expiry = row.token_expiry ? new Date(row.token_expiry).getTime() : 0;
  if (expiry - now < 5 * 60 * 1000) {
    try {
      const { credentials } = await client.refreshAccessToken();
      if (credentials.access_token) {
        await db.execute(sql`
          UPDATE google_calendar_tokens
          SET access_token = ${credentials.access_token},
              token_expiry = ${credentials.expiry_date ? new Date(credentials.expiry_date) : null},
              updated_at = NOW()
          WHERE user_id = ${userId}
        `);
        return { accessToken: credentials.access_token, refreshToken: row.refresh_token, email: row.email, clientId: config.clientId, clientSecret: config.clientSecret };
      }
    } catch (err) {
      logger.warn({ err, userId }, "Failed to refresh Google token");
    }
  }

  return { accessToken: row.access_token, refreshToken: row.refresh_token, email: row.email, clientId: config.clientId, clientSecret: config.clientSecret };
}

export async function storeTokens(userId: string, accessToken: string, refreshToken: string, expiry: Date, email: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO google_calendar_tokens (user_id, access_token, refresh_token, token_expiry, email)
    VALUES (${userId}, ${accessToken}, ${refreshToken}, ${expiry}, ${email})
    ON CONFLICT (user_id) DO UPDATE
      SET access_token = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          token_expiry = EXCLUDED.token_expiry,
          email = EXCLUDED.email,
          updated_at = NOW()
  `);
}

export async function revokeTokens(userId: string): Promise<void> {
  const rows = await db.execute(
    sql`SELECT access_token FROM google_calendar_tokens WHERE user_id = ${userId}`,
  );
  const row = rows.rows[0] as any;
  if (row?.access_token) {
    const config = await getOAuthConfig(userId);
    if (config) {
      const client = makeOAuth2Client(config.clientId, config.clientSecret);
      try { await client.revokeToken(row.access_token); } catch { /* best effort */ }
    }
  }
  await db.execute(sql`DELETE FROM google_calendar_tokens WHERE user_id = ${userId}`);
}

// ── Calendar event creation ──────────────────────────────────────────────────

export async function createCalendarEvent(params: {
  userId: string;
  summary: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  attendeeEmail: string;
  attendeeName: string;
  timezone: string;
  hostEmail?: string | null;
}): Promise<{ meetLink: string | null; eventId: string } | null> {
  const tokens = await getTokensForUser(params.userId);
  if (!tokens) return null;

  const client = makeOAuth2Client(tokens.clientId, tokens.clientSecret);
  client.setCredentials({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken });

  const calendar = google.calendar({ version: "v3", auth: client });

  const attendees: { email: string; displayName?: string }[] = [
    { email: params.attendeeEmail, displayName: params.attendeeName },
  ];
  if (params.hostEmail) {
    attendees.push({ email: params.hostEmail });
  }

  try {
    const event = await calendar.events.insert({
      calendarId: "primary",
      conferenceDataVersion: 1,
      requestBody: {
        summary: params.summary,
        description: params.description,
        start: { dateTime: params.startTime.toISOString(), timeZone: params.timezone },
        end: { dateTime: params.endTime.toISOString(), timeZone: params.timezone },
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

    const meetLink = event.data.conferenceData?.entryPoints?.find(e => e.entryPointType === "video")?.uri ?? null;
    const eventId = event.data.id ?? "";
    logger.info({ userId: params.userId, eventId, meetLink }, "Google Calendar event created");
    return { meetLink, eventId };
  } catch (err) {
    logger.warn({ err, userId: params.userId }, "Failed to create Google Calendar event");
    return null;
  }
}

export async function deleteCalendarEvent(userId: string, eventId: string): Promise<void> {
  const tokens = await getTokensForUser(userId);
  if (!tokens) return;
  const client = makeOAuth2Client(tokens.clientId, tokens.clientSecret);
  client.setCredentials({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken });
  const calendar = google.calendar({ version: "v3", auth: client });
  try {
    await calendar.events.delete({ calendarId: "primary", eventId });
  } catch (err) {
    logger.warn({ err, userId, eventId }, "Failed to delete Google Calendar event");
  }
}
