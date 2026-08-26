/**
 * Automatic Calls sheet-row parsing and UX helpers.
 */

import { extractPhoneCandidates } from "./google-sheets-helpers.js";
import { normalizePhone } from "../lib/phone-normalize.js";
import type { SheetAutoColumnMap } from "@workspace/db";

function headerIndex(headers: string[], name: string | undefined): number {
  if (!name?.trim()) return -1;
  const want = name.trim().toLowerCase();
  return headers.findIndex((h) => h.toLowerCase() === want);
}

function cellAt(row: string[], headers: string[], headerName: string | undefined): string {
  const idx = headerIndex(headers, headerName);
  if (idx < 0) return "";
  return (row[idx] ?? "").trim();
}

/** Parse a sheet data row into phone + lead fields. */
export function parseSheetLeadRow(
  headers: string[],
  row: string[],
  columnMap: SheetAutoColumnMap,
): { phoneRaw: string; phoneNormalized: string | null; name: string; email: string; leadData: Record<string, string> } {
  const phoneRaw = cellAt(row, headers, columnMap.phone);
  const candidates = extractPhoneCandidates(phoneRaw);
  const primary = candidates[0] ?? phoneRaw.replace(/\D/g, "");
  const phoneNormalized = primary.length >= 8 ? normalizePhone(primary) : null;

  const name = cellAt(row, headers, columnMap.name) || "";
  const email = cellAt(row, headers, columnMap.email) || "";
  const leadData: Record<string, string> = {};
  for (const [key, header] of Object.entries(columnMap)) {
    if (!header || typeof header !== "string" || key === "phone" || key === "name" || key === "email") continue;
    const v = cellAt(row, headers, header);
    if (v) leadData[key] = v;
  }
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (!h) continue;
    const v = (row[i] ?? "").trim();
    if (!v) continue;
    const slug = h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (slug && !(slug in leadData) && slug !== "phone" && slug !== "name" && slug !== "email") {
      leadData[slug] = v;
    }
  }
  if (name) leadData["name"] = name;
  if (email) leadData["email"] = email;
  if (phoneRaw) leadData["phone"] = phoneRaw;

  return { phoneRaw, phoneNormalized, name, email, leadData };
}

/** Fuzzy-match common India / CRM header names → columnMap. */
export function fuzzyDetectColumnMap(headers: string[]): SheetAutoColumnMap {
  const find = (...patterns: RegExp[]): string | undefined => {
    for (const re of patterns) {
      const hit = headers.find((h) => re.test(h.trim()));
      if (hit) return hit;
    }
    return undefined;
  };

  const phone =
    find(
      /^phone(\s*number)?$/i,
      /^mobile(\s*(no|number|num))?$/i,
      /^whatsapp$/i,
      /contact\s*(no|number|phone)?/i,
      /phone/i,
      /mobile/i,
    ) ?? headers[0] ?? "Phone";

  const name = find(
    /^name$/i,
    /^caller\s*name$/i,
    /^customer\s*name$/i,
    /^full\s*name$/i,
    /^contact\s*name$/i,
    /name/i,
  );

  const email = find(/^e-?mail$/i, /email/i);

  return {
    phone,
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
  };
}

const TRUTHY_SKIP = new Set([
  "yes", "y", "true", "1", "skip", "do not call", "dnc", "x", "✓", "✔",
]);

/** True when Do Not Call / Skip cell opts the row out of dialing. */
export function isDoNotDialValue(raw: string | null | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return false;
  return TRUTHY_SKIP.has(v);
}

