/**
 * TransfersTab — Phase 3E
 * "Which conversations were handed to a human?"
 * Reads call_transfers joined through call_executions → campaign.
 * Status lifecycle: initiated → connected → completed | failed | cancelled
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft, CheckCircle2, XCircle, Clock, Download,
  RefreshCw, ExternalLink, RotateCcw, AlertCircle, Phone, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

// ── Types ─────────────────────────────────────────────────────────────────────

type TransferMetrics = {
  pending:   number;
  completed: number;
  failed:    number;
  today:     number;
  total:     number;
};

type TransferItem = {
  id:                 number;
  callId:             number;
  leadId:             number | null;
  batchId:            number | null;
  transferTo:         string;
  transferName:       string | null;
  summary:            string | null;
  status:             string;
  outcome:            string;
  durationSeconds:    number | null;
  initiatedAt:        string;
  connectedAt:        string | null;
  completedAt:        string | null;
  lead:               { name: string | null; phone: string | null };
  batchName:          string | null;
  agentName:          string | null;
};

type TransfersPage = {
  items: TransferItem[];
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

function fmtDuration(s: number | null): string {
  if (s === null) return "—";
  if (s < 60)  return `${s}s`;
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
  initiated:  { label: "Pending",   cls: "bg-amber-500/10 text-amber-600 border-amber-500/30"       },
  connected:  { label: "Connected", cls: "bg-sky-500/10 text-sky-600 border-sky-500/30"             },
  completed:  { label: "Completed", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
  failed:     { label: "Failed",    cls: "bg-red-500/10 text-red-500 border-red-500/30"             },
  cancelled:  { label: "Cancelled", cls: "bg-muted/50 text-muted-foreground border-border"          },
};

const OUTCOME_CFG: Record<string, { label: string; color: string }> = {
  TRANSFER_PENDING:    { label: "Pending",    color: "text-amber-500"          },
  TRANSFER_CONNECTED:  { label: "Connected",  color: "text-sky-500"            },
  TRANSFER_COMPLETED:  { label: "Completed",  color: "text-emerald-500"        },
  TRANSFER_FAILED:     { label: "Failed",     color: "text-red-500"            },
  TRANSFER_CANCELLED:  { label: "Cancelled",  color: "text-muted-foreground/50" },
};

const SUB_TABS = [
  { key: "all",       label: "All"       },
  { key: "pending",   label: "Pending"   },
  { key: "completed", label: "Completed" },
  { key: "failed",    label: "Failed"    },
  { key: "cancelled", label: "Cancelled" },
] as const;

// ── Component ─────────────────────────────────────────────────────────────────

export default function TransfersTab({ campaignId }: { campaignId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

  const [tab,  setTab]  = useState<string>("pending");
  const [page, setPage] = useState(0);

  const LIMIT = 50;

  const metricsKey = ["transfers-metrics", campaignId];
  const listKey    = ["transfers", campaignId, tab, page];

  const { data: metrics } = useQuery<TransferMetrics>({
    queryKey: metricsKey,
    queryFn:  () => apiFetch(`${BASE}/api/campaigns/${campaignId}/transfers/metrics`),
    refetchInterval: 10000,
  });

  const { data, isFetching } = useQuery<TransfersPage>({
    queryKey: listKey,
    queryFn: () => {
      const p = new URLSearchParams({ status: tab, page: String(page), limit: String(LIMIT) });
      return apiFetch<TransfersPage>(`${BASE}/api/campaigns/${campaignId}/transfers?${p}`);
    },
    refetchInterval: 10000,
    placeholderData: prev => prev,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: metricsKey });
    qc.invalidateQueries({ queryKey: ["transfers", campaignId] });
  };

  // ── Mutations ──────────────────────────────────────────────────────────────

  const statusMutation = useMutation({
    mutationFn: ({ transferId, status }: { transferId: number; status: string }) =>
      apiFetch(`${BASE}/api/campaigns/${campaignId}/transfers/${transferId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }),
    onSuccess: (_, v) => { toast({ title: `Marked ${v.status}` }); invalidate(); },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const retryMutation = useMutation({
    mutationFn: (transferId: number) =>
      apiFetch(`${BASE}/api/campaigns/${campaignId}/transfers/${transferId}/retry`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Transfer re-queued" }); invalidate(); },
    onError: (e: Error) => toast({ title: e.message || "Failed to retry", variant: "destructive" }),
  });

  const handleExport = () => window.open(`${BASE}/api/campaigns/${campaignId}/transfers/export`);

  const items      = data?.items ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const m          = metrics;

  return (
    <div className="flex flex-col h-full">

      {/* ── Metrics strip ───────────────────────────────────────────────── */}
      <div className="flex items-stretch gap-2 px-6 pt-5 pb-3 flex-wrap">

        {/* Pending */}
        <button
          onClick={() => { setTab("pending"); setPage(0); }}
          className={cn(
            "flex-1 min-w-[100px] rounded-lg border px-4 py-3 text-left transition-all",
            tab === "pending"
              ? "border-amber-500/50 bg-amber-500/10 shadow-sm"
              : "border-border/40 bg-card hover:bg-muted/30",
          )}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <AlertCircle className="h-3 w-3 text-amber-500" />
            <span className="text-[9px] uppercase tracking-widest font-semibold text-amber-500">Pending</span>
          </div>
          <p className={cn("text-xl font-bold tabular-nums", tab === "pending" ? "text-amber-500" : "")}>
            {m?.pending ?? "—"}
          </p>
        </button>

        {/* Completed */}
        <button
          onClick={() => { setTab("completed"); setPage(0); }}
          className={cn(
            "flex-1 min-w-[100px] rounded-lg border px-4 py-3 text-left transition-all",
            tab === "completed"
              ? "border-emerald-500/50 bg-emerald-500/10 shadow-sm"
              : "border-border/40 bg-card hover:bg-muted/30",
          )}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            <span className="text-[9px] uppercase tracking-widest font-semibold text-emerald-500">Completed</span>
          </div>
          <p className={cn("text-xl font-bold tabular-nums", tab === "completed" ? "text-emerald-500" : "")}>
            {m?.completed ?? "—"}
          </p>
        </button>

        {/* Failed */}
        <button
          onClick={() => { setTab("failed"); setPage(0); }}
          className={cn(
            "flex-1 min-w-[100px] rounded-lg border px-4 py-3 text-left transition-all",
            tab === "failed"
              ? "border-red-500/50 bg-red-500/10 shadow-sm"
              : "border-border/40 bg-card hover:bg-muted/30",
          )}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <XCircle className="h-3 w-3 text-red-500" />
            <span className="text-[9px] uppercase tracking-widest font-semibold text-red-500">Failed</span>
          </div>
          <p className={cn("text-xl font-bold tabular-nums", tab === "failed" ? "text-red-500" : "")}>
            {m?.failed ?? "—"}
          </p>
        </button>

        {/* Today */}
        <button
          onClick={() => { setTab("all"); setPage(0); }}
          className="flex-1 min-w-[100px] rounded-lg border px-4 py-3 text-left border-border/40 bg-card hover:bg-muted/30 transition-all"
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Clock className="h-3 w-3 text-sky-500" />
            <span className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground/50">Today</span>
          </div>
          <p className="text-xl font-bold tabular-nums">{m?.today ?? "—"}</p>
        </button>

        {/* Total */}
        <div className="flex-1 min-w-[100px] rounded-lg border px-4 py-3 border-border/40 bg-card">
          <div className="flex items-center gap-1.5 mb-1">
            <ArrowRightLeft className="h-3 w-3 text-muted-foreground/40" />
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

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <ArrowRightLeft className="h-8 w-8 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground/50">
              {tab === "pending" ? "No pending transfers" : "No transfers in this view"}
            </p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/30">
              <tr>
                <th className="px-4 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Lead</th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Transferred To</th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Transfer Time</th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden sm:table-cell">Duration</th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden md:table-cell">Outcome</th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Status</th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden lg:table-cell">Agent</th>
                <th className="px-3 py-2 text-left text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider hidden xl:table-cell">Batch</th>
                <th className="px-3 py-2 text-right text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider w-28">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {items.map(item => {
                const sc  = STATUS_CFG[item.status]   ?? { label: item.status,  cls: "bg-muted/50 text-muted-foreground border-border" };
                const oc  = OUTCOME_CFG[item.outcome] ?? { label: item.outcome, color: "text-muted-foreground/60" };
                const isPending  = ["initiated", "connected"].includes(item.status);
                const isFailed   = item.status === "failed";
                const isComplete = item.status === "completed";

                return (
                  <tr
                    key={item.id}
                    className={cn(
                      "hover:bg-muted/20 transition-colors",
                      isPending  && "bg-amber-500/[0.02]",
                      isFailed   && "bg-red-500/[0.02]",
                      isComplete && "opacity-80",
                    )}
                  >
                    {/* Lead */}
                    <td className="px-4 py-2.5">
                      {item.lead.name
                        ? <p className="font-medium truncate max-w-[120px]">{item.lead.name}</p>
                        : <p className="text-muted-foreground/50 italic text-[10px]">Unknown</p>
                      }
                      <p className="text-[10px] font-mono text-muted-foreground/60">{item.lead.phone ?? "—"}</p>
                    </td>

                    {/* Transferred To */}
                    <td className="px-3 py-2.5">
                      <p className="font-medium truncate max-w-[110px]">
                        {item.transferName ?? item.transferTo}
                      </p>
                      {item.transferName && (
                        <p className="text-[10px] font-mono text-muted-foreground/50 truncate max-w-[110px]">
                          {item.transferTo}
                        </p>
                      )}
                    </td>

                    {/* Transfer Time */}
                    <td className="px-3 py-2.5">
                      <p className="text-muted-foreground/80">{fmtDateTime(item.initiatedAt)}</p>
                      <p className="text-[10px] text-muted-foreground/40">{fmtRelative(item.initiatedAt)}</p>
                    </td>

                    {/* Duration */}
                    <td className="px-3 py-2.5 hidden sm:table-cell">
                      <span className="text-muted-foreground/70 tabular-nums">{fmtDuration(item.durationSeconds)}</span>
                    </td>

                    {/* Outcome */}
                    <td className="px-3 py-2.5 hidden md:table-cell">
                      <span className={cn("font-mono text-[10px]", oc.color)}>
                        {oc.label}
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

                    {/* Agent */}
                    <td className="px-3 py-2.5 hidden lg:table-cell">
                      {item.agentName
                        ? <span className="flex items-center gap-1 text-muted-foreground/70"><User className="h-2.5 w-2.5" />{item.agentName}</span>
                        : <span className="text-muted-foreground/30">—</span>
                      }
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

                        {/* Mark Complete (pending only) */}
                        {isPending && (
                          <Button
                            size="icon" variant="ghost"
                            className="h-6 w-6 text-emerald-600 hover:bg-emerald-500/10"
                            title="Mark Complete"
                            onClick={e => { e.stopPropagation(); statusMutation.mutate({ transferId: item.id, status: "completed" }); }}
                          >
                            <CheckCircle2 className="h-3 w-3" />
                          </Button>
                        )}

                        {/* Retry Transfer (failed / cancelled) */}
                        {(isFailed || item.status === "cancelled") && (
                          <Button
                            size="icon" variant="ghost"
                            className="h-6 w-6 text-amber-600 hover:bg-amber-500/10"
                            title="Retry Transfer"
                            onClick={e => { e.stopPropagation(); retryMutation.mutate(item.id); }}
                          >
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        )}

                        {/* View Recording → call detail */}
                        <Button
                          size="icon" variant="ghost"
                          className="h-6 w-6 text-sky-600 hover:bg-sky-500/10"
                          title="View Call"
                          onClick={e => { e.stopPropagation(); navigate(`/app/calls/${item.callId}`); }}
                        >
                          <Phone className="h-3 w-3" />
                        </Button>

                        {/* Open Lead */}
                        {item.leadId && (
                          <Button
                            size="icon" variant="ghost"
                            className="h-6 w-6 text-muted-foreground/60 hover:text-foreground hover:bg-muted/40"
                            title="Open Lead"
                            onClick={e => { e.stopPropagation(); navigate(`/app/campaigns/${campaignId}/leads/${item.leadId}`); }}
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

    </div>
  );
}
