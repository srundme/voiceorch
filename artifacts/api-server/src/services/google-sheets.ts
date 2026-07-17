/**
 * Google Sheets connector for the workflow maker.
 *
 * Reuses the platform-level Google OAuth app + state-signing + code-exchange
 * helpers from the calendar integration, but stores connections in a separate
 * table (`google_sheets_connections`) because the granted scopes differ
 * (spreadsheets + drive.readonly).
 */

import { google } from "googleapis";
import { db, googleSheetsConnectionsTable } from "@workspace/db";
import { eq, asc, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { encryptKey, decryptKey } from "../lib/crypto.js";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import {
  makePlatformOAuth2Client,
  exchangeCode,
  signOAuthState,
} from "./scheduling/google-calendar.js";

const SHEETS_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

const SPREADSHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

// ── Service-account mode (simplest UX: user shares the sheet with our SA) ─────
//
// If GOOGLE_SERVICE_ACCOUNT_JSON is set (the full service-account key JSON),
// the workflow maker reads/writes any sheet the user has shared with the
// service account's email — no per-user OAuth, no redirect URIs, no consent.

let cachedSaAuth: InstanceType<typeof google.auth.GoogleAuth> | null = null;

function serviceAccountCreds(): { client_email: string; private_key: string } | null {
  const raw = process.env["GOOGLE_SERVICE_ACCOUNT_JSON"];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
    if (!parsed.client_email || !parsed.private_key) return null;
    // Railway/env stores newlines as literal "\n" — normalize them back.
    return { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, "\n") };
  } catch {
    logger.warn("google-sheets: GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
    return null;
  }
}

export function isServiceAccountConfigured(): boolean {
  return serviceAccountCreds() !== null;
}

export function getServiceAccountEmail(): string | null {
  return serviceAccountCreds()?.client_email ?? null;
}

function getServiceAccountAuth(): InstanceType<typeof google.auth.GoogleAuth> | null {
  const creds = serviceAccountCreds();
  if (!creds) return null;
  if (!cachedSaAuth) {
    cachedSaAuth = new google.auth.GoogleAuth({
      credentials: { client_email: creds.client_email, private_key: creds.private_key },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }
  return cachedSaAuth;
}

/** Extract the spreadsheet ID from a full Google Sheets URL (or a raw ID). */
export function extractSpreadsheetId(input: string): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1]!;
  // Bare ID (no slashes / not a URL).
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
  return null;
}

export function sheetsCallbackUrl(): string {
  if (process.env["GOOGLE_SHEETS_REDIRECT_URI"]) {
    return process.env["GOOGLE_SHEETS_REDIRECT_URI"];
  }
  return `${getSelfBaseUrl()}/api/workflows/google/callback`;
}

/** Consent-screen URL for connecting a Google account with Sheets scopes. */
export function getSheetsAuthUrl(
  clerkId: string,
  returnTo?: string,
  returnOrigin?: string,
  redirectUri?: string,
  connectionId?: string,
): string {
  const client = makePlatformOAuth2Client(redirectUri ?? sheetsCallbackUrl());
  const state = signOAuthState({
    clerkId,
    returnTo: returnTo ?? "workflows",
    ...(returnOrigin ? { returnOrigin } : {}),
    ...(connectionId ? { connectionId } : {}),
  });
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SHEETS_SCOPES,
    prompt: "consent",
    state,
  });
}

/** Exchange the OAuth code for tokens (reuses the calendar exchange helper). */
export async function exchangeSheetsCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiry: Date;
  email: string;
  grantedScopes: string;
}> {
  return exchangeCode(code, sheetsCallbackUrl());
}

export type SheetsConnectionSummary = {
  id: string;
  email: string;
  tokenExpiry: Date | null;
  createdAt: Date;
  hasSpreadsheetsScope: boolean;
};

