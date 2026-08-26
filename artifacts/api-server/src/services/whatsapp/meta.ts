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

export type MetaSlotRole =
  | "name"
  | "doctor"
  | "date"
  | "time"
  | "datetime"
  | "link"
  | "business"
  | "summary"
  | "unknown";

export type MetaParamContext = {
  businessName: string;
  summary: string;
  callerName?: string | null;
  doctor?: string | null;
  date?: string | null;
  time?: string | null;
  meetingTime?: string | null;
  meetLink?: string | null;
  explicitParams?: Array<string | null | undefined> | null;
  bodyPreview?: string | null;
};

const MONTH = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";

export function sanitizeMetaParam(value: unknown): string {
  return (value ?? "—").toString().replace(/[\n\t]+/g, " ").trim() || "—";
}

function cleanParam(value: unknown): string {
  const s = (value ?? "").toString().replace(/[\n\t]+/g, " ").trim();
  if (!s || s === "—" || s === "-" || /^n\/?a$/i.test(s) || /^none$/i.test(s)) return "";
  return s;
}

function namesEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function parseDateTimeParts(raw: string | null | undefined): { date: string; time: string } {
  const s = (raw ?? "").replace(/[\n\t]+/g, " ").trim();
  if (!s) return { date: "", time: "" };
  const dateMatch = s.match(new RegExp(`\\b(\\d{1,2}\\s+(?:${MONTH})\\.?\\s*,?\\s*\\d{4})\\b`, "i"))
    ?? s.match(new RegExp(`\\b((?:${MONTH})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s*\\d{4})\\b`, "i"))
    ?? s.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const timeMatch = s.match(/\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)(?:\s*IST)?)\b/i)
    ?? s.match(/\b(\d{1,2}\s*(?:am|pm)(?:\s*IST)?)\b/i);
  return {
    date: (dateMatch?.[1] ?? "").replace(/,/g, " ").replace(/\s+/g, " ").trim(),
    time: (timeMatch?.[1] ?? "").replace(/\s+/g, " ").trim(),
  };
}

export function looksLikeDateTimeBlob(raw: string): boolean {
  const { date, time } = parseDateTimeParts(raw);
  if (date && time) return true;
  const compact = raw.replace(/[\n\t]+/g, " ").trim();
  return Boolean(date && compact.length <= 48);
}

