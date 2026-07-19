/**
 * Google Sheets connector — Phase 01 (connect / create / list / bind).
 *
 * Uses the same platform Google OAuth app as Calendar (GOOGLE_CLIENT_ID /
 * GOOGLE_CLIENT_SECRET) with Sheets + Drive scopes. Tokens live in
 * google_sheets_connections (separate from calendar — different scopes).
 */

import { google } from "googleapis";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  googleSheetsConnectionsTable,
  agentSheetBindingsTable,
  agentsTable,
  type SheetUseCase,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { encryptKey, decryptKey } from "../lib/crypto.js";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import {
  makePlatformOAuth2Client,
  signOAuthState,
  verifyOAuthState,
} from "./scheduling/google-calendar.js";

export { verifyOAuthState };

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

function sheetsCallbackUrl(): string {
  if (process.env["GOOGLE_SHEETS_REDIRECT_URI"]) {
    return process.env["GOOGLE_SHEETS_REDIRECT_URI"];
  }
  return `${getSelfBaseUrl()}/api/sheets/google/callback`;
}

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
    returnTo: returnTo ?? "sheets",
    ...(returnOrigin ? { returnOrigin } : {}),
    ...(connectionId ? { connectionId } : {}),
  });
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state,
  });
}

export async function exchangeSheetsCode(code: string, redirectUri?: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiry: Date;
  email: string;
  grantedScopes: string;
}> {
  const client = makePlatformOAuth2Client(redirectUri ?? sheetsCallbackUrl());
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) throw new Error("Missing access_token from Google OAuth response");

  const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userInfoRes.ok) throw new Error(`Failed to fetch Google userinfo (${userInfoRes.status})`);
  const userInfo = await userInfoRes.json() as { email?: string };
  if (!userInfo.email) throw new Error("Google userinfo missing email");

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? "",
    expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600_000),
    email: userInfo.email,
    grantedScopes: tokens.scope ?? "",
  };
}

export type SheetsConnectionPublic = {
  id: string;
  email: string;
  tokenExpiry: Date | null;
  createdAt: Date;
  grantedScopes: string | null;
};

export async function listSheetsConnections(userId: string): Promise<SheetsConnectionPublic[]> {
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
  return rows;
}

export async function upsertSheetsConnection(
  userId: string,
  email: string,
  accessToken: string,
  refreshToken: string,
  expiry: Date,
  existingId?: string,
  grantedScopes?: string,
): Promise<string> {
  const encAccess = encryptKey(accessToken);
  const encRefresh = refreshToken ? encryptKey(refreshToken) : "";

  if (existingId) {
    const result = await db
      .update(googleSheetsConnectionsTable)
      .set({
        email,
        accessToken: encAccess,
        ...(encRefresh ? { refreshToken: encRefresh } : {}),
        tokenExpiry: expiry,
        ...(grantedScopes !== undefined ? { grantedScopes } : {}),
        updatedAt: new Date(),
      })
      .where(and(
        eq(googleSheetsConnectionsTable.id, existingId),
        eq(googleSheetsConnectionsTable.userId, userId),
      ))
      .returning({ id: googleSheetsConnectionsTable.id });
    if (result.length > 0) return existingId;
  }

  const rows = await db
    .insert(googleSheetsConnectionsTable)
    .values({
      userId,
      email,
      accessToken: encAccess,
      refreshToken: encRefresh,
      tokenExpiry: expiry,
      grantedScopes: grantedScopes ?? null,
    })
    .onConflictDoUpdate({
      target: [googleSheetsConnectionsTable.userId, googleSheetsConnectionsTable.email],
      set: {
        accessToken: encAccess,
        // Keep existing refresh token when Google doesn't re-issue one.
        ...(encRefresh ? { refreshToken: encRefresh } : {}),
        tokenExpiry: expiry,
        ...(grantedScopes !== undefined ? { grantedScopes } : {}),
        updatedAt: new Date(),
      },
    })
    .returning({ id: googleSheetsConnectionsTable.id });
  return rows[0]!.id;
}

export async function revokeSheetsConnection(userId: string, connectionId: string): Promise<boolean> {
  const deleted = await db
    .delete(googleSheetsConnectionsTable)
    .where(and(
      eq(googleSheetsConnectionsTable.id, connectionId),
      eq(googleSheetsConnectionsTable.userId, userId),
    ))
    .returning({ id: googleSheetsConnectionsTable.id });
  return deleted.length > 0;
}

