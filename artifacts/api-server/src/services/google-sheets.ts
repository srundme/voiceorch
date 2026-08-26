/**
 * Google Sheets connector — connect / create / bind + runtime read/write.
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
import {
  DEFAULT_COLUMN_MAPS,
  defaultColumnMapForUseCase,
  phonesMatch,
  cellMatchesPhone,
  rowToPromptVars,
  resolveMatchColumnIndex,
  sheetRange,
} from "./google-sheets-helpers.js";

export {
  verifyOAuthState,
  DEFAULT_COLUMN_MAPS,
  defaultColumnMapForUseCase,
  phonesMatch,
  cellMatchesPhone,
  rowToPromptVars,
};

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

/**
 * Ensure a worksheet tab exists. Google returns "Unable to parse range:
 * 'Call Log'!A1:…" when the tab is missing — Automatic Calls hit that on
 * create when writeback=both and the leads file has no Call Log tab yet.
 */
export async function ensureSheetTab(
  userId: string,
  connectionId: string,
  spreadsheetId: string,
  sheetName: string,
): Promise<{ title: string; created: boolean }> {
  const wanted = String(sheetName ?? "").trim() || "Sheet1";
  const tabs = await listSheetTabs(userId, connectionId, spreadsheetId);
  const existing = tabs.find((t) => t.title.trim().toLowerCase() === wanted.toLowerCase());
  if (existing) {
    return { title: existing.title, created: false };
  }

  const auth = await getAuthedClient(connectionId, userId);
  const sheets = google.sheets({ version: "v4", auth });
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: wanted } } }],
      },
    });
  } catch (err) {
    // Race / already exists — re-check tabs before failing.
    const again = await listSheetTabs(userId, connectionId, spreadsheetId);
    const found = again.find((t) => t.title.trim().toLowerCase() === wanted.toLowerCase());
    if (found) return { title: found.title, created: false };
    throw err;
  }
  logger.info(
    { userId, connectionId, spreadsheetId, sheetName: wanted },
    "sheets: created missing tab",
  );
  return { title: wanted, created: true };
}

export type SheetTemplate = "blank" | "call_log" | "lead_pipeline";

const TEMPLATES: Record<SheetTemplate, {
  tab: string;
  headers: string[];
  sampleRows?: string[][];
  instructions?: string[][];
  extraTabs?: Array<{ tab: string; headers: string[] }>;
}> = {
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
      "Phone", "Name", "Email", "Status", "Last Call At", "Disposition",
      "Summary", "Call ID", "Recording", "Next Follow-up", "Meeting Time", "Do Not Call",
    ],
    sampleRows: [
      ["9876543210", "Sample Lead", "sample@example.com", "", "", "", "", "", "", "", "", ""],
      ["9123456780", "Demo Contact", "", "", "", "", "", "", "", "", "", ""],
    ],
    instructions: [
      ["SnapServe Automatic Calls — how to use"],
      [""],
      ["1. Keep Phone in column A (required). Name/Email help the agent greet correctly."],
      ["2. Leave Status blank for new leads. SnapServe writes Queued → Calling → Completed / Failed."],
      ["3. Put yes in Do Not Call to skip a row without deleting it."],
      ["4. Set Status to Retry to dial that row again."],
      ["5. Call Log tab gets one append-only row per call attempt."],
      ["6. Phones work as 9876543210 or +91…; cells with two numbers use the first."],
      ["7. Disposition Callback → SnapServe schedules a platform callback and fills Next Follow-up. Status stays Completed."],
      ["8. Inbound calls from a sheet phone update the same lead row (Status / Summary / Disposition)."],
      ["9. When a meeting is booked on the call, Meeting Time (IST) is written. Status stays Completed."],
    ],
    extraTabs: [
      {
        tab: "Call Log",
        headers: [
          "Call ID", "Started At (IST)", "Duration (sec)", "Direction", "Phone",
          "Caller Name", "Disposition", "Summary", "Recording", "Agent", "Cost (₹)",
        ],
      },
    ],
  },
};

