import { google } from "googleapis";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env["GOOGLE_CLIENT_ID"],
    process.env["GOOGLE_CLIENT_SECRET"],
    process.env["GOOGLE_REDIRECT_URI"] ?? `${process.env["REPLIT_DOMAINS"]?.split(",")[0] ? `https://${process.env["REPLIT_DOMAINS"]?.split(",")[0]}` : "http://localhost:80"}/api/scheduling/google/callback`,
  );
}

export function getAuthUrl(state?: string): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state,
  });
}

export async function exchangeCode(code: string): Promise<{ accessToken: string; refreshToken: string; expiry: Date; email: string }> {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Missing tokens from Google OAuth response");
  }
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();
  if (!data.email) throw new Error("Could not fetch email from Google account");

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600_000),
    email: data.email,
  };
}

export async function getTokensForUser(userId: string): Promise<{ accessToken: string; refreshToken: string; email: string } | null> {
  const rows = await db.execute(
    sql`SELECT access_token, refresh_token, token_expiry, email FROM google_calendar_tokens WHERE user_id = ${userId}`,
  );
  const row = rows.rows[0] as any;
  if (!row) return null;

  const client = getOAuth2Client();
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
        return { accessToken: credentials.access_token, refreshToken: row.refresh_token, email: row.email };
      }
    } catch (err) {
      logger.warn({ err, userId }, "Failed to refresh Google token");
    }
  }

  return { accessToken: row.access_token, refreshToken: row.refresh_token, email: row.email };
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
    const client = getOAuth2Client();
    try { await client.revokeToken(row.access_token); } catch { /* best effort */ }
  }
  await db.execute(sql`DELETE FROM google_calendar_tokens WHERE user_id = ${userId}`);
}

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

  const client = getOAuth2Client();
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
  const client = getOAuth2Client();
  client.setCredentials({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken });
  const calendar = google.calendar({ version: "v3", auth: client });
  try {
    await calendar.events.delete({ calendarId: "primary", eventId });
  } catch (err) {
    logger.warn({ err, userId, eventId }, "Failed to delete Google Calendar event");
  }
}
