/**
 * Canonical status/outcome color token map shared across all Campaign badge components.
 * Pending=Gray, Calling=Blue, Connected=Cyan, Interested=Orange, Booked=Green,
 * Callback=Yellow, Transferred=Purple, Failed=Red, Busy=Slate, No Contact=Neutral Gray
 */

export type StatusCfg = { label: string; cls: string };

export const CAMPAIGN_STATUS_MAP: Record<string, StatusCfg> = {
  draft:     { label: "Draft",     cls: "bg-muted/50 text-muted-foreground border-border" },
  active:    { label: "Active",    cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
  paused:    { label: "Paused",    cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" },
  completed: { label: "Completed", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
  stopped:   { label: "Stopped",   cls: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" },
};

export const BATCH_STATUS_MAP: Record<string, StatusCfg> = {
  draft:     { label: "Draft",     cls: "bg-muted/50 text-muted-foreground border-border" },
  running:   { label: "Running",   cls: "bg-sky-500/10 text-sky-600 border-sky-500/30" },
  paused:    { label: "Paused",    cls: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  completed: { label: "Completed", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
  stopped:   { label: "Stopped",   cls: "bg-red-500/10 text-red-500 border-red-500/30" },
};

export const CALL_STATUS_MAP: Record<string, StatusCfg> = {
  pending:   { label: "Pending",   cls: "bg-muted/50 text-muted-foreground border-border" },
  calling:   { label: "Calling",   cls: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  connected: { label: "Connected", cls: "bg-cyan-500/10 text-cyan-600 border-cyan-500/20" },
  completed: { label: "Completed", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  failed:    { label: "Failed",    cls: "bg-red-500/10 text-red-500 border-red-500/20" },
  busy:      { label: "Busy",      cls: "bg-slate-500/10 text-slate-500 border-slate-500/20" },
  skipped:   { label: "Skipped",   cls: "bg-muted/30 text-muted-foreground/60 border-border" },
};

export const OUTCOME_MAP: Record<string, { label: string; color: string }> = {
  pending:              { label: "Pending",     color: "text-muted-foreground/50" },
  booking_created:      { label: "Booked",      color: "text-emerald-500" },
  transfer_completed:   { label: "Transferred", color: "text-purple-500" },
  callback_requested:   { label: "Callback",    color: "text-amber-500" },
  interest_confirmed:   { label: "Interested",  color: "text-orange-500" },
  no_contact:           { label: "No Contact",  color: "text-muted-foreground/60" },
  dnc_blocked:          { label: "DNC",         color: "text-red-400" },
  failed:               { label: "Failed",      color: "text-red-500" },
};

export function callStatusCfg(status: string): StatusCfg {
  return CALL_STATUS_MAP[status] ?? { label: status, cls: "bg-muted/50 text-muted-foreground border-border" };
}

export function outcomeCfg(outcome: string): { label: string; color: string } {
  return OUTCOME_MAP[outcome] ?? { label: outcome.replace(/_/g, " "), color: "text-muted-foreground/50" };
}
