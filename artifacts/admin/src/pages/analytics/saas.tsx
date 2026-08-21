import {
  useUserGrowthAnalytics,
  useActivationAnalytics,
  useRetentionAnalytics,
  useAgentAnalytics,
  useProviderAnalytics,
} from "@/hooks/use-admin-api";
import { useDateRange } from "@/hooks/use-date-range";
import { DateRangeBar } from "@/components/date-range-bar";
import { SectionSubNav } from "@/components/section-subnav";
import { ANALYTICS_TABS } from "@/lib/nav-config";
import { formatCentsToDollars } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv";
import { Download } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar,
} from "recharts";

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

function useAnalyticsPage() {
  return useDateRange({ preset: "last30", compare: "previousPeriod" });
}

export function UserGrowthPage() {
  const range = useAnalyticsPage();
  const { data, isLoading, dataUpdatedAt } = useUserGrowthAnalytics(range.fromParam, range.toParam);
  const k = data?.kpis;

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={ANALYTICS_TABS} />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">User Growth</h1>
          <p className="text-sm text-muted-foreground mt-1">Signups → activated → active → paying. Excludes test users.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!data?.signupSeries?.length}
          onClick={() =>
            downloadCsv(
              "user-growth.csv",
              ["date", "signups"],
              (data?.signupSeries ?? []).map((r: { date: string; count: number }) => [r.date, r.count]),
            )
          }
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>
      <DateRangeBar range={range} showCompare updatedAt={dataUpdatedAt ? new Date(dataUpdatedAt) : null} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="New Signups" value={isLoading ? "…" : String(k?.newSignups ?? 0)} />
        <Kpi label="Activated" value={isLoading ? "…" : String(k?.activated ?? 0)} sub={`${k?.activationRatePct ?? 0}% of signups`} />
        <Kpi label="Active" value={isLoading ? "…" : String(k?.active ?? 0)} />
        <Kpi label="Paying" value={isLoading ? "…" : String(k?.paying ?? 0)} />
        <Kpi label="Returning" value={isLoading ? "…" : String(k?.returning ?? 0)} />
        <Kpi label="Churned" value={isLoading ? "…" : String(k?.churned ?? 0)} />
        <Kpi label="Dormant" value={isLoading ? "…" : String(k?.dormant ?? 0)} />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">New signups</CardTitle></CardHeader>
          <CardContent className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.signupSeries ?? []}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="count" name="Signups" stroke="#60a5fa" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Lifecycle</CardTitle></CardHeader>
          <CardContent className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.lifecycleSeries ?? []}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="signups" stroke="#60a5fa" dot={false} />
                <Line type="monotone" dataKey="active" stroke="#34d399" dot={false} />
                <Line type="monotone" dataKey="paying" stroke="#a78bfa" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Growth funnel</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            {(data?.funnel ?? []).map((s: { stage: string; users: number }, i: number, arr: { users: number }[]) => {
              const prev = i === 0 ? s.users : arr[i - 1]!.users;
              const conv = prev > 0 ? ((s.users / prev) * 100).toFixed(1) : "0";
              return (
                <div key={s.stage} className="flex items-center gap-3 text-sm">
                  <span className="w-28 font-medium">{s.stage}</span>
                  <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${Math.min(100, Number(conv))}%` }} />
                  </div>
                  <span className="font-mono tabular-nums w-16 text-right">{s.users}</span>
                  {i > 0 && <span className="text-xs text-muted-foreground w-14 text-right">{conv}%</span>}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function ActivationPage() {
  const range = useAnalyticsPage();
  const { data, isLoading, dataUpdatedAt } = useActivationAnalytics(range.fromParam, range.toParam);

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={ANALYTICS_TABS} />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Activation</h1>
          <p className="text-sm text-muted-foreground mt-1">Signup cohort funnel through paid usage.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!data?.stages?.length}
          onClick={() =>
            downloadCsv(
              "activation-funnel.csv",
              ["stage", "users", "conversion_pct", "dropoff_pct"],
              (data?.stages ?? []).map((s: { stage: string; users: number; conversionPct: number; dropoffPct: number }) => [
                s.stage,
                s.users,
                s.conversionPct,
                s.dropoffPct,
              ]),
            )
          }
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>
      <DateRangeBar range={range} showCompare updatedAt={dataUpdatedAt ? new Date(dataUpdatedAt) : null} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Kpi label="Median → agent" value={isLoading ? "…" : `${data?.speed?.medianHoursToAgent?.toFixed?.(1) ?? "—"} h`} />
        <Kpi label="Median → first call" value={isLoading ? "…" : `${data?.speed?.medianHoursToFirstCall?.toFixed?.(1) ?? "—"} h`} />
        <Kpi label="Median → paid" value={isLoading ? "…" : `${data?.speed?.medianHoursToPaid?.toFixed?.(1) ?? "—"} h`} />
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Funnel</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Users</TableHead>
                <TableHead className="text-right">Conversion</TableHead>
                <TableHead className="text-right">Drop-off</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.stages ?? []).map((s: { stage: string; users: number; conversionPct: number; dropoffPct: number }) => (
                <TableRow key={s.stage}>
                  <TableCell>{s.stage}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.users}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.conversionPct}%</TableCell>
                  <TableCell className="text-right tabular-nums">{s.dropoffPct}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function RetentionCohortsPage() {
  const { data, isLoading, dataUpdatedAt } = useRetentionAnalytics();
  const weekCols = [0, 1, 2, 3, 4, 5, 6, 7, 8];

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={ANALYTICS_TABS} />
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Retention</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Weekly signup cohorts. Cell = % of cohort with a call in that week.
          {dataUpdatedAt ? ` · Updated ${Math.max(0, Math.round((Date.now() - dataUpdatedAt) / 60000))} min ago` : ""}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="D1 retention" value={isLoading ? "…" : `${data?.kpis?.d1RetentionPct ?? 0}%`} />
        <Kpi label="D7 retention" value={isLoading ? "…" : `${data?.kpis?.d7RetentionPct ?? 0}%`} />
        <Kpi label="D30 retention" value={isLoading ? "…" : `${data?.kpis?.d30RetentionPct ?? 0}%`} />
      </div>
      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cohort</TableHead>
                <TableHead className="text-right">Size</TableHead>
                {weekCols.map((w) => (
                  <TableHead key={w} className="text-right">W{w}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.cohorts ?? []).map((c: { cohortWeek: string; size: number; weeks: Record<number, number> }) => (
                <TableRow key={c.cohortWeek}>
                  <TableCell className="font-mono text-xs">{c.cohortWeek}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.size}</TableCell>
                  {weekCols.map((w) => (
                    <TableCell key={w} className="text-right tabular-nums text-xs">
                      {c.weeks[w] != null ? `${c.weeks[w]}%` : "—"}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {!isLoading && !(data?.cohorts?.length) && (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-muted-foreground py-8 text-sm">No cohort data.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Board retention deep-dive still at <Link href="/board/retention" className="text-primary hover:underline">/board/retention</Link>.
      </p>
    </div>
  );
}

export function AgentAnalyticsPage() {
  const range = useAnalyticsPage();
  const { data, isLoading, dataUpdatedAt } = useAgentAnalytics(range.fromParam, range.toParam);

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={ANALYTICS_TABS} />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Agent Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Calls, minutes, revenue, cost and profit by agent.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!data?.agents?.length}
          onClick={() =>
            downloadCsv(
              "agent-analytics.csv",
              ["agent", "owner", "calls", "minutes", "revenue_inr", "cost_inr", "profit_inr", "fail_pct"],
              (data?.agents ?? []).map((a: any) => [
                a.agentName,
                a.ownerEmail ?? a.ownerId ?? "",
                a.calls,
                a.minutes,
                ((a.revenuePaise ?? 0) / 100).toFixed(2),
                ((a.costPaise ?? 0) / 100).toFixed(2),
                ((a.profitPaise ?? 0) / 100).toFixed(2),
                a.failureRatePct,
              ]),
            )
          }
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>
      <DateRangeBar range={range} showCompare updatedAt={dataUpdatedAt ? new Date(dataUpdatedAt) : null} />
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Total agents" value={isLoading ? "…" : String(data?.kpis?.totalAgents ?? 0)} />
        <Kpi label="Active in range" value={isLoading ? "…" : String(data?.kpis?.activeAgents ?? 0)} />
        <Kpi label="New in range" value={isLoading ? "…" : String(data?.kpis?.newAgents ?? 0)} />
      </div>
      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Minutes</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Fail %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.agents ?? []).map((a: any) => (
                <TableRow key={a.agentId}>
                  <TableCell>
                    {a.ownerId ? (
                      <Link href={`/users/${a.ownerId}/agents/${a.agentId}`} className="text-primary hover:underline">
                        {a.agentName}
                      </Link>
                    ) : a.agentName}
                  </TableCell>
                  <TableCell className="text-xs">{a.ownerEmail ?? a.ownerName ?? a.ownerId ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.calls}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.minutes}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCentsToDollars(a.revenuePaise)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCentsToDollars(a.costPaise)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCentsToDollars(a.profitPaise)}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.failureRatePct}%</TableCell>
                </TableRow>
              ))}
              {!isLoading && !(data?.agents?.length) && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8 text-sm">No agent activity in range.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function ProviderAnalyticsPage() {
  const range = useAnalyticsPage();
  const { data, isLoading, dataUpdatedAt } = useProviderAnalytics(range.fromParam, range.toParam);

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={ANALYTICS_TABS} />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Provider Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            STT / TTS / LLM usage and estimated COGS (FX {data?.fxUsdToInr ?? "—"}).
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!data?.providers?.length}
          onClick={() =>
            downloadCsv(
              "provider-analytics.csv",
              ["service", "provider", "events", "fail_pct", "cost_inr"],
              (data?.providers ?? []).map((p: any) => [
                p.service,
                p.provider,
                p.events,
                p.failureRatePct,
                ((p.costPaise ?? 0) / 100).toFixed(2),
              ]),
            )
          }
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>
      <DateRangeBar range={range} showCompare updatedAt={dataUpdatedAt ? new Date(dataUpdatedAt) : null} />
      <Kpi label="Total variable cost" value={isLoading ? "…" : formatCentsToDollars(data?.totalCostPaise ?? 0)} />
      <Card>
        <CardHeader><CardTitle className="text-base">Cost by provider</CardTitle></CardHeader>
        <CardContent className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={(data?.providers ?? []).slice(0, 12).map((p: any) => ({
              name: `${p.service}/${p.provider}`,
              cost: p.costPaise / 100,
            }))}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-25} textAnchor="end" height={70} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="cost" name="Cost ₹" fill="#f87171" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead className="text-right">Events</TableHead>
                <TableHead className="text-right">Fail %</TableHead>
                <TableHead className="text-right">Minutes</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Latency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.providers ?? []).map((p: any) => (
                <TableRow key={`${p.service}-${p.provider}`}>
                  <TableCell className="uppercase text-xs">{p.service}</TableCell>
                  <TableCell className="font-mono text-xs">{p.provider}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.events}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.failureRatePct}%</TableCell>
                  <TableCell className="text-right tabular-nums">{p.minutes}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.tokens}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCentsToDollars(p.costPaise)}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.avgLatencyMs != null ? `${p.avgLatencyMs} ms` : "—"}</TableCell>
                </TableRow>
              ))}
              {!isLoading && !(data?.providers?.length) && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8 text-sm">No usage events in range.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
