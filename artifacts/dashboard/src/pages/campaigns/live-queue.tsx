/**
 * LiveQueueTab — Campaign Live Queue Workspace (Phase 3A)
 * ─────────────────────────────────────────────────────────────────────────────
 * Metrics strip + filterable lead table + bulk actions + lead drawer.
 * Polls every 10 s. Uses raw fetch (no generated hooks needed).
 */

import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Search, Download, RefreshCw, PauseCircle, RotateCcw,
  ChevronLeft, ChevronRight, User, Clock, Calendar,
  Activity, Phone, BarChart2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────

type LiveQueueMetrics = {
  total: number;
  queued: number;
  calling: number;
  connected: number;
  retryScheduled: number;
  callbackScheduled: number;
  nopickup: number;
  failed: number;
};

type LiveQueueLead = {
  id: number;
  name: string | null;
  phone: string;
  callStatus: string;
  operationalOutcome: string;
  disposition: string | null;
  callAttempts: number;
  durationSeconds: number | null;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  callbackAt: string | null;
  responseDueBy: string | null;
  slaStatus: string | null;
  createdAt: string;
};

type LiveQueueLeadsPage = {
  leads: LiveQueueLead[];
  total: number;
  page: number;
  limit: number;
};

type LeadDrawer = {
  lead: {
    id: number;
    name: string | null;
    phone: string;
    email: string | null;
    callStatus: string;
    operationalOutcome: string;
    disposition: string | null;
    callAttempts: number;
    notes: string | null;
    leadScore: number | null;
    createdAt: string;
    lastAttemptAt: string | null;
  };
  latestExecution: {
    callSummary: string | null;
    sentiment: string | null;
    detectedIntent: string | null;
    outcome: string | null;
    attemptNumber: number;
    createdAt: string;
  } | null;
  pendingRetry: { scheduledAt: string; reason: string | null } | null;
  pendingCallback: { callbackAt: string | null; responseDueBy: string | null; status: string } | null;
  timelinePreview: Array<{ eventType: string; data: Record<string, unknown> | null; createdAt: string }>;
};

type QueueTab =
  | "all" | "calling" | "queued" | "connected"
  | "retry" | "callback" | "nopickup" | "failed";

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

