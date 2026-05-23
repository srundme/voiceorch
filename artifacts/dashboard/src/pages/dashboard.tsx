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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  switch (status) {
    case "completed":
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full"
          style={{ background: "rgba(16,185,129,0.15)", color: "#10B981", border: "1px solid rgba(16,185,129,0.2)" }}>
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Completed
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full"
          style={{ background: "rgba(239,68,68,0.15)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.2)" }}>
          <span className="h-1.5 w-1.5 rounded-full bg-red-400" />Failed
        </span>
      );
    case "in_progress":
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full"
          style={{ background: "rgba(245,158,11,0.15)", color: "#F59E0B", border: "1px solid rgba(245,158,11,0.2)" }}>
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />In Progress
        </span>
      );
    case "pending":
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full"
          style={{ background: "rgba(148,163,184,0.12)", color: "#94A3B8", border: "1px solid rgba(148,163,184,0.15)" }}>
          Pending
        </span>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};

const STATUS_COLORS: Record<string, string> = {
  completed:   "#7C3AED",
  failed:      "#EF4444",
  in_progress: "#3B82F6",
  pending:     "#94A3B8",
  cancelled:   "#10B981",
};

/* ── Stat cards config ───────────────────────────────────────────────────── */
const STAT_CARDS = [
  {
    title:    "Total Agents",
    icon:     Users,
    color:    "#7C3AED",
    bgGrad:   "rgba(124,58,237,0.18), rgba(124,58,237,0.05)",
    borderC:  "rgba(124,58,237,0.25)",
    accentC:  "#7C3AED",
    testId:   "text-total-agents",
    getValue: (stats: any) => stats?.totalAgents ?? 0,
    getSub:   (stats: any) => `${stats?.activeAgents ?? 0} active`,
  },
  {
    title:    "Calls Today",
    icon:     Phone,
    color:    "#3B82F6",
    bgGrad:   "rgba(59,130,246,0.18), rgba(59,130,246,0.05)",
    borderC:  "rgba(59,130,246,0.25)",
    accentC:  "#3B82F6",
    testId:   "text-calls-today",
    getValue: (stats: any) => stats?.callsToday ?? 0,
    getSub:   (stats: any) => `${stats?.callsThisWeek ?? 0} this week`,
  },
  {
    title:    "Success Rate",
    icon:     CheckCircle2,
    color:    "#10B981",
    bgGrad:   "rgba(16,185,129,0.18), rgba(16,185,129,0.05)",
    borderC:  "rgba(16,185,129,0.25)",
    accentC:  "#10B981",
    testId:   "text-success-rate",
    getValue: (stats: any) => stats?.successRate ? `${stats.successRate.toFixed(1)}%` : "0%",
    getSub:   (_: any)     => "completed / total",
  },
  {
    title:    "Avg Duration",
    icon:     Clock,
    color:    "#F59E0B",
    bgGrad:   "rgba(245,158,11,0.18), rgba(245,158,11,0.05)",
    borderC:  "rgba(245,158,11,0.25)",
    accentC:  "#F59E0B",
    testId:   "text-avg-duration",
    getValue: (stats: any) => formatDuration(stats?.avgDurationSeconds ?? 0),
    getSub:   (_: any)     => "per successful call",
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
      name:   s.status.replace("_", " ").toUpperCase(),
      value:  s.count,
      status: s.status,
    }));
  }, [callsByStatus]);

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 animate-fade-in">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight" style={{ color: "#F8FAFC" }}>
            Dashboard
          </h1>
          <p className="text-[14px] mt-1" style={{ color: "#94A3B8" }}>
            Overview of your AI voice agents and call volume.
          </p>
        </div>
        <Link href="/app">
          <Button className="gap-2" data-testid="button-create-agent"
            style={{ background: "linear-gradient(135deg, #7C3AED 0%, #8B5CF6 100%)", boxShadow: "0 0 20px rgba(124,58,237,0.3)", border: "none", color: "white" }}>
            <Users className="h-4 w-4" /> Manage Agents
          </Button>
        </Link>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {STAT_CARDS.map(({ title, icon: Icon, color, bgGrad, borderC, accentC, testId, getValue, getSub }) => (
          <div key={title} className="card-hover rounded-2xl overflow-hidden relative"
            style={{
              background: `linear-gradient(180deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0.01) 100%), #131A2A`,
              border:     `1px solid rgba(255,255,255,0.06)`,
              boxShadow:  "0 1px 3px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
            }}>
            {/* Top accent line */}
            <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl"
              style={{ background: `linear-gradient(90deg, ${color}90, ${color}20, transparent)` }} />

            <div className="p-5 pt-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: "#94A3B8" }}>
                  {title}
                </span>
                <div className="h-8 w-8 rounded-xl flex items-center justify-center"
                  style={{ background: `linear-gradient(135deg, ${bgGrad})`, border: `1px solid ${borderC}` }}>
                  <Icon className="h-[15px] w-[15px]" style={{ color }} />
                </div>
              </div>

              {statsLoading ? (
                <div className="space-y-2">
                  <div className="h-8 w-24 rounded-lg animate-pulse" style={{ background: "rgba(255,255,255,0.07)" }} />
                  <div className="h-3.5 w-20 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
                </div>
              ) : (
                <>
                  <div className="text-[30px] font-bold leading-none mb-1.5 tabular-nums" style={{ color: "#F8FAFC" }} data-testid={testId}>
                    {getValue(stats)}
                  </div>
                  <p className="text-[12px]" style={{ color: "#94A3B8" }}>{getSub(stats)}</p>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Charts row ── */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        {/* Call volume area chart */}
        <Card className="col-span-4">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-[15px] font-semibold" style={{ color: "#F8FAFC" }}>Call Volume</CardTitle>
                <CardDescription className="text-[12.5px] mt-0.5">Daily completed vs failed calls — last 14 days</CardDescription>
              </div>
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "#94A3B8" }}>
                  <span className="h-2 w-2 rounded-full" style={{ background: "#7C3AED" }} />Completed
                </span>
                <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "#94A3B8" }}>
                  <span className="h-2 w-2 rounded-full" style={{ background: "#EF4444" }} />Failed
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pl-2">
            {dailyVolumeLoading ? (
              <div className="h-[280px] flex items-center justify-center">
                <div className="h-[240px] w-full rounded-xl animate-pulse" style={{ background: "rgba(255,255,255,0.04)" }} />
              </div>
            ) : chartData.length > 0 ? (
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#7C3AED" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#7C3AED" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorFailed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#EF4444" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="formattedDate"
                      stroke="transparent"
                      tick={{ fill: "#94A3B8", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="transparent"
                      tick={{ fill: "#94A3B8", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={32}
                    />
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                    <Tooltip
                      contentStyle={{
                        background:   "#0D1322",
                        border:       "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "12px",
                        color:        "#F8FAFC",
                        fontSize:     "12px",
                        boxShadow:    "0 8px 24px rgba(0,0,0,0.5)",
                      }}
                      itemStyle={{ color: "#F8FAFC" }}
                      cursor={{ stroke: "rgba(255,255,255,0.08)", strokeWidth: 1 }}
                    />
                    <Area type="monotone" dataKey="completed" stroke="#7C3AED" fillOpacity={1} fill="url(#colorCompleted)" strokeWidth={1.5} dot={false} />
                    <Area type="monotone" dataKey="failed"    stroke="#EF4444" fillOpacity={1} fill="url(#colorFailed)"    strokeWidth={1.5} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[280px] flex flex-col items-center justify-center gap-3">
                <div className="h-12 w-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <Activity className="h-5 w-5" style={{ color: "#94A3B8" }} />
                </div>
                <p className="text-[13px]" style={{ color: "#94A3B8" }}>No call data yet</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status pie chart */}
        <Card className="col-span-3">
          <CardHeader className="pb-4">
            <CardTitle className="text-[15px] font-semibold" style={{ color: "#F8FAFC" }}>Status Breakdown</CardTitle>
            <CardDescription className="text-[12.5px] mt-0.5">Distribution of calls by status</CardDescription>
          </CardHeader>
          <CardContent>
            {pieData.length > 0 ? (
              <div className="flex flex-col gap-5">
                <div className="h-[180px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={52}
                        outerRadius={80}
                        paddingAngle={3}
                        dataKey="value"
                        strokeWidth={0}
                      >
                        {pieData.map((entry) => (
                          <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#94A3B8"} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background:   "#0D1322",
                          border:       "1px solid rgba(255,255,255,0.1)",
                          borderRadius: "12px",
                          color:        "#F8FAFC",
                          fontSize:     "12px",
                          boxShadow:    "0 8px 24px rgba(0,0,0,0.5)",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* Legend */}
                <div className="space-y-2">
                  {pieData.map(entry => {
                    const total = pieData.reduce((s, e) => s + e.value, 0);
                    const pct = total ? Math.round((entry.value / total) * 100) : 0;
                    return (
                      <div key={entry.status} className="flex items-center gap-2.5">
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: STATUS_COLORS[entry.status] ?? "#94A3B8" }} />
                        <span className="text-[12px] flex-1 capitalize" style={{ color: "#94A3B8" }}>
                          {entry.name.toLowerCase()}
                        </span>
                        <span className="text-[12px] font-semibold tabular-nums" style={{ color: "#F8FAFC" }}>
                          {entry.value}
                        </span>
                        <span className="text-[11px] w-8 text-right" style={{ color: "#94A3B8" }}>{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="h-[220px] flex flex-col items-center justify-center gap-3">
                <div className="h-12 w-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <TrendingUp className="h-5 w-5" style={{ color: "#94A3B8" }} />
                </div>
                <p className="text-[13px]" style={{ color: "#94A3B8" }}>No status data yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Recent calls ── */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-[15px] font-semibold" style={{ color: "#F8FAFC" }}>Recent Calls</CardTitle>
              <CardDescription className="text-[12.5px] mt-0.5">Latest voice interactions across all agents</CardDescription>
            </div>
            <Link href="/app/calls">
              <button className="flex items-center gap-1.5 text-[12px] font-medium transition-colors"
                style={{ color: "#7C3AED" }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#8B5CF6"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#7C3AED"}>
                View all <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {recentCallsLoading ? (
            <div className="px-6 pb-6 space-y-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-40 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.06)" }} />
                    <div className="h-3 w-24 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.04)" }} />
                  </div>
                  <div className="h-5 w-16 rounded-full animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
                </div>
              ))}
            </div>
          ) : recentCalls && recentCalls.length > 0 ? (
            <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
              {recentCalls.slice(0, 6).map(call => (
                <div key={call.id} className="flex items-center gap-4 px-6 py-3.5 transition-colors"
                  style={{}}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ""}>
                  <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.18)" }}>
                    <Phone className="h-3.5 w-3.5" style={{ color: "#8B5CF6" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium truncate" style={{ color: "#F8FAFC" }}>
                      {(call as any).agentName ?? `Agent #${call.agentId}`}
                    </p>
                    <p className="text-[11.5px] font-mono truncate" style={{ color: "#94A3B8" }}>
                      {call.fromNumber ?? call.toNumber ?? `#${call.id}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {call.durationSeconds != null && (
                      <span className="text-[11.5px] tabular-nums" style={{ color: "#94A3B8" }}>
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
              <div className="h-12 w-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.04)" }}>
                <Phone className="h-5 w-5" style={{ color: "#94A3B8" }} />
              </div>
              <p className="text-[13px]" style={{ color: "#94A3B8" }}>No calls yet</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
