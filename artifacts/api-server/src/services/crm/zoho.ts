/**
 * Zoho CRM service — OAuth, contacts, and call-outcome writeback
 */

import { encryptKey, decryptKey } from "../../lib/crypto.js";
import { db, crmConnectionsTable, type CrmTokenPayload } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { getSelfBaseUrl } from "../../lib/app-domain.js";

const ZOHO_AUTH_URL          = "https://accounts.zoho.com/oauth/v2/auth";
const ZOHO_DEFAULT_ACCOUNTS  = "https://accounts.zoho.com";
const ZOHO_DEFAULT_API_BASE  = "https://www.zohoapis.com";

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

/**
 * Strict allowlist of Zoho regional datacenter codes and their corresponding
 * accounts server URLs. Any value not in this map is silently treated as the
 * default .com server — no dynamic URL construction from untrusted input.
 */
const ZOHO_ACCOUNTS_SERVER_MAP: Record<string, string> = {
  com: "https://accounts.zoho.com",
  in:  "https://accounts.zoho.in",
  eu:  "https://accounts.zoho.eu",
  au:  "https://accounts.zoho.com.au",
  jp:  "https://accounts.zoho.jp",
  cn:  "https://accounts.zoho.com.cn",
};

/**
 * Strict allowlist of Zoho regional API base URLs. Used to validate the
 * `api_domain` returned in the token response before storing or using it.
 */
const ZOHO_ALLOWED_API_DOMAINS = new Set([
  "https://www.zohoapis.com",
  "https://www.zohoapis.in",
  "https://www.zohoapis.eu",
  "https://www.zohoapis.com.au",
  "https://www.zohoapis.jp",
  "https://www.zohoapis.com.cn",
]);

/**
 * Derive the Zoho accounts server URL from the `location` query param Zoho
 * appends to the callback (e.g. "in", "eu", "au", "jp", "cn", "com").
 * Uses a strict allowlist — unknown/missing values fall back to .com.
 */
export function zohoAccountsServerFromLocation(location: string | undefined): string {
  if (!location) return ZOHO_DEFAULT_ACCOUNTS;
  return ZOHO_ACCOUNTS_SERVER_MAP[location] ?? ZOHO_DEFAULT_ACCOUNTS;
}

const ZOHO_ALLOWED_ACCOUNTS_SERVERS = new Set(Object.values(ZOHO_ACCOUNTS_SERVER_MAP));

/**
 * Validate and normalise a Zoho `api_domain` value against the known allowlist.
 * Falls back to the default .com base for any unexpected value (prevents SSRF).
 */
function sanitizeZohoApiDomain(raw: string | undefined): string {
  if (!raw) return ZOHO_DEFAULT_API_BASE;
  const normalized = raw.replace(/\/$/, "");
  return ZOHO_ALLOWED_API_DOMAINS.has(normalized) ? normalized : ZOHO_DEFAULT_API_BASE;
}

/**
 * Validate and normalise a stored Zoho `accountsServer` value against the
 * known allowlist. Falls back to the default .com server for any unexpected
 * value (prevents SSRF if a stored blob contains a crafted value).
 */
function sanitizeZohoAccountsServer(raw: string | undefined): string {
  if (!raw) return ZOHO_DEFAULT_ACCOUNTS;
  const normalized = raw.replace(/\/$/, "");
  return ZOHO_ALLOWED_ACCOUNTS_SERVERS.has(normalized) ? normalized : ZOHO_DEFAULT_ACCOUNTS;
}

