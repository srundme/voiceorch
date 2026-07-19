import type { SheetUseCase } from "@workspace/db";

/** SnapServe field → sheet header defaults when binding.columnMap is empty. */
export const DEFAULT_COLUMN_MAPS: Record<"call_log" | "outcome" | "lookup", Record<string, string>> = {
  call_log: {
    callId: "Call ID",
    startedAt: "Started At (IST)",
    durationSeconds: "Duration (sec)",
    direction: "Direction",
    phone: "Phone",
    callerName: "Caller Name",
    disposition: "Disposition",
    summary: "Summary",
    recordingUrl: "Recording",
    agentName: "Agent",
    costCents: "Cost (₹)",
  },
  outcome: {
    phone: "Phone",
    name: "Name",
    email: "Email",
    status: "Status",
    lastCallAt: "Last Call At",
    disposition: "Disposition",
    notes: "Notes",
    nextFollowUp: "Next Follow-up",
  },
  lookup: {
    phone: "Phone",
    name: "Name",
    email: "Email",
    status: "Status",
    notes: "Notes",
  },
};

export function defaultColumnMapForUseCase(useCase: SheetUseCase): Record<string, string> {
  if (useCase === "call_log") return { ...DEFAULT_COLUMN_MAPS.call_log };
  if (useCase === "outcome" || useCase === "lookup") return { ...DEFAULT_COLUMN_MAPS.outcome };
  return {};
}

/** Digits-only phone compare; also matches on last 10 digits (India mobile). */
export function phonesMatch(a: string, b: string): boolean {
  const da = a.replace(/\D/g, "");
  const db = b.replace(/\D/g, "");
  if (!da || !db) return false;
  if (da === db) return true;
  const la = da.slice(-10);
  const lb = db.slice(-10);
  return la.length === 10 && lb.length === 10 && la === lb;
}

export function escapeSheetName(name: string): string {
  if (/['\s!]/.test(name)) {
    return `'${name.replace(/'/g, "''")}'`;
  }
  return name;
}

export function sheetRange(sheetName: string, a1: string): string {
  return `${escapeSheetName(sheetName)}!${a1}`;
}
