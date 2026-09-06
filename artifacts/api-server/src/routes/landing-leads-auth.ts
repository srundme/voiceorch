import { timingSafeEqual } from "node:crypto";

export function parseLeadsNotifyEmails(raw: string | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (raw ?? "").split(/[,;\s]+/)) {
    const email = part.trim().toLowerCase();
    if (!email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

export function extractLeadsApiKey(req: {
  headers: Record<string, unknown>;
}): string {
  const headerKey = String(
    req.headers["x-api-key"]
    ?? req.headers["x-leads-api-key"]
    ?? "",
  ).trim();
  if (headerKey) return headerKey;
  const auth = String(req.headers["authorization"] ?? "").trim();
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m?.[1]?.trim() ?? "";
}

export function leadsApiKeyMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
