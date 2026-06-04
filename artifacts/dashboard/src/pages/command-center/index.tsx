import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Monitor, Phone, PhoneCall, PhoneIncoming, CalendarDays,
  ArrowRightLeft, AlertTriangle, XCircle, CheckCircle2, ThumbsUp,
  TrendingUp, RefreshCw, Activity,
  Clock, Layers, User,
} from "lucide-react";
import { cn } from "@/lib/utils";
/* ── API fetch helpers ───────────────────────────────────────────────────── */

async function fetchKpis() {
  const r = await fetch("/api/command-center/kpis", {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });
  if (!r.ok) throw new Error("Failed to fetch KPIs");
  return r.json() as Promise<{
    liveCalls: number; queued: number; callbacksDue: number;
    incomingCalls: number; bookingsToday: number; transfersToday: number;
    noPickup: number; failed: number; connected: number; interested: number;
  }>;
}

async function fetchLiveOps(limit = 50) {
  const r = await fetch(`/api/command-center/live-ops?limit=${limit}`, {
    credentials: "include",
  });
  if (!r.ok) throw new Error("Failed to fetch live ops");
  const data = await r.json() as { rows: LiveOpsRow[] };
  return data.rows;
}

async function fetchActivityStream(limit = 30) {
  const r = await fetch(`/api/command-center/activity-stream?limit=${limit}`, {
    credentials: "include",
  });
  if (!r.ok) throw new Error("Failed to fetch activity stream");
  const data = await r.json() as { events: ActivityEvent[] };
  return data.events;
}

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface LiveOpsRow {
  leadId: number;
  phone: string;
  name: string | null;
  campaignId: number;
  campaignName: string;
  batchId: number | null;
  batchName: string | null;
  callStatus: string;
  disposition: string | null;
  operationalOutcome: string;
  durationSeconds: number | null;
  lastActivityAt: string | null;
  createdAt: string;
}

interface ActivityEvent {
  id: number;
  type: string;
  resourceType: string | null;
  resourceId: string | null;
  description: string;
  createdAt: string;
}

/* ── Status + outcome display helpers ─────────────────────────────────────── */

const CALL_STATUS_LABELS: Record<string, string> = {
  pending:     "Queued",
  calling:     "Calling",
  connected:   "Connected",
  completed:   "Completed",
  transferred: "Transferred",
  failed:      "Failed",
  skipped:     "Skipped",
  exhausted:   "Exhausted",
};

const OUTCOME_LABELS: Record<string, string> = {
  pending:              "—",
  booking_created:      "Booked",
  transfer_completed:   "Transferred",
  callback_requested:   "Callback",
  interest_confirmed:   "Interested",
  no_contact:           "No Pickup",
  dnc_blocked:          "DNC",
  failed:               "Failed",
};

function callStatusBadge(status: string) {
  const map: Record<string, string> = {
    pending:     "bg-zinc-800 text-zinc-400",
    calling:     "bg-blue-500/20 text-blue-400 animate-pulse",
    connected:   "bg-emerald-500/20 text-emerald-400",
    completed:   "bg-zinc-700 text-zinc-300",
    transferred: "bg-purple-500/20 text-purple-400",
    failed:      "bg-red-500/20 text-red-400",
    skipped:     "bg-amber-500/20 text-amber-400",
    exhausted:   "bg-red-800/30 text-red-400",
  };
  return map[status] ?? "bg-zinc-800 text-zinc-400";
}

