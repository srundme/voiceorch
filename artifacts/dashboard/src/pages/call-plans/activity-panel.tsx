/**
 * Call plan activity — campaign-style progress + call log for one plan.
 * Uses GET /journeys/:id/runs (poll) and CallDetailDrawer for History.
 */

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { formatDistanceToNow, format, parseISO } from "date-fns";
import {
  Activity, Phone, CheckCircle2, XCircle, Clock, Search, RefreshCw, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CallDetailDrawer } from "@/components/call-detail-drawer";
import { cn } from "@/lib/utils";
import type { CallPlanStep } from "./step-editor";

export type PlanRun = {
  id: number;
  status: string;
  context: Record<string, unknown> | null;
  currentStepIndex: number;
  leadId?: number | null;
  callId?: number | null;
  error: string | null;
  triggeredBy: string | null;
  resumeAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type RunFilter =
  | "all"
  | "in_progress"
  | "waiting"
  | "completed"
  | "failed"
  | "with_call";

type CallCtx = {
  connected?: boolean;
  status?: string;
  duration?: number;
  transcript?: string;
  summary?: string;
  disposition?: string;
  callId?: number;
};

function statusClass(status: string) {
  if (status === "completed") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-400";
  }
  if (
    status === "pending" ||
    status === "waiting_call" ||
    status === "waiting_delay" ||
    status === "running"
  ) {
    return "border-amber-500/25 bg-amber-500/10 text-amber-400";
  }
  if (status === "failed" || status === "cancelled") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }
  return "border-border/50 bg-muted/30 text-muted-foreground";
}

function personName(ctx: Record<string, unknown> | null): string {
  if (!ctx) return "—";
  const name = typeof ctx.name === "string" ? ctx.name.trim() : "";
  return name || "—";
}

function personPhone(ctx: Record<string, unknown> | null): string {
  if (!ctx) return "";
  return typeof ctx.phone === "string" ? ctx.phone : "";
}

function callFromContext(ctx: Record<string, unknown> | null): CallCtx | null {
  if (!ctx || typeof ctx.call !== "object" || ctx.call === null) return null;
  return ctx.call as CallCtx;
}

function resolveCallId(run: PlanRun): number | null {
  if (typeof run.callId === "number" && run.callId > 0) return run.callId;
  const c = callFromContext(run.context);
  if (typeof c?.callId === "number" && c.callId > 0) return c.callId;
  return null;
}

function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = parseISO(iso);
    return `${format(d, "dd MMM HH:mm")} · ${formatDistanceToNow(d, { addSuffix: true })}`;
  } catch {
    return iso;
  }
}

function isInProgress(status: string) {
  return status === "running" || status === "pending";
}

function isWaiting(status: string) {
  return status === "waiting_call" || status === "waiting_delay";
}

const FILTERS: { id: RunFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "in_progress", label: "In progress" },
  { id: "waiting", label: "Waiting" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
  { id: "with_call", label: "Has call" },
];

