/**
 * Zoho CRM service — OAuth, contacts, and call-outcome writeback
 */

import { encryptKey, decryptKey } from "../../lib/crypto.js";
import { db, crmConnectionsTable, type CrmTokenPayload } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { getSelfBaseUrl } from "../../lib/app-domain.js";

const ZOHO_AUTH_URL   = "https://accounts.zoho.com/oauth/v2/auth";
const ZOHO_TOKEN_URL  = "https://accounts.zoho.com/oauth/v2/token";
const ZOHO_API_BASE   = "https://www.zohoapis.com/crm/v2";

const ZOHO_SCOPES = [
  "ZohoCRM.modules.contacts.READ",
  "ZohoCRM.modules.contacts.WRITE",
  "ZohoCRM.modules.Notes.WRITE",
].join(",");

function getClientId(): string {
  const id = process.env["ZOHO_CLIENT_ID"];
  if (!id) throw new Error("ZOHO_CLIENT_ID not configured");
  return id;
}

function getClientSecret(): string {
  const s = process.env["ZOHO_CLIENT_SECRET"];
  if (!s) throw new Error("ZOHO_CLIENT_SECRET not configured");
  return s;
}

export function isZohoConfigured(): boolean {
  return !!(process.env["ZOHO_CLIENT_ID"] && process.env["ZOHO_CLIENT_SECRET"]);
}

export function getZohoRedirectUri(): string {
  return `${getSelfBaseUrl()}/api/crm/callback/zoho`;
}

export function buildZohoAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id:     getClientId(),
    redirect_uri:  getZohoRedirectUri(),
    scope:         ZOHO_SCOPES,
    response_type: "code",
    access_type:   "offline",
    prompt:        "consent",
    state,
  });
  return `${ZOHO_AUTH_URL}?${params.toString()}`;
}

interface ZohoTokenResponse {
  access_token:  string;
  refresh_token?: string;
  expires_in:    number; // seconds
  api_domain?:   string;
  token_type?:   string;
}

export async function exchangeZohoCode(code: string): Promise<{ tokens: Omit<CrmTokenPayload, "refreshToken"> & { refreshToken?: string }; accountId: string; accountName: string }> {
  const body = new URLSearchParams({
    grant_type:    "authorization_code",
    client_id:     getClientId(),
    client_secret: getClientSecret(),
    redirect_uri:  getZohoRedirectUri(),
    code,
  });

  const resp = await fetch(ZOHO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Zoho token exchange failed: ${resp.status} ${text}`);
  }

  const data = await resp.json() as ZohoTokenResponse;
  if (!data.access_token) throw new Error("Zoho token exchange returned no access_token");
  if (!data.refresh_token) {
    logger.warn("Zoho token exchange returned no refresh_token — will reuse stored token if prior connection exists");
  }

  // Fetch org info for account identity
  let accountId = "zoho-org";
  let accountName = "Zoho CRM";
  try {
    const orgResp = await fetch("https://www.zohoapis.com/crm/v2/org", {
      headers: { Authorization: `Zoho-oauthtoken ${data.access_token}` },
    });
    if (orgResp.ok) {
      const orgData = await orgResp.json() as { org?: Array<{ id?: string; company_name?: string }> };
      const org = orgData.org?.[0];
      if (org?.id) accountId = String(org.id);
      if (org?.company_name) accountName = org.company_name;
    }
  } catch {
    // non-critical
  }

  return {
    tokens: {
      accessToken:  data.access_token,
      refreshToken: data.refresh_token,
      expiresAt:    new Date(Date.now() + (data.expires_in - 60) * 1000).toISOString(),
    },
    accountId,
    accountName,
  };
}

async function refreshZohoToken(connectionId: number, refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type:    "refresh_token",
    client_id:     getClientId(),
    client_secret: getClientSecret(),
    refresh_token: refreshToken,
  });

  const resp = await fetch(ZOHO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Zoho token refresh failed: ${resp.status} ${text}`);
  }

  const data = await resp.json() as ZohoTokenResponse;
  if (!data.access_token) throw new Error("Zoho token refresh returned no access_token");

  const [conn] = await db.select({ encryptedTokens: crmConnectionsTable.encryptedTokens })
    .from(crmConnectionsTable).where(eq(crmConnectionsTable.id, connectionId));
  const old = conn ? (JSON.parse(decryptKey(conn.encryptedTokens)) as CrmTokenPayload) : null;

  const newTokens: CrmTokenPayload = {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token ?? old?.refreshToken ?? refreshToken,
    expiresAt:    new Date(Date.now() + (data.expires_in - 60) * 1000).toISOString(),
  };

  await db.update(crmConnectionsTable)
    .set({ encryptedTokens: encryptKey(JSON.stringify(newTokens)), updatedAt: new Date() })
    .where(eq(crmConnectionsTable.id, connectionId));

  return newTokens.accessToken;
}

async function getZohoAccessToken(connectionId: number): Promise<string> {
  const [conn] = await db.select().from(crmConnectionsTable).where(eq(crmConnectionsTable.id, connectionId));
  if (!conn) throw new Error(`CRM connection ${connectionId} not found`);

  const tokens = JSON.parse(decryptKey(conn.encryptedTokens)) as CrmTokenPayload;

  if (new Date(tokens.expiresAt) > new Date()) {
    return tokens.accessToken;
  }

  return refreshZohoToken(connectionId, tokens.refreshToken);
}

export interface CrmContactResult {
  id:       string;
  phone:    string;
  name:     string | null;
  email:    string | null;
  company:  string | null;
  rawFields: Record<string, string>;
}

export interface ContactsPage {
  contacts:   CrmContactResult[];
  nextCursor: string | null;
  total:      number | null;
}