/** Resolve Do Not Call / Skip column header from map or sheet headers. */
export function resolveDoNotDialHeader(
  headers: string[],
  columnMap: SheetAutoColumnMap,
): string | undefined {
  const mapped = columnMap["doNotCall"] || columnMap["skip"] || columnMap["do_not_call"];
  if (mapped && headers.some((h) => h.toLowerCase() === mapped.toLowerCase())) return mapped;
  return headers.find((h) =>
    /^(do\s*not\s*call|dnc|skip|don'?t\s*call)$/i.test(h.trim()),
  );
}

/** True when Status cell requests a re-dial. */
export function isRetryStatus(raw: string | null | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "retry" || v === "redial" || v === "re-dial" || v === "call again";
}

/**
 * Human-readable Status values written into the sheet.
 * Maps internal call/pipeline statuses to operator-friendly labels.
 */
export function friendlySheetStatus(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return "Completed";
  if (s === "enqueued" || s === "pending" || s === "queued") return "Queued";
  if (s === "dialing" || s === "calling" || s === "ringing" || s === "connected") return "Calling";
  if (s === "completed" || s === "done" || s === "success") return "Completed";
  if (s === "no_answer" || s === "no-answer" || s === "no answer" || s === "unanswered") return "No answer";
  if (s === "busy") return "Busy";
  if (s === "voicemail" || s === "machine") return "Voicemail";
  if (s === "failed" || s === "error" || s === "cancelled" || s === "canceled") return "Failed";
  if (s === "skipped") return "Skipped";
  // Preserve title-ish custom dispositions already written by the agent
  if (s.length <= 40 && !/[_-]/.test(s)) {
    return raw!.trim().replace(/^\w/, (c) => c.toUpperCase());
  }
  return raw!.trim();
}

const GENERIC_OUTCOME_KEYS = new Set([
  "outcome", "status", "disposition", "result", "intent", "label", "primary", "sub",
]);

function parseDispositionObject(disp: unknown): Record<string, unknown> | null {
  if (disp == null) return null;
  if (typeof disp === "string") {
    const t = disp.trim();
    if (!t.startsWith("{")) return null;
    try {
      const parsed = JSON.parse(t) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
    return null;
  }
  if (typeof disp === "object" && !Array.isArray(disp)) return disp as Record<string, unknown>;
  return null;
}

function shortSheetLabel(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return "";
  if (t.startsWith("{") || t.startsWith("[")) return "";
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

/**
 * Human label for the Disposition column. Never dumps taxonomy JSON.
 * Prefers `sub` ("Wrong number") over PRIMARY: sub ("OUTCOME: Wrong number").
 */
export function formatSheetDisposition(disp: unknown): string {
  if (disp == null) return "";
  if (typeof disp === "string") {
    const obj = parseDispositionObject(disp);
    if (obj) return formatSheetDisposition(obj);
    return shortSheetLabel(disp);
  }
  const obj = parseDispositionObject(disp);
  if (!obj) return shortSheetLabel(String(disp));

  const sub = typeof obj["sub"] === "string" ? shortSheetLabel(obj["sub"]) : "";
  if (sub) return sub;

  for (const k of ["OUTCOME", "outcome", "disposition", "result", "intent", "label", "status"]) {
    const v = obj[k];
    if (typeof v !== "string") continue;
    const label = shortSheetLabel(v);
    if (!label) continue;
    if (GENERIC_OUTCOME_KEYS.has(label.toLowerCase())) continue;
    return label;
  }

  const primary = typeof obj["primary"] === "string" ? shortSheetLabel(obj["primary"]) : "";
  if (primary && !GENERIC_OUTCOME_KEYS.has(primary.toLowerCase())) return primary;
  return "";
}

/**
 * Status is call state only. Disposition is the outcome (see formatSheetDisposition).
 * Reserved values: Booked, Callback scheduled. Never copy the outcome into Status.
 */
export function resolveSheetStatusLabel(
  callStatus: string | null | undefined,
  _dispositionLabel?: string,
  reservedStatus?: string | null,
): string {
  if (reservedStatus?.trim()) return reservedStatus.trim();
  return friendlySheetStatus(callStatus);
}

export function googleSheetUrl(spreadsheetId: string, gid?: number | null): string {
  const base = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  return gid != null ? `${base}#gid=${gid}` : base;
}
