/**
 * Batch Workspace — Phase 4
 * Transforms a batch from "import container" → Operational Command Center.
 * Layout: Header → KPI Strip → Tabs (Overview | Leads | Activity | Sources)
 * Keeps existing controls (Start / Pause / Stop / Redial) intact.
 */

import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useUpdateCampaignBatch, useRedialBatchNoPickup,
  useRetryCampaignLead,
  getListCampaignBatchesQueryKey,
  getListBatchLeadsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Play, Pause, Square, RotateCcw, ChevronRight,
  Users, Phone, PhoneCall, Calendar, ArrowRightLeft, XCircle,
  TrendingUp, CheckCircle2, Bell, PhoneIncoming, ExternalLink,
  Eye, Activity, FileText, Database, AlertTriangle, RefreshCw,
  User,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getIrdaiBlockedError } from "@/lib/irdai-block";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { formatDistanceToNow, format } from "date-fns";
import { BATCH_STATUS_MAP, callStatusCfg, outcomeCfg } from "@/lib/campaign-status";
import { CallDetailDrawer } from "@/components/call-detail-drawer";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

// ── Types ─────────────────────────────────────────────────────────────────────

type BatchWorkspaceKpis = {
  total: number; connected: number; failed: number; pending: number;
  callbacks: number; incoming: number; bookings: number; transfers: number;
  successRate: number;
};

type FunnelStage = { key: string; label: string; value: number };
type BatchFunnel = { stages: FunnelStage[]; total: number };

type BatchWorkspaceLead = {
  id: number; name: string | null; phone: string;
  callStatus: string; operationalOutcome: string;
  disposition: string | null; callAttempts: number;
  lastAttemptAt: string | null; nextRetryAt: string | null; callId: number | null; createdAt: string;
  callback: { status: string; callbackAt: string | null } | null;
  booking: { meetingTime: string | null; meetingStatus: string; meetingLink: string | null } | null;
  transfer: { status: string; transferTo: string } | null;
};

type BatchLeadsPage = { items: BatchWorkspaceLead[]; total: number; page: number; limit: number };

type ActivityEvent = {
  id: number; leadId: number; leadName: string | null; leadPhone: string | null;
  eventType: string; data: Record<string, unknown> | null; createdAt: string;
};

type ImportRun = {
  id: number; fileName: string | null; status: string;
  totalRows: number; validRows: number; invalidRows: number; duplicateRows: number; createdRows: number;
  processingTimeMs: number | null; createdAt: string;
  sourceName: string | null; sourceType: string | null;
};

type SourceSummary = {
  sourceName: string; sourceType: string;
  importRuns: number; totalRows: number; validRows: number; duplicates: number; errors: number;
};

type BatchHeader = {
  batch: {
    id: number; name: string; status: string; leadSource: string;
    totalLeads: number; calledLeads: number; createdAt: string;
    scheduledStartAt: string | null;
    maxAttempts: number; retryDelayMinutes: number;
  };
  campaign: { id: number; name: string; agentName: string | null; fromNumber: string | null };
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

const EVENT_CFG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  lead_imported:         { label: "Lead Imported",        icon: <FileText className="h-3 w-3"      />, color: "text-violet-400"   },
  call_started:          { label: "Call Started",         icon: <PhoneCall className="h-3 w-3"     />, color: "text-sky-500"      },
  call_completed:        { label: "Call Completed",       icon: <CheckCircle2 className="h-3 w-3"  />, color: "text-emerald-500"  },
  call_failed:           { label: "Call Failed",          icon: <XCircle className="h-3 w-3"       />, color: "text-red-500"      },
  booking_created:       { label: "Booking Created",      icon: <Calendar className="h-3 w-3"      />, color: "text-violet-500"   },
  transfer_completed:    { label: "Transferred",          icon: <ArrowRightLeft className="h-3 w-3"/>, color: "text-sky-400"      },
  callback_scheduled:    { label: "Callback Scheduled",   icon: <Bell className="h-3 w-3"          />, color: "text-amber-500"    },
  callback_completed:    { label: "Callback Completed",   icon: <CheckCircle2 className="h-3 w-3"  />, color: "text-emerald-500"  },
  interest_confirmed:    { label: "Interested",           icon: <TrendingUp className="h-3 w-3"    />, color: "text-emerald-400"  },
  dnc_flagged:           { label: "DNC Flagged",          icon: <AlertTriangle className="h-3 w-3" />, color: "text-red-400"      },
  batch_started:         { label: "Batch Started",        icon: <PhoneCall className="h-3 w-3"     />, color: "text-sky-500"      },
  batch_completed:       { label: "Batch Completed",      icon: <CheckCircle2 className="h-3 w-3"  />, color: "text-emerald-500"  },
  batch_stopped:         { label: "Batch Stopped",        icon: <XCircle className="h-3 w-3"       />, color: "text-red-500"      },
  batch_paused:          { label: "Batch Paused",         icon: <Activity className="h-3 w-3"      />, color: "text-amber-500"    },
  disposition_set:       { label: "Disposition Set",      icon: <Activity className="h-3 w-3"      />, color: "text-muted-foreground/50" },
  outcome_updated:       { label: "Outcome Updated",      icon: <TrendingUp className="h-3 w-3"    />, color: "text-violet-400"   },
};

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

