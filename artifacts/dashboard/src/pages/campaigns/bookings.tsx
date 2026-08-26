/**
 * BookingsTab — Phase 3D
 * "Which appointments were created?" — campaign-scoped view into the
 * scheduling module. Does not duplicate booking logic — reads through
 * call_bookings (bridge) → scheduling bookings → event_types.
 */

import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays, CheckCircle2, XCircle, Clock, Download,
  RefreshCw, ExternalLink, Calendar, ArrowRightLeft, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

// ── Types ─────────────────────────────────────────────────────────────────────

type BookingMetrics = {
  today:     number;
  upcoming:  number;
  completed: number;
  cancelled: number;
  total:     number;
};

type BookingItem = {
  id:                  number;
  leadId:              number;
  callId:              number | null;
  batchId:             number | null;
  schedulingBookingId: number | null;
  meetingTime:         string | null;
  slotEnd:             string | null;
  meetLink:            string | null;
  status:              string;
  bookedBy:            string | null;
  notes:               string | null;
  createdAt:           string;
  eventType:           { name: string; durationMins: number } | null;
  lead:                { name: string | null; phone: string | null };
  batchName:           string | null;
};

type BookingsPage = {
  items: BookingItem[];
  total: number;
  page:  number;
  limit: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: "include", ...init });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "";
  const diff = new Date(iso).getTime() - Date.now();
  const absDiff = Math.abs(diff);
  const mins = Math.floor(absDiff / 60000);
  const hrs  = Math.floor(absDiff / 3600000);
  const days = Math.floor(absDiff / 86400000);
  const suffix = diff > 0 ? "from now" : "ago";
  if (days > 0) return `${days}d ${suffix}`;
  if (hrs  > 0) return `${hrs}h ${suffix}`;
  if (mins > 0) return `${mins}m ${suffix}`;
  return diff > 0 ? "imminent" : "just passed";
}

const MONO_STATUS = "bg-muted text-foreground border-border";
const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  pending:     { label: "Upcoming",    cls: MONO_STATUS },
  scheduled:   { label: "Upcoming",    cls: MONO_STATUS },
  confirmed:   { label: "Confirmed",   cls: MONO_STATUS },
  completed:   { label: "Completed",   cls: MONO_STATUS },
  cancelled:   { label: "Cancelled",   cls: MONO_STATUS },
  canceled:    { label: "Cancelled",   cls: MONO_STATUS },
  rescheduled: { label: "Rescheduled", cls: MONO_STATUS },
};

const SUB_TABS = [
  { key: "all",       label: "All"       },
  { key: "upcoming",  label: "Upcoming"  },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
] as const;

// ── Component ─────────────────────────────────────────────────────────────────

