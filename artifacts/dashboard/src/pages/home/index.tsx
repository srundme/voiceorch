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
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { StripePage } from "@/components/stripe-page";
import { StatusDot } from "@/components/workspace/workspace";
import { useMinuteRatesMap, useUserProviderNames } from "@/hooks/use-minute-rates";
import { usePartnerContext } from "@/hooks/use-partner";
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

export default function HomePage() {
  const [, navigate] = useLocation();
  const { data: partnerContext } = usePartnerContext();
  const isManagedClient = partnerContext?.isManagedClient === true;
  const statsQ = useGetDashboardStats({
    query: { queryKey: getGetDashboardStatsQueryKey(), refetchInterval: 30_000, staleTime: 20_000 },
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
  const pipelinesQ = useQuery({
    queryKey: ["automatic-calls"],
    queryFn: () => customFetch<AutoPipeline[]>("/api/automatic-calls"),
    refetchInterval: 30_000,
  });

  const agents = Array.isArray(agentsQ.data) ? agentsQ.data : (agentsQ.data as any)?.agents ?? [];
  const calls = Array.isArray(callsQ.data) ? callsQ.data : (callsQ.data as any)?.calls ?? [];
  const campaigns = Array.isArray(campaignsQ.data) ? campaignsQ.data : [];
  const pipelines: AutoPipeline[] = pipelinesQ.data ?? [];
  const activeCampaigns = campaigns.filter((campaign: any) => campaign.status === "active" || campaign.isActive);
  const activePipelines = pipelines.filter((pipeline) => pipeline.status === "running");
  const failedCalls = calls.filter((call: any) =>
    ["failed", "error"].includes(String(call.status ?? "").toLowerCase()),
  );

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
  const hasLeads = campaigns.length > 0;
  const setup = [
    { label: "Create an agent", done: hasAgent, href: "/app/agents?create=1" },
    { label: "Create a campaign", done: hasLeads, href: "/app/campaigns" },
    { label: "Connect phone / channels", done: true, href: "/app/connections" },
  ];
  const setupDone = setup.every((item) => item.done);

  const issues: Array<{ title: string; detail: string; href: string; tone: "warning" | "danger" }> = [];
  pipelines
    .filter((pipeline) => pipeline.status === "paused" && /reconnect google/i.test(pipeline.lastError ?? ""))
    .forEach((pipeline) => {
      issues.push({
        title: "Google Sheets disconnected",
        detail: `${pipeline.name} is paused`,
        href: "/app/connections",
        tone: "warning",
      });
    });
  if (lowBalance) {
    issues.push({
      title: "Low wallet balance",
      detail: availableMinutes == null ? "Top up to keep dialing" : `About ${availableMinutes} minutes remain`,
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
    if (isManagedClient) {
      return (
        <main className="flex min-h-full items-center justify-center px-5 py-12">
          <div className="w-full max-w-md text-center">
            <div className="mx-auto mb-5 flex size-9 items-center justify-center rounded-lg border border-border bg-card">
              <Bot className="size-4" />
            </div>
            <h1 className="text-lg font-semibold tracking-[-0.02em]">No agents assigned</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Your managed workspace does not have an agent yet. Contact your workspace provider
              to configure and assign one.
            </p>
          </div>
        </main>
      );
    }
    return (
      <main className="flex min-h-full items-center justify-center px-5 py-12">
        <div className="w-full max-w-lg">
          <div className="mb-8">
            <div className="mb-5 flex size-9 items-center justify-center rounded-lg border border-border bg-card">
              <Bot className="size-4" />
            </div>
            <h1 className="text-2xl font-semibold tracking-[-0.03em]">Create your first agent</h1>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              Build the voice agent first, then create a campaign to dial leads.
            </p>
          </div>
          <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
            <button
              type="button"
              onClick={() => navigate("/app/vibe")}
              className="group bg-background p-5 text-left transition-colors hover:bg-muted/45"
            >
              <Sparkles className="mb-7 size-4 text-muted-foreground group-hover:text-foreground" />
              <p className="text-sm font-medium">Build with AI</p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                Describe the job and generate a configured agent.
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-[11px] font-medium">
                Start building <ArrowRight className="size-3" />
              </span>
            </button>
            <button
              type="button"
              onClick={() => navigate("/app/agents?create=1")}
              className="group bg-background p-5 text-left transition-colors hover:bg-muted/45"
            >
              <Plus className="mb-7 size-4 text-muted-foreground group-hover:text-foreground" />
              <p className="text-sm font-medium">Configure manually</p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                Choose every provider, voice, prompt, and runtime setting.
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-[11px] font-medium">
                Open builder <ArrowRight className="size-3" />
              </span>
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <StripePage
      title="Home"
      description={`${statsQ.data?.callsToday ?? "—"} calls today${statsQ.data?.successRate != null ? ` · ${statsQ.data.successRate}% success` : ""}${balanceCents != null ? ` · ₹${(balanceCents / 100).toFixed(0)} balance` : ""}`}
      actions={
        !isManagedClient ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="h-8 gap-1.5 px-3 text-xs" onClick={() => navigate("/app/campaigns")}>
              <Plus className="size-3.5" />
              New campaign
            </Button>
            <Button size="sm" className="h-8 gap-1.5 px-3 text-xs" onClick={() => navigate("/app/agents?create=1")}>
              <Plus className="size-3.5" />
              New agent
            </Button>
          </div>
        ) : undefined
      }
      contentClassName="!pt-4"
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 overflow-hidden rounded-lg border border-border">
          <div className="flex h-10 items-center justify-between border-b border-border px-3.5">
            <h2 className="text-[13px] font-semibold">What’s running</h2>
            <Link href="/app/history" className="text-[11px] text-muted-foreground hover:text-foreground">
              History
            </Link>
          </div>
          {recentReach.length === 0 ? (
            <div className="px-3.5 py-10 text-center">
              <p className="text-[12px] font-medium text-foreground">Nothing in the queue yet</p>
              <p className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed max-w-sm mx-auto">
                Create an agent, then start a campaign to upload leads and dial.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                {!hasAgent ? (
                  <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => navigate("/app/agents?create=1")}>
                    <Plus className="size-3.5" />
                    Create agent
                  </Button>
                ) : (
                  <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => navigate("/app/campaigns")}>
                    <Plus className="size-3.5" />
                    New campaign
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border/70">
              {recentReach.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="flex min-h-12 items-center gap-2.5 px-3.5 hover:bg-muted/35"
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
                  className="group grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-3.5 transition-colors hover:bg-muted/35"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                      <Bot className="size-3.5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">{agent.name ?? `Agent ${agent.id}`}</p>
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
          {!isManagedClient && !setupDone && (
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
                    className="flex min-h-9 items-center gap-2 rounded-md px-2 text-[11px] transition-colors hover:bg-muted/40"
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
                    className="flex min-h-11 items-start gap-2 px-3.5 py-2.5 hover:bg-muted/35"
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
              className="flex items-center gap-2.5 rounded-lg border border-border px-3.5 py-3 hover:bg-muted/35"
            >
              <Wallet className="size-3.5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium">Wallet</p>
                <p className="text-[10px] text-muted-foreground">
                  ₹{(balanceCents / 100).toFixed(0)}
                  {availableMinutes != null ? ` · ~${availableMinutes} min` : ""}
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
                    className="flex min-h-10 items-center gap-2 px-3.5 hover:bg-muted/35"
                  >
                    <Phone className="size-3 text-muted-foreground shrink-0" />
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
    </StripePage>
  );
}