export async function listSheetsConnectionsForUser(userId: string): Promise<SheetsConnectionSummary[]> {
  const rows = await db
    .select({
      id: googleSheetsConnectionsTable.id,
      email: googleSheetsConnectionsTable.email,
      tokenExpiry: googleSheetsConnectionsTable.tokenExpiry,
      createdAt: googleSheetsConnectionsTable.createdAt,
      grantedScopes: googleSheetsConnectionsTable.grantedScopes,
    })
    .from(googleSheetsConnectionsTable)
    .where(eq(googleSheetsConnectionsTable.userId, userId))
    .orderBy(asc(googleSheetsConnectionsTable.createdAt));
  return rows.map(r => ({
    id: r.id,
    email: r.email,
    tokenExpiry: r.tokenExpiry,
    createdAt: r.createdAt,
    hasSpreadsheetsScope: (r.grantedScopes ?? "").split(/\s+/).includes(SPREADSHEETS_SCOPE),
  }));
}

export async function upsertSheetsConnection(
  userId: string,
  email: string,
  accessToken: string,
  refreshToken: string,
  expiry: Date,
  grantedScopes?: string,
): Promise<string> {
  const encAccess = encryptKey(accessToken);
  const encRefresh = refreshToken ? encryptKey(refreshToken) : "";

  const { sql } = await import("drizzle-orm");
  const rows = await db
    .insert(googleSheetsConnectionsTable)
    .values({
      userId,
      email,
      accessToken: encAccess,
      refreshToken: encRefresh,
      tokenExpiry: expiry,
      ...(grantedScopes !== undefined ? { grantedScopes } : {}),
    })
    .onConflictDoUpdate({
      target: [googleSheetsConnectionsTable.userId, googleSheetsConnectionsTable.email],
      set: {
        accessToken: encAccess,
        refreshToken: sql`CASE WHEN ${encRefresh} != '' THEN ${encRefresh} ELSE google_sheets_connections.refresh_token END`,
        tokenExpiry: expiry,
        ...(grantedScopes !== undefined ? { grantedScopes } : {}),
        updatedAt: new Date(),
      },
    })
    .returning({ id: googleSheetsConnectionsTable.id });
  return rows[0]!.id;
}

/** Return a valid access token for the connection, auto-refreshing if needed. */
async function getValidSheetsAccessToken(connectionId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(googleSheetsConnectionsTable)
    .where(eq(googleSheetsConnectionsTable.id, connectionId))
    .limit(1);
  if (!row) {
    logger.error({ connectionId }, "google-sheets: connection not found");
    return null;
  }

  const accessToken = decryptKey(row.accessToken);
  const refreshToken = row.refreshToken ? decryptKey(row.refreshToken) : "";
  const now = Date.now();
  const expiry = row.tokenExpiry ? row.tokenExpiry.getTime() : 0;
  const msUntilExpiry = expiry - now;

  if (msUntilExpiry < 5 * 60 * 1000 && refreshToken) {
    try {
      const client = makePlatformOAuth2Client();
      client.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await client.refreshAccessToken();
      if (credentials.access_token) {
        await db
          .update(googleSheetsConnectionsTable)
          .set({
            accessToken: encryptKey(credentials.access_token),
            tokenExpiry: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
            updatedAt: new Date(),
          })
          .where(eq(googleSheetsConnectionsTable.id, connectionId));
        return credentials.access_token;
      }
      return null;
    } catch (err) {
      logger.error({ err, connectionId }, "google-sheets: token refresh failed");
      return null;
    }
  }
  if (msUntilExpiry < 0 && !refreshToken) return null;
  return accessToken;
}

async function sheetsClient(connectionId?: string | null) {
  // No connectionId → service-account mode (user shared the sheet with our SA).
  if (!connectionId) {
    const auth = getServiceAccountAuth();
    if (!auth) return null;
    return google.sheets({ version: "v4", auth: auth as never });
  }
  const token = await getValidSheetsAccessToken(connectionId);
  if (!token) return null;
  const client = makePlatformOAuth2Client();
  client.setCredentials({ access_token: token });
  return google.sheets({ version: "v4", auth: client });
}

/**
 * Verify we can access a spreadsheet (service-account mode) and return its tabs.
 * Throws a friendly error when the sheet hasn't been shared with our SA.
 */
