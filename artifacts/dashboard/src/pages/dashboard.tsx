import React, { useMemo } from "react";
import { Link } from "wouter";
import { Phone, Activity, ArrowRight, TrendingUp } from "lucide-react";
import {
  useGetDashboardStats,
  useGetRecentCalls,
  useGetCallsByStatus,
  useGetDailyCallVolume,
  getGetDashboardStatsQueryKey,
  getGetRecentCallsQueryKey,
  getGetCallsByStatusQueryKey,
  getGetDailyCallVolumeQueryKey,
} from "@workspace/api-client-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import { format, parseISO } from "date-fns";

/* ── Helpers ─────────────────────────────────────────────────────────────── */
const formatDuration = (seconds: number) => {
  if (!seconds) return "0s";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
};

/* ── Status badge ────────────────────────────────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  const base = "inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-md";
  const map: Record<string, string> = {
    completed:   "bg-foreground/[0.07] text-foreground/60 border border-foreground/[0.07]",
    failed:      "bg-foreground/[0.04] text-muted-foreground border border-foreground/[0.05]",
    in_progress: "bg-foreground/[0.06] text-foreground/70 border border-foreground/[0.06]",
    pending:     "bg-foreground/[0.04] text-muted-foreground/60 border border-foreground/[0.04]",
    cancelled:   "bg-foreground/[0.04] text-muted-foreground/40 border border-foreground/[0.04]",
  };
  const dotMap: Record<string, string> = {
    completed:   "bg-foreground/30",
    failed:      "bg-foreground/15",
    in_progress: "bg-foreground/25 animate-pulse",
    pending:     "bg-foreground/10",
    cancelled:   "bg-foreground/10",
  };
  return (
    <span className={`${base} ${map[status] ?? map.pending}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotMap[status] ?? dotMap.pending}`} />
      {status.replace("_", " ")}
    </span>
  );
}

/* ── Stat cards config ───────────────────────────────────────────────────── */
const STAT_CARDS = [
  {
    title:    "Total Agents",
    testId:   "text-total-agents",
    getValue: (s: any) => s?.totalAgents ?? 0,
    getSub:   (s: any) => `${s?.activeAgents ?? 0} active now`,
  },
  {
    title:    "Calls Today",
    testId:   "text-calls-today",
    getValue: (s: any) => s?.callsToday ?? 0,
    getSub:   (s: any) => `${s?.callsThisWeek ?? 0} this week`,
  },
  {
    title:    "Success Rate",
    testId:   "text-success-rate",
    getValue: (s: any) => s?.successRate ? `${s.successRate.toFixed(1)}%` : "0%",
    getSub:   (_: any) => "completed / total",
  },
  {
    title:    "Avg Duration",
    testId:   "text-avg-duration",
    getValue: (s: any) => formatDuration(s?.avgDurationSeconds ?? 0),
    getSub:   (_: any) => "per successful call",
  },
];

/* ── Custom tooltip ──────────────────────────────────────────────────────── */
function MonoTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "hsl(var(--foreground))", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
      <p style={{ color: "hsl(var(--muted-foreground))", fontSize: 10, marginBottom: 6 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: "hsl(var(--foreground))", fontWeight: 500, marginBottom: 2 }}>
          <span style={{ color: "hsl(var(--muted-foreground))" }}>{p.dataKey}: </span>{p.value}
        </p>
      ))}
    </div>
  );
}

