/**
 * HubSpot CRM service — OAuth, contacts, and call-outcome writeback
 */

import { encryptKey, decryptKey } from "../../lib/crypto.js";
import { db, crmConnectionsTable, type CrmTokenPayload } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { getSelfBaseUrl } from "../../lib/app-domain.js";

const HUBSPOT_AUTH_URL    = "https://app.hubspot.com/oauth/authorize";
const HUBSPOT_TOKEN_URL   = "https://api.hubapi.com/oauth/v1/token";
const HUBSPOT_CONTACTS_URL = "https://api.hubapi.com/crm/v3/objects/contacts";
const HUBSPOT_NOTES_URL   = "https://api.hubapi.com/crm/v3/objects/notes";
const HUBSPOT_ASSOC_URL   = "https://api.hubapi.com/crm/v3/associations/notes/contacts/batch/create";

const HUBSPOT_SCOPES = [
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
  "crm.objects.notes.write",
].join(" ");

function getClientId(): string {
  const id = process.env["HUBSPOT_CLIENT_ID"];
  if (!id) throw new Error("HUBSPOT_CLIENT_ID not configured");
  return id;
}

function getClientSecret(): string {
  const s = process.env["HUBSPOT_CLIENT_SECRET"];
  if (!s) throw new Error("HUBSPOT_CLIENT_SECRET not configured");
  return s;
}

export function isHubSpotConfigured(): boolean {
  return !!(process.env["HUBSPOT_CLIENT_ID"] && process.env["HUBSPOT_CLIENT_SECRET"]);
}

export function getHubSpotRedirectUri(): string {
  return `${getSelfBaseUrl()}/api/crm/callback/hubspot`;
}

export function buildHubSpotAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id:     getClientId(),
    redirect_uri:  getHubSpotRedirectUri(),
    scope:         HUBSPOT_SCOPES,
    state,
  });
  return `${HUBSPOT_AUTH_URL}?${params.toString()}`;
}

interface HubSpotTokenResponse {
  access_token:  string;
  refresh_token: string;
  expires_in:    number; // seconds
  hub_id:        number;
  hub_domain?:   string;
  user?:         string;
}

export async function exchangeHubSpotCode(code: string): Promise<{ tokens: CrmTokenPayload; accountId: string; accountName: string }> {
  const body = new URLSearchParams({
    grant_type:    "authorization_code",
    client_id:     getClientId(),
    client_secret: getClientSecret(),
    redirect_uri:  getHubSpotRedirectUri(),
    code,
  });

  const resp = await fetch(HUBSPOT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HubSpot token exchange failed: ${resp.status} ${text}`);
  }

  const data = await resp.json() as HubSpotTokenResponse;

  return {
    tokens: {
      accessToken:  data.access_token,
      refreshToken: data.refresh_token,
      expiresAt:    new Date(Date.now() + (data.expires_in - 60) * 1000).toISOString(),
    },
    accountId:   String(data.hub_id),
    accountName: data.hub_domain ?? `HubSpot Portal ${data.hub_id}`,
  };
}

async function refreshHubSpotToken(connectionId: number, refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type:    "refresh_token",
    client_id:     getClientId(),
    client_secret: getClientSecret(),
    refresh_token: refreshToken,
  });

  const resp = await fetch(HUBSPOT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HubSpot token refresh failed: ${resp.status} ${text}`);
  }

  const data = await resp.json() as HubSpotTokenResponse;
  const newTokens: CrmTokenPayload = {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresAt:    new Date(Date.now() + (data.expires_in - 60) * 1000).toISOString(),
  };

  await db.update(crmConnectionsTable)
    .set({ encryptedTokens: encryptKey(JSON.stringify(newTokens)), updatedAt: new Date() })
    .where(eq(crmConnectionsTable.id, connectionId));

  return newTokens.accessToken;
}

