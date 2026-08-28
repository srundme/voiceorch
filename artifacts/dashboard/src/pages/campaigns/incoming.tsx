/**
 * IncomingCallsTab — Phase 3C
 * "Who called us back?" — tracks inbound calls matched to this campaign.
 * incoming_call_status is separate from disposition: different concepts.
 */

import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  PhoneIncoming, Eye, CheckCircle2, Phone, Download,
  RefreshCw, Calendar, ExternalLink, Clock, CalendarDays,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

// ── Types ─────────────────────────────────────────────────────────────────────

type IncomingMetrics = {
  unreviewed: number;
  today:      number;
  thisWeek:   number;
  completed:  number;
  total:      number;
};

type IncomingLeadInfo = {
  name:        string | null;
  callAttempts: number;
  disposition: string | null;
} | null;

type IncomingCallItem = {
  id:                 number;
  phone:              string;
  leadId:             number | null;
  callId:             number | null;
  incomingCallStatus: string;
  incomingCallReason: string | null;
  receivedAt:         string;
  matchedAt:          string | null;
  durationSeconds:    number | null;
  detectedIntent:     string | null;
  lead:               IncomingLeadInfo;
};

type IncomingCallsPage = {
  items: IncomingCallItem[];
  total: number;
  page:  number;
  limit: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────


function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtDuration(s: number | null): string {
  if (s === null || s === undefined) return "—";
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs  = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d ago`;
  if (hrs  > 0) return `${hrs}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return "just now";
}

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  unreviewed: { label: "Unreviewed", cls: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  reviewed:   { label: "Reviewed",   cls: "bg-sky-500/10 text-sky-600 border-sky-500/30"      },
  actioned:   { label: "Actioned",   cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
};

const DISPOSITION_COLORS: Record<string, string> = {
  interested:      "text-emerald-500",
  not_interested:  "text-red-400",
  callback:        "text-amber-500",
  do_not_call:     "text-red-600",
};

const SUB_TABS = [
  { key: "all",        label: "All"        },
  { key: "unreviewed", label: "Unreviewed" },
  { key: "reviewed",   label: "Reviewed"   },
  { key: "actioned",   label: "Actioned"   },
  { key: "completed",  label: "Completed"  },
] as const;

// ── Component ─────────────────────────────────────────────────────────────────

export default function IncomingCallsTab({ campaignId }: { campaignId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

  const [tab,          setTab]          = useState<string>("unreviewed");
  const [search,       setSearch]       = useState("");
  const [page,         setPage]         = useState(0);
  const [selectedIds,  setSelectedIds]  = useState<Set<number>>(new Set());
  const [callbackItem, setCallbackItem] = useState<IncomingCallItem | null>(null);
  const [callbackDate, setCallbackDate] = useState<string>("");
  const [callbackNote, setCallbackNote] = useState<string>("");

  const LIMIT = 50;
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const metricsKey = ["incoming-metrics", campaignId];
  const listKey    = ["incoming", campaignId, tab, search, page];

  const { data: metrics } = useQuery<IncomingMetrics>({
    queryKey: metricsKey,
    queryFn:  () => customFetch(`${BASE}/api/campaigns/${campaignId}/incoming/metrics`),
    refetchInterval: 10000,
    enabled: campaignId > 0,
  });

  const { data, isFetching, isError, isLoading, refetch } = useQuery<IncomingCallsPage>({
    queryKey: listKey,
    queryFn: () => {
      const p = new URLSearchParams({ status: tab, page: String(page), limit: String(LIMIT) });
      if (search) p.set("search", search);
      return customFetch<IncomingCallsPage>(`${BASE}/api/campaigns/${campaignId}/incoming?${p}`);
    },
    refetchInterval: 10000,
    placeholderData: prev => prev,
    enabled: campaignId > 0,
  });

  const handleSearch = useCallback((v: string) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => { setSearch(v); setPage(0); }, 400);
  }, []);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: metricsKey });
    qc.invalidateQueries({ queryKey: ["incoming", campaignId] });
    qc.invalidateQueries({ queryKey: ["callback-metrics", campaignId] });
    qc.invalidateQueries({ queryKey: ["callbacks", campaignId] });
    qc.invalidateQueries({ queryKey: ["lq-metrics", campaignId] });
    qc.invalidateQueries({ queryKey: [`/api/campaigns/${campaignId}/analytics`] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ incomingId, status }: { incomingId: number; status: string }) =>
      customFetch(`${BASE}/api/campaigns/${campaignId}/incoming/${incomingId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }),
    onSuccess: (_, v) => {
      toast({ title: `Marked ${v.status}` });
      invalidate();
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const createCallbackMutation = useMutation({
    mutationFn: ({ incomingId, callbackAt, reason }: { incomingId: number; callbackAt: string; reason: string }) =>
      customFetch(`${BASE}/api/campaigns/${campaignId}/incoming/${incomingId}/create-callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callbackAt, reason }),
      }),
    onSuccess: () => {
      toast({ title: "Callback created — appears in the Callbacks tab" });
      setCallbackItem(null);
      invalidate();
    },
    onError: () => toast({ title: "Failed to create callback", variant: "destructive" }),
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

  // ── Bulk mark reviewed ─────────────────────────────────────────────────────

  const bulkMarkReviewed = async () => {
    const ids = Array.from(selectedIds);
    let ok = 0;
    let failed = 0;
    // Sequential to avoid N parallel PATCHes thundering the API (no bulk endpoint yet).
    for (const id of ids) {
      try {
        await customFetch(
          `${BASE}/api/campaigns/${campaignId}/incoming/${id}/status`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "reviewed" }),
          },
        );
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    if (ok > 0) {
      toast({ title: `${ok} marked reviewed${failed ? ` (${failed} failed)` : ""}` });
      setSelectedIds(new Set());
      invalidate();
    } else {
      toast({ title: "Mark reviewed failed", variant: "destructive" });
    }
  };

  // ── Export ─────────────────────────────────────────────────────────────────

  const handleExport = () => {
    const p = new URLSearchParams({ status: tab });
    window.open(`${BASE}/api/campaigns/${campaignId}/incoming/export?${p}`);
  };

  const m = metrics;

  return (
    <div className="flex flex-col h-full">

      {/* ── Metrics strip ───────────────────────────────────────────────── */}
      <div className="flex items-stretch gap-2 px-6 pt-5 pb-3 flex-wrap">

        {/* Unreviewed */}
        <button
          onClick={() => { setTab("unreviewed"); setPage(0); }}
          className={cn(
            "flex-1 min-w-[110px] rounded-lg border px-4 py-3 text-left transition-all",
            tab === "unreviewed"
              ? "border-amber-500/50 bg-amber-500/10 shadow-sm"
              : "border-border/40 bg-card hover:bg-muted/30",
          )}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <AlertCircle className="h-3 w-3 text-amber-500" />
            <span className="text-[9px] uppercase tracking-widest font-semibold text-amber-500">Unreviewed</span>
          </div>
          <p className={cn("text-xl font-bold tabular-nums", tab === "unreviewed" ? "text-amber-500" : "text-foreground")}>
            {m?.unreviewed ?? "—"}
          </p>
        </button>

        {/* Today */}
        <div
          className={cn(
            "flex-1 min-w-[110px] rounded-lg border px-4 py-3 text-left",
            "border-border/40 bg-card",
          )}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Clock className="h-3 w-3 text-sky-500" />
            <span className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground/50">Today</span>
          </div>
          <p className="text-xl font-bold tabular-nums text-foreground">{m?.today ?? "—"}</p>
        </div>

        {/* This Week */}
        <div
          className={cn(
            "flex-1 min-w-[110px] rounded-lg border px-4 py-3 text-left",
            "border-border/40 bg-card",
          )}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <CalendarDays className="h-3 w-3 text-violet-500" />
            <span className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground/50">This Week</span>
          </div>
          <p className="text-xl font-bold tabular-nums text-foreground">{m?.thisWeek ?? "—"}</p>
        </div>

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

        {/* Total */}
        <div className="flex-1 min-w-[110px] rounded-lg border px-4 py-3 border-border/40 bg-card">
          <div className="flex items-center gap-1.5 mb-1">
            <PhoneIncoming className="h-3 w-3 text-muted-foreground/40" />
            <span className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground/40">Total</span>
          </div>
          <p className="text-xl font-bold tabular-nums text-foreground">{m?.total ?? "—"}</p>
        </div>

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
          <input
            type="text"
            placeholder="Search lead or phone…"
            className="h-7 w-52 rounded border border-border/40 bg-muted/30 px-2.5 text-xs placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring/30"
            onChange={e => handleSearch(e.target.value)}
          />
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={handleExport}>
            <Download className="h-3 w-3" /> Export
          </Button>
          <Button
            size="sm" variant="ghost"
            className={cn("h-7 gap-1.5 text-xs", isFetching && "opacity-60")}
            onClick={invalidate}
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
              className="h-7 gap-1.5 text-xs border-sky-500/30 text-sky-600 hover:bg-sky-500/10"
              onClick={bulkMarkReviewed}
            >
              <Eye className="h-3 w-3" /> Mark Reviewed
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
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <p className="text-sm text-muted-foreground/50">Loading incoming calls…</p>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <AlertCircle className="h-8 w-8 text-amber-600" />
            <p className="text-sm font-medium">Incoming calls failed to load</p>
            <p className="text-xs text-muted-foreground">This is not an empty list — retry or check your session.</p>
            <Button size="sm" variant="outline" disabled={isFetching} onClick={() => void refetch()}>Retry</Button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <PhoneIncoming className="h-8 w-8 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground/50">
              {tab === "unreviewed" ? "No unreviewed incoming calls" : "No calls in this view"}
            </p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/30">
              <tr>
                <th className="pl-4 pr-2 py-2 w-8">
                  <Checkbox checked={allSel} onCheckedChange={toggleAll} className="h-3.5 w-3.5" />
                </th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Lead / Phone</th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden sm:table-cell">Duration</th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden md:table-cell">Disposition</th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden lg:table-cell">Reason / Intent</th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Received</th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Status</th>
                <th className="px-3 py-2 text-right text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider w-32">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {items.map(item => {
                const sel    = selectedIds.has(item.id);
                const sc     = STATUS_CFG[item.incomingCallStatus];
                const dispColor = DISPOSITION_COLORS[item.lead?.disposition ?? ""] ?? "text-muted-foreground/60";

                return (
                  <tr
                    key={item.id}
                    className={cn(
                      "hover:bg-muted/20 transition-colors",
                      sel && "bg-foreground/[0.03]",
                      item.incomingCallStatus === "unreviewed" && !sel && "bg-amber-500/[0.02]",
                    )}
                  >
                    <td className="pl-4 pr-2 py-2.5" onClick={e => { e.stopPropagation(); toggleOne(item.id); }}>
                      <Checkbox checked={sel} onCheckedChange={() => toggleOne(item.id)} className="h-3.5 w-3.5" />
                    </td>

                    {/* Lead / Phone */}
                    <td className="px-3 py-2.5">
                      {item.lead?.name
                        ? <p className="font-medium truncate max-w-[130px]">{item.lead.name}</p>
                        : <p className="text-muted-foreground/50 italic text-[10px]">Unknown caller</p>
                      }
                      <p className="text-[10px] font-mono text-muted-foreground/60">{item.phone}</p>
                    </td>

                    {/* Duration */}
                    <td className="px-3 py-2.5 hidden sm:table-cell">
                      <span className="text-muted-foreground/70 tabular-nums">{fmtDuration(item.durationSeconds)}</span>
                    </td>

                    {/* Disposition */}
                    <td className="px-3 py-2.5 hidden md:table-cell">
                      <span className={cn("capitalize", dispColor)}>
                        {item.lead?.disposition?.replace(/_/g, " ") ?? "—"}
                      </span>
                    </td>

                    {/* Reason / Intent */}
                    <td className="px-3 py-2.5 hidden lg:table-cell">
                      {item.incomingCallReason ? (
                        <span className="text-foreground/80 max-w-[180px] truncate block">
                          {item.incomingCallReason}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/70 max-w-[180px] truncate block">
                          {item.detectedIntent ?? "—"}
                        </span>
                      )}
                    </td>

                    {/* Received At */}
                    <td className="px-3 py-2.5">
                      <p className="text-muted-foreground/80">{fmtDateTime(item.receivedAt)}</p>
                      <p className="text-[10px] text-muted-foreground/40">{fmtRelative(item.receivedAt)}</p>
                    </td>

                    {/* Status */}
                    <td className="px-3 py-2.5">
                      <span className={cn(
                        "inline-flex text-[10px] font-semibold px-2 py-0.5 rounded border",
                        sc?.cls ?? "bg-muted/50 text-muted-foreground border-border",
                      )}>
                        {sc?.label ?? item.incomingCallStatus}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">

                        {/* Mark Reviewed */}
                        {item.incomingCallStatus === "unreviewed" && (
                          <Button
                            size="icon" variant="ghost"
                            className="h-6 w-6 text-sky-600 hover:bg-sky-500/10"
                            title="Mark Reviewed"
                            onClick={e => { e.stopPropagation(); statusMutation.mutate({ incomingId: item.id, status: "reviewed" }); }}
                          >
                            <Eye className="h-3 w-3" />
                          </Button>
                        )}

                        {/* Mark Actioned */}
                        {item.incomingCallStatus === "reviewed" && (
                          <Button
                            size="icon" variant="ghost"
                            className="h-6 w-6 text-emerald-600 hover:bg-emerald-500/10"
                            title="Mark Actioned"
                            onClick={e => { e.stopPropagation(); statusMutation.mutate({ incomingId: item.id, status: "actioned" }); }}
                          >
                            <CheckCircle2 className="h-3 w-3" />
                          </Button>
                        )}

                        {/* Create Callback */}
                        {item.leadId && item.incomingCallStatus !== "actioned" && (
                          <Button
                            size="icon" variant="ghost"
                            className="h-6 w-6 text-purple-600 hover:bg-purple-500/10"
                            title="Create Callback"
                            onClick={e => {
                              e.stopPropagation();
                              setCallbackItem(item);
                              setCallbackDate(new Date(Date.now() + 3600_000).toISOString().slice(0, 16));
                              setCallbackNote(item.detectedIntent ?? "");
                            }}
                          >
                            <Calendar className="h-3 w-3" />
                          </Button>
                        )}

                        {/* Open Lead */}
                        {item.leadId && (
                          <Button
                            size="icon" variant="ghost"
                            className="h-6 w-6 text-muted-foreground/60 hover:text-foreground hover:bg-muted/40"
                            title="Open Lead"
                            onClick={e => {
                              e.stopPropagation();
                              navigate(`/app/campaigns/${campaignId}/leads/${item.leadId}`);
                            }}
                          >
                            <ExternalLink className="h-3 w-3" />
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

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      {total > LIMIT && (
        <div className="flex items-center justify-between px-6 py-2.5 border-t border-border/30 text-xs text-muted-foreground/60">
          <span>{page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total.toLocaleString()}</span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-6 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
            <span className="px-2">{page + 1} / {totalPages}</span>
            <Button size="sm" variant="ghost" className="h-6 text-xs" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      {/* ── Create Callback dialog ───────────────────────────────────────── */}
      <Dialog open={callbackItem !== null} onOpenChange={open => !open && setCallbackItem(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Create Callback</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-xs text-muted-foreground">
              {callbackItem?.lead?.name ?? callbackItem?.phone}
            </p>
            <div>
              <Label className="text-xs">Callback time</Label>
              <Input
                type="datetime-local"
                className="mt-1.5 text-xs h-8"
                value={callbackDate}
                onChange={e => setCallbackDate(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Note / reason</Label>
              <Input
                className="mt-1.5 text-xs h-8"
                placeholder="e.g. Incoming call follow-up"
                value={callbackNote}
                onChange={e => setCallbackNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setCallbackItem(null)}>Cancel</Button>
            <Button
              size="sm"
              disabled={!callbackDate || createCallbackMutation.isPending}
              onClick={() => callbackItem && createCallbackMutation.mutate({
                incomingId: callbackItem.id,
                callbackAt: new Date(callbackDate).toISOString(),
                reason:     callbackNote || "Incoming call follow-up",
              })}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