export async function getSpreadsheetMeta(
  spreadsheetId: string,
): Promise<{ title: string; tabs: string[] }> {
  const sheets = await sheetsClient(null);
  if (!sheets) {
    throw new Error("Google Sheets service account is not configured on the server.");
  }
  try {
    const res = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "properties.title,sheets.properties.title",
    });
    return {
      title: res.data.properties?.title ?? "(Untitled)",
      tabs: (res.data.sheets ?? []).map(s => s.properties?.title ?? "").filter(Boolean),
    };
  } catch (err: unknown) {
    const status = (err as { code?: number; response?: { status?: number } })?.code
      ?? (err as { response?: { status?: number } })?.response?.status;
    if (status === 403 || status === 404) {
      const email = getServiceAccountEmail() ?? "the service account";
      throw new Error(
        `Can't access this sheet. Share it with ${email} (give Editor access), then try again.`,
      );
    }
    logger.warn({ err, spreadsheetId }, "google-sheets: getSpreadsheetMeta failed");
    throw new Error("Couldn't open this Google Sheet. Check the URL and try again.");
  }
}

async function driveClient(connectionId: string) {
  const token = await getValidSheetsAccessToken(connectionId);
  if (!token) return null;
  const client = makePlatformOAuth2Client();
  client.setCredentials({ access_token: token });
  return google.drive({ version: "v3", auth: client });
}

export async function listSpreadsheets(connectionId: string): Promise<Array<{ id: string; name: string }>> {
  const drive = await driveClient(connectionId);
  if (!drive) return [];
  try {
    const res = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      orderBy: "modifiedTime desc",
      pageSize: 100,
      fields: "files(id,name)",
    });
    return (res.data.files ?? []).map(f => ({ id: f.id ?? "", name: f.name ?? "(Untitled)" })).filter(f => f.id);
  } catch (err) {
    logger.warn({ err, connectionId }, "google-sheets: listSpreadsheets failed");
    return [];
  }
}

export async function listSheets(connectionId: string | null, spreadsheetId: string): Promise<string[]> {
  const sheets = await sheetsClient(connectionId);
  if (!sheets) return [];
  try {
    const res = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
    return (res.data.sheets ?? []).map(s => s.properties?.title ?? "").filter(Boolean);
  } catch (err) {
    logger.warn({ err, connectionId, spreadsheetId }, "google-sheets: listSheets failed");
    return [];
  }
}

function a1(sheetName: string, range: string): string {
  // Quote the sheet title to survive spaces/special chars.
  return `'${sheetName.replace(/'/g, "''")}'!${range}`;
}

export async function getHeaderRow(connectionId: string | null, spreadsheetId: string, sheetName: string): Promise<string[]> {
  const sheets = await sheetsClient(connectionId);
  if (!sheets) return [];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: a1(sheetName, "1:1") });
    return (res.data.values?.[0] ?? []).map(v => String(v));
  } catch (err) {
    logger.warn({ err, connectionId, spreadsheetId, sheetName }, "google-sheets: getHeaderRow failed");
    return [];
  }
}

export interface SheetRow {
  /** 1-based sheet row number (header is row 1). */
  _row: number;
  values: Record<string, string>;
}

/**
 * Read data rows after `sinceRow` (1-based). Returns rows keyed by header name
 * plus the highest row number seen so the caller can advance its checkpoint.
 */
export async function readNewRows(
  connectionId: string | null,
  spreadsheetId: string,
  sheetName: string,
  sinceRow: number,
): Promise<{ rows: SheetRow[]; lastRow: number }> {
  const sheets = await sheetsClient(connectionId);
  if (!sheets) return { rows: [], lastRow: sinceRow };
  try {
    const headers = await getHeaderRow(connectionId, spreadsheetId, sheetName);
    if (headers.length === 0) return { rows: [], lastRow: sinceRow };

    const startRow = Math.max(sinceRow + 1, 2);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: a1(sheetName, `A${startRow}:ZZ`),
    });
    const raw = res.data.values ?? [];
    const rows: SheetRow[] = [];
    let lastRow = sinceRow;
    raw.forEach((cells, i) => {
      const rowNum = startRow + i;
      const hasData = cells.some(c => String(c ?? "").trim() !== "");
      if (!hasData) return;
      const values: Record<string, string> = {};
      headers.forEach((h, ci) => { if (h) values[h] = String(cells[ci] ?? ""); });
      rows.push({ _row: rowNum, values });
      lastRow = Math.max(lastRow, rowNum);
    });
    return { rows, lastRow };
  } catch (err) {
    logger.warn({ err, connectionId, spreadsheetId, sheetName }, "google-sheets: readNewRows failed");
    return { rows: [], lastRow: sinceRow };
  }
}

