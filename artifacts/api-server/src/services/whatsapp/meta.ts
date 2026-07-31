/**
 * Direct Meta WhatsApp Cloud API integration (no BSP middleman).
 *
 * The user pastes a permanent access token + phone number ID + WABA ID from
 * their Meta Business account. We fetch their approved templates from the
 * Graph API so they can link them to hints, and send template messages
 * directly through Meta.
 */

import { logger } from "../../lib/logger.js";

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export interface MetaTemplateInfo {
  name: string;
  language: string;
  status: string;
  category: string | null;
  paramCount: number;
  bodyPreview: string;
}

export interface MetaTemplateChoice {
  name: string;
  language: string;
  paramCount: number;
}

function graphError(json: unknown, status: number): string {
  const err = (json as { error?: { message?: string; code?: number } } | null)?.error;
  if (err?.message) return err.message;
  return `Meta API HTTP ${status}`;
}

/** Fetch approved templates from the user's WABA. Throws with a readable message. */
export async function fetchMetaTemplates(
  accessToken: string,
  wabaId: string,
): Promise<MetaTemplateInfo[]> {
  const out: MetaTemplateInfo[] = [];
  let url: string | null =
    `${GRAPH_BASE}/${encodeURIComponent(wabaId.trim())}/message_templates` +
    `?fields=name,status,language,category,components&limit=100`;

  // Paginate defensively (cap 5 pages / 500 templates)
  for (let page = 0; url && page < 5; page++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as {
      data?: Array<{
        name?: string; status?: string; language?: string; category?: string;
        components?: Array<{ type?: string; text?: string }>;
      }>;
      paging?: { next?: string };
    } | null;
    if (!res.ok) throw new Error(graphError(json, res.status));

    for (const t of json?.data ?? []) {
      if (!t.name || !t.language) continue;
      const body = (t.components ?? []).find((c) => (c.type ?? "").toUpperCase() === "BODY");
      const bodyText = body?.text ?? "";
      // Count {{1}}, {{2}}… placeholders in the body
      const params = new Set<string>();
      for (const m of bodyText.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) params.add(m[1]!);
      out.push({
        name: t.name,
        language: t.language,
        status: (t.status ?? "").toUpperCase(),
        category: t.category ?? null,
        paramCount: params.size,
        bodyPreview: bodyText.slice(0, 160),
      });
    }
    url = json?.paging?.next ?? null;
  }
  return out;
}

/** Validate token + phone number ID by fetching the phone number object. */
export async function verifyMetaPhoneNumber(
  accessToken: string,
  phoneNumberId: string,
): Promise<{ ok: true; displayPhone: string | null; verifiedName: string | null } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `${GRAPH_BASE}/${encodeURIComponent(phoneNumberId.trim())}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) },
    );
    const json = (await res.json().catch(() => null)) as {
      display_phone_number?: string; verified_name?: string;
    } | null;
    if (!res.ok) return { ok: false, error: graphError(json, res.status) };
    return { ok: true, displayPhone: json?.display_phone_number ?? null, verifiedName: json?.verified_name ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Build the standard param values for a hint, fitted to the template's paramCount. */
export function buildMetaParams(
  hint: string,
  ctx: { businessName: string; summary: string; meetingTime?: string | null; meetLink?: string | null },
  paramCount: number,
): string[] {
  let base: string[];
  if (hint === "booking_confirmed") {
    base = [ctx.businessName, ctx.meetingTime || "—", ctx.meetLink || "—", ctx.summary];
  } else if (hint === "callback_scheduled") {
    base = [ctx.businessName, ctx.summary || "Our team will call you back soon."];
  } else {
    base = [ctx.businessName, ctx.summary || "Thanks for speaking with us — we'll be in touch."];
  }
  const fitted = base.slice(0, paramCount);
  while (fitted.length < paramCount) fitted.push("—");
  // Meta rejects empty params and newlines/tabs in body params
  return fitted.map((p) => (p ?? "—").toString().replace(/[\n\t]+/g, " ").trim() || "—");
}

/** Send an approved template message via the Cloud API. */
export async function sendMetaTemplate(opts: {
  accessToken: string;
  phoneNumberId: string;
  toPhone: string;
  template: MetaTemplateChoice;
  params: string[];
}): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string }> {
  const to = opts.toPhone.replace(/[^\d]/g, ""); // Meta wants digits, no '+'
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: opts.template.name,
      language: { code: opts.template.language },
      ...(opts.params.length > 0
        ? {
            components: [{
              type: "body",
              parameters: opts.params.map((text) => ({ type: "text", text })),
            }],
          }
        : {}),
    },
  };

  try {
    const res = await fetch(
      `${GRAPH_BASE}/${encodeURIComponent(opts.phoneNumberId.trim())}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const json = (await res.json().catch(() => null)) as {
      messages?: Array<{ id?: string }>;
    } | null;
    if (!res.ok) {
      const msg = graphError(json, res.status);
      logger.warn({ to, template: opts.template.name, msg }, "whatsapp-meta: send failed");
      return { ok: false, error: msg };
    }
    return { ok: true, messageId: json?.messages?.[0]?.id ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Resolve the template choice for a hint, falling back to call_summary. */
export function resolveMetaTemplate(
  metaTemplates: Record<string, MetaTemplateChoice | undefined> | null | undefined,
  hint: string,
): MetaTemplateChoice | null {
  if (!metaTemplates || typeof metaTemplates !== "object") return null;
  const direct = metaTemplates[hint];
  if (direct?.name && direct.language) return direct;
  const fallback = metaTemplates["call_summary"];
  if (fallback?.name && fallback.language) return fallback;
  return null;
}
