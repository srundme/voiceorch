/**
 * Call plan activity — campaign-style progress + call log for one plan.
 * Fetches paginated GET /journeys/:id/runs + /runs/stats (poll while open).
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, format, parseISO } from "date-fns";
import {
  Activity, Phone, CheckCircle2, XCircle, Clock, Search, RefreshCw, ExternalLink, Download,
  ChevronLeft, ChevronRight, ArrowUpRight,
} from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CallDetailDrawer } from "@/components/call-detail-drawer";
import { cn } from "@/lib/utils";
import type { CallPlanStep } from "./step-editor";

const DASH_API = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

export type StepAudit = {
  type?: string;
  status?: string;
  reason?: string;
  at?: string;
  stepIndex?: number;
};

export type PlanRunCall = {
  callId?: number;
  duration?: number;
  connected?: boolean;
  status?: string;
  summary?: string;
  disposition?: string;
};

/** Lean run row from paginated API (context is a slim projection). */
export type PlanRun = {
  id: number;
  status: string;
  currentStepIndex: number;
  leadId?: number | null;
  callId?: number | null;
  error: string | null;
  triggeredBy: string | null;
  resumeAt?: string | null;
  createdAt: string;
  updatedAt: string;
  name?: string;
  phone?: string;
  call?: PlanRunCall | null;
  lastStep?: StepAudit | null;
  stepTrail?: StepAudit[];
  context?: Record<string, unknown> | null;
};

export type PlanRunStats = {
  started: number;
  inProgress: number;
  waiting: number;
  queued?: number;
  dialing?: number;
  completed: number;
  failed: number;
  withCall: number;
  connected: number;
  connectRate: number | null;
  avgDurationSec: number | null;
  stepFunnel: Array<{
    stepIndex: number;
    type: string | null;
    label: string | null;
    reached: number;
    atStep: number;
    failed: number;
    completedAtOrPast: number;
  }>;
  stepCount: number;
  concurrentLimit?: number;
  autoFeed?: boolean;
  startOffset?: number;
  startSourceTotal?: number;
};

type RunsPage = {
  runs: PlanRun[];
  total: number;
  limit: number;
  offset: number;
};

type RunFilter =
  | "all"
  | "in_progress"
  | "waiting"
  | "completed"
  | "failed"
  | "with_call";

function lastStepAudit(run: PlanRun): StepAudit | null {
  if (run.lastStep) return run.lastStep;
  if (run.context?.lastStep && typeof run.context.lastStep === "object") {
    return run.context.lastStep as StepAudit;
  }
  return null;
}

function formatStepAudit(audit: StepAudit | null): string | null {
  if (!audit?.type) return null;
  const label = audit.type.replace(/_/g, " ");
  const st = audit.status ?? "";
  const reason = audit.reason?.trim();
  if (st === "skipped") return `${label} skipped${reason ? ` — ${reason}` : ""}`;
  if (st === "failed") return `${label} failed${reason ? ` — ${reason}` : ""}`;
  if (st === "sent") return `${label} sent`;
  if (st === "joined") return `${label} joined`;
  if (reason) return `${label}: ${reason}`;
  return label;
}

function stepAuditTrail(run: PlanRun): StepAudit[] {
  if (run.stepTrail?.length) return run.stepTrail;
  if (run.context && Array.isArray(run.context.steps)) {
    return run.context.steps.filter((s): s is StepAudit => !!s && typeof s === "object");
  }
  return [];
}

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

function personName(run: PlanRun): string {
  const name = (run.name ?? (typeof run.context?.name === "string" ? run.context.name : "")).trim();
  return name || "—";
}

function personPhone(run: PlanRun): string {
  return run.phone ?? (typeof run.context?.phone === "string" ? run.context.phone : "");
}

function callFromRun(run: PlanRun): PlanRunCall | null {
  if (run.call) return run.call;
  if (run.context?.call && typeof run.context.call === "object") {
    return run.context.call as PlanRunCall;
  }
  return null;
}

