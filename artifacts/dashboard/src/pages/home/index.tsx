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
  ShieldCheck,
  Activity,
  Layers,
  Sparkle,
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
    { label: "Create AI Agent", done: hasAgent, href: "/app/agents?create=1" },
    { label: "Connect Phone Number", done: hasPhone, href: "/app/phone-numbers" },
    {
      label: "Setup Lead Automation / Studio",
      done: hasReach,
      href: firstAgentId ? `/app/automation?agentId=${firstAgentId}` : "/app/automation",
    },
  ];
  const completedSetupCount = setup.filter(s => s.done).length;
  const setupPercent = Math.round((completedSetupCount / setup.length) * 100);
  const setupDone = setup.every(s => s.done);

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
      detail: `Balance ₹${balanceInr}. Top up to ensure continuous dialing.`,
      href: "/app/wallet",
      tone: "danger",
    });
  }
  if (failedCalls.length > 0) {
    issues.push({
      title: `${failedCalls.length} recent failed call${failedCalls.length === 1 ? "" : "s"}`,
      detail: "Review provider logs and dial errors",
      href: "/app/calls",
      tone: "danger",
    });
  }

  const recentReach = [
    ...activePipelines.map((pipeline) => ({
      id: `sheet-${pipeline.id}`,
      name: pipeline.name,
      detail: `Sheet dial · ${pipeline.dialedCount} dialed · ${pipeline.enqueuedCount} queued`,
      href: `/app/automatic-calls/${pipeline.id}`,
      status: pipeline.status,
      icon: FileSpreadsheet,
    })),
    ...activeCampaigns.map((campaign: any) => ({
      id: `flow-${campaign.id}`,
      name: campaign.name,
      detail: "List / Studio dial",
      href: `/app/campaigns/${campaign.id}`,
      status: campaign.status ?? "active",
      icon: Zap,
    })),
  ].slice(0, 5);

  if (!hasAgent && !agentsQ.isLoading) {
    return (
      <main className="flex min-h-full items-center justify-center px-5 py-16">
        <div className="w-full max-w-lg text-center">
          <div className="mx-auto mb-6 flex size-14 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 shadow-lg shadow-primary/5">
            <Bot className="size-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Welcome to VoiceOrch AI</h1>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            Deploy hyper-realistic voice agents that make and take calls, schedule appointments, and connect seamlessly to your CRM.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => navigate("/app/vibe")}
              className="group relative flex flex-col items-start p-5 rounded-xl border border-primary/40 bg-gradient-to-b from-primary/10 to-transparent hover:border-primary transition-all text-left"
            >
              <Sparkles className="size-6 text-primary mb-3 group-hover:scale-110 transition-transform" />
              <p className="text-sm font-semibold text-foreground">Build with AI</p>
              <p className="mt-1 text-xs text-muted-foreground">Describe your business and auto-generate an agent.</p>
              <span className="mt-4 text-xs font-semibold text-primary flex items-center gap-1">
                Start Now <ArrowRight className="size-3" />
              </span>
            </button>
            <button
              type="button"
              onClick={() => navigate("/app/agents?create=1")}
              className="group flex flex-col items-start p-5 rounded-xl border border-border bg-card hover:bg-muted/40 transition-all text-left"
            >
              <Plus className="size-6 text-muted-foreground mb-3 group-hover:text-foreground transition-colors" />
              <p className="text-sm font-semibold text-foreground">Manual Config</p>
              <p className="mt-1 text-xs text-muted-foreground">Configure voices, prompts, tools and numbers.</p>
              <span className="mt-4 text-xs font-semibold text-muted-foreground group-hover:text-foreground flex items-center gap-1">
                Open Builder <ArrowRight className="size-3" />
              </span>
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* ── Top Header & Actions ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border/60">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            Dashboard
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 rounded-full">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live
            </span>
          </h1>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Real-time voice orchestration, active agents, and outbound lead performance.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" className="h-9 text-xs gap-1.5" onClick={() => navigate("/app/campaigns")}>
            <Layers className="size-3.5" /> Campaign Studios
          </Button>
          {!isManagedClient && (
            <Button size="sm" className="h-9 text-xs gap-1.5 bg-primary text-primary-foreground hover:opacity-90 shadow-md shadow-primary/10" onClick={() => navigate("/app/vibe")}>
              <Plus className="size-3.5" /> New AI Agent
            </Button>
          )}
        </div>
      </div>

      {/* ── Executive KPI Cards Grid ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Today's Calls */}
        <div className="p-4 rounded-xl border border-border/80 bg-card/80 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Calls Today</span>
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400">
              <PhoneCall className="size-4" />
            </div>
          </div>
          <div className="mt-3">
            <p className="text-3xl font-bold tracking-tight text-foreground">{statsQ.data?.callsToday ?? 0}</p>
            <p className="text-[11px] text-muted-foreground/60 mt-1 flex items-center gap-1">
              <Activity className="size-3 text-emerald-400" /> Active voice engine
            </p>
          </div>
        </div>

        {/* Card 2: Success Rate */}
        <div className="p-4 rounded-xl border border-border/80 bg-card/80 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Success Rate</span>
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
              <TrendingUp className="size-4" />
            </div>
          </div>
          <div className="mt-3">
            <p className="text-3xl font-bold tracking-tight text-foreground">
              {statsQ.data?.successRate != null ? `${statsQ.data.successRate}%` : "100%"}
            </p>
            <p className="text-[11px] text-muted-foreground/60 mt-1 flex items-center gap-1">
              <ShieldCheck className="size-3 text-emerald-400" /> Call completion quality
            </p>
          </div>
        </div>

        {/* Card 3: Active Agents */}
        <div className="p-4 rounded-xl border border-border/80 bg-card/80 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">AI Agents</span>
            <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400">
              <Bot className="size-4" />
            </div>
          </div>
          <div className="mt-3">
            <p className="text-3xl font-bold tracking-tight text-foreground">{agents.length}</p>
            <p className="text-[11px] text-muted-foreground/60 mt-1">
              {agents.filter((a: any) => a.status === "active").length} active, {agents.filter((a: any) => a.status !== "active").length} draft
            </p>
          </div>
        </div>

        {/* Card 4: Wallet Balance */}
        <div className="p-4 rounded-xl border border-border/80 bg-card/80 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Wallet Balance</span>
            <Link href="/app/wallet" className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors">
              <Wallet className="size-4" />
            </Link>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div>
              <p className="text-3xl font-bold tracking-tight text-foreground">₹{balanceInr}</p>
              <p className={cn("text-[11px] mt-1 font-medium", lowBalance ? "text-rose-400" : "text-muted-foreground/60")}>
                {lowBalance ? "⚠️ Low balance" : "Sufficient balance"}
              </p>
            </div>
            <Link href="/app/wallet" className="text-xs font-semibold text-primary hover:underline">
              Top Up →
            </Link>
          </div>
        </div>
      </div>

      {/* ── Main Layout (Agents & Sidebar) ── */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Agents Card */}
        <div className="rounded-xl border border-border/80 bg-card/80 shadow-sm overflow-hidden flex flex-col">
          <div className="flex h-12 items-center justify-between border-b border-border/60 px-4">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 flex items-center gap-2">
              <Bot className="size-4 text-primary" /> Active AI Agents
              <span className="text-muted-foreground/30 font-normal">({agents.length})</span>
            </h2>
            <Link href="/app/agents" className="text-xs font-semibold text-primary hover:underline">
              View All →
            </Link>
          </div>

          <div className="divide-y divide-border/60">
            {agents.slice(0, 6).map((agent: any) => (
              <Link
                key={agent.id}
                href={`/app/agents/${agent.id}`}
                className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3.5 transition-colors hover:bg-muted/30"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="size-9 rounded-xl border border-border/80 bg-background flex items-center justify-center shrink-0 group-hover:border-primary/50 transition-colors">
                    <Bot className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                        {agent.name ?? `Agent #${agent.id}`}
                      </p>
                      <span className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium capitalize",
                        agent.status === "active" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-muted/60 text-muted-foreground border border-border"
                      )}>
                        <StatusDot tone={agent.status === "active" ? "success" : "neutral"} />
                        {agent.status ?? "draft"}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground/70">
                      {agent.description || "Prompt • Voice Runtime • Tool Orchestration"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground/60 hidden sm:inline font-mono">Agent #{agent.id}</span>
                  <ArrowRight className="size-4 text-muted-foreground/50 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Sidebar (Setup Progress + Health Issues) ── */}
        <aside className="space-y-6">
          {/* Setup Progress Card */}
          {!isManagedClient && !setupDone && (
            <div className="rounded-xl border border-border/80 bg-card/80 p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Setup Progress</h2>
                <span className="text-xs font-bold text-primary">{setupPercent}%</span>
              </div>

              {/* Progress Bar */}
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-500 rounded-full"
                  style={{ width: `${setupPercent}%` }}
                />
              </div>

              <div className="space-y-2 pt-1">
                {setup.map((item, index) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="flex items-center gap-2.5 p-2 rounded-lg text-xs font-medium transition-colors hover:bg-muted/40"
                  >
                    <span
                      className={cn(
                        "size-4 shrink-0 rounded-full flex items-center justify-center text-[9px] font-bold border",
                        item.done
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                          : "border-border text-muted-foreground bg-background"
                      )}
                    >
                      {item.done ? <Check className="size-2.5" /> : index + 1}
                    </span>
                    <span className={cn("min-w-0 flex-1 truncate", item.done ? "text-muted-foreground line-through" : "text-foreground")}>
                      {item.label}
                    </span>
                    {!item.done && <ArrowRight className="size-3 text-muted-foreground" />}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Workspace Health Section */}
          <div className="rounded-xl border border-border/80 bg-card/80 p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Workspace Health</h2>
              {issues.length === 0 ? (
                <span className="text-[10px] font-semibold text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Check className="size-3" /> Healthy
                </span>
              ) : (
                <span className="text-[10px] font-semibold text-rose-400 border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 rounded-full">
                  {issues.length} Issue{issues.length === 1 ? "" : "s"}
                </span>
              )}
            </div>

            {issues.length === 0 ? (
              <p className="text-xs text-muted-foreground/70 py-2">All voice pipelines and webhooks operational.</p>
            ) : (
              <div className="space-y-2">
                {issues.map((issue) => (
                  <Link
                    key={`${issue.title}-${issue.href}`}
                    href={issue.href}
                    className="flex items-start gap-2.5 p-2.5 rounded-lg border border-border/60 bg-background/50 hover:bg-muted/40 transition-colors"
                  >
                    <CircleAlert
                      className={cn(
                        "size-4 shrink-0 mt-0.5",
                        issue.tone === "danger" ? "text-rose-400" : "text-amber-400"
                      )}
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{issue.title}</p>
                      <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">{issue.detail}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ── Lower Section (Recent Activity & Active Automation) ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Call Activity */}
        <div className="rounded-xl border border-border/80 bg-card/80 shadow-sm overflow-hidden flex flex-col">
          <div className="flex h-12 items-center justify-between border-b border-border/60 px-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Activity className="size-4 text-blue-400" /> Recent Call Activity
            </h2>
            <Link href="/app/calls" className="text-xs font-semibold text-primary hover:underline">
              View Call Logs →
            </Link>
          </div>

          {callsQ.isLoading ? (
            <p className="p-8 text-center text-xs text-muted-foreground">Loading recent call activity…</p>
          ) : calls.length === 0 ? (
            <p className="p-8 text-center text-xs text-muted-foreground">No call activity recorded yet.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {calls.slice(0, 6).map((call: any) => (
                <Link
                  key={call.id}
                  href={`/app/calls/${call.id}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-4 py-3 text-xs hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <StatusDot tone={statusTone(String(call.status ?? ""))} />
                    <span className="font-mono font-medium text-foreground truncate">
                      {call.direction === "outbound" ? call.toNumber : call.fromNumber}
                    </span>
                  </div>
                  <span className="text-muted-foreground font-mono text-[11px]">{durationLabel(call.durationSeconds)}</span>
                  <span className="text-muted-foreground/70 text-[11px] font-mono text-right w-16">{relativeTime(call.createdAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Active Automation / Campaign Pipelines */}
        <div className="rounded-xl border border-border/80 bg-card/80 shadow-sm overflow-hidden flex flex-col">
          <div className="flex h-12 items-center justify-between border-b border-border/60 px-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Zap className="size-4 text-amber-400" /> Active Lead Pipelines
            </h2>
            <span className="text-[10px] font-semibold text-muted-foreground">
              {activePipelines.length} Sheets · {activeCampaigns.length} Studios
            </span>
          </div>

          {recentReach.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-xs text-muted-foreground">No active lead sources or campaign pipelines currently running.</p>
              <Link
                href="/app/campaigns"
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                Create Campaign Studio <ArrowRight className="size-3" />
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {recentReach.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="flex items-center gap-3 px-4 py-3 text-xs hover:bg-muted/30 transition-colors"
                  >
                    <div className="p-2 rounded-lg bg-muted/60 text-muted-foreground shrink-0">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground truncate">{item.name}</p>
                      <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">{item.detail}</p>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium capitalize text-muted-foreground shrink-0">
                      <StatusDot tone={statusTone(item.status)} />
                      {item.status}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
