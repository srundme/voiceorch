/**
 * Platform Analytics — /app/analytics
 * Overview of operational outcomes across all campaigns.
 */

import { useState } from "react";
import { useSearch, useLocation } from "wouter";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Users, PhoneCall, TrendingUp, CalendarCheck, ArrowRightLeft,
  PhoneIncoming, Clock, BarChart2, ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { format, subDays, parseISO } from "date-fns";
import { useChartTheme } from "@/hooks/use-chart-theme";
import { useGetPlatformAnalyticsOverview, useGetCampaign, getGetCampaignQueryKey } from "@workspace/api-client-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OverviewData {
  totalLeads: number; called: number; connected: number;
  interested: number; booked: number; transferred: number;
  connectionRate: number; bookingRate: number; transferRate: number;
  callbackSuccessRate: number; avgDurationSeconds: number;
  dailyTrend: Array<{ date: string; connected: number; booked: number; transferred: number; failed: number; callbacks: number }>;
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

function fmtDur(s: number | null | undefined) {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

// ── Overview ──────────────────────────────────────────────────────────────────

function OverviewTab({ range, campaignId }: { range: DateRange; campaignId?: number }) {
  const ct = useChartTheme();
  const { data, isLoading } = useGetPlatformAnalyticsOverview({
    from: range.from,
    to: range.to,
    ...(campaignId !== undefined ? { campaignId } : {}),
  });
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

// ── Main Page ─────────────────────────────────────────────────────────────────

const PRESETS: Array<{ key: Preset; label: string }> = [
  { key: "today",     label: "Today"     },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d",        label: "7 Days"    },
  { key: "30d",       label: "30 Days"   },
];

export default function AnalyticsPage() {
  const [preset, setPreset] = useState<Preset>("30d");
  const range = presetToRange(preset);

  const search = useSearch();
  const [, setLocation] = useLocation();
  const campaignIdParam = new URLSearchParams(search).get("campaignId");
  const campaignId = campaignIdParam ? parseInt(campaignIdParam, 10) : undefined;
  const backTo = campaignId ? `/app/campaigns/${campaignId}` : "/app/campaigns";

  const { data: campaign } = useGetCampaign(campaignId ?? 0, {
    query: { enabled: campaignId !== undefined, queryKey: getGetCampaignQueryKey(campaignId ?? 0) },
  });
  const campaignName = (campaign as { name?: string } | undefined)?.name;

  return (
    <div className="flex flex-col h-full overflow-auto bg-background">
      <div className="max-w-screen-2xl mx-auto w-full p-6 space-y-5">

        {/* Back navigation */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 -ml-2 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => setLocation(backTo)}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {campaignId ? "Back to campaign" : "Back to campaigns"}
        </Button>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <BarChart2 className="h-5 w-5 text-muted-foreground" />
              Analytics
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {campaignId
                ? `Operational outcomes for ${campaignName ?? "this campaign"}`
                : "Operational outcomes across all campaigns"}
            </p>
          </div>
          {/* Date range presets */}
          <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1">
            {PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => setPreset(p.key)}
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

        {/* Overview content */}
        <div className="pb-8">
          <OverviewTab range={range} campaignId={campaignId} />
        </div>
      </div>
    </div>
  );
}
