import { useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetCampaignBatch,
  useGetCampaign,
  useListBatchLeads,
  useUpdateCampaignBatch,
  useRedialBatchNoPickup,
  useRetryCampaignLead,
  getListCampaignBatchesQueryKey,
  getListBatchLeadsQueryKey,
} from "@workspace/api-client-react";
import type { CampaignBatch } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Phone, Play, Pause, Square, PhoneCall, RotateCcw,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type MetaLeadItem = {
  id:              number;
  campaignId:      number;
  batchId:         number | null;
  phone:           string;
  name:            string | null;
  callStatus:      string;
  disposition:     string | null;
  callId:          number | null;
  fromNumber:      string | null;
  toNumber:        string | null;
  durationSeconds: number | null;
  source:          string;
  hasCallback:     boolean;
  callbackStatus:  string | null;
  createdAt:       string;
};

type LeadListResponse = { leads: MetaLeadItem[]; total: number };

// ── Helpers ───────────────────────────────────────────────────────────────────

function callStatusBadge(status: string) {
  const map: Record<string, string> = {
    pending:   "bg-muted/60 text-muted-foreground border-border",
    calling:   "bg-blue-50 text-blue-700 border-blue-200",
    completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    failed:    "bg-red-50 text-red-700 border-red-200",
    skipped:   "bg-amber-50 text-amber-700 border-amber-200",
  };
  return map[status] ?? "bg-muted text-muted-foreground border-border";
}

function batchStatusBadge(status: string) {
  const map: Record<string, string> = {
    draft:     "bg-muted text-muted-foreground border-border",
    running:   "bg-blue-50 text-blue-700 border-blue-200",
    paused:    "bg-amber-50 text-amber-700 border-amber-200",
    completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    stopped:   "bg-muted text-muted-foreground border-border",
  };
  return map[status] ?? "bg-muted text-muted-foreground border-border";
}