function outcomeBadge(outcome: string) {
  const map: Record<string, string> = {
    pending:            "text-zinc-500",
    booking_created:    "text-emerald-400",
    transfer_completed: "text-purple-400",
    callback_requested: "text-amber-400",
    interest_confirmed: "text-blue-400",
    no_contact:         "text-zinc-500",
    dnc_blocked:        "text-red-500",
    failed:             "text-red-400",
  };
  return map[outcome] ?? "text-zinc-500";
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/* ── KPI Card ──────────────────────────────────────────────────────────────── */

interface KpiCardProps {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  href?: string;
  pulse?: boolean;
  loading?: boolean;
}

function KpiCard({ label, value, icon: Icon, color, href, pulse, loading }: KpiCardProps) {
  const [, navigate] = useLocation();

  return (
    <button
      onClick={() => href && navigate(href)}
      className={cn(
        "group relative flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left transition-all duration-150",
        href ? "cursor-pointer hover:border-border/80 hover:bg-accent/30" : "cursor-default",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-muted-foreground/60">
          {label}
        </span>
        <div className={cn("rounded-md p-1.5", color.replace("text-", "bg-").replace("-400", "-500/15"))}>
          <Icon className={cn("w-3.5 h-3.5", color)} />
        </div>
      </div>

      {loading ? (
        <div className="h-8 w-16 rounded animate-pulse bg-muted" />
      ) : (
        <div className={cn("text-[28px] font-bold tabular-nums leading-none", pulse && value > 0 ? color : "text-foreground")}>
          {value.toLocaleString()}
        </div>
      )}

      {pulse && value > 0 && (
        <span className={cn("absolute top-3 right-3 flex h-1.5 w-1.5")}>
          <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-60", color.replace("text-", "bg-"))} />
          <span className={cn("relative inline-flex rounded-full h-1.5 w-1.5", color.replace("text-", "bg-"))} />
        </span>
      )}
    </button>
  );
}

/* ── Queue Health mini bar ─────────────────────────────────────────────────── */

interface QueueBarProps {
  label: string;
  value: number;
  total: number;
  color: string;
}

function QueueBar({ label, value, total, color }: QueueBarProps) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground/70">{label}</span>
        <span className="tabular-nums font-medium text-foreground/80">{value.toLocaleString()}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ── Main page ─────────────────────────────────────────────────────────────── */

export default function CommandCenterPage() {
  const kpis = useQuery({
    queryKey: ["command-center-kpis"],
    queryFn: fetchKpis,
    refetchInterval: 10_000,
    staleTime: 8_000,
  });

  const liveOps = useQuery({
    queryKey: ["command-center-live-ops"],
    queryFn: () => fetchLiveOps(50),
    refetchInterval: 10_000,
    staleTime: 8_000,
  });

  const activityStream = useQuery({
    queryKey: ["command-center-activity-stream"],
    queryFn: () => fetchActivityStream(30),
    refetchInterval: 15_000,
    staleTime: 12_000,
  });

  const k = kpis.data;
  const rows = liveOps.data ?? [];
  const events = activityStream.data ?? [];

  // Queue health totals for the right panel
  const queueTotal = rows.length;
  const queueCalling  = rows.filter(r => r.callStatus === "calling").length;
  const queuePending  = rows.filter(r => r.callStatus === "pending").length;
  const queueComplete = rows.filter(r => r.callStatus === "completed" || r.callStatus === "transferred").length;
  const queueFailed   = rows.filter(r => r.callStatus === "failed" || r.callStatus === "skipped").length;

  const isLoading = kpis.isLoading;
  const lastUpdated = kpis.dataUpdatedAt ? new Date(kpis.dataUpdatedAt) : null;

  return (
    <div className="flex flex-col gap-6 p-6 min-h-full">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Monitor className="w-5 h-5 text-muted-foreground/50" />
          <div>
            <h1 className="text-[15px] font-semibold text-foreground leading-tight">Command Center</h1>
            <p className="text-[11px] text-muted-foreground/50 leading-tight mt-0.5">Live operational dashboard</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/40">
          {(kpis.isFetching || liveOps.isFetching) && (
            <RefreshCw className="w-3 h-3 animate-spin" />
          )}
          {lastUpdated && (
            <span>Updated {relativeTime(lastUpdated.toISOString())}</span>
          )}
        </div>
      </div>

      {/* ── KPI Cards (10) ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard label="Live Calls"       value={k?.liveCalls      ?? 0} icon={Phone}         color="text-blue-400"   href="/app/calls"     pulse   loading={isLoading} />
        <KpiCard label="Queued"           value={k?.queued         ?? 0} icon={Layers}         color="text-zinc-400"   href="/app/campaigns"         loading={isLoading} />
        <KpiCard label="Callbacks Due"    value={k?.callbacksDue   ?? 0} icon={PhoneCall}      color="text-amber-400"  href="/app/callbacks"  pulse  loading={isLoading} />
        <KpiCard label="Incoming Calls"   value={k?.incomingCalls  ?? 0} icon={PhoneIncoming}  color="text-purple-400" href="/app/incoming"           loading={isLoading} />
        <KpiCard label="Bookings Today"   value={k?.bookingsToday  ?? 0} icon={CalendarDays}   color="text-emerald-400" href="/app/scheduling"        loading={isLoading} />
        <KpiCard label="Transfers Today"  value={k?.transfersToday ?? 0} icon={ArrowRightLeft} color="text-violet-400" href="/app/transfers"          loading={isLoading} />
        <KpiCard label="No Pickup"        value={k?.noPickup       ?? 0} icon={AlertTriangle}  color="text-amber-500"  href="/app/campaigns"         loading={isLoading} />
        <KpiCard label="Failed"           value={k?.failed         ?? 0} icon={XCircle}        color="text-red-400"    href="/app/campaigns"         loading={isLoading} />
        <KpiCard label="Connected"        value={k?.connected      ?? 0} icon={CheckCircle2}   color="text-emerald-400" href="/app/campaigns"        loading={isLoading} />
        <KpiCard label="Interested"       value={k?.interested     ?? 0} icon={ThumbsUp}       color="text-blue-400"   href="/app/campaigns"         loading={isLoading} />
      </div>

      {/* ── Main body: Feed + Right Panel ──────────────────────────────────── */}
      <div className="flex gap-5 min-h-0">

        {/* ── Live Ops Feed ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-muted-foreground/40" />
              <span className="text-[12px] font-semibold text-foreground/80">Live Operations Feed</span>
              {liveOps.isFetching && <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground/30" />}
            </div>
            <span className="text-[11px] text-muted-foreground/40">{rows.length} leads · auto-refresh 10s</span>
          </div>

          <div className="rounded-xl border border-border overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_1.2fr_1fr_80px_100px_100px_70px_90px] gap-0 border-b border-border bg-muted/30 px-3 py-2">
              {["Lead", "Campaign", "Batch", "Status", "Disposition", "Outcome", "Duration", "Last Activity"].map(h => (
                <span key={h} className="text-[10px] font-semibold tracking-[0.08em] uppercase text-muted-foreground/40 truncate">
                  {h}
                </span>
              ))}
            </div>

            {/* Table rows */}
            <div className="divide-y divide-border/50 max-h-[400px] overflow-y-auto">
              {liveOps.isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1.2fr_1fr_80px_100px_100px_70px_90px] gap-0 px-3 py-2.5">
                    {Array.from({ length: 8 }).map((_, j) => (
                      <div key={j} className="h-3 rounded animate-pulse bg-muted w-4/5" />
                    ))}
                  </div>
                ))
              ) : rows.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground/40">
                  <Monitor className="w-8 h-8 opacity-30" />
                  <p className="text-[12px]">No leads in the system yet</p>
                </div>
              ) : (
                rows.map(row => (
                  <div
                    key={row.leadId}
                    className="grid grid-cols-[1fr_1.2fr_1fr_80px_100px_100px_70px_90px] gap-0 px-3 py-2.5 hover:bg-accent/30 transition-colors cursor-default"
                  >
                    {/* Lead */}
                    <div className="flex items-center gap-1.5 min-w-0 pr-2">
                      <User className="w-3 h-3 shrink-0 text-muted-foreground/30" />
                      <div className="min-w-0">
                        {row.name && <p className="text-[11px] font-medium text-foreground/80 truncate leading-tight">{row.name}</p>}
                        <p className="text-[10px] text-muted-foreground/50 truncate leading-tight font-mono">{row.phone}</p>
                      </div>
                    </div>

                    {/* Campaign */}
                    <p className="text-[11px] text-muted-foreground/70 truncate pr-2 self-center">{row.campaignName}</p>

                    {/* Batch */}
                    <p className="text-[11px] text-muted-foreground/50 truncate pr-2 self-center">{row.batchName ?? "—"}</p>

                    {/* Status */}
                    <div className="self-center pr-1">
                      <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-md", callStatusBadge(row.callStatus))}>
                        {CALL_STATUS_LABELS[row.callStatus] ?? row.callStatus}
                      </span>
                    </div>

                    {/* Disposition */}
                    <p className="text-[11px] text-muted-foreground/50 truncate pr-2 self-center">
                      {row.disposition ?? "—"}
                    </p>

                    {/* Outcome */}
                    <p className={cn("text-[11px] font-medium truncate pr-2 self-center", outcomeBadge(row.operationalOutcome))}>
                      {OUTCOME_LABELS[row.operationalOutcome] ?? row.operationalOutcome}
                    </p>

                    {/* Duration */}
                    <p className="text-[11px] text-muted-foreground/50 self-center font-mono">
                      {row.durationSeconds != null ? `${row.durationSeconds}s` : "—"}
                    </p>

                    {/* Last Activity */}
                    <p className="text-[11px] text-muted-foreground/40 self-center truncate">
                      {relativeTime(row.lastActivityAt)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ── System Activity Stream ──────────────────────────────────── */}
          <div className="flex flex-col gap-3 mt-2">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-muted-foreground/40" />
              <span className="text-[12px] font-semibold text-foreground/80">System Activity Stream</span>
              {activityStream.isFetching && <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground/30" />}
            </div>

            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="divide-y divide-border/40 max-h-[280px] overflow-y-auto">
                {activityStream.isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="h-3 w-10 rounded animate-pulse bg-muted shrink-0" />
                      <div className="h-3 rounded animate-pulse bg-muted flex-1" />
                    </div>
                  ))
                ) : events.length === 0 ? (
                  <div className="flex items-center justify-center py-10 text-muted-foreground/30 text-[12px]">
                    No activity yet
                  </div>
                ) : (
                  events.map(ev => (
                    <div key={ev.id} className="flex items-start gap-3 px-4 py-2.5 hover:bg-accent/20 transition-colors">
                      <span className="text-[10px] text-muted-foreground/30 font-mono shrink-0 pt-0.5 w-11">
                        {shortTime(ev.createdAt)}
                      </span>
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <p className="text-[11px] font-medium text-foreground/70 truncate">{ev.description}</p>
                        {ev.resourceType && (
                          <p className="text-[10px] text-muted-foreground/30 truncate">
                            {ev.resourceType}{ev.resourceId ? ` #${ev.resourceId}` : ""}
                          </p>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground/30 shrink-0 ml-auto font-mono">
                        {ev.type}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Right Panel ───────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 w-72 shrink-0">

          {/* Queue Health */}
          <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5 text-muted-foreground/40" />
              <span className="text-[12px] font-semibold text-foreground/80">Queue Health</span>
            </div>
            <div className="flex flex-col gap-2.5">
              <QueueBar label="Calling"   value={queueCalling}  total={queueTotal} color="bg-blue-500" />
              <QueueBar label="Queued"    value={queuePending}  total={queueTotal} color="bg-zinc-500" />
              <QueueBar label="Completed" value={queueComplete} total={queueTotal} color="bg-emerald-500" />
              <QueueBar label="Failed"    value={queueFailed}   total={queueTotal} color="bg-red-500" />
            </div>
            {queueTotal > 0 && (
              <p className="text-[10px] text-muted-foreground/30 text-right tabular-nums">
                {queueTotal.toLocaleString()} leads total
              </p>
            )}
          </div>

          {/* Recent Bookings */}
          <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-3.5 h-3.5 text-muted-foreground/40" />
                <span className="text-[12px] font-semibold text-foreground/80">Recent Bookings</span>
              </div>
              <span className="text-[11px] font-semibold tabular-nums text-emerald-400">
                {k?.bookingsToday ?? 0} today
              </span>
            </div>
            <div className="flex flex-col gap-0">
              {rows
                .filter(r => r.operationalOutcome === "booking_created")
                .slice(0, 5)
                .map(r => (
                  <div key={r.leadId} className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-foreground/70 truncate">{r.name ?? r.phone}</p>
                      <p className="text-[10px] text-muted-foreground/40 truncate">{r.campaignName}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground/30 ml-2 shrink-0">
                      {relativeTime(r.lastActivityAt)}
                    </span>
                  </div>
                ))}
              {rows.filter(r => r.operationalOutcome === "booking_created").length === 0 && (
                <p className="text-[11px] text-muted-foreground/30 py-2">No bookings yet</p>
              )}
            </div>
          </div>

          {/* Recent Transfers */}
          <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-3.5 h-3.5 text-muted-foreground/40" />
                <span className="text-[12px] font-semibold text-foreground/80">Recent Transfers</span>
              </div>
              <span className="text-[11px] font-semibold tabular-nums text-violet-400">
                {k?.transfersToday ?? 0} today
              </span>
            </div>
            <div className="flex flex-col gap-0">
              {rows
                .filter(r => r.operationalOutcome === "transfer_completed")
                .slice(0, 5)
                .map(r => (
                  <div key={r.leadId} className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-foreground/70 truncate">{r.name ?? r.phone}</p>
                      <p className="text-[10px] text-muted-foreground/40 truncate">{r.campaignName}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground/30 ml-2 shrink-0">
                      {relativeTime(r.lastActivityAt)}
                    </span>
                  </div>
                ))}
              {rows.filter(r => r.operationalOutcome === "transfer_completed").length === 0 && (
                <p className="text-[11px] text-muted-foreground/30 py-2">No transfers yet</p>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