export async function ensureHeaders(
  userId: string,
  connectionId: string,
  spreadsheetId: string,
  sheetName: string,
  headers: string[],
): Promise<{ headers: string[]; wrote: boolean; sheetName: string }> {
  if (headers.length === 0) return { headers: [], wrote: false, sheetName: String(sheetName ?? "").trim() || "Sheet1" };
  // Create the tab if missing — otherwise values.get fails with
  // "Unable to parse range: 'Call Log'!A1:…".
  const tab = await ensureSheetTab(userId, connectionId, spreadsheetId, sheetName);
  const auth = await getAuthedClient(connectionId, userId);
  const sheets = google.sheets({ version: "v4", auth });
  // Header row only needs a modest width (call-log / status cols << 26).
  const range = sheetRange(tab.title, "A1:Z1");
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    majorDimension: "ROWS",
  });
  const current = (existing.data.values?.[0] ?? []).map((h) => String(h ?? "").trim());
  if (current.length === 0 || current.every((h) => !h)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: sheetRange(tab.title, "A1"),
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
    return { headers, wrote: true, sheetName: tab.title };
  }
  const missing = headers.filter((h) => !current.some((c) => c.toLowerCase() === h.toLowerCase()));
  if (missing.length === 0) return { headers: current, wrote: false, sheetName: tab.title };
  const merged = [...current, ...missing];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: sheetRange(tab.title, "A1"),
    valueInputOption: "RAW",
    requestBody: { values: [merged] },
  });
  return { headers: merged, wrote: true, sheetName: tab.title };
}

export async function readSheetGrid(
  userId: string,
  connectionId: string,
  spreadsheetId: string,
  sheetName: string,
): Promise<{ headers: string[]; rows: string[][] }> {
  const auth = await getAuthedClient(connectionId, userId);
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetRange(sheetName, "A1:ZZ500"),
    majorDimension: "ROWS",
  });
  const values = (res.data.values ?? []) as string[][];
  if (values.length === 0) return { headers: [], rows: [] };
  const headers = (values[0] ?? []).map((h) => String(h ?? "").trim());
  const rows = values.slice(1).map((r) => r.map((c) => String(c ?? "")));
  return { headers, rows };
}

export async function lookupRowByPhone(
  userId: string,
  connectionId: string,
  spreadsheetId: string,
  sheetName: string,
  matchColumn: string,
  phone: string,
): Promise<{
  rowIndex: number;
  headers: string[];
  values: Record<string, string>;
} | null> {
  const { headers, rows } = await readSheetGrid(userId, connectionId, spreadsheetId, sheetName);
  if (headers.length === 0) return null;

  const matchIdx = resolveMatchColumnIndex(headers, matchColumn || "Phone");
  const searchCols =
    matchIdx >= 0
      ? [matchIdx]
      : headers.map((_, i) => i); // fall back: scan every column for a phone match

  if (matchIdx < 0) {
    logger.warn(
      { spreadsheetId, sheetName, matchColumn },
      "sheets: match column not found — scanning all columns for phone",
    );
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const hit = searchCols.some((c) => cellMatchesPhone(row[c] ?? "", phone));
    if (!hit) continue;
    const values: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      const v = (row[c] ?? "").trim();
      if (v) values[key] = v;
    }
    return { rowIndex: i + 2, headers, values }; // 1-based sheet row (header is 1)
  }
  return null;
}

function cellStr(v: string | number | null | undefined): string {
  if (v == null) return "";
  return String(v);
}

function resolveColumnMap(
  useCase: SheetUseCase,
  columnMap: Record<string, string> | null | undefined,
): Record<string, string> {
  if (columnMap && Object.keys(columnMap).length > 0) return columnMap;
  return defaultColumnMapForUseCase(useCase);
}

function buildRowFromMap(
  headers: string[],
  fields: Record<string, string | number | null | undefined>,
  columnMap: Record<string, string>,
  existing?: string[],
): string[] {
  const byHeader = new Map<string, string>();
  for (const [field, header] of Object.entries(columnMap)) {
    if (!(field in fields)) continue;
    byHeader.set(header.toLowerCase(), cellStr(fields[field]));
  }
  return headers.map((h, i) => {
    const mapped = byHeader.get(h.toLowerCase());
    if (mapped !== undefined) return mapped;
    return existing?.[i] ?? "";
  });
}

export async function appendCallLogRow(
  userId: string,
  connectionId: string,
  spreadsheetId: string,
  sheetName: string,
  fields: Record<string, string | number | null | undefined>,
  columnMap?: Record<string, string>,
): Promise<{ updatedRange?: string }> {
  const map = columnMap && Object.keys(columnMap).length > 0
    ? columnMap
    : DEFAULT_COLUMN_MAPS.call_log;
  const desiredHeaders = [...new Set(Object.values(map))];
  const { headers } = await ensureHeaders(userId, connectionId, spreadsheetId, sheetName, desiredHeaders);
  const row = buildRowFromMap(headers, fields, map);
  const auth = await getAuthedClient(connectionId, userId);
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: sheetRange(sheetName, "A:A"),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
  return { updatedRange: res.data.updates?.updatedRange ?? undefined };
}

