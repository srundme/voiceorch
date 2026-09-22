import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  ArrowRight,
  Bot,
  Check,
  CircleAlert,
  Clock,
  FileSpreadsheet,
  Phone,
  PhoneCall,
  Plus,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { format, parseISO, subDays } from "date-fns";
import {
  customFetch,
  getGetDashboardStatsQueryKey,
  getGetDailyCallVolumeQueryKey,
  getListAgentsQueryKey,
  getListCallsQueryKey,
  getListCampaignsQueryKey,
  useGetDashboardStats,
  useGetDailyCallVolume,
  useGetWallet,
  useListAgents,
  useListCalls,
  useListCampaigns,
  useListPhoneNumbers,
  getListPhoneNumbersQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { StripePage } from "@/components/stripe-page";
import { PageHero } from "@/components/page-hero";
import { GhostEmpty, MomentCard } from "@/components/brand-moments";
import { StatusDot } from "@/components/workspace/workspace";
import { MetricCard, MetricStrip } from "@/components/metric-strip";
import { useChartTheme } from "@/hooks/use-chart-theme";
import { useMinuteRatesMap, useUserProviderNames } from "@/hooks/use-minute-rates";
import { usePartnerManagedWorkspace } from "@/hooks/use-partner";
import { cn } from "@/lib/utils";

type AutoPipeline = {
  id: string;
  name: string;
  status: string;
  enqueuedCount: number;
  dialedCount: number;
  failedCount: number;
  lastError: string | null;
  spreadsheetTitle: string | null;
};

function relativeTime(value: string | null | undefined): string {
  if (!value) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function durationLabel(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" {
  const value = status.toLowerCase();
  if (["completed", "active", "running", "connected"].includes(value)) return "success";
  if (["failed", "error"].includes(value)) return "danger";
  if (["paused", "pending", "ringing", "calling"].includes(value)) return "warning";
  return "neutral";
}

function fillDailyVolume(
  rows: Array<{ date: string; total: number; completed: number; failed: number }> | undefined,
): Array<{ date: string; label: string; completed: number; failed: number; total: number }> {
  const byDate = new Map((rows ?? []).map((r) => [r.date, r]));
  const today = new Date();
  const out: Array<{ date: string; label: string; completed: number; failed: number; total: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = subDays(today, i);
    const key = format(d, "yyyy-MM-dd");
    const row = byDate.get(key);
    out.push({
      date: key,
      label: format(d, "EEE"),
      completed: row?.completed ?? 0,
      failed: row?.failed ?? 0,
      total: row?.total ?? 0,
    });
  }
  return out;
}

export default function HomePage() {
  const [, navigate] = useLocation();
  const ct = useChartTheme();
  const { isManagedWorkspace, partnerName } = usePartnerManagedWorkspace();
  const statsQ = useGetDashboardStats({
    query: { queryKey: getGetDashboardStatsQueryKey(), refetchInterval: 30_000, staleTime: 20_000 },
  });
  const volumeQ = useGetDailyCallVolume({
    query: { queryKey: getGetDailyCallVolumeQueryKey(), refetchInterval: 60_000, staleTime: 30_000 },
  });
  const callsQ = useListCalls(undefined, {
    query: { queryKey: [...getListCallsQueryKey(), "home"], refetchInterval: 30_000 },
  });
  const agentsQ = useListAgents({
    query: { queryKey: getListAgentsQueryKey(), staleTime: 30_000 },
  });
  const campaignsQ = useListCampaigns({
    query: { queryKey: getListCampaignsQueryKey(), staleTime: 30_000 },
  });
  const walletQ = useGetWallet();
  const phonesQ = useListPhoneNumbers({
    query: { queryKey: getListPhoneNumbersQueryKey(), staleTime: 60_000 },
  });
  const pipelinesQ = useQuery({
    queryKey: ["automatic-calls"],
    queryFn: () => customFetch<AutoPipeline[]>("/api/automatic-calls"),
    refetchInterval: 30_000,
  });
  const waChannelQ = useQuery({
    queryKey: ["connections-whatsapp-status"],
    queryFn: () =>
      customFetch<{ channel: { active?: boolean } | null }>("/api/whatsapp/channel"),
    staleTime: 60_000,
  });
  const waConnectionsQ = useQuery({
    queryKey: ["connections-whatsapp-connections"],
    queryFn: () =>
      customFetch<{ connections: Array<{ active?: boolean }> }>("/api/whatsapp/connections"),
    staleTime: 60_000,
  });

  const agents = Array.isArray(agentsQ.data) ? agentsQ.data : (agentsQ.data as any)?.agents ?? [];
  const calls = Array.isArray(callsQ.data) ? callsQ.data : (callsQ.data as any)?.calls ?? [];
  const campaigns = Array.isArray(campaignsQ.data) ? campaignsQ.data : [];
  const pipelines: AutoPipeline[] = pipelinesQ.data ?? [];
  const phoneNumbers = Array.isArray(phonesQ.data) ? phonesQ.data : [];
  const activeCampaigns = campaigns.filter((campaign: any) => campaign.status === "active" || campaign.isActive);
  const activePipelines = pipelines.filter((pipeline) => pipeline.status === "running");
  const failedCalls = calls.filter((call: any) =>
    ["failed", "error"].includes(String(call.status ?? "").toLowerCase()),
  );

  const chartData = useMemo(() => fillDailyVolume(volumeQ.data), [volumeQ.data]);
  const weekTotal = chartData.reduce((sum, d) => sum + d.total, 0);
  const weekCompleted = chartData.reduce((sum, d) => sum + d.completed, 0);

  const rateMap = useMinuteRatesMap();
  const providers = useUserProviderNames();
  const wallet = walletQ.data;
  const rate = wallet?.effectiveRateCentsPerMin
    ?? rateMap.get(providers.size > 0 ? "byop" : "managed")
    ?? 500;
  const balanceCents = wallet?.balanceCents ?? null;
  const availableMinutes = balanceCents == null ? null : Math.floor(balanceCents / rate);
  const lowBalance = balanceCents != null && balanceCents < 10_000;

  const hasAgent = agents.length > 0;
  const hasLeads = campaigns.length > 0 || pipelines.length > 0;
  const waReady =
    !!waChannelQ.data?.channel?.active
    || (waConnectionsQ.data?.connections ?? []).some((c) => c.active);
  const hasChannels = phoneNumbers.length > 0 || waReady;
  const firstAgentId = agents[0]?.id as number | undefined;
  const setup = [
    { label: "Create an agent", done: hasAgent, href: "/app/agents?create=1" },
    { label: "Create a campaign", done: hasLeads, href: "/app/campaigns" },
    { label: "Connect phone / channels", done: hasChannels, href: "/app/connections" },
  ];
  const setupDone = setup.every((item) => item.done);

  const issues: Array<{ title: string; detail: string; href: string; tone: "warning" | "danger" }> = [];
  pipelines
    .filter((pipeline) => pipeline.status === "paused" && /reconnect google/i.test(pipeline.lastError ?? ""))
    .forEach((pipeline) => {
      issues.push({
        title: "Google Sheets disconnected",
        detail: `${pipeline.name} is paused`,
        href: "/app/connections?setup=sheets",
        tone: "warning",
      });
    });
  if (lowBalance) {
    issues.push({
      title: "Low wallet balance",
      detail: isManagedWorkspace
        ? (availableMinutes == null
          ? `Ask ${partnerName} to add funds`
          : `About ${availableMinutes} minutes remain — ask ${partnerName} to add funds`)
        : (availableMinutes == null ? "Top up to keep dialing" : `About ${availableMinutes} minutes remain`),
      href: "/app/wallet",
      tone: "danger",
    });
  }
  if (failedCalls.length > 0) {
    issues.push({
      title: `${failedCalls.length} recent failed call${failedCalls.length === 1 ? "" : "s"}`,
      detail: "Review provider and dial errors",
      href: "/app/history",
      tone: "danger",
    });
  }

  const recentReach = [
    ...activePipelines.map((pipeline) => ({
      id: `sheet-${pipeline.id}`,
      name: pipeline.name,
      detail: `Sheet · ${pipeline.dialedCount} dialed · ${pipeline.enqueuedCount} queued`,
      href: `/app/automatic-calls/${pipeline.id}`,
      status: pipeline.status,
      icon: FileSpreadsheet,
    })),
    ...activeCampaigns.map((campaign: any) => ({
      id: `flow-${campaign.id}`,
      name: campaign.name,
      detail: "Lead list",
      href: `/app/campaigns/${campaign.id}`,
      status: campaign.status ?? "active",
      icon: Zap,
    })),
  ].slice(0, 6);

  if (!hasAgent && !agentsQ.isLoading) {
    return (
      <main className="flex min-h-full items-center justify-center px-5 py-12">
        <GhostEmpty
          className="w-full max-w-md"
          title="Create your first agent"
          description="Build the voice agent first, then create a campaign to dial leads."
          primary={{ label: "Configure manually", href: "/app/agents?create=1", icon: <Plus className="size-3.5" /> }}
          secondary={!isManagedWorkspace ? { label: "Build with AI", href: "/app/vibe" } : undefined}
        />
      </main>
    );
  }

  const nextAction = !hasAgent
    ? { title: "Create your first agent", description: "Build the voice agent, then connect a number and dial.", primary: { label: "Create agent", href: "/app/agents?create=1" }, secondary: !isManagedWorkspace ? { label: "Build with AI", href: "/app/vibe" } : undefined }
    : !hasChannels
      ? { title: "Take your agent live", description: "Assign a phone number so inbound rings and outbound has a caller ID.", primary: { label: "Phone numbers", href: "/app/phone-numbers" }, secondary: { label: "Open agent", href: firstAgentId != null ? `/app/agents/${firstAgentId}` : "/app/agents" } }
      : !hasLeads
        ? { title: "Start dialing", description: "Create a campaign from a lead source and put your agent to work.", primary: { label: "New campaign", href: "/app/campaigns" }, secondary: { label: "Open agent", href: firstAgentId != null ? `/app/agents/${firstAgentId}` : "/app/agents" } }
        : { title: "You’re set up", description: "Review Results on a campaign or jump into an agent.", primary: { label: "Campaigns", href: "/app/campaigns" }, secondary: { label: "Call logs", href: "/app/history" } };

  const stats = statsQ.data;
  const avgDur = stats?.avgDurationSeconds;

  return (
    <StripePage
      title="Home"
      description="What to do next, then a quick look at volume."
      actions={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 px-3 text-xs"
            onClick={() => navigate(firstAgentId != null ? `/app/agents/${firstAgentId}` : "/app/agents")}
          >
            <PhoneCall className="size-3.5" />
            Open agent
          </Button>
          <Button size="sm" className="h-8 gap-1.5 px-3 text-xs" onClick={() => navigate("/app/campaigns")}>
            <Plus className="size-3.5" />
            New campaign
          </Button>
        </div>
      }
      contentClassName="!pt-4"
    >
      <div className="space-y-5">
        <PageHero
          variant="stage"
          title={nextAction.title}
          description={nextAction.description}
          primary={nextAction.primary}
          secondary={nextAction.secondary}
        />

        {!isManagedWorkspace && lowBalance ? (
          <MomentCard
            title="Upgrade for more minutes."
            description="Top up your wallet so campaigns and live calls keep running."
            action="See plans"
            href="/app/wallet"
          />
        ) : null}

        {/* Recents */}
        {(agents.length > 0 || recentReach.length > 0) && (
          <section className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h3 className="text-sm font-semibold">Recents</h3>
              <Link href="/app/agents" className="text-[11px] text-muted-foreground hover:text-foreground">
                All agents →
              </Link>
            </div>
            <ul className="divide-y divide-border">
              {agents.slice(0, 5).map((a: any) => (
                <li key={a.id}>
                  <Link
                    href={`/app/agents/${a.id}`}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors"
                  >
                    <Bot className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate flex-1">{a.name ?? `Agent #${a.id}`}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {relativeTime(a.updatedAt ?? a.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <MetricStrip cols={4}>
          <MetricCard
            label="Calls today"
            value={statsQ.isLoading ? "—" : (stats?.callsToday ?? 0).toLocaleString()}
            sub={stats?.totalCalls != null ? `${stats.totalCalls.toLocaleString()} all time` : undefined}
            icon={<Phone className="size-4" />}
            loading={statsQ.isLoading}
          />
          <MetricCard
            label="Success rate"
            value={statsQ.isLoading ? "—" : `${stats?.successRate ?? 0}%`}
            sub={avgDur != null ? `Avg ${durationLabel(avgDur)}` : "Completed / total"}
            icon={<TrendingUp className="size-4" />}
            loading={statsQ.isLoading}
          />
          <MetricCard
            label="This week"
            value={
              statsQ.isLoading && volumeQ.isLoading
                ? "—"
                : (stats?.callsThisWeek ?? weekTotal).toLocaleString()
            }
            sub={`${weekCompleted.toLocaleString()} completed`}
            icon={<Zap className="size-4" />}
            loading={statsQ.isLoading && volumeQ.isLoading}
          />
          <MetricCard
            label="Minutes left"
            value={
              walletQ.isLoading
                ? "—"
                : availableMinutes != null
                  ? `~${availableMinutes.toLocaleString()}`
                  : "—"
            }
            sub={
              balanceCents != null
                ? `₹${(balanceCents / 100).toFixed(0)} wallet`
                : isManagedWorkspace
                  ? "Partner-funded"
                  : "Top up to dial"
            }
            icon={<Clock className="size-4" />}
            loading={walletQ.isLoading}
            accent={lowBalance ? "text-amber-600 dark:text-amber-400" : undefined}
          />
        </MetricStrip>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-5">
            <section className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex h-10 items-center justify-between border-b border-border px-3.5">
                <div className="min-w-0">
                  <h2 className="text-[13px] font-semibold">Call volume</h2>
                  <p className="text-[10px] text-muted-foreground">Last 7 days · completed vs failed</p>
                </div>
                <Link
                  href="/app/analytics"
                  className="text-[11px] text-muted-foreground hover:text-foreground shrink-0 rounded-sm transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  View analytics
                </Link>
              </div>
              <div className="px-2 pt-3 pb-2 sm:px-3">
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                    <defs>
                      <linearGradient id="homeCompleted" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={ct.palette.completed} stopOpacity={0.28} />
                        <stop offset="95%" stopColor={ct.palette.completed} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="homeFailed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={ct.palette.failed} stopOpacity={0.22} />
                        <stop offset="95%" stopColor={ct.palette.failed} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={ct.gridColor} strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: ct.tickColor }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: ct.tickColor }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                      width={28}
                    />
                    <Tooltip
                      contentStyle={{
                        background: ct.tooltipBg,
                        border: `1px solid ${ct.tooltipBorder}`,
                        borderRadius: 6,
                        fontSize: 11,
                        color: ct.tooltipText,
                        boxShadow: ct.tooltipShadow,
                      }}
                      labelFormatter={(_, payload) => {
                        const date = payload?.[0]?.payload?.date as string | undefined;
                        if (!date) return "";
                        try {
                          return format(parseISO(date), "MMM d, yyyy");
                        } catch {
                          return date;
                        }
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, color: ct.tickColor }} />
                    <Area
                      type="monotone"
                      dataKey="completed"
                      name="Completed"
                      stroke={ct.palette.completed}
                      fill="url(#homeCompleted)"
                      strokeWidth={1.75}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="failed"
                      name="Failed"
                      stroke={ct.palette.failed}
                      fill="url(#homeFailed)"
                      strokeWidth={1.5}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
                {weekTotal === 0 && !volumeQ.isLoading && (
                  <p className="px-2 pb-3 text-center text-[11px] text-muted-foreground">
                    Your first dials fill this chart — start a campaign to upload leads and call.
                  </p>
                )}
              </div>
            </section>

            <div className="min-w-0 overflow-hidden rounded-lg border border-border">
              <div className="flex h-10 items-center justify-between border-b border-border px-3.5">
                <h2 className="text-[13px] font-semibold">What’s running</h2>
                <Link href="/app/history" className="text-[11px] text-muted-foreground hover:text-foreground">
                  History
                </Link>
              </div>
              {recentReach.length === 0 ? (
                <EmptyState
                  variant="inline"
                  icon={<PhoneCall />}
                  title="Nothing in the queue yet"
                  description="Create a campaign, upload leads, and start dialing — your volume chart updates live."
                  action={{
                    label: "New campaign",
                    icon: <Plus className="size-3.5" />,
                    onClick: () => navigate("/app/campaigns"),
                  }}
                  secondaryAction={{
                    label: "Open agent",
                    onClick: () =>
                      navigate(firstAgentId != null ? `/app/agents/${firstAgentId}` : "/app/agents"),
                  }}
                />
              ) : (
                <div className="divide-y divide-border/70">
                  {recentReach.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        className="flex min-h-12 cursor-pointer items-center gap-2.5 px-3.5 transition-colors duration-200 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                          <Icon className="size-3.5 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium">{item.name}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{item.detail}</p>
                        </div>
                        <StatusDot tone={statusTone(item.status)} />
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-5">
            <div className="min-w-0 overflow-hidden rounded-lg border border-border">
              <div className="flex h-10 items-center justify-between border-b border-border px-3.5">
                <h2 className="text-[13px] font-semibold">Agents</h2>
                <Link href="/app/agents" className="text-[11px] text-muted-foreground hover:text-foreground">
                  View all
                </Link>
              </div>
              <div className="divide-y divide-border/70">
                {agents.slice(0, 5).map((agent: any) => (
                  <Link
                    key={agent.id}
                    href={`/app/agents/${agent.id}`}
                    className="group grid min-h-12 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-3.5 transition-colors duration-200 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                        <Bot className="size-3.5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-[13px] font-medium">{agent.name ?? `Agent ${agent.id}`}</p>
                          <span className="shrink-0 rounded bg-muted/80 px-1 py-0.5 text-[9px] font-mono font-medium text-muted-foreground">#{agent.id}</span>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] capitalize text-muted-foreground">
                          {agent.status ?? "draft"}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="size-3 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                ))}
              </div>
            </div>

            {!setupDone && (
              <section className="rounded-lg border border-border bg-card">
                <div className="border-b border-border px-3.5 py-3">
                  <h2 className="text-[11px] font-semibold">Finish setup</h2>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">Agent → Campaign → dial.</p>
                </div>
                <div className="p-2">
                  {setup.map((item, index) => (
                    <Link
                      key={item.label}
                      href={item.href}
                      className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-[11px] transition-colors duration-200 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <span
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded-full border text-[8px]",
                          item.done
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                            : "border-border text-muted-foreground",
                        )}
                      >
                        {item.done ? <Check className="size-2.5" /> : index + 1}
                      </span>
                      <span className={cn("min-w-0 flex-1 truncate", item.done && "text-muted-foreground")}>
                        {item.label}
                      </span>
                      <ArrowRight className="size-3 text-muted-foreground/40" />
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {issues.length > 0 && (
              <section className="rounded-lg border border-border bg-card">
                <div className="border-b border-border px-3.5 py-3">
                  <h2 className="text-[11px] font-semibold">Needs attention</h2>
                </div>
                <div className="divide-y divide-border/70">
                  {issues.map((issue) => (
                    <Link
                      key={issue.title}
                      href={issue.href}
                      className="flex min-h-11 cursor-pointer items-start gap-2 px-3.5 py-2.5 transition-colors duration-200 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <CircleAlert
                        className={cn(
                          "mt-0.5 size-3.5 shrink-0",
                          issue.tone === "danger" ? "text-destructive" : "text-amber-500",
                        )}
                      />
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium">{issue.title}</p>
                        <p className="text-[10px] text-muted-foreground">{issue.detail}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {balanceCents != null && (
              <Link
                href="/app/wallet"
                className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3.5 py-3 transition-colors duration-200 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Wallet className="size-3.5 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium">Wallet</p>
                  <p className="text-[10px] text-muted-foreground">
                    ₹{(balanceCents / 100).toFixed(0)}
                    {availableMinutes != null ? ` · ~${availableMinutes} min` : ""}
                    {isManagedWorkspace ? " · partner-funded" : ""}
                  </p>
                </div>
                <ArrowRight className="size-3 text-muted-foreground/40" />
              </Link>
            )}

            {calls.slice(0, 4).length > 0 && (
              <section className="rounded-lg border border-border bg-card">
                <div className="flex h-10 items-center justify-between border-b border-border px-3.5">
                  <h2 className="text-[11px] font-semibold">Recent calls</h2>
                  <Link href="/app/history" className="text-[10px] text-muted-foreground hover:text-foreground">
                    All
                  </Link>
                </div>
                <div className="divide-y divide-border/70">
                  {calls.slice(0, 4).map((call: any) => (
                    <Link
                      key={call.id}
                      href={`/app/history/${call.id}`}
                      className="flex min-h-10 cursor-pointer items-center gap-2 px-3.5 transition-colors duration-200 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <Phone className="size-3 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-medium">
                          {call.toNumber || call.fromNumber || `Call ${call.id}`}
                        </p>
                        <p className="truncate text-[10px] text-muted-foreground">
                          {relativeTime(call.startedAt ?? call.createdAt)} · {durationLabel(call.durationSeconds)}
                        </p>
                      </div>
                      <StatusDot tone={statusTone(String(call.status ?? ""))} />
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>
    </StripePage>
  );
}
