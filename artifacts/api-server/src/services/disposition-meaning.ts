/**
 * Agent disposition → SnapServe funnel meaning (Interested / Callback / DNC).
 */
import { eq } from "drizzle-orm";
import {
  db,
  agentDispositionsTable,
  type DispositionMeaningMap,
  EMPTY_MEANING_MAP,
} from "@workspace/db";
import { dispositionMatchesAny, formatDispositionLabel } from "../lib/disposition-match.js";

export type DispositionMeaning = "interested" | "callback" | "dnc";

export function parseMeaningMap(raw: unknown): DispositionMeaningMap {
  if (!raw || typeof raw !== "object") return { ...EMPTY_MEANING_MAP };
  const o = raw as Record<string, unknown>;
  const pick = (k: string): string[] =>
    Array.isArray(o[k])
      ? o[k]
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((x) => x.trim())
      : [];
  return {
    interested: pick("interested"),
    callback: pick("callback"),
    dnc: pick("dnc"),
  };
}

export function normalizeMeaningMapInput(raw: unknown): DispositionMeaningMap | null {
  if (raw === null || raw === undefined) return null;
  return parseMeaningMap(raw);
}

/** Priority: dnc > callback > interested. */
export function resolveDispositionMeaning(
  dispositionResult: Record<string, unknown> | null | undefined,
  map: DispositionMeaningMap | null | undefined,
  legacyLabel?: string | null,
): DispositionMeaning | null {
  if (!map) return null;
  if (map.dnc.length && dispositionMatchesAny(dispositionResult, map.dnc, legacyLabel)) {
    return "dnc";
  }
  if (map.callback.length && dispositionMatchesAny(dispositionResult, map.callback, legacyLabel)) {
    return "callback";
  }
  if (
    map.interested.length &&
    dispositionMatchesAny(dispositionResult, map.interested, legacyLabel)
  ) {
    return "interested";
  }
  return null;
}

export async function loadAgentMeaningMap(agentId: number): Promise<DispositionMeaningMap | null> {
  const [row] = await db
    .select({ meaningMap: agentDispositionsTable.meaningMap })
    .from(agentDispositionsTable)
    .where(eq(agentDispositionsTable.agentId, agentId))
    .limit(1);
  if (!row?.meaningMap) return null;
  return parseMeaningMap(row.meaningMap);
}

/**
 * Build the disposition string used for lead.disposition + operational matching.
 * Prefers taxonomy primary:sub label.
 */
export function dispositionLabelForLead(
  dispositionResult: Record<string, unknown> | null | undefined,
): string {
  return formatDispositionLabel(dispositionResult).slice(0, 200);
}

/**
 * Merge meaning map into positive-disposition set for computeOperationalOutcome.
 * Also returns flags for callback/dnc when the map matches.
 */
export function meaningFlagsForOutcome(
  dispositionResult: Record<string, unknown> | null | undefined,
  map: DispositionMeaningMap | null | undefined,
  legacyLabel?: string | null,
): {
  meaning: DispositionMeaning | null;
  positiveDispositions: Set<string>;
  isDncFromMeaning: boolean;
  isCallbackFromMeaning: boolean;
} {
  const meaning = resolveDispositionMeaning(dispositionResult, map, legacyLabel);
  const label = (legacyLabel || dispositionLabelForLead(dispositionResult)).toLowerCase();
  const positive = new Set<string>();
  if (meaning === "interested" && label) positive.add(label);
  // Also allow raw map tokens as positive set members for simple string matching
  if (map?.interested) {
    for (const t of map.interested) positive.add(t.toLowerCase());
  }
  return {
    meaning,
    positiveDispositions: positive,
    isDncFromMeaning: meaning === "dnc",
    isCallbackFromMeaning: meaning === "callback",
  };
}