const STATIC_FILTERS = [
  { key: "all",       label: "All" },
  { key: "no_pickup", label: "No Pickup" },
  { key: "callbacks", label: "Callbacks" },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BatchDetailPage() {
  const [, params] = useRoute("/app/campaigns/:id/batches/:batchId");
  const campaignId = parseInt(params?.id ?? "0", 10);
  const batchId    = parseInt(params?.batchId ?? "0", 10);

  const qc         = useQueryClient();
  const { toast }  = useToast();

  const [filter, setFilter] = useState("all");
  const [page, setPage]     = useState(0);
  const PAGE_SIZE           = 25;

  const { data: campaign }                   = useGetCampaign(campaignId);
  const { data: batch, isLoading: loadBatch } = useGetCampaignBatch(campaignId, batchId);
  const { data: leadsData, isLoading: loadLeads, refetch } = useListBatchLeads(
    campaignId, batchId,
    { filter, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
  );

  const update = useUpdateCampaignBatch();
  const redial = useRedialBatchNoPickup();
  const retry  = useRetryCampaignLead();

  const batchRow = batch as CampaignBatch | undefined;
  const leadsRes = leadsData as LeadListResponse | undefined;
  const leads    = leadsRes?.leads ?? [];
  const total    = leadsRes?.total ?? 0;

  // Dynamic disposition filters
  const dynamicDispositions = [...new Set(leads.filter(l => l.disposition).map(l => l.disposition!))];
  const allFilters = [
    ...STATIC_FILTERS,
    ...dynamicDispositions
      .filter(d => !STATIC_FILTERS.some(f => f.key === d))
      .map(d => ({ key: d, label: d.charAt(0).toUpperCase() + d.slice(1) })),
  ];

  async function setStatus(status: string) {
    try {
      await update.mutateAsync({ id: campaignId, batchId, data: { status } as Parameters<typeof update.mutateAsync>[0]["data"] });
      await qc.invalidateQueries({ queryKey: getListCampaignBatchesQueryKey(campaignId) });
      toast({ title: `Batch ${status}` });
    } catch { toast({ title: "Action failed", variant: "destructive" }); }
  }

  async function handleRedialNoPickup() {
    try {
      const res = await redial.mutateAsync({ id: campaignId, batchId });
      const queued = (res as { queued?: number })?.queued ?? 0;
      await qc.invalidateQueries({ queryKey: getListBatchLeadsQueryKey(campaignId, batchId) });
      toast({ title: `Redial queued: ${queued} leads` });
    } catch { toast({ title: "Redial failed", variant: "destructive" }); }
  }

  async function handleRetry(leadId: number) {
    try {
      await retry.mutateAsync({ id: campaignId, leadId });
      await refetch();
      toast({ title: "Retry queued" });
    } catch { toast({ title: "Retry failed", variant: "destructive" }); }
  }

  const progress = batchRow && batchRow.totalLeads > 0
    ? Math.round((batchRow.calledLeads / batchRow.totalLeads) * 100) : 0;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6">
        <Link href="/app/campaigns">
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1">
            <ArrowLeft className="h-3.5 w-3.5" /> Campaigns
          </Button>
        </Link>
        <span className="text-muted-foreground/30">/</span>
        <Link href={`/app/campaigns/${campaignId}`}>
          <span className="text-xs text-muted-foreground hover:text-foreground cursor-pointer">
            {campaign?.name ?? `Campaign ${campaignId}`}
          </span>
        </Link>
        <span className="text-muted-foreground/30">/</span>
        <span className="text-xs text-foreground font-medium">
          {loadBatch ? "Loading…" : batchRow?.name ?? `Batch ${batchId}`}
        </span>
      </div>

      {/* Batch header */}
      {batchRow && (
        <div className="bg-card border border-border rounded-2xl p-5 mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <h1 className="text-lg font-semibold text-foreground">{batchRow.name}</h1>
                <Badge variant="outline" className={`text-[10px] ${batchStatusBadge(batchRow.status)}`}>
                  {batchRow.status}
                </Badge>
              </div>
              {batchRow.scheduledStartAt && (
                <p className="text-xs text-muted-foreground/60">
                  Scheduled: {format(new Date(batchRow.scheduledStartAt), "MMM d, yyyy HH:mm")}
                </p>
              )}
              <p className="text-xs text-muted-foreground/40 mt-1">
                Created {formatDistanceToNow(new Date(batchRow.createdAt), { addSuffix: true })}
              </p>
            </div>

            {/* Batch controls */}
            <div className="flex items-center gap-2 shrink-0">
              {(batchRow.status === "draft" || batchRow.status === "paused" || batchRow.status === "stopped") && (
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => void setStatus("running")} disabled={update.isPending}>
                  <Play className="h-3.5 w-3.5" /> Start
                </Button>
              )}
              {batchRow.status === "running" && (
                <>
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => void setStatus("paused")} disabled={update.isPending}>
                    <Pause className="h-3.5 w-3.5" /> Pause
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => void setStatus("stopped")} disabled={update.isPending}>
                    <Square className="h-3.5 w-3.5" /> Stop
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-4">
            <div className="flex justify-between text-[10px] text-muted-foreground/50 mb-1.5">
              <span>{batchRow.calledLeads} / {batchRow.totalLeads} leads called</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 bg-elevated rounded-full overflow-hidden">
              <div
                className="h-full bg-foreground/50 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Stats */}
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Total",    value: batchRow.totalLeads },
              { label: "Called",   value: batchRow.calledLeads },
              { label: "Progress", value: `${progress}%` },
            ].map(s => (
              <div key={s.label} className="bg-elevated/60 border border-border/40 rounded-xl p-2.5">
                <p className="text-[10px] text-muted-foreground/50 mb-0.5 uppercase tracking-widest font-semibold">{s.label}</p>
                <p className="text-base font-bold text-foreground tabular-nums">{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Leads section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-foreground">Leads</h2>
          {filter === "no_pickup" && leads.some(l => l.callStatus === "failed" || l.callStatus === "skipped") && (
            <Button
              size="sm" variant="outline" className="h-7 text-xs gap-1.5"
              onClick={() => void handleRedialNoPickup()}
              disabled={redial.isPending}
            >
              <PhoneCall className="h-3 w-3" />
              {redial.isPending ? "Redialing…" : "Redial All No Pickup"}
            </Button>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mb-4 flex-wrap">
          {allFilters.map(f => (
            <button
              key={f.key}
              onClick={() => { setFilter(f.key); setPage(0); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === f.key
                  ? "bg-foreground text-background"
                  : "bg-elevated text-muted-foreground hover:text-foreground border border-border"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          {loadLeads ? (
            <div className="divide-y divide-border">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="px-4 py-3 flex gap-4 animate-pulse">
                  <div className="h-4 w-28 bg-muted rounded" />
                  <div className="h-4 w-20 bg-muted rounded" />
                  <div className="h-4 w-14 bg-muted rounded ml-auto" />
                </div>
              ))}
            </div>
          ) : leads.length === 0 ? (
            <div className="py-12 text-center">
              <Phone className="h-7 w-7 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground/50">
                {filter === "all" ? "No leads in this batch" : `No ${filter.replace("_", " ")} leads`}
              </p>
            </div>
          ) : (
            <>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-elevated/40">
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Phone</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest hidden sm:table-cell">Name</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Status</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest hidden md:table-cell">Duration</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest hidden lg:table-cell">Disposition</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest hidden md:table-cell">Date</th>
                    <th className="px-4 py-2.5 w-16" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {leads.map(lead => (
                    <tr key={lead.id} className="hover:bg-elevated/20 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Phone className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                          <span className="text-xs font-mono text-foreground">{lead.phone}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground hidden sm:table-cell">
                        {lead.name ?? <span className="text-muted-foreground/30">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={`text-[10px] ${callStatusBadge(lead.callStatus)}`}>
                          {lead.callStatus}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">
                        {lead.durationSeconds != null
                          ? `${Math.floor(lead.durationSeconds / 60)}m ${lead.durationSeconds % 60}s`
                          : <span className="text-muted-foreground/30">—</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell">
                        {lead.disposition ?? <span className="text-muted-foreground/30">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">
                        {format(new Date(lead.createdAt), "MMM d, HH:mm")}
                      </td>
                      <td className="px-4 py-3">
                        {(lead.callStatus === "failed" || lead.callStatus === "skipped") && (
                          <Button
                            variant="ghost" size="sm"
                            className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
                            onClick={() => void handleRetry(lead.id)}
                          >
                            <RotateCcw className="h-3 w-3" />
                            Retry
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              {total > PAGE_SIZE && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <p className="text-xs text-muted-foreground/50">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
                  </p>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
