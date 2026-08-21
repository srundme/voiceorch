import { useCallback, useMemo } from "react";
import { useSearch, useLocation } from "wouter";

export type DatePreset =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "thisMonth"
  | "lastMonth"
  | "last90"
  | "custom";

export type CompareMode = "none" | "previousPeriod" | "previousMonth" | "previousYear";

export type DateRange = {
  from: Date;
  to: Date;
  preset: DatePreset;
  compare: CompareMode;
  /** Previous period for comparison (same length), when compare !== none */
  compareFrom: Date | null;
  compareTo: Date | null;
  fromParam: string;
  toParam: string;
  setPreset: (preset: DatePreset) => void;
  setCustomRange: (from: string, to: string) => void;
  setCompare: (compare: CompareMode) => void;
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYmd(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function rangeForPreset(preset: DatePreset, now = new Date()): { from: Date; to: Date } {
  const today = startOfDay(now);
  switch (preset) {
    case "today":
      return { from: today, to: endOfDay(today) };
    case "yesterday": {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return { from: y, to: endOfDay(y) };
    }
    case "last7": {
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      return { from, to: endOfDay(today) };
    }
    case "last30": {
      const from = new Date(today);
      from.setDate(from.getDate() - 29);
      return { from, to: endOfDay(today) };
    }
    case "thisMonth": {
      const from = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from, to: endOfDay(today) };
    }
    case "lastMonth": {
      const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const to = endOfDay(new Date(today.getFullYear(), today.getMonth(), 0));
      return { from, to };
    }
    case "last90": {
      const from = new Date(today);
      from.setDate(from.getDate() - 89);
      return { from, to: endOfDay(today) };
    }
    default:
      return { from: new Date(today.getTime() - 29 * 86400000), to: endOfDay(today) };
  }
}

function previousPeriod(from: Date, to: Date): { from: Date; to: Date } {
  const ms = to.getTime() - from.getTime();
  const compareTo = new Date(from.getTime() - 1);
  const compareFrom = new Date(compareTo.getTime() - ms);
  return { from: startOfDay(compareFrom), to: endOfDay(compareTo) };
}

function previousMonthRange(from: Date, to: Date): { from: Date; to: Date } {
  const shift = (d: Date) => new Date(d.getFullYear(), d.getMonth() - 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  return { from: shift(from), to: shift(to) };
}

function previousYearRange(from: Date, to: Date): { from: Date; to: Date } {
  const shift = (d: Date) => new Date(d.getFullYear() - 1, d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  return { from: shift(from), to: shift(to) };
}

export const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last7", label: "Last 7 days" },
  { id: "last30", label: "Last 30 days" },
  { id: "thisMonth", label: "This month" },
  { id: "lastMonth", label: "Last month" },
  { id: "last90", label: "Last 90 days" },
  { id: "custom", label: "Custom" },
];

export const COMPARE_OPTIONS: { id: CompareMode; label: string }[] = [
  { id: "none", label: "No comparison" },
  { id: "previousPeriod", label: "Previous period" },
  { id: "previousMonth", label: "Previous month" },
  { id: "previousYear", label: "Previous year" },
];

/**
 * Date range synced to URL search params: from, to, preset, compare.
 */
export function useDateRange(defaults: { preset?: DatePreset; compare?: CompareMode } = {}): DateRange {
  const search = useSearch();
  const [pathname, setLocation] = useLocation();
  const params = useMemo(() => new URLSearchParams(search.startsWith("?") ? search.slice(1) : search), [search]);

  const presetParam = (params.get("preset") as DatePreset | null) ?? defaults.preset ?? "last30";
  const compare = (params.get("compare") as CompareMode | null) ?? defaults.compare ?? "previousPeriod";
  const fromQ = params.get("from");
  const toQ = params.get("to");

  const { from, to, preset } = useMemo(() => {
    if (presetParam === "custom" || (fromQ && toQ)) {
      const f = fromQ ? parseYmd(fromQ) : null;
      const t = toQ ? parseYmd(toQ) : null;
      if (f && t) {
        return { from: startOfDay(f), to: endOfDay(t), preset: "custom" as DatePreset };
      }
    }
    const p = DATE_PRESETS.some((x) => x.id === presetParam) ? presetParam : "last30";
    const r = rangeForPreset(p === "custom" ? "last30" : p);
    return { from: r.from, to: r.to, preset: p === "custom" ? "last30" : p };
  }, [presetParam, fromQ, toQ]);

  const { compareFrom, compareTo } = useMemo(() => {
    if (compare === "none") return { compareFrom: null, compareTo: null };
    if (compare === "previousMonth") {
      const r = previousMonthRange(from, to);
      return { compareFrom: r.from, compareTo: r.to };
    }
    if (compare === "previousYear") {
      const r = previousYearRange(from, to);
      return { compareFrom: r.from, compareTo: r.to };
    }
    const r = previousPeriod(from, to);
    return { compareFrom: r.from, compareTo: r.to };
  }, [compare, from, to]);

  const write = useCallback(
    (next: { preset?: DatePreset; from?: string; to?: string; compare?: CompareMode }) => {
      const p = new URLSearchParams(params);
      if (next.preset !== undefined) p.set("preset", next.preset);
      if (next.compare !== undefined) p.set("compare", next.compare);
      if (next.from !== undefined) p.set("from", next.from);
      if (next.to !== undefined) p.set("to", next.to);
      if (next.preset && next.preset !== "custom") {
        p.delete("from");
        p.delete("to");
      }
      const qs = p.toString();
      setLocation(qs ? `${pathname}?${qs}` : pathname);
    },
    [params, pathname, setLocation],
  );

  return {
    from,
    to,
    preset,
    compare,
    compareFrom,
    compareTo,
    fromParam: formatYmd(from),
    toParam: formatYmd(to),
    setPreset: (p) => write({ preset: p }),
    setCustomRange: (f, t) => write({ preset: "custom", from: f, to: t }),
    setCompare: (c) => write({ compare: c }),
  };
}

export { formatYmd };
