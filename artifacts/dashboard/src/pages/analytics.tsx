/**
 * Platform Analytics — /app/analytics
 * Overview of operational outcomes across all campaigns.
 */

import { useState } from "react";
import { useSearch } from "wouter";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Users, PhoneCall, TrendingUp, CalendarCheck, ArrowRightLeft,
  PhoneIncoming, Clock, BarChart2,
} from "lucide-react";
import { StripePage } from "@/components/stripe-page";
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
  label, value, sub, icon: Icon, highlight = false, color = "bg-muted", iconColor = "text-muted-foreground",
}: { label: string; value: string | number; sub?: string; icon: React.ElementType; highlight?: boolean; color?: string; iconColor?: string }) {
  return (
    <div className={cn(
      "p-4 rounded-xl border bg-card shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3",
      highlight ? "border-primary/20 bg-primary/5" : "border-border/80"
    )}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">{label}</p>
        <div className={cn("h-8 w-8 rounded-xl flex items-center justify-center", color)}>
          <Icon className={cn("h-4 w-4", iconColor)} />
        </div>
      </div>
      <div>
        <p className={cn("text-2xl font-bold tabular-nums tracking-tight", highlight ? "text-primary" : "text-foreground")}>{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground/60 mt-1">{sub}</p>}
      </div>
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
    { label: "Total Leads",          value: (d?.totalLeads      ?? 0).toLocaleString(), icon: Users,          sub: "imported in range",         color: "bg-sky-500/15",    iconColor: "text-sky-400" },
    { label: "Connected",            value: (d?.connected       ?? 0).toLocaleString(), icon: PhoneIncoming,  sub: `${d?.connectionRate ?? 0}% connection rate`, color: "bg-emerald-500/15", iconColor: "text-emerald-400" },
    { label: "Connection Rate",      value: `${d?.connectionRate ?? 0}%`,               icon: TrendingUp,     sub: "connected / called",        highlight: true, color: "bg-primary/15",    iconColor: "text-primary" },
    { label: "Interested",           value: (d?.interested      ?? 0).toLocaleString(), icon: BarChart2,      sub: "interested or better",      color: "bg-amber-500/15",  iconColor: "text-amber-400" },
    { label: "Booked",               value: (d?.booked          ?? 0).toLocaleString(), icon: CalendarCheck,  sub: `${d?.bookingRate ?? 0}% booking rate`,   color: "bg-violet-500/15", iconColor: "text-violet-400" },
    { label: "Transferred",          value: (d?.transferred     ?? 0).toLocaleString(), icon: ArrowRightLeft, sub: `${d?.transferRate ?? 0}% transfer rate`,  color: "bg-blue-500/15",   iconColor: "text-blue-400" },
    { label: "Booking Rate",         value: `${d?.bookingRate   ?? 0}%`,                icon: TrendingUp,     sub: "booked / called",           highlight: true, color: "bg-primary/15",    iconColor: "text-primary" },
    { label: "Callback Success",     value: `${d?.callbackSuccessRate ?? 0}%`,          icon: PhoneCall,      sub: "completed callbacks",       color: "bg-rose-500/15",   iconColor: "text-rose-400" },
    { label: "Avg Call Duration",    value: fmtDur(d?.avgDurationSeconds),              icon: Clock,          sub: "across connected calls",    color: "bg-muted",         iconColor: "text-muted-foreground" },
  ];

  const trend = d?.dailyTrend ?? [];

  return (
    <div className="space-y-6">
      {/* KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {kpis.map(k => (
          <KpiCard key={k.label} label={k.label} value={isLoading ? "—" : k.value} sub={k.sub} icon={k.icon} highlight={k.highlight} color={k.color} iconColor={k.iconColor} />
        ))}
        {/* Rate bars card */}
        <div className="p-4 rounded-xl border border-border/80 bg-card shadow-sm col-span-2 sm:col-span-1 xl:col-span-1">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-8 w-8 rounded-xl bg-muted/60 flex items-center justify-center">
              <BarChart2 className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Conversion Rates</p>
          </div>
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
        <div className="rounded-xl border border-border/80 bg-card shadow-sm p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Daily Trend</h3>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">Calls connected, booked, and transferred per day</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={trend} margin={{ top: 4, right: 12, bottom: 0, left: -16 }}>
              <defs>
                <linearGradient id="gConn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gBook" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#10b981" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gTran" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={ct.gridColor} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: ct.tickColor }}
                tickFormatter={v => { try { return format(parseISO(v), "MMM d"); } catch { return v; } }} />
              <YAxis tick={{ fontSize: 10, fill: ct.tickColor }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: ct.tooltipBg, border: `1px solid ${ct.tooltipBorder}`, borderRadius: 8, fontSize: 11 }}
                labelFormatter={v => { try { return format(parseISO(v as string), "MMM d, yyyy"); } catch { return v; } }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="connected"   name="Connected"   stroke="#3b82f6" fill="url(#gConn)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="booked"      name="Booked"      stroke="#10b981" fill="url(#gBook)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="transferred" name="Transferred" stroke="#8b5cf6" fill="url(#gTran)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      {trend.length === 0 && !isLoading && (
        <div className="rounded-xl border border-border/80 bg-card shadow-sm p-10 text-center">
          <BarChart2 className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground/50">No daily trend data for this range.</p>
          <p className="text-xs text-muted-foreground/30 mt-1">Try selecting a wider date range above.</p>
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
  const campaignIdParam = new URLSearchParams(search).get("campaignId");
  const campaignId = campaignIdParam ? parseInt(campaignIdParam, 10) : undefined;

  const { data: campaign } = useGetCampaign(campaignId ?? 0, {
    query: { enabled: campaignId !== undefined, queryKey: getGetCampaignQueryKey(campaignId ?? 0) },
  });
  const campaignName = (campaign as { name?: string } | undefined)?.name;

  return (
    <StripePage
      title="Analytics"
      description={
        campaignId
          ? `Operational outcomes for ${campaignName ?? "this campaign"}`
          : "Operational outcomes across all campaigns"
      }
      back={
        campaignId
          ? { href: `/app/campaigns/${campaignId}`, label: "Back to campaign" }
          : undefined
      }
      actions={
        <div className="flex items-center gap-1 bg-muted/40 rounded-xl p-1">
          {PRESETS.map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPreset(p.key)}
              className={cn(
                "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all",
                preset === p.key
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="mb-5 flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/40 px-3 py-1.5 rounded-lg">
          <Clock className="h-3 w-3" />
          {range.from} → {range.to}
        </span>
      </div>
      <OverviewTab range={range} campaignId={campaignId} />
    </StripePage>
  );
}