/* ── Dashboard ───────────────────────────────────────────────────────────── */
export default function Dashboard() {
  const { data: stats,       isLoading: statsLoading }       = useGetDashboardStats({ query: { queryKey: getGetDashboardStatsQueryKey() } });
  const { data: recentCalls, isLoading: recentCallsLoading } = useGetRecentCalls({ query: { queryKey: getGetRecentCallsQueryKey() } });
  const { data: callsByStatus }                               = useGetCallsByStatus({ query: { queryKey: getGetCallsByStatusQueryKey() } });
  const { data: dailyVolume, isLoading: dailyVolumeLoading } = useGetDailyCallVolume({ query: { queryKey: getGetDailyCallVolumeQueryKey() } });

  const chartData = useMemo(() => {
    if (!dailyVolume) return [];
    return dailyVolume.map(d => ({ ...d, formattedDate: format(parseISO(d.date), "MMM d") })).reverse();
  }, [dailyVolume]);

  const pieData = useMemo(() => {
    if (!callsByStatus) return [];
    return callsByStatus.filter(s => s.count > 0).map(s => ({
      name:   s.status.replace("_", " "),
      value:  s.count,
      status: s.status,
    }));
  }, [callsByStatus]);

  const totalCalls = pieData.reduce((s, e) => s + e.value, 0);

  return (
    <div className="flex-1 overflow-y-auto animate-fade-in">
      <div className="mx-auto w-full max-w-6xl px-8 py-8 space-y-7">

        {/* Header */}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50 mb-1.5">Overview</p>
            <h1 className="text-[22px] font-semibold tracking-tight text-foreground leading-none">Analytics</h1>
            <p className="text-[12.5px] mt-1.5 text-muted-foreground/70">Voice agent activity across your platform.</p>
          </div>
          <Link href="/app">
            <button className="text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors border border-border rounded-lg px-3.5 py-2 hover:bg-accent">
              Manage Agents
            </button>
          </Link>
        </div>

        {/* Stat cards */}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {STAT_CARDS.map(({ title, testId, getValue, getSub }) => (
            <div
              key={title}
              className="bg-card rounded-2xl p-5 border border-border card-hover"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/60 mb-3">
                {title}
              </p>
              {statsLoading ? (
                <div className="space-y-2">
                  <div className="h-8 w-20 rounded-lg animate-pulse bg-elevated" />
                  <div className="h-3 w-16 rounded animate-pulse bg-elevated/70" />
                </div>
              ) : (
                <>
                  <div className="text-[28px] font-semibold leading-none mb-2 tabular-nums text-foreground tracking-tight" data-testid={testId}>
                    {getValue(stats)}
                  </div>
                  <p className="text-[11px] text-muted-foreground/60">{getSub(stats)}</p>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Charts row */}
        <div className="grid gap-3 lg:grid-cols-7">

          {/* Area chart — call volume */}
          <div className="col-span-4 bg-card rounded-2xl p-6 border border-border">
            <div className="flex items-start justify-between mb-6">
              <div>
                <p className="text-[13.5px] font-semibold text-foreground tracking-tight">Call Volume</p>
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">Last 14 days · completed vs failed</p>
              </div>
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
                  <span className="h-2 w-2 rounded-full bg-foreground/30" />Completed
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
                  <span className="h-2 w-2 rounded-full bg-foreground/10" />Failed
                </span>
              </div>
            </div>

            {dailyVolumeLoading ? (
              <div className="h-[220px] rounded-xl animate-pulse bg-elevated/50" />
            ) : chartData.length > 0 ? (
              <div className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gCompleted" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="hsl(var(--foreground))" stopOpacity={0.10} />
                        <stop offset="95%" stopColor="hsl(var(--foreground))" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gFailed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="hsl(var(--foreground))" stopOpacity={0.04} />
                        <stop offset="95%" stopColor="hsl(var(--foreground))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="formattedDate" stroke="transparent" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10, opacity: 0.5 }} tickLine={false} axisLine={false} />
                    <YAxis stroke="transparent" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10, opacity: 0.5 }} tickLine={false} axisLine={false} width={24} />
                    <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                    <Tooltip content={<MonoTooltip />} cursor={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1, opacity: 0.2 }} />
                    <Area type="monotone" dataKey="completed" stroke="hsl(var(--foreground))" strokeWidth={1.5} fillOpacity={1} fill="url(#gCompleted)" dot={false} strokeOpacity={0.35} />
                    <Area type="monotone" dataKey="failed"    stroke="hsl(var(--foreground))" strokeWidth={1} fillOpacity={1} fill="url(#gFailed)"    dot={false} strokeOpacity={0.15} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[220px] flex flex-col items-center justify-center gap-3 text-muted-foreground/40">
                <Activity className="h-8 w-8" />
                <p className="text-[12px]">No call data yet</p>
              </div>
            )}
          </div>

          {/* Status breakdown */}
          <div className="col-span-3 bg-card rounded-2xl p-6 border border-border">
            <p className="text-[13.5px] font-semibold text-foreground tracking-tight mb-1">Status Breakdown</p>
            <p className="text-[11px] text-muted-foreground/60 mb-6">Distribution by outcome</p>

            {pieData.length > 0 ? (
              <>
                {/* Horizontal bar chart */}
                <div className="h-[120px] mb-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={pieData} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }} barSize={8}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10, opacity: 0.6 }} tickLine={false} axisLine={false} width={68} />
                      <Tooltip content={<MonoTooltip />} cursor={{ fill: "rgba(255,255,255,0.02)" }} />
                      <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={`hsl(var(--foreground) / ${0.25 - i * 0.06})`} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Legend */}
                <div className="space-y-2.5">
                  {pieData.map(entry => {
                    const pct = totalCalls ? Math.round((entry.value / totalCalls) * 100) : 0;
                    return (
                      <div key={entry.status} className="flex items-center gap-2">
                        <span className="text-[11px] flex-1 capitalize text-muted-foreground/60">{entry.name}</span>
                        <span className="text-[12px] font-semibold tabular-nums text-foreground/70">{entry.value}</span>
                        <span className="text-[10px] w-8 text-right tabular-nums text-muted-foreground/40 font-mono">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="h-[200px] flex flex-col items-center justify-center gap-3 text-muted-foreground/40">
                <TrendingUp className="h-8 w-8" />
                <p className="text-[12px]">No status data yet</p>
              </div>
            )}
          </div>
        </div>

        {/* Recent calls */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <div>
              <p className="text-[13.5px] font-semibold text-foreground tracking-tight">Recent Calls</p>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">Latest interactions across all agents</p>
            </div>
            <Link href="/app/calls">
              <button className="flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground/60 hover:text-foreground transition-colors">
                View all <ArrowRight className="h-3 w-3" />
              </button>
            </Link>
          </div>

          {recentCallsLoading ? (
            <div className="px-6 py-5 space-y-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-7 w-7 rounded-lg animate-pulse bg-elevated" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-32 rounded animate-pulse bg-elevated" />
                    <div className="h-2.5 w-20 rounded animate-pulse bg-elevated/70" />
                  </div>
                  <div className="h-5 w-16 rounded-md animate-pulse bg-elevated" />
                </div>
              ))}
            </div>
          ) : recentCalls && recentCalls.length > 0 ? (
            <div>
              {/* Table header */}
              <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-4 px-6 py-2 bg-elevated/40 border-b border-border">
                {["Agent", "Number", "Duration", "Status"].map(h => (
                  <span key={h} className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">{h}</span>
                ))}
              </div>
              {recentCalls.slice(0, 8).map((call, i) => (
                <div
                  key={call.id}
                  className="grid grid-cols-[1fr_1fr_auto_auto] gap-4 items-center px-6 py-3 border-b border-border/50 last:border-0 hover:bg-accent/30 transition-colors cursor-default"
                >
                  <p className="text-[12.5px] font-medium truncate text-foreground/80">
                    {(call as any).agentName ?? `Agent #${call.agentId}`}
                  </p>
                  <p className="text-[11.5px] font-mono truncate text-muted-foreground/50">
                    {call.fromNumber ?? call.toNumber ?? `#${call.id}`}
                  </p>
                  <p className="text-[11.5px] tabular-nums text-muted-foreground/50">
                    {call.durationSeconds != null ? formatDuration(call.durationSeconds) : "—"}
                  </p>
                  <StatusBadge status={call.status} />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-14 gap-3 text-muted-foreground/30">
              <Phone className="h-8 w-8" />
              <p className="text-[12px]">No calls yet</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
