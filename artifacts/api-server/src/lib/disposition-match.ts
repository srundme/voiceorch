/**
 * Shared disposition matching for lead transfer, meaning maps, and after-call branches.
 */

export function dispositionCandidates(
  dispositionResult: Record<string, unknown> | null | undefined,
  legacyLabel?: string | null,
): Set<string> {
  const candidates = new Set<string>();
  if (legacyLabel?.trim()) candidates.add(legacyLabel.trim().toLowerCase());
  if (!dispositionResult || typeof dispositionResult !== "object") return candidates;

  const primary =
    typeof dispositionResult["primary"] === "string" ? dispositionResult["primary"].trim() : "";
  const sub = typeof dispositionResult["sub"] === "string" ? dispositionResult["sub"].trim() : "";
  if (primary) {
    candidates.add(primary.toLowerCase());
    if (sub) {
      candidates.add(sub.toLowerCase());
      candidates.add(`${primary}:${sub}`.toLowerCase());
      candidates.add(`${primary}: ${sub}`.toLowerCase());
    }
  }
  for (const [k, v] of Object.entries(dispositionResult)) {
    if (typeof v === "string" && v.trim()) {
      candidates.add(v.trim().toLowerCase());
      candidates.add(`${k}:${v.trim()}`.toLowerCase());
    }
  }
  return candidates;
}

export function dispositionMatchesAny(
  dispositionResult: Record<string, unknown> | null | undefined,
  selected: string[],
  legacyLabel?: string | null,
): boolean {
  if (!selected.length) return false;
  const needles = selected.map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!needles.length) return false;
  const candidates = dispositionCandidates(dispositionResult, legacyLabel);
  return needles.some((n) => candidates.has(n));
}

export function formatDispositionLabel(disp: Record<string, unknown> | null | undefined): string {
  if (!disp) return "";
  const primary = typeof disp["primary"] === "string" ? disp["primary"] : "";
  const sub = typeof disp["sub"] === "string" ? disp["sub"] : "";
  if (primary && sub) return `${primary}: ${sub}`;
  if (primary) return primary;
  try {
    return JSON.stringify(disp).slice(0, 200);
  } catch {
    return "";
  }
}

/** Flatten taxonomy into selectable keys: primary + primary:sub. */
export function taxonomyDispositionKeys(taxonomy: Record<string, string[]> | null | undefined): string[] {
  if (!taxonomy) return [];
  const out: string[] = [];
  for (const [primary, subs] of Object.entries(taxonomy)) {
    out.push(primary);
    for (const sub of subs ?? []) {
      if (sub && sub !== primary) out.push(`${primary}:${sub}`);
    }
  }
  return out;
}
