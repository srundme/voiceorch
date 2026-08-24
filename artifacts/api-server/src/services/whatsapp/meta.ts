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

/**
 * Some clients use BSP proxy panels (e.g. whatsapi.in) that expose a
 * Graph-compatible API at their own base URL. When a connection stores a
 * custom API base we hit that instead of graph.facebook.com.
 */
export function resolveApiBase(apiBase?: string | null): string {
  const b = (apiBase ?? "").trim().replace(/\/+$/, "");
  if (!b) return GRAPH_BASE;
  return /^https?:\/\//i.test(b) ? b : `https://${b}`;
}

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
  const j = json as { error?: { message?: string; code?: number } | string } | null;
  if (typeof j?.error === "string" && j.error) return j.error; // BSP panels return { success:false, error:"..." }
  if (typeof j?.error === "object" && j.error?.message) return j.error.message;
  return `Meta API HTTP ${status}`;
}

export function isMetaTokenExpiredError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("session has expired")
    || m.includes("error validating access token")
    || /\berror.?190\b/.test(m)
    || (m.includes("oauthexception") && m.includes("expired"))
  );
}

/** BSP panels (e.g. whatapi.in) return HTTP 200 with { success:false, error:"..." }. */
function bspError(json: unknown): string | null {
  const j = json as { success?: boolean; error?: unknown } | null;
  if (j && (j.success === false || (j.error != null && !("data" in (j as object))))) {
    return graphError(json, 200);
  }
  return null;
}

function languageCode(raw: unknown): string {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (raw && typeof raw === "object" && "code" in raw) {
    const code = (raw as { code?: unknown }).code;
    if (typeof code === "string") return code.trim();
  }
  return "";
}

function extractTemplateRows(json: unknown): Array<Record<string, unknown>> {
  if (!json || typeof json !== "object") return [];
  const j = json as Record<string, unknown>;
  const list = j["data"] ?? j["templates"] ?? j["message_templates"] ?? j["items"] ?? j["results"] ?? j["records"];
  if (Array.isArray(list)) return list as Array<Record<string, unknown>>;
  return [];
}

function bodyParamCount(components: unknown, fallbackText?: string): number {
  const body = Array.isArray(components)
    ? components.find((c) => String((c as { type?: string })?.type ?? "").toUpperCase() === "BODY")
    : null;
  const text = typeof (body as { text?: string } | null)?.text === "string"
    ? (body as { text: string }).text
    : (fallbackText ?? "");
  const params = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) params.add(m[1]!);
  return params.size;
}

/** Statuses we can send. Empty/unknown is kept — many BSP panels omit status on approved templates. */
export function isUsableWhatsappTemplateStatus(status: string): boolean {
  const s = (status ?? "").trim().toUpperCase().replace(/\s+/g, "_");
  if (!s || s === "UNKNOWN" || s === "N/A" || s === "NA") return true;
  return s === "APPROVED" || s === "ACTIVE" || s === "ENABLED" || s === "PLATFORM_MANAGED";
}

/** Map fetch results to the persisted catalog (sendable templates only). */
export function toTemplateCatalog(
  templates: MetaTemplateInfo[],
): Array<{ name: string; language: string; status: string; paramCount: number; category?: string | null; bodyPreview?: string }> {
  return templates
    .filter((t) => isUsableWhatsappTemplateStatus(t.status))
    .map((t) => ({
      name: t.name,
      language: t.language,
      status: t.status || "APPROVED",
      paramCount: t.paramCount,
      category: t.category,
      bodyPreview: t.bodyPreview,
    }));
}

