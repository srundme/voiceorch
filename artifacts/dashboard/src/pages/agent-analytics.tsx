import { useParams, Link } from "wouter";
import { useGetAgentStats } from "@workspace/api-client-react";
import { ArrowLeft, TrendingUp, Phone, Clock, DollarSign, CheckCircle2, XCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { format, parseISO } from "date-fns";
import { useChartTheme } from "@/hooks/use-chart-theme";

function StatCard({
  label, value, sub, icon: Icon, accent = "zinc",
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  accent?: "zinc" | "zinc" | "zinc" | "red";
}) {
  const colors: Record<string, string> = {
    blue:    "text-muted-foreground bg-muted",
    amber:   "text-muted-foreground bg-muted",
    red:     "text-muted-foreground bg-muted",
    zinc:    "text-muted-foreground bg-muted",
  };
  return (
    <div className="p-4 rounded-lg bg-card border border-border">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className={`h-7 w-7 rounded-md flex items-center justify-center ${colors[accent]}`}>
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
  const color = ms < 200 ? "text-foreground" : ms < 500 ? "text-foreground" : "text-foreground";
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-mono font-medium tabular-nums ${color}`}>{ms} ms</span>
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

export default function AgentAnalyticsPage() {
  const params = useParams<{ id: string }>();
  const agentId = parseInt(params.id ?? "0", 10);
  const { tickColor, gridColor, tooltipBg, tooltipBorder, tooltipText, tooltipShadow } = useChartTheme();

  const { data: stats, isLoading } = useGetAgentStats(agentId, {
    query: { enabled: !!agentId, queryKey: ["analytics", "agents", agentId] },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
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
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Agent not found or no data available.
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
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
        <Link href="/app/analytics">
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-base font-semibold text-foreground">{stats.name}</h1>
          <p className="text-xs text-muted-foreground">Agent analytics · last 30 days</p>
        </div>
        <Badge className={`ml-auto text-[10px] ${stats.successRate >= 90 ? "bg-muted text-foreground border-border" : stats.successRate >= 70 ? "bg-muted text-foreground border-border" : "bg-muted text-foreground border-border"}`}>
          {stats.successRate}% success
        </Badge>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* KPI grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total calls" value={stats.totalCalls} icon={Phone} accent="zinc" />
          <StatCard label="This week" value={stats.callsThisWeek} sub={`${stats.callsThisMonth} this month`} icon={TrendingUp} accent="zinc" />
          <StatCard
            label="Avg duration"
            value={stats.avgDurationSeconds != null ? `${Math.floor(stats.avgDurationSeconds / 60)}m ${stats.avgDurationSeconds % 60}s` : "—"}
            icon={Clock}
            accent="zinc"
          />
          <StatCard
            label="Total spend"
            value={`$${(stats.totalSpendCents / 100).toFixed(2)}`}
            sub="platform fees"
            icon={DollarSign}
            accent="zinc"
          />
        </div>

        {/* Success / fail breakdown */}
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

        {/* AI success evaluation */}
        {(stats as any).aiEvaluatedCalls > 0 && (
          <div className="p-4 rounded-lg bg-card border border-border">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-muted-foreground">AI goal evaluation</p>
              <span className="text-[10px] text-muted-foreground">{(stats as any).aiEvaluatedCalls} calls evaluated</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                <div
                  className={`h-2 rounded-full transition-all ${(stats as any).aiPassRate >= 70 ? "bg-zinc-500" : (stats as any).aiPassRate >= 50 ? "bg-zinc-500" : "bg-foreground"}`}
                  style={{ width: `${(stats as any).aiPassRate ?? 0}%` }}
                />
              </div>
              <span className={`text-sm font-bold tabular-nums min-w-[3rem] text-right ${(stats as any).aiPassRate >= 70 ? "text-foreground" : (stats as any).aiPassRate >= 50 ? "text-foreground" : "text-foreground"}`}>
                {(stats as any).aiPassRate ?? 0}%
              </span>
              <span className="text-[11px] text-muted-foreground">PASS</span>
            </div>
          </div>
        )}

        {/* Daily volume chart */}
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

        {/* Latency breakdown */}
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
    </div>
  );
}