/** Append a row. Column order follows the sheet's header row; unknown keys are ignored. */
export async function appendRow(
  connectionId: string | null,
  spreadsheetId: string,
  sheetName: string,
  rowByHeader: Record<string, string>,
): Promise<boolean> {
  const sheets = await sheetsClient(connectionId);
  if (!sheets) return false;
  try {
    let headers = await getHeaderRow(connectionId, spreadsheetId, sheetName);
    // If the sheet is empty, seed a header row from the provided keys.
    if (headers.length === 0) {
      headers = Object.keys(rowByHeader);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: a1(sheetName, "1:1"),
        valueInputOption: "RAW",
        requestBody: { values: [headers] },
      });
    }
    // Extend headers with any new keys so nothing is silently dropped.
    const extra = Object.keys(rowByHeader).filter(k => !headers.includes(k));
    if (extra.length > 0) {
      headers = [...headers, ...extra];
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: a1(sheetName, "1:1"),
        valueInputOption: "RAW",
        requestBody: { values: [headers] },
      });
    }
    const row = headers.map(h => rowByHeader[h] ?? "");
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: a1(sheetName, "A1"),
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
    return true;
  } catch (err) {
    logger.warn({ err, connectionId, spreadsheetId, sheetName }, "google-sheets: appendRow failed");
    return false;
  }
}

/**
 * Update the first row whose `matchColumn` cell equals `matchValue`.
 * Falls back to appending when no matching row is found.
 */
export async function updateRow(
  connectionId: string | null,
  spreadsheetId: string,
  sheetName: string,
  matchColumn: string,
  matchValue: string,
  rowByHeader: Record<string, string>,
): Promise<boolean> {
  const sheets = await sheetsClient(connectionId);
  if (!sheets) return false;
  try {
    const headers = await getHeaderRow(connectionId, spreadsheetId, sheetName);
    if (headers.length === 0) return appendRow(connectionId, spreadsheetId, sheetName, rowByHeader);
    const matchIdx = headers.indexOf(matchColumn);
    if (matchIdx < 0) return appendRow(connectionId, spreadsheetId, sheetName, rowByHeader);

    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: a1(sheetName, "A2:ZZ") });
    const raw = res.data.values ?? [];
    let targetRow = -1;
    for (let i = 0; i < raw.length; i++) {
      if (String(raw[i]?.[matchIdx] ?? "").trim() === matchValue.trim()) {
        targetRow = i + 2; // account for header row
        break;
      }
    }
    if (targetRow < 0) return appendRow(connectionId, spreadsheetId, sheetName, rowByHeader);

    // Merge: keep existing cells, overwrite provided headers.
    const existing = raw[targetRow - 2] ?? [];
    const merged = headers.map((h, ci) => (h in rowByHeader ? rowByHeader[h]! : String(existing[ci] ?? "")));
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: a1(sheetName, `A${targetRow}`),
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [merged] },
    });
    return true;
  } catch (err) {
    logger.warn({ err, connectionId, spreadsheetId, sheetName }, "google-sheets: updateRow failed");
    return false;
  }
}

export async function revokeSheetsConnection(connectionId: string, userId: string): Promise<void> {
  const [row] = await db
    .select({ accessToken: googleSheetsConnectionsTable.accessToken })
    .from(googleSheetsConnectionsTable)
    .where(and(eq(googleSheetsConnectionsTable.id, connectionId), eq(googleSheetsConnectionsTable.userId, userId)))
    .limit(1);
  if (row?.accessToken) {
    try {
      const client = makePlatformOAuth2Client();
      await client.revokeToken(decryptKey(row.accessToken));
    } catch { /* best effort */ }
  }
  await db
    .delete(googleSheetsConnectionsTable)
    .where(and(eq(googleSheetsConnectionsTable.id, connectionId), eq(googleSheetsConnectionsTable.userId, userId)));
}
