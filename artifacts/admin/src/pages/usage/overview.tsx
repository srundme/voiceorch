import { useState, useMemo } from "react";
import { UsageSubNav, UsagePageHeader } from "@/components/usage-layout";
import { useUsageOverview, microsToUsd } from "@/hooks/use-usage-monitor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Mic, Brain, Volume2, AlertTriangle, Activity } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const RANGE_OPTIONS = [
  { label: "Last 7 days", value: 7 },
  { label: "Last 30 days", value: 30 },
  { label: "Last 90 days", value: 90 },
];

const SERVICE_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  stt: { label: "Speech to Text", icon: Mic, color: "#60a5fa" },
  llm: { label: "Language Model", icon: Brain, color: "#a78bfa" },
  tts: { label: "Text to Speech", icon: Volume2, color: "#34d399" },
};

const PIE_COLORS = ["#60a5fa", "#a78bfa", "#34d399", "#f472b6", "#facc15", "#fb7185", "#22d3ee", "#fbbf24"];

export default function UsageOverviewPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useUsageOverview(days);

  const trendData = useMemo(() => {
    const map = new Map<string, { bucket: string; stt: number; tts: number; llm: number }>();
    for (const p of data?.dailyTrend ?? []) {
      const row = map.get(p.bucket) ?? { bucket: p.bucket, stt: 0, tts: 0, llm: 0 };
      const svc = (p.service ?? "") as "stt" | "tts" | "llm";
      if (svc === "stt" || svc === "tts" || svc === "llm") {
        row[svc] = (row[svc] ?? 0) + p.costMicros / 1_000_000;
      }
      map.set(p.bucket, row);
    }
    return Array.from(map.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));
  }, [data]);

  const providerShare = (data?.providerShare ?? []).slice(0, 8).map((p) => ({
    name: p.provider,
    value: p.costMicros / 1_000_000,
  }));

  const combined = data?.combined;
  const usagePct =
    combined && combined.allocatedMicros > 0
      ? Math.min(100, (combined.usedMicros / combined.allocatedMicros) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <UsagePageHeader
        title="Usage Monitoring"
        subtitle="Combined STT, TTS and LLM consumption across the platform"
        actions={
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-[160px]" data-testid="select-range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <UsageSubNav />

      <div className="grid gap-4 md:grid-cols-4">
        <KpiCard
          label="Total spend"
          value={microsToUsd(combined?.usedMicros ?? 0)}
          icon={Activity}
          loading={isLoading}
        />
        <KpiCard
          label="Allocated budget"
          value={microsToUsd(combined?.allocatedMicros ?? 0)}
          icon={Activity}
          loading={isLoading}
          extra={
            combined && combined.allocatedMicros > 0 ? (
              <div className="mt-2">
                <Progress value={usagePct} className="h-1.5" />
                <p className="mt-1 text-[10px] text-muted-foreground">{usagePct.toFixed(1)}% used</p>
              </div>
            ) : null
          }
        />
        <KpiCard
          label="Events"
          value={(combined?.eventCount ?? 0).toLocaleString()}
          icon={Activity}
          loading={isLoading}
        />
        <KpiCard
          label="Failed events"
          value={(combined?.failedCount ?? 0).toLocaleString()}
          icon={AlertTriangle}
          loading={isLoading}
          accent={combined && combined.failedCount > 0 ? "text-red-400" : undefined}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {(["stt", "llm", "tts"] as const).map((svc) => {
          const row = data?.perService.find((s) => s.service === svc);
          const meta = SERVICE_META[svc]!;
          const Icon = meta.icon;
          const pct = row && row.kpis.allocatedMicros > 0
            ? Math.min(100, (row.kpis.usedMicros / row.kpis.allocatedMicros) * 100)
            : 0;
          return (
            <Card key={svc} data-testid={`card-service-${svc}`}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center text-sm">
                  <Icon className="mr-2 h-4 w-4" style={{ color: meta.color }} />
                  {meta.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{microsToUsd(row?.kpis.usedMicros ?? 0)}</p>
                <p className="text-xs text-muted-foreground">
                  of {microsToUsd(row?.kpis.allocatedMicros ?? 0)} allocated
                </p>
                {row && row.kpis.allocatedMicros > 0 ? (
                  <div className="mt-3">
                    <Progress value={pct} className="h-1.5" />
                    <p className="mt-1 text-[10px] text-muted-foreground">{pct.toFixed(1)}% used</p>
                  </div>
                ) : null}
                <p className="mt-3 text-xs text-muted-foreground">
                  {(row?.kpis.eventCount ?? 0).toLocaleString()} events ·{" "}
                  <span className={row && row.kpis.failedCount > 0 ? "text-red-400" : ""}>
                    {row?.kpis.failedCount ?? 0} failed
                  </span>
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Cost over time (USD)</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="stt" stackId="1" stroke="#60a5fa" fill="#60a5fa" fillOpacity={0.5} />
                <Area type="monotone" dataKey="llm" stackId="1" stroke="#a78bfa" fill="#a78bfa" fillOpacity={0.5} />
                <Area type="monotone" dataKey="tts" stackId="1" stroke="#34d399" fill="#34d399" fillOpacity={0.5} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Spend by provider</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={providerShare} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90}>
                  {providerShare.map((_, idx) => (
                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  loading,
  extra,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  loading?: boolean;
  extra?: React.ReactNode;
  accent?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <p className={`text-xl font-bold ${accent ?? ""}`}>{loading ? "…" : value}</p>
        {extra}
      </CardContent>
    </Card>
  );
}