function resolveCallId(run: PlanRun): number | null {
  if (typeof run.callId === "number" && run.callId > 0) return run.callId;
  const c = callFromRun(run);
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

const PAGE_SIZE = 50;

export function usePlanRunStats(
  planId: number,
  opts?: { enabled?: boolean; poll?: boolean },
) {
  const enabled = opts?.enabled !== false;
  const poll = opts?.poll === true;
  return useQuery({
    queryKey: ["call-plans", planId, "runs-stats"],
    queryFn: () => customFetch<PlanRunStats>(`${DASH_API}/journeys/${planId}/runs/stats`),
    enabled: enabled && Number.isFinite(planId) && planId > 0,
    refetchInterval: poll ? 8_000 : false,
    staleTime: poll ? 5_000 : 30_000,
  });
}

/** Compact summary for the plan editor — stats + Open activity. */
export function CallPlanActivitySummary({
  planId,
  totalRuns,
}: {
  planId: number;
  totalRuns?: number;
}) {
  const statsQ = usePlanRunStats(planId, { poll: false });
  const stats = statsQ.data;
  const started = stats?.started ?? totalRuns ?? 0;
  const isLive = (stats?.inProgress ?? 0) > 0;

  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card/40">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Activity &amp; call log</h2>
            {isLive && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
                Live
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Progress for everyone on this plan — open the full log for filters, funnel, and export.
          </p>
        </div>
        <Button asChild size="sm" className="h-8 gap-1.5 text-[11px]">
          <Link href={`/app/call-plans/${planId}/activity`}>
            Open activity
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-border/40 p-3 sm:grid-cols-3 lg:grid-cols-6 sm:px-4">
        {[
          { label: "Started", value: started, accent: "text-foreground" },
          { label: "Queued", value: stats?.queued ?? 0, accent: "text-muted-foreground" },
          { label: "Dialing", value: stats?.dialing ?? 0, accent: "text-amber-400" },
          { label: "Completed", value: stats?.completed ?? 0, accent: "text-emerald-400" },
          { label: "Failed", value: stats?.failed ?? 0, accent: "text-destructive" },
          { label: "Calls", value: stats?.withCall ?? 0, accent: "text-foreground" },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2.5"
          >
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{card.label}</span>
            <p className={cn("mt-1 text-lg font-semibold tabular-nums", card.accent)}>
              {statsQ.isLoading ? "—" : card.value}
            </p>
          </div>
        ))}
      </div>
      {(stats?.concurrentLimit != null || stats?.connectRate != null || stats?.avgDurationSec != null) && (
        <p className="border-t border-border/40 px-4 py-2 text-[10px] text-muted-foreground sm:px-5">
          {stats?.concurrentLimit != null ? (
            <>
              Concurrency {stats.concurrentLimit}
              {stats.autoFeed ? " · auto-feeding" : ""}
              {(stats.connectRate != null || stats.avgDurationSec != null) ? " · " : ""}
            </>
          ) : null}
          {stats?.connectRate != null ? `${stats.connectRate}% connect rate` : null}
          {stats?.connectRate != null && stats?.avgDurationSec != null ? " · " : null}
          {stats?.avgDurationSec != null ? `avg call ${formatDuration(stats.avgDurationSec)}` : null}
        </p>
      )}
    </section>
  );
}