async function getAuthedClient(connectionId: string, userId: string) {
  const [row] = await db
    .select()
    .from(googleSheetsConnectionsTable)
    .where(and(
      eq(googleSheetsConnectionsTable.id, connectionId),
      eq(googleSheetsConnectionsTable.userId, userId),
    ))
    .limit(1);
  if (!row) throw new Error("Google Sheets connection not found");

  const client = makePlatformOAuth2Client(sheetsCallbackUrl());
  client.setCredentials({
    access_token: decryptKey(row.accessToken),
    refresh_token: row.refreshToken ? decryptKey(row.refreshToken) : undefined,
    expiry_date: row.tokenExpiry ? row.tokenExpiry.getTime() : undefined,
  });

  client.on("tokens", (tokens) => {
    void (async () => {
      try {
        await db.update(googleSheetsConnectionsTable).set({
          ...(tokens.access_token ? { accessToken: encryptKey(tokens.access_token) } : {}),
          ...(tokens.refresh_token ? { refreshToken: encryptKey(tokens.refresh_token) } : {}),
          ...(tokens.expiry_date ? { tokenExpiry: new Date(tokens.expiry_date) } : {}),
          updatedAt: new Date(),
        }).where(eq(googleSheetsConnectionsTable.id, connectionId));
      } catch (err) {
        logger.warn({ err, connectionId }, "sheets: failed to persist refreshed tokens");
      }
    })();
  });

  return client;
}

export async function listSpreadsheets(
  userId: string,
  connectionId: string,
): Promise<Array<{ id: string; name: string; modifiedTime?: string }>> {
  const auth = await getAuthedClient(connectionId, userId);
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: "files(id, name, modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 50,
    spaces: "drive",
  });
  return (res.data.files ?? [])
    .filter((f): f is { id: string; name: string; modifiedTime?: string | null } => !!f.id && !!f.name)
    .map((f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime ?? undefined }));
}

export async function listSheetTabs(
  userId: string,
  connectionId: string,
  spreadsheetId: string,
): Promise<Array<{ sheetId: number; title: string }>> {
  const auth = await getAuthedClient(connectionId, userId);
  const sheets = google.sheets({ version: "v4", auth });
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title)",
  });
  return (meta.data.sheets ?? [])
    .map((s) => ({
      sheetId: s.properties?.sheetId ?? 0,
      title: s.properties?.title ?? "Sheet1",
    }))
    .filter((s) => !!s.title);
}

export type SheetTemplate = "blank" | "call_log" | "lead_pipeline";

const TEMPLATES: Record<SheetTemplate, { tab: string; headers: string[] }> = {
  blank: {
    tab: "Sheet1",
    headers: [],
  },
  call_log: {
    tab: "Call Log",
    headers: [
      "Call ID", "Started At (IST)", "Duration (sec)", "Direction", "Phone",
      "Caller Name", "Disposition", "Summary", "Recording", "Agent", "Cost (₹)",
    ],
  },
  lead_pipeline: {
    tab: "Leads",
    headers: [
      "Phone", "Name", "Email", "Status", "Last Call At", "Disposition", "Notes", "Next Follow-up",
    ],
  },
};

export async function createSpreadsheet(
  userId: string,
  connectionId: string,
  opts: { title: string; template?: SheetTemplate },
): Promise<{ spreadsheetId: string; spreadsheetTitle: string; sheetName: string; sheetGid: number | null }> {
  const auth = await getAuthedClient(connectionId, userId);
  const sheets = google.sheets({ version: "v4", auth });
  const template = TEMPLATES[opts.template ?? "blank"];

  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: opts.title },
      sheets: [{ properties: { title: template.tab } }],
    },
    fields: "spreadsheetId,properties.title,sheets.properties(sheetId,title)",
  });

  const spreadsheetId = created.data.spreadsheetId;
  if (!spreadsheetId) throw new Error("Google Sheets create returned no spreadsheetId");
  const sheetName = created.data.sheets?.[0]?.properties?.title ?? template.tab;
  const sheetGid = created.data.sheets?.[0]?.properties?.sheetId ?? null;

  if (template.headers.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [template.headers] },
    });
  }

  logger.info({ userId, connectionId, spreadsheetId, title: opts.title, template: opts.template }, "sheets: spreadsheet created");
  return {
    spreadsheetId,
    spreadsheetTitle: created.data.properties?.title ?? opts.title,
    sheetName,
    sheetGid,
  };
}

