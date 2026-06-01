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
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Phone, Play, Pause, Square, RotateCcw,
  Eye, ChevronDown, ChevronRight, PhoneCall, PhoneIncoming, Clock,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type LeadItem = {
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

type LeadListResponse = { leads: LeadItem[]; total: number };

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(secs: number | null | undefined): string {
  if (!secs) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function callStatusColors(status: string): string {
  const map: Record<string, string> = {
    pending:   "bg-zinc-100 text-zinc-500 border-zinc-200",
    calling:   "bg-blue-50 text-blue-600 border-blue-200",
    completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    failed:    "bg-red-50 text-red-600 border-red-200",
    skipped:   "bg-amber-50 text-amber-600 border-amber-200",
  };
  return map[status] ?? "bg-muted text-muted-foreground border-border";
}

function batchStatusColors(status: string): string {
  const map: Record<string, string> = {
    draft:     "bg-zinc-100 text-zinc-500 border-zinc-200",
    running:   "bg-blue-50 text-blue-600 border-blue-200",
    paused:    "bg-amber-50 text-amber-600 border-amber-200",
    completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    stopped:   "bg-red-50 text-red-600 border-red-200",
  };
  return map[status] ?? "bg-muted text-muted-foreground border-border";
}

// ── Filter bar ────────────────────────────────────────────────────────────────

const FIXED_FILTERS = [
  { key: "all",       label: "All Calls",  icon: Phone },
  { key: "no_pickup", label: "No Pickup",  icon: PhoneCall },
  { key: "inbound",   label: "Inbound",    icon: PhoneIncoming },
  { key: "callbacks", label: "Callbacks",  icon: Clock },
];

function FilterBar({
  active,
  onChange,
  dynamicFilters,
}: {
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
    <div className="flex flex-wrap gap-1 mb-4">
      {all.map(f => (
        <button
          key={f.key}
          onClick={() => onChange(f.key)}
          className={[
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
            active === f.key
              ? "bg-foreground text-background"
              : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
          ].join(" ")}
        >
          {f.icon && <f.icon className="h-3 w-3" />}
          {f.label}
        </button>
      ))}
    </div>
  );
}

// ── Call log row ──────────────────────────────────────────────────────────────

function CallRow({ lead, filter }: { lead: LeadItem; filter: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="hover:bg-elevated/20 transition-colors cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <td className="px-4 py-3">
          <Badge variant="outline" className={`text-[10px] font-medium ${callStatusColors(lead.callStatus)}`}>
            {lead.callStatus}
          </Badge>
          {filter === "callbacks" && lead.hasCallback && (
            <Badge variant="outline" className={`ml-1.5 text-[10px] ${lead.callbackStatus === "done" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-blue-50 text-blue-600 border-blue-200"}`}>
              {lead.callbackStatus === "done" ? "Callback Made" : "Pending"}
            </Badge>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
          {format(new Date(lead.createdAt), "MMM d, HH:mm")}
        </td>
        <td className="px-4 py-3 hidden sm:table-cell">
          <span className="text-xs font-mono text-foreground/60">
            {lead.fromNumber ?? <span className="text-muted-foreground/30">—</span>}
          </span>
        </td>
        <td className="px-4 py-3">
          <span className="text-xs font-mono text-foreground">
            {lead.toNumber ?? lead.phone}
          </span>
        </td>
        <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground tabular-nums">
          {fmtDuration(lead.durationSeconds)}
        </td>
        <td className="px-4 py-3 w-20">
          <div className="flex items-center gap-2">
            {lead.callId && (
              <Link href={`/app/calls/${lead.callId}`} onClick={e => e.stopPropagation()}>
                <Eye className="h-3.5 w-3.5 text-muted-foreground/40 hover:text-foreground transition-colors" />
              </Link>
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BatchDetailPage() {
  const [, params]    = useRoute("/app/campaigns/:id/batches/:batchId");
  const campaignId    = parseInt(params?.id ?? "0", 10);
  const batchId       = parseInt(params?.batchId ?? "0", 10);

  const [filter, setFilter]   = useState("all");
  const [page, setPage]       = useState(0);
  const PAGE_SIZE             = 20;
  const { toast }             = useToast();
  const qc                    = useQueryClient();

  const update        = useUpdateCampaignBatch();
  const redial        = useRedialBatchNoPickup();
  const retry         = useRetryCampaignLead();

  const { data: campaign }  = useGetCampaign(campaignId);
  const { data: batch }     = useGetCampaignBatch(campaignId, batchId);
  const { data: leadsData, isLoading } = useListBatchLeads(
    campaignId, batchId,
    { filter, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
  );

  const raw    = leadsData as LeadListResponse | LeadItem[] | undefined;
  const items  = Array.isArray(raw) ? (raw as LeadItem[]) : ((raw as LeadListResponse)?.leads ?? []);
  const total  = Array.isArray(raw) ? items.length : ((raw as LeadListResponse)?.total ?? 0);

  const dynamicDispositions = [...new Set(
    items
      .filter(l => l.disposition && !["pending","calling","completed","failed","skipped"].includes(l.disposition))
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
      toast({ title: status === "running" ? "Campaign started" : status === "paused" ? "Campaign paused" : "Campaign stopped" });
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

  const batchStatus = batch?.status ?? "draft";
  const calledPct   = batch && batch.totalLeads > 0
    ? Math.round((batch.calledLeads / batch.totalLeads) * 100)
    : 0;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link href="/app/campaigns">
          <Button variant="outline" size="icon" className="h-7 w-7">
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
        </Link>
        <Link href={`/app/campaigns/${campaignId}`}>
          <span className="text-muted-foreground/50 hover:text-foreground transition-colors">
            {campaign?.name ?? "Campaign"}
          </span>
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30" />
        <span className="font-medium text-foreground">{batch?.name ?? "Batch"}</span>
        {batch && (
          <Badge variant="outline" className={`ml-1 text-[10px] ${batchStatusColors(batchStatus)}`}>
            {batchStatus}
          </Badge>
        )}
      </div>

      {/* Controls + stats */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          {/* Stats */}
          <div className="flex items-center gap-6">
            <div>
              <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Total Leads</p>
              <p className="text-xl font-semibold text-foreground mt-0.5">{batch?.totalLeads ?? 0}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Called</p>
              <p className="text-xl font-semibold text-foreground mt-0.5">{batch?.calledLeads ?? 0}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Progress</p>
              <p className="text-xl font-semibold text-foreground mt-0.5">{calledPct}%</p>
            </div>
          </div>

          {/* Campaign controls */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={batchStatus === "running" || update.isPending}
              onClick={() => void handleControl("running")}
            >
              <Play className="h-3.5 w-3.5" /> Start Campaign
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
              className="h-8 text-xs gap-1.5 border-red-200 text-red-600 hover:bg-red-50"
              disabled={batchStatus === "stopped" || update.isPending}
              onClick={() => void handleControl("stopped")}
            >
              <Square className="h-3.5 w-3.5" /> Stop
            </Button>
          </div>
        </div>

        {/* Progress bar */}
        {batch && batch.totalLeads > 0 && (
          <div className="mt-4 flex items-center gap-3">
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-foreground/30 rounded-full transition-all duration-500"
                style={{ width: `${calledPct}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground/50 w-10 text-right">{calledPct}%</span>
          </div>
        )}
      </div>

      {/* Call log */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground mb-3">Call Log</h2>
          <FilterBar active={filter} onChange={changeFilter} dynamicFilters={dynamicDispositions} />
        </div>

        {isLoading ? (
          <div className="divide-y divide-border">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5 animate-pulse">
                <div className="h-5 w-16 bg-muted rounded-full" />
                <div className="h-3 w-24 bg-muted rounded" />
                <div className="h-3 w-20 bg-muted rounded ml-auto" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="py-14 text-center">
            {filter === "inbound" ? (
              <>
                <PhoneIncoming className="h-6 w-6 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground/40">Inbound call tracking coming soon</p>
              </>
            ) : filter === "callbacks" ? (
              <>
                <Clock className="h-6 w-6 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground/40">No scheduled callbacks</p>
              </>
            ) : filter === "no_pickup" ? (
              <>
                <PhoneCall className="h-6 w-6 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground/40">No no-pickup calls</p>
              </>
            ) : (
              <>
                <Phone className="h-6 w-6 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground/40">No calls yet for this batch</p>
                <p className="text-xs text-muted-foreground/30 mt-1">Start the campaign to begin calling leads</p>
              </>
            )}
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
                    <th className="px-4 py-2.5 w-20" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {items.map(lead => (
                    <CallRow key={lead.id} lead={lead} filter={filter} />
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
              <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-amber-50/30">
                <p className="text-xs text-amber-700/70">
                  {items.length} no-pickup call{items.length !== 1 ? "s" : ""} — redial to retry all
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5 border-amber-200 text-amber-700 hover:bg-amber-50"
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
  );
}
