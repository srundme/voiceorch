/**
 * CallbacksTab — Phase 3B
 * Dedicated callback management workspace. SLA-first: overdue rows are always
 * surfaced at the top; response_due_by drives colour coding.
 */

import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Phone, CheckCircle2, Calendar, Download, RefreshCw,
  AlertTriangle, Clock, CalendarCheck, RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type CallbackMetrics = {
  pending:   number;
  overdue:   number;
  dueNow:    number;
  dueToday:  number;
  completed: number;
};

type CallbackLeadInfo = {
  name:         string | null;
  phone:        string;
  callAttempts: number;
  disposition:  string | null;
  callStatus:   string;
};

type CallbackItem = {
  id:            number;
  leadId:        number;
  callbackAt:    string | null;
  responseDueBy: string | null;
  slaStatus:     string | null;
  reason:        string | null;
  status:        string;
  createdAt:     string;
  lead:          CallbackLeadInfo;
};

type CallbacksPage = {
  items: CallbackItem[];
  total: number;
  page:  number;
  limit: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "";
  const diff = new Date(iso).getTime() - Date.now();
  const abs  = Math.abs(diff);
  const mins = Math.floor(abs / 60000);
  const hrs  = Math.floor(abs / 3600000);
  const days = Math.floor(abs / 86400000);
  const past = diff < 0;
  if (days > 0)  return past ? `${days}d ago` : `in ${days}d`;
  if (hrs  > 0)  return past ? `${hrs}h ago`  : `in ${hrs}h`;
  if (mins > 0)  return past ? `${mins}m ago`  : `in ${mins}m`;
  return past ? "just now" : "soon";
}

