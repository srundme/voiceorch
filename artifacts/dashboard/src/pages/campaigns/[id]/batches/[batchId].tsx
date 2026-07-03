/**
 * Batch Workspace — Phase 4
 * Transforms a batch from "import container" → Operational Command Center.
 * Layout: Header → KPI Strip → Tabs (Overview | Leads)
 * Keeps existing controls (Start / Pause / Stop / Redial) intact.
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { TablePagination } from "@/components/table-pagination";
import { useRoute, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useUpdateCampaignBatch, useRedialBatchNoPickup,
  useRetryCampaignLead, useGetBatchAnalytics,
  getListCampaignBatchesQueryKey,
  getListBatchLeadsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { DetailNav } from "@/components/detail-nav";
import {
  ArrowLeft, Play, Pause, Square, RotateCcw, ChevronRight,
  Users, Phone, PhoneCall, Calendar, ArrowRightLeft, XCircle,
  TrendingUp, Bell, PhoneIncoming, Voicemail,
  Eye, Database, RefreshCw, DollarSign,
  User, Search, X, CheckCircle2, Clock, Pencil,
  Info, ChevronDown,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getIrdaiBlockedError } from "@/lib/irdai-block";
import { getExecutionId } from "@/lib/execution-id";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format, parseISO } from "date-fns";
import { BATCH_STATUS_MAP, callStatusCfg, outcomeCfg } from "@/lib/campaign-status";
import { CallDetailDrawer } from "@/components/call-detail-drawer";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

// ── useCountdown ──────────────────────────────────────────────────────────────
// Returns live { days, hours, minutes, seconds, expired } ticking every second.
// Returns null when targetIso is null/undefined or already in the past on mount.

type Countdown = { days: number; hours: number; minutes: number; seconds: number; expired: boolean };

function useCountdown(targetIso: string | null | undefined): Countdown | null {
  const [tick, setTick] = useState(0);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!targetIso) return;
    ref.current = setInterval(() => setTick(t => t + 1), 1000);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [targetIso]);

  if (!targetIso) return null;
  const diff = new Date(targetIso).getTime() - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
  const totalSec = Math.floor(diff / 1000);
  const days    = Math.floor(totalSec / 86400);
  const hours   = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  // tick is read to force re-render each second
  void tick;
  return { days, hours, minutes, seconds, expired: false };
}

// ── Timezone helpers ──────────────────────────────────────────────────────────

/** Format a UTC ISO string as a human-readable local time in the given IANA timezone. */
function formatInTz(isoString: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      month:   "short",
      day:     "numeric",
      hour:    "numeric",
      minute:  "2-digit",
      hour12:  true,
      timeZoneName: "short",
    }).format(new Date(isoString));
  } catch {
    return new Date(isoString).toLocaleString();
  }
}

/** Convert a UTC ISO string to a "YYYY-MM-DDTHH:MM" value for a datetime-local input, in the given timezone. */
function utcToTzInput(isoString: string, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(isoString));
    const g = (t: string) => parts.find(p => p.type === t)?.value ?? "00";
    return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
  } catch {
    return "";
  }
}

/** Convert a "YYYY-MM-DDTHH:MM" string (entered as local time in `tz`) to a UTC ISO string. */
function tzInputToUtc(localStr: string, tz: string): string {
  try {
    // Treat localStr as UTC first to get a reference Date
    const approx = new Date(localStr + ":00Z");
    // Find what UTC offset the target timezone has at that moment
    const tzParts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, timeZoneName: "shortOffset",
    }).formatToParts(approx);
    const offsetStr = tzParts.find(p => p.type === "timeZoneName")?.value ?? "+00:00";
    const m = offsetStr.match(/GMT([+-])(\d+)(?::(\d+))?/);
    if (!m) return approx.toISOString();
    const sign = m[1] === "+" ? 1 : -1;
    const offsetMs = sign * (parseInt(m[2]!) * 60 + parseInt(m[3] ?? "0")) * 60_000;
    return new Date(approx.getTime() - offsetMs).toISOString();
  } catch {
    return new Date(localStr).toISOString();
  }
}

