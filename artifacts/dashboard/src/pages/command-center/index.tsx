import { useLocation } from "wouter";
import { useEffect, useRef, useState } from "react";
import {
  Terminal, RefreshCw, Activity, Zap, CheckCircle2,
  AlertTriangle, Server, Key, Bot,
  Cpu, Radio, AudioWaveform, Phone,
  ArrowUpRight, ArrowDownLeft,
  Rocket, Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useGetDashboardStats,
  useListCalls,
  useListProviders,
  useListAgents,
  useListActivityLogs,
  getGetDashboardStatsQueryKey,
  getListCallsQueryKey,
  getListProvidersQueryKey,
  getListAgentsQueryKey,
  getListActivityLogsQueryKey,
} from "@workspace/api-client-react";
import type { Call, ProviderConfig, ActivityLog, Agent } from "@workspace/api-client-react";

/* ── helpers ──────────────────────────────────────────────────────────────── */

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function fmtDuration(s: number | null | undefined): string {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtPhone(from: string | null | undefined, to: string | null | undefined, direction: string | null | undefined): string {
  const num = direction === "outbound" ? to : from;
  if (!num) return from ?? to ?? "—";
  if (num.length > 7) return num.replace(/(\+\d{1,2})(\d{3})(\d{3})(\d+)/, "$1 $2 $3 $4").trim();
  return num;
}

function statusColors(status: string) {
  const map: Record<string, string> = {
    completed:   "bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/20",
    active:      "bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/20",
    calling:     "bg-blue-500/15 text-blue-400 ring-1 ring-inset ring-blue-500/20 animate-pulse",
    connected:   "bg-blue-500/15 text-blue-400 ring-1 ring-inset ring-blue-500/20",
    failed:      "bg-red-500/15 text-red-400 ring-1 ring-inset ring-red-500/20",
    error:       "bg-red-500/15 text-red-400 ring-1 ring-inset ring-red-500/20",
    transferred: "bg-purple-500/15 text-purple-400 ring-1 ring-inset ring-purple-500/20",
    pending:     "bg-zinc-700/50 text-zinc-400 ring-1 ring-inset ring-zinc-600/30",
    queued:      "bg-zinc-700/50 text-zinc-400 ring-1 ring-inset ring-zinc-600/30",
    no_pickup:   "bg-zinc-700/50 text-zinc-400 ring-1 ring-inset ring-zinc-600/30",
    inactive:    "bg-zinc-700/50 text-zinc-500 ring-1 ring-inset ring-zinc-600/30",
  };
  return map[status] ?? "bg-zinc-800 text-zinc-400 ring-1 ring-inset ring-zinc-700/40";
}

function statusLabel(status: string): string {
  if (status === "no_pickup") return "No Pickup";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function eventDot(eventType: string) {
  if (eventType.includes("created") || eventType.includes("started")) return "bg-emerald-400";
  if (eventType.includes("failed") || eventType.includes("error"))    return "bg-red-400";
  if (eventType.includes("ended")  || eventType.includes("deleted"))  return "bg-zinc-500";
  return "bg-blue-400";
}

const PROVIDER_TYPE_ICON: Record<string, React.ElementType> = {
  asr:        AudioWaveform,
  llm:        Cpu,
  tts:        Radio,
  telephony:  Phone,
  orchestration: Server,
};

const PROVIDER_TYPE_LABEL: Record<string, string> = {
  asr: "ASR", llm: "LLM", tts: "TTS", telephony: "Telephony", orchestration: "Orch",
};

/* ── Live indicator ───────────────────────────────────────────────────────── */

function LiveIndicator({ isFetching }: { isFetching: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground/40">
      {isFetching && <RefreshCw className="w-3 h-3 animate-spin" />}
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
      </span>
      <span className="font-mono">Live</span>
      <span className="text-muted-foreground/25">·</span>
      <span className="font-mono">Refreshing every 10s</span>
    </div>
  );
}

/* ── Count-up numeric value (animates once on first mount, static thereafter) */

function useCountUp(target: number, active: boolean, durationMs = 700) {
  const [display, setDisplay] = useState(active ? 0 : target);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!active || hasAnimated.current) {
      setDisplay(target);
      return;
    }
    hasAnimated.current = true;
    const start = performance.now();
    const from = 0;
    let raf: number;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(from + (target - from) * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
      else setDisplay(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (hasAnimated.current) setDisplay(target);
  }, [target]);

  return display;
}

/* ── KPI Card ──────────────────────────────────────────────────────────────── */

function KpiCard({
  label, value, sub, icon: Icon, color, href, loading, countUp,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string; href?: string; loading?: boolean;
  countUp?: boolean;
}) {
  const [, navigate] = useLocation();
  const numericValue = typeof value === "number" ? value : null;
  const animated = useCountUp(numericValue ?? 0, !!countUp && numericValue != null && !loading);
  const displayValue = numericValue != null ? animated : value;

  return (
    <button
      onClick={() => href && navigate(href)}
      className={cn(
        "group flex h-[88px] flex-col justify-between gap-2 rounded-xl border border-border/60 bg-card px-4 py-3 text-left transition-all duration-[180ms] ease-out",
        href
          ? "cursor-pointer hover:-translate-y-0.5 hover:border-border hover:shadow-[0_4px_16px_-4px_rgba(0,0,0,0.35)]"
          : "cursor-default hover:border-border/60",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-semibold tracking-[0.09em] uppercase text-muted-foreground/45">{label}</span>
        <div className={cn("rounded-lg p-1 opacity-90 transition-colors", color.replace("text-", "bg-").replace("-400", "-500/10"))}>
          <Icon className={cn("w-3 h-3", color)} />
        </div>
      </div>
      {loading ? (
        <div className="h-8 w-24 rounded-md animate-pulse bg-muted" />
      ) : (
        <div className="flex items-baseline gap-2">
          <span className="text-[30px] font-bold tabular-nums leading-none text-foreground tracking-tight">{displayValue}</span>
          {sub && <span className="text-[10px] text-muted-foreground/45 leading-none">{sub}</span>}
        </div>
      )}
    </button>
  );
}

/* ── Latency badge ─────────────────────────────────────────────────────────── */

function LatencyBadge({ ms }: { ms: number | null | undefined }) {
  if (ms == null) return <span className="text-[11px] text-muted-foreground/30 font-mono">—</span>;
  const color = ms < 400 ? "text-emerald-400" : ms < 900 ? "text-amber-400" : "text-red-400";
  return <span className={cn("text-[11px] font-mono tabular-nums", color)}>{fmtMs(ms)}</span>;
}

function stageDotColor(ms: number | null | undefined) {
  if (ms == null) return "bg-zinc-700";
  return ms < 400 ? "bg-emerald-400" : ms < 900 ? "bg-amber-400" : "bg-red-400";
}

/* ── Provider group row ────────────────────────────────────────────────────── */

function ProviderRow({ providers }: { providers: ProviderConfig[] }) {
  const active = providers.filter(p => p.isActive);
  const Icon = PROVIDER_TYPE_ICON[providers[0].providerType] ?? Server;
  const label = PROVIDER_TYPE_LABEL[providers[0].providerType] ?? providers[0].providerType;
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border/40 last:border-0">
      <div className="flex items-center gap-2 w-20 shrink-0">
        <Icon className="w-3 h-3 text-muted-foreground/40" />
        <span className="text-[11px] font-semibold text-muted-foreground/60">{label}</span>
      </div>
      <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
        {providers.map(p => (
          <span
            key={p.id}
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded font-mono",
              p.isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-800 text-zinc-500 line-through",
            )}
          >
            {p.providerName}
          </span>
        ))}
      </div>
      <span className="text-[10px] text-muted-foreground/30 shrink-0">
        {active.length}/{providers.length}
      </span>
    </div>
  );
}

