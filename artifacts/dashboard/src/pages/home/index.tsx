/**
 * Business Home — agent-first landing (Phase 1 shell).
 * Primary path: create / open an agent. Existing dial pipelines stay visible
 * under "Active work" until Reach absorbs them inside the agent builder.
 */

import { Link, useLocation } from "wouter";
import {
  Phone, Users, Zap, FileSpreadsheet, AlertTriangle, Wallet,
  ArrowRight, CheckCircle2, Bot, PlugZap, Play, Pause, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  useGetDashboardStats,
  useListCalls,
  useListAgents,
  useListCampaigns,
  useListPhoneNumbers,
  useGetWallet,
  getGetDashboardStatsQueryKey,
  getListCallsQueryKey,
  getListAgentsQueryKey,
  getListCampaignsQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useMinuteRatesMap, useUserProviderNames } from "@/hooks/use-minute-rates";

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

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtDuration(s: number | null | undefined): string {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function statusTone(status: string) {
  const s = status.toLowerCase();
  if (s === "completed" || s === "active" || s === "running") return "text-emerald-600 bg-emerald-500/10";
  if (s === "failed" || s === "error") return "text-rose-600 bg-rose-500/10";
  if (s === "calling" || s === "connected" || s === "ringing") return "text-sky-600 bg-sky-500/10";
  if (s === "paused") return "text-amber-700 bg-amber-500/10";
  return "text-muted-foreground bg-muted";
}

export default function HomePage() {
  const [, navigate] = useLocation();

  const stats = useGetDashboardStats({
    query: { queryKey: getGetDashboardStatsQueryKey(), refetchInterval: 30_000, staleTime: 20_000 },
  });
  const callsQ = useListCalls(
    undefined,
    { query: { queryKey: [...getListCallsQueryKey(), "home"], refetchInterval: 30_000 } },
  );
  const agentsQ = useListAgents({
    query: { queryKey: getListAgentsQueryKey(), staleTime: 30_000 },
  });
  const campaignsQ = useListCampaigns({
    query: { queryKey: getListCampaignsQueryKey(), staleTime: 30_000 },
  });
  const phonesQ = useListPhoneNumbers();
  const { data: wallet } = useGetWallet();
  const rateMap = useMinuteRatesMap();
  const userProviders = useUserProviderNames();
  const rateCentsPerMin = wallet?.effectiveRateCentsPerMin
    ?? rateMap.get(userProviders.size > 0 ? "byop" : "managed") ?? 500;
  const balanceCents = wallet?.balanceCents ?? null;
  const availMins = balanceCents != null ? Math.floor(balanceCents / rateCentsPerMin) : null;

  const pipelinesQ = useQuery({
    queryKey: ["automatic-calls"],
    queryFn: () => customFetch<AutoPipeline[]>("/api/automatic-calls"),
    refetchInterval: 30_000,
  });

  const agents = Array.isArray(agentsQ.data) ? agentsQ.data : (agentsQ.data as any)?.agents ?? [];
  const campaigns = Array.isArray(campaignsQ.data) ? campaignsQ.data : [];
  const calls = Array.isArray(callsQ.data) ? callsQ.data : (callsQ.data as any)?.calls ?? [];
  const phones = Array.isArray(phonesQ.data) ? phonesQ.data : [];
  const pipelines = pipelinesQ.data ?? [];

  const runningPipelines = pipelines.filter((p) => p.status === "running");
  const activeCampaigns = campaigns.filter((c: any) => c.status === "active" || c.isActive);
  const pausedAuthPipelines = pipelines.filter(
    (p) => p.status === "paused" && p.lastError && /reconnect google/i.test(p.lastError),
  );
  const failedRecent = calls.filter((c: any) =>
    ["failed", "error"].includes(String(c.status ?? "").toLowerCase()),
  ).length;

  const lowWallet = balanceCents != null && balanceCents < 10_000;
  const hasAgent = agents.length > 0;
  const hasPhone = phones.length > 0;

  const attention: Array<{ title: string; desc: string; href: string; tone: "amber" | "rose" }> = [];
  for (const p of pausedAuthPipelines) {
    attention.push({
      title: "Google Sheets disconnected",
      desc: `${p.name} is paused — reconnect Google, then Resume.`,
      href: "/app/connections",
      tone: "amber",
    });
  }
  if (lowWallet) {
    attention.push({
      title: "Low wallet balance",
      desc: availMins != null ? `About ${availMins} minutes left. Top up to keep dialing.` : "Top up to keep dialing.",
      href: "/app/wallet",
      tone: "rose",
    });
  }
  if (failedRecent > 0) {
    attention.push({
      title: `${failedRecent} failed call${failedRecent === 1 ? "" : "s"} in recent list`,
      desc: "Review Call Logs for dial or telephony errors.",
      href: "/app/calls",
      tone: "rose",
    });
  }
  if (!hasAgent) {
    attention.push({
      title: "No agent yet",
      desc: "Create a voice agent — everything else (calls, WhatsApp, meetings) binds to it.",
      href: "/app/vibe",
      tone: "amber",
    });
  } else if (!hasPhone) {
    attention.push({
      title: "No phone number",
      desc: "Assign or buy a number so your agent can place calls.",
      href: "/app/phone-numbers",
      tone: "amber",
    });
  }

  const s = stats.data;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Home</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Your agents are the center — open one to configure voice, channels, and how leads reach it
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button size="sm" onClick={() => navigate("/app/vibe")}>
            <Sparkles className="h-3.5 w-3.5 mr-1" /> Create agent
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate("/app/agents")}>
            <Bot className="h-3.5 w-3.5 mr-1" /> Open agents
          </Button>
        </div>
      </div>

      {/* Empty / first-run — agent only */}
      {!hasAgent && !agentsQ.isLoading && (
        <section className="rounded-xl border border-dashed border-border/70 px-5 py-10 text-center space-y-4">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Bot className="h-6 w-6 text-primary" />
          </div>
          <div className="space-y-1.5">
            <p className="text-base font-semibold">Start with an agent</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              An agent is your voice runtime. After you create one, you’ll connect phone,
              WhatsApp, meetings, and how leads reach it — all from the agent builder.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <Button onClick={() => navigate("/app/vibe")}>
              <Sparkles className="h-3.5 w-3.5 mr-1" /> Create with Vibe
            </Button>
            <Button variant="outline" onClick={() => navigate("/app/agents?create=1")}>
              Manual build
            </Button>
          </div>
        </section>
      )}

      {/* Your agents */}
      {hasAgent && (
        <section className="rounded-xl border border-border/60 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-border/50 flex items-center justify-between">
            <h2 className="text-xs font-medium">Your agents</h2>
            <Link href="/app/agents" className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
              View all
            </Link>
          </div>
          <div className="divide-y divide-border/40">
            {agents.slice(0, 6).map((a: any) => (
              <Link
                key={a.id}
                href={`/app/agents/${a.id}`}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors"
              >
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{a.name ?? `Agent ${a.id}`}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    Open builder — prompt, voice, channels, reach
                  </p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Today KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Calls today",
            value: s?.callsToday ?? "—",
            sub: s?.callsThisWeek != null ? `${s.callsThisWeek} this week` : undefined,
            href: "/app/calls",
            icon: Phone,
          },
          {
            label: "Success rate",
            value: s != null ? `${s.successRate}%` : "—",
            sub: "Completed calls",
            href: "/app/calls",
            icon: CheckCircle2,
          },
          {
            label: "Avg duration",
            value: s != null ? fmtDuration(s.avgDurationSeconds) : "—",
            sub: "Per call",
            href: "/app/calls",
            icon: Zap,
          },
          {
            label: "Wallet",
            value: balanceCents != null ? `₹${(balanceCents / 100).toFixed(0)}` : "—",
            sub: availMins != null ? `~${availMins} min` : undefined,
            href: "/app/wallet",
            icon: Wallet,
          },
        ].map(({ label, value, sub, href, icon: Icon }) => (
          <button
            key={label}
            type="button"
            onClick={() => navigate(href)}
            className="rounded-xl border border-border/60 bg-card/40 px-3 py-3 text-left hover:border-border transition-colors min-h-[88px]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
              <Icon className="h-3.5 w-3.5 text-muted-foreground/50" />
            </div>
            {stats.isLoading && label !== "Wallet" ? (
              <div className="mt-2 h-7 w-16 rounded animate-pulse bg-muted" />
            ) : (
              <>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
                {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
              </>
            )}
          </button>
        ))}
      </div>

      {/* Needs attention */}
      {attention.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Needs attention</h2>
          <ul className="space-y-2">
            {attention.map((a) => (
              <li key={a.title + a.href}>
                <Link
                  href={a.href}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                    a.tone === "rose"
                      ? "border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10"
                      : "border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10",
                  )}
                >
                  <AlertTriangle className={cn(
                    "h-4 w-4 mt-0.5 shrink-0",
                    a.tone === "rose" ? "text-rose-600" : "text-amber-600",
                  )} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{a.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{a.desc}</p>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Active work — keep until Reach migrates */}
        <section className="rounded-xl border border-border/60 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-border/50 flex items-center justify-between">
            <h2 className="text-xs font-medium">Active dialing</h2>
            <span className="text-[10px] text-muted-foreground">
              {runningPipelines.length} sheets · {activeCampaigns.length} lists
            </span>
          </div>
          <div className="divide-y divide-border/40">
            {runningPipelines.slice(0, 4).map((p) => (
              <Link
                key={p.id}
                href={`/app/automatic-calls/${p.id}`}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors"
              >
                <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <Play className="h-3.5 w-3.5 text-emerald-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    Sheet dial · {p.dialedCount} dialed · {p.enqueuedCount} queued
                  </p>
                </div>
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded capitalize", statusTone(p.status))}>
                  {p.status}
                </span>
              </Link>
            ))}
            {pipelines.filter((p) => p.status === "paused").slice(0, 2).map((p) => (
              <Link
                key={p.id}
                href={`/app/automatic-calls/${p.id}`}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors"
              >
                <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                  <Pause className="h-3.5 w-3.5 text-amber-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">Paused sheet dial</p>
                </div>
              </Link>
            ))}
            {activeCampaigns.slice(0, 4).map((c: any) => (
              <Link
                key={c.id}
                href={`/app/campaigns/${c.id}`}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors"
              >
                <div className="h-8 w-8 rounded-lg bg-sky-500/10 flex items-center justify-center shrink-0">
                  <Zap className="h-3.5 w-3.5 text-sky-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{c.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">List dial</p>
                </div>
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded capitalize", statusTone(c.status ?? "active"))}>
                  {c.status ?? "active"}
                </span>
              </Link>
            ))}
            {runningPipelines.length === 0 && activeCampaigns.length === 0 && pipelines.filter((p) => p.status === "paused").length === 0 && (
              <p className="px-3 py-8 text-xs text-muted-foreground text-center">
                Nothing dialing yet. Open an agent, or use sheet / list dial from More.
              </p>
            )}
          </div>
        </section>

        {/* Quick actions — agent first */}
        <section className="rounded-xl border border-border/60 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-border/50">
            <h2 className="text-xs font-medium">Quick actions</h2>
          </div>
          <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { label: "Create agent", desc: "Vibe Build or from scratch", href: "/app/vibe", icon: Sparkles },
              { label: "Open agents", desc: `${agents.length} total — builder`, href: "/app/agents", icon: Bot },
              { label: "Phone numbers", desc: "Buy or assign to an agent", href: "/app/phone-numbers", icon: Phone },
              { label: "Integrations", desc: "Sheets, CRM, WhatsApp apps", href: "/app/connections", icon: PlugZap },
              { label: "Sheet dial", desc: "Dial from Google Sheet", href: "/app/automatic-calls/new", icon: FileSpreadsheet },
              { label: "Calls", desc: "Listen & review", href: "/app/calls", icon: Users },
            ].map(({ label, desc, href, icon: Icon }) => (
              <Link
                key={href + label}
                href={href}
                className="flex items-start gap-2.5 rounded-lg border border-border/50 px-3 py-2.5 hover:bg-muted/30 transition-colors min-h-[52px]"
              >
                <div className="mt-0.5 rounded-md bg-muted/60 p-1.5 shrink-0">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-tight">{label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>

      {/* Recent calls */}
      <section className="rounded-xl border border-border/60 overflow-hidden">
        <div className="px-3 py-2.5 border-b border-border/50 flex items-center justify-between">
          <h2 className="text-xs font-medium">Recent calls</h2>
          <Link href="/app/calls" className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
            View all
          </Link>
        </div>
        {callsQ.isLoading ? (
          <p className="px-3 py-8 text-xs text-muted-foreground text-center">Loading…</p>
        ) : calls.length === 0 ? (
          <p className="px-3 py-8 text-xs text-muted-foreground text-center">No calls yet</p>
        ) : (
          <ul className="divide-y divide-border/40">
            {calls.slice(0, 8).map((c: any) => (
              <li key={c.id}>
                <Link
                  href={`/app/calls/${c.id}`}
                  className="flex items-center gap-3 px-3 py-2.5 text-xs hover:bg-muted/30 transition-colors"
                >
                  <span className={cn("capitalize px-1.5 py-0.5 rounded shrink-0", statusTone(c.status ?? ""))}>
                    {String(c.status ?? "—").replace(/_/g, " ")}
                  </span>
                  <span className="font-mono truncate flex-1">
                    {c.direction === "outbound" ? c.toNumber : c.fromNumber}
                  </span>
                  <span className="text-muted-foreground shrink-0 hidden sm:inline">
                    {fmtDuration(c.durationSeconds)}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {relativeTime(c.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
