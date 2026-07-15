import { useState } from "react";
import { Link } from "wouter";
import {
  useCallVolumeAnalytics,
  type CallVolumePreset,
} from "@/hooks/use-admin-api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const PRESETS: { id: CallVolumePreset; label: string }[] = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

function formatPeriodLabel(period: string, bucket: "day" | "month") {
  if (bucket === "month") return period;
  // YYYY-MM-DD → MM-DD for denser x-axis
  return period.length >= 10 ? period.slice(5) : period;
}

export function CallVolumeChart({
  compact = false,
  defaultPreset = "month",
  showViewAll = false,
}: {
  compact?: boolean;
  defaultPreset?: CallVolumePreset;
  showViewAll?: boolean;
}) {
  const [preset, setPreset] = useState<CallVolumePreset>(defaultPreset);
  const { data, isLoading, isError } = useCallVolumeAnalytics(preset);

  const chartData = (data?.series ?? []).map((p) => ({
    ...p,
    label: formatPeriodLabel(p.period, data?.bucket ?? "day"),
  }));

  const totals = data?.totals ?? { total: 0, completed: 0, failed: 0 };
  const successPct =
    totals.total > 0 ? Math.round((totals.completed / totals.total) * 1000) / 10 : 0;

  return (
    <Card className="border-border shadow-none">
      <CardHeader className={compact ? "pb-2 pt-3 px-4" : undefined}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Call volume
            </CardTitle>
            {!compact ? (
              <CardDescription className="mt-1">
                SnapServe platform calls — total, completed, and failed
              </CardDescription>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1">
              {PRESETS.map((p) => (
                <Button
                  key={p.id}
                  size="sm"
                  variant={preset === p.id ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setPreset(p.id)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            {showViewAll ? (
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" asChild>
                <Link href="/call-analytics">View all →</Link>
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className={compact ? "px-4 pb-3 space-y-3" : "space-y-4"}>
        <div className={`grid gap-3 ${compact ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 md:grid-cols-4"}`}>
          <Kpi label="Total" value={isLoading ? "…" : totals.total.toLocaleString()} />
          <Kpi label="Completed" value={isLoading ? "…" : totals.completed.toLocaleString()} />
          <Kpi label="Failed" value={isLoading ? "…" : totals.failed.toLocaleString()} />
          <Kpi label="Success %" value={isLoading ? "…" : `${successPct}%`} />
        </div>

        <div className={compact ? "h-52" : "h-72"}>
          {isError ? (
            <p className="text-sm text-destructive py-8 text-center">Failed to load call volume</p>
          ) : isLoading ? (
            <p className="text-sm text-muted-foreground animate-pulse py-8 text-center">Loading…</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="total" name="Total" stroke="#60a5fa" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="completed" name="Completed" stroke="#34d399" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="failed" name="Failed" stroke="#f87171" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-bold font-mono tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
