import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Bot,
  Check,
  CircleAlert,
  FileSpreadsheet,
  Phone,
  Plus,
  Sparkles,
  Wallet,
  Zap,
  PhoneCall,
  TrendingUp,
  Activity,
} from "lucide-react";
import {
  customFetch,
  getGetDashboardStatsQueryKey,
  getListAgentsQueryKey,
  getListCallsQueryKey,
  getListCampaignsQueryKey,
  useGetDashboardStats,
  useGetWallet,
  useListAgents,
  useListCalls,
  useListCampaigns,
  useListPhoneNumbers,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/workspace/workspace";
import { usePartnerContext } from "@/hooks/use-partner";
import { StripePage } from "@/components/stripe-page";
import { EmptyState } from "@/components/empty-state";
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

function Kpi({
  label,
  value,
  hint,
  icon,
  iconClass,
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: ReactNode;
  iconClass: string;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
          {label}
        </p>
        <div className={cn("rounded-lg p-2", iconClass)}>{icon}</div>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground/70">{hint}</p>
    </div>
  );
}

export default function HomePage() {
  const [, navigate] = useLocation();
  const { data: partnerContext } = usePartnerContext();
  const isManagedClient = partnerContext?.isManagedClient === true;

  const statsQ = useGetDashboardStats({
    query: { queryKey: getGetDashboardStatsQueryKey(), refetchInterval: 15_000, staleTime: 10_000 },
  });
  const callsQ = useListCalls(undefined, {
    query: { queryKey: [...getListCallsQueryKey(), "home"], refetchInterval: 15_000 },
  });
  const agentsQ = useListAgents({
    query: { queryKey: getListAgentsQueryKey(), staleTime: 20_000 },
  });
  const campaignsQ = useListCampaigns({
    query: { queryKey: getListCampaignsQueryKey(), staleTime: 20_000 },
  });
  const phonesQ = useListPhoneNumbers();
  const walletQ = useGetWallet();
  const pipelinesQ = useQuery({
    queryKey: ["automatic-calls"],
    queryFn: () => customFetch<AutoPipeline[]>("/api/automatic-calls"),
    refetchInterval: 20_000,
  });

  const agents = Array.isArray(agentsQ.data) ? agentsQ.data : (agentsQ.data as any)?.agents ?? [];
  const calls = Array.isArray(callsQ.data) ? callsQ.data : (callsQ.data as any)?.calls ?? [];
  const campaigns = Array.isArray(campaignsQ.data) ? campaignsQ.data : [];
  const phones = Array.isArray(phonesQ.data) ? phonesQ.data : [];
  const pipelines: AutoPipeline[] = pipelinesQ.data ?? [];
  const activeCampaigns = campaigns.filter((c: any) => c.status === "active" || c.isActive);
  const activePipelines = pipelines.filter((p) => p.status === "running");
  const failedCalls = calls.filter((c: any) =>
    ["failed", "error"].includes(String(c.status ?? "").toLowerCase()),
  );

  const wallet = walletQ.data;
  const balanceCents = wallet?.balanceCents ?? 0;
  const balanceInr = (balanceCents / 100).toFixed(2);
  const lowBalance = balanceCents < 10_000;

  const hasAgent = agents.length > 0;
  const hasPhone = phones.length > 0;
  const hasReach = activeCampaigns.length > 0 || pipelines.length > 0;
  const firstAgentId = agents[0]?.id;

  const setup = [
    { label: "Create your first agent", done: hasAgent, href: "/app/vibe" },
    { label: "Add a phone number", done: hasPhone, href: "/app/phone-numbers" },
    {
      label: "Start calling leads",
      done: hasReach,
      href: firstAgentId ? `/app/automation?agentId=${firstAgentId}` : "/app/campaigns",
    },
  ];
  const completedSetupCount = setup.filter((s) => s.done).length;
  const setupPercent = Math.round((completedSetupCount / setup.length) * 100);
  const setupDone = setup.every((s) => s.done);

  const issues: Array<{ title: string; detail: string; href: string; tone: "warning" | "danger" }> = [];
  pipelines
    .filter((pipeline) => pipeline.status === "paused" && /reconnect google/i.test(pipeline.lastError ?? ""))
    .forEach((pipeline) => {
      issues.push({
        title: "Google Sheets disconnected",
        detail: `${pipeline.name} is paused — reconnect to resume dialing`,
        href: "/app/connections",
        tone: "warning",
      });
    });
  if (lowBalance) {
    issues.push({
      title: "Low wallet balance",
      detail: `₹${balanceInr} left. Top up so calls keep running.`,
      href: "/app/wallet",
      tone: "danger",
    });
  }
  if (failedCalls.length > 0) {
    issues.push({
      title: `${failedCalls.length} recent failed call${failedCalls.length === 1 ? "" : "s"}`,
      detail: "Open Activity to see what went wrong",
      href: "/app/calls",
      tone: "danger",
    });
  }

  const recentReach = [
    ...activePipelines.map((pipeline) => ({
      id: `sheet-${pipeline.id}`,
      name: pipeline.name,
      detail: `${pipeline.dialedCount} dialed · ${pipeline.enqueuedCount} queued`,
      href: `/app/automatic-calls/${pipeline.id}`,
      status: pipeline.status,
      icon: FileSpreadsheet,
    })),
    ...activeCampaigns.map((campaign: any) => ({
      id: `flow-${campaign.id}`,
      name: campaign.name,
      detail: "Campaign running",
      href: `/app/campaigns/${campaign.id}`,
      status: campaign.status ?? "active",
      icon: Zap,
    })),
  ].slice(0, 5);

  if (!hasAgent && !agentsQ.isLoading) {
    return (
      <StripePage
        title="Welcome to SnapServe"
        description="Create a voice agent in minutes — then connect a number and start calling."
      >
        <div className="mx-auto flex min-h-[55vh] max-w-xl items-center justify-center">
          <EmptyState
            variant="hero"
            className="w-full"
            icon={<Bot />}
            title="Start with your first agent"
            description="Tell us what your business does and we’ll build a ready-to-call voice agent. You can fine-tune voice, scripts, and tools anytime."
            action={{
              label: "Create agent with AI",
              onClick: () => navigate("/app/vibe"),
              icon: <Sparkles className="w-3.5 h-3.5" />,
            }}
            secondaryAction={
              isManagedClient
                ? undefined
                : {
                    label: "Open manual builder",
                    onClick: () => navigate("/app/agents?create=1"),
                  }
            }
          />
        </div>
      </StripePage>
    );
  }

  return (
    <StripePage
      title="Home"
      description="See how your agents are performing and what to do next."
      actions={
        !isManagedClient ? (
          <Button size="sm" className="h-9 gap-1.5 text-xs" onClick={() => navigate("/app/vibe")}>
            <Plus className="size-3.5" />
            New agent
          </Button>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Calls today"
          value={statsQ.data?.callsToday ?? 0}
          hint="Across all agents"
          icon={<PhoneCall className="size-4" />}
          iconClass="bg-sky-500/10 text-sky-400"
        />
        <Kpi
          label="Success rate"
          value={statsQ.data?.successRate != null ? `${statsQ.data.successRate}%` : "—"}
          hint="Completed calls"
          icon={<TrendingUp className="size-4" />}
          iconClass="bg-emerald-500/10 text-emerald-400"
        />
        <Kpi
          label="Agents"
          value={agents.length}
          hint={`${agents.filter((a: any) => a.status === "active").length} active`}
          icon={<Bot className="size-4" />}
          iconClass="bg-violet-500/10 text-violet-400"
        />
        <Kpi
          label="Wallet"
          value={`₹${balanceInr}`}
          hint={lowBalance ? "Top up recommended" : "Ready to dial"}
          icon={<Wallet className="size-4" />}
          iconClass="bg-amber-500/10 text-amber-400"
        />
      </div>

      {!isManagedClient && !setupDone && (
        <section className="rounded-xl border border-border/70 bg-card/50 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Get set up</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {completedSetupCount} of {setup.length} steps done
              </p>
            </div>
            <span className="text-sm font-semibold text-primary">{setupPercent}%</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${setupPercent}%` }}
            />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {setup.map((item, index) => (
              <Link
                key={item.label}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-xs transition-colors",
                  item.done
                    ? "border-border/50 bg-muted/20 text-muted-foreground"
                    : "border-primary/25 bg-primary/5 text-foreground hover:bg-primary/10",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold",
                    item.done
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                      : "border-border bg-background text-muted-foreground",
                  )}
                >
                  {item.done ? <Check className="size-3" /> : index + 1}
                </span>
                <span className={cn("min-w-0 flex-1 truncate font-medium", item.done && "line-through")}>
                  {item.label}
                </span>
                {!item.done && <ArrowRight className="size-3.5 shrink-0 text-primary" />}
              </Link>
            ))}
          </div>
        </section>
      )}

      {issues.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Needs attention</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {issues.map((issue) => (
              <Link
                key={`${issue.title}-${issue.href}`}
                href={issue.href}
                className="flex items-start gap-2.5 rounded-xl border border-border/70 bg-card/50 p-3.5 transition-colors hover:bg-muted/30"
              >
                <CircleAlert
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    issue.tone === "danger" ? "text-rose-400" : "text-amber-400",
                  )}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{issue.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{issue.detail}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="overflow-hidden rounded-xl border border-border/70 bg-card/50">
          <div className="flex h-12 items-center justify-between border-b border-border/60 px-4">
            <h2 className="text-sm font-semibold text-foreground">Your agents</h2>
            <Link href="/app/agents" className="text-xs font-semibold text-primary hover:underline">
              View all
            </Link>
          </div>
          {agents.length === 0 ? (
            <EmptyState
              variant="inline"
              icon={<Bot />}
              title="No agents yet"
              description="Create an agent to start making and taking calls."
              action={{
                label: "Create agent",
                onClick: () => navigate("/app/vibe"),
                icon: <Plus className="w-3.5 h-3.5" />,
              }}
            />
          ) : (
            <div className="divide-y divide-border/50">
              {agents.slice(0, 5).map((agent: any) => (
                <Link
                  key={agent.id}
                  href={`/app/agents/${agent.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/25"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background">
                    <Bot className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-foreground">
                        {agent.name ?? `Agent #${agent.id}`}
                      </p>
                      <StatusDot tone={agent.status === "active" ? "success" : "neutral"} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {agent.description || "Voice agent"}
                    </p>
                  </div>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground/40" />
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-xl border border-border/70 bg-card/50">
          <div className="flex h-12 items-center justify-between border-b border-border/60 px-4">
            <h2 className="text-sm font-semibold text-foreground">Recent calls</h2>
            <Link href="/app/calls" className="text-xs font-semibold text-primary hover:underline">
              Activity
            </Link>
          </div>
          {callsQ.isLoading ? (
            <p className="p-8 text-center text-xs text-muted-foreground">Loading calls…</p>
          ) : calls.length === 0 ? (
            <EmptyState
              variant="inline"
              icon={<Phone />}
              title="No calls yet"
              description="Once your agent is live, recent calls will show up here."
              action={{
                label: "Open phone numbers",
                onClick: () => navigate("/app/phone-numbers"),
              }}
            />
          ) : (
            <div className="divide-y divide-border/50">
              {calls.slice(0, 5).map((call: any) => (
                <Link
                  key={call.id}
                  href={`/app/calls/${call.id}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 text-xs transition-colors hover:bg-muted/25"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <StatusDot tone={statusTone(String(call.status ?? ""))} />
                    <span className="truncate font-mono font-medium text-foreground">
                      {call.direction === "outbound" ? call.toNumber : call.fromNumber}
                    </span>
                  </div>
                  <span className="font-mono text-muted-foreground">{durationLabel(call.durationSeconds)}</span>
                  <span className="w-14 text-right text-muted-foreground/70">
                    {relativeTime(call.createdAt)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="overflow-hidden rounded-xl border border-border/70 bg-card/50">
        <div className="flex h-12 items-center justify-between border-b border-border/60 px-4">
          <h2 className="text-sm font-semibold text-foreground">Active campaigns</h2>
          <Link href="/app/campaigns" className="text-xs font-semibold text-primary hover:underline">
            Campaigns
          </Link>
        </div>
        {recentReach.length === 0 ? (
          <EmptyState
            variant="inline"
            icon={<Zap />}
            title="Nothing running right now"
            description="Launch a campaign or sheet dialer when you’re ready to reach leads."
            action={{
              label: "Go to campaigns",
              onClick: () => navigate("/app/campaigns"),
            }}
          />
        ) : (
          <div className="divide-y divide-border/50">
            {recentReach.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className="flex items-center gap-3 px-4 py-3 text-xs transition-colors hover:bg-muted/25"
                >
                  <div className="rounded-lg bg-muted/50 p-2 text-muted-foreground">
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{item.name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.detail}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 capitalize text-muted-foreground">
                    <StatusDot tone={statusTone(item.status)} />
                    {item.status}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </StripePage>
  );
}