export function CallPlanActivityPanel({
  runs,
  steps,
  totalRuns,
  loading,
  refreshing,
  onRefresh,
}: {
  runs: PlanRun[];
  steps: CallPlanStep[];
  totalRuns?: number;
  loading?: boolean;
  refreshing?: boolean;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState<RunFilter>("all");
  const [search, setSearch] = useState("");
  const [drawerCallId, setDrawerCallId] = useState<number | null>(null);
  const [drawerIndex, setDrawerIndex] = useState(0);

  const kpis = useMemo(() => {
    const started = runs.length;
    const inProgress = runs.filter((r) => isInProgress(r.status) || isWaiting(r.status)).length;
    const completed = runs.filter((r) => r.status === "completed").length;
    const failed = runs.filter((r) => r.status === "failed").length;
    const withCall = runs.filter((r) => resolveCallId(r) != null).length;
    return { started, inProgress, completed, failed, withCall };
  }, [runs]);

  const filtered = useMemo(() => {
    let rows = runs;
    if (filter === "in_progress") {
      rows = rows.filter((r) => isInProgress(r.status) || isWaiting(r.status));
    } else if (filter === "waiting") {
      rows = rows.filter((r) => isWaiting(r.status));
    }
    else if (filter === "completed") rows = rows.filter((r) => r.status === "completed");
    else if (filter === "failed") rows = rows.filter((r) => r.status === "failed");
    else if (filter === "with_call") rows = rows.filter((r) => resolveCallId(r) != null);

    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => {
        const name = personName(r.context).toLowerCase();
        const phone = personPhone(r.context).toLowerCase();
        return name.includes(q) || phone.includes(q) || String(r.id).includes(q);
      });
    }
    return rows;
  }, [runs, filter, search]);

  const callRows = useMemo(
    () => filtered.map((r, i) => ({ run: r, callId: resolveCallId(r), index: i })).filter((x) => x.callId != null),
    [filtered],
  );

  function openCall(run: PlanRun) {
    const callId = resolveCallId(run);
    if (callId == null) return;
    const idx = callRows.findIndex((x) => x.callId === callId);
    setDrawerIndex(idx >= 0 ? idx : 0);
    setDrawerCallId(callId);
  }

  function navigateDrawer(delta: number) {
    if (callRows.length === 0) return;
    const next = Math.max(0, Math.min(callRows.length - 1, drawerIndex + delta));
    setDrawerIndex(next);
    setDrawerCallId(callRows[next]!.callId!);
  }

  const kpiCards = [
    { key: "all" as RunFilter, label: "Started", value: kpis.started, icon: Activity, accent: "text-foreground" },
    { key: "in_progress" as RunFilter, label: "In progress", value: kpis.inProgress, icon: Clock, accent: "text-amber-400" },
    { key: "completed" as RunFilter, label: "Completed", value: kpis.completed, icon: CheckCircle2, accent: "text-emerald-400" },
    { key: "failed" as RunFilter, label: "Failed", value: kpis.failed, icon: XCircle, accent: "text-destructive" },
    { key: "with_call" as RunFilter, label: "Calls logged", value: kpis.withCall, icon: Phone, accent: "text-sky-400" },
  ];

  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card/40">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/50 px-4 py-3 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold">Activity &amp; call log</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Live progress for everyone walking this plan
            {typeof totalRuns === "number" && totalRuns > runs.length
              ? ` · showing latest ${runs.length} of ${totalRuns}`
              : ""}
            . Open a row to see the full call.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-[11px]"
          onClick={onRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2 border-b border-border/40 p-3 sm:grid-cols-5 sm:px-4">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          const active = filter === card.key || (card.key === "all" && filter === "all");
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => setFilter(card.key)}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-left transition-colors",
                active
                  ? "border-primary/40 bg-primary/5"
                  : "border-border/50 bg-muted/10 hover:bg-muted/25",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{card.label}</span>
                <Icon className={cn("h-3.5 w-3.5", card.accent)} />
              </div>
              <p className={cn("mt-1 text-lg font-semibold tabular-nums", card.accent)}>
                {loading ? "—" : card.value}
              </p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2.5 sm:px-4">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "h-7 rounded-md px-2.5 text-[11px] transition-colors",
                filter === f.id
                  ? "bg-foreground text-background font-medium"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto min-w-[160px] max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
          <Input
            className="h-8 pl-8 text-xs"
            placeholder="Search name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="text-[10px] tabular-nums text-muted-foreground/50">
          {filtered.length} shown
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <div className="hidden min-w-[720px] grid-cols-[minmax(140px,1.4fr)_90px_110px_88px_72px_minmax(120px,1fr)_72px] items-center gap-2 border-b border-border/40 bg-muted/20 px-4 py-2 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/50 md:grid">
          <span>Person</span>
          <span>Step</span>
          <span>Status</span>
          <span>Call</span>
          <span>Duration</span>
          <span>Updated</span>
          <span />
        </div>

        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-muted/40" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 px-6 py-12 text-center">
            <Activity className="h-6 w-6 text-muted-foreground/30" />
            <p className="text-[13px] font-medium text-foreground/80">
              {runs.length === 0 ? "Nothing started yet" : "No rows match this filter"}
            </p>
            <p className="max-w-sm text-[11px] text-muted-foreground leading-relaxed">
              {runs.length === 0
                ? "Press Start once. Each person walking this plan shows here with step progress, call outcome, and a link to the full History record."
                : "Clear search or pick another status tab."}
            </p>
          </div>
        ) : (
          <ul className="min-w-[720px] divide-y divide-border/40">
            {filtered.map((run) => {
              const stepN = Math.min(run.currentStepIndex + 1, Math.max(steps.length, 1));
              const stepLabel = steps[run.currentStepIndex]?.type?.replace(/_/g, " ");
              const call = callFromContext(run.context);
              const callId = resolveCallId(run);
              const phone = personPhone(run.context);
              const duration = typeof call?.duration === "number" ? call.duration : null;
              const outcome =
                call?.summary?.trim() ||
                call?.disposition?.trim() ||
                (call?.connected === true ? "Connected" : call?.connected === false ? "No connect" : null) ||
                run.error;

              return (
                <li
                  key={run.id}
                  className={cn(
                    "grid grid-cols-1 gap-2 px-4 py-3 text-[12px] transition-colors md:grid-cols-[minmax(140px,1.4fr)_90px_110px_88px_72px_minmax(120px,1fr)_72px] md:items-center md:gap-2",
                    callId != null ? "cursor-pointer hover:bg-muted/25" : "hover:bg-muted/10",
                  )}
                  onClick={() => { if (callId != null) openCall(run); }}
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{personName(run.context)}</p>
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                      {phone || `Run #${run.id}`}
                      {run.triggeredBy ? ` · ${run.triggeredBy.replace(/_/g, " ")}` : ""}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="tabular-nums text-[11px]">
                      {stepN}/{Math.max(steps.length, 1)}
                    </p>
                    {stepLabel && (
                      <p className="text-[10px] text-muted-foreground capitalize truncate">{stepLabel}</p>
                    )}
                    {run.status === "waiting_delay" && run.resumeAt && (
                      <p className="text-[10px] text-amber-400/80 truncate">
                        resumes {formatTs(run.resumeAt)}
                      </p>
                    )}
                  </div>
                  <div>
                    <Badge
                      variant="outline"
                      className={cn("text-[10px] h-5 px-1.5 capitalize", statusClass(run.status))}
                    >
                      {run.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <div className="min-w-0 text-[11px]">
                    {callId != null ? (
                      <span className="font-mono text-sky-400/90">#{callId}</span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </div>
                  <div className="tabular-nums text-[11px] text-muted-foreground">
                    {formatDuration(duration)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground truncate">{formatTs(run.updatedAt)}</p>
                    {outcome && (
                      <p className="text-[10px] text-muted-foreground/70 truncate mt-0.5" title={outcome}>
                        {outcome}
                      </p>
                    )}
                  </div>
                  <div className="flex justify-end">
                    {callId != null ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-[10px]"
                        onClick={(e) => {
                          e.stopPropagation();
                          openCall(run);
                        }}
                      >
                        Open <ExternalLink className="h-3 w-3" />
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 px-4 py-2.5">
        <p className="text-[10px] text-muted-foreground">
          Full transcripts and recordings open in the call drawer, or browse{" "}
          <Link href="/app/history" className="underline underline-offset-2">History</Link>.
        </p>
      </div>

      <CallDetailDrawer
        open={drawerCallId != null}
        onClose={() => setDrawerCallId(null)}
        callId={drawerCallId}
        currentIndex={drawerIndex}
        totalCount={callRows.length}
        onPrev={drawerIndex > 0 ? () => navigateDrawer(-1) : undefined}
        onNext={drawerIndex < callRows.length - 1 ? () => navigateDrawer(1) : undefined}
      />
    </section>
  );
}
