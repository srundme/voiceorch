import React, { useMemo } from "react";
import { Link } from "wouter";
import {
  Users,
  Phone,
  CheckCircle2,
  Clock,
  ArrowRight,
  Activity,
  TrendingUp,
} from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useTheme } from "@/components/theme-provider";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
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

const getStatusBadge = (status: string) => {
  const base = "inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full";
  switch (status) {
    case "completed":
      return (
        <span className={`${base} bg-zinc-500/10 text-zinc-300 border border-zinc-500/20`}>
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-300" />Completed
        </span>
      );
    case "failed":
      return (
        <span className={`${base} bg-red-500/10 text-red-500 border border-red-500/20`}>
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />Failed
        </span>
      );
    case "in_progress":
      return (
        <span className={`${base} bg-zinc-500/10 text-zinc-300 border border-zinc-500/20`}>
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-300 animate-pulse" />In Progress
        </span>
      );
    case "pending":
      return (
        <span className={`${base} bg-muted text-muted-foreground border border-border`}>
          Pending
        </span>
      );
    default:
      return (
        <span className={`${base} bg-muted text-muted-foreground border border-border`}>
          {status}
        </span>
      );
  }
};

const STATUS_COLORS: Record<string, string> = {
  completed:   "#d4d4d8",
  failed:      "#ef4444",
  in_progress: "#a1a1aa",
  pending:     "#71717a",
  cancelled:   "#52525b",
};

/* ── Stat cards ──────────────────────────────────────────────────────────── */
const STAT_CARDS = [
  {
    title:    "Total Agents",
    icon:     Users,
    testId:   "text-total-agents",
    getValue: (s: any) => s?.totalAgents ?? 0,
    getSub:   (s: any) => `${s?.activeAgents ?? 0} active`,
  },
  {
    title:    "Calls Today",
    icon:     Phone,
    testId:   "text-calls-today",
    getValue: (s: any) => s?.callsToday ?? 0,
    getSub:   (s: any) => `${s?.callsThisWeek ?? 0} this week`,
  },
  {
    title:    "Success Rate",
    icon:     CheckCircle2,
    testId:   "text-success-rate",
    getValue: (s: any) => s?.successRate ? `${s.successRate.toFixed(1)}%` : "0%",
    getSub:   (_: any) => "completed / total",
  },
  {
    title:    "Avg Duration",
    icon:     Clock,
    testId:   "text-avg-duration",
    getValue: (s: any) => formatDuration(s?.avgDurationSeconds ?? 0),
    getSub:   (_: any) => "per successful call",
  },
];

/* ── Status strip ────────────────────────────────────────────────────────── */
function StatusStrip({ stats }: { stats: any }) {
  if (!stats) return null;
  const total      = stats.callsToday ?? 0;
  const successful = stats.callsThisWeek ? Math.round((stats.successRate ?? 0) / 100 * total) : 0;
  const active     = stats.activeAgents ?? 0;
  const pct        = stats.successRate ? `${stats.successRate.toFixed(0)}%` : "—";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-0 py-2 text-[11px] border-b border-border mb-2">
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary))]" />
        <span className="text-muted-foreground">{active} agent{active !== 1 ? "s" : ""} active</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        <span className="text-muted-foreground">{total} calls today</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        <span className="text-muted-foreground">{successful} completed</span>
      </div>
      <div className="ml-auto">
        <span className="px-2 py-0.5 rounded-md bg-muted text-foreground font-mono font-semibold border border-border">
          {pct} success
        </span>
      </div>
    </div>
  );
}