/** When the user only pasted Phone Number ID + token, look up the WABA id. */
export async function resolveWabaIdFromPhoneNumber(
  accessToken: string,
  phoneNumberId: string,
  apiBase?: string | null,
): Promise<string | null> {
  const id = phoneNumberId.trim();
  if (!id) return null;
  try {
    const res = await fetch(
      `${resolveApiBase(apiBase)}/${encodeURIComponent(id)}?fields=whatsapp_business_account`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) },
    );
    const json = (await res.json().catch(() => null)) as {
      whatsapp_business_account?: { id?: string } | string;
    } | null;
    if (!res.ok) return null;
    const waba = json?.whatsapp_business_account;
    if (typeof waba === "string" && waba.trim()) return waba.trim();
    if (waba && typeof waba === "object" && typeof waba.id === "string" && waba.id.trim()) return waba.id.trim();
  } catch (err) {
    logger.warn({ err, phoneNumberId: id }, "whatsapp-meta: WABA lookup from phone id failed");
  }
  return null;
}

/** Fetch templates from the user's WABA (or a Graph-compatible BSP). Throws with a readable message. */
export async function fetchMetaTemplates(
  accessToken: string,
  wabaId: string,
  apiBase?: string | null,
): Promise<MetaTemplateInfo[]> {
  const out: MetaTemplateInfo[] = [];
  const base = resolveApiBase(apiBase);
  let url: string | null =
    `${base}/${encodeURIComponent(wabaId.trim())}/message_templates` +
    `?fields=name,status,language,category,components&limit=100`;

  for (let page = 0; url && page < 5; page++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as {
      paging?: { next?: string };
    } | null;
    if (!res.ok) throw new Error(graphError(json, res.status));
    const bsp = bspError(json);
    if (bsp) throw new Error(bsp);

    for (const t of extractTemplateRows(json)) {
      const name = typeof t["name"] === "string" ? t["name"].trim() : "";
      const language = languageCode(t["language"]);
      if (!name || !language) continue;
      const components = t["components"];
      const body = Array.isArray(components)
        ? (components as Array<{ type?: string; text?: string }>).find((c) => (c.type ?? "").toUpperCase() === "BODY")
        : null;
      const bodyText = body?.text ?? "";
      out.push({
        name,
        language,
        status: String(t["status"] ?? "").toUpperCase(),
        category: typeof t["category"] === "string" ? t["category"] : null,
        paramCount: bodyParamCount(components, bodyText),
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
  apiBase?: string | null,
): Promise<{ ok: true; displayPhone: string | null; verifiedName: string | null } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `${resolveApiBase(apiBase)}/${encodeURIComponent(phoneNumberId.trim())}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) },
    );
    const json = (await res.json().catch(() => null)) as {
      display_phone_number?: string; verified_name?: string;
    } | null;
    if (!res.ok) return { ok: false, error: graphError(json, res.status) };
    const bsp = bspError(json);
    if (bsp && !json?.display_phone_number) return { ok: false, error: bsp };
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
  // With a single-variable template, the message content matters more than the
  // business name — otherwise dynamic mid-call messages would be dropped.
  if (paramCount === 1 && ctx.summary) base = [ctx.summary];
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
  apiBase?: string | null;
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
      `${resolveApiBase(opts.apiBase)}/${encodeURIComponent(opts.phoneNumberId.trim())}/messages`,
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
    const bsp = bspError(json);
    if (bsp && !json?.messages?.length) {
      logger.warn({ to, template: opts.template.name, msg: bsp }, "whatsapp-meta: send failed (bsp)");
      return { ok: false, error: bsp };
    }
    return { ok: true, messageId: json?.messages?.[0]?.id ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Resolve the template choice for a hint:
 * 1) hint-specific pick  2) `default`  3) `call_summary`  4) any linked slot.
 */
export function resolveMetaTemplate(
  metaTemplates: Record<string, MetaTemplateChoice | undefined> | null | undefined,
  hint: string,
): MetaTemplateChoice | null {
  if (!metaTemplates || typeof metaTemplates !== "object") return null;
  const pick = (key: string): MetaTemplateChoice | null => {
    const v = metaTemplates[key];
    return v?.name && v.language ? v : null;
  };
  return (
    pick(hint)
    ?? pick("default")
    ?? pick("call_summary")
    // Last resort: any linked template on any slot — sending something beats
    // silently failing when the user only linked e.g. booking_confirmed.
    ?? Object.values(metaTemplates).find((v) => v?.name && v.language) ?? null
  );
}
