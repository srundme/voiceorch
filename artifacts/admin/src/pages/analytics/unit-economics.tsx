import { useMemo } from "react";
import { useUnitEconomics } from "@/hooks/use-admin-api";
import { useDateRange } from "@/hooks/use-date-range";
import { DateRangeBar } from "@/components/date-range-bar";
import { SectionSubNav } from "@/components/section-subnav";
import { ANALYTICS_TABS } from "@/lib/nav-config";
import { formatCentsToDollars } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  BarChart,
  Bar,
} from "recharts";
import { Download } from "lucide-react";

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold font-mono tabular-nums">{value}</div>
        {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function UnitEconomicsPage() {
  const range = useDateRange({ preset: "last30", compare: "none" });
  const { data, isLoading, dataUpdatedAt } = useUnitEconomics(range.fromParam, range.toParam);
  const k = data?.kpis;

  const series = useMemo(
    () =>
      (data?.series ?? []).map((d) => ({
        date: d.date.slice(5),
        revenuePerMin: d.revenuePerMinPaise / 100,
        costPerMin: d.costPerMinPaise / 100,
        profitPerMin: d.profitPerMinPaise / 100,
        margin: d.grossMarginPct,
      })),
    [data],
  );

  const costBars = useMemo(
    () =>
      (data?.costBreakdown ?? []).map((r) => ({
        service: r.service.toUpperCase(),
        cost: r.costPaise / 100,
      })),
    [data],
  );

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={ANALYTICS_TABS} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Unit Economics</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Revenue/min, cost/min, profit/min, ARPU, and per-active-user economics from canonical P&amp;L definitions.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!data?.series?.length}
          onClick={() =>
            downloadCsv(
              `unit-economics-${range.fromParam}-${range.toParam}.csv`,
              ["date", "revenue_per_min", "cost_per_min", "profit_per_min", "margin_pct"],
              (data?.series ?? []).map((d) => [
                d.date,
                (d.revenuePerMinPaise / 100).toFixed(4),
                (d.costPerMinPaise / 100).toFixed(4),
                (d.profitPerMinPaise / 100).toFixed(4),
                d.grossMarginPct,
              ]),
            )
          }
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      <DateRangeBar range={range} showCompare={false} updatedAt={dataUpdatedAt ? new Date(dataUpdatedAt) : null} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Revenue / min" value={isLoading ? "…" : formatCentsToDollars(k?.revenuePerMinPaise ?? 0)} />
        <Kpi label="Cost / min" value={isLoading ? "…" : formatCentsToDollars(k?.costPerMinPaise ?? 0)} />
        <Kpi label="Profit / min" value={isLoading ? "…" : formatCentsToDollars(k?.profitPerMinPaise ?? 0)} />
        <Kpi label="Gross margin" value={isLoading ? "…" : `${(k?.grossMarginPct ?? 0).toFixed(1)}%`} />
        <Kpi label="ARPU" value={isLoading ? "…" : formatCentsToDollars(k?.arpuPaise ?? 0)} sub={`${k?.payingUsers ?? 0} paying`} />
        <Kpi
          label="Revenue / active user"
          value={isLoading ? "…" : formatCentsToDollars(k?.revenuePerActiveUserPaise ?? 0)}
          sub={`${k?.activeUsers ?? 0} active`}
        />
        <Kpi label="Cost / active user" value={isLoading ? "…" : formatCentsToDollars(k?.costPerActiveUserPaise ?? 0)} />
        <Kpi label="Billable minutes" value={isLoading ? "…" : String(k?.billableMinutes ?? 0)} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Per-minute trends</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="revenuePerMin" name="Rev/min ₹" stroke="#34d399" dot={false} />
                <Line type="monotone" dataKey="costPerMin" name="Cost/min ₹" stroke="#f87171" dot={false} />
                <Line type="monotone" dataKey="profitPerMin" name="Profit/min ₹" stroke="#60a5fa" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cost composition</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={costBars}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="service" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="cost" name="Cost ₹" fill="#f87171" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