export async function updateOutcomeRow(
  userId: string,
  connectionId: string,
  spreadsheetId: string,
  sheetName: string,
  matchColumn: string,
  phone: string,
  fields: Record<string, string | number | null | undefined>,
  opts?: {
    columnMap?: Record<string, string>;
    createIfMissing?: boolean;
  },
): Promise<{ rowIndex: number; created: boolean } | null> {
  const map = opts?.columnMap && Object.keys(opts.columnMap).length > 0
    ? opts.columnMap
    : DEFAULT_COLUMN_MAPS.outcome;
  const desiredHeaders = [...new Set([...Object.values(map), matchColumn])];
  const { headers } = await ensureHeaders(userId, connectionId, spreadsheetId, sheetName, desiredHeaders);

  const found = await lookupRowByPhone(userId, connectionId, spreadsheetId, sheetName, matchColumn, phone);
  const auth = await getAuthedClient(connectionId, userId);
  const sheets = google.sheets({ version: "v4", auth });

  if (!found) {
    if (!opts?.createIfMissing) return null;
    const createFields = { ...fields, phone: fields.phone ?? phone };
    const row = buildRowFromMap(headers, createFields, map);
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: sheetRange(sheetName, "A:A"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
    return { rowIndex: -1, created: true };
  }

  const { headers: gridHeaders, rows } = await readSheetGrid(userId, connectionId, spreadsheetId, sheetName);
  const existing = rows[found.rowIndex - 2] ?? [];
  const next = buildRowFromMap(gridHeaders.length ? gridHeaders : headers, fields, map, existing);
  // Preserve match column phone if not in fields
  const matchIdx = (gridHeaders.length ? gridHeaders : headers)
    .findIndex((h) => h.toLowerCase() === matchColumn.toLowerCase());
  if (matchIdx >= 0 && !next[matchIdx]) {
    next[matchIdx] = existing[matchIdx] ?? phone;
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: sheetRange(sheetName, `A${found.rowIndex}`),
    valueInputOption: "RAW",
    requestBody: { values: [next] },
  });
  return { rowIndex: found.rowIndex, created: false };
}

/** Patch cells on a specific 1-based sheet row using header → value map. */
export async function updateSheetRowByIndex(
  userId: string,
  connectionId: string,
  spreadsheetId: string,
  sheetName: string,
  rowIndex: number,
  updates: Record<string, string>,
): Promise<void> {
  if (rowIndex < 2 || Object.keys(updates).length === 0) return;
  const { headers, rows } = await readSheetGrid(userId, connectionId, spreadsheetId, sheetName);
  if (headers.length === 0) return;
  const existing = rows[rowIndex - 2] ?? [];
  const next = headers.map((h, i) => {
    const key = Object.keys(updates).find((k) => k.toLowerCase() === h.toLowerCase());
    if (key !== undefined) return updates[key] ?? "";
    return existing[i] ?? "";
  });
  // Append any new headers that don't exist yet
  const missingHeaders = Object.keys(updates).filter(
    (k) => !headers.some((h) => h.toLowerCase() === k.toLowerCase()),
  );
  if (missingHeaders.length > 0) {
    const { headers: merged } = await ensureHeaders(
      userId, connectionId, spreadsheetId, sheetName, [...headers, ...missingHeaders],
    );
    const existing2 = rows[rowIndex - 2] ?? [];
    const next2 = merged.map((h, i) => {
      const key = Object.keys(updates).find((k) => k.toLowerCase() === h.toLowerCase());
      if (key !== undefined) return updates[key] ?? "";
      return existing2[i] ?? "";
    });
    const auth = await getAuthedClient(connectionId, userId);
    const sheets = google.sheets({ version: "v4", auth });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: sheetRange(sheetName, `A${rowIndex}`),
      valueInputOption: "RAW",
      requestBody: { values: [next2] },
    });
    return;
  }
  const auth = await getAuthedClient(connectionId, userId);
  const sheets = google.sheets({ version: "v4", auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: sheetRange(sheetName, `A${rowIndex}`),
    valueInputOption: "RAW",
    requestBody: { values: [next] },
  });
}

export type EnabledSheetBinding = {
  id: string;
  connectionId: string;
  label: string;
  useCase: SheetUseCase;
  spreadsheetId: string;
  sheetName: string;
  columnMap: Record<string, string>;
  matchColumn: string | null;
};

