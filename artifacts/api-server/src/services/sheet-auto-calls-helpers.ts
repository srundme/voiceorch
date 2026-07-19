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