function KpiCard({ icon, label, value, color, onClick, active }: {
  icon: React.ReactNode; label: string; value: number | string;
  color?: string; onClick?: () => void; active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "flex-1 min-w-[90px] rounded-lg border px-3.5 py-3 text-left transition-all",
        active  ? "border-primary/40 bg-primary/5 shadow-sm" : "border-border/40 bg-card hover:bg-muted/20",
        !onClick && "cursor-default",
      )}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className={cn("text-muted-foreground/50", color)}>{icon}</span>
        <span className="text-xs uppercase tracking-widest font-semibold text-muted-foreground/40">{label}</span>
      </div>
      <p className={cn("text-xl font-bold tabular-nums", color ?? "text-foreground")}>{value}</p>
    </button>
  );
}

// ── Funnel ────────────────────────────────────────────────────────────────────

function BatchFunnelView({ funnel }: { funnel: BatchFunnel }) {
  const total = funnel.total || 1;
  const COLORS = [
    "bg-sky-500", "bg-violet-500", "bg-emerald-500",
    "bg-amber-500", "bg-emerald-600", "bg-sky-600",
  ];

  return (
    <div className="space-y-2">
      {funnel.stages.map((s, i) => {
        const pct = Math.round((s.value / total) * 100);
        return (
          <div key={s.key} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground/60 w-20 text-right shrink-0">{s.label}</span>
            <div className="flex-1 h-5 bg-muted/30 rounded-sm overflow-hidden">
              <div
                className={cn("h-full rounded-sm transition-all duration-500", COLORS[i])}
                style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
              />
            </div>
            <span className="text-xs font-mono font-semibold w-16 tabular-nums">
              {s.value.toLocaleString()} <span className="text-muted-foreground/40">({pct}%)</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ campaignId, batchId, header }: {
  campaignId: number; batchId: number; header: BatchHeader | undefined;
}) {
  const { data: funnel } = useQuery<BatchFunnel>({
    queryKey: ["batch-funnel", campaignId, batchId],
    queryFn: () => apiFetch(`${BASE}/api/campaigns/${campaignId}/batches/${batchId}/workspace/funnel`),
    refetchInterval: 15000,
  });

  const b = header?.batch;
  const c = header?.campaign;
  const calledPct = b && b.totalLeads > 0 ? Math.round((b.calledLeads / b.totalLeads) * 100) : 0;

  return (
    <div className="space-y-4 p-5">
      {/* Funnel */}
      <div className="rounded-xl border border-border/40 bg-card p-5">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/50 mb-4 flex items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5" /> Operational Funnel
        </h3>
        {funnel ? (
          <BatchFunnelView funnel={funnel} />
        ) : (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
          </div>
        )}
      </div>

      {/* Progress card — Total Leads / Called / Remaining */}
      <div className="rounded-xl border border-border/40 bg-card p-5">
        <p className="text-xs uppercase tracking-widest font-semibold text-muted-foreground/40 mb-4">Progress</p>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="text-center">
            <p className="text-3xl font-bold tabular-nums text-foreground">{(b?.totalLeads ?? 0).toLocaleString()}</p>
            <p className="text-xs text-muted-foreground/50 mt-0.5 uppercase tracking-wider">Total Leads</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold tabular-nums text-sky-500">{(b?.calledLeads ?? 0).toLocaleString()}</p>
            <p className="text-xs text-muted-foreground/50 mt-0.5 uppercase tracking-wider">Called</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold tabular-nums text-amber-500">{((b?.totalLeads ?? 0) - (b?.calledLeads ?? 0)).toLocaleString()}</p>
            <p className="text-xs text-muted-foreground/50 mt-0.5 uppercase tracking-wider">Remaining</p>
          </div>
        </div>
        <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-sky-500/70 rounded-full transition-all" style={{ width: `${calledPct}%` }} />
        </div>
        <p className="text-xs text-muted-foreground/40 mt-1.5 text-right tabular-nums">{calledPct}% complete</p>
      </div>

      {/* Batch info cards — GENERAL + SOURCE */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* GENERAL */}
        <div className="rounded-xl border border-border/40 bg-card p-4 space-y-2.5">
          <p className="text-xs uppercase tracking-widest font-semibold text-muted-foreground/40">General</p>
          <Row label="Status">
            {b && <BatchStatusBadge status={b.status} />}
          </Row>
          <Row label="Created">{b ? format(new Date(b.createdAt), "MMM d, yyyy HH:mm") : "—"}</Row>
          <Row label="Scheduled">{b?.scheduledStartAt ? format(new Date(b.scheduledStartAt), "MMM d, yyyy HH:mm") : "Not scheduled"}</Row>
          <Row label="Campaign">{c?.name ?? "—"}</Row>
          <Row label="Agent">{c?.agentName ?? "No agent"}</Row>
          <Row label="Phone">{c?.fromNumber ?? "Unset"}</Row>
        </div>

        {/* SOURCE */}
        <div className="rounded-xl border border-border/40 bg-card p-4 space-y-2.5">
          <p className="text-xs uppercase tracking-widest font-semibold text-muted-foreground/40">Source</p>
          <Row label="Type">{b?.leadSource === "csv" ? "CSV Import" : (b?.leadSource ?? "—")}</Row>
          <Row label="Name">{header?.source?.name ?? "—"}</Row>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground/50 shrink-0">{label}</span>
      <span className="text-xs font-medium text-right">{children}</span>
    </div>
  );
}

// ── Leads Tab ─────────────────────────────────────────────────────────────────

function LeadsTab({ campaignId, batchId, maxAttempts }: { campaignId: number; batchId: number; maxAttempts: number }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const retry = useRetryCampaignLead();

  const [page,        setPage]        = useState(0);
  const [status,      setStatus]      = useState("all");
  const [outcome,     setOutcome]     = useState("all");
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const LIMIT = 50;

  const queryKey = ["batch-ws-leads", campaignId, batchId, status, outcome, page];
  const { data, isFetching } = useQuery<BatchLeadsPage>({
    queryKey,
    queryFn: () => {
      const p = new URLSearchParams({ status, outcome, page: String(page), limit: String(LIMIT) });
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
    { key: "failed",    label: "Failed"    },
    { key: "calling",   label: "Calling"   },
  ];

  const OUTCOME_FILTERS = [
    { key: "all",              label: "All Outcomes"   },
    { key: "booking_created",  label: "Booked"         },
    { key: "transfer_completed", label: "Transferred"  },
    { key: "callback_requested", label: "Callback"     },
    { key: "interest_confirmed", label: "Interested"   },
    { key: "no_contact",       label: "No Contact"     },
    { key: "failed",           label: "Failed"         },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground/40 uppercase tracking-wider shrink-0">Status</span>
          <div className="flex items-center gap-0.5">
            {STATUS_FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => { setStatus(f.key); setPage(0); }}
                className={cn(
                  "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                  status === f.key ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:bg-muted/40",
                )}
              >{f.label}</button>
            ))}
          </div>
        </div>
        <div className="h-4 w-px bg-border/50 shrink-0" />
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground/40 uppercase tracking-wider shrink-0">Outcome</span>
          <div className="flex items-center gap-0.5 flex-wrap">
            {OUTCOME_FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => { setOutcome(f.key); setPage(0); }}
                className={cn(
                  "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                  outcome === f.key ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:bg-muted/40",
                )}
              >{f.label}</button>
            ))}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {(status !== "all" || outcome !== "all") && (
            <button
              onClick={() => { setStatus("all"); setOutcome("all"); setPage(0); }}
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
            {(status !== "all" || outcome !== "all") && (
              <button
                onClick={() => { setStatus("all"); setOutcome("all"); setPage(0); }}
                className="text-xs text-muted-foreground/60 underline-offset-2 hover:text-foreground hover:underline transition-colors">
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/30">
              <tr>
                {/* Lead → Status → Outcome → Attempts → Last Activity → Actions */}
                <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground/40 uppercase tracking-wider">Lead</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground/40 uppercase tracking-wider">Status</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground/40 uppercase tracking-wider hidden sm:table-cell">Outcome</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground/40 uppercase tracking-wider hidden md:table-cell">Attempts</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground/40 uppercase tracking-wider hidden lg:table-cell">Last Activity</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground/40 uppercase tracking-wider w-20">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {items.map(lead => {
                const sc = callStatusCfg(lead.callStatus);
                const oc = outcomeCfg(lead.operationalOutcome ?? "");
                return (
                  <tr key={lead.id} className="hover:bg-muted/20 transition-colors">
                    {/* Lead */}
                    <td className="px-4 py-2.5">
                      <p className="font-medium truncate max-w-[110px]">{lead.name ?? "—"}</p>
                      <p className="text-xs font-mono text-muted-foreground/60">{lead.phone}</p>
                    </td>
                    {/* Status */}
                    <td className="px-3 py-2.5">
                      <span className={cn("inline-flex text-xs font-semibold px-2 py-0.5 rounded border", sc.cls)}>
                        {sc.label}
                      </span>
                    </td>
                    {/* Outcome */}
                    <td className="px-3 py-2.5 hidden sm:table-cell">
                      <span className={cn("text-xs font-medium", oc.color)}>{oc.label}</span>
                    </td>
                    {/* Attempts */}
                    <td className="px-3 py-2.5 hidden md:table-cell">
                      {(() => {
                        // Clamp the displayed attempt to the configured max so any
                        // legacy/over-incremented row never renders "Attempt 3 of 2".
                        const currentAttempt = Math.min(Math.max(1, lead.callAttempts), maxAttempts);
                        const exhausted = lead.callAttempts >= maxAttempts;
                        const oneLeft   = !exhausted && currentAttempt === maxAttempts - 1;
                        const counterCls = exhausted
                          ? "text-red-500"
                          : oneLeft
                          ? "text-amber-500"
                          : "text-muted-foreground/60";
                        const TERMINAL = ["completed", "failed", "skipped"];
                        const showRetry = lead.nextRetryAt && !TERMINAL.includes(lead.callStatus);
                        return (
                          <div className="flex flex-col gap-0.5">
                            <span className={cn("text-xs tabular-nums font-medium", counterCls)}>
                              Attempt {currentAttempt} of {maxAttempts}
                            </span>
                            {showRetry && (
                              <span className="text-xs text-amber-500/80 tabular-nums" title={new Date(lead.nextRetryAt!).toLocaleString()}>
                                retry {formatDistanceToNow(new Date(lead.nextRetryAt!), { addSuffix: true })}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    {/* Last Activity */}
                    <td className="px-3 py-2.5 hidden lg:table-cell">
                      <span className="text-xs text-muted-foreground/60">
                        {lead.lastAttemptAt ? fmtRelative(lead.lastAttemptAt) : "—"}
                      </span>
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
                            <Eye className="h-3 w-3 text-muted-foreground/50" />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" className="h-6 w-6"
                          title="Open Lead" onClick={() => navigate(`/app/campaigns/${campaignId}/leads/${lead.id}`)}>
                          <ExternalLink className="h-3 w-3 text-muted-foreground/50" />
                        </Button>
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
      {total > LIMIT && (
        <div className="flex items-center justify-between px-5 py-2 border-t border-border/30 text-xs text-muted-foreground/50">
          <span>{page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total.toLocaleString()}</span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-6 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
            <span className="px-2">{page + 1}/{totalPages}</span>
            <Button size="sm" variant="ghost" className="h-6 text-xs" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

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

// ── Activity Tab ──────────────────────────────────────────────────────────────

function ActivityTab({ campaignId, batchId }: { campaignId: number; batchId: number }) {
  const { data, isFetching, refetch } = useQuery<{ events: ActivityEvent[] }>({
    queryKey: ["batch-activity", campaignId, batchId],
    queryFn: () => apiFetch(`${BASE}/api/campaigns/${campaignId}/batches/${batchId}/workspace/activity`),
    refetchInterval: 15000,
  });

  const events = data?.events ?? [];

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/40 flex items-center gap-2">
          <Activity className="h-3.5 w-3.5" /> Activity Stream
        </p>
        <Button size="sm" variant="ghost" className={cn("h-7 gap-1.5 text-xs", isFetching && "opacity-60")}
          onClick={() => void refetch()}>
          <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
        </Button>
      </div>

      {events.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 gap-2">
          <Activity className="h-7 w-7 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground/40">No activity recorded yet</p>
          <p className="text-xs text-muted-foreground/30">Events will appear here as leads progress</p>
        </div>
      ) : (
        <div className="space-y-1">
          {events.map(evt => {
            const cfg = EVENT_CFG[evt.eventType] ?? {
              label: evt.eventType.replace(/_/g, " "),
              icon: <Activity className="h-3 w-3" />,
              color: "text-muted-foreground/50",
            };
            return (
              <div key={evt.id} className="flex items-start gap-3 py-2 border-b border-border/20 last:border-0">
                <div className={cn("mt-0.5 shrink-0", cfg.color)}>{cfg.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn("text-xs font-medium", cfg.color)}>{cfg.label}</span>
                    {(evt.leadName || evt.leadPhone) && (
                      <span className="text-xs text-muted-foreground/60 truncate">
                        {evt.leadName ?? evt.leadPhone}
                      </span>
                    )}
                    {typeof evt.data?.disposition === "string" && evt.data.disposition && (
                      <span className="text-xs text-muted-foreground/50 italic">
                        &ldquo;{evt.data.disposition}&rdquo;
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground/40 shrink-0">{fmtRelative(evt.createdAt)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Sources Tab ───────────────────────────────────────────────────────────────

function SourcesTab({ campaignId, batchId }: { campaignId: number; batchId: number }) {
  const { data } = useQuery<{ sources: SourceSummary[]; runs: ImportRun[] }>({
    queryKey: ["batch-sources", campaignId, batchId],
    queryFn: () => apiFetch(`${BASE}/api/campaigns/${campaignId}/batches/${batchId}/workspace/sources`),
  });

  const sources = data?.sources ?? [];
  const runs    = data?.runs    ?? [];

  return (
    <div className="p-5 space-y-5">
      {/* Source Summary */}
      {sources.length > 0 && (
        <div className="rounded-xl border border-border/40 bg-card p-4">
          <p className="text-xs uppercase tracking-widest font-semibold text-muted-foreground/40 mb-3">Source Summary</p>
          <div className="space-y-0">
            {sources.map((s, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5 border-b border-border/20 last:border-0">
                <div className="flex items-center gap-2 min-w-[130px]">
                  {s.sourceType === "csv" ? (
                    <FileText className="h-3 w-3 text-muted-foreground/40" />
                  ) : (
                    <Database className="h-3 w-3 text-muted-foreground/40" />
                  )}
                  <div>
                    <p className="text-xs font-medium">{s.sourceName}</p>
                    <p className="text-xs text-muted-foreground/50 uppercase">
                      {s.sourceType === "csv" ? "CSV Import" : s.sourceType}
                    </p>
                  </div>
                </div>
                <div className="flex gap-4 text-xs flex-wrap">
                  <div className="text-center"><p className="text-foreground font-semibold">{s.importRuns}</p><p className="text-muted-foreground/40 text-xs">Runs</p></div>
                  <div className="text-center"><p className="text-foreground font-semibold">{s.totalRows.toLocaleString()}</p><p className="text-muted-foreground/40 text-xs">Total</p></div>
                  <div className="text-center"><p className="text-emerald-500 font-semibold">{s.validRows.toLocaleString()}</p><p className="text-muted-foreground/40 text-xs">Valid</p></div>
                  <div className="text-center"><p className="text-amber-500 font-semibold">{s.duplicates.toLocaleString()}</p><p className="text-muted-foreground/40 text-xs">Dupes</p></div>
                  <div className="text-center"><p className="text-red-500 font-semibold">{s.errors.toLocaleString()}</p><p className="text-muted-foreground/40 text-xs">Errors</p></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Import Run History */}
      <div className="rounded-xl border border-border/40 bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30">
          <p className="text-xs uppercase tracking-widest font-semibold text-muted-foreground/40 flex items-center gap-2">
            <FileText className="h-3 w-3" /> Import Runs
          </p>
        </div>
        {runs.length === 0 ? (
          <div className="py-10 flex flex-col items-center gap-2">
            <FileText className="h-7 w-7 text-muted-foreground/20" />
            <p className="text-xs text-muted-foreground/40">No import runs recorded</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="border-b border-border/30 bg-muted/10">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground/40 uppercase tracking-wider">File / Source</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground/40 uppercase tracking-wider hidden sm:table-cell">Status</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground/40 uppercase tracking-wider">Total</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground/40 uppercase tracking-wider hidden md:table-cell">Created</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground/40 uppercase tracking-wider hidden md:table-cell">Dupes</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground/40 uppercase tracking-wider hidden lg:table-cell">Errors</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground/40 uppercase tracking-wider hidden xl:table-cell">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {runs.map(r => (
                <tr key={r.id} className="hover:bg-muted/10">
                  <td className="px-4 py-2.5">
                    <p className="font-medium truncate max-w-[160px]">{r.fileName ?? r.sourceName ?? "Unknown"}</p>
                    {r.sourceType && (
                      <p className="text-xs text-muted-foreground/50 uppercase">
                        {r.sourceType === "csv" ? "CSV Import" : r.sourceType}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 hidden sm:table-cell">
                    <span className={cn(
                      "inline-flex text-xs font-semibold px-2 py-0.5 rounded border",
                      r.status === "completed" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" :
                      r.status === "failed"    ? "bg-red-500/10 text-red-500 border-red-500/20" :
                      "bg-amber-500/10 text-amber-600 border-amber-500/20",
                    )}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="tabular-nums">{r.totalRows}</p>
                    <p className="text-xs text-emerald-500">{r.createdRows} created</p>
                  </td>
                  <td className="px-3 py-2.5 hidden md:table-cell">
                    <span className={cn("tabular-nums", r.duplicateRows > 0 ? "text-amber-500" : "text-muted-foreground/50")}>
                      {r.duplicateRows}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 hidden md:table-cell">
                    <span className={cn("tabular-nums", r.invalidRows > 0 ? "text-red-500" : "text-muted-foreground/50")}>
                      {r.invalidRows}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 hidden lg:table-cell">
                    <span className="text-muted-foreground/50">
                      {r.processingTimeMs != null ? `${(r.processingTimeMs / 1000).toFixed(1)}s` : "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 hidden xl:table-cell">
                    <span className="text-muted-foreground/50">{fmtRelative(r.createdAt)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type WorkspaceTab = "overview" | "leads" | "activity" | "sources";

export default function BatchWorkspacePage() {
  const [, params] = useRoute("/app/campaigns/:id/batches/:batchId");
  const campaignId = parseInt(params?.id      ?? "0", 10);
  const batchId    = parseInt(params?.batchId ?? "0", 10);

  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview");
  const { toast } = useToast();
  const qc = useQueryClient();

  const update = useUpdateCampaignBatch();
  const redial = useRedialBatchNoPickup();
  const [isStarting, setIsStarting] = useState(false);

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

  async function handleRedialAll() {
    try {
      const r = await redial.mutateAsync({ id: campaignId, batchId });
      await qc.invalidateQueries({ queryKey: getListBatchLeadsQueryKey(campaignId, batchId) });
      toast({ title: "Redial queued", description: `${(r as { queued?: number })?.queued ?? 0} leads scheduled` });
    } catch {
      toast({ title: "Redial failed", variant: "destructive" });
    }
  }

  const TABS: { key: WorkspaceTab; label: string; icon: React.ReactNode }[] = [
    { key: "overview",  label: "Overview",  icon: <TrendingUp className="h-3 w-3"   /> },
    { key: "leads",     label: "Leads",     icon: <Users className="h-3 w-3"        /> },
    { key: "activity",  label: "Activity",  icon: <Activity className="h-3 w-3"     /> },
    { key: "sources",   label: "Sources",   icon: <Database className="h-3 w-3"     /> },
  ];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-6 pt-5 pb-3 border-b border-border/40 shrink-0">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href={`/app/campaigns/${campaignId}`}>
              <Button variant="outline" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              {/* Breadcrumb */}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground/50 mb-0.5">
                <Link href="/app/campaigns">
                  <span className="hover:text-foreground transition-colors">Campaigns</span>
                </Link>
                <ChevronRight className="h-2.5 w-2.5" />
                <Link href={`/app/campaigns/${campaignId}`}>
                  <span className="hover:text-foreground transition-colors">{header?.campaign.name ?? "…"}</span>
                </Link>
                <ChevronRight className="h-2.5 w-2.5" />
                <span className="text-foreground">{header?.batch.name ?? "Batch"}</span>
              </div>

              {/* Title + status */}
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-lg font-semibold tracking-tight">{header?.batch.name ?? "Batch Workspace"}</h2>
                {header && <BatchStatusBadge status={batchStatus} />}
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
            <Button size="sm" className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={batchStatus === "running" || update.isPending || isStarting}
              onClick={() => void handleStart()}>
              <Play className="h-3.5 w-3.5" /> Start
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
              disabled={batchStatus !== "running" || update.isPending}
              onClick={() => void handleControl("paused")}>
              <Pause className="h-3.5 w-3.5" /> Pause
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 border-red-500/20 text-red-600 hover:bg-red-500/5"
              disabled={batchStatus === "stopped" || update.isPending}
              onClick={() => void handleControl("stopped")}>
              <Square className="h-3.5 w-3.5" /> Stop
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
              disabled={batchStatus === "running" || redial.isPending}
              onClick={() => void handleRedialAll()}>
              <RotateCcw className="h-3.5 w-3.5" /> Redial
            </Button>
          </div>
        </div>
      </div>

      {/* ── KPI Strip ───────────────────────────────────────────────────────── */}
      <div className="flex items-stretch gap-2 px-5 py-3 overflow-x-auto shrink-0 border-b border-border/20">
        <KpiCard icon={<Users className="h-3 w-3" />}        label="Total"     value={kpis?.total       ?? "—"} />
        <KpiCard icon={<PhoneCall className="h-3 w-3" />}    label="Connected" value={kpis?.connected    ?? "—"} color="text-emerald-500" onClick={() => setActiveTab("leads")} active={activeTab === "leads"} />
        <KpiCard icon={<Bell className="h-3 w-3" />}         label="Callbacks" value={kpis?.callbacks    ?? "—"} color="text-amber-500"   onClick={() => setActiveTab("leads")} />
        <KpiCard icon={<PhoneIncoming className="h-3 w-3" />} label="Incoming" value={kpis?.incoming     ?? "—"} color="text-sky-500"     />
        <KpiCard icon={<Calendar className="h-3 w-3" />}     label="Bookings"  value={kpis?.bookings     ?? "—"} color="text-violet-500"  onClick={() => setActiveTab("leads")} />
        <KpiCard icon={<ArrowRightLeft className="h-3 w-3" />} label="Transfers" value={kpis?.transfers  ?? "—"} color="text-sky-400"    onClick={() => setActiveTab("leads")} />
        <KpiCard icon={<XCircle className="h-3 w-3" />}      label="Failed"    value={kpis?.failed       ?? "—"} color="text-red-500"     onClick={() => { setActiveTab("leads"); }} />
        <KpiCard icon={<TrendingUp className="h-3 w-3" />}   label="Success"   value={kpis ? `${kpis.successRate}%` : "—"} color="text-emerald-500" />
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 px-5 py-2 border-b border-border/20 shrink-0">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-none border-b-2 text-xs font-medium transition-colors -mb-px",
              activeTab === t.key
                ? "border-foreground text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab Content ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto min-h-0">
        {activeTab === "overview"  && <OverviewTab  campaignId={campaignId} batchId={batchId} header={header} />}
        {activeTab === "leads"     && <LeadsTab     campaignId={campaignId} batchId={batchId} maxAttempts={header?.batch.maxAttempts ?? 1} />}
        {activeTab === "activity"  && <ActivityTab  campaignId={campaignId} batchId={batchId} />}
        {activeTab === "sources"   && <SourcesTab   campaignId={campaignId} batchId={batchId} />}
      </div>

    </div>
  );
}
