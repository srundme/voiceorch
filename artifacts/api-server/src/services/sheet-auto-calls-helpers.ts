/**
 * Automatic Calls sheet-row parsing and UX helpers.
 */

import { extractPhoneCandidates } from "./google-sheets-helpers.js";
import { normalizePhone } from "../lib/phone-normalize.js";
import { formatDispositionLabel } from "../lib/disposition-match.js";
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
  if (s === "dialing" || s === "calling" || s === "ringing") return "Calling";
  if (s === "connected" || s === "in_progress" || s === "in-progress") return "Connected";
  if (s === "completed" || s === "done" || s === "success") return "Completed";
  if (s === "no_answer" || s === "no-answer" || s === "no answer" || s === "unanswered") return "No answer";
  if (s === "busy") return "Busy";
  if (s === "voicemail" || s === "machine") return "Voicemail";
  if (s === "failed" || s === "error" || s === "cancelled" || s === "canceled") return "Failed";
  if (s === "skipped") return "Skipped";
  return "Completed";
}

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
  // Summary / transcript sentences stay in the Summary column, not Disposition.
  if (t.length > 80 || /[.!?]/.test(t)) return "";
  return t;
}

/**
 * Same short label SnapServe stores on the lead (`PRIMARY: sub`).
 * Never writes taxonomy JSON or the summary paragraph.
 */
export function formatSheetDisposition(disp: unknown): string {
  if (disp == null) return "";
  const obj = parseDispositionObject(disp);
  if (obj) return formatDispositionLabel(obj);
  if (typeof disp === "string") return shortSheetLabel(disp);
  return "";
}

/**
 * Status is telephony state only: Queued, Calling, Connected, Busy, Failed,
 * Completed (plus No answer / Voicemail / Skipped). Never Callback / Booked.
 *
 * Voicemail: prefer call.status === "voicemail", else promote when AMD said
 * machine or disposition is voicemail (call often stays "completed" if AMD
 * action is continue / message path did not latch voicemailActionExecuted).
 */
export function looksLikeVoicemailOutcome(
  dispositionLabel?: string | null,
  dispositionRaw?: unknown,
  amdResult?: string | null,
): boolean {
  const amd = (amdResult ?? "").trim().toLowerCase();
  if (amd === "machine" || amd === "voicemail") return true;

  const label = (dispositionLabel ?? "").trim().toLowerCase();
  if (/(^|[:\s/|-])voicemail\b/.test(label) || /\bmachine\b/.test(label)) return true;

  const obj = parseDispositionObject(dispositionRaw);
  if (obj) {
    for (const key of ["sub", "primary", "OUTCOME", "outcome", "status", "disposition"]) {
      const v = obj[key];
      if (typeof v !== "string") continue;
      const s = v.trim().toLowerCase();
      if (s === "voicemail" || s === "machine" || s.includes("voicemail")) return true;
    }
  }
  return false;
}

export function resolveSheetStatusLabel(
  callStatus: string | null | undefined,
  dispositionLabel?: string | null,
  _reservedStatus?: string | null,
  opts?: { dispositionRaw?: unknown; amdResult?: string | null },
): string {
  const operational = friendlySheetStatus(callStatus);
  if (operational === "Voicemail") return "Voicemail";
  // Soft terminals only — don't override Busy / Failed / No answer / Calling.
  if (
    (operational === "Completed" || operational === "Connected")
    && looksLikeVoicemailOutcome(dispositionLabel, opts?.dispositionRaw, opts?.amdResult)
  ) {
    return "Voicemail";
  }
  return operational;
}

export function googleSheetUrl(spreadsheetId: string, gid?: number | null): string {
  const base = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  return gid != null ? `${base}#gid=${gid}` : base;
}