export async function listEnabledBindings(
  userId: string,
  agentId: number,
  useCase?: SheetUseCase,
): Promise<EnabledSheetBinding[]> {
  const rows = await db
    .select({
      id: agentSheetBindingsTable.id,
      connectionId: agentSheetBindingsTable.connectionId,
      label: agentSheetBindingsTable.label,
      useCase: agentSheetBindingsTable.useCase,
      spreadsheetId: agentSheetBindingsTable.spreadsheetId,
      sheetName: agentSheetBindingsTable.sheetName,
      columnMap: agentSheetBindingsTable.columnMap,
      matchColumn: agentSheetBindingsTable.matchColumn,
      enabled: agentSheetBindingsTable.enabled,
    })
    .from(agentSheetBindingsTable)
    .where(and(
      eq(agentSheetBindingsTable.userId, userId),
      eq(agentSheetBindingsTable.agentId, agentId),
      eq(agentSheetBindingsTable.enabled, true),
    ));

  return rows
    .filter((r) => !useCase || r.useCase === useCase)
    .map((r) => ({
      id: r.id,
      connectionId: r.connectionId,
      label: r.label,
      useCase: r.useCase,
      spreadsheetId: r.spreadsheetId,
      sheetName: r.sheetName,
      columnMap: resolveColumnMap(r.useCase, r.columnMap as Record<string, string>),
      matchColumn: r.matchColumn,
    }));
}

/**
 * Look up caller row(s) from enabled lookup bindings.
 * Returns prompt variables: Name → name/customer_name/caller_name, plus every column slug.
 */
export async function runLookupBindings(
  userId: string,
  agentId: number,
  phone: string,
): Promise<Record<string, string>> {
  const bindings = await listEnabledBindings(userId, agentId, "lookup");
  if (bindings.length === 0 || !phone.trim()) return {};

  for (const b of bindings) {
    try {
      const matchCol = b.matchColumn?.trim() || "Phone";
      const hit = await lookupRowByPhone(
        userId, b.connectionId, b.spreadsheetId, b.sheetName, matchCol, phone,
      );
      if (!hit) continue;
      const vars = rowToPromptVars(hit.values);
      if (Object.keys(vars).length === 0) continue;
      logger.info(
        {
          agentId,
          bindingId: b.id,
          fields: Object.keys(hit.values).length,
          vars: Object.keys(vars),
          hasName: !!vars["name"],
        },
        "sheets: lookup hit → prompt vars",
      );
      return vars;
    } catch (err) {
      logger.warn({ err, agentId, bindingId: b.id }, "sheets: lookup binding failed");
    }
  }
  return {};
}

export async function createSpreadsheet(
  userId: string,
  connectionId: string,
  opts: { title: string; template?: SheetTemplate },
): Promise<{ spreadsheetId: string; spreadsheetTitle: string; sheetName: string; sheetGid: number | null }> {
  const auth = await getAuthedClient(connectionId, userId);
  const sheets = google.sheets({ version: "v4", auth });
  const template = TEMPLATES[opts.template ?? "blank"];

  const sheetDefs: Array<{ properties: { title: string } }> = [
    { properties: { title: template.tab } },
  ];
  if (template.instructions?.length) {
    sheetDefs.push({ properties: { title: "Instructions" } });
  }
  for (const extra of template.extraTabs ?? []) {
    sheetDefs.push({ properties: { title: extra.tab } });
  }

  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: opts.title },
      sheets: sheetDefs,
    },
    fields: "spreadsheetId,properties.title,sheets.properties(sheetId,title)",
  });

  const spreadsheetId = created.data.spreadsheetId;
  if (!spreadsheetId) throw new Error("Google Sheets create returned no spreadsheetId");
  const sheetName = created.data.sheets?.[0]?.properties?.title ?? template.tab;
  const sheetGid = created.data.sheets?.[0]?.properties?.sheetId ?? null;

  if (template.headers.length > 0) {
    const values: string[][] = [template.headers, ...(template.sampleRows ?? [])];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: sheetRange(sheetName, "A1"),
      valueInputOption: "RAW",
      requestBody: { values },
    });
  }

  if (template.instructions?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: sheetRange("Instructions", "A1"),
      valueInputOption: "RAW",
      requestBody: { values: template.instructions },
    });
  }

  for (const extra of template.extraTabs ?? []) {
    if (extra.headers.length === 0) continue;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: sheetRange(extra.tab, "A1"),
      valueInputOption: "RAW",
      requestBody: { values: [extra.headers] },
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
    matchColumn: input.matchColumn
      ?? (input.useCase === "lookup" || input.useCase === "outcome" ? "Phone" : null),
    enabled: true,
    columnMap: defaultColumnMapForUseCase(input.useCase),
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