function classifySlot(left: string, right: string): MetaSlotRole {
  const leftTail = left.replace(/\s+/g, " ").trim();
  const rightHead = right.replace(/\s+/g, " ").trim();

  if (/\b(with|dr\.?|doctor|dentist|physician|specialist|consultant|provider)\s*$/i.test(leftTail)
    || /\bappointment with\s*$/i.test(leftTail)) {
    return "doctor";
  }
  if (/\b(link|join|meet|zoom|url)\b/i.test(leftTail) || /\b(https?:|meet\.|zoom\.us)\b/i.test(rightHead)) {
    return "link";
  }
  if (/\b(vanakkam|namaste|namaskar|hello|hi|hey|dear|good\s+(?:morning|afternoon|evening)|mr\.?|mrs\.?|ms\.?|miss)\s*$/i.test(leftTail)) {
    return "name";
  }
  if (/\bat\s*$/i.test(leftTail)) {
    if (/^\s*on\b/i.test(rightHead)) return "business";
    return "time";
  }
  if (/\b(?:on|dated?)\s*$/i.test(leftTail) || /\bdate\b/i.test(leftTail)) return "date";
  if (/\btime\s*$/i.test(leftTail) || /\b(am|pm|ist|hrs|o'clock)\b/i.test(rightHead)) return "time";
  if (/\b(from|clinic|hospital|centre|center)\s*$/i.test(leftTail)) return "business";
  if (/^\s*,/.test(rightHead) && leftTail.length <= 24) return "name";
  return "unknown";
}

/** Infer {{1}}…{{n}} roles from the approved template body, not from template_hint. */
export function inferTemplateSlotRoles(
  bodyPreview: string | null | undefined,
  paramCount: number,
): MetaSlotRole[] {
  const count = Math.max(0, paramCount);
  const roles: MetaSlotRole[] = Array.from({ length: count }, () => "unknown");
  const text = bodyPreview ?? "";
  if (!text || count === 0) return roles;
  const re = /\{\{\s*(\d+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 1 || n > count) continue;
    roles[n - 1] = classifySlot(
      text.slice(Math.max(0, m.index - 56), m.index),
      text.slice(m.index + m[0].length, m.index + m[0].length + 40),
    );
  }
  return roles;
}

export function catalogBodyPreview(
  catalog: Array<{ name?: string; language?: string; bodyPreview?: string; paramCount?: number }> | null | undefined,
  tpl: { name: string; language: string; paramCount?: number },
): { bodyPreview: string; paramCount: number } {
  const rows = Array.isArray(catalog) ? catalog : [];
  const hit = rows.find((t) => t.name === tpl.name && t.language === tpl.language)
    ?? rows.find((t) => t.name === tpl.name);
  const fromTpl = tpl.paramCount && tpl.paramCount > 0 ? tpl.paramCount : 0;
  const fromHit = hit?.paramCount && hit.paramCount > 0 ? hit.paramCount : 0;
  const fromPreview = (() => {
    const text = hit?.bodyPreview ?? "";
    const nums = new Set<string>();
    for (const m of text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) nums.add(m[1]!);
    return nums.size;
  })();
  return {
    bodyPreview: (hit?.bodyPreview ?? "").trim(),
    paramCount: fromTpl || fromHit || fromPreview,
  };
}

/**
 * Build body params fitted to the template's {{n}} slots.
 * Prefer the template body text (caller / doctor / date / time) over hint-based
 * [agentName, one blob, —, —] padding — that layout garbles multi-variable templates.
 */
export function buildMetaParams(
  hint: string,
  ctx: MetaParamContext,
  paramCount: number,
): string[] {
  const count = Math.max(0, paramCount);
  if (count === 0) return [];

  const roles = inferTemplateSlotRoles(ctx.bodyPreview, count);
  const typed = roles.some((r) => r !== "unknown");
  const businessName = cleanParam(ctx.businessName) || "SnapServe";
  const callerName = cleanParam(ctx.callerName);
  const doctor = cleanParam(ctx.doctor);
  const summary = cleanParam(ctx.summary);
  const meetLink = cleanParam(ctx.meetLink);
  const parsedMeeting = parseDateTimeParts(ctx.meetingTime);
  const parsedSummary = parseDateTimeParts(summary);
  const date = cleanParam(ctx.date) || parsedMeeting.date || parsedSummary.date;
  const time = cleanParam(ctx.time) || parsedMeeting.time || parsedSummary.time;
  const datetime = cleanParam(ctx.meetingTime) || (date && time ? `${date}, ${time}` : date || time);

  const out: string[] = Array.from({ length: count }, () => "");
  const explicit = ctx.explicitParams ?? [];
  for (let i = 0; i < count && i < explicit.length; i++) {
    out[i] = cleanParam(explicit[i]);
  }

  // Old send_whatsapp always stuffed the agent dashboard name into {{1}}.
  if (callerName && out[0] && namesEqual(out[0], businessName) && !namesEqual(out[0], callerName)) {
    out[0] = "";
  }

  const valueFor = (role: MetaSlotRole): string => {
    switch (role) {
      case "name": return callerName;
      case "doctor": return doctor;
      case "date": return date;
      case "time": return time;
      case "datetime": return datetime;
      case "link": return meetLink;
      case "business": return businessName;
      case "summary":
        return summary && !looksLikeDateTimeBlob(summary) ? summary : "";
      default: return "";
    }
  };

  if (typed) {
    for (let i = 0; i < count; i++) {
      const role = roles[i] ?? "unknown";
      if (!out[i]) out[i] = valueFor(role);
      if (role === "name" && callerName && out[i] && namesEqual(out[i]!, businessName)) {
        out[i] = callerName;
      }
      if (role === "doctor" && out[i] && looksLikeDateTimeBlob(out[i]!)) {
        const parsed = parseDateTimeParts(out[i]);
        out[i] = doctor;
        for (let j = 0; j < count; j++) {
          if (roles[j] === "date" && !out[j] && parsed.date) out[j] = parsed.date;
          if (roles[j] === "time" && !out[j] && parsed.time) out[j] = parsed.time;
        }
      }
    }
  } else {
    let base: string[];
    const appointmentShaped = count >= 4 && !meetLink && Boolean(callerName || doctor || date || time);
    if (appointmentShaped) {
      // Custom clinic templates are usually caller / doctor / date / time, even
      // when the template body wasn't cached on the connection.
      base = [callerName, doctor, date, time];
    } else if (hint === "booking_confirmed") {
      base = [businessName, datetime, meetLink, summary];
    } else if (hint === "callback_scheduled") {
      base = [businessName, summary || "Our team will call you back soon."];
    } else {
      base = [businessName, summary || "Thanks for speaking with us — we'll be in touch."];
    }
    if (count === 1 && summary) base = [summary];
    for (let i = 0; i < count; i++) {
      if (!out[i]) out[i] = cleanParam(base[i]);
    }
  }

  if (count === 1 && summary && (!out[0] || namesEqual(out[0]!, businessName))) {
    out[0] = summary;
  }

  return out.map(sanitizeMetaParam);
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