const SLA_CFG: Record<string, { cls: string; label: string }> = {
  overdue:    { cls: "bg-red-500/10 text-red-500 border-red-500/30",       label: "Overdue"   },
  "due-soon": { cls: "bg-amber-500/10 text-amber-500 border-amber-500/30", label: "Due Soon"  },
  ok:         { cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30", label: "On Track" },
};

const DISPOSITION_COLORS: Record<string, string> = {
  interested:    "text-emerald-500",
  not_interested: "text-red-400",
  callback:       "text-amber-500",
  do_not_call:    "text-red-600",
};

// ── Sub-tabs ──────────────────────────────────────────────────────────────────

const SUB_TABS = [
  { key: "pending",   label: "Pending"  },
  { key: "overdue",   label: "Overdue"  },
  { key: "due-now",   label: "Due Now"  },
  { key: "due-today", label: "Due Today" },
  { key: "completed", label: "Completed" },
  { key: "all",       label: "All"      },
] as const;

// ── Component ─────────────────────────────────────────────────────────────────

export default function CallbacksTab({ campaignId }: { campaignId: number }) {
  const qc   = useQueryClient();
  const { toast } = useToast();
  const BASE  = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

  const [tab,         setTab]         = useState<string>("pending");
  const [search,      setSearch]      = useState("");
  const [page,        setPage]        = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [rescheduleId, setRescheduleId] = useState<number | null>(null);
  const [rescheduleLeadName, setRescheduleLeadName] = useState<string>("");
  const [rescheduleDate, setRescheduleDate] = useState<string>("");
  const [bulkRescheduleOpen, setBulkRescheduleOpen] = useState(false);
  const [bulkRescheduleDate, setBulkRescheduleDate] = useState<string>("");

  const LIMIT = 50;
  const searchInput = useRef<HTMLInputElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const metricsKey = ["callback-metrics", campaignId];
  const listKey    = ["callbacks", campaignId, tab, search, page];

  const { data: metrics } = useQuery<CallbackMetrics>({
    queryKey: metricsKey,
    queryFn:  () => apiFetch(`${BASE}/api/campaigns/${campaignId}/callbacks/metrics`),
    refetchInterval: 10000,
  });

  const { data, isFetching } = useQuery<CallbacksPage>({
    queryKey: listKey,
    queryFn: () => {
      const p = new URLSearchParams({
        status: tab, page: String(page), limit: String(LIMIT),
      });
      if (search) p.set("search", search);
      return apiFetch<CallbacksPage>(`${BASE}/api/campaigns/${campaignId}/callbacks?${p}`);
    },
    refetchInterval: 10000,
    placeholderData: prev => prev,
  });

  const handleSearch = useCallback((v: string) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => { setSearch(v); setPage(0); }, 400);
  }, []);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: metricsKey });
    qc.invalidateQueries({ queryKey: ["callbacks", campaignId] });
  };

  const completeMutation = useMutation({
    mutationFn: (callbackId: number) =>
      apiFetch(`${BASE}/api/campaigns/${campaignId}/callbacks/${callbackId}/complete`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Marked complete" }); invalidate(); },
    onError:   () => toast({ title: "Failed to complete", variant: "destructive" }),
  });

  const rescheduleMutation = useMutation({
    mutationFn: ({ callbackId, callbackAt }: { callbackId: number; callbackAt: string }) =>
      apiFetch(`${BASE}/api/campaigns/${campaignId}/callbacks/${callbackId}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callbackAt }),
      }),
    onSuccess: () => { toast({ title: "Rescheduled" }); setRescheduleId(null); invalidate(); },
    onError:   () => toast({ title: "Failed to reschedule", variant: "destructive" }),
  });

  const callNowMutation = useMutation({
    mutationFn: (leadId: number) =>
      apiFetch(`${BASE}/api/campaigns/${campaignId}/live-queue/bulk-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry", leadIds: [leadId] }),
      }),
    onSuccess: () => { toast({ title: "Lead re-queued for immediate call" }); invalidate(); },
    onError:   () => toast({ title: "Failed to queue call", variant: "destructive" }),
  });

  const bulkMutation = useMutation({
    mutationFn: ({ action, callbackAt }: { action: string; callbackAt?: string }) =>
      apiFetch<{ action: string; affected: number }>(`${BASE}/api/campaigns/${campaignId}/callbacks/bulk-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, callbackIds: Array.from(selectedIds), callbackAt }),
      }),
    onSuccess: (res) => {
      toast({ title: `${res.affected} callbacks ${res.action === "complete" ? "completed" : "rescheduled"}` });
      setSelectedIds(new Set());
      setBulkRescheduleOpen(false);
      invalidate();
    },
    onError: () => toast({ title: "Bulk action failed", variant: "destructive" }),
  });

  // ── Selection helpers ──────────────────────────────────────────────────────

  const items     = data?.items ?? [];
  const total     = data?.total ?? 0;
  const allSel    = items.length > 0 && items.every(i => selectedIds.has(i.id));
  const someSel   = items.some(i => selectedIds.has(i.id));
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const toggleOne = (id: number) =>
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleAll = () =>
    setSelectedIds(allSel ? new Set() : new Set(items.map(i => i.id)));

  // ── Export ─────────────────────────────────────────────────────────────────

  const handleExport = () => {
    const p = new URLSearchParams({ status: tab });
    window.open(`${BASE}/api/campaigns/${campaignId}/callbacks/export?${p}`);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const m = metrics;

  return (
    <div className="flex flex-col h-full">

      {/* ── Metrics strip ───────────────────────────────────────────────── */}
      <div className="flex items-stretch gap-2 px-6 pt-5 pb-3 flex-wrap">

        {/* Overdue — most urgent */}
        <button
          onClick={() => { setTab("overdue"); setPage(0); }}
          className={cn(
            "flex-1 min-w-[110px] rounded-lg border px-4 py-3 text-left transition-all",
            tab === "overdue"
              ? "border-red-500/50 bg-red-500/10 shadow-sm"
              : "border-border/40 bg-card hover:bg-muted/30",
          )}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="h-3 w-3 text-red-500" />
            <span className="text-[9px] uppercase tracking-widest font-semibold text-red-500">Overdue</span>
          </div>
          <p className={cn("text-xl font-bold tabular-nums", tab === "overdue" ? "text-red-500" : "text-foreground")}>
            {m?.overdue ?? "—"}
          </p>
        </button>

        {/* Due Now */}
        <button
          onClick={() => { setTab("due-now"); setPage(0); }}
          className={cn(
            "flex-1 min-w-[110px] rounded-lg border px-4 py-3 text-left transition-all",
            tab === "due-now"
              ? "border-amber-500/50 bg-amber-500/10 shadow-sm"
              : "border-border/40 bg-card hover:bg-muted/30",
          )}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Clock className="h-3 w-3 text-amber-500" />
            <span className="text-[9px] uppercase tracking-widest font-semibold text-amber-500">Due Now</span>
          </div>
          <p className={cn("text-xl font-bold tabular-nums", tab === "due-now" ? "text-amber-500" : "text-foreground")}>
            {m?.dueNow ?? "—"}
          </p>
        </button>

        {/* Due Today */}
        <button
          onClick={() => { setTab("due-today"); setPage(0); }}
          className={cn(
            "flex-1 min-w-[110px] rounded-lg border px-4 py-3 text-left transition-all",
            tab === "due-today"
              ? "border-sky-500/50 bg-sky-500/10 shadow-sm"
              : "border-border/40 bg-card hover:bg-muted/30",
          )}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <CalendarCheck className="h-3 w-3 text-sky-500" />
            <span className="text-[9px] uppercase tracking-widest font-semibold text-sky-500">Due Today</span>
          </div>
          <p className={cn("text-xl font-bold tabular-nums", tab === "due-today" ? "text-sky-500" : "text-foreground")}>
            {m?.dueToday ?? "—"}
          </p>
        </button>

        {/* Completed */}
        <button
          onClick={() => { setTab("completed"); setPage(0); }}
          className={cn(
            "flex-1 min-w-[110px] rounded-lg border px-4 py-3 text-left transition-all",
            tab === "completed"
              ? "border-emerald-500/50 bg-emerald-500/10 shadow-sm"
              : "border-border/40 bg-card hover:bg-muted/30",
          )}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            <span className="text-[9px] uppercase tracking-widest font-semibold text-emerald-500">Completed</span>
          </div>
          <p className={cn("text-xl font-bold tabular-nums", tab === "completed" ? "text-emerald-500" : "text-foreground")}>
            {m?.completed ?? "—"}
          </p>
        </button>

        {/* Pending (total) */}
        <button
          onClick={() => { setTab("pending"); setPage(0); }}
          className={cn(
            "flex-1 min-w-[110px] rounded-lg border px-4 py-3 text-left transition-all",
            tab === "pending"
              ? "border-purple-500/50 bg-purple-500/10 shadow-sm"
              : "border-border/40 bg-card hover:bg-muted/30",
          )}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Phone className="h-3 w-3 text-purple-500" />
            <span className="text-[9px] uppercase tracking-widest font-semibold text-purple-500">Pending</span>
          </div>
          <p className={cn("text-xl font-bold tabular-nums", tab === "pending" ? "text-purple-500" : "text-foreground")}>
            {m?.pending ?? "—"}
          </p>
        </button>

      </div>

      {/* ── Sub-tab bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 px-6 pb-2 border-b border-border/30 overflow-x-auto">
        {SUB_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setPage(0); setSelectedIds(new Set()); }}
            className={cn(
              "px-3 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap",
              tab === t.key
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
            )}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 pl-4">
          <div className="relative">
            <input
              ref={searchInput}
              type="text"
              placeholder="Search lead or phone…"
              className="h-7 w-52 rounded border border-border/40 bg-muted/30 px-2.5 text-xs placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring/30"
              onChange={e => handleSearch(e.target.value)}
            />
          </div>
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={handleExport}>
            <Download className="h-3 w-3" /> Export
          </Button>
          <Button
            size="sm" variant="ghost"
            className={cn("h-7 gap-1.5 text-xs", isFetching && "opacity-60")}
            onClick={() => qc.invalidateQueries({ queryKey: listKey })}
          >
            <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* ── Bulk action bar ───────────────────────────────────────────────── */}
      {someSel && (
        <div className="flex items-center gap-3 px-6 py-2 bg-foreground/[0.03] border-b border-border/30">
          <span className="text-xs text-muted-foreground">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2 ml-auto">
            <Button
              size="sm" variant="outline"
              className="h-7 gap-1.5 text-xs border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10"
              onClick={() => bulkMutation.mutate({ action: "complete" })}
              disabled={bulkMutation.isPending}
            >
              <CheckCircle2 className="h-3 w-3" /> Complete
            </Button>
            <Button
              size="sm" variant="outline"
              className="h-7 gap-1.5 text-xs border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
              onClick={() => setBulkRescheduleOpen(true)}
            >
              <Calendar className="h-3 w-3" /> Reschedule
            </Button>
            <Button
              size="sm" variant="ghost"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <Phone className="h-8 w-8 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground/50">
              {tab === "completed" ? "No completed callbacks yet" : "No callbacks in this view"}
            </p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/30">
              <tr>
                <th className="pl-4 pr-2 py-2 w-8">
                  <Checkbox
                    checked={allSel}
                    onCheckedChange={toggleAll}
                    className="h-3.5 w-3.5"
                  />
                </th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Lead</th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden sm:table-cell">Scheduled For</th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">SLA</th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden md:table-cell">Reason</th>
                <th className="px-3 py-2 text-center text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider w-14">Att.</th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden lg:table-cell">Disposition</th>
                <th className="px-3 py-2 text-right text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider w-28">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {items.map(cb => {
                const sel  = selectedIds.has(cb.id);
                const sla  = SLA_CFG[cb.slaStatus ?? ""] ?? null;
                const dispColor = DISPOSITION_COLORS[cb.lead.disposition ?? ""] ?? "text-muted-foreground/60";

                return (
                  <tr
                    key={cb.id}
                    className={cn(
                      "hover:bg-muted/20 transition-colors",
                      sel && "bg-foreground/[0.03]",
                      cb.slaStatus === "overdue" && !sel && "bg-red-500/[0.03]",
                    )}
                  >
                    <td
                      className="pl-4 pr-2 py-2.5"
                      onClick={e => { e.stopPropagation(); toggleOne(cb.id); }}
                    >
                      <Checkbox checked={sel} onCheckedChange={() => toggleOne(cb.id)} className="h-3.5 w-3.5" />
                    </td>

                    {/* Lead */}
                    <td className="px-3 py-2.5">
                      <p className="font-medium truncate max-w-[130px]">{cb.lead.name ?? "—"}</p>
                      <p className="text-[10px] font-mono text-muted-foreground/60">{cb.lead.phone}</p>
                    </td>

                    {/* Scheduled For */}
                    <td className="px-3 py-2.5 hidden sm:table-cell">
                      <p className="text-muted-foreground/80">{fmtDateTime(cb.callbackAt)}</p>
                      {cb.callbackAt && (
                        <p className="text-[10px] text-muted-foreground/40">{fmtRelative(cb.callbackAt)}</p>
                      )}
                    </td>

                    {/* SLA */}
                    <td className="px-3 py-2.5">
                      {sla ? (
                        <div>
                          <span className={cn(
                            "inline-flex text-[10px] font-semibold px-2 py-0.5 rounded border",
                            sla.cls,
                          )}>
                            {sla.label}
                          </span>
                          {cb.responseDueBy && (
                            <p className="text-[9px] text-muted-foreground/40 mt-0.5">{fmtRelative(cb.responseDueBy)}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>

                    {/* Reason */}
                    <td className="px-3 py-2.5 hidden md:table-cell">
                      <span className="text-muted-foreground/70 max-w-[160px] truncate block">
                        {cb.reason ?? "—"}
                      </span>
                    </td>

                    {/* Attempts */}
                    <td className="px-3 py-2.5 text-center">
                      <span className="tabular-nums text-muted-foreground/60">{cb.lead.callAttempts}</span>
                    </td>

                    {/* Disposition */}
                    <td className="px-3 py-2.5 hidden lg:table-cell">
                      <span className={cn("capitalize", dispColor)}>
                        {cb.lead.disposition?.replace(/_/g, " ") ?? "—"}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {/* Call Now — re-queues the lead */}
                        {cb.status === "pending" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-emerald-600 hover:bg-emerald-500/10"
                            title="Call Now"
                            onClick={e => { e.stopPropagation(); callNowMutation.mutate(cb.leadId); }}
                          >
                            <Phone className="h-3 w-3" />
                          </Button>
                        )}
                        {/* Reschedule */}
                        {cb.status === "pending" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-amber-600 hover:bg-amber-500/10"
                            title="Reschedule"
                            onClick={e => {
                              e.stopPropagation();
                              setRescheduleId(cb.id);
                              setRescheduleLeadName(cb.lead.name ?? cb.lead.phone);
                              const dt = cb.callbackAt
                                ? new Date(cb.callbackAt).toISOString().slice(0, 16)
                                : new Date(Date.now() + 3600_000).toISOString().slice(0, 16);
                              setRescheduleDate(dt);
                            }}
                          >
                            <Calendar className="h-3 w-3" />
                          </Button>
                        )}
                        {/* Complete */}
                        {cb.status === "pending" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-sky-600 hover:bg-sky-500/10"
                            title="Mark Complete"
                            onClick={e => { e.stopPropagation(); completeMutation.mutate(cb.id); }}
                          >
                            <CheckCircle2 className="h-3 w-3" />
                          </Button>
                        )}
                        {cb.status === "completed" && (
                          <span className="text-[10px] text-emerald-500/70 flex items-center gap-0.5">
                            <CheckCircle2 className="h-3 w-3" /> Done
                          </span>
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

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      {total > LIMIT && (
        <div className="flex items-center justify-between px-6 py-2.5 border-t border-border/30 text-xs text-muted-foreground/60">
          <span>
            {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-6 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
            <span className="px-2">{page + 1} / {totalPages}</span>
            <Button size="sm" variant="ghost" className="h-6 text-xs" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      {/* ── Reschedule (single) dialog ───────────────────────────────────── */}
      <Dialog open={rescheduleId !== null} onOpenChange={open => !open && setRescheduleId(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Reschedule Callback</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-xs text-muted-foreground mb-3">{rescheduleLeadName}</p>
            <Label className="text-xs">New callback time</Label>
            <Input
              type="datetime-local"
              className="mt-1.5 text-xs h-8"
              value={rescheduleDate}
              onChange={e => setRescheduleDate(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setRescheduleId(null)}>Cancel</Button>
            <Button
              size="sm"
              disabled={!rescheduleDate || rescheduleMutation.isPending}
              onClick={() => rescheduleId && rescheduleMutation.mutate({
                callbackId: rescheduleId,
                callbackAt: new Date(rescheduleDate).toISOString(),
              })}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk reschedule dialog ───────────────────────────────────────── */}
      <Dialog open={bulkRescheduleOpen} onOpenChange={setBulkRescheduleOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Reschedule {selectedIds.size} Callbacks</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-xs">New callback time for all selected</Label>
            <Input
              type="datetime-local"
              className="mt-1.5 text-xs h-8"
              value={bulkRescheduleDate}
              onChange={e => setBulkRescheduleDate(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setBulkRescheduleOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={!bulkRescheduleDate || bulkMutation.isPending}
              onClick={() => bulkMutation.mutate({
                action: "reschedule",
                callbackAt: new Date(bulkRescheduleDate).toISOString(),
              })}
            >
              Reschedule All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