// ── Status display maps ───────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  pending:     { label: "Queued",      cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  calling:     { label: "Calling",     cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  connected:   { label: "Connected",   cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  completed:   { label: "Completed",   cls: "bg-muted/50 text-muted-foreground border-border" },
  transferred: { label: "Transferred", cls: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  failed:      { label: "No Pickup",   cls: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  exhausted:   { label: "Exhausted",   cls: "bg-red-500/10 text-red-400 border-red-500/20" },
  skipped:     { label: "Paused",      cls: "bg-muted/50 text-muted-foreground border-border" },
};

const OUTCOME_CFG: Record<string, { label: string; cls: string }> = {
  pending:            { label: "Pending",      cls: "bg-muted/50 text-muted-foreground border-border" },
  booking_created:    { label: "Booked",       cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  transfer_completed: { label: "Transferred",  cls: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  callback_requested: { label: "Callback",     cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  interest_confirmed: { label: "Interested",   cls: "bg-teal-500/10 text-teal-400 border-teal-500/20" },
  no_contact:         { label: "No Contact",   cls: "bg-muted/50 text-muted-foreground border-border" },
  dnc_blocked:        { label: "DNC",          cls: "bg-red-500/10 text-red-400 border-red-500/20" },
  failed:             { label: "Failed",       cls: "bg-red-500/10 text-red-400 border-red-500/20" },
};

const TIMELINE_LABELS: Record<string, string> = {
  imported:           "Lead imported",
  queued:             "Queued for calling",
  call_started:       "Call started",
  call_connected:     "Call connected",
  call_ended:         "Call ended",
  call_failed:        "Call failed",
  no_pickup:          "No pickup",
  retry_scheduled:    "Retry scheduled",
  retry_fired:        "Retry fired",
  disposition_set:    "Disposition set",
  callback_detected:  "Callback detected",
  callback_completed: "Callback completed",
  booking_created:    "Booking created",
  transfer_triggered: "Transfer triggered",
  transfer_completed: "Transfer completed",
  incoming_call:      "Incoming call",
  manual_retry:       "Manual retry",
  status_changed:     "Status changed",
};

function fmtDuration(secs: number | null | undefined): string {
  if (!secs) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Metrics strip ─────────────────────────────────────────────────────────────

const METRIC_CARDS: Array<{
  key: QueueTab;
  label: string;
  metric: keyof LiveQueueMetrics;
  valueCls: string;
  pulseCls?: string;
}> = [
  { key: "queued",    label: "Queued",     metric: "queued",            valueCls: "text-blue-400" },
  { key: "calling",   label: "Calling",    metric: "calling",           valueCls: "text-amber-400",   pulseCls: "bg-amber-400" },
  { key: "connected", label: "Connected",  metric: "connected",         valueCls: "text-emerald-400", pulseCls: "bg-emerald-400" },
  { key: "retry",     label: "Retry",      metric: "retryScheduled",    valueCls: "text-sky-400" },
  { key: "callback",  label: "Callbacks",  metric: "callbackScheduled", valueCls: "text-purple-400" },
  { key: "nopickup",  label: "No Pickup",  metric: "nopickup",          valueCls: "text-orange-400" },
  { key: "failed",    label: "Exhausted",  metric: "failed",            valueCls: "text-red-400" },
];

function MetricsStrip({
  metrics,
  loading,
  activeTab,
  onTabChange,
}: {
  metrics: LiveQueueMetrics | undefined;
  loading: boolean;
  activeTab: QueueTab;
  onTabChange: (tab: QueueTab) => void;
}) {
  return (
    <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 mb-4">
      {METRIC_CARDS.map(({ key, label, metric, valueCls, pulseCls }) => {
        const count = metrics?.[metric] ?? 0;
        const isActive = activeTab === key;
        const isLive = pulseCls && count > 0;
        return (
          <button
            key={key}
            onClick={() => onTabChange(isActive ? "all" : key)}
            className={cn(
              "relative rounded-xl border px-3 py-2.5 text-left transition-all hover:bg-muted/40",
              isActive
                ? "border-foreground/30 bg-muted/30 ring-1 ring-foreground/10"
                : "border-border bg-card",
            )}
          >
            {isLive && (
              <span className={cn("absolute top-2 right-2 h-1.5 w-1.5 rounded-full animate-pulse", pulseCls)} />
            )}
            {loading ? (
              <div className="h-5 w-8 bg-muted/60 rounded animate-pulse mb-1" />
            ) : (
              <p className={cn("text-lg font-bold tabular-nums leading-none", valueCls)}>{count}</p>
            )}
            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider mt-1">{label}</p>
          </button>
        );
      })}
    </div>
  );
}

// ── Lead drawer panel ─────────────────────────────────────────────────────────

function LeadDrawerPanel({
  campaignId, leadId, open, onClose, onRetry, onPause,
}: {
  campaignId: number;
  leadId: number | null;
  open: boolean;
  onClose: () => void;
  onRetry: (id: number) => void;
  onPause: (id: number) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["lq-drawer", campaignId, leadId],
    queryFn: () => apiFetch<LeadDrawer>(`${BASE}/api/campaigns/${campaignId}/leads/${leadId}/drawer`),
    enabled: open && leadId != null,
    staleTime: 15_000,
  });

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-[480px] overflow-y-auto p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-border shrink-0">
          <SheetTitle className="text-sm font-semibold flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground/50" />
            Lead Detail
          </SheetTitle>
        </SheetHeader>

        {isLoading || !data ? (
          <div className="p-5 space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 bg-muted/40 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="p-5 space-y-4 flex-1 overflow-y-auto">
            {/* Identity */}
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{data.lead.name ?? "Unknown"}</p>
                  <p className="text-xs font-mono text-muted-foreground/70">{data.lead.phone}</p>
                  {data.lead.email && (
                    <p className="text-xs text-muted-foreground/50 mt-0.5">{data.lead.email}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className={cn(
                    "inline-flex text-[10px] font-semibold px-2 py-0.5 rounded border",
                    STATUS_CFG[data.lead.callStatus]?.cls ?? "bg-muted/50 text-muted-foreground border-border",
                  )}>
                    {STATUS_CFG[data.lead.callStatus]?.label ?? data.lead.callStatus}
                  </span>
                  <span className={cn(
                    "inline-flex text-[10px] font-semibold px-2 py-0.5 rounded border",
                    OUTCOME_CFG[data.lead.operationalOutcome]?.cls ?? "bg-muted/50 text-muted-foreground border-border",
                  )}>
                    {OUTCOME_CFG[data.lead.operationalOutcome]?.label ?? data.lead.operationalOutcome}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 border-t border-border/60 pt-2">
                <div>
                  <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Attempts</p>
                  <p className="text-sm font-semibold tabular-nums">{data.lead.callAttempts}</p>
                </div>
                <div>
                  <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Score</p>
                  <p className="text-sm font-semibold">{data.lead.leadScore ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Disposition</p>
                  <p className="text-xs font-medium capitalize truncate">{data.lead.disposition ?? "—"}</p>
                </div>
              </div>

              {data.lead.notes && (
                <p className="text-xs text-muted-foreground/60 italic border-t border-border/60 pt-2 leading-relaxed">
                  {data.lead.notes}
                </p>
              )}
            </div>

            {/* Pending retry / callback */}
            {(data.pendingRetry || data.pendingCallback) && (
              <div className="space-y-1.5">
                {data.pendingRetry && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-500/5 border border-sky-500/15 text-xs">
                    <Clock className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                    <span className="text-sky-300/80">
                      Retry{" "}
                      {formatDistanceToNow(new Date(data.pendingRetry.scheduledAt), { addSuffix: true })}
                    </span>
                  </div>
                )}
                {data.pendingCallback?.callbackAt && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-500/5 border border-purple-500/15 text-xs">
                    <Calendar className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                    <span className="text-purple-300/80">
                      Callback{" "}
                      {formatDistanceToNow(new Date(data.pendingCallback.callbackAt), { addSuffix: true })}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Latest call analysis */}
            {data.latestExecution && (
              <div className="bg-card border border-border rounded-xl p-4 space-y-2">
                <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">
                  Latest Call · Attempt #{data.latestExecution.attemptNumber}
                </p>
                {data.latestExecution.callSummary ? (
                  <p className="text-xs text-foreground/70 leading-relaxed">
                    {data.latestExecution.callSummary}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground/40">No summary available</p>
                )}
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {data.latestExecution.sentiment && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground capitalize">
                      {data.latestExecution.sentiment}
                    </span>
                  )}
                  {data.latestExecution.detectedIntent && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground capitalize">
                      {data.latestExecution.detectedIntent}
                    </span>
                  )}
                  {data.latestExecution.outcome && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground capitalize">
                      {data.latestExecution.outcome}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Timeline preview */}
            {data.timelinePreview.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Recent Activity</p>
                <div className="space-y-2">
                  {data.timelinePreview.map((evt, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/25 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground/70">
                          {TIMELINE_LABELS[evt.eventType] ?? evt.eventType.replace(/_/g, " ")}
                        </p>
                        <p className="text-[10px] text-muted-foreground/40">
                          {formatDistanceToNow(new Date(evt.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <Button
                size="sm" variant="outline"
                className="flex-1 h-8 text-xs gap-1.5"
                onClick={() => { onRetry(leadId!); onClose(); }}
              >
                <RotateCcw className="h-3 w-3" /> Retry
              </Button>
              <Button
                size="sm" variant="outline"
                className="flex-1 h-8 text-xs gap-1.5"
                onClick={() => { onPause(leadId!); onClose(); }}
              >
                <PauseCircle className="h-3 w-3" /> Pause
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Sub-tab bar ───────────────────────────────────────────────────────────────

const SUB_TABS: Array<{ key: QueueTab; label: string }> = [
  { key: "all",      label: "All" },
  { key: "calling",  label: "Calling" },
  { key: "queued",   label: "Queued" },
  { key: "connected", label: "Connected" },
  { key: "retry",    label: "Retry Scheduled" },
  { key: "callback", label: "Callback Scheduled" },
  { key: "nopickup", label: "No Pickup" },
  { key: "failed",   label: "Exhausted" },
];

// ── Main component ────────────────────────────────────────────────────────────

export default function LiveQueueTab({ campaignId }: { campaignId: number }) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<QueueTab>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [drawerLeadId, setDrawerLeadId] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSearchChange = useCallback((v: string) => {
    setSearch(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setDebouncedSearch(v); setPage(0); }, 400);
  }, []);

  function changeTab(tab: QueueTab) {
    setActiveTab(tab);
    setPage(0);
    setSelectedIds(new Set());
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  const metricsQuery = useQuery({
    queryKey: ["lq-metrics", campaignId],
    queryFn: () => apiFetch<LiveQueueMetrics>(`${BASE}/api/campaigns/${campaignId}/live-queue/metrics`),
    refetchInterval: 10_000,
    staleTime: 8_000,
  });

  const leadsQuery = useQuery({
    queryKey: ["lq-leads", campaignId, activeTab, debouncedSearch, page],
    queryFn: () => {
      const p = new URLSearchParams({ tab: activeTab, page: String(page), limit: "50" });
      if (debouncedSearch) p.set("search", debouncedSearch);
      return apiFetch<LiveQueueLeadsPage>(`${BASE}/api/campaigns/${campaignId}/live-queue/leads?${p}`);
    },
    refetchInterval: 10_000,
    staleTime: 8_000,
  });

  // ── Bulk mutation ────────────────────────────────────────────────────────────

  const bulkMutation = useMutation({
    mutationFn: async ({ action, leadIds }: { action: string; leadIds: number[] }) => {
      const r = await fetch(`${BASE}/api/campaigns/${campaignId}/live-queue/bulk-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action, leadIds }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      setSelectedIds(new Set());
      void qc.invalidateQueries({ queryKey: ["lq-metrics", campaignId] });
      void qc.invalidateQueries({ queryKey: ["lq-leads", campaignId] });
    },
  });

  // ── Selection helpers ────────────────────────────────────────────────────────

  const leads = leadsQuery.data?.leads ?? [];
  const total = leadsQuery.data?.total ?? 0;
  const LIMIT = 50;
  const allPageSelected = leads.length > 0 && leads.every(l => selectedIds.has(l.id));

  function toggleAll() {
    const ids = leads.map(l => l.id);
    if (allPageSelected) {
      setSelectedIds(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
    } else {
      setSelectedIds(prev => { const n = new Set(prev); ids.forEach(id => n.add(id)); return n; });
    }
  }

  function toggleOne(id: number) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function exportCsv() {
    const p = new URLSearchParams({ tab: activeTab });
    if (debouncedSearch) p.set("search", debouncedSearch);
    window.open(`${BASE}/api/campaigns/${campaignId}/live-queue/export?${p}`, "_blank");
  }

  const someSelected = selectedIds.size > 0;

  return (
    <div className="space-y-4">
      {/* Metrics strip */}
      <MetricsStrip
        metrics={metricsQuery.data}
        loading={metricsQuery.isLoading}
        activeTab={activeTab}
        onTabChange={changeTab}
      />

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {/* Sub-tab bar + toolbar */}
        <div className="flex items-center justify-between border-b border-border">
          <div className="flex items-center overflow-x-auto scrollbar-hide">
            {SUB_TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => changeTab(key)}
                className={cn(
                  "shrink-0 px-3 py-2.5 text-[11px] font-medium border-b-2 transition-colors whitespace-nowrap",
                  activeTab === key
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground/60 hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 px-3 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/40 pointer-events-none" />
              <Input
                value={search}
                onChange={e => onSearchChange(e.target.value)}
                placeholder="Name or phone…"
                className="h-7 pl-7 text-xs w-40 bg-muted/30"
              />
            </div>
            <button
              title="Export CSV"
              onClick={exportCsv}
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <button
              title="Refresh"
              onClick={() => {
                void qc.invalidateQueries({ queryKey: ["lq-metrics", campaignId] });
                void qc.invalidateQueries({ queryKey: ["lq-leads", campaignId] });
              }}
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", leadsQuery.isFetching && "animate-spin")} />
            </button>
          </div>
        </div>

        {/* Bulk action bar */}
        {someSelected && (
          <div className="flex items-center gap-3 px-4 py-2 bg-foreground/5 border-b border-border text-xs">
            <span className="text-muted-foreground/60 tabular-nums">{selectedIds.size} selected</span>
            <Button
              size="sm" variant="outline" className="h-6 text-[10px] px-2 gap-1"
              disabled={bulkMutation.isPending}
              onClick={() => bulkMutation.mutate({ action: "retry", leadIds: Array.from(selectedIds) })}
            >
              <RotateCcw className="h-2.5 w-2.5" /> Retry
            </Button>
            <Button
              size="sm" variant="outline" className="h-6 text-[10px] px-2 gap-1"
              disabled={bulkMutation.isPending}
              onClick={() => bulkMutation.mutate({ action: "pause", leadIds: Array.from(selectedIds) })}
            >
              <PauseCircle className="h-2.5 w-2.5" /> Pause
            </Button>
            <button
              className="ml-auto text-[10px] text-muted-foreground/40 hover:text-foreground transition-colors"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear
            </button>
          </div>
        )}

        {/* Table */}
        {leadsQuery.isLoading ? (
          <div className="divide-y divide-border/40">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="h-3.5 w-3.5 bg-muted/50 rounded animate-pulse shrink-0" />
                <div className="h-3 w-28 bg-muted/50 rounded animate-pulse" />
                <div className="h-3 w-20 bg-muted/50 rounded animate-pulse" />
                <div className="ml-auto h-3 w-14 bg-muted/50 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : leads.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-3 text-center">
            <Activity className="h-8 w-8 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground/40">
              {debouncedSearch ? "No leads match your search" : "No leads in this queue segment"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/10 border-b border-border/60">
                  <th className="pl-4 pr-2 py-2 w-8">
                    <Checkbox
                      checked={allPageSelected}
                      onCheckedChange={toggleAll}
                      className="h-3.5 w-3.5"
                    />
                  </th>
                  <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Lead</th>
                  <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Status</th>
                  <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden md:table-cell">Outcome</th>
                  <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden lg:table-cell">Disposition</th>
                  <th className="px-3 py-2 text-center text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider w-16">Att.</th>
                  <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden xl:table-cell w-16">Dur.</th>
                  <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden xl:table-cell">Next Retry</th>
                  <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden xl:table-cell">Callback</th>
                  <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Last Activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {leads.map(lead => {
                  const sc = STATUS_CFG[lead.callStatus];
                  const oc = OUTCOME_CFG[lead.operationalOutcome];
                  const sel = selectedIds.has(lead.id);
                  return (
                    <tr
                      key={lead.id}
                      className={cn(
                        "hover:bg-muted/20 transition-colors cursor-pointer",
                        sel && "bg-foreground/[0.03]",
                      )}
                      onClick={() => setDrawerLeadId(lead.id)}
                    >
                      <td
                        className="pl-4 pr-2 py-2.5"
                        onClick={e => { e.stopPropagation(); toggleOne(lead.id); }}
                      >
                        <Checkbox checked={sel} onCheckedChange={() => toggleOne(lead.id)} className="h-3.5 w-3.5" />
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="text-xs font-medium truncate max-w-[120px]">{lead.name ?? "—"}</p>
                        <p className="text-[10px] font-mono text-muted-foreground/60">{lead.phone}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn(
                          "inline-flex text-[10px] font-semibold px-2 py-0.5 rounded border",
                          sc?.cls ?? "bg-muted/50 text-muted-foreground border-border",
                        )}>
                          {sc?.label ?? lead.callStatus}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 hidden md:table-cell">
                        <span className={cn(
                          "inline-flex text-[10px] font-semibold px-2 py-0.5 rounded border",
                          oc?.cls ?? "bg-muted/50 text-muted-foreground border-border",
                        )}>
                          {oc?.label ?? lead.operationalOutcome}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 hidden lg:table-cell">
                        <span className="text-xs text-muted-foreground/60 capitalize">{lead.disposition ?? "—"}</span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className="text-xs tabular-nums text-muted-foreground/60">{lead.callAttempts}</span>
                      </td>
                      <td className="px-3 py-2.5 hidden xl:table-cell">
                        <span className="text-xs tabular-nums text-muted-foreground/60">{fmtDuration(lead.durationSeconds)}</span>
                      </td>
                      <td className="px-3 py-2.5 hidden xl:table-cell">
                        <span className="text-xs text-muted-foreground/50">
                          {lead.nextRetryAt
                            ? formatDistanceToNow(new Date(lead.nextRetryAt), { addSuffix: true })
                            : "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 hidden xl:table-cell">
                        {lead.callbackAt ? (
                          <span className={cn(
                            "text-xs",
                            lead.slaStatus === "overdue"
                              ? "text-red-400"
                              : lead.slaStatus === "due-soon"
                              ? "text-amber-400"
                              : "text-muted-foreground/50",
                          )}>
                            {formatDistanceToNow(new Date(lead.callbackAt), { addSuffix: true })}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/30">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-[10px] text-muted-foreground/40">
                          {lead.lastAttemptAt
                            ? formatDistanceToNow(new Date(lead.lastAttemptAt), { addSuffix: true })
                            : formatDistanceToNow(new Date(lead.createdAt), { addSuffix: true })}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {total > LIMIT && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border/60 bg-muted/10">
            <p className="text-xs text-muted-foreground/40 tabular-nums">
              {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total.toLocaleString()}
            </p>
            <div className="flex gap-1.5">
              <Button
                variant="outline" size="sm" className="h-7 text-xs gap-1 px-2"
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
              >
                <ChevronLeft className="h-3 w-3" /> Prev
              </Button>
              <Button
                variant="outline" size="sm" className="h-7 text-xs gap-1 px-2"
                disabled={(page + 1) * LIMIT >= total}
                onClick={() => setPage(p => p + 1)}
              >
                Next <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Lead drawer */}
      <LeadDrawerPanel
        campaignId={campaignId}
        leadId={drawerLeadId}
        open={drawerLeadId != null}
        onClose={() => setDrawerLeadId(null)}
        onRetry={id => bulkMutation.mutate({ action: "retry", leadIds: [id] })}
        onPause={id => bulkMutation.mutate({ action: "pause", leadIds: [id] })}
      />
    </div>
  );
}