export interface ZohoCrmView {
  id:    string;
  name:  string;
  type?: string;
}

/**
 * Fetch Zoho CRM contact views so the user can filter
 * the contact browser to a specific view before importing.
 */
export async function listZohoViews(connectionId: number): Promise<ZohoCrmView[]> {
  const accessToken = await getZohoAccessToken(connectionId);
  const resp = await fetch(`${ZOHO_API_BASE}/Contacts/views`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  if (!resp.ok) throw new Error(`Zoho views fetch failed: ${resp.status}`);
  const data = await resp.json() as { views: Array<{ id: string; name: string; type?: string }> };
  return (data.views ?? []).map(v => ({ id: v.id, name: v.name, type: v.type }));
}

export async function listZohoContacts(
  connectionId: number,
  opts: { query?: string; after?: string; limit?: number; viewId?: string } = {},
): Promise<ContactsPage> {
  const accessToken = await getZohoAccessToken(connectionId);
  const limit = opts.limit ?? 50;

  const fields = "id,Phone,Mobile,First_Name,Last_Name,Full_Name,Email,Account_Name";
  const params = new URLSearchParams({
    fields,
    per_page: String(Math.min(limit, 200)),
  });
  if (opts.after) params.set("page_token", opts.after);
  if (opts.viewId) params.set("cvid", opts.viewId); // filter by CRM view

  let url: string;

  if (opts.query?.trim()) {
    // Use search API
    url = `${ZOHO_API_BASE}/Contacts/search?${new URLSearchParams({
      criteria: `(Full_Name:contains:${opts.query.trim()})`,
      fields,
      per_page: String(Math.min(limit, 200)),
      ...(opts.after ? { page_token: opts.after } : {}),
    }).toString()}`;
  } else {
    url = `${ZOHO_API_BASE}/Contacts?${params.toString()}`;
  }

  const resp = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });

  if (resp.status === 204) {
    return { contacts: [], nextCursor: null, total: 0 };
  }

  if (!resp.ok) throw new Error(`Zoho contacts list failed: ${resp.status}`);

  const data = await resp.json() as {
    data: Array<Record<string, unknown>>;
    info?: { count?: number; more_records?: boolean; page_token?: string };
  };

  const contacts = (data.data ?? []).map(mapZohoContact);
  const info = data.info;

  return {
    contacts,
    nextCursor: info?.more_records ? (info.page_token ?? null) : null,
    total:      info?.count ?? null,
  };
}

function mapZohoContact(raw: Record<string, unknown>): CrmContactResult {
  const phone = String(raw["Phone"] ?? raw["Mobile"] ?? "").trim();
  const name = String(raw["Full_Name"] ?? [raw["First_Name"], raw["Last_Name"]].filter(Boolean).join(" ") ?? "").trim() || null;
  const flatProps: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v != null && typeof v !== "object") flatProps[k] = String(v);
  }
  return {
    id:        String(raw["id"] ?? ""),
    phone,
    name,
    email:     String(raw["Email"] ?? "").trim() || null,
    company:   String(raw["Account_Name"] ?? "").trim() || null,
    rawFields: flatProps,
  };
}

export async function pushZohoCallOutcome(opts: {
  connectionId: number;
  contactId:    string;
  callStatus:   string | null;
  summary:      string | null;
  disposition:  string | null;
  durationSeconds: number;
  recordingUrl: string | null;
  callAt:       Date;
  booking?:     { meetingTime: Date | null; meetingLink: string | null; status: string } | null;
}): Promise<void> {
  const accessToken = await getZohoAccessToken(opts.connectionId);

  const bodyLines: string[] = [
    `Call Duration: ${opts.durationSeconds}s`,
    opts.callStatus  ? `Call Status: ${opts.callStatus}` : null,
    opts.disposition ? `Disposition: ${opts.disposition}` : null,
    opts.summary ? `Summary: ${opts.summary}` : null,
    opts.recordingUrl ? `Recording: ${opts.recordingUrl}` : null,
    opts.booking ? `--- Booking ---` : null,
    opts.booking?.meetingTime ? `Meeting Time: ${opts.booking.meetingTime.toISOString()}` : null,
    opts.booking?.meetingLink ? `Meeting Link: ${opts.booking.meetingLink}` : null,
    opts.booking ? `Meeting Status: ${opts.booking.status}` : null,
  ].filter(Boolean) as string[];

  const notePayload = {
    data: [{
      Note_Title:   "VoiceOrch Call Outcome",
      Note_Content: bodyLines.join("\n"),
      Parent_Id:    { id: opts.contactId },
      se_module:    "Contacts",
    }],
  };

  const noteResp = await fetch(`${ZOHO_API_BASE}/Notes`, {
    method:  "POST",
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, "Content-Type": "application/json" },
    body:    JSON.stringify(notePayload),
  });

  if (!noteResp.ok) {
    const text = await noteResp.text();
    throw new Error(`Zoho create note failed: ${noteResp.status} ${text}`);
  }

  logger.info({ contactId: opts.contactId }, "Zoho call outcome note created");
}

/**
 * Optionally update a Zoho contact field (e.g. Lead_Status) after a call.
 * Only called when `fieldMapping.__writeback_status_field` is configured.
 */
export async function updateZohoContactStatus(opts: {
  connectionId:  number;
  contactId:     string;
  fieldName:     string;
  fieldValue:    string;
}): Promise<void> {
  const accessToken = await getZohoAccessToken(opts.connectionId);
  const url = `${ZOHO_API_BASE}/Contacts/${opts.contactId}`;
  const resp = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ data: [{ [opts.fieldName]: opts.fieldValue }] }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Zoho update contact status failed: ${resp.status} ${text}`);
  }
}