export async function assertAgentOwned(userId: string, agentId: number): Promise<void> {
  const [agent] = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, userId)))
    .limit(1);
  if (!agent) throw new Error("Agent not found");
}

export async function listAgentBindings(userId: string, agentId: number) {
  await assertAgentOwned(userId, agentId);
  return db
    .select({
      id: agentSheetBindingsTable.id,
      agentId: agentSheetBindingsTable.agentId,
      connectionId: agentSheetBindingsTable.connectionId,
      label: agentSheetBindingsTable.label,
      useCase: agentSheetBindingsTable.useCase,
      spreadsheetId: agentSheetBindingsTable.spreadsheetId,
      spreadsheetTitle: agentSheetBindingsTable.spreadsheetTitle,
      sheetName: agentSheetBindingsTable.sheetName,
      sheetGid: agentSheetBindingsTable.sheetGid,
      columnMap: agentSheetBindingsTable.columnMap,
      matchColumn: agentSheetBindingsTable.matchColumn,
      enabled: agentSheetBindingsTable.enabled,
      createdAt: agentSheetBindingsTable.createdAt,
      connectionEmail: googleSheetsConnectionsTable.email,
    })
    .from(agentSheetBindingsTable)
    .leftJoin(
      googleSheetsConnectionsTable,
      eq(agentSheetBindingsTable.connectionId, googleSheetsConnectionsTable.id),
    )
    .where(and(
      eq(agentSheetBindingsTable.userId, userId),
      eq(agentSheetBindingsTable.agentId, agentId),
    ))
    .orderBy(asc(agentSheetBindingsTable.createdAt));
}

export async function createAgentBinding(
  userId: string,
  input: {
    agentId: number;
    connectionId: string;
    label: string;
    useCase: SheetUseCase;
    spreadsheetId: string;
    spreadsheetTitle?: string;
    sheetName: string;
    sheetGid?: number | null;
    matchColumn?: string | null;
  },
) {
  await assertAgentOwned(userId, input.agentId);
  const [conn] = await db
    .select({ id: googleSheetsConnectionsTable.id })
    .from(googleSheetsConnectionsTable)
    .where(and(
      eq(googleSheetsConnectionsTable.id, input.connectionId),
      eq(googleSheetsConnectionsTable.userId, userId),
    ))
    .limit(1);
  if (!conn) throw new Error("Google Sheets connection not found");

  const [row] = await db.insert(agentSheetBindingsTable).values({
    userId,
    agentId: input.agentId,
    connectionId: input.connectionId,
    label: input.label.trim() || "Sheet",
    useCase: input.useCase,
    spreadsheetId: input.spreadsheetId,
    spreadsheetTitle: input.spreadsheetTitle ?? null,
    sheetName: input.sheetName || "Sheet1",
    sheetGid: input.sheetGid ?? null,
    matchColumn: input.matchColumn ?? null,
    enabled: true,
    columnMap: {},
  }).returning();
  return row!;
}

export async function updateAgentBinding(
  userId: string,
  bindingId: string,
  patch: Partial<{
    label: string;
    useCase: SheetUseCase;
    sheetName: string;
    sheetGid: number | null;
    matchColumn: string | null;
    enabled: boolean;
    columnMap: Record<string, string>;
  }>,
) {
  const [row] = await db
    .update(agentSheetBindingsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(
      eq(agentSheetBindingsTable.id, bindingId),
      eq(agentSheetBindingsTable.userId, userId),
    ))
    .returning();
  return row ?? null;
}

export async function deleteAgentBinding(userId: string, bindingId: string): Promise<boolean> {
  const deleted = await db
    .delete(agentSheetBindingsTable)
    .where(and(
      eq(agentSheetBindingsTable.id, bindingId),
      eq(agentSheetBindingsTable.userId, userId),
    ))
    .returning({ id: agentSheetBindingsTable.id });
  return deleted.length > 0;
}

export function deriveSheetsRedirectUri(reqHost?: string, reqProto?: string): string {
  if (process.env["GOOGLE_SHEETS_REDIRECT_URI"]) {
    return process.env["GOOGLE_SHEETS_REDIRECT_URI"];
  }
  if (reqHost) {
    return `${reqProto ?? "https"}://${reqHost}/api/sheets/google/callback`;
  }
  return sheetsCallbackUrl();
}
