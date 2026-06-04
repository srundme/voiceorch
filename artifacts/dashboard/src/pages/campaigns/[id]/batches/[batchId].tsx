import { useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetCampaignBatch,
  useGetCampaign,
  useListBatchLeads,
  useUpdateCampaignBatch,
  useRedialBatchNoPickup,
  useRetryCampaignLead,
  useGetBatchAnalytics,
  getListCampaignBatchesQueryKey,
  getListBatchLeadsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Phone, Play, Pause, Square, RotateCcw,
  Eye, ChevronDown, ChevronRight, PhoneCall, PhoneIncoming, Clock,
  CheckCircle2, XCircle, PlayCircle, PauseCircle, X, Activity,
  Users, Hash, TrendingUp, BarChart3, AlertTriangle, Target, User, Bell
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────

type LeadItem = {
  id: number;
  campaignId: number;
  batchId: number | null;
  phone: string;
  name: string | null;
  callStatus: string;
  disposition: string | null;
  callId: number | null;
  fromNumber: string | null;
  toNumber: string | null;
  durationSeconds: number | null;
  source: string;
  hasCallback: boolean;
  callbackStatus: string | null;
  createdAt: string;
};

type LeadListResponse = { leads: LeadItem[]; total: number };

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(secs: number | null | undefined): string {
  if (!secs) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { label: string; icon: React.ReactNode; bg: string; text: string; border: string }> = {
    pending: { label: "Pending", icon: <PauseCircle className="h-3 w-3" />, bg: "bg-muted/50", text: "text-muted-foreground", border: "border-border" },
    calling: { label: "Calling", icon: <PhoneCall className="h-3 w-3" />, bg: "bg-blue-500/10", text: "text-blue-600 dark:text-blue-400", border: "border-blue-500/20" },
    completed: { label: "Completed", icon: <CheckCircle2 className="h-3 w-3" />, bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/20" },
    failed: { label: "Failed", icon: <XCircle className="h-3 w-3" />, bg: "bg-red-500/10", text: "text-red-600 dark:text-red-400", border: "border-red-500/20" },
    skipped: { label: "Skipped", icon: <X className="h-3 w-3" />, bg: "bg-muted/30", text: "text-muted-foreground/60", border: "border-border" },
  };
  const cfg = configs[status] ?? { label: status, icon: <Activity className="h-3 w-3" />, bg: "bg-muted/50", text: "text-muted-foreground", border: "border-border" };
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-md border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function BatchStatusBadge({ status }: { status: string }) {
  const configs: Record<string, { label: string; icon: React.ReactNode; bg: string; text: string; border: string }> = {
    draft: { label: "Draft", icon: <PauseCircle className="h-3 w-3" />, bg: "bg-muted/50", text: "text-muted-foreground", border: "border-border" },
    running: { label: "Running", icon: <PlayCircle className="h-3 w-3" />, bg: "bg-blue-500/10", text: "text-blue-600 dark:text-blue-400", border: "border-blue-500/20" },
    paused: { label: "Paused", icon: <PauseCircle className="h-3 w-3" />, bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400", border: "border-amber-500/20" },
    completed: { label: "Completed", icon: <CheckCircle2 className="h-3 w-3" />, bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/20" },
    stopped: { label: "Stopped", icon: <XCircle className="h-3 w-3" />, bg: "bg-red-500/10", text: "text-red-600 dark:text-red-400", border: "border-red-500/20" },
  };
  const cfg = configs[status] ?? { label: status, icon: <Activity className="h-3 w-3" />, bg: "bg-muted/50", text: "text-muted-foreground", border: "border-border" };
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-md border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ── Filter bar ──────────────────────────────────────────────────────────────

const FIXED_FILTERS = [
  { key: "all", label: "All", icon: Phone },
  { key: "no_pickup", label: "No Pickup", icon: PhoneCall },
  { key: "inbound", label: "Inbound", icon: PhoneIncoming },
  { key: "callbacks", label: "Callbacks", icon: Clock },
];

function FilterBar({ active, onChange, dynamicFilters }: {
  active: string;
  onChange: (f: string) => void;
  dynamicFilters: string[];
}) {
  const all = [
    ...FIXED_FILTERS,
    ...dynamicFilters.map(d => ({
      key: d,
      label: d.charAt(0).toUpperCase() + d.slice(1).replace(/_/g, " "),
      icon: null,
    })),
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {all.map(f => (
        <button
          key={f.key}
          onClick={() => onChange(f.key)}
          className={[
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all",
            active === f.key
              ? "bg-foreground text-background"
              : "bg-elevated/40 border border-border text-muted-foreground hover:bg-elevated hover:text-foreground",
          ].join(" ")}
        >
          {f.icon && <f.icon className="h-3 w-3" />}
          {f.label}
        </button>
      ))}
    </div>
  );
}

// ── Call log row ───────────────────────────────────────────────────────────

function CallRow({ lead, filter, onRetry }: { lead: LeadItem; filter: string; onRetry?: (leadId: number) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="hover:bg-elevated/20 transition-colors cursor-pointer group"
        onClick={() => setExpanded(e => !e)}
      >
        <td className="px-4 py-3">
          <StatusBadge status={lead.callStatus} />
          {filter === "callbacks" && lead.hasCallback && (
            <Badge variant="outline" className={`ml-1.5 text-[10px] ${lead.callbackStatus === "done" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : "bg-blue-500/10 text-blue-600 border-blue-500/20"}`}>
              {lead.callbackStatus === "done" ? "Callback Made" : "Pending"}
            </Badge>
          )}
        </td>
        <td className="px-4 py-3 text-[11px] text-muted-foreground whitespace-nowrap">
          {format(new Date(lead.createdAt), "MMM d, HH:mm")}
        </td>
        <td className="px-4 py-3 hidden sm:table-cell">
          <span className="text-[11px] font-mono text-foreground/60">
            {lead.fromNumber ?? <span className="text-muted-foreground/30">—</span>}
          </span>
        </td>
        <td className="px-4 py-3">
          <span className="text-[11px] font-mono text-foreground">
            {lead.toNumber ?? lead.phone}
          </span>
        </td>
        <td className="px-4 py-3 hidden md:table-cell">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {fmtDuration(lead.durationSeconds)}
          </span>
        </td>
        <td className="px-4 py-3 w-24">
          <div className="flex items-center gap-2">
            <Link href={`/app/campaigns/${lead.campaignId}/leads/${lead.id}`} onClick={e => e.stopPropagation()} aria-label="View lead profile">
              <User className="h-3.5 w-3.5 text-muted-foreground/40 hover:text-primary transition-colors" />
            </Link>
            {lead.callId && (
              <Link href={`/app/calls/${lead.callId}`} onClick={e => e.stopPropagation()}>
                <Eye className="h-3.5 w-3.5 text-muted-foreground/40 hover:text-foreground transition-colors" />
              </Link>
            )}
            {onRetry && lead.callStatus === "failed" && (
              <button
                onClick={e => { e.stopPropagation(); onRetry(lead.id); }}
                className="text-[10px] text-amber-600 hover:text-amber-700 hover:underline"
              >
                Retry
              </button>
            )}
            {expanded
              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/40" />
              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
            }
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-elevated/10 border-b border-border/30">
          <td colSpan={6} className="px-6 py-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <span className="text-muted-foreground/50 uppercase tracking-wider text-[10px]">Name</span>
                <p className="text-foreground mt-0.5">{lead.name ?? "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground/50 uppercase tracking-wider text-[10px]">Disposition</span>
                <p className="text-foreground mt-0.5">{lead.disposition ?? "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground/50 uppercase tracking-wider text-[10px]">Attempts</span>
                <p className="text-foreground mt-0.5">{lead.source}</p>
              </div>
              {lead.callId && (
                <div>
                  <span className="text-muted-foreground/50 uppercase tracking-wider text-[10px]">Call</span>
                  <Link href={`/app/calls/${lead.callId}`}>
                    <p className="text-primary hover:underline mt-0.5">#{lead.callId}</p>
                  </Link>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function BatchDetailPage() {
  const [, params] = useRoute("/app/campaigns/:id/batches/:batchId");
  const campaignId = parseInt(params?.id ?? "0", 10);
  const batchId = parseInt(params?.batchId ?? "0", 10);

  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const PAGE_SIZE = 20;
  const { toast } = useToast();
  const qc = useQueryClient();

  const update = useUpdateCampaignBatch();
  const redial = useRedialBatchNoPickup();
  const retry = useRetryCampaignLead();

  const { data: campaign } = useGetCampaign(campaignId);
  const { data: batch } = useGetCampaignBatch(campaignId, batchId);
  const { data: analytics } = useGetBatchAnalytics(campaignId, batchId);
  const { data: leadsData, isLoading } = useListBatchLeads(
    campaignId, batchId,
    { filter, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
  );

  const raw = leadsData as LeadListResponse | LeadItem[] | undefined;
  const items = Array.isArray(raw) ? (raw as LeadItem[]) : ((raw as LeadListResponse)?.leads ?? []);
  const total = Array.isArray(raw) ? items.length : ((raw as LeadListResponse)?.total ?? 0);

  const dynamicDispositions = [...new Set(
    items
      .filter(l => l.disposition && !["pending", "calling", "completed", "failed", "skipped"].includes(l.disposition))
      .map(l => l.disposition!)
  )];

  function changeFilter(f: string) {
    setFilter(f);
    setPage(0);
  }

  async function handleControl(status: "running" | "paused" | "stopped") {
    try {
      await update.mutateAsync({ id: campaignId, batchId, data: { status } });
      await qc.invalidateQueries({ queryKey: getListCampaignBatchesQueryKey(campaignId) });
      toast({ title: status === "running" ? "Batch started" : status === "paused" ? "Batch paused" : "Batch stopped" });
    } catch {
      toast({ title: "Error", description: "Action failed. Please try again.", variant: "destructive" });
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

  async function handleRetryLead(leadId: number) {
    try {
      await retry.mutateAsync({ id: campaignId, leadId });
      await qc.invalidateQueries({ queryKey: getListBatchLeadsQueryKey(campaignId, batchId) });
      toast({ title: "Retry queued", description: "Lead will be called again" });
    } catch {
      toast({ title: "Retry failed", variant: "destructive" });
    }
  }

  const batchStatus = batch?.status ?? "draft";
  const calledPct = batch && batch.totalLeads > 0
    ? Math.round((batch.calledLeads / batch.totalLeads) * 100)
    : 0;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-border shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/app/campaigns">
              <Button variant="outline" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground/50 mb-0.5">
                <Link href={`/app/campaigns/${campaignId}`}>
                  <span className="hover:text-foreground transition-colors">{campaign?.name ?? "Campaign"}</span>
                </Link>
                <ChevronRight className="h-3 w-3" />
                <span className="text-foreground">{batch?.name ?? "Batch"}</span>
              </div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold tracking-tight">{batch?.name ?? "Batch"}</h2>
                {batch && <BatchStatusBadge status={batchStatus} />}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setShowAnalytics(s => !s)}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              {showAnalytics ? "Hide" : "Analytics"}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-5 space-y-5">
        {/* Controls + Stats */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 sm:flex sm:items-center sm:gap-6">
              <div>
                <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Total Leads</p>
                <p className="text-xl font-semibold text-foreground mt-0.5">{batch?.totalLeads ?? 0}</p>
              </div>
              <div>
                <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Called</p>
                <p className="text-xl font-semibold text-foreground mt-0.5">{batch?.calledLeads ?? 0}</p>
              </div>
              <div>
                <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Progress</p>
                <p className="text-xl font-semibold text-foreground mt-0.5">{calledPct}%</p>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={batchStatus === "running" || update.isPending}
                onClick={() => void handleControl("running")}
              >
                <Play className="h-3.5 w-3.5" /> Start
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5"
                disabled={batchStatus !== "running" || update.isPending}
                onClick={() => void handleControl("paused")}
              >
                <Pause className="h-3.5 w-3.5" /> Pause
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5 border-red-500/20 text-red-600 hover:bg-red-500/5"
                disabled={batchStatus === "stopped" || update.isPending}
                onClick={() => void handleControl("stopped")}
              >
                <Square className="h-3.5 w-3.5" /> Stop
              </Button>
            </div>
          </div>

          {/* Progress bar */}
          {batch && batch.totalLeads > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-muted-foreground/50">Progress</span>
                <span className="text-[10px] text-muted-foreground font-mono">{calledPct}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary/30 rounded-full transition-all duration-500" style={{ width: `${calledPct}%` }} />
              </div>
              <div className="flex items-center justify-between mt-1.5 text-[10px] text-muted-foreground/50">
                <span>{batch.calledLeads} called</span>
                <span>{batch.totalLeads - batch.calledLeads} remaining</span>
              </div>
            </div>
          )}
        </div>

        {/* Analytics Panel */}
        {showAnalytics && analytics && (
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <BarChart3 className="h-3.5 w-3.5" /> Batch Analytics
            </h3>
            {/* Stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
              {[
                { label: "Total",    value: analytics.stats.total,         icon: <Users className="h-3.5 w-3.5" />,    cls: "" },
                { label: "Answered", value: analytics.stats.answered,       icon: <CheckCircle2 className="h-3.5 w-3.5" />, cls: "text-emerald-600 dark:text-emerald-400" },
                { label: "No Pickup",value: analytics.stats.notPicked,      icon: <Phone className="h-3.5 w-3.5" />,    cls: "text-amber-600 dark:text-amber-400" },
                { label: "Failed",   value: analytics.stats.failed,         icon: <XCircle className="h-3.5 w-3.5" />,  cls: "text-red-600 dark:text-red-400" },
                { label: "Callbacks",value: analytics.stats.callbacks,      icon: <Bell className="h-3.5 w-3.5" />,     cls: "text-purple-600 dark:text-purple-400" },
                { label: "Retries",  value: analytics.stats.pendingRetries, icon: <RotateCcw className="h-3.5 w-3.5" />, cls: "text-blue-600 dark:text-blue-400" },
              ].map(s => (
                <div key={s.label} className="rounded-lg border border-border bg-background p-3">
                  <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                    {s.icon}
                    <span className="text-[9px] uppercase tracking-widest">{s.label}</span>
                  </div>
                  <p className={`text-xl font-semibold ${s.cls || "text-foreground"}`}>{s.value}</p>
                </div>
              ))}
            </div>
            {/* Disposition breakdown */}
            {analytics.dispositions.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Dispositions</p>
                <div className="flex flex-wrap gap-2">
                  {analytics.dispositions.map(d => (
                    <div key={d.label} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-background">
                      <span className="text-xs text-muted-foreground capitalize">{d.label}</span>
                      <span className="text-xs font-bold text-foreground">{d.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Call Log */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground/50" />
                Call Log
              </h2>
              <span className="text-[10px] text-muted-foreground/40">{total} leads</span>
            </div>
            <FilterBar active={filter} onChange={changeFilter} dynamicFilters={dynamicDispositions} />
          </div>

          {isLoading ? (
            <div className="divide-y divide-border">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-3 w-24 rounded" />
                  <Skeleton className="h-3 w-20 rounded ml-auto" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="py-14 text-center">
              <div className="h-12 w-12 rounded-2xl bg-elevated border border-border flex items-center justify-center mx-auto mb-3">
                <Phone className="h-6 w-6 text-muted-foreground/30" />
              </div>
              <p className="text-sm font-medium text-foreground/40">
                {filter === "inbound" ? "Inbound call tracking coming soon" :
                 filter === "callbacks" ? "No scheduled callbacks" :
                 filter === "no_pickup" ? "No no-pickup calls" :
                 "No calls yet for this batch"}
              </p>
              <p className="text-xs text-muted-foreground/30 mt-1">
                {filter === "all" ? "Start the campaign to begin calling leads" : "Try a different filter"}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-elevated/30">
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Status</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Time</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest hidden sm:table-cell">From</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">To</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest hidden md:table-cell">Duration</th>
                      <th className="px-4 py-2.5 w-24" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {items.map(lead => (
                      <CallRow key={lead.id} lead={lead} filter={filter} onRetry={handleRetryLead} />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {total > PAGE_SIZE && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-elevated/10">
                  <p className="text-xs text-muted-foreground/50">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
                  </p>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
                  </div>
                </div>
              )}

              {/* Redial for No Pickup */}
              {filter === "no_pickup" && items.length > 0 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-amber-500/5">
                  <p className="text-xs text-amber-700/70">{items.length} no-pickup call{items.length !== 1 ? "s" : ""} — redial to retry all</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5 border-amber-500/20 text-amber-700 hover:bg-amber-500/10"
                    onClick={() => void handleRedialAll()}
                    disabled={redial.isPending}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Redial All
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
