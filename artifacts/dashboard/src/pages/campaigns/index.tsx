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
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Copy, Check, Phone, Megaphone, Eye, ChevronDown, ChevronRight,
  RotateCcw, PhoneIncoming, PhoneCall, Clock, Layers, MoreHorizontal,
  Pencil, Trash2, ExternalLink, Calendar, Users, Zap,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

function campaignStatusColors(status: string): string {
  const map: Record<string, string> = {
    draft:  "bg-zinc-100 text-zinc-500 border-zinc-200",
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    paused: "bg-amber-50 text-amber-600 border-amber-200",
  };
  return map[status] ?? "bg-muted text-muted-foreground border-border";
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

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Filter bar ────────────────────────────────────────────────────────────────

const FIXED_FILTERS = [
  { key: "all",       label: "All Calls",  icon: Phone },
  { key: "no_pickup", label: "No Pickup",  icon: PhoneCall },
  { key: "inbound",   label: "Inbound",    icon: PhoneIncoming },
  { key: "callbacks", label: "Callbacks",  icon: Clock },
];

function FilterBar({
  active, onChange, dynamicFilters,
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

function CallRow({ lead, filter }: { lead: MetaLeadItem; filter: string }) {
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
          <span className="text-xs font-mono text-foreground/70">
            {lead.fromNumber ?? <span className="text-muted-foreground/30">—</span>}
          </span>
        </td>
        <td className="px-4 py-3">
          <span className="text-xs font-mono text-foreground">
            {lead.toNumber ?? lead.phone}
          </span>
        </td>
        <td className="px-4 py-3 hidden md:table-cell">
          <span className="text-xs text-muted-foreground tabular-nums">
            {fmtDuration(lead.durationSeconds)}
          </span>
        </td>
        <td className="px-4 py-3 hidden lg:table-cell">
          <Link href={`/app/campaigns/${lead.campaignId}`} onClick={e => e.stopPropagation()}>
            <span className="text-xs text-foreground/60 hover:text-foreground hover:underline transition-colors">
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

// ── Section 1: Meta Campaign Leads ────────────────────────────────────────────

function MetaLeadsSection({ campaigns }: { campaigns: Campaign[] }) {
  const [filter, setFilter]   = useState("all");
  const [page, setPage]       = useState(0);
  const PAGE_SIZE             = 20;
  const qc                    = useQueryClient();
  const { toast }             = useToast();
  const retry                 = useRetryCampaignLead();
  const redialMutation        = useRedialCampaignNoPickup();

  const { data, isLoading } = useListMetaCampaignLeads(
    { filter, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
  );

  const raw      = data as { leads?: MetaLeadItem[]; total?: number } | MetaLeadItem[] | undefined;
  const items    = Array.isArray(raw) ? (raw as MetaLeadItem[]) : ((raw as { leads?: MetaLeadItem[] })?.leads ?? []);
  const total    = Array.isArray(raw) ? items.length : ((raw as { total?: number })?.total ?? 0);

  const dynamicDispositions = [...new Set(
    items.filter(i => i.disposition && !["pending","calling","completed","failed","skipped"].includes(i.disposition))
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
          <h2 className="text-base font-semibold text-foreground">Campaign Leads</h2>
          <p className="text-xs text-muted-foreground/60 mt-0.5">Calls triggered via Meta Lead Ads &amp; webhooks</p>
        </div>
        <Badge variant="outline" className="text-xs text-muted-foreground">
          {isLoading ? "…" : total} leads
        </Badge>
      </div>

      {/* Filter bar */}
      <FilterBar active={filter} onChange={changeFilter} dynamicFilters={dynamicDispositions} />

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
        ) : items.length === 0 ? (
          <div className="py-12 text-center">
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
                <p className="text-sm text-muted-foreground/40">No campaign leads yet</p>
                <p className="text-xs text-muted-foreground/30 mt-1">Leads from Meta ads and webhooks will appear here</p>
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
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest hidden lg:table-cell">Campaign</th>
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

            {/* Redial button for No Pickup */}
            {filter === "no_pickup" && items.length > 0 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-amber-50/30">
                <p className="text-xs text-amber-700/70">{items.length} no-pickup call{items.length !== 1 ? "s" : ""} — redial to retry all</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5 border-amber-200 text-amber-700 hover:bg-amber-50"
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

// ── Campaign card ─────────────────────────────────────────────────────────────

function CampaignCard({
  campaign,
  onEdit,
  onDelete,
}: {
  campaign: Campaign;
  onEdit: (c: Campaign) => void;
  onDelete: (c: Campaign) => void;
}) {
  const [, navigate]  = useLocation();
  const calledPct     = campaign.totalLeads > 0
    ? Math.round((campaign.calledLeads / campaign.totalLeads) * 100)
    : 0;
  const webhookUrl    = `${window.location.origin}${BASE}/api/webhooks/lead/${campaign.webhookToken}`;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-4 hover:border-border/80 hover:shadow-sm transition-all cursor-pointer group"
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
          <Badge variant="outline" className={`text-[10px] font-medium ${campaignStatusColors(campaign.status)}`}>
            {campaign.status}
          </Badge>
          <button
            type="button"
            className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-muted transition-colors opacity-0 group-hover:opacity-100"
            onClick={e => { e.stopPropagation(); setMenuOpen(m => !m); }}
          >
            <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground/50" />
          </button>
        </div>
      </div>

      {/* Dropdown menu (simple) */}
      {menuOpen && (
        <div
          className="absolute z-10 mt-8 right-4 bg-card border border-border rounded-xl shadow-lg py-1 min-w-[140px]"
          onClick={e => e.stopPropagation()}
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-muted transition-colors"
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

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-elevated/40 rounded-lg px-3 py-2 text-center">
          <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Total</p>
          <p className="text-sm font-semibold text-foreground mt-0.5">{campaign.totalLeads}</p>
        </div>
        <div className="bg-elevated/40 rounded-lg px-3 py-2 text-center">
          <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Called</p>
          <p className="text-sm font-semibold text-foreground mt-0.5">{campaign.calledLeads}</p>
        </div>
        <div className="bg-elevated/40 rounded-lg px-3 py-2 text-center">
          <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Called %</p>
          <p className="text-sm font-semibold text-foreground mt-0.5">{calledPct}%</p>
        </div>
      </div>

      {/* Webhook URL */}
      <div className="bg-elevated/30 rounded-lg px-3 py-2">
        <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wider mb-1">Webhook URL</p>
        <div className="flex items-center gap-1">
          <code className="text-[10px] text-muted-foreground/60 font-mono truncate flex-1">{webhookUrl}</code>
          <CopyButton text={webhookUrl} />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-border/40">
        <span className="text-[10px] text-muted-foreground/40">
          {formatDistanceToNow(new Date(campaign.createdAt), { addSuffix: true })}
        </span>
        <span className="text-[10px] text-muted-foreground/40 flex items-center gap-1">
          <Layers className="h-3 w-3" /> View batches
          <ChevronRight className="h-3 w-3" />
        </span>
      </div>
    </div>
  );
}

// ── New/Edit Campaign modal ───────────────────────────────────────────────────

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
  const qc            = useQueryClient();
  const { toast }     = useToast();
  const create        = useCreateCampaign();
  const update        = useUpdateCampaign();
  const { data: agents } = useListAgents();

  const liveAgentIds = new Set(
    activeCampaigns.filter(c => c.status === "active").map(c => c.agentId).filter(Boolean)
  );

  const [name, setName]           = useState(editing?.name ?? "");
  const [desc, setDesc]           = useState(editing?.description ?? "");
  const [agentId, setAgentId]     = useState(editing?.agentId ? String(editing.agentId) : "");
  const [fromNum, setFromNum]     = useState(editing?.fromNumber ?? "");
  const [delay, setDelay]         = useState(String(editing?.callDelaySeconds ?? 5));
  const [maxAtt, setMaxAtt]       = useState(String(editing?.maxAttempts ?? 1));
  const [mappings, setMappings]   = useState<FieldMappings>(
    editing?.fieldMappings
      ? {
          phone: (editing.fieldMappings as Record<string,string>)["phone"] ?? "phone",
          name:  (editing.fieldMappings as Record<string,string>)["name"]  ?? "name",
          email: (editing.fieldMappings as Record<string,string>)["email"] ?? "email",
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
          <DialogTitle>{editing ? "Edit Campaign" : "New Campaign"}</DialogTitle>
          <DialogDescription>
            {editing ? "Update campaign settings." : "Set up a new outbound calling campaign."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Campaign Name <span className="text-destructive">*</span></Label>
            <Input placeholder="e.g. Summer Leads Q3" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label>Description <span className="text-muted-foreground/50">(optional)</span></Label>
            <Input placeholder="Short description…" value={desc} onChange={e => setDesc(e.target.value)} />
          </div>

          {/* Agent selector */}
          <div className="space-y-1.5">
            <Label>Agent <span className="text-destructive">*</span></Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger>
                <SelectValue placeholder="Select an agent…" />
              </SelectTrigger>
              <SelectContent>
                {(agents ?? []).map(a => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    <span className="flex items-center gap-2">
                      {a.name}
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${liveAgentIds.has(a.id) ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                        {liveAgentIds.has(a.id) ? "LIVE" : "NOT LIVE"}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Field Mappings */}
          <div className="space-y-2">
            <Label>Field Mappings <span className="text-[10px] text-muted-foreground/50">(CSV column → role)</span></Label>
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

          {/* Numeric settings */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Call Delay (seconds)</Label>
              <Input type="number" min={0} value={delay} onChange={e => setDelay(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label>Max Attempts</Label>
              <Input type="number" min={1} value={maxAtt} onChange={e => setMaxAtt(e.target.value)} className="h-8 text-xs" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>From Number <span className="text-muted-foreground/50">(optional override)</span></Label>
            <Input placeholder="+1234567890" value={fromNum} onChange={e => setFromNum(e.target.value)} className="h-8 text-xs" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || update.isPending}>
              {create.isPending || update.isPending ? "Saving…" : editing ? "Save Changes" : "Create Campaign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  const [createOpen, setCreateOpen]       = useState(false);
  const [editing, setEditing]             = useState<Campaign | null>(null);
  const [deleting, setDeleting]           = useState<Campaign | null>(null);
  const qc                                = useQueryClient();
  const { toast }                         = useToast();
  const deleteMutation                    = useDeleteCampaign();
  const { data: campaigns, isLoading }    = useListCampaigns();

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

  return (
    <div className="p-6 max-w-6xl mx-auto">

      {/* ── Section 1: Meta Campaign Leads ── */}
      <MetaLeadsSection campaigns={campaigns ?? []} />

      {/* ── Section 2: Campaigns ── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Campaigns</h1>
          <p className="text-sm text-muted-foreground/60 mt-0.5">Auto-call leads from Instagram ads or website forms</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="h-8 text-xs gap-2">
          <Plus className="h-3.5 w-3.5" /> New Campaign
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-card border border-border rounded-2xl h-52 animate-pulse" />
          ))}
        </div>
      ) : !campaigns?.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-center bg-card border border-border rounded-2xl">
          <div className="h-12 w-12 rounded-2xl bg-elevated border border-border flex items-center justify-center mb-4">
            <Megaphone className="h-5 w-5 text-muted-foreground/30" />
          </div>
          <h3 className="text-sm font-semibold text-foreground mb-1">No campaigns yet</h3>
          <p className="text-xs text-muted-foreground/50 max-w-xs mb-5">
            Create a campaign to auto-call leads from Instagram ads or any website form.
          </p>
          <Button onClick={() => setCreateOpen(true)} className="h-8 text-xs gap-2">
            <Plus className="h-3.5 w-3.5" /> Create first campaign
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 relative">
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
  );
}