export default function BookingsTab({ campaignId }: { campaignId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

  const [tab,            setTab]            = useState<string>("all");
  const [search,         setSearch]         = useState("");
  const [page,           setPage]           = useState(0);
  const [rescheduleItem, setRescheduleItem] = useState<BookingItem | null>(null);
  const [rescheduleTime, setRescheduleTime] = useState("");

  const LIMIT = 50;
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const metricsKey = ["bookings-metrics", campaignId];
  const listKey    = ["bookings", campaignId, tab, search, page];

  const { data: metrics } = useQuery<BookingMetrics>({
    queryKey: metricsKey,
    queryFn:  () => apiFetch(`${BASE}/api/campaigns/${campaignId}/bookings/metrics`),
    refetchInterval: 15000,
  });

  const { data, isFetching } = useQuery<BookingsPage>({
    queryKey: listKey,
    queryFn: () => {
      const p = new URLSearchParams({ status: tab, page: String(page), limit: String(LIMIT) });
      if (search) p.set("search", search);
      return apiFetch<BookingsPage>(`${BASE}/api/campaigns/${campaignId}/bookings?${p}`);
    },
    refetchInterval: 15000,
    placeholderData: prev => prev,
  });

  const handleSearch = useCallback((v: string) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => { setSearch(v); setPage(0); }, 400);
  }, []);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: metricsKey });
    qc.invalidateQueries({ queryKey: ["bookings", campaignId] });
    qc.invalidateQueries({ queryKey: ["lq-metrics", campaignId] });
    qc.invalidateQueries({ queryKey: ["lq-leads", campaignId] });
    qc.invalidateQueries({ queryKey: [`/api/campaigns/${campaignId}/analytics`] });
  };

  // ── Mutations ──────────────────────────────────────────────────────────────

  const cancelMutation = useMutation({
    mutationFn: (bookingId: number) =>
      apiFetch(`${BASE}/api/campaigns/${campaignId}/bookings/${bookingId}/cancel`, { method: "PATCH" }),
    onSuccess: () => { toast({ title: "Booking cancelled" }); invalidate(); },
    onError: () => toast({ title: "Failed to cancel", variant: "destructive" }),
  });

  const rescheduleMutation = useMutation({
    mutationFn: ({ bookingId, newTime }: { bookingId: number; newTime: string }) =>
      apiFetch(`${BASE}/api/campaigns/${campaignId}/bookings/${bookingId}/reschedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newTime }),
      }),
    onSuccess: () => {
      toast({ title: "Booking rescheduled" });
      setRescheduleItem(null);
      invalidate();
    },
    onError: () => toast({ title: "Failed to reschedule", variant: "destructive" }),
  });

  const handleExport = () => window.open(`${BASE}/api/campaigns/${campaignId}/bookings/export`);

  const items      = data?.items ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const m          = metrics;

  return (
    <div className="flex flex-col h-full">

      {/* ── Metrics strip ───────────────────────────────────────────────── */}
      <div className="flex items-stretch gap-2 px-6 pt-5 pb-3 flex-wrap">

        {/* Today */}
        <div
          className="flex-1 min-w-[100px] rounded-lg border px-4 py-3 text-left border-border/40 bg-card"
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Clock className="h-3 w-3 text-muted-foreground" />
            <span className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground">Today</span>
          </div>
          <p className="text-xl font-bold tabular-nums">{m?.today ?? "—"}</p>
        </div>

        {/* Upcoming */}
        <button
          onClick={() => { setTab("upcoming"); setPage(0); }}
          className={cn(
            "flex-1 min-w-[100px] rounded-lg border px-4 py-3 text-left transition-all",
            tab === "upcoming"
              ? "border-foreground/30 bg-muted shadow-sm"
              : "border-border/40 bg-card hover:bg-muted/30",
          )}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <CalendarDays className="h-3 w-3 text-muted-foreground" />
            <span className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground">Upcoming</span>
          </div>
          <p className="text-xl font-bold tabular-nums">
            {m?.upcoming ?? "—"}
          </p>
        </button>

        {/* Completed */}
        <button
          onClick={() => { setTab("completed"); setPage(0); }}
          className={cn(
            "flex-1 min-w-[100px] rounded-lg border px-4 py-3 text-left transition-all",
            tab === "completed"
              ? "border-foreground/30 bg-muted shadow-sm"
              : "border-border/40 bg-card hover:bg-muted/30",
          )}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <CheckCircle2 className="h-3 w-3 text-muted-foreground" />
            <span className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground">Completed</span>
          </div>
          <p className="text-xl font-bold tabular-nums">
            {m?.completed ?? "—"}
          </p>
        </button>

        {/* Cancelled */}
        <button
          onClick={() => { setTab("cancelled"); setPage(0); }}
          className={cn(
            "flex-1 min-w-[100px] rounded-lg border px-4 py-3 text-left transition-all",
            tab === "cancelled"
              ? "border-foreground/30 bg-muted shadow-sm"
              : "border-border/40 bg-card hover:bg-muted/30",
          )}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <XCircle className="h-3 w-3 text-muted-foreground" />
            <span className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground">Cancelled</span>
          </div>
          <p className="text-xl font-bold tabular-nums">
            {m?.cancelled ?? "—"}
          </p>
        </button>

        {/* Total */}
        <div className="flex-1 min-w-[100px] rounded-lg border px-4 py-3 border-border/40 bg-card">
          <div className="flex items-center gap-1.5 mb-1">
            <CalendarDays className="h-3 w-3 text-muted-foreground/40" />
            <span className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground/40">Total</span>
          </div>
          <p className="text-xl font-bold tabular-nums">{m?.total ?? "—"}</p>
        </div>

      </div>

      {/* ── Sub-tab bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 px-6 pb-2 border-b border-border/30 overflow-x-auto">
        {SUB_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setPage(0); }}
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

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <CalendarDays className="h-8 w-8 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground/50">
              {tab === "upcoming" ? "No upcoming bookings" : "No bookings in this view"}
            </p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/30">
              <tr>
                <th className="px-4 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Lead</th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Meeting Time</th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden md:table-cell">Type</th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden lg:table-cell">Meet Link</th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden lg:table-cell">Booked By</th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Status</th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden xl:table-cell">Batch</th>
                <th className="px-3 py-2 text-right text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider w-28">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {items.map(item => {
                const sc = STATUS_CFG[item.status] ?? { label: item.status, cls: "bg-muted/50 text-muted-foreground border-border" };
                const isUpcoming  = ["pending", "scheduled", "confirmed"].includes(item.status);
                const isCancelled = ["cancelled", "canceled"].includes(item.status);

                return (
                  <tr
                    key={item.id}
                    className={cn(
                      "hover:bg-muted/20 transition-colors",
                      isUpcoming  && "bg-sky-500/[0.015]",
                      isCancelled && "opacity-60",
                    )}
                  >
                    {/* Lead */}
                    <td className="px-4 py-2.5">
                      {item.lead.name
                        ? <p className="font-medium truncate max-w-[130px]">{item.lead.name}</p>
                        : <p className="text-muted-foreground/50 italic text-[10px]">Unknown</p>
                      }
                      <p className="text-[10px] font-mono text-muted-foreground/60">{item.lead.phone ?? "—"}</p>
                    </td>

                    {/* Meeting Time */}
                    <td className="px-3 py-2.5">
                      <p className={cn(isUpcoming ? "text-foreground font-medium" : "text-muted-foreground/80")}>
                        {fmtDateTime(item.meetingTime)}
                      </p>
                      {item.meetingTime && (
                        <p className={cn("text-[10px]", isUpcoming ? "text-violet-500" : "text-muted-foreground/40")}>
                          {fmtRelative(item.meetingTime)}
                        </p>
                      )}
                    </td>

                    {/* Type / Duration */}
                    <td className="px-3 py-2.5 hidden md:table-cell">
                      {item.eventType ? (
                        <>
                          <p className="truncate max-w-[120px]">{item.eventType.name}</p>
                          <p className="text-[10px] text-muted-foreground/50">{item.eventType.durationMins}min</p>
                        </>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>

                    {/* Meet Link */}
                    <td className="px-3 py-2.5 hidden lg:table-cell">
                      {item.meetLink ? (
                        <a
                          href={item.meetLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-sky-500 hover:text-sky-400 truncate max-w-[120px]"
                        >
                          <ExternalLink className="h-2.5 w-2.5 flex-shrink-0" />
                          <span className="truncate">Join</span>
                        </a>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>

                    {/* Booked By */}
                    <td className="px-3 py-2.5 hidden lg:table-cell">
                      <span className="text-muted-foreground/70 truncate max-w-[100px] block">
                        {item.bookedBy ?? "—"}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-3 py-2.5">
                      <span className={cn(
                        "inline-flex text-[10px] font-semibold px-2 py-0.5 rounded border",
                        sc.cls,
                      )}>
                        {sc.label}
                      </span>
                    </td>

                    {/* Batch */}
                    <td className="px-3 py-2.5 hidden xl:table-cell">
                      <span className="text-muted-foreground/50 truncate max-w-[80px] block">
                        {item.batchName ?? "—"}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">

                        {/* Open Meeting */}
                        {item.meetLink && !isCancelled && (
                          <Button
                            size="icon" variant="ghost"
                            className="h-6 w-6 text-sky-600 hover:bg-sky-500/10"
                            title="Open Meeting"
                            onClick={e => { e.stopPropagation(); window.open(item.meetLink!, "_blank"); }}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        )}

                        {/* Reschedule */}
                        {!isCancelled && item.status !== "completed" && (
                          <Button
                            size="icon" variant="ghost"
                            className="h-6 w-6 text-amber-600 hover:bg-amber-500/10"
                            title="Reschedule"
                            onClick={e => {
                              e.stopPropagation();
                              setRescheduleItem(item);
                              setRescheduleTime(
                                item.meetingTime
                                  ? new Date(item.meetingTime).toISOString().slice(0, 16)
                                  : new Date(Date.now() + 3600_000).toISOString().slice(0, 16)
                              );
                            }}
                          >
                            <ArrowRightLeft className="h-3 w-3" />
                          </Button>
                        )}

                        {/* Cancel */}
                        {!isCancelled && item.status !== "completed" && (
                          <Button
                            size="icon" variant="ghost"
                            className="h-6 w-6 text-red-500 hover:bg-red-500/10"
                            title="Cancel Booking"
                            onClick={e => { e.stopPropagation(); cancelMutation.mutate(item.id); }}
                          >
                            <XCircle className="h-3 w-3" />
                          </Button>
                        )}

                        {/* Open Lead */}
                        <Button
                          size="icon" variant="ghost"
                          className="h-6 w-6 text-muted-foreground/60 hover:text-foreground hover:bg-muted/40"
                          title="Open Lead"
                          onClick={e => { e.stopPropagation(); navigate(`/app/campaigns/${campaignId}/leads/${item.leadId}`); }}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </Button>

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

      {/* ── Reschedule dialog ────────────────────────────────────────────── */}
      <Dialog open={rescheduleItem !== null} onOpenChange={open => !open && setRescheduleItem(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Reschedule Booking</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-xs text-muted-foreground">
              {rescheduleItem?.lead.name ?? rescheduleItem?.lead.phone ?? "Unknown"}
              {rescheduleItem?.eventType && (
                <span className="ml-1 text-muted-foreground/50">· {rescheduleItem.eventType.name}</span>
              )}
            </p>
            <div>
              <Label className="text-xs">New meeting time</Label>
              <Input
                type="datetime-local"
                className="mt-1.5 text-xs h-8"
                value={rescheduleTime}
                onChange={e => setRescheduleTime(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setRescheduleItem(null)}>Cancel</Button>
            <Button
              size="sm"
              disabled={!rescheduleTime || rescheduleMutation.isPending}
              onClick={() => rescheduleItem && rescheduleMutation.mutate({
                bookingId: rescheduleItem.id,
                newTime:   new Date(rescheduleTime).toISOString(),
              })}
            >
              Reschedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
