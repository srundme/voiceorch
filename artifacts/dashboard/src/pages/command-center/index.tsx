import { useLocation } from "wouter";
import { useEffect, useRef, useState } from "react";
import {
  Terminal, RefreshCw, Activity, Zap, CheckCircle2, XCircle,
  Clock, AlertTriangle, Server, Key, Layers, Bot,
  Cpu, Radio, AudioWaveform, Phone, BarChart3, Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getExecutionId } from "@/lib/execution-id";
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
        "group flex h-[104px] flex-col justify-between gap-3 rounded-xl border border-border/60 bg-card px-4 py-3.5 text-left transition-all duration-[180ms] ease-out",
        href
          ? "cursor-pointer hover:-translate-y-0.5 hover:border-border hover:shadow-[0_4px_16px_-4px_rgba(0,0,0,0.35)]"
          : "cursor-default hover:border-border/60",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold tracking-[0.09em] uppercase text-muted-foreground/45">{label}</span>
        <div className={cn("rounded-lg p-1.5 opacity-90 transition-colors", color.replace("text-", "bg-").replace("-400", "-500/10"))}>
          <Icon className={cn("w-3.5 h-3.5", color)} />
        </div>
      </div>
      {loading ? (
        <div className="h-8 w-24 rounded-md animate-pulse bg-muted" />
      ) : (
        <div className="flex items-baseline gap-2">
          <span className="text-[28px] font-bold tabular-nums leading-none text-foreground tracking-tight">{displayValue}</span>
          {sub && <span className="text-[11px] text-muted-foreground/45 leading-none">{sub}</span>}
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
    <div className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0">
      <div className="flex items-center gap-1.5 w-20 shrink-0">
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
      className="flex items-center gap-2.5 py-2 border-b border-border/40 last:border-0 cursor-pointer hover:bg-accent/20 transition-colors px-1 -mx-1 rounded-md"
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
    <div className="flex flex-col gap-5 p-6 min-h-full">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Terminal className="w-4 h-4 text-muted-foreground/50" />
          <div>
            <h1 className="text-[15px] font-semibold text-foreground leading-tight">Command Center</h1>
            <p className="text-[11px] text-muted-foreground/40 leading-tight mt-0.5">Developer operations console</p>
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
        <div className="flex items-center gap-7 px-4 py-3 rounded-xl border border-border/60 bg-muted/20 text-[11px]">
          <span className="text-muted-foreground/40 font-semibold uppercase tracking-wide text-[10px]">
            Pipeline P50 <span className="text-muted-foreground/25 normal-case font-normal tracking-normal">· last {callsWithLatency.length} calls</span>
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

      {/* ── Main body ───────────────────────────────────────────────────────── */}
      <div className="flex gap-5 min-h-0">

        {/* ── Calls feed ──────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-muted-foreground/40" />
              <span className="text-[12px] font-semibold text-foreground/80">Recent Calls</span>
              {callsQ.isFetching && <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground/30" />}
            </div>
            <button
              onClick={() => {}}
              className="flex items-center gap-1 text-[11px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
            >
              <BarChart3 className="w-3 h-3" />
              <span>{recentCalls.length} calls</span>
            </button>
          </div>

          <div className="rounded-xl border border-border/60 overflow-hidden">
            {/* header */}
            <div className="grid grid-cols-[140px_1fr_84px_64px_64px_64px_56px_64px] gap-0 border-b border-border/60 bg-muted/30 px-4 py-2.5">
              {["Exec ID", "Agent", "Status", "STT", "LLM", "TTS", "Dur", "Cost"].map(h => (
                <span key={h} className="text-[10px] font-semibold tracking-[0.07em] uppercase text-muted-foreground/35 truncate">
                  {h}
                </span>
              ))}
            </div>
            {/* rows */}
            <div className="divide-y divide-border/40 max-h-[460px] overflow-y-auto">
              {callsQ.isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="grid grid-cols-[140px_1fr_84px_64px_64px_64px_56px_64px] gap-0 px-4 py-3">
                    {Array.from({ length: 8 }).map((_, j) => (
                      <div key={j} className="h-3 rounded animate-pulse bg-muted w-4/5" />
                    ))}
                  </div>
                ))
              ) : recentCalls.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground/30">
                  <Terminal className="w-7 h-7 opacity-30" />
                  <p className="text-[12px]">No calls yet</p>
                </div>
              ) : (
                recentCalls.map(call => (
                  <div
                    key={call.id}
                    className="grid grid-cols-[140px_1fr_84px_64px_64px_64px_56px_64px] gap-0 px-4 py-3 hover:bg-accent/25 transition-colors duration-150 cursor-pointer"
                    onClick={() => navigate(`/app/calls/${call.id}`)}
                  >
                    {/* Exec ID */}
                    <p className="text-[10px] font-mono text-muted-foreground/50 truncate pr-2 self-center">
                      {getExecutionId(call)}
                    </p>
                    {/* Agent */}
                    <p className="text-[11px] text-foreground/70 truncate pr-2 self-center">{call.agentName}</p>
                    {/* Status */}
                    <div className="self-center pr-1">
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", statusColors(call.status))}>
                        {statusLabel(call.status)}
                      </span>
                    </div>
                    {/* STT */}
                    <div className="self-center"><LatencyBadge ms={call.sttLatencyMs} /></div>
                    {/* LLM */}
                    <div className="self-center"><LatencyBadge ms={call.llmLatencyMs} /></div>
                    {/* TTS */}
                    <div className="self-center"><LatencyBadge ms={call.ttsFirstChunkMs} /></div>
                    {/* Duration */}
                    <p className="text-[11px] text-muted-foreground/50 self-center font-mono">
                      {fmtDuration(call.durationSeconds)}
                    </p>
                    {/* Cost */}
                    <p className="text-[11px] text-muted-foreground/40 self-center font-mono">
                      {call.costCents != null ? `$${(call.costCents / 100).toFixed(3)}` : "—"}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ── System Event Log ──────────────────────────────────────────── */}
          <div className="flex flex-col gap-3 mt-1">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-muted-foreground/40" />
              <span className="text-[12px] font-semibold text-foreground/80">System Event Log</span>
              {activity.isFetching && <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground/30" />}
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
                  <div className="flex items-center justify-center py-8 text-muted-foreground/30 text-[12px]">
                    No events yet
                  </div>
                ) : (
                  events.map(ev => (
                    <div key={ev.id} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/20 transition-colors duration-150">
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

        {/* ── Right panel ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 w-64 shrink-0">

          {/* Provider Health */}
          <div className="rounded-xl border border-border/60 bg-card p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2 mb-1">
              <Layers className="w-3.5 h-3.5 text-muted-foreground/40" />
              <span className="text-[12px] font-semibold text-foreground/80">Provider Health</span>
            </div>
            {providers.isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-4 rounded animate-pulse bg-muted" />
              ))
            ) : allProviders.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 py-6 text-center">
                <AlertTriangle className="w-5 h-5 text-muted-foreground/25 mb-1" />
                <p className="text-[12px] font-medium text-foreground/60">No providers connected yet.</p>
                <p className="text-[11px] text-muted-foreground/35 leading-snug">
                  Connect an ASR, LLM, or TTS provider in Settings to get started.
                </p>
              </div>
            ) : (
              groupOrder
                .filter(t => providerGroups[t]?.length)
                .map(t => <ProviderRow key={t} providers={providerGroups[t]} />)
            )}
            {!providers.isLoading && allProviders.length > 0 && (
              <div className="flex items-center justify-between mt-1 pt-2 border-t border-border/40">
                <span className="text-[10px] text-muted-foreground/30">
                  {allProviders.filter(p => p.isActive).length} active · {allProviders.filter(p => !p.isActive).length} inactive
                </span>
              </div>
            )}
          </div>

          {/* Agent Status */}
          <div className="rounded-xl border border-border/60 bg-card p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Bot className="w-3.5 h-3.5 text-muted-foreground/40" />
                <span className="text-[12px] font-semibold text-foreground/80">Agents</span>
              </div>
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-emerald-400 font-semibold">{allAgents.filter(a => a.status === "active").length} active</span>
                <span className="text-muted-foreground/30">·</span>
                <span className="text-zinc-500">{allAgents.filter(a => a.status !== "active").length} off</span>
              </div>
            </div>
            <div className="max-h-[240px] overflow-y-auto -mx-1 px-1">
              {agents.isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-4 rounded animate-pulse bg-muted my-1.5" />
                ))
              ) : allAgents.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 py-6 text-center">
                  <Inbox className="w-5 h-5 text-muted-foreground/25 mb-1" />
                  <p className="text-[12px] font-medium text-foreground/60">No agents yet</p>
                </div>
              ) : (
                allAgents.map(a => <AgentRow key={a.id} agent={a} />)
              )}
            </div>
          </div>

          {/* Error Calls */}
          {calls.filter(c => c.status === "failed").length > 0 && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2 mb-1">
                <XCircle className="w-3.5 h-3.5 text-red-400" />
                <span className="text-[12px] font-semibold text-red-400/80">Failed Calls</span>
                <span className="ml-auto text-[11px] font-semibold tabular-nums text-red-400">
                  {calls.filter(c => c.status === "failed").length}
                </span>
              </div>
              {calls
                .filter(c => c.status === "failed")
                .slice(0, 4)
                .map(c => (
                  <div key={c.id} className="flex flex-col gap-0.5 py-1.5 border-b border-red-500/10 last:border-0">
                    <p className="text-[10px] font-mono text-muted-foreground/40 truncate">
                      {getExecutionId(c)}
                    </p>
                    <p className="text-[11px] text-foreground/60 truncate">{c.agentName}</p>
                    {c.errorMessage && (
                      <p className="text-[10px] text-red-400/70 truncate">{c.errorMessage}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground/30">{relativeTime(c.createdAt)}</p>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
