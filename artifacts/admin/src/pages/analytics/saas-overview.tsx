import { useMemo } from "react";
import { Link } from "wouter";
import {
  useAnalyticsOverview,
  useUserGrowthAnalytics,
} from "@/hooks/use-admin-api";
import { useDateRange, formatYmd } from "@/hooks/use-date-range";
import { DateRangeBar } from "@/components/date-range-bar";
import { SectionSubNav } from "@/components/section-subnav";
import { ANALYTICS_TABS } from "@/lib/nav-config";
import { formatCentsToDollars } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

function pctChange(current: number, previous: number): string | null {
  if (previous === 0) return current === 0 ? null : "+∞";
  const p = ((current - previous) / Math.abs(previous)) * 100;
  const sign = p > 0 ? "↑" : p < 0 ? "↓" : "→";
  return `${sign} ${Math.abs(p).toFixed(1)}%`;
}

function Kpi({
  label,
  value,
  delta,
  sub,
}: {
  label: string;
  value: string;
  delta?: string | null;
  sub?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold font-mono tabular-nums">{value}</div>
        {delta && <p className="text-[11px] text-muted-foreground mt-1">{delta} vs compare</p>}
        {sub && !delta && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function SaasOverviewPage() {
  const range = useDateRange({ preset: "last30", compare: "previousPeriod" });
  const compareFrom = range.compareFrom ? formatYmd(range.compareFrom) : null;
  const compareTo = range.compareTo ? formatYmd(range.compareTo) : null;
  const { data, isLoading, dataUpdatedAt } = useAnalyticsOverview(
    range.fromParam,
    range.toParam,
    compareFrom,
    compareTo,
  );
  const growth = useUserGrowthAnalytics(range.fromParam, range.toParam);
  const k = data?.kpis;
  const prev = data?.compare?.totals;

  const moneyChart = useMemo(
    () =>
      (data?.sparkline ?? []).map((d) => ({
        date: d.date.slice(5),
        revenue: Math.round(d.revenue) / 100,
        cost: Math.round(d.cost) / 100,
        profit: Math.round(d.profit) / 100,
      })),
    [data],
  );

  const usageChart = useMemo(
    () =>
      (data?.sparkline ?? []).map((d) => ({
        date: d.date.slice(5),
        calls: d.calls,
        minutes: d.billableMinutes ?? 0,
      })),
    [data],
  );

  const growthChart = useMemo(
    () =>
      (growth.data?.lifecycleSeries ?? []).map((d: { date: string; signups: number; active: number; paying: number }) => ({
        date: String(d.date).slice(5),
        signups: d.signups,
        active: d.active,
        activated: d.paying,
      })),
    [growth.data],
  );

  const costBars = useMemo(
    () =>
      (data?.costBreakdown ?? []).map((r) => ({
        service: r.service.toUpperCase(),
        cost: Math.round(r.costPaise) / 100,
      })),
    [data],
  );

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={ANALYTICS_TABS} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">SaaS Overview</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Executive view of revenue, cost, users, usage, and platform health. Metrics use canonical Daily P&amp;L definitions.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!data?.sparkline?.length}
          onClick={() =>
            downloadCsv(
              `saas-overview-${range.fromParam}-${range.toParam}.csv`,
              ["date", "revenue_inr", "cost_inr", "profit_inr", "calls", "minutes"],
              (data?.sparkline ?? []).map((d) => [
                d.date,
                (d.revenue / 100).toFixed(2),
                (d.cost / 100).toFixed(2),
                (d.profit / 100).toFixed(2),
                d.calls,
                d.billableMinutes ?? "",
              ]),
            )
          }
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      <DateRangeBar range={range} showCompare updatedAt={dataUpdatedAt ? new Date(dataUpdatedAt) : null} />

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Kpi
          label="Revenue"
          value={isLoading ? "…" : formatCentsToDollars(k?.recognizedRevenuePaise ?? 0)}
          delta={prev ? pctChange(k?.recognizedRevenuePaise ?? 0, prev.recognizedRevenuePaise) : null}
        />
        <Kpi
          label="Cost"
          value={isLoading ? "…" : formatCentsToDollars(k?.variableCostPaise ?? 0)}
          delta={prev ? pctChange(k?.variableCostPaise ?? 0, prev.variableCostPaise) : null}
        />
        <Kpi
          label="Gross Profit"
          value={isLoading ? "…" : formatCentsToDollars(k?.grossProfitPaise ?? 0)}
          delta={prev ? pctChange(k?.grossProfitPaise ?? 0, prev.grossProfitPaise) : null}
        />
        <Kpi
          label="Gross Margin"
          value={isLoading ? "…" : `${(k?.grossMarginPct ?? 0).toFixed(1)}%`}
          delta={prev ? pctChange(k?.grossMarginPct ?? 0, prev.grossMarginPct) : null}
        />
        <Kpi label="Active Users" value={isLoading ? "…" : String(k?.activeUsers ?? 0)} />
        <Kpi label="Paying Users" value={isLoading ? "…" : String(k?.payingUsers ?? 0)} />
        <Kpi
          label="Billable Minutes"
          value={isLoading ? "…" : String(k?.billableMinutes ?? 0)}
          delta={prev ? pctChange(k?.billableMinutes ?? 0, prev.billableMinutes) : null}
        />
        <Kpi label="ARPU" value={isLoading ? "…" : formatCentsToDollars(k?.arpuPaise ?? 0)} />
        <Kpi label="Revenue/min" value={isLoading ? "…" : formatCentsToDollars(k?.revenuePerMinPaise ?? 0)} />
        <Kpi label="Cost/min" value={isLoading ? "…" : formatCentsToDollars(k?.costPerMinPaise ?? 0)} />
        <Kpi label="Profit/min" value={isLoading ? "…" : formatCentsToDollars(k?.profitPerMinPaise ?? 0)} />
        <Kpi label="Cash collected" value={isLoading ? "…" : formatCentsToDollars(k?.cashCollectedPaise ?? 0)} sub="Not in margin" />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revenue vs Cost vs Profit</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={moneyChart}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="revenue" name="Revenue ₹" stroke="#34d399" dot={false} />
                <Line type="monotone" dataKey="cost" name="Cost ₹" stroke="#f87171" dot={false} />
                <Line type="monotone" dataKey="profit" name="Profit ₹" stroke="#60a5fa" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Usage — Calls &amp; Minutes</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={usageChart}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="calls" name="Calls" stroke="#a78bfa" dot={false} />
                <Line type="monotone" dataKey="minutes" name="Minutes" stroke="#fbbf24" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">User growth</CardTitle>
          </CardHeader>
          <CardContent className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={growthChart}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="signups" name="Signups" stroke="#60a5fa" dot={false} />
                <Line type="monotone" dataKey="active" name="Active" stroke="#34d399" dot={false} />
                <Line type="monotone" dataKey="activated" name="Paying" stroke="#a78bfa" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cost composition</CardTitle>
          </CardHeader>
          <CardContent className="h-[260px]">
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Call success" value={isLoading ? "…" : `${data?.health?.callSuccessRatePct ?? 0}%`} />
        <Kpi label="Failure rate" value={isLoading ? "…" : `${data?.health?.failureRatePct ?? 0}%`} />
        <Kpi label="Avg duration" value={isLoading ? "…" : `${data?.health?.avgCallDurationSec ?? 0}s`} />
        <Kpi label="Avg latency" value={isLoading ? "…" : `${data?.health?.avgLatencyMs ?? 0} ms`} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Top customers</CardTitle>
          <Button
            variant="outline"
            size="sm"
            disabled={!data?.topCustomers?.length}
            onClick={() =>
              downloadCsv(
                "top-customers.csv",
                ["user", "calls", "minutes", "revenue_inr", "cost_inr", "profit_inr"],
                (data?.topCustomers ?? []).map((r) => [
                  r.label,
                  r.calls,
                  r.minutes,
                  (r.revenuePaise / 100).toFixed(2),
                  (r.costPaise / 100).toFixed(2),
                  (r.profitPaise / 100).toFixed(2),
                ]),
              )
            }
          >
            CSV
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Minutes</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.topCustomers ?? []).map((r) => (
                <TableRow key={r.userId}>
                  <TableCell>
                    <Link href={`/users/${encodeURIComponent(r.userId)}`} className="text-primary hover:underline">
                      {r.label}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.calls}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.minutes}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCentsToDollars(r.revenuePaise)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCentsToDollars(r.costPaise)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCentsToDollars(r.profitPaise)}</TableCell>
                </TableRow>
              ))}
              {!isLoading && !(data?.topCustomers?.length) && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground text-sm">
                    No customer activity in this range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
