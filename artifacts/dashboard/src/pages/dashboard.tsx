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
import { Skeleton } from "@/components/ui/skeleton";
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
      return <span className={base} style={{ background: "#F0FDF4", color: "#15803D", border: "1px solid #BBF7D0" }}>
        <span className="h-1.5 w-1.5 rounded-full bg-green-400" />Completed
      </span>;
    case "failed":
      return <span className={base} style={{ background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA" }}>
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />Failed
      </span>;
    case "in_progress":
      return <span className={base} style={{ background: "#FFFBEB", color: "#B45309", border: "1px solid #FDE68A" }}>
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />In Progress
      </span>;
    case "pending":
      return <span className={base} style={{ background: "#F9FAFB", color: "#6B7280", border: "1px solid #E5E7EB" }}>
        Pending
      </span>;
    default:
      return <span className={base} style={{ background: "#F9FAFB", color: "#6B7280", border: "1px solid #E5E7EB" }}>
        {status}
      </span>;
  }
};

/* Grayscale status colours for pie */
const STATUS_COLORS: Record<string, string> = {
  completed:   "#374151",
  failed:      "#EF4444",
  in_progress: "#F59E0B",
  pending:     "#D1D5DB",
  cancelled:   "#9CA3AF",
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

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 animate-fade-in">

      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: "#111827" }}>
            Dashboard
          </h1>
          <p className="text-[13.5px] mt-1" style={{ color: "#6B7280" }}>
            Overview of your voice agents and call activity.
          </p>
        </div>
        <Link href="/app">
          <button
            data-testid="button-create-agent"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-white transition-all"
            style={{ background: "#374151", boxShadow: "0 1px 2px rgba(0,0,0,0.1)" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "#1F2937"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "#374151"}
          >
            <Users className="h-3.5 w-3.5" />
            Manage Agents
          </button>
        </Link>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {STAT_CARDS.map(({ title, icon: Icon, testId, getValue, getSub }) => (
          <div
            key={title}
            className="card-hover bg-white rounded-2xl p-5"
            style={{
              border:    "1px solid #E5E7EB",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: "#9CA3AF" }}>
                {title}
              </span>
              <div
                className="h-7 w-7 rounded-lg flex items-center justify-center"
                style={{ background: "#F3F4F6", border: "1px solid #E5E7EB" }}
              >
                <Icon className="h-3.5 w-3.5" style={{ color: "#6B7280" }} />
              </div>
            </div>

            {statsLoading ? (
              <div className="space-y-2">
                <div className="h-7 w-20 rounded-lg animate-pulse" style={{ background: "#F3F4F6" }} />
                <div className="h-3.5 w-16 rounded animate-pulse" style={{ background: "#F9FAFB" }} />
              </div>
            ) : (
              <>
                <div
                  className="text-[26px] font-semibold leading-none mb-1.5 tabular-nums"
                  style={{ color: "#111827" }}
                  data-testid={testId}
                >
                  {getValue(stats)}
                </div>
                <p className="text-[12px]" style={{ color: "#9CA3AF" }}>{getSub(stats)}</p>
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
                <CardTitle className="text-[14.5px] font-semibold" style={{ color: "#111827" }}>
                  Call Volume
                </CardTitle>
                <CardDescription className="text-[12.5px] mt-0.5">
                  Completed vs failed calls — last 14 days
                </CardDescription>
              </div>
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "#9CA3AF" }}>
                  <span className="h-2 w-2 rounded-full" style={{ background: "#374151" }} />Completed
                </span>
                <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "#9CA3AF" }}>
                  <span className="h-2 w-2 rounded-full" style={{ background: "#EF4444" }} />Failed
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pl-2">
            {dailyVolumeLoading ? (
              <div className="h-[260px] flex items-center justify-center">
                <div className="h-[220px] w-full rounded-xl animate-pulse" style={{ background: "#F3F4F6" }} />
              </div>
            ) : chartData.length > 0 ? (
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#374151" stopOpacity={0.12} />
                        <stop offset="95%" stopColor="#374151" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorFailed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#EF4444" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="formattedDate"
                      stroke="transparent"
                      tick={{ fill: "#9CA3AF", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="transparent"
                      tick={{ fill: "#9CA3AF", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={28}
                    />
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                    <Tooltip
                      contentStyle={{
                        background:   "#FFFFFF",
                        border:       "1px solid #E5E7EB",
                        borderRadius: "12px",
                        color:        "#111827",
                        fontSize:     "12px",
                        boxShadow:    "0 4px 12px rgba(0,0,0,0.08)",
                      }}
                      itemStyle={{ color: "#374151" }}
                      cursor={{ stroke: "#E5E7EB", strokeWidth: 1 }}
                    />
                    <Area type="monotone" dataKey="completed" stroke="#374151" strokeWidth={1.5} fillOpacity={1} fill="url(#colorCompleted)" dot={false} />
                    <Area type="monotone" dataKey="failed"    stroke="#EF4444" strokeWidth={1.5} fillOpacity={1} fill="url(#colorFailed)"    dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[260px] flex flex-col items-center justify-center gap-3">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "#F3F4F6" }}>
                  <Activity className="h-4.5 w-4.5" style={{ color: "#9CA3AF" }} />
                </div>
                <p className="text-[13px]" style={{ color: "#9CA3AF" }}>No call data yet</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status pie */}
        <Card className="col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-[14.5px] font-semibold" style={{ color: "#111827" }}>
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
                          <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#D1D5DB"} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background:   "#FFFFFF",
                          border:       "1px solid #E5E7EB",
                          borderRadius: "12px",
                          color:        "#111827",
                          fontSize:     "12px",
                          boxShadow:    "0 4px 12px rgba(0,0,0,0.08)",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2">
                  {pieData.map(entry => {
                    const total = pieData.reduce((s, e) => s + e.value, 0);
                    const pct   = total ? Math.round((entry.value / total) * 100) : 0;
                    return (
                      <div key={entry.status} className="flex items-center gap-2.5">
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: STATUS_COLORS[entry.status] ?? "#D1D5DB" }} />
                        <span className="text-[12px] flex-1 capitalize" style={{ color: "#6B7280" }}>
                          {entry.name}
                        </span>
                        <span className="text-[12px] font-semibold tabular-nums" style={{ color: "#111827" }}>
                          {entry.value}
                        </span>
                        <span className="text-[11px] w-7 text-right tabular-nums" style={{ color: "#9CA3AF" }}>{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="h-[200px] flex flex-col items-center justify-center gap-3">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "#F3F4F6" }}>
                  <TrendingUp className="h-4.5 w-4.5" style={{ color: "#9CA3AF" }} />
                </div>
                <p className="text-[13px]" style={{ color: "#9CA3AF" }}>No status data yet</p>
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
              <CardTitle className="text-[14.5px] font-semibold" style={{ color: "#111827" }}>Recent Calls</CardTitle>
              <CardDescription className="text-[12.5px] mt-0.5">Latest voice interactions across all agents</CardDescription>
            </div>
            <Link href="/app/calls">
              <button
                className="flex items-center gap-1 text-[12px] font-medium transition-colors"
                style={{ color: "#6B7280" }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#374151"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#6B7280"}
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
                  <div className="h-8 w-8 rounded-lg animate-pulse" style={{ background: "#F3F4F6" }} />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-36 rounded animate-pulse" style={{ background: "#F3F4F6" }} />
                    <div className="h-3 w-24 rounded animate-pulse" style={{ background: "#F9FAFB" }} />
                  </div>
                  <div className="h-5 w-16 rounded-full animate-pulse" style={{ background: "#F3F4F6" }} />
                </div>
              ))}
            </div>
          ) : recentCalls && recentCalls.length > 0 ? (
            <div className="divide-y" style={{ borderColor: "#F3F4F6" }}>
              {recentCalls.slice(0, 6).map(call => (
                <div
                  key={call.id}
                  className="flex items-center gap-4 px-6 py-3 transition-colors cursor-default"
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "#FAFAFA"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ""}
                >
                  <div
                    className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: "#F3F4F6", border: "1px solid #E5E7EB" }}
                  >
                    <Phone className="h-3.5 w-3.5" style={{ color: "#6B7280" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium truncate" style={{ color: "#111827" }}>
                      {(call as any).agentName ?? `Agent #${call.agentId}`}
                    </p>
                    <p className="text-[11.5px] font-mono truncate" style={{ color: "#9CA3AF" }}>
                      {call.fromNumber ?? call.toNumber ?? `#${call.id}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {call.durationSeconds != null && (
                      <span className="text-[11.5px] tabular-nums" style={{ color: "#9CA3AF" }}>
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
              <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "#F3F4F6" }}>
                <Phone className="h-4 w-4" style={{ color: "#9CA3AF" }} />
              </div>
              <p className="text-[13px]" style={{ color: "#9CA3AF" }}>No calls yet</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
