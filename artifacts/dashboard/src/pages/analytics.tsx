/**
 * Platform Analytics — /app/analytics
 * Tabbed analytics driven entirely by operationalOutcome.
 */

import { useState, useCallback } from "react";
import { Link } from "wouter";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Users, PhoneCall, TrendingUp, CalendarCheck, ArrowRightLeft,
  PhoneIncoming, Clock, BarChart2, Phone, CheckCircle2, XCircle,
  AlertCircle, Download, Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format, subDays, parseISO } from "date-fns";
import { useChartTheme } from "@/hooks/use-chart-theme";
import {
  useGetPlatformAnalyticsOverview,
  useGetPlatformAnalyticsFunnel,
  useGetPlatformAnalyticsSources,
  useGetPlatformAnalyticsCampaigns,
  useGetPlatformAnalyticsAgents,
  useGetPlatformAnalyticsQueue,
} from "@workspace/api-client-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OverviewData {
  totalLeads: number; called: number; connected: number;
  interested: number; booked: number; transferred: number;
  connectionRate: number; bookingRate: number; transferRate: number;
  callbackSuccessRate: number; avgDurationSeconds: number;
  dailyTrend: Array<{ date: string; connected: number; booked: number; transferred: number; failed: number; callbacks: number }>;
}

interface FunnelStage { stage: string; count: number; pct: number; dropoff: number; }
interface FunnelData {
  funnel: FunnelStage[];
  filters: { campaigns: Array<{ id: number; name: string }>; sources: Array<{ id: number; name: string; type: string }> };
}

interface SourceRow {
  sourceId: number | null; sourceName: string; sourceType: string;
  total: number; called: number; connected: number; booked: number; transferred: number;
  connectionRate: number; bookingRate: number; transferRate: number;
}

interface CampaignRow {
  campaignId: number; campaignName: string; agentName: string | null;
  total: number; called: number; connected: number; booked: number; transferred: number;
  successRate: number; connectionRate: number;
}

interface AgentRow {
  agentId: number | null; agentName: string;
  total: number; called: number; connected: number; booked: number; transferred: number;
  connectionRate: number; bookingRate: number; transferRate: number;
  avgDurationSeconds: number | null;
  sentimentBreakdown: Record<string, number>;
}

interface QueueData {
  callbacks:  { total: number; pending: number; completed: number; cancelled: number; missed: number; overdue: number };
  bookings:   { total: number; scheduled: number; completed: number; cancelled: number };
  transfers:  { total: number; initiated: number; connected: number; completed: number; failed: number };
}

// ── Date range ────────────────────────────────────────────────────────────────

type Preset = "today" | "yesterday" | "7d" | "30d";

interface DateRange { from: string; to: string; }