async function getHubSpotAccessToken(connectionId: number): Promise<string> {
  const [conn] = await db.select().from(crmConnectionsTable).where(eq(crmConnectionsTable.id, connectionId));
  if (!conn) throw new Error(`CRM connection ${connectionId} not found`);

  const tokens = JSON.parse(decryptKey(conn.encryptedTokens)) as CrmTokenPayload;

  if (new Date(tokens.expiresAt) > new Date()) {
    return tokens.accessToken;
  }

  return refreshHubSpotToken(connectionId, tokens.refreshToken);
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

export interface CrmListItem {
  id:    string;
  name:  string;
  type?: string;
  count?: number;
}

/**
 * Fetch HubSpot contact lists (static + dynamic) so the user can filter
 * the contact browser to a specific list before importing.
 */
export async function listHubSpotContactLists(connectionId: number): Promise<CrmListItem[]> {
  const accessToken = await getHubSpotAccessToken(connectionId);
  // v1 lists API — simpler and more widely available than v3 ILS
  const resp = await fetch("https://api.hubapi.com/contacts/v1/lists?count=250", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error(`HubSpot lists fetch failed: ${resp.status}`);
  const data = await resp.json() as { lists: Array<{ listId: number; name: string; dynamic: boolean; metaData?: { size?: number } }> };
  return (data.lists ?? []).map(l => ({
    id:    String(l.listId),
    name:  l.name,
    type:  l.dynamic ? "dynamic" : "static",
    count: l.metaData?.size,
  }));
}

export async function listHubSpotContacts(
  connectionId: number,
  opts: { query?: string; after?: string; limit?: number; listId?: string } = {},
): Promise<ContactsPage> {
  const accessToken = await getHubSpotAccessToken(connectionId);
  const limit = opts.limit ?? 50;

  const properties = ["phone", "firstname", "lastname", "email", "company", "mobilephone", "hs_object_id"];

  // If a list is selected, use the v1 list contacts endpoint
  if (opts.listId && !opts.query?.trim()) {
    const params = new URLSearchParams({
      count:    String(Math.min(limit, 100)),
      property: properties.join(","),
    });
    if (opts.after) params.set("vidOffset", opts.after);
    const resp = await fetch(`https://api.hubapi.com/contacts/v1/lists/${opts.listId}/contacts/all?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) throw new Error(`HubSpot list contacts failed: ${resp.status}`);
    const data = await resp.json() as {
      contacts: Array<Record<string, unknown>>;
      "has-more": boolean;
      "vid-offset"?: number;
    };
    const contacts = (data.contacts ?? []).map(c => {
      // v1 list API: contact.properties is a map of { fieldName: { value: string } }
      const propsRaw = ((c as any)["properties"] ?? {}) as Record<string, { value?: string }>;
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(propsRaw)) {
        if (v?.value != null && v.value !== "") props[k] = v.value;
      }
      return mapHubSpotContact({ id: String((c as any)["vid"] ?? ""), properties: props });
    });
    return {
      contacts,
      nextCursor: data["has-more"] && data["vid-offset"] != null ? String(data["vid-offset"]) : null,
      total:      null,
    };
  }

  const params = new URLSearchParams({
    limit:      String(limit),
    properties: properties.join(","),
  });
  if (opts.after) params.set("after", opts.after);

  let url: string;
  if (opts.query?.trim()) {
    // Use search API for text queries
    const searchBody = {
      query:      opts.query.trim(),
      limit,
      after:      opts.after ?? undefined,
      properties,
    };
    const searchResp = await fetch(`${HUBSPOT_CONTACTS_URL}/search`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body:    JSON.stringify(searchBody),
    });
    if (!searchResp.ok) throw new Error(`HubSpot search failed: ${searchResp.status}`);
    const data = await searchResp.json() as { results: Array<Record<string, unknown>>; paging?: { next?: { after?: string } }; total?: number };
    return {
      contacts:   data.results.map(mapHubSpotContact),
      nextCursor: data.paging?.next?.after ?? null,
      total:      data.total ?? null,
    };
  }

  url = `${HUBSPOT_CONTACTS_URL}?${params.toString()}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error(`HubSpot contacts list failed: ${resp.status}`);
  const data = await resp.json() as { results: Array<Record<string, unknown>>; paging?: { next?: { after?: string } }; total?: number };

  return {
    contacts:   data.results.map(mapHubSpotContact),
    nextCursor: data.paging?.next?.after ?? null,
    total:      data.total ?? null,
  };
}

function mapHubSpotContact(raw: Record<string, unknown>): CrmContactResult {
  const props = (raw["properties"] ?? raw) as Record<string, unknown>;
  const phone = String(props["phone"] ?? props["mobilephone"] ?? "").trim();
  const firstName = String(props["firstname"] ?? "").trim();
  const lastName  = String(props["lastname"] ?? "").trim();
  const name = [firstName, lastName].filter(Boolean).join(" ") || null;
  const flatProps: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v != null) flatProps[k] = String(v);
  }
  return {
    id:        String(raw["id"] ?? ""),
    phone,
    name,
    email:     String(props["email"] ?? "").trim() || null,
    company:   String(props["company"] ?? "").trim() || null,
    rawFields: flatProps,
  };
}

export async function pushHubSpotCallOutcome(opts: {
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
  const accessToken = await getHubSpotAccessToken(opts.connectionId);

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

  const noteBody = {
    properties: {
      hs_note_body:      bodyLines.join("\n"),
      hs_timestamp:      String(opts.callAt.getTime()),
    },
  };

  const noteResp = await fetch(HUBSPOT_NOTES_URL, {
    method:  "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body:    JSON.stringify(noteBody),
  });

  if (!noteResp.ok) {
    const text = await noteResp.text();
    throw new Error(`HubSpot create note failed: ${noteResp.status} ${text}`);
  }

  const note = await noteResp.json() as { id: string };

  // Associate note with contact
  const assocBody = {
    inputs: [{
      from: { id: note.id },
      to:   { id: opts.contactId },
      type: "note_to_contact",
    }],
  };

  const assocResp = await fetch(HUBSPOT_ASSOC_URL, {
    method:  "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body:    JSON.stringify(assocBody),
  });

  if (!assocResp.ok) {
    logger.warn({ noteId: note.id, contactId: opts.contactId }, "HubSpot note association failed (note still created)");
  }
}

/**
 * Optionally update a contact property (e.g. hs_lead_status) after a call.
 * Only called when `fieldMapping.__writeback_status_field` is configured.
 */
export async function updateHubSpotContactStatus(opts: {
  connectionId: number;
  contactId:    string;
  propertyName: string;
  propertyValue: string;
}): Promise<void> {
  const accessToken = await getHubSpotAccessToken(opts.connectionId);
  const url = `https://api.hubapi.com/crm/v3/objects/contacts/${opts.contactId}`;
  const resp = await fetch(url, {
    method:  "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ properties: { [opts.propertyName]: opts.propertyValue } }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HubSpot update contact status failed: ${resp.status} ${text}`);
  }
}
