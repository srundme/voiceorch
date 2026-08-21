import { useMemo } from "react";
import { useDailyPnl } from "@/hooks/use-admin-api";
import { useDateRange, formatYmd } from "@/hooks/use-date-range";
import { DateRangeBar } from "@/components/date-range-bar";
import { SectionSubNav } from "@/components/section-subnav";
import { ANALYTICS_TABS } from "@/lib/nav-config";
import { formatCentsToDollars } from "@/lib/api";
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
} from "recharts";
import { Download } from "lucide-react";

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold font-mono tabular-nums">{value}</div>
        {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function downloadCsv(days: { date: string; users: number; calls: number; billableMinutes: number; recognizedRevenuePaise: number; variableCostPaise: number; grossProfitPaise: number; grossMarginPct: number }[]) {
  const header = "Date,Users,Calls,Minutes,Revenue_INR,Cost_INR,GrossProfit_INR,Margin_Pct";
  const rows = days.map((d) =>
    [
      d.date,
      d.users,
      d.calls,
      d.billableMinutes,
      (d.recognizedRevenuePaise / 100).toFixed(2),
      (d.variableCostPaise / 100).toFixed(2),
      (d.grossProfitPaise / 100).toFixed(2),
      d.grossMarginPct,
    ].join(","),
  );
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `daily-pnl-${days[0]?.date ?? "export"}-${days[days.length - 1]?.date ?? ""}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DailyPnlPage() {
  const range = useDateRange({ preset: "last30", compare: "previousPeriod" });
  const { data, isLoading, dataUpdatedAt } = useDailyPnl(range.fromParam, range.toParam);
  const totals = data?.totals;

  const chartData = useMemo(
    () =>
      (data?.days ?? []).map((d) => ({
        date: d.date.slice(5),
        revenue: Math.round(d.recognizedRevenuePaise) / 100,
        cost: Math.round(d.variableCostPaise) / 100,
        profit: Math.round(d.grossProfitPaise) / 100,
      })),
    [data],
  );

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={ANALYTICS_TABS} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Daily P&amp;L</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Recognized revenue vs variable cost by day. Cash (recharges) is shown separately and is not mixed into margin.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!data?.days?.length}
          onClick={() => data?.days && downloadCsv(data.days)}
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      <DateRangeBar
        range={range}
        showCompare
        updatedAt={dataUpdatedAt ? new Date(dataUpdatedAt) : null}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="Revenue"
          value={isLoading ? "…" : formatCentsToDollars(totals?.recognizedRevenuePaise ?? 0)}
          sub="Recognized (call_debit)"
        />
        <Kpi
          label="Cost"
          value={isLoading ? "…" : formatCentsToDollars(totals?.variableCostPaise ?? 0)}
          sub={`Usage COGS · FX ${data?.fxUsdToInr ?? "—"}`}
        />
        <Kpi
          label="Gross Profit"
          value={isLoading ? "…" : formatCentsToDollars(totals?.grossProfitPaise ?? 0)}
          sub={`Margin ${totals?.grossMarginPct?.toFixed(1) ?? "0"}%`}
        />
        <Kpi
          label="Billable Minutes"
          value={isLoading ? "…" : String(totals?.billableMinutes ?? 0)}
          sub={`Rev/min ${formatCentsToDollars(totals?.revenuePerMinPaise ?? 0)} · Cost/min ${formatCentsToDollars(totals?.costPerMinPaise ?? 0)}`}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Cash collected" value={isLoading ? "…" : formatCentsToDollars(totals?.cashCollectedPaise ?? 0)} sub="Top-ups (not revenue)" />
        <Kpi label="Calls" value={isLoading ? "…" : String(totals?.calls ?? 0)} />
        <Kpi label="Active users" value={isLoading ? "…" : String(totals?.users ?? 0)} sub="Distinct callers in range" />
        <Kpi
          label="Range"
          value={`${formatYmd(range.from)} → ${formatYmd(range.to)}`}
          sub={`${data?.days?.length ?? 0} days`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revenue vs Cost vs Profit</CardTitle>
        </CardHeader>
        <CardContent className="h-[320px]">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading…</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="revenue" name="Revenue ₹" stroke="#34d399" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="cost" name="Cost ₹" stroke="#f87171" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="profit" name="Gross profit ₹" stroke="#60a5fa" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily breakdown</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Users</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Minutes</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Gross Profit</TableHead>
                <TableHead className="text-right">Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.days ?? []).map((d) => (
                <TableRow key={d.date}>
                  <TableCell className="font-mono text-xs">{d.date}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.users}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.calls}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.billableMinutes}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCentsToDollars(d.recognizedRevenuePaise)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCentsToDollars(d.variableCostPaise)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCentsToDollars(d.grossProfitPaise)}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.grossMarginPct.toFixed(1)}%</TableCell>
                </TableRow>
              ))}
              {!isLoading && !(data?.days?.length) && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground text-sm py-8">
                    No data in this range.
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