/* ── Dashboard ───────────────────────────────────────────────────────────── */
export default function Dashboard() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const { data: stats,       isLoading: statsLoading }       = useGetDashboardStats({ query: { queryKey: getGetDashboardStatsQueryKey() } });
  const { data: recentCalls, isLoading: recentCallsLoading } = useGetRecentCalls({ query: { queryKey: getGetRecentCallsQueryKey() } });
  const { data: callsByStatus }                               = useGetCallsByStatus({ query: { queryKey: getGetCallsByStatusQueryKey() } });
  const { data: dailyVolume, isLoading: dailyVolumeLoading } = useGetDailyCallVolume({ query: { queryKey: getGetDailyCallVolumeQueryKey() } });

  const chartCompleted  = isDark ? "#22c55e" : "#374151";
  const chartFailed     = "#EF4444";
  const chartGrid       = isDark ? "rgba(255,255,255,0.06)" : "#F3F4F6";
  const tickColor       = isDark ? "hsl(0,0%,55%)" : "#9CA3AF";
  const tooltipBg       = isDark ? "hsl(0,0%,8%)"  : "#FFFFFF";
  const tooltipBorder   = isDark ? "hsl(0,0%,14%)" : "#E5E7EB";
  const tooltipColor    = isDark ? "hsl(0,0%,96%)" : "#111827";

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

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 animate-fade-in">

      {/* ── Header ── */}
      <div>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
              Analytics
            </h1>
            <p className="text-[13.5px] mt-1 text-muted-foreground">
              Overview of your voice agents and call activity.
            </p>
          </div>
          <Link href="/app">
            <button
              data-testid="button-create-agent"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-primary-foreground bg-primary hover:opacity-90 transition-opacity"
            >
              <Users className="h-3.5 w-3.5" />
              Manage Agents
            </button>
          </Link>
        </div>
        <StatusStrip stats={stats} />
      </div>

      {/* ── Stat cards ── */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {STAT_CARDS.map(({ title, icon: Icon, testId, getValue, getSub }) => (
          <div
            key={title}
            className="card-hover bg-card rounded-2xl p-5 border border-border"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {title}
              </span>
              <div className="h-7 w-7 rounded-lg flex items-center justify-center bg-muted border border-border">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            </div>

            {statsLoading ? (
              <div className="space-y-2">
                <div className="h-7 w-20 rounded-lg animate-pulse bg-muted" />
                <div className="h-3.5 w-16 rounded animate-pulse bg-muted/70" />
              </div>
            ) : (
              <>
                <div
                  className="text-[26px] font-semibold leading-none mb-1.5 tabular-nums text-foreground"
                  data-testid={testId}
                >
                  {getValue(stats)}
                </div>
                <p className="text-[12px] text-muted-foreground">{getSub(stats)}</p>
              </>
            )}
          </div>
        ))}
      </div>

      {/* ── Charts ── */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">

        {/* Area chart */}
        <Card className="col-span-4">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-[14.5px] font-semibold text-foreground">
                  Call Volume
                </CardTitle>
                <CardDescription className="text-[12.5px] mt-0.5">
                  Completed vs failed calls — last 14 days
                </CardDescription>
              </div>
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: chartCompleted }} />Completed
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: chartFailed }} />Failed
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pl-2">
            {dailyVolumeLoading ? (
              <div className="h-[260px] flex items-center justify-center">
                <div className="h-[220px] w-full rounded-xl animate-pulse bg-muted" />
              </div>
            ) : chartData.length > 0 ? (
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={chartCompleted} stopOpacity={isDark ? 0.2 : 0.12} />
                        <stop offset="95%" stopColor={chartCompleted} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorFailed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={chartFailed} stopOpacity={0.15} />
                        <stop offset="95%" stopColor={chartFailed} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="formattedDate"
                      stroke="transparent"
                      tick={{ fill: tickColor, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="transparent"
                      tick={{ fill: tickColor, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={28}
                    />
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartGrid} />
                    <Tooltip
                      contentStyle={{
                        background:   tooltipBg,
                        border:       `1px solid ${tooltipBorder}`,
                        borderRadius: "12px",
                        color:        tooltipColor,
                        fontSize:     "12px",
                        boxShadow:    isDark ? "0 4px 16px rgba(0,0,0,0.6)" : "0 4px 12px rgba(0,0,0,0.08)",
                      }}
                      itemStyle={{ color: tooltipColor }}
                      cursor={{ stroke: tooltipBorder, strokeWidth: 1 }}
                    />
                    <Area type="monotone" dataKey="completed" stroke={chartCompleted} strokeWidth={1.5} fillOpacity={1} fill="url(#colorCompleted)" dot={false} />
                    <Area type="monotone" dataKey="failed"    stroke={chartFailed}    strokeWidth={1.5} fillOpacity={1} fill="url(#colorFailed)"    dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[260px] flex flex-col items-center justify-center gap-3">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-muted border border-border">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-[13px] text-muted-foreground">No call data yet</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status pie */}
        <Card className="col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-[14.5px] font-semibold text-foreground">
              Status Breakdown
            </CardTitle>
            <CardDescription className="text-[12.5px] mt-0.5">
              Distribution of calls by status
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pieData.length > 0 ? (
              <div className="flex flex-col gap-4">
                <div className="h-[160px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2} dataKey="value" strokeWidth={0}>
                        {pieData.map((entry) => (
                          <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#6b7280"} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background:   tooltipBg,
                          border:       `1px solid ${tooltipBorder}`,
                          borderRadius: "12px",
                          color:        tooltipColor,
                          fontSize:     "12px",
                          boxShadow:    isDark ? "0 4px 16px rgba(0,0,0,0.6)" : "0 4px 12px rgba(0,0,0,0.08)",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* Status strip — label + dot + count + pct pill */}
                <div className="space-y-2">
                  {pieData.map(entry => {
                    const total = pieData.reduce((s, e) => s + e.value, 0);
                    const pct   = total ? Math.round((entry.value / total) * 100) : 0;
                    return (
                      <div key={entry.status} className="flex items-center gap-2.5">
                        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: STATUS_COLORS[entry.status] ?? "#6b7280" }} />
                        <span className="text-[12px] flex-1 capitalize text-muted-foreground">
                          {entry.name}
                        </span>
                        <span className="text-[12px] font-semibold tabular-nums text-foreground">
                          {entry.value}
                        </span>
                        <span className="text-[11px] w-8 text-right tabular-nums px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-mono">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="h-[200px] flex flex-col items-center justify-center gap-3">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-muted border border-border">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-[13px] text-muted-foreground">No status data yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Recent calls ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-[14.5px] font-semibold text-foreground">Recent Calls</CardTitle>
              <CardDescription className="text-[12.5px] mt-0.5">Latest voice interactions across all agents</CardDescription>
            </div>
            <Link href="/app/calls">
              <button
                className="flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                View all <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {recentCallsLoading ? (
            <div className="px-6 pb-6 space-y-3 pt-2">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg animate-pulse bg-muted" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-36 rounded animate-pulse bg-muted" />
                    <div className="h-3 w-24 rounded animate-pulse bg-muted/70" />
                  </div>
                  <div className="h-5 w-16 rounded-full animate-pulse bg-muted" />
                </div>
              ))}
            </div>
          ) : recentCalls && recentCalls.length > 0 ? (
            <div className="divide-y divide-border">
              {recentCalls.slice(0, 6).map(call => (
                <div
                  key={call.id}
                  className="flex items-center gap-4 px-6 py-3 transition-colors hover:bg-muted/40 cursor-default"
                >
                  <div className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 bg-muted border border-border">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium truncate text-foreground">
                      {(call as any).agentName ?? `Agent #${call.agentId}`}
                    </p>
                    <p className="text-[11.5px] font-mono truncate text-muted-foreground">
                      {call.fromNumber ?? call.toNumber ?? `#${call.id}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {call.durationSeconds != null && (
                      <span className="text-[11.5px] tabular-nums text-muted-foreground">
                        {formatDuration(call.durationSeconds)}
                      </span>
                    )}
                    {getStatusBadge(call.status)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-muted border border-border">
                <Phone className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-[13px] text-muted-foreground">No calls yet</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