export async function exchangeZohoCode(
  code: string,
  accountsServer?: string,
): Promise<{ tokens: Omit<CrmTokenPayload, "refreshToken"> & { refreshToken?: string; accountsServer: string; apiDomain: string }; accountId: string; accountName: string }> {
  const server = accountsServer ?? ZOHO_DEFAULT_ACCOUNTS;
  const tokenUrl = `${server}/oauth/v2/token`;

  const body = new URLSearchParams({
    grant_type:    "authorization_code",
    client_id:     getClientId(),
    client_secret: getClientSecret(),
    redirect_uri:  getZohoRedirectUri(),
    code,
  });

  const resp = await fetch(tokenUrl, {
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

  // Zoho returns the correct regional API domain in the token response.
  // Validate it against the known allowlist before use — prevents SSRF if the
  // value is unexpected or has been tampered with.
  const apiDomain = sanitizeZohoApiDomain(data.api_domain);

  // Fetch org info for account identity using the regional API domain
  let accountId = "zoho-org";
  let accountName = "Zoho CRM";
  try {
    const orgResp = await fetch(`${apiDomain}/crm/v2/org`, {
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
      accessToken:   data.access_token,
      refreshToken:  data.refresh_token,
      expiresAt:     new Date(Date.now() + (data.expires_in - 60) * 1000).toISOString(),
      accountsServer: server,
      apiDomain,
    },
    accountId,
    accountName,
  };
}

async function refreshZohoToken(connectionId: number, refreshToken: string, accountsServer?: string): Promise<string> {
  const server = accountsServer ?? ZOHO_DEFAULT_ACCOUNTS;
  const tokenUrl = `${server}/oauth/v2/token`;

  const body = new URLSearchParams({
    grant_type:    "refresh_token",
    client_id:     getClientId(),
    client_secret: getClientSecret(),
    refresh_token: refreshToken,
  });

  const resp = await fetch(tokenUrl, {
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
    accessToken:    data.access_token,
    refreshToken:   data.refresh_token ?? old?.refreshToken ?? refreshToken,
    expiresAt:      new Date(Date.now() + (data.expires_in - 60) * 1000).toISOString(),
    // Re-validate stored regional fields through allowlists on each write
    accountsServer: sanitizeZohoAccountsServer(old?.accountsServer),
    apiDomain:      sanitizeZohoApiDomain(old?.apiDomain),
  };

  await db.update(crmConnectionsTable)
    .set({ encryptedTokens: encryptKey(JSON.stringify(newTokens)), updatedAt: new Date() })
    .where(eq(crmConnectionsTable.id, connectionId));

  return newTokens.accessToken;
}

interface ZohoTokenContext {
  accessToken:   string;
  apiDomain:     string;
  accountsServer: string;
}

async function getZohoAccessToken(connectionId: number): Promise<ZohoTokenContext> {
  const [conn] = await db.select().from(crmConnectionsTable).where(eq(crmConnectionsTable.id, connectionId));
  if (!conn) throw new Error(`CRM connection ${connectionId} not found`);

  const tokens = JSON.parse(decryptKey(conn.encryptedTokens)) as CrmTokenPayload;

  // Re-validate stored values against allowlists to defend against any
  // poisoned blobs written before validation was in place.
  const apiDomain      = sanitizeZohoApiDomain(tokens.apiDomain);
  const accountsServer = sanitizeZohoAccountsServer(tokens.accountsServer);

  if (new Date(tokens.expiresAt) > new Date()) {
    return { accessToken: tokens.accessToken, apiDomain, accountsServer };
  }

  const accessToken = await refreshZohoToken(connectionId, tokens.refreshToken, accountsServer);
  return { accessToken, apiDomain, accountsServer };
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
  const { accessToken, apiDomain } = await getZohoAccessToken(connectionId);
  const resp = await fetch(`${apiDomain}/crm/v2/Contacts/views`, {
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
  const { accessToken, apiDomain } = await getZohoAccessToken(connectionId);
  const limit = opts.limit ?? 50;
  const apiBase = `${apiDomain}/crm/v2`;

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
    url = `${apiBase}/Contacts/search?${new URLSearchParams({
      criteria: `(Full_Name:contains:${opts.query.trim()})`,
      fields,
      per_page: String(Math.min(limit, 200)),
      ...(opts.after ? { page_token: opts.after } : {}),
    }).toString()}`;
  } else {
    url = `${apiBase}/Contacts?${params.toString()}`;
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
  const { accessToken, apiDomain } = await getZohoAccessToken(opts.connectionId);

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

  const noteResp = await fetch(`${apiDomain}/crm/v2/Notes`, {
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
  const { accessToken, apiDomain } = await getZohoAccessToken(opts.connectionId);
  const url = `${apiDomain}/crm/v2/Contacts/${opts.contactId}`;
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