export function CallPlanActivityPanel({
  planId,
  steps,
  totalRuns,
  showBackLink = false,
}: {
  planId: number;
  steps: CallPlanStep[];
  totalRuns?: number;
  showBackLink?: boolean;
}) {
  const [filter, setFilter] = useState<RunFilter>("all");
  const [search, setSearch] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(0);
  const [drawerCallId, setDrawerCallId] = useState<number | null>(null);
  const [drawerIndex, setDrawerIndex] = useState(0);
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const statsQ = usePlanRunStats(planId, { poll: true });
  const stats = statsQ.data;

  const runsQ = useQuery({
    queryKey: ["call-plans", planId, "runs", filter, debouncedQ, page],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
        status: filter,
      });
      if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
      return customFetch<RunsPage>(`${DASH_API}/journeys/${planId}/runs?${params}`);
    },
    enabled: Number.isFinite(planId) && planId > 0,
    refetchInterval: 8_000,
    staleTime: 4_000,
  });

  const runs = runsQ.data?.runs ?? [];
  const total = runsQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const loading = runsQ.isLoading || statsQ.isLoading;
  const refreshing = (runsQ.isFetching || statsQ.isFetching) && !loading;

  const kpis = useMemo(() => ({
    started: stats?.started ?? totalRuns ?? 0,
    inProgress: stats?.inProgress ?? 0,
    queued: stats?.queued ?? 0,
    dialing: stats?.dialing ?? 0,
    completed: stats?.completed ?? 0,
    failed: stats?.failed ?? 0,
    withCall: stats?.withCall ?? 0,
  }), [stats, totalRuns]);

  const callRows = useMemo(
    () => runs.map((r, i) => ({ run: r, callId: resolveCallId(r), index: i })).filter((x) => x.callId != null),
    [runs],
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

  function refresh() {
    void runsQ.refetch();
    void statsQ.refetch();
  }

  async function exportCsv() {
    const params = new URLSearchParams({ status: filter });
    if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
    try {
      const text = await customFetch<string>(`${DASH_API}/journeys/${planId}/runs/export?${params}`, {
        responseType: "text",
      });
      const blob = new Blob([typeof text === "string" ? text : String(text)], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `call-plan-${planId}-runs-${format(new Date(), "yyyyMMdd-HHmm")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore — button stays enabled for retry
    }
  }

  const kpiCards = [
    { key: "all" as RunFilter, label: "Started", value: kpis.started, icon: Activity, accent: "text-foreground" },
    { key: "waiting" as RunFilter, label: "Queued", value: kpis.queued, icon: Clock, accent: "text-muted-foreground" },
    { key: "in_progress" as RunFilter, label: "Dialing", value: kpis.dialing, icon: Phone, accent: "text-amber-400" },
    { key: "completed" as RunFilter, label: "Completed", value: kpis.completed, icon: CheckCircle2, accent: "text-emerald-400" },
    { key: "failed" as RunFilter, label: "Failed", value: kpis.failed, icon: XCircle, accent: "text-destructive" },
    { key: "with_call" as RunFilter, label: "Calls logged", value: kpis.withCall, icon: Phone, accent: "text-foreground" },
  ];

  const isLive = kpis.inProgress > 0 || kpis.dialing > 0 || kpis.queued > 0;
  const funnel = stats?.stepFunnel ?? [];
  const funnelMax = Math.max(1, ...funnel.map((f) => f.reached));

  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card/40">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/50 px-4 py-3 sm:px-5">
        <div>
          {showBackLink && (
            <Link
              href={`/app/call-plans/${planId}`}
              className="mb-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-3 w-3" />
              Back to plan
            </Link>
          )}
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Activity &amp; call log</h2>
            {isLive && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
                Live
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Live progress for everyone walking this plan
            {typeof totalRuns === "number" && totalRuns > 0 ? ` · ${totalRuns} started` : ""}
            . Open a row to see the full call.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-[11px]"
            onClick={exportCsv}
            disabled={loading || kpis.started === 0}
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-[11px]"
            onClick={refresh}
            disabled={refreshing}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2 border-b border-border/40 p-3 sm:grid-cols-5 sm:px-4">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          const active = filter === card.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => {
                setFilter(card.key);
                setPage(0);
              }}
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
                {statsQ.isLoading ? "—" : card.value}
              </p>
            </button>
          );
        })}
      </div>

      {/* Analysis */}
      {(stats?.connectRate != null || funnel.some((f) => f.reached > 0)) && (
        <div className="border-b border-border/40 px-4 py-3 sm:px-5 space-y-3">
          <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground">
            {stats?.connectRate != null && (
              <span>
                <span className="font-medium text-foreground tabular-nums">{stats.connectRate}%</span>
                {" "}connect rate
                <span className="text-muted-foreground/60">
                  {" "}({stats.connected}/{stats.withCall} calls)
                </span>
              </span>
            )}
            {stats?.avgDurationSec != null && (
              <span>
                Avg duration{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {formatDuration(stats.avgDurationSec)}
                </span>
              </span>
            )}
            {stats != null && (
              <span>
                Completed{" "}
                <span className="font-medium text-foreground tabular-nums">{stats.completed}</span>
                {stats.started > 0 ? (
                  <span className="text-muted-foreground/60">
                    {" "}({Math.round((stats.completed / stats.started) * 100)}%)
                  </span>
                ) : null}
              </span>
            )}
          </div>
          {funnel.length > 0 && funnel.some((f) => f.reached > 0) && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-2">
                Step funnel
              </p>
              <ul className="space-y-1.5">
                {funnel.map((f) => {
                  const pct = Math.round((f.reached / funnelMax) * 100);
                  const typeLabel = (f.label?.trim() || f.type?.replace(/_/g, " ") || `Step ${f.stepIndex + 1}`);
                  return (
                    <li key={f.stepIndex} className="flex items-center gap-2 text-[11px]">
                      <span className="w-4 shrink-0 tabular-nums text-muted-foreground/50">
                        {f.stepIndex + 1}
                      </span>
                      <span className="w-28 sm:w-40 truncate capitalize text-muted-foreground">
                        {typeLabel}
                      </span>
                      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted/40">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-sky-500/70"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right tabular-nums font-medium">
                        {f.reached}
                      </span>
                      {f.failed > 0 && (
                        <span className="w-12 shrink-0 text-right tabular-nums text-destructive text-[10px]">
                          {f.failed} fail
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2.5 sm:px-4">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setFilter(f.id);
                setPage(0);
              }}
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
          {total} match{total === 1 ? "" : "es"}
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
        ) : runs.length === 0 ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 px-6 py-12 text-center">
            <Activity className="h-6 w-6 text-muted-foreground/30" />
            <p className="text-[13px] font-medium text-foreground/80">
              {kpis.started === 0 ? "Nothing started yet" : "No rows match this filter"}
            </p>
            <p className="max-w-sm text-[11px] text-muted-foreground leading-relaxed">
              {kpis.started === 0
                ? "Press Start queue. People dial up to your account concurrency; progress, outcomes, and History links show here."
                : "Clear search or pick another status tab."}
            </p>
          </div>
        ) : (
          <ul className="min-w-[720px] divide-y divide-border/40">
            {runs.map((run) => {
              const stepN = Math.min(run.currentStepIndex + 1, Math.max(steps.length, 1));
              const stepLabel = steps[run.currentStepIndex]?.type?.replace(/_/g, " ");
              const call = callFromRun(run);
              const callId = resolveCallId(run);
              const phone = personPhone(run);
              const duration = typeof call?.duration === "number" ? call.duration : null;
              const audit = lastStepAudit(run);
              const auditLabel = formatStepAudit(audit);
              const trail = stepAuditTrail(run);
              const outcome =
                auditLabel ||
                call?.summary?.trim() ||
                (typeof call?.disposition === "string" ? call.disposition.trim() : null) ||
                (call?.connected === true ? "Connected" : call?.connected === false ? "No connect" : null) ||
                run.error;
              const expanded = expandedRunId === run.id;

              return (
                <li
                  key={run.id}
                  className={cn(
                    "px-4 py-3 text-[12px] transition-colors",
                    "hover:bg-muted/10",
                  )}
                >
                  <div
                    className={cn(
                      "grid grid-cols-1 gap-2 md:grid-cols-[minmax(140px,1.4fr)_90px_110px_88px_72px_minmax(120px,1fr)_72px] md:items-center md:gap-2",
                      callId != null || trail.length > 0 ? "cursor-pointer" : "",
                    )}
                    onClick={() => {
                      if (trail.length > 0) {
                        setExpandedRunId(expanded ? null : run.id);
                      } else if (callId != null) {
                        openCall(run);
                      }
                    }}
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{personName(run)}</p>
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
                      {auditLabel && (
                        <p
                          className={cn(
                            "text-[10px] truncate mt-0.5 font-medium",
                            audit?.status === "failed"
                              ? "text-destructive"
                              : audit?.status === "skipped"
                                ? "text-amber-400"
                                : audit?.status === "sent" || audit?.status === "joined"
                                  ? "text-emerald-400/90"
                                  : isInProgress(run.status) || isWaiting(run.status)
                                    ? "text-sky-400/90"
                                    : "text-muted-foreground/80",
                          )}
                          title={auditLabel}
                        >
                          {auditLabel}
                        </p>
                      )}
                      {!auditLabel && outcome && (
                        <p
                          className="text-[10px] truncate mt-0.5 text-muted-foreground/70"
                          title={outcome}
                        >
                          {outcome}
                        </p>
                      )}
                    </div>
                    <div className="flex justify-end gap-1">
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
                  </div>
                  {expanded && trail.length > 0 && (
                    <ol className="mt-2 space-y-1 border-t border-border/30 pt-2 pl-1">
                      {trail.map((s, i) => (
                        <li key={`${run.id}-s-${i}`} className="text-[10px] text-muted-foreground flex gap-2">
                          <span className="tabular-nums text-muted-foreground/50 w-4">{i + 1}</span>
                          <span className="capitalize">{(s.type ?? "?").replace(/_/g, " ")}</span>
                          <span
                            className={cn(
                              "capitalize",
                              s.status === "skipped" || s.status === "failed"
                                ? "text-amber-400"
                                : "text-emerald-400/80",
                            )}
                          >
                            {s.status}
                          </span>
                          {s.reason && <span className="truncate text-muted-foreground/60">— {s.reason}</span>}
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 px-4 py-2.5">
        <p className="text-[10px] text-muted-foreground">
          {total > 0 ? (
            <>
              Showing{" "}
              <span className="tabular-nums text-foreground/80">
                {Math.min(page * PAGE_SIZE + 1, total)}–{Math.min((page + 1) * PAGE_SIZE, total)}
              </span>
              {" "}of <span className="tabular-nums text-foreground/80">{total}</span>
              {" "}· {PAGE_SIZE} per page
            </>
          ) : (
            <>
              Full transcripts and recordings open in the call drawer, or browse{" "}
              <Link href="/app/history" className="underline underline-offset-2">History</Link>.
            </>
          )}
        </p>
        {total > PAGE_SIZE && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {page + 1} / {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
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
