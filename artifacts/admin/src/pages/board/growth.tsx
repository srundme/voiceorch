import { useMemo } from "react";
import { Link } from "wouter";
import { useBoardGrowth } from "@/hooks/use-admin-api";
import { formatCentsToDollars } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

export default function BoardGrowth() {
  const { data, isLoading } = useBoardGrowth();

  const chart = useMemo(
    () =>
      (data?.byMonth ?? []).map((m: any) => ({
        month: m.month,
        minutes: m.minutes,
        newTenants: m.newTenants,
      })),
    [data],
  );

  const flagship = data?.flagship;
  const flagshipPct =
    flagship && flagship.goal > 0
      ? Math.min(100, Math.round((flagship.currentMonthCalls / flagship.goal) * 100))
      : 0;

  const conv = data?.conversion;
  const topClient = data?.concentration?.topClient;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Growth</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The up-and-to-the-right story: minutes, tenants, conversion, flagship trajectory and revenue concentration.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              POC → Paid conversion
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tabular-nums">{isLoading ? "…" : `${conv?.pocToPaidPct ?? 0}%`}</div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {conv?.payingTenants ?? 0} paying · {conv?.pocTenants ?? 0} POC · {conv?.totalTenants ?? 0} total
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Revenue concentration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tabular-nums">
              {isLoading ? "…" : topClient ? `${topClient.sharePct}%` : "—"}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1 truncate">
              Top client{topClient ? `: ${topClient.name || topClient.email || topClient.clerkId}` : ""} (90d)
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              New tenants (latest month)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tabular-nums">
              {isLoading ? "…" : chart.length ? chart[chart.length - 1].newTenants : 0}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Real signups this month</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Minutes / month + new tenants (12 mo)</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="min" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="ten" orientation="right" tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="ten" dataKey="newTenants" name="New tenants" fill="#a78bfa" opacity={0.6} />
              <Line yAxisId="min" type="monotone" dataKey="minutes" name="Minutes" stroke="#34d399" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Flagship trajectory</CardTitle>
          <CardDescription>
            {flagship
              ? `${flagship.name} → ${Number(flagship.goal).toLocaleString("en-IN")} calls/month goal`
              : "Set a flagship client on the Company Pulse page (Board inputs) to track it here."}
          </CardDescription>
        </CardHeader>
        {flagship ? (
          <CardContent className="space-y-4">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-3xl font-bold font-mono tabular-nums">
                  {Number(flagship.currentMonthCalls).toLocaleString("en-IN")}
                </div>
                <p className="text-[11px] text-muted-foreground">calls this month</p>
              </div>
              <div className="text-right text-sm text-muted-foreground">{flagshipPct}% of goal</div>
            </div>
            <Progress value={flagshipPct} />
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={flagship.byMonth ?? []}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="calls" name="Calls" stroke="#f472b6" strokeWidth={2} dot={{ r: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top clients by usage (90d)</CardTitle>
          <CardDescription>Investors will ask about concentration risk.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Usage spend</TableHead>
                <TableHead className="text-right">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.concentration?.topPayers ?? []).map((u: any) => {
                const all = data?.concentration?.allSpend90dPaise ?? 0;
                const share = all > 0 ? Math.round((u.spendPaise / all) * 1000) / 10 : 0;
                return (
                  <TableRow key={u.clerkId}>
                    <TableCell>
                      <Link href={`/users/${u.clerkId}`} className="text-primary text-xs hover:underline">
                        {u.name || u.email || u.clerkId}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatCentsToDollars(u.spendPaise)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{share}%</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