function presetToRange(p: Preset): DateRange {
  const today = new Date();
  switch (p) {
    case "today":
      return { from: format(today, "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
    case "yesterday": {
      const y = subDays(today, 1);
      return { from: format(y, "yyyy-MM-dd"), to: format(y, "yyyy-MM-dd") };
    }
    case "7d":
      return { from: format(subDays(today, 6), "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
    case "30d":
      return { from: format(subDays(today, 29), "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
  }
}

// ── CSV export helper ─────────────────────────────────────────────────────────

function exportCsv(filename: string, headers: string[], rows: (string | number | null)[][]) {
  const csvRows = [
    headers.join(","),
    ...rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")),
  ];
  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon: Icon, highlight = false,
}: { label: string; value: string | number; sub?: string; icon: React.ElementType; highlight?: boolean }) {
  return (
    <div className={cn("p-4 rounded-lg border bg-card", highlight && "border-primary/30 bg-primary/5")}>
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs text-muted-foreground leading-tight">{label}</p>
        <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center">
          <Icon className="h-3 w-3 text-muted-foreground" />
        </div>
      </div>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function RateBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{value}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  );
}

function QueueGroup({
  title, icon: Icon, items, accent,
}: { title: string; icon: React.ElementType; items: Array<{ label: string; value: number; highlight?: boolean }>; accent: string }) {
  return (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className={cn("h-7 w-7 rounded-md flex items-center justify-center", accent)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="space-y-2">
        {items.map(it => (
          <div key={it.label} className="flex items-center justify-between py-1 border-b border-border/40 last:border-0">
            <span className="text-xs text-muted-foreground">{it.label}</span>
            <span className={cn("text-sm font-semibold tabular-nums", it.highlight && "text-destructive")}>{it.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtDur(s: number | null | undefined) {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

// ── Tab: Overview ─────────────────────────────────────────────────────────────

function OverviewTab({ range }: { range: DateRange }) {
  const ct = useChartTheme();
  const { data, isLoading } = useGetPlatformAnalyticsOverview({ from: range.from, to: range.to });
  const d = data as OverviewData | undefined;

  const kpis = [
    { label: "Total Leads",           value: (d?.totalLeads       ?? 0).toLocaleString(), icon: Users,          sub: "imported in range" },
    { label: "Connected Leads",        value: (d?.connected        ?? 0).toLocaleString(), icon: PhoneIncoming,  sub: `${d?.connectionRate ?? 0}% connection rate` },
    { label: "Connection Rate",        value: `${d?.connectionRate ?? 0}%`,                icon: TrendingUp,     sub: "connected / called", highlight: true },
    { label: "Interested",             value: (d?.interested       ?? 0).toLocaleString(), icon: BarChart2,      sub: "interested or better" },
    { label: "Booked",                 value: (d?.booked           ?? 0).toLocaleString(), icon: CalendarCheck,  sub: `${d?.bookingRate ?? 0}% booking rate` },
    { label: "Transferred",            value: (d?.transferred      ?? 0).toLocaleString(), icon: ArrowRightLeft, sub: `${d?.transferRate ?? 0}% transfer rate` },
    { label: "Booking Rate",           value: `${d?.bookingRate    ?? 0}%`,                icon: TrendingUp,     sub: "booked / called", highlight: true },
    { label: "Callback Success Rate",  value: `${d?.callbackSuccessRate ?? 0}%`,           icon: PhoneCall,      sub: "completed callbacks" },
    { label: "Avg Call Duration",      value: fmtDur(d?.avgDurationSeconds),               icon: Clock,          sub: "across connected calls" },
  ];

  const trend = d?.dailyTrend ?? [];

  return (
    <div className="space-y-6">
      {/* KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {kpis.map(k => (
          <KpiCard key={k.label} label={k.label} value={isLoading ? "—" : k.value} sub={k.sub} icon={k.icon} highlight={k.highlight} />
        ))}
        {/* Rate bars card */}
        <div className="p-4 rounded-lg border bg-card col-span-2 sm:col-span-1 xl:col-span-1">
          <p className="text-xs text-muted-foreground mb-3">Conversion Rates</p>
          <div className="space-y-3">
            <RateBar label="Connection" value={d?.connectionRate ?? 0} color="bg-blue-500" />
            <RateBar label="Booking"    value={d?.bookingRate    ?? 0} color="bg-emerald-500" />
            <RateBar label="Transfer"   value={d?.transferRate   ?? 0} color="bg-violet-500" />
            <RateBar label="Callbacks"  value={d?.callbackSuccessRate ?? 0} color="bg-amber-500" />
          </div>
        </div>
      </div>

      {/* Daily trend chart */}
      {trend.length > 0 && (
        <div className="rounded-lg border bg-card p-5">
          <h3 className="text-sm font-semibold mb-4">Daily Trend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trend} margin={{ top: 4, right: 12, bottom: 0, left: -16 }}>
              <defs>
                <linearGradient id="gConn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gBook" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gTran" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={ct.gridColor} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: ct.tickColor }}
                tickFormatter={v => { try { return format(parseISO(v), "MMM d"); } catch { return v; } }} />
              <YAxis tick={{ fontSize: 10, fill: ct.tickColor }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: ct.tooltipBg, border: `1px solid ${ct.tooltipBorder}`, borderRadius: 6, fontSize: 11 }}
                labelFormatter={v => { try { return format(parseISO(v as string), "MMM d, yyyy"); } catch { return v; } }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="connected"   name="Connected"   stroke="#3b82f6" fill="url(#gConn)" strokeWidth={1.5} dot={false} />
              <Area type="monotone" dataKey="booked"      name="Booked"      stroke="#10b981" fill="url(#gBook)" strokeWidth={1.5} dot={false} />
              <Area type="monotone" dataKey="transferred" name="Transferred" stroke="#8b5cf6" fill="url(#gTran)" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      {trend.length === 0 && !isLoading && (
        <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground text-sm">
          No daily trend data for this range.
        </div>
      )}
    </div>
  );
}

// ── Tab: Funnel ───────────────────────────────────────────────────────────────

function FunnelTab({ range }: { range: DateRange }) {
  const [campaignId, setCampaignId] = useState<string>("");
  const [sourceId,   setSourceId]   = useState<string>("");

  const params = {
    from: range.from,
    to:   range.to,
    ...(campaignId ? { campaignId: Number(campaignId) } : {}),
    ...(sourceId   ? { sourceId:   Number(sourceId)   } : {}),
  };

  const { data, isLoading } = useGetPlatformAnalyticsFunnel(params);
  const d = data as FunnelData | undefined;

  const funnel   = d?.funnel   ?? [];
  const maxCount = funnel[0]?.count ?? 1;

  const STAGE_COLORS: Record<string, string> = {
    Imported:    "bg-zinc-400",
    Called:      "bg-blue-500",
    Connected:   "bg-cyan-500",
    Interested:  "bg-amber-500",
    Booked:      "bg-emerald-500",
    Transferred: "bg-violet-500",
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <select
          value={campaignId}
          onChange={e => setCampaignId(e.target.value)}
          className="text-xs rounded-md border border-border bg-background px-2 py-1.5 min-w-36"
        >
          <option value="">All Campaigns</option>
          {(d?.filters.campaigns ?? []).map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          value={sourceId}
          onChange={e => setSourceId(e.target.value)}
          className="text-xs rounded-md border border-border bg-background px-2 py-1.5 min-w-36"
        >
          <option value="">All Sources</option>
          {(d?.filters.sources ?? []).map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* Funnel bars */}
      <div className="rounded-lg border bg-card p-6 space-y-4">
        {isLoading ? (
          <div className="py-16 text-center text-muted-foreground text-sm">Loading…</div>
        ) : funnel.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground text-sm">No data for this range.</div>
        ) : (
          funnel.map((stage, i) => (
            <div key={stage.stage} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium w-28 shrink-0">{stage.stage}</span>
                <div className="flex-1 mx-4">
                  <div className="h-8 rounded-md bg-muted overflow-hidden">
                    <div
                      className={cn("h-full rounded-md transition-all flex items-center px-2", STAGE_COLORS[stage.stage] ?? "bg-zinc-400")}
                      style={{ width: `${Math.max((stage.count / maxCount) * 100, stage.count > 0 ? 2 : 0)}%` }}
                    >
                      <span className="text-[10px] text-white font-medium tabular-nums truncate">
                        {stage.count > 0 ? stage.count.toLocaleString() : ""}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-right w-28 shrink-0 space-y-0.5">
                  <div className="text-sm font-semibold tabular-nums">{stage.count.toLocaleString()}</div>
                  <div className="text-[10px] text-muted-foreground">{stage.pct}% of total</div>
                </div>
              </div>
              {i < funnel.length - 1 && stage.dropoff > 0 && (
                <div className="ml-28 pl-4 text-[10px] text-destructive/70">
                  ↓ {stage.dropoff}% drop-off to next stage
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Tab: Sources ──────────────────────────────────────────────────────────────

function SourcesTab({ range }: { range: DateRange }) {
  const { data, isLoading } = useGetPlatformAnalyticsSources({ from: range.from, to: range.to });
  const rows = (data as SourceRow[] | undefined) ?? [];

  function handleExport() {
    exportCsv(
      `sources-${range.from}-${range.to}.csv`,
      ["Source", "Type", "Total", "Called", "Connected", "Booked", "Transferred", "Connection%", "Booking%", "Transfer%"],
      rows.map(r => [r.sourceName, r.sourceType, r.total, r.called, r.connected, r.booked, r.transferred, r.connectionRate, r.bookingRate, r.transferRate]),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={handleExport} disabled={rows.length === 0}>
          <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
        </Button>
      </div>
      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="text-left px-4 py-3 font-medium">Source</th>
              <th className="text-left px-4 py-3 font-medium">Type</th>
              <th className="text-right px-4 py-3 font-medium">Leads</th>
              <th className="text-right px-4 py-3 font-medium">Connected</th>
              <th className="text-right px-4 py-3 font-medium">Booked</th>
              <th className="text-right px-4 py-3 font-medium">Transferred</th>
              <th className="text-right px-4 py-3 font-medium">Conn%</th>
              <th className="text-right px-4 py-3 font-medium">Book%</th>
              <th className="text-right px-4 py-3 font-medium">Xfer%</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={9} className="text-center text-muted-foreground py-10 text-xs">Loading…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={9} className="text-center text-muted-foreground py-10 text-xs">No source data for this range.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.sourceId ?? i} className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 font-medium">{r.sourceName}</td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className="text-[10px]">{r.sourceType}</Badge>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{r.total.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums">{r.connected.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums text-emerald-500">{r.booked.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums text-violet-500">{r.transferred.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums">{r.connectionRate}%</td>
                <td className="px-4 py-3 text-right tabular-nums">{r.bookingRate}%</td>
                <td className="px-4 py-3 text-right tabular-nums">{r.transferRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab: Campaigns ────────────────────────────────────────────────────────────

function CampaignsTab({ range }: { range: DateRange }) {
  const { data, isLoading } = useGetPlatformAnalyticsCampaigns({ from: range.from, to: range.to });
  const rows = (data as CampaignRow[] | undefined) ?? [];

  function handleExport() {
    exportCsv(
      `campaigns-${range.from}-${range.to}.csv`,
      ["Campaign", "Agent", "Total", "Called", "Connected", "Booked", "Transferred", "Conn%", "Success%"],
      rows.map(r => [r.campaignName, r.agentName ?? "", r.total, r.called, r.connected, r.booked, r.transferred, r.connectionRate, r.successRate]),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={handleExport} disabled={rows.length === 0}>
          <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
        </Button>
      </div>
      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="text-left px-4 py-3 font-medium">Campaign</th>
              <th className="text-left px-4 py-3 font-medium">Agent</th>
              <th className="text-right px-4 py-3 font-medium">Leads</th>
              <th className="text-right px-4 py-3 font-medium">Called</th>
              <th className="text-right px-4 py-3 font-medium">Connected</th>
              <th className="text-right px-4 py-3 font-medium">Booked</th>
              <th className="text-right px-4 py-3 font-medium">Transferred</th>
              <th className="text-right px-4 py-3 font-medium">Conn%</th>
              <th className="text-right px-4 py-3 font-medium">Success%</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={9} className="text-center text-muted-foreground py-10 text-xs">Loading…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={9} className="text-center text-muted-foreground py-10 text-xs">No campaign data for this range.</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.campaignId} className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/app/campaigns/${r.campaignId}`} className="font-medium hover:underline text-foreground">
                    {r.campaignName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{r.agentName ?? "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{r.total.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums">{r.called.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums">{r.connected.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums text-emerald-500">{r.booked.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums text-violet-500">{r.transferred.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums">{r.connectionRate}%</td>
                <td className="px-4 py-3 text-right">
                  <span className={cn(
                    "text-xs font-medium tabular-nums px-2 py-0.5 rounded-full",
                    r.successRate >= 20 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : r.successRate >= 10 ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                    : "bg-muted text-muted-foreground",
                  )}>{r.successRate}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab: Agents ───────────────────────────────────────────────────────────────

function AgentsTab({ range }: { range: DateRange }) {
  const ct = useChartTheme();
  const { data, isLoading } = useGetPlatformAnalyticsAgents({ from: range.from, to: range.to });
  const rows = (data as AgentRow[] | undefined) ?? [];

  function handleExport() {
    exportCsv(
      `agents-${range.from}-${range.to}.csv`,
      ["Agent", "Total", "Called", "Connected", "Booked", "Transferred", "Conn%", "Book%", "Xfer%", "Avg Duration (s)"],
      rows.map(r => [r.agentName, r.total, r.called, r.connected, r.booked, r.transferred, r.connectionRate, r.bookingRate, r.transferRate, r.avgDurationSeconds ?? ""]),
    );
  }

  const chartData = rows.slice(0, 10).map(r => ({
    name: r.agentName.length > 14 ? r.agentName.slice(0, 14) + "…" : r.agentName,
    Booked: r.booked, Transferred: r.transferred, Connected: r.connected,
  }));

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={handleExport} disabled={rows.length === 0}>
          <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
        </Button>
      </div>

      {/* Leaderboard chart */}
      {chartData.length > 0 && (
        <div className="rounded-lg border bg-card p-5">
          <h3 className="text-sm font-semibold mb-4">Agent Leaderboard — Outcomes</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={ct.gridColor} strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: ct.tickColor }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: ct.tickColor }} width={90} />
              <Tooltip contentStyle={{ background: ct.tooltipBg, border: `1px solid ${ct.tooltipBorder}`, borderRadius: 6, fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Booked"      stackId="a" fill="#10b981" radius={[0,0,0,0]} />
              <Bar dataKey="Transferred" stackId="a" fill="#8b5cf6" radius={[0,0,0,0]} />
              <Bar dataKey="Connected"   stackId="a" fill="#3b82f6" radius={[0,4,4,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="text-left px-4 py-3 font-medium">#</th>
              <th className="text-left px-4 py-3 font-medium">Agent</th>
              <th className="text-right px-4 py-3 font-medium">Calls</th>
              <th className="text-right px-4 py-3 font-medium">Connected</th>
              <th className="text-right px-4 py-3 font-medium">Booked</th>
              <th className="text-right px-4 py-3 font-medium">Transferred</th>
              <th className="text-right px-4 py-3 font-medium">Conn%</th>
              <th className="text-right px-4 py-3 font-medium">Book%</th>
              <th className="text-right px-4 py-3 font-medium">Avg Duration</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={9} className="text-center text-muted-foreground py-10 text-xs">Loading…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={9} className="text-center text-muted-foreground py-10 text-xs">No agent data for this range.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.agentId ?? i} className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 text-muted-foreground text-xs tabular-nums">{i + 1}</td>
                <td className="px-4 py-3 font-medium">
                  {r.agentId ? (
                    <Link href={`/app/analytics/agents/${r.agentId}`} className="hover:underline">{r.agentName}</Link>
                  ) : r.agentName}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{r.called.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums">{r.connected.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums text-emerald-500">{r.booked.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums text-violet-500">{r.transferred.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums">{r.connectionRate}%</td>
                <td className="px-4 py-3 text-right tabular-nums">{r.bookingRate}%</td>
                <td className="px-4 py-3 text-right text-muted-foreground">{fmtDur(r.avgDurationSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab: Queue ────────────────────────────────────────────────────────────────

function QueueTab() {
  const { data, isLoading } = useGetPlatformAnalyticsQueue();
  const d = data as QueueData | undefined;

  const cb = d?.callbacks;
  const bk = d?.bookings;
  const tr = d?.transfers;

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="text-center text-muted-foreground py-10 text-sm">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <QueueGroup
            title="Callbacks"
            icon={PhoneCall}
            accent="bg-amber-500/15 text-amber-600 dark:text-amber-400"
            items={[
              { label: "Total",     value: cb?.total     ?? 0 },
              { label: "Pending",   value: cb?.pending   ?? 0 },
              { label: "Completed", value: cb?.completed ?? 0 },
              { label: "Cancelled", value: cb?.cancelled ?? 0 },
              { label: "Missed",    value: cb?.missed    ?? 0 },
              { label: "⚠ Overdue", value: cb?.overdue  ?? 0, highlight: (cb?.overdue ?? 0) > 0 },
            ]}
          />
          <QueueGroup
            title="Bookings"
            icon={CalendarCheck}
            accent="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            items={[
              { label: "Total",     value: bk?.total     ?? 0 },
              { label: "Scheduled", value: bk?.scheduled ?? 0 },
              { label: "Completed", value: bk?.completed ?? 0 },
              { label: "Cancelled", value: bk?.cancelled ?? 0 },
            ]}
          />
          <QueueGroup
            title="Transfers"
            icon={ArrowRightLeft}
            accent="bg-violet-500/15 text-violet-600 dark:text-violet-400"
            items={[
              { label: "Total",     value: tr?.total     ?? 0 },
              { label: "Initiated", value: tr?.initiated ?? 0 },
              { label: "Connected", value: tr?.connected ?? 0 },
              { label: "Completed", value: tr?.completed ?? 0 },
              { label: "Failed",    value: tr?.failed    ?? 0, highlight: (tr?.failed ?? 0) > 0 },
            ]}
          />
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type TabKey = "overview" | "funnel" | "sources" | "campaigns" | "agents" | "queue";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview",   label: "Overview"   },
  { key: "funnel",     label: "Funnel"     },
  { key: "sources",    label: "Sources"    },
  { key: "campaigns",  label: "Campaigns"  },
  { key: "agents",     label: "Agents"     },
  { key: "queue",      label: "Queue"      },
];

const PRESETS: Array<{ key: Preset; label: string }> = [
  { key: "today",     label: "Today"     },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d",        label: "7 Days"    },
  { key: "30d",       label: "30 Days"   },
];

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [preset,    setPreset]    = useState<Preset>("30d");
  const range = presetToRange(preset);

  const handlePreset = useCallback((p: Preset) => setPreset(p), []);

  return (
    <div className="flex flex-col h-full overflow-auto bg-background">
      <div className="max-w-screen-2xl mx-auto w-full p-6 space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <BarChart2 className="h-5 w-5 text-muted-foreground" />
              Analytics
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Operational outcomes across all campaigns
            </p>
          </div>
          {/* Date range presets */}
          <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1">
            {PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => handlePreset(p.key)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                  preset === p.key
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Date range badge */}
        <p className="text-[11px] text-muted-foreground">
          Showing data from <span className="font-medium text-foreground">{range.from}</span> to{" "}
          <span className="font-medium text-foreground">{range.to}</span>
        </p>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cn(
                "px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-all -mb-px",
                activeTab === t.key
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="pb-8">
          {activeTab === "overview"  && <OverviewTab  range={range} />}
          {activeTab === "funnel"    && <FunnelTab    range={range} />}
          {activeTab === "sources"   && <SourcesTab   range={range} />}
          {activeTab === "campaigns" && <CampaignsTab range={range} />}
          {activeTab === "agents"    && <AgentsTab    range={range} />}
          {activeTab === "queue"     && <QueueTab />}
        </div>
      </div>
    </div>
  );
}
