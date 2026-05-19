import { useParams, Link } from "wouter";
import { useGetAgentStats } from "@workspace/api-client-react";
import { ArrowLeft, TrendingUp, Phone, Clock, DollarSign, CheckCircle2, XCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { format, parseISO } from "date-fns";

function StatCard({
  label, value, sub, icon: Icon, accent = "zinc",
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  accent?: "emerald" | "blue" | "amber" | "red" | "zinc";
}) {
  const colors: Record<string, string> = {
    emerald: "text-emerald-400 bg-emerald-500/10",
    blue:    "text-blue-400 bg-blue-500/10",
    amber:   "text-amber-400 bg-amber-500/10",
    red:     "text-red-400 bg-red-500/10",
    zinc:    "text-zinc-400 bg-zinc-800",
  };
  return (
    <div className="p-4 rounded-lg bg-zinc-900 border border-zinc-800">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs text-zinc-500">{label}</p>
        <div className={`h-7 w-7 rounded-md flex items-center justify-center ${colors[accent]}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <p className="text-2xl font-bold text-white tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function LatencyPill({ label, ms }: { label: string; ms: number | null | undefined }) {
  if (ms == null) return null;
  const color = ms < 200 ? "text-emerald-400" : ms < 500 ? "text-amber-400" : "text-red-400";
  return (
    <div className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`text-xs font-mono font-medium tabular-nums ${color}`}>{ms} ms</span>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-xs shadow-xl">
      <p className="text-zinc-400 mb-1.5">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }} className="flex gap-2 items-center">
          <span className="font-medium">{p.name}:</span>
          <span className="tabular-nums">{p.value}</span>
        </p>
      ))}
    </div>
  );
};

export default function AgentAnalyticsPage() {
  const params = useParams<{ id: string }>();
  const agentId = parseInt(params.id ?? "0", 10);

  const { data: stats, isLoading } = useGetAgentStats(agentId, {
    query: { enabled: !!agentId, queryKey: ["analytics", "agents", agentId] },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-zinc-900 border border-zinc-800 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-500 text-sm">
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
      <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800 shrink-0">
        <Link href="/app/analytics">
          <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-base font-semibold text-white">{stats.name}</h1>
          <p className="text-xs text-zinc-500">Agent analytics · last 30 days</p>
        </div>
        <Badge className={`ml-auto text-[10px] ${stats.successRate >= 90 ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : stats.successRate >= 70 ? "bg-amber-500/15 text-amber-400 border-amber-500/30" : "bg-red-500/15 text-red-400 border-red-500/30"}`}>
          {stats.successRate}% success
        </Badge>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* KPI grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total calls" value={stats.totalCalls} icon={Phone} accent="zinc" />
          <StatCard label="This week" value={stats.callsThisWeek} sub={`${stats.callsThisMonth} this month`} icon={TrendingUp} accent="blue" />
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
            accent="amber"
          />
        </div>

        {/* Success / fail breakdown */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-4 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-xl font-bold text-emerald-400 tabular-nums">{stats.successfulCalls}</p>
              <p className="text-[11px] text-zinc-500">Successful calls</p>
            </div>
          </div>
          <div className="p-4 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
              <XCircle className="h-4 w-4 text-red-400" />
            </div>
            <div>
              <p className="text-xl font-bold text-red-400 tabular-nums">{stats.failedCalls ?? 0}</p>
              <p className="text-[11px] text-zinc-500">Failed calls</p>
            </div>
          </div>
        </div>

        {/* Daily volume chart */}
        {chartData.length > 0 && (
          <div className="p-4 rounded-lg bg-zinc-900 border border-zinc-800">
            <p className="text-xs font-medium text-zinc-400 mb-4">Daily call volume (last 30 days)</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} barSize={8} barGap={3}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} width={24} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#71717a" }} />
                <Bar dataKey="Completed" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Failed" fill="#ef4444" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Latency breakdown */}
        {hasLatency && (
          <div className="p-4 rounded-lg bg-zinc-900 border border-zinc-800">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-3.5 h-3.5 text-zinc-500" />
              <p className="text-xs font-medium text-zinc-400">Avg latency (rolling)</p>
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