// ── EditScheduleDialog ────────────────────────────────────────────────────────

function EditScheduleDialog({
  open,
  onOpenChange,
  scheduledStartAt,
  timezone,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scheduledStartAt: string;
  timezone: string;
  onSave: (isoUtc: string) => void;
  saving: boolean;
}) {
  const [value, setValue] = useState(() => utcToTzInput(scheduledStartAt, timezone));
  // Re-sync if the scheduled time changes externally
  useEffect(() => {
    setValue(utcToTzInput(scheduledStartAt, timezone));
  }, [scheduledStartAt, timezone]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[340px]">
        <DialogHeader>
          <DialogTitle className="text-sm">Edit Scheduled Time</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Launch time</Label>
            <Input
              type="datetime-local"
              className="h-9 text-xs"
              value={value}
              onChange={e => setValue(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              Times are in <span className="font-medium text-foreground">{timezone}</span> (agent timezone)
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            size="sm"
            disabled={!value || saving}
            onClick={() => onSave(tzInputToUtc(value, timezone))}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── ScheduledInlineChip ───────────────────────────────────────────────────────

function ScheduledInlineChip({
  scheduledStartAt,
  timezone,
  onEdit,
  onExpired,
}: {
  scheduledStartAt: string;
  timezone: string;
  onEdit: () => void;
  onExpired: () => void;
}) {
  const cd = useCountdown(scheduledStartAt);
  const expiredRef = useRef(false);

  useEffect(() => {
    if (cd?.expired && !expiredRef.current) {
      expiredRef.current = true;
      onExpired();
    }
  }, [cd?.expired, onExpired]);

  if (!cd || cd.expired) return null;

  const pad = (n: number) => String(n).padStart(2, "0");
  const countdownStr = cd.days > 0
    ? `${cd.days}d ${pad(cd.hours)}:${pad(cd.minutes)}:${pad(cd.seconds)}`
    : `${pad(cd.hours)}:${pad(cd.minutes)}:${pad(cd.seconds)}`;

  return (
    <span className="inline-flex items-center gap-1.5 h-7 pl-2 pr-1 rounded-md border border-amber-500/30 bg-amber-500/8 text-amber-600 text-[11px] font-medium whitespace-nowrap">
      <Clock className="h-3 w-3 shrink-0" />
      <span className="font-mono tabular-nums">{countdownStr}</span>
      <span className="text-muted-foreground/60 font-normal hidden sm:inline">
        · {formatInTz(scheduledStartAt, timezone)}
      </span>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onEdit(); }}
        className="ml-0.5 h-5 w-5 rounded flex items-center justify-center hover:bg-amber-500/15 transition-colors shrink-0"
        title="Edit schedule"
      >
        <Pencil className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

type BatchWorkspaceKpis = {
  total: number; connected: number; failed: number; pending: number;
  callbacks: number; incoming: number; bookings: number; transfers: number;
  voicemail: number; successRate: number;
};

type BatchWorkspaceLead = {
  id: number; name: string | null; phone: string;
  callStatus: string; operationalOutcome: string;
  disposition: string | null; callAttempts: number;
  lastAttemptAt: string | null; nextRetryAt: string | null; callId: number | null; createdAt: string;
  durationSeconds: number | null; costCents: number | null; executionId: string | null; notes: string | null;
  callback: { status: string; callbackAt: string | null } | null;
  booking: { meetingTime: string | null; meetingStatus: string; meetingLink: string | null } | null;
  transfer: { status: string; transferTo: string } | null;
};

type BatchLeadsPage = { items: BatchWorkspaceLead[]; total: number; page: number; limit: number };

type BatchHeader = {
  batch: {
    id: number; name: string; status: string; leadSource: string;
    totalLeads: number; calledLeads: number; createdAt: string;
    scheduledStartAt: string | null;
    timezone: string | null;
    maxAttempts: number; retryDelayMinutes: number;
  };
  campaign: { id: number; name: string; agentId: number | null; agentName: string | null; fromNumber: string | null };
  source: { name: string; type: string } | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string): Promise<T> {
  const token = localStorage.getItem("voiceorch:session");
  const r = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

function fmtDuration(s: number | null | undefined): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function fmtRelative(iso: string): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

// ── Status / outcome config — canonical maps from shared lib ─────────────────
// BATCH_STATUS_MAP, callStatusCfg(), outcomeCfg() imported from @/lib/campaign-status

// ── BatchStatusBadge ──────────────────────────────────────────────────────────

function BatchStatusBadge({ status }: { status: string }) {
  const cfg = BATCH_STATUS_MAP[status] ?? { label: status, cls: "bg-muted/50 text-muted-foreground border-border" };
  return (
    <span className={cn("inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-md border", cfg.cls)}>
      {cfg.label}
    </span>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: number | string; color?: string;
}) {
  return (
    <div className="bg-card px-3.5 py-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className={cn("text-muted-foreground/50", color)}>{icon}</span>
        <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground/40 truncate">{label}</span>
      </div>
      <p className={cn("text-xl font-bold tabular-nums", color ?? "text-foreground")}>{value}</p>
    </div>
  );
}

// ── Leads Tab ─────────────────────────────────────────────────────────────────

function LeadsTab({ campaignId, batchId, maxAttempts, agentId }: { campaignId: number; batchId: number; maxAttempts: number; agentId: number | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const retry = useRetryCampaignLead();

  const [infoOpen,    setInfoOpen]    = useState(() => localStorage.getItem("batch-info-dismissed") !== "1");
  const [page,        setPage]        = useState(0);
  const [limit,       setLimit]       = useState(25);
  const [status,      setStatus]      = useState("all");
  const [outcome,     setOutcome]     = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search,      setSearch]      = useState("");
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const LIMIT = limit;

  // Debounce the search input so we don't fire a query on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const queryKey = ["batch-ws-leads", campaignId, batchId, status, outcome, search, page];
  const { data, isFetching } = useQuery<BatchLeadsPage>({
    queryKey,
    queryFn: () => {
      const p = new URLSearchParams({ status, outcome, page: String(page), limit: String(LIMIT) });
      if (search) p.set("search", search);
      return apiFetch<BatchLeadsPage>(`${BASE}/api/campaigns/${campaignId}/batches/${batchId}/workspace/leads?${p}`);
    },
    refetchInterval: 10000,
    placeholderData: prev => prev,
  });

  async function handleRetry(leadId: number) {
    try {
      await retry.mutateAsync({ id: campaignId, leadId });
      await qc.invalidateQueries({ queryKey });
      toast({ title: "Retry queued" });
    } catch { toast({ title: "Failed", variant: "destructive" }); }
  }

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const STATUS_FILTERS = [
    { key: "all", label: "All" },
    { key: "pending",   label: "Pending"   },
    { key: "completed", label: "Completed" },
    { key: "voicemail", label: "Voicemail" },
    { key: "failed",    label: "Failed"    },
    { key: "calling",   label: "Calling"   },
  ];

  // Dynamic disposition tabs — derived from the campaign agent's configured
  // disposition taxonomy. Each tab's filter key is the disposition value stored
  // on the lead. Falls back gracefully (404 = no config) to no dynamic tabs.
  const { data: dispConfig } = useQuery<{ taxonomy: Record<string, string[]> } | null>({
    queryKey: ["batch-ws-dispositions", agentId],
    enabled: agentId != null,
    queryFn: async () => {
      try {
        return await apiFetch<{ taxonomy: Record<string, string[]> }>(`${BASE}/api/disposition/config/${agentId}`);
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60_000,
  });

  const dispositionTabs = Object.keys(dispConfig?.taxonomy ?? {}).map(key => ({ key, label: key }));

  const OUTCOME_FILTERS = [
    { key: "all", label: "All Outcomes" },
    ...dispositionTabs,
    { key: "booking_created",    label: "Booked"      },
    { key: "transfer_completed", label: "Transferred" },
    { key: "callback_requested", label: "Callback"    },
  ];

  return (
    <div className="flex flex-col h-full">

      {/* ── What is a Batch? explainer strip ── */}
      {infoOpen && (
        <div className="mx-4 mt-3 rounded-xl border border-blue-500/20 bg-blue-500/[0.04] overflow-hidden">
          <div className="flex items-start gap-3 px-4 py-3">
            <Info className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground/80 mb-1.5">What is a Batch?</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px] text-muted-foreground/70 leading-relaxed">
                <div>
                  <span className="font-semibold text-foreground/60 block mb-0.5">📦 A batch = one upload</span>
                  Each time you add leads to a campaign, that group is called a batch.
                  One campaign can have many batches — "Week 1 list", "Re-engagement list", etc.
                </div>
                <div>
                  <span className="font-semibold text-foreground/60 block mb-0.5">🔒 Fully isolated</span>
                  Each batch tracks its own progress, retries, and results independently.
                  Pausing or stopping one batch never affects another.
                </div>
                <div>
                  <span className="font-semibold text-foreground/60 block mb-0.5">📊 This view = one batch</span>
                  You're looking at a single batch workspace. Use the Attempts, Duration, and Cost
                  columns to see exactly what happened on each call.
                </div>
              </div>
            </div>
            <button
              onClick={() => { setInfoOpen(false); localStorage.setItem("batch-info-dismissed", "1"); }}
              className="text-muted-foreground/30 hover:text-muted-foreground transition-colors shrink-0 mt-0.5"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground/40 uppercase tracking-wider shrink-0">Status</span>
          <div className="inline-flex items-center rounded-lg border border-border/60 bg-card/40 overflow-hidden">
            {STATUS_FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => { setStatus(f.key); setPage(0); }}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium transition-colors border-r border-border/40 last:border-r-0",
                  status === f.key ? "bg-muted/60 text-foreground" : "text-muted-foreground hover:bg-muted/30",
                )}
              >{f.label}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground/40 uppercase tracking-wider shrink-0">Outcome</span>
          <div className="inline-flex items-center rounded-lg border border-border/60 bg-card/40 overflow-hidden flex-wrap">
            {OUTCOME_FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => { setOutcome(f.key); setPage(0); }}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium transition-colors border-r border-border/40 last:border-r-0",
                  outcome === f.key ? "bg-muted/60 text-foreground" : "text-muted-foreground hover:bg-muted/30",
                )}
              >{f.label}</button>
            ))}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Search name or phone…"
              className="h-7 w-44 rounded-lg border border-border/60 bg-card/40 pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-border"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground transition-colors"
                title="Clear search">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {(status !== "all" || outcome !== "all" || search !== "") && (
            <button
              onClick={() => { setStatus("all"); setOutcome("all"); setSearchInput(""); setPage(0); }}
              className="text-xs text-muted-foreground/60 underline-offset-2 hover:text-foreground hover:underline transition-colors">
              Clear filters
            </button>
          )}
          <span className="text-xs text-muted-foreground/40">{total.toLocaleString()} leads</span>
          <Button size="sm" variant="ghost" className={cn("h-6 w-6 p-0", isFetching && "opacity-60")}
            onClick={() => qc.invalidateQueries({ queryKey })}>
            <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <Users className="h-7 w-7 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground/40">No leads match the current filters</p>
            {(status !== "all" || outcome !== "all" || search !== "") && (
              <button
                onClick={() => { setStatus("all"); setOutcome("all"); setSearchInput(""); setPage(0); }}
                className="text-xs text-muted-foreground/60 underline-offset-2 hover:text-foreground hover:underline transition-colors">
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/40">
              <tr>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Lead</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden lg:table-cell">Date & Time</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden md:table-cell">Call ID</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Status</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden sm:table-cell">Outcome</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden md:table-cell">Attempts</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden xl:table-cell">Duration</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden xl:table-cell">Cost</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider w-20">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {items.map(lead => {
                const sc = callStatusCfg(lead.callStatus);
                const oc = outcomeCfg(lead.operationalOutcome ?? "");
                const ts = lead.lastAttemptAt ?? lead.createdAt;
                return (
                  <tr key={lead.id} className="group hover:bg-muted/30 transition-colors duration-100 cursor-default">
                    {/* Lead */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted/40 text-xs font-semibold text-muted-foreground/70 shrink-0 group-hover:bg-muted/60 transition-colors">
                          {((lead.name?.trim()?.charAt(0)) || (lead.phone?.charAt(0)) || "?").toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium truncate max-w-[120px] text-foreground/80">{lead.name ?? "—"}</p>
                          <p className="text-[10px] font-mono text-muted-foreground/50">{lead.phone}</p>
                        </div>
                      </div>
                    </td>
                    {/* Date & Time */}
                    <td className="px-3 py-2.5 hidden lg:table-cell whitespace-nowrap">
                      <div className="text-[11px] text-foreground/70 font-medium">{format(parseISO(ts), "MMM d, yyyy")}</div>
                      <div className="text-[10px] font-mono text-muted-foreground/40">{format(parseISO(ts), "HH:mm:ss")}</div>
                    </td>
                    {/* Execution ID */}
                    <td className="px-3 py-2.5 hidden md:table-cell">
                      <span className="font-mono text-[10px] text-muted-foreground/40">
                        {getExecutionId(lead)}
                      </span>
                    </td>
                    {/* Status */}
                    <td className="px-3 py-2.5">
                      <span
                        className={cn("inline-flex text-[10px] font-semibold px-2 py-0.5 rounded border", sc.cls)}
                        title={lead.callStatus === "skipped" && lead.notes ? lead.notes : undefined}>
                        {sc.label}
                      </span>
                      {lead.callStatus === "skipped" && lead.notes && (
                        <p className="text-[10px] text-muted-foreground/50 truncate max-w-[160px] mt-0.5" title={lead.notes}>
                          {lead.notes}
                        </p>
                      )}
                    </td>
                    {/* Outcome */}
                    <td className="px-3 py-2.5 hidden sm:table-cell">
                      <span className={cn("text-xs font-medium", oc.color)}>{oc.label}</span>
                    </td>
                    {/* Attempts */}
                    <td className="px-3 py-2.5 hidden md:table-cell">
                      {(() => {
                        const currentAttempt = Math.min(Math.max(1, lead.callAttempts), maxAttempts);
                        const exhausted = lead.callAttempts >= maxAttempts;
                        const oneLeft   = !exhausted && currentAttempt === maxAttempts - 1;
                        const counterCls = exhausted ? "text-red-500" : oneLeft ? "text-amber-500" : "text-muted-foreground/60";
                        const TERMINAL = ["completed", "failed", "skipped"];
                        const showRetry = lead.nextRetryAt && !TERMINAL.includes(lead.callStatus);
                        return (
                          <div className="flex flex-col gap-0.5">
                            <span className={cn("text-xs tabular-nums font-medium", counterCls)}>
                              Attempt {currentAttempt} of {maxAttempts}
                            </span>
                            {showRetry && (
                              <span className="text-[10px] text-amber-500/80 tabular-nums" title={new Date(lead.nextRetryAt!).toLocaleString()}>
                                retry {formatDistanceToNow(new Date(lead.nextRetryAt!), { addSuffix: true })}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    {/* Duration */}
                    <td className="px-3 py-2.5 hidden xl:table-cell">
                      <span className="font-mono text-[11px] text-muted-foreground/60">
                        {lead.durationSeconds != null
                          ? lead.durationSeconds >= 60
                            ? `${Math.floor(lead.durationSeconds / 60)}m ${lead.durationSeconds % 60}s`
                            : `${lead.durationSeconds}s`
                          : "—"}
                      </span>
                    </td>
                    {/* Cost */}
                    <td className="px-3 py-2.5 hidden xl:table-cell">
                      {lead.costCents != null && lead.costCents > 0 ? (
                        <span className="flex items-center gap-0.5 text-[10px] font-mono text-muted-foreground/50">
                          <DollarSign className="h-2.5 w-2.5" />
                          {(lead.costCents / 100).toFixed(3)}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/25">—</span>
                      )}
                    </td>
                    {/* Actions */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {lead.callId && (
                          <Button size="icon" variant="ghost" className="h-6 w-6"
                            title="View Call"
                            onClick={() => {
                              const idx = items.findIndex(l => l.id === lead.id);
                              setSelectedIdx(idx >= 0 ? idx : null);
                            }}>
                            <Eye className="h-3 w-3 text-muted-foreground/60" />
                          </Button>
                        )}
                        {lead.callStatus === "failed" && (
                          <Button size="icon" variant="ghost" className="h-6 w-6"
                            title="Retry" onClick={() => void handleRetry(lead.id)}>
                            <RotateCcw className="h-3 w-3 text-amber-500" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div className="px-5 py-3 border-t border-border/30">
        <TablePagination
          page={page + 1}
          totalPages={totalPages}
          pageSize={limit}
          totalItems={total}
          onPageChange={p => setPage(p - 1)}
          onPageSizeChange={s => { setLimit(s); setPage(0); }}
          pageSizeOptions={[10, 25, 50, 100]}
        />
      </div>

      {/* Call Detail Drawer */}
      <CallDetailDrawer
        open={selectedIdx !== null && items[selectedIdx ?? -1]?.callId != null}
        onClose={() => setSelectedIdx(null)}
        callId={selectedIdx !== null ? (items[selectedIdx]?.callId ?? null) : null}
        leadName={selectedIdx !== null ? (items[selectedIdx]?.name ?? items[selectedIdx]?.phone ?? null) : null}
        currentIndex={selectedIdx ?? undefined}
        totalCount={items.length}
        onPrev={selectedIdx !== null && selectedIdx > 0
          ? () => setSelectedIdx(i => Math.max(0, (i ?? 1) - 1))
          : undefined}
        onNext={selectedIdx !== null && selectedIdx < items.length - 1
          ? () => setSelectedIdx(i => Math.min(items.length - 1, (i ?? 0) + 1))
          : undefined}
        prevLabel={selectedIdx !== null && selectedIdx > 0
          ? (items[selectedIdx - 1]?.name ?? items[selectedIdx - 1]?.phone ?? null)
          : null}
        nextLabel={selectedIdx !== null && selectedIdx < items.length - 1
          ? (items[selectedIdx + 1]?.name ?? items[selectedIdx + 1]?.phone ?? null)
          : null}
      />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BatchWorkspacePage() {
  const [, params] = useRoute("/app/campaigns/:id/batches/:batchId");
  const campaignId = parseInt(params?.id      ?? "0", 10);
  const batchId    = parseInt(params?.batchId ?? "0", 10);

  const { toast } = useToast();
  const qc = useQueryClient();

  const update = useUpdateCampaignBatch();
  const redial = useRedialBatchNoPickup();
  const [isStarting, setIsStarting] = useState(false);
  const [editScheduleOpen, setEditScheduleOpen] = useState(false);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  // Header data (light, kept in sync with polling)
  const { data: header } = useQuery<BatchHeader>({
    queryKey: ["batch-ws-header", campaignId, batchId],
    queryFn: () => apiFetch(`${BASE}/api/campaigns/${campaignId}/batches/${batchId}/workspace/header`),
    refetchInterval: 10000,
  });

  // KPIs
  const { data: kpis } = useQuery<BatchWorkspaceKpis>({
    queryKey: ["batch-ws-kpis", campaignId, batchId],
    queryFn: () => apiFetch(`${BASE}/api/campaigns/${campaignId}/batches/${batchId}/workspace/kpis`),
    refetchInterval: 10000,
  });

  const batchStatus = header?.batch.status ?? "draft";
  // A terminal batch (completed / stopped / cancelled) has no more work, so it
  // must not present Running-only actions. Start is also blocked for completed /
  // cancelled (the backend 409s), while a stopped batch can still be restarted.
  const canStart     = !(batchStatus === "running" || batchStatus === "completed" || batchStatus === "cancelled");
  const canStopPause = batchStatus === "running" || batchStatus === "paused";

  // Batch analytics — used to know whether any scheduled retries are still pending.
  const { data: batchAnalytics } = useGetBatchAnalytics(campaignId, batchId, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: { refetchInterval: 10000 } as any,
  });

  // "Finished" = backend marked the batch completed AND no scheduled retries remain.
  // Only then are the Start/Pause/Stop/Redial controls pointless → show a badge instead.
  const finished =
    batchStatus === "completed" &&
    batchAnalytics != null &&
    (batchAnalytics.stats.pendingRetries ?? 0) === 0;

  async function handleStart() {
    setIsStarting(true);
    try {
      const token = localStorage.getItem("voiceorch:session");
      const r = await fetch(`${BASE}/api/campaigns/${campaignId}/batches/${batchId}/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string; code?: string; missingItems?: unknown[] };
        if (body.code === "IRDAI_BLOCKED") {
          toast({ title: "Call blocked", description: body.error, variant: "destructive" });
          return;
        }
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      await qc.invalidateQueries({ queryKey: getListCampaignBatchesQueryKey(campaignId) });
      await qc.invalidateQueries({ queryKey: ["batch-ws-header", campaignId, batchId] });
      toast({ title: "Batch started" });
    } catch (err) {
      const irdai = getIrdaiBlockedError(err);
      if (irdai) {
        toast({ title: "Call blocked", description: irdai.message, variant: "destructive" });
      } else {
        toast({ title: "Action failed", variant: "destructive" });
      }
    } finally {
      setIsStarting(false);
    }
  }

  async function handleControl(status: "paused" | "stopped") {
    try {
      await update.mutateAsync({ id: campaignId, batchId, data: { status } });
      await qc.invalidateQueries({ queryKey: getListCampaignBatchesQueryKey(campaignId) });
      await qc.invalidateQueries({ queryKey: ["batch-ws-header", campaignId, batchId] });
      toast({ title: status === "paused" ? "Batch paused" : "Batch stopped" });
    } catch (err) {
      const irdai = getIrdaiBlockedError(err);
      if (irdai) {
        toast({ title: "Call blocked", description: irdai.message, variant: "destructive" });
      } else {
        toast({ title: "Action failed", variant: "destructive" });
      }
    }
  }

  async function handleSaveSchedule(isoUtc: string) {
    setIsSavingSchedule(true);
    try {
      await update.mutateAsync({ id: campaignId, batchId, data: { scheduledStartAt: isoUtc } });
      await qc.invalidateQueries({ queryKey: ["batch-ws-header", campaignId, batchId] });
      setEditScheduleOpen(false);
      toast({ title: "Schedule updated" });
    } catch {
      toast({ title: "Failed to update schedule", variant: "destructive" });
    } finally {
      setIsSavingSchedule(false);
    }
  }

  async function handleRedialAll() {
    try {
      const r = await redial.mutateAsync({ id: campaignId, batchId });
      await qc.invalidateQueries({ queryKey: getListBatchLeadsQueryKey(campaignId, batchId) });
      toast({ title: "Redial queued", description: `${(r as { queued?: number })?.queued ?? 0} leads scheduled` });
    } catch {
      toast({ title: "Redial failed", variant: "destructive" });
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-6 pt-5 pb-3 border-b border-border/40 shrink-0">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div>
              {/* Breadcrumb */}
              <DetailNav
                className="mb-0.5"
                backTo={`/app/campaigns/${campaignId}`}
                backLabel="Back to Campaign"
                crumbs={[
                  { label: "Campaigns", href: "/app/campaigns" },
                  { label: header?.campaign.name ?? "…", href: `/app/campaigns/${campaignId}` },
                  { label: header?.batch.name ?? "Batch" },
                ]}
              />

              {/* Title + status */}
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-lg font-semibold tracking-tight">{header?.batch.name ?? "Batch Workspace"}</h2>
                {header && <BatchStatusBadge status={batchStatus} />}
                {batchStatus === "draft" && header?.batch.scheduledStartAt && (
                  <ScheduledInlineChip
                    scheduledStartAt={header.batch.scheduledStartAt}
                    timezone={header.batch.timezone ?? "UTC"}
                    onEdit={() => setEditScheduleOpen(true)}
                    onExpired={() => void qc.invalidateQueries({ queryKey: ["batch-ws-header", campaignId, batchId] })}
                  />
                )}
                {header?.campaign.agentName && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground/50">
                    <User className="h-2.5 w-2.5" />
                    {header.campaign.agentName}
                  </span>
                )}
                {header?.campaign.fromNumber && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground/50">
                    <Phone className="h-2.5 w-2.5" />
                    {header.campaign.fromNumber}
                  </span>
                )}
                {header?.source && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground/50">
                    <Database className="h-2.5 w-2.5" />
                    {header.source.name}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 ml-auto">
            {finished ? (
              <span className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-md border bg-emerald-500/10 text-emerald-600 border-emerald-500/30 select-none">
                <CheckCircle2 className="h-3.5 w-3.5" /> Batch Completed
              </span>
            ) : (
              <>
                <Button size="sm" className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={!canStart || update.isPending || isStarting}
                  onClick={() => void handleStart()}>
                  <Play className="h-3.5 w-3.5" /> Start
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                  disabled={batchStatus !== "running" || update.isPending}
                  onClick={() => void handleControl("paused")}>
                  <Pause className="h-3.5 w-3.5" /> Pause
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 border-red-500/20 text-red-600 hover:bg-red-500/5"
                  disabled={!canStopPause || update.isPending}
                  onClick={() => void handleControl("stopped")}>
                  <Square className="h-3.5 w-3.5" /> Stop
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                  disabled={batchStatus === "running" || redial.isPending}
                  onClick={() => void handleRedialAll()}>
                  <RotateCcw className="h-3.5 w-3.5" /> Redial
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Edit schedule dialog ────────────────────────────────────────────── */}
      {header?.batch.scheduledStartAt && (
        <EditScheduleDialog
          open={editScheduleOpen}
          onOpenChange={setEditScheduleOpen}
          scheduledStartAt={header.batch.scheduledStartAt}
          timezone={header.batch.timezone ?? "UTC"}
          onSave={(iso) => void handleSaveSchedule(iso)}
          saving={isSavingSchedule}
        />
      )}

      {/* ── KPI Strip ───────────────────────────────────────────────────────── */}
      <div className="px-5 py-3 shrink-0">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-px bg-border/60 border border-border/60 rounded-xl overflow-hidden">
          <KpiCard icon={<Users className="h-3 w-3" />}        label="Total"     value={kpis?.total       ?? "—"} />
          <KpiCard icon={<PhoneCall className="h-3 w-3" />}    label="Connected" value={kpis?.connected    ?? "—"} color="text-emerald-500" />
          <KpiCard icon={<Bell className="h-3 w-3" />}         label="Callbacks" value={kpis?.callbacks    ?? "—"} color="text-amber-500"   />
          <KpiCard icon={<PhoneIncoming className="h-3 w-3" />} label="Incoming" value={kpis?.incoming     ?? "—"} color="text-sky-500"     />
          <KpiCard icon={<Calendar className="h-3 w-3" />}     label="Bookings"  value={kpis?.bookings     ?? "—"} color="text-violet-500"  />
          <KpiCard icon={<ArrowRightLeft className="h-3 w-3" />} label="Transfers" value={kpis?.transfers  ?? "—"} color="text-sky-400"    />
          <KpiCard icon={<Voicemail className="h-3 w-3" />}    label="Voicemail" value={kpis?.voicemail    ?? "—"} color="text-violet-500"  />
          <KpiCard icon={<XCircle className="h-3 w-3" />}      label="Failed"    value={kpis?.failed       ?? "—"} color="text-red-500"     />
          <KpiCard icon={<TrendingUp className="h-3 w-3" />}   label="Success"   value={kpis ? `${kpis.successRate}%` : "—"} color="text-emerald-500" />
        </div>
      </div>

      {/* ── Leads ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto min-h-0">
        <LeadsTab campaignId={campaignId} batchId={batchId} maxAttempts={header?.batch.maxAttempts ?? 1} agentId={header?.campaign.agentId ?? null} />
      </div>

    </div>
  );
}
