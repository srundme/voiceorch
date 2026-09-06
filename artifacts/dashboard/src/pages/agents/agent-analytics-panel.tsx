/**
 * Agent call analytics — used by Builder → Analytics and /app/analytics/agents/:id.
 */
import { useGetAgentStats } from "@workspace/api-client-react";
import {
  TrendingUp, Phone, Clock, DollarSign, CheckCircle2, XCircle, Zap, ExternalLink,
} from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { format, parseISO } from "date-fns";
import { useChartTheme } from "@/hooks/use-chart-theme";

function StatCard({
  label, value, sub, icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
}) {
  return (
    <div className="p-4 rounded-lg bg-card border border-border">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground bg-muted">
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function LatencyPill({ label, ms }: { label: string; ms: number | null | undefined }) {
  if (ms == null) return null;
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-mono font-medium tabular-nums text-foreground">{ms} ms</span>
    </div>
  );
}

function makeCustomTooltip(bg: string, border: string, text: string, shadow: string) {
  return function CustomTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    return (
      <div
        style={{
          background: bg,
          border: `1px solid ${border}`,
          color: text,
          boxShadow: shadow,
        }}
        className="rounded-lg p-3 text-xs"
      >
        <p className="mb-1.5" style={{ color: text, opacity: 0.6 }}>{label}</p>
        {payload.map((p: any) => (
          <p key={p.name} style={{ color: p.color }} className="flex gap-2 items-center">
            <span className="font-medium">{p.name}:</span>
            <span className="tabular-nums">{p.value}</span>
          </p>
        ))}
      </div>
    );
  };
}

export function AgentAnalyticsPanel({
  agentId,
  embedded = false,
}: {
  agentId: number;
  /** Builder tab: tighter header, no back link */
  embedded?: boolean;
}) {
  const { tickColor, gridColor, tooltipBg, tooltipBorder, tooltipText, tooltipShadow } = useChartTheme();

  const { data: stats, isLoading } = useGetAgentStats(agentId, {
    query: { enabled: agentId > 0, queryKey: ["analytics", "agents", agentId] },
  });

  if (agentId <= 0) {
    return (
      <div className="px-5 py-6 sm:px-8">
        <h2 className="text-[17px] font-semibold tracking-[-0.03em]">{embedded ? "Activity" : "Analytics"}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          Save the agent first to see call volume, success rate, spend, and latency.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4 px-5 py-6 sm:px-8">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-card border border-border rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm px-4">
        No analytics data yet. Place a few calls, then check back.
      </div>
    );
  }

  const chartData = (stats.dailyVolume ?? []).map((d: any) => ({
    date: format(parseISO(d.date), "MMM d"),
    Completed: d.completed,
    Failed: d.failed,
  }));

  const hasLatency = stats.avgSttLatencyMs || stats.avgLlmLatencyMs || stats.avgTtsFirstChunkMs;

  return (
    <div className={embedded ? "space-y-5 px-5 py-6 sm:px-8" : "space-y-6"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-[68ch]">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[17px] font-semibold tracking-[-0.03em]">{embedded ? "Activity" : "Analytics"}</h2>
            <Badge className="text-[10px] bg-muted text-foreground border-border">
              {stats.successRate}% success
            </Badge>
          </div>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Last 30 days for this agent — volume, outcomes, spend, and latency.
          </p>
        </div>
        {embedded && (
          <Button asChild type="button" variant="outline" size="sm" className="h-7 text-[11px] gap-1 shrink-0">
            <Link href="/app/analytics">
              Platform analytics
              <ExternalLink className="h-3 w-3" />
            </Link>
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total calls" value={stats.totalCalls} icon={Phone} />
        <StatCard label="This week" value={stats.callsThisWeek} sub={`${stats.callsThisMonth} this month`} icon={TrendingUp} />
        <StatCard
          label="Avg duration"
          value={stats.avgDurationSeconds != null ? `${Math.floor(stats.avgDurationSeconds / 60)}m ${stats.avgDurationSeconds % 60}s` : "—"}
          icon={Clock}
        />
        <StatCard
          label="Total spend"
          value={`₹${(stats.totalSpendCents / 100).toFixed(2)}`}
          sub="platform fees"
          icon={DollarSign}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="p-4 rounded-lg bg-card border border-border flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
            <CheckCircle2 className="h-4 w-4 text-foreground" />
          </div>
          <div>
            <p className="text-xl font-bold text-foreground tabular-nums">{stats.successfulCalls}</p>
            <p className="text-[11px] text-muted-foreground">Successful calls</p>
          </div>
        </div>
        <div className="p-4 rounded-lg bg-card border border-border flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
            <XCircle className="h-4 w-4 text-foreground" />
          </div>
          <div>
            <p className="text-xl font-bold text-foreground tabular-nums">{stats.failedCalls ?? 0}</p>
            <p className="text-[11px] text-muted-foreground">Failed calls</p>
          </div>
        </div>
      </div>

      {(stats as any).aiEvaluatedCalls > 0 && (
        <div className="p-4 rounded-lg bg-card border border-border">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-muted-foreground">AI goal evaluation</p>
            <span className="text-[10px] text-muted-foreground">{(stats as any).aiEvaluatedCalls} calls evaluated</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="h-2 rounded-full bg-zinc-500 transition-all"
                style={{ width: `${(stats as any).aiPassRate ?? 0}%` }}
              />
            </div>
            <span className="text-sm font-bold tabular-nums min-w-[3rem] text-right text-foreground">
              {(stats as any).aiPassRate ?? 0}%
            </span>
            <span className="text-[11px] text-muted-foreground">PASS</span>
          </div>
        </div>
      )}

      {chartData.length > 0 && (
        <div className="p-4 rounded-lg bg-card border border-border">
          <p className="text-xs font-medium text-muted-foreground mb-4">Daily call volume (last 30 days)</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} barSize={8} barGap={3}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: tickColor }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: tickColor }} tickLine={false} axisLine={false} width={24} />
              <Tooltip content={makeCustomTooltip(tooltipBg, tooltipBorder, tooltipText, tooltipShadow)} />
              <Legend wrapperStyle={{ fontSize: 11, color: tickColor }} />
              <Bar dataKey="Completed" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Failed" fill="hsl(var(--chart-4))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {hasLatency && (
        <div className="p-4 rounded-lg bg-card border border-border">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-xs font-medium text-muted-foreground">Avg latency (rolling)</p>
          </div>
          <LatencyPill label="STT (speech-to-text)" ms={stats.avgSttLatencyMs} />
          <LatencyPill label="LLM (inference)" ms={stats.avgLlmLatencyMs} />
          <LatencyPill label="TTS first chunk" ms={stats.avgTtsFirstChunkMs} />
        </div>
      )}
    </div>
  );
}