/* ── Agent health mini row ─────────────────────────────────────────────────── */

function AgentRow({ agent }: { agent: Agent }) {
  const [, navigate] = useLocation();
  return (
    <div
      className="flex items-center gap-2 py-2 border-b border-border/40 last:border-0 cursor-pointer hover:bg-accent/20 transition-colors px-1 -mx-1 rounded-md"
      onClick={() => navigate(`/app/agents/${agent.id}`)}
    >
      <span className={cn(
        "inline-block w-1.5 h-1.5 rounded-full shrink-0",
        agent.status === "active" ? "bg-emerald-400" : "bg-zinc-600",
      )} />
      <div className="flex flex-col min-w-0 flex-1 gap-0.5">
        <span className="text-[11px] text-foreground/75 truncate leading-tight">{agent.name}</span>
        {agent.updatedAt && (
          <span className="text-[10px] text-muted-foreground/30 leading-tight">
            Updated {relativeTime(agent.updatedAt)}
          </span>
        )}
      </div>
      <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0", statusColors(agent.status))}>
        {agent.status === "active" ? "Active" : "Draft"}
      </span>
    </div>
  );
}

/* ── Section heading ───────────────────────────────────────────────────────── */

function SectionHeading({
  icon: Icon, title, isFetching,
}: {
  icon: React.ElementType; title: string; isFetching?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
      <span className="text-[13px] font-semibold text-foreground/80 leading-tight">{title}</span>
      {isFetching && <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground/30 ml-1 shrink-0" />}
    </div>
  );
}

/* ── Sidebar card heading ──────────────────────────────────────────────────── */

function SidebarCardHeading({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
      <Icon className="w-3 h-3 text-muted-foreground/40 shrink-0" />
      <span className="text-[12px] font-semibold text-foreground/70">{title}</span>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────────── */

export default function CommandCenterPage() {
  const [, navigate] = useLocation();
  const stats = useGetDashboardStats({ query: { queryKey: getGetDashboardStatsQueryKey(), refetchInterval: 15_000, staleTime: 12_000 } });
  const callsQ = useListCalls(undefined, { query: { queryKey: getListCallsQueryKey(), refetchInterval: 10_000, staleTime: 8_000 } });
  const providers = useListProviders({ query: { queryKey: getListProvidersQueryKey(), refetchInterval: 30_000, staleTime: 25_000 } });
  const agents = useListAgents({ query: { queryKey: getListAgentsQueryKey(), refetchInterval: 30_000, staleTime: 25_000 } });
  const activity = useListActivityLogs({ limit: 25 }, { query: { queryKey: getListActivityLogsQueryKey({ limit: 25 }), refetchInterval: 15_000, staleTime: 12_000 } });

  const s = stats.data;
  const calls: Call[] = callsQ.data ?? [];
  const recentCalls = calls.slice(0, 25);
  const allProviders: ProviderConfig[] = providers.data ?? [];
  const allAgents: Agent[] = agents.data ?? [];
  const events: ActivityLog[] = activity.data ?? [];

  const isLoading = stats.isLoading;
  const isFetching = stats.isFetching || callsQ.isFetching;

  const showGettingStarted = !isLoading && !callsQ.isLoading && !agents.isLoading
    && allAgents.length === 0 && calls.length === 0;

  /* provider groups */
  const providerGroups = allProviders.reduce<Record<string, ProviderConfig[]>>((acc, p) => {
    acc[p.providerType] = [...(acc[p.providerType] ?? []), p];
    return acc;
  }, {});
  const groupOrder = ["asr", "llm", "tts", "telephony", "orchestration"];

  /* latency averages across recent calls */
  const callsWithLatency = recentCalls.filter(c => c.sttLatencyMs || c.llmLatencyMs || c.ttsFirstChunkMs);
  const avg = (fn: (c: Call) => number | null | undefined) => {
    const vals = callsWithLatency.map(fn).filter((v): v is number => v != null);
    if (!vals.length) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  };
  const avgStt = avg(c => c.sttLatencyMs);
  const avgLlm = avg(c => c.llmLatencyMs);
  const avgTts = avg(c => c.ttsFirstChunkMs);

  return (
    <div className="flex flex-col gap-6 px-6 py-4 min-h-full">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-muted-foreground/50" />
          <div>
            <h1 className="text-[15px] font-semibold text-foreground leading-tight">Command Center</h1>
            <p className="text-[11px] text-muted-foreground/40 leading-tight mt-1">Live overview of your voice platform.</p>
          </div>
        </div>
        <LiveIndicator isFetching={isFetching} />
      </div>

      {/* ── KPI Row ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard label="Active Agents"   value={s?.activeAgents ?? 0} sub={`/ ${s?.totalAgents ?? 0}`}   icon={Bot}      color="text-emerald-400" href="/app/agents"    loading={isLoading} countUp />
        <KpiCard label="Calls Today"     value={s?.callsToday ?? 0}                                        icon={Activity} color="text-blue-400"    href="/app/calls"    loading={isLoading} countUp />
        <KpiCard label="Success Rate"    value={s ? `${s.successRate.toFixed(1)}%` : "—"}                  icon={CheckCircle2} color="text-green-400"                    loading={isLoading} />
        <KpiCard label="Avg STT Latency" value={avgStt != null ? fmtMs(avgStt) : "—"}                      icon={Zap}      color="text-amber-400"                        loading={callsQ.isLoading} />
        <KpiCard label="Providers"       value={allProviders.filter(p => p.isActive).length} sub="active"  icon={Key}      color="text-violet-400" href="/app/providers" loading={providers.isLoading} countUp />
      </div>

      {/* ── Latency strip ───────────────────────────────────────────────────── */}
      {(avgStt != null || avgLlm != null || avgTts != null) && (
        <div className="flex items-center gap-4 px-4 py-2 rounded-xl border border-border/60 bg-muted/20 text-[11px]">
          <span className="text-muted-foreground/40 font-semibold uppercase tracking-wide text-[10px]">
            Voice Pipeline Health <span className="text-muted-foreground/25 normal-case font-normal tracking-normal">· last {callsWithLatency.length} calls</span>
          </span>
          <div className="flex items-center gap-1.5">
            <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", stageDotColor(avgStt))} />
            <AudioWaveform className="w-3 h-3 text-muted-foreground/30" />
            <span className="text-muted-foreground/50">STT</span>
            <LatencyBadge ms={avgStt} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", stageDotColor(avgLlm))} />
            <Cpu className="w-3 h-3 text-muted-foreground/30" />
            <span className="text-muted-foreground/50">LLM TTFT</span>
            <LatencyBadge ms={avgLlm} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", stageDotColor(avgTts))} />
            <Radio className="w-3 h-3 text-muted-foreground/30" />
            <span className="text-muted-foreground/50">TTS First Chunk</span>
            <LatencyBadge ms={avgTts} />
          </div>
        </div>
      )}

      {/* ── Two-column body ──────────────────────────────────────────────────── */}
      <div className="flex gap-6 min-h-0">

        {/* ── Left column: Calls + Activity ─────────────────────────────────── */}
        <div className="flex flex-col gap-6 flex-1 min-w-0">

          {/* Recent Calls */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <SectionHeading
                icon={Activity}
                title="Recent Calls"
                isFetching={callsQ.isFetching}
              />
              <button
                onClick={() => navigate("/app/calls")}
                className="flex items-center gap-1 text-[11px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors duration-[180ms]"
              >
                <span>View All</span>
                <ArrowUpRight className="w-3 h-3" />
              </button>
            </div>

            <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
              {/* table header */}
              <div className="grid grid-cols-[1fr_120px_76px_64px_84px_72px] border-b border-border/60 bg-muted/30 px-4 py-3">
                {["Agent", "Phone", "Direction", "Duration", "Status", "Time"].map(h => (
                  <span key={h} className="text-[10px] font-semibold tracking-[0.07em] uppercase text-muted-foreground/35 truncate">
                    {h}
                  </span>
                ))}
              </div>

              {/* rows */}
              <div className="divide-y divide-border/40 max-h-[440px] overflow-y-auto">
                {callsQ.isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="grid grid-cols-[1fr_120px_76px_64px_84px_72px] px-4 py-3 gap-0">
                      {Array.from({ length: 6 }).map((_, j) => (
                        <div key={j} className="h-3 rounded animate-pulse bg-muted w-4/5 self-center" />
                      ))}
                    </div>
                  ))
                ) : recentCalls.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-14 gap-3 text-center">
                    <Phone className="w-7 h-7 text-muted-foreground/20" />
                    <div className="flex flex-col gap-1">
                      <p className="text-[12px] font-medium text-foreground/40">No calls yet. Create an agent and make your first call.</p>
                    </div>
                    <button
                      onClick={() => navigate("/app/agents?create=1")}
                      className="mt-1 text-[11px] font-medium text-muted-foreground/60 hover:text-foreground transition-all duration-[180ms] border border-border/50 rounded-lg px-3 py-1.5 hover:bg-accent/40"
                    >
                      Create Agent
                    </button>
                  </div>
                ) : (
                  recentCalls.map(call => {
                    const dir = (call as any).direction as string | undefined;
                    const phone = fmtPhone(call.fromNumber, call.toNumber, dir);
                    return (
                      <div
                        key={call.id}
                        className="grid grid-cols-[1fr_120px_76px_64px_84px_72px] px-4 py-3 hover:bg-accent/25 hover:-translate-y-px transition-all duration-[180ms] ease-out cursor-pointer"
                        onClick={() => navigate(`/app/calls/${call.id}`)}
                      >
                        {/* Agent */}
                        <p className="text-[11px] text-foreground/70 truncate pr-2 self-center">{call.agentName ?? "—"}</p>
                        {/* Phone */}
                        <p className="text-[10px] font-mono text-muted-foreground/50 truncate pr-2 self-center">{phone}</p>
                        {/* Direction */}
                        <div className="self-center pr-1">
                          {dir ? (
                            <span className={cn(
                              "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                              dir === "inbound"
                                ? "bg-blue-500/10 text-blue-400 ring-1 ring-inset ring-blue-500/20"
                                : "bg-violet-500/10 text-violet-400 ring-1 ring-inset ring-violet-500/20",
                            )}>
                              {dir === "inbound"
                                ? <ArrowDownLeft className="w-2.5 h-2.5" />
                                : <ArrowUpRight className="w-2.5 h-2.5" />}
                              {dir === "inbound" ? "In" : "Out"}
                            </span>
                          ) : <span className="text-[10px] text-muted-foreground/30">—</span>}
                        </div>
                        {/* Duration */}
                        <p className="text-[10px] font-mono text-muted-foreground/50 self-center">{fmtDuration(call.durationSeconds)}</p>
                        {/* Status */}
                        <div className="self-center">
                          <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", statusColors(call.status))}>
                            {statusLabel(call.status)}
                          </span>
                        </div>
                        {/* Time */}
                        <p className="text-[10px] font-mono text-muted-foreground/35 self-center truncate">
                          {relativeTime(call.createdAt)}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <SectionHeading
                icon={Activity}
                title="Recent Activity"
                isFetching={activity.isFetching}
              />
              <button
                onClick={() => navigate("/app/calls")}
                className="flex items-center gap-1 text-[11px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors duration-[180ms]"
              >
                <span>View All</span>
                <ArrowUpRight className="w-3 h-3" />
              </button>
            </div>
            <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
              <div className="divide-y divide-border/40 max-h-[240px] overflow-y-auto">
                {activity.isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3">
                      <div className="h-3 w-12 rounded animate-pulse bg-muted shrink-0" />
                      <div className="h-3 rounded animate-pulse bg-muted flex-1" />
                    </div>
                  ))
                ) : events.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
                    <Activity className="w-6 h-6 text-muted-foreground/20" />
                    <p className="text-[12px] font-medium text-foreground/40">No activity yet. Activity appears once your agents start running.</p>
                    <button
                      onClick={() => window.open("/docs", "_blank")}
                      className="text-[11px] font-medium text-muted-foreground/60 hover:text-foreground transition-all duration-[180ms] border border-border/50 rounded-lg px-3 py-1.5 hover:bg-accent/40"
                    >
                      Read the docs
                    </button>
                  </div>
                ) : (
                  events.map(ev => (
                    <div key={ev.id} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/25 hover:-translate-y-px transition-all duration-[180ms] ease-out">
                      <span className="text-[10px] font-mono tabular-nums text-muted-foreground/35 shrink-0 w-16">
                        {shortTime(ev.createdAt)}
                      </span>
                      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", eventDot(ev.eventType))} />
                      <p className="text-[11px] text-foreground/60 flex-1 truncate">{ev.description}</p>
                      <span className="text-[10px] font-mono text-muted-foreground/30 shrink-0 ml-auto">
                        {ev.eventType}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Right sidebar ─────────────────────────────────────────────────── */}
        <div className="w-[280px] shrink-0 flex flex-col gap-6">

          {/* Next Steps */}
          <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
            <SidebarCardHeading icon={Rocket} title="Next Steps" />
            <div className="p-3 flex flex-col gap-2">
              {[
                { label: "Create Agent",      desc: "Build and configure a new voice agent",    icon: Bot,      href: "/app/agents?create=1" },
                { label: "Connect Provider",  desc: "Add your ASR, LLM, or TTS keys",           icon: Key,      href: "/app/providers" },
                { label: "Buy Phone Number",  desc: "Get a number to receive or place calls",    icon: Phone,    href: "/app/phone-numbers" },
                { label: "Create Campaign",   desc: "Launch an outbound call campaign",          icon: Activity, href: "/app/campaigns" },
              ].map(({ label, desc, icon: Icon, href }) => (
                <button
                  key={href}
                  onClick={() => navigate(href)}
                  className="flex items-start gap-3 px-3 py-2.5 rounded-lg text-left w-full border border-border/40 bg-card hover:bg-accent/30 hover:-translate-y-0.5 hover:shadow-sm hover:border-border/70 transition-all duration-[180ms] ease-out group"
                >
                  <div className="mt-0.5 rounded-md p-1.5 bg-muted/60 shrink-0 group-hover:bg-accent/60 transition-colors duration-[180ms]">
                    <Icon className="w-3 h-3 text-muted-foreground/60 group-hover:text-foreground/60 transition-colors duration-[180ms]" />
                  </div>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[12px] font-medium text-foreground/75 leading-tight group-hover:text-foreground/90 transition-colors duration-[180ms]">{label}</span>
                    <span className="text-[10px] text-muted-foreground/40 leading-snug">{desc}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Provider Health */}
          <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
            <SidebarCardHeading icon={Server} title="Provider Health" />
            <div className="px-4 py-2">
              {providers.isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-4 rounded animate-pulse bg-muted my-2" />
                ))
              ) : allProviders.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <AlertTriangle className="w-5 h-5 text-muted-foreground/20" />
                  <div className="flex flex-col gap-1">
                    <p className="text-[12px] font-medium text-foreground/40">No providers configured.</p>
                    <p className="text-[11px] text-muted-foreground/30">Add your first provider to get started.</p>
                  </div>
                  <button
                    onClick={() => navigate("/app/providers")}
                    className="text-[11px] font-medium text-muted-foreground/60 hover:text-foreground transition-all duration-[180ms] border border-border/50 rounded-lg px-3 py-1.5 hover:bg-accent/40"
                  >
                    Add Provider
                  </button>
                </div>
              ) : (
                groupOrder
                  .filter(g => providerGroups[g])
                  .map(g => <ProviderRow key={g} providers={providerGroups[g]!} />)
              )}
              {allProviders.length > 0 && (
                <div className="flex justify-between items-center mt-2 pt-2 border-t border-border/30">
                  <span className="text-[10px] text-muted-foreground/30">
                    {allProviders.filter(p => p.isActive).length} active · {allProviders.filter(p => !p.isActive).length} inactive
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Active Agents */}
          <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
            <SidebarCardHeading icon={Bot} title="Active Agents" />
            <div className="px-4 py-2">
              {agents.isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-4 rounded animate-pulse bg-muted my-2" />
                ))
              ) : allAgents.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <Inbox className="w-5 h-5 text-muted-foreground/20" />
                  <div className="flex flex-col gap-1">
                    <p className="text-[12px] font-medium text-foreground/40">No agents yet.</p>
                    <p className="text-[11px] text-muted-foreground/30">Build your first voice agent in minutes.</p>
                  </div>
                  <button
                    onClick={() => navigate("/app/agents?create=1")}
                    className="text-[11px] font-medium text-muted-foreground/60 hover:text-foreground transition-all duration-[180ms] border border-border/50 rounded-lg px-3 py-1.5 hover:bg-accent/40"
                  >
                    Create Agent
                  </button>
                </div>
              ) : (
                <>
                  {allAgents.slice(0, 6).map(a => <AgentRow key={a.id} agent={a} />)}
                  {allAgents.length > 6 && (
                    <button
                      onClick={() => navigate("/app/agents")}
                      className="w-full text-[10px] text-muted-foreground/35 hover:text-muted-foreground/60 transition-colors py-1.5 text-center"
                    >
                      +{allAgents.length - 6} more agents →
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* ── Getting Started strip ────────────────────────────────────────────── */}
      {showGettingStarted && (
        <div className="rounded-xl border border-border/60 bg-card px-4 py-4 flex items-center gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <Rocket className="w-4 h-4 text-muted-foreground/40" />
            <div>
              <p className="text-[12px] font-semibold text-foreground/70 leading-tight">Get started in 3 steps</p>
              <p className="text-[10px] text-muted-foreground/35 leading-tight mt-1">Set up your first voice agent</p>
            </div>
          </div>
          <div className="h-px flex-1 bg-border/40" />
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => navigate("/app/agents?create=1")}
              className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/60 hover:text-foreground transition-colors border border-border/50 rounded-lg px-3 py-1.5 hover:bg-accent/40"
            >
              <span className="text-muted-foreground/35">1.</span> Create an agent
            </button>
            <button
              onClick={() => navigate("/app/providers")}
              className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/60 hover:text-foreground transition-colors border border-border/50 rounded-lg px-3 py-1.5 hover:bg-accent/40"
            >
              <span className="text-muted-foreground/35">2.</span> Add a provider
            </button>
            <button
              onClick={() => navigate("/app/test-simulator")}
              className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/60 hover:text-foreground transition-colors border border-border/50 rounded-lg px-3 py-1.5 hover:bg-accent/40"
            >
              <span className="text-muted-foreground/35">3.</span> Make a test call
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
