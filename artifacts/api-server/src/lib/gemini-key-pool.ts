/**
 * Platform Gemini key pool: one primary setting + extra keys.
 * When a key is quota/rate-exhausted, the next unused key is used.
 */

export const GEMINI_PRIMARY_SETTING = "managed_gemini_key";
export const GEMINI_POOL_SETTING = "managed_gemini_keys";
export const MAX_GEMINI_KEYS = 20;
export const GEMINI_EXHAUST_TTL_MS = 15 * 60 * 1000;

export function maskGeminiKey(value: string): string {
  const v = value.trim();
  if (!v) return "";
  return v.length > 8 ? `${v.slice(0, 4)}${"•".repeat(Math.min(v.length - 8, 20))}${v.slice(-4)}` : "••••••••";
}

export function parseGeminiKeyList(
  primary: string | null | undefined,
  extrasJson: string | null | undefined,
  envKey?: string | null,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw?: string | null) => {
    const v = (raw ?? "").trim();
    if (!v || v.includes("•") || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };
  add(primary);
  const extras = extrasJson?.trim();
  if (extras) {
    try {
      const parsed = JSON.parse(extras) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "string") add(item);
        }
      }
    } catch {
      for (const line of extras.split(/[\n,]+/)) add(line);
    }
  }
  add(envKey);
  return out.slice(0, MAX_GEMINI_KEYS);
}

/** Apply admin edits: incoming masked value keeps that existing key; raw key adds/replaces; omitted keys are dropped. */
export function applyGeminiPoolEdits(existing: string[], incoming: string[]): string[] {
  const byMask = new Map(existing.map((k) => [maskGeminiKey(k), k]));
  const next: string[] = [];
  const seen = new Set<string>();
  for (const raw of incoming) {
    const t = (raw ?? "").trim();
    if (!t) continue;
    const value = t.includes("•") ? (byMask.get(t) ?? "") : t;
    if (!value || seen.has(value)) continue;
    seen.add(value);
    next.push(value);
    if (next.length >= MAX_GEMINI_KEYS) break;
  }
  return next;
}

export function splitGeminiPool(keys: string[]): { primary: string; extras: string[] } {
  const unique = parseGeminiKeyList(keys[0] ?? "", JSON.stringify(keys.slice(1)));
  return { primary: unique[0] ?? "", extras: unique.slice(1) };
}

export function isGeminiQuotaError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  if (!msg) return false;
  return (
    /\b429\b/.test(msg)
    || msg.includes("resource_exhausted")
    || msg.includes("resource exhausted")
    || msg.includes("quota")
    || msg.includes("rate limit")
    || msg.includes("too many requests")
    || msg.includes("billing")
  );
}

const exhaustedUntil = new Map<string, number>();

export function markGeminiKeyExhausted(key: string, ttlMs = GEMINI_EXHAUST_TTL_MS, now = Date.now()): void {
  const k = key.trim();
  if (!k) return;
  exhaustedUntil.set(k, now + ttlMs);
}

export function clearGeminiKeyExhaustion(key?: string): void {
  if (key) exhaustedUntil.delete(key.trim());
  else exhaustedUntil.clear();
}

export function pickGeminiKeyFromList(keys: string[], now = Date.now()): string | null {
  const live = keys.filter((k) => k.trim());
  if (live.length === 0) return null;
  for (const k of live) {
    const until = exhaustedUntil.get(k);
    if (until == null || until <= now) return k;
  }
  return live[0]!;
}

export function parseIncomingGeminiPool(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === "string");
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
    } catch {
      /* treat as newline / comma list */
    }
    return raw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  }
  return null;
}

export async function loadStoredGeminiKeys(): Promise<string[]> {
  const { inArray } = await import("drizzle-orm");
  const { db, platformSettingsTable } = await import("@workspace/db");
  const rows = await db
    .select()
    .from(platformSettingsTable)
    .where(inArray(platformSettingsTable.key, [GEMINI_PRIMARY_SETTING, GEMINI_POOL_SETTING]));
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return parseGeminiKeyList(map.get(GEMINI_PRIMARY_SETTING), map.get(GEMINI_POOL_SETTING));
}

export async function loadManagedGeminiKeys(): Promise<string[]> {
  const stored = await loadStoredGeminiKeys();
  return parseGeminiKeyList(
    stored[0],
    JSON.stringify(stored.slice(1)),
    process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_API_KEY"],
  );
}

export async function pickManagedGeminiKey(): Promise<string | null> {
  return pickGeminiKeyFromList(await loadManagedGeminiKeys());
}

export async function saveManagedGeminiPool(keys: string[]): Promise<number> {
  const { eq } = await import("drizzle-orm");
  const { db, platformSettingsTable } = await import("@workspace/db");
  const { primary, extras } = splitGeminiPool(keys);
  if (!primary) {
    await db.delete(platformSettingsTable).where(eq(platformSettingsTable.key, GEMINI_PRIMARY_SETTING));
    await db.delete(platformSettingsTable).where(eq(platformSettingsTable.key, GEMINI_POOL_SETTING));
    return 0;
  }
  await db
    .insert(platformSettingsTable)
    .values({ key: GEMINI_PRIMARY_SETTING, value: primary })
    .onConflictDoUpdate({
      target: platformSettingsTable.key,
      set: { value: primary, updatedAt: new Date() },
    });
  if (extras.length === 0) {
    await db.delete(platformSettingsTable).where(eq(platformSettingsTable.key, GEMINI_POOL_SETTING));
  } else {
    const json = JSON.stringify(extras);
    await db
      .insert(platformSettingsTable)
      .values({ key: GEMINI_POOL_SETTING, value: json })
      .onConflictDoUpdate({
        target: platformSettingsTable.key,
        set: { value: json, updatedAt: new Date() },
      });
  }
  return 1 + extras.length;
}
