import { useState, useCallback } from "react";
import { Link, useLocation } from "wouter";
import {
  useListCampaigns, useCreateCampaign, useUpdateCampaign, useDeleteCampaign,
  getListCampaignsQueryKey,
  useListMetaCampaignLeads, getListMetaCampaignLeadsQueryKey,
  useRetryCampaignLead,
  useRedialCampaignNoPickup,
  useListAgents,
} from "@workspace/api-client-react";
import type { Campaign } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Copy, Check, Phone, Megaphone, Eye, ChevronDown, ChevronRight,
  RotateCcw, PhoneIncoming, PhoneCall, Clock, Layers, MoreHorizontal,
  Pencil, Trash2, ExternalLink, Calendar, Users, Zap, BarChart3,
  Search, TrendingUp, ArrowRight, X, Hash, Activity, CheckCircle2,
  AlertTriangle, PlayCircle, PauseCircle, XCircle, Voicemail,
  Filter, Download, Headphones, Target
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtDuration(secs: number | null | undefined): string {
  if (!secs) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function StatusBadge({ status, type }: { status: string; type?: "call" | "campaign" | "batch" }) {
  const callMap: Record<string, { label: string; icon: React.ReactNode; bg: string; text: string; border: string }> = {
    pending:   { label: "Pending",   icon: <PauseCircle className="h-3 w-3" />,   bg: "bg-muted/50", text: "text-muted-foreground", border: "border-border" },
    calling:   { label: "Calling",   icon: <PhoneCall className="h-3 w-3" />,      bg: "bg-blue-500/10", text: "text-blue-600 dark:text-blue-400", border: "border-blue-500/20" },
    completed: { label: "Completed", icon: <CheckCircle2 className="h-3 w-3" />,    bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/20" },
    failed:    { label: "Failed",    icon: <XCircle className="h-3 w-3" />,          bg: "bg-red-500/10", text: "text-red-600 dark:text-red-400", border: "border-red-500/20" },
    skipped:   { label: "Skipped",   icon: <X className="h-3 w-3" />,              bg: "bg-muted/30", text: "text-muted-foreground/60", border: "border-border" },
  };

  const campaignMap: Record<string, { label: string; icon: React.ReactNode; bg: string; text: string; border: string }> = {
    draft:  { label: "Draft",   icon: <PauseCircle className="h-3 w-3" />,  bg: "bg-muted/50", text: "text-muted-foreground", border: "border-border" },
    active: { label: "Active",  icon: <PlayCircle className="h-3 w-3" />,  bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/20" },
    paused: { label: "Paused",  icon: <PauseCircle className="h-3 w-3" />, bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400", border: "border-amber-500/20" },
    completed: { label: "Completed", icon: <CheckCircle2 className="h-3 w-3" />, bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/20" },
    archived:  { label: "Archived", icon: <X className="h-3 w-3" />, bg: "bg-muted/30", text: "text-muted-foreground/60", border: "border-border" },
  };

  const map = type === "campaign" ? campaignMap : type === "batch" ? campaignMap : callMap;
  const cfg = map[status] ?? { label: status, icon: <Activity className="h-3 w-3" />, bg: "bg-muted/50", text: "text-muted-foreground", border: "border-border" };

  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-md border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="ml-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function MiniStat({ label, value, icon, trend }: { label: string; value: string; icon: React.ReactNode; trend?: string }) {
  return (
    <div className="flex items-center gap-3 p-2">
      <div className="h-8 w-8 rounded-lg bg-elevated border border-border flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">{label}</p>
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-foreground">{value}</p>
          {trend && (
            <span className="text-[10px] text-emerald-500 flex items-center gap-0.5">
              <TrendingUp className="h-3 w-3" />{trend}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Types ──────────────────────────────────────────────────────────────────

type MetaLeadItem = {
  id: number;
  campaignId: number;
  campaignName: string;
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

// ── Filter bar ─────────────────────────────────────────────────────────────

const FIXED_FILTERS = [
  { key: "all",       label: "All",        icon: Phone },
  { key: "no_pickup", label: "No Pickup",  icon: PhoneCall },
  { key: "inbound",   label: "Inbound",    icon: PhoneIncoming },
  { key: "callbacks", label: "Callbacks",  icon: Clock },
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

function CallRow({ lead, filter }: { lead: MetaLeadItem; filter: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="hover:bg-elevated/20 transition-colors cursor-pointer group"
        onClick={() => setExpanded(e => !e)}
      >
        <td className="px-4 py-3">
          <StatusBadge status={lead.callStatus} type="call" />
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
        <td className="px-4 py-3 hidden lg:table-cell">
          <Link href={`/app/campaigns/${lead.campaignId}`} onClick={e => e.stopPropagation()}>
            <span className="text-[11px] text-foreground/60 hover:text-foreground hover:underline transition-colors">
              {lead.campaignName}
            </span>
          </Link>
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
          <td colSpan={7} className="px-6 py-3">
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
                <span className="text-muted-foreground/50 uppercase tracking-wider text-[10px]">Source</span>
                <p className="text-foreground mt-0.5">{lead.source}</p>
              </div>
              {lead.callId && (
                <div>
                  <span className="text-muted-foreground/50 uppercase tracking-wider text-[10px]">Call ID</span>
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

// ── Section: Meta Campaign Leads ───────────────────────────────────────────────

function MetaLeadsSection({ campaigns }: { campaigns: Campaign[] }) {
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const PAGE_SIZE = 20;
  const qc = useQueryClient();
  const { toast } = useToast();
  const retry = useRetryCampaignLead();
  const redialMutation = useRedialCampaignNoPickup();

  const { data, isLoading } = useListMetaCampaignLeads(
    { filter, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
  );

  const raw = data as { leads?: MetaLeadItem[]; total?: number } | MetaLeadItem[] | undefined;
  const items = Array.isArray(raw) ? (raw as MetaLeadItem[]) : ((raw as { leads?: MetaLeadItem[] })?.leads ?? []);
  const total = Array.isArray(raw) ? items.length : ((raw as { total?: number })?.total ?? 0);

  const filteredItems = searchQuery.trim()
    ? items.filter(i =>
        i.phone?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        i.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        i.toNumber?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : items;

  const dynamicDispositions = [...new Set(
    items.filter(i => i.disposition && !["pending", "calling", "completed", "failed", "skipped"].includes(i.disposition))
      .map(i => i.disposition!)
  )];

  function changeFilter(f: string) {
    setFilter(f);
    setPage(0);
  }

  async function handleRedialAll() {
    const campaignIds = [...new Set(items.map(i => i.campaignId))];
    let queued = 0;
    for (const cid of campaignIds) {
      try {
        const r = await redialMutation.mutateAsync({ id: cid });
        queued += (r as { queued?: number })?.queued ?? 0;
      } catch { /* continue */ }
    }
    await qc.invalidateQueries({ queryKey: getListMetaCampaignLeadsQueryKey() });
    toast({ title: `Redial queued`, description: `${queued} lead${queued !== 1 ? "s" : ""} scheduled for callback` });
  }

  return (
    <div className="mb-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="h-6 w-6 rounded-md bg-primary/10 flex items-center justify-center">
              <Headphones className="h-3.5 w-3.5 text-primary/70" />
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50">
              Campaign Leads
            </p>
          </div>
          <h2 className="text-sm font-semibold text-foreground">Lead Activity</h2>
          <p className="text-xs text-muted-foreground/60 mt-0.5">Calls triggered via Meta Lead Ads & webhooks</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
          <Badge variant="outline" className="text-xs text-muted-foreground">
            {isLoading ? "…" : total} leads
          </Badge>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <FilterBar active={filter} onChange={changeFilter} dynamicFilters={dynamicDispositions} />
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
          <Input
            type="search"
            placeholder="Search leads…"
            className="pl-8 h-8 text-xs w-48"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
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
        ) : filteredItems.length === 0 ? (
          <div className="py-14 text-center">
            <div className="h-12 w-12 rounded-2xl bg-elevated border border-border flex items-center justify-center mx-auto mb-3">
              <Phone className="h-6 w-6 text-muted-foreground/30" />
            </div>
            <p className="text-sm font-medium text-foreground/40">
              {searchQuery ? "No leads match your search" : "No campaign leads yet"}
            </p>
            <p className="text-xs text-muted-foreground/30 mt-1">
              {searchQuery ? "Try adjusting your search query" : "Leads from Meta ads and webhooks will appear here"}
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
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest hidden lg:table-cell">Campaign</th>
                    <th className="px-4 py-2.5 w-20" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredItems.map(lead => (
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

            {/* Redial button for No Pickup */}
            {filter === "no_pickup" && items.length > 0 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-amber-500/5">
                <p className="text-xs text-amber-700/70">{items.length} no-pickup call{items.length !== 1 ? "s" : ""} — redial to retry all</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5 border-amber-500/20 text-amber-700 hover:bg-amber-500/10"
                  onClick={() => void handleRedialAll()}
                  disabled={redialMutation.isPending}
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

// ── Campaign card ───────────────────────────────────────────────────────────────

function CampaignCard({
  campaign,
  onEdit,
  onDelete,
}: {
  campaign: Campaign;
  onEdit: (c: Campaign) => void;
  onDelete: (c: Campaign) => void;
}) {
  const [, navigate] = useLocation();
  const calledPct = campaign.totalLeads > 0
    ? Math.round((campaign.calledLeads / campaign.totalLeads) * 100)
    : 0;
  const webhookUrl = `${window.location.origin}${BASE}/api/webhooks/lead/${campaign.webhookToken}`;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className="bg-card border border-border rounded-xl p-5 flex flex-col gap-4 hover:border-border/80 hover:shadow-sm transition-all cursor-pointer group relative"
      onClick={() => navigate(`/app/campaigns/${campaign.id}`)}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-elevated border border-border flex items-center justify-center shrink-0">
            <Megaphone className="h-4 w-4 text-muted-foreground/40" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{campaign.name}</p>
            {campaign.description && (
              <p className="text-xs text-muted-foreground/60 truncate mt-0.5">{campaign.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusBadge status={campaign.status} type="campaign" />
          <button
            type="button"
            className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-elevated transition-colors opacity-0 group-hover:opacity-100"
            onClick={e => { e.stopPropagation(); setMenuOpen(m => !m); }}
          >
            <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground/50" />
          </button>
        </div>
      </div>

      {/* Dropdown menu */}
      {menuOpen && (
        <div
          className="absolute z-10 mt-8 right-4 top-8 bg-card border border-border rounded-xl shadow-lg py-1 min-w-[140px]"
          onClick={e => e.stopPropagation()}
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-elevated transition-colors"
            onClick={() => { setMenuOpen(false); onEdit(campaign); }}
          >
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" /> Edit
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors"
            onClick={() => { setMenuOpen(false); onDelete(campaign); }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      )}

      {/* Progress bar */}
      {campaign.totalLeads > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground/50">Progress</span>
            <span className="text-muted-foreground font-mono">{calledPct}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-foreground/20 rounded-full transition-all" style={{ width: `${calledPct}%` }} />
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-elevated/40 rounded-lg px-3 py-2 text-center">
          <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Total</p>
          <p className="text-sm font-semibold text-foreground mt-0.5">{campaign.totalLeads}</p>
        </div>
        <div className="bg-elevated/40 rounded-lg px-3 py-2 text-center">
          <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Called</p>
          <p className="text-sm font-semibold text-foreground mt-0.5">{campaign.calledLeads}</p>
        </div>
        <div className="bg-elevated/40 rounded-lg px-3 py-2 text-center">
          <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Attempts</p>
          <p className="text-sm font-semibold text-foreground mt-0.5">{campaign.maxAttempts}</p>
        </div>
      </div>

      {/* Webhook URL */}
      <div className="bg-elevated/30 rounded-lg px-3 py-2">
        <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider mb-1">Webhook URL</p>
        <div className="flex items-center gap-1">
          <code className="text-[9px] text-muted-foreground/60 font-mono truncate flex-1">{webhookUrl}</code>
          <CopyButton text={webhookUrl} />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-border/40">
        <span className="text-[9px] text-muted-foreground/40">
          {formatDistanceToNow(new Date(campaign.createdAt), { addSuffix: true })}
        </span>
        <span className="text-[9px] text-muted-foreground/40 flex items-center gap-1">
          <Layers className="h-3 w-3" /> Batches
          <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </div>
  );
}

// ── New/Edit Campaign modal ───────────────────────────────────────────────

type FieldMappings = { phone: string; name: string; email: string };

const DEFAULT_MAPPINGS: FieldMappings = { phone: "phone", name: "name", email: "email" };

function CampaignFormDialog({
  open,
  onClose,
  editing,
  activeCampaigns,
}: {
  open: boolean;
  onClose: () => void;
  editing: Campaign | null;
  activeCampaigns: Campaign[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateCampaign();
  const update = useUpdateCampaign();
  const { data: agents } = useListAgents();

  const liveAgentIds = new Set(
    activeCampaigns.filter(c => c.status === "active").map(c => c.agentId).filter(Boolean)
  );

  const [name, setName] = useState(editing?.name ?? "");
  const [desc, setDesc] = useState(editing?.description ?? "");
  const [agentId, setAgentId] = useState(editing?.agentId ? String(editing.agentId) : "");
  const [fromNum, setFromNum] = useState(editing?.fromNumber ?? "");
  const [delay, setDelay] = useState(String(editing?.callDelaySeconds ?? 5));
  const [maxAtt, setMaxAtt] = useState(String(editing?.maxAttempts ?? 1));
  const [mappings, setMappings] = useState<FieldMappings>(
    editing?.fieldMappings
      ? {
          phone: (editing.fieldMappings as Record<string, string>)["phone"] ?? "phone",
          name: (editing.fieldMappings as Record<string, string>)["name"] ?? "name",
          email: (editing.fieldMappings as Record<string, string>)["email"] ?? "email",
        }
      : DEFAULT_MAPPINGS
  );

  function reset() {
    setName(""); setDesc(""); setAgentId(""); setFromNum(""); setDelay("5"); setMaxAtt("1"); setMappings(DEFAULT_MAPPINGS);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !agentId) return;
    const body = {
      name: name.trim(),
      description: desc.trim() || undefined,
      agentId: parseInt(agentId, 10),
      fromNumber: fromNum.trim() || undefined,
      callDelaySeconds: parseInt(delay, 10),
      maxAttempts: parseInt(maxAtt, 10),
      fieldMappings: { phone: mappings.phone, name: mappings.name, email: mappings.email },
    };
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, data: body });
        toast({ title: "Campaign updated" });
      } else {
        await create.mutateAsync({ data: body });
        toast({ title: "Campaign created" });
      }
      await qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      reset();
      onClose();
    } catch {
      toast({ title: "Error", description: "Failed to save campaign", variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg">{editing ? "Edit Campaign" : "New Campaign"}</DialogTitle>
          <DialogDescription className="text-xs">
            {editing ? "Update campaign settings." : "Set up a new outbound calling campaign."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Campaign Name <span className="text-destructive">*</span></Label>
            <Input placeholder="e.g. Summer Leads Q3" value={name} onChange={e => setName(e.target.value)} className="h-9 text-xs" required />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description <span className="text-muted-foreground/50">(optional)</span></Label>
            <Input placeholder="Short description…" value={desc} onChange={e => setDesc(e.target.value)} className="h-9 text-xs" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Agent <span className="text-destructive">*</span></Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Select an agent…" />
              </SelectTrigger>
              <SelectContent>
                {(agents ?? []).map(a => (
                  <SelectItem key={a.id} value={String(a.id)} className="text-xs">
                    <span className="flex items-center gap-2">
                      {a.name}
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${liveAgentIds.has(a.id) ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
                        {liveAgentIds.has(a.id) ? "LIVE" : "NOT LIVE"}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Field Mappings <span className="text-[10px] text-muted-foreground/50">(CSV column → role)</span></Label>
            <div className="grid grid-cols-3 gap-2">
              {(["phone", "name", "email"] as const).map(role => (
                <div key={role}>
                  <p className="text-[10px] text-muted-foreground/50 uppercase mb-1">{role}</p>
                  <Input
                    placeholder={role}
                    value={mappings[role]}
                    onChange={e => setMappings(m => ({ ...m, [role]: e.target.value }))}
                    className="h-8 text-xs"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Call Delay (seconds)</Label>
              <Input type="number" min={0} value={delay} onChange={e => setDelay(e.target.value)} className="h-9 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Max Attempts</Label>
              <Input type="number" min={1} value={maxAtt} onChange={e => setMaxAtt(e.target.value)} className="h-9 text-xs" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">From Number <span className="text-muted-foreground/50">(optional override)</span></Label>
            <Input placeholder="+1234567890" value={fromNum} onChange={e => setFromNum(e.target.value)} className="h-9 text-xs" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button type="submit" className="h-8 text-xs" disabled={create.isPending || update.isPending}>
              {create.isPending || update.isPending ? "Saving…" : editing ? "Save Changes" : "Create Campaign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [deleting, setDeleting] = useState<Campaign | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const deleteMutation = useDeleteCampaign();
  const { data: campaigns, isLoading } = useListCampaigns();

  async function handleDelete() {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync({ id: deleting.id });
      await qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      toast({ title: "Campaign deleted" });
    } catch {
      toast({ title: "Error", description: "Failed to delete campaign", variant: "destructive" });
    }
    setDeleting(null);
  }

  // Compute stats
  const totalCampaigns = campaigns?.length ?? 0;
  const activeCampaigns = campaigns?.filter(c => c.status === "active").length ?? 0;
  const totalLeads = campaigns?.reduce((sum, c) => sum + c.totalLeads, 0) ?? 0;
  const totalCalled = campaigns?.reduce((sum, c) => sum + c.calledLeads, 0) ?? 0;

  return (
    <TooltipProvider>
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border shrink-0">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="h-6 w-6 rounded-md bg-primary/10 flex items-center justify-center">
                  <Target className="h-3.5 w-3.5 text-primary/70" />
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50">
                  Voice Campaigns
                </p>
              </div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground leading-none">
                Campaigns
              </h1>
              <p className="text-xs mt-1 text-muted-foreground/60">
                Auto-call leads from Instagram ads, website forms, or CSV uploads
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" /> Analytics
              </Button>
              <Button size="sm" onClick={() => setCreateOpen(true)} className="h-8 text-xs gap-1.5">
                <Plus className="h-3.5 w-3.5" /> New Campaign
              </Button>
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MiniStat
              label="Total Campaigns"
              value={String(totalCampaigns)}
              icon={<Megaphone className="h-3.5 w-3.5 text-muted-foreground/50" />}
            />
            <MiniStat
              label="Active"
              value={String(activeCampaigns)}
              icon={<PlayCircle className="h-3.5 w-3.5 text-emerald-500" />}
            />
            <MiniStat
              label="Total Leads"
              value={String(totalLeads)}
              icon={<Users className="h-3.5 w-3.5 text-muted-foreground/50" />}
            />
            <MiniStat
              label="Leads Called"
              value={String(totalCalled)}
              icon={<PhoneCall className="h-3.5 w-3.5 text-blue-500" />}
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-6">
          {/* Meta Leads Section */}
          <MetaLeadsSection campaigns={campaigns ?? []} />

          {/* Campaigns Section */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Campaigns</h2>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Manage and monitor your campaigns</p>
            </div>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-card border border-border rounded-xl h-60 animate-pulse" />
              ))}
            </div>
          ) : !campaigns?.length ? (
            <div className="flex flex-col items-center justify-center py-20 text-center bg-card border border-border rounded-xl">
              <div className="h-12 w-12 rounded-2xl bg-elevated border border-border flex items-center justify-center mb-4">
                <Megaphone className="h-5 w-5 text-muted-foreground/30" />
              </div>
              <h3 className="text-sm font-semibold text-foreground mb-1">No campaigns yet</h3>
              <p className="text-xs text-muted-foreground/50 max-w-xs mb-5">
                Create a campaign to auto-call leads from Instagram ads, website forms, or CSV uploads.
              </p>
              <Button onClick={() => setCreateOpen(true)} className="h-8 text-xs gap-2">
                <Plus className="h-3.5 w-3.5" /> Create first campaign
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-6">
              {campaigns.map(c => (
                <CampaignCard
                  key={c.id}
                  campaign={c}
                  onEdit={camp => setEditing(camp)}
                  onDelete={camp => setDeleting(camp)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Modals */}
        <CampaignFormDialog
          open={createOpen || !!editing}
          onClose={() => { setCreateOpen(false); setEditing(null); }}
          editing={editing}
          activeCampaigns={campaigns ?? []}
        />

        <AlertDialog open={!!deleting} onOpenChange={v => { if (!v) setDeleting(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete campaign?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete <strong>{deleting?.name}</strong> and all its leads. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => void handleDelete()}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
