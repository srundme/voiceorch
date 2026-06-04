import { useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Copy, Check, Phone, Megaphone, Eye, ChevronDown, ChevronRight,
  RotateCcw, PhoneIncoming, PhoneCall, Clock, Layers, MoreHorizontal,
  Pencil, Trash2, Users, BarChart3, Search,
  X, CheckCircle2, PlayCircle, PauseCircle, XCircle,
  Download, Target, ArrowRight
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtDuration(secs: number | null | undefined): string {
  if (!secs) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation();
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="text-muted-foreground/30 hover:text-muted-foreground transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ── Status badges ─────────────────────────────────────────────────────────

function CallStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
    pending:   { label: "Pending",   icon: <PauseCircle className="h-3 w-3" />,   cls: "bg-muted/50 text-muted-foreground border-border" },
    calling:   { label: "Calling",   icon: <PhoneCall className="h-3 w-3" />,     cls: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
    completed: { label: "Completed", icon: <CheckCircle2 className="h-3 w-3" />,  cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
    failed:    { label: "Failed",    icon: <XCircle className="h-3 w-3" />,       cls: "bg-red-500/10 text-red-500 border-red-500/20" },
    skipped:   { label: "Skipped",   icon: <X className="h-3 w-3" />,             cls: "bg-muted/30 text-muted-foreground/60 border-border" },
  };
  const cfg = map[status] ?? { label: status, icon: null, cls: "bg-muted/50 text-muted-foreground border-border" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-md border", cfg.cls)}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

function CampaignStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; dot: string }> = {
    draft:     { label: "Draft",     dot: "bg-muted-foreground/40" },
    active:    { label: "Active",    dot: "bg-emerald-500" },
    paused:    { label: "Paused",    dot: "bg-amber-500" },
    completed: { label: "Completed", dot: "bg-blue-500" },
    archived:  { label: "Archived",  dot: "bg-muted-foreground/20" },
  };
  const cfg = map[status] ?? { label: status, dot: "bg-muted-foreground/40" };
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground border border-border bg-muted/40 px-2 py-0.5 rounded-full">
      <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
      {cfg.label}
    </span>
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

// ── Filter pills ──────────────────────────────────────────────────────────

const FILTERS = [
  { key: "all",       label: "All",        icon: Phone },
  { key: "no_pickup", label: "No Pickup",  icon: PhoneCall },
  { key: "inbound",   label: "Inbound",    icon: PhoneIncoming },
  { key: "callbacks", label: "Callbacks",  icon: Clock },
];

function FilterBar({ active, onChange, extra }: {
  active: string;
  onChange: (f: string) => void;
  extra: string[];
}) {
  const all = [
    ...FILTERS,
    ...extra.map(d => ({ key: d, label: d.replace(/_/g, " "), icon: null })),
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {all.map(f => (
        <button
          key={f.key}
          onClick={() => onChange(f.key)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all",
            active === f.key
              ? "bg-foreground text-background"
              : "bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-muted/60"
          )}
        >
          {f.icon && <f.icon className="h-3 w-3" />}
          {f.label}
        </button>
      ))}
    </div>
  );
}

// ── Lead row ──────────────────────────────────────────────────────────────

function LeadRow({ lead, filter }: { lead: MetaLeadItem; filter: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        className="group hover:bg-muted/20 transition-colors cursor-pointer"
        onClick={() => setOpen(o => !o)}
      >
        <td className="px-4 py-3">
          <CallStatusBadge status={lead.callStatus} />
          {filter === "callbacks" && lead.hasCallback && (
            <span className={cn(
              "ml-1.5 text-[10px] px-1.5 py-0.5 rounded border",
              lead.callbackStatus === "done"
                ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                : "bg-blue-500/10 text-blue-500 border-blue-500/20"
            )}>
              {lead.callbackStatus === "done" ? "Done" : "Pending"}
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-[11px] text-muted-foreground whitespace-nowrap">
          {format(new Date(lead.createdAt), "MMM d, HH:mm")}
        </td>
        <td className="px-4 py-3 hidden sm:table-cell">
          <span className="text-[11px] font-mono text-muted-foreground/60">
            {lead.fromNumber ?? "—"}
          </span>
        </td>
        <td className="px-4 py-3">
          <span className="text-[11px] font-mono text-foreground">{lead.toNumber ?? lead.phone}</span>
        </td>
        <td className="px-4 py-3 hidden md:table-cell">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {fmtDuration(lead.durationSeconds)}
          </span>
        </td>
        <td className="px-4 py-3 hidden lg:table-cell">
          <Link href={`${BASE}/app/campaigns/${lead.campaignId}`} onClick={e => e.stopPropagation()}>
            <span className="text-[11px] text-muted-foreground/60 hover:text-foreground hover:underline">
              {lead.campaignName}
            </span>
          </Link>
        </td>
        <td className="px-4 py-3 w-16">
          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {lead.callId && (
              <Link href={`${BASE}/app/calls/${lead.callId}`} onClick={e => e.stopPropagation()}>
                <Eye className="h-3.5 w-3.5 text-muted-foreground/50 hover:text-foreground" />
              </Link>
            )}
            {open
              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/40" />
              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
            }
          </div>
        </td>
      </tr>
      {open && (
        <tr className="bg-muted/10 border-b border-border/30">
          <td colSpan={7} className="px-6 py-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <p className="text-[10px] text-muted-foreground/40 uppercase tracking-widest mb-0.5">Name</p>
                <p className="text-foreground">{lead.name ?? "—"}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground/40 uppercase tracking-widest mb-0.5">Disposition</p>
                <p className="text-foreground">{lead.disposition ?? "—"}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground/40 uppercase tracking-widest mb-0.5">Source</p>
                <p className="text-foreground capitalize">{lead.source.replace(/_/g, " ")}</p>
              </div>
              {lead.callId && (
                <div>
                  <p className="text-[10px] text-muted-foreground/40 uppercase tracking-widest mb-0.5">Call</p>
                  <Link href={`${BASE}/app/calls/${lead.callId}`}>
                    <p className="text-primary hover:underline">#{lead.callId}</p>
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

// ── Lead Activity section ─────────────────────────────────────────────────

function LeadActivitySection() {
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const PAGE_SIZE = 20;

  const qc = useQueryClient();
  const { toast } = useToast();
  const redial = useRedialCampaignNoPickup();
  const retry = useRetryCampaignLead();

  const { data, isLoading } = useListMetaCampaignLeads({
    filter, limit: PAGE_SIZE, offset: page * PAGE_SIZE,
  });

  const raw = data as { leads?: MetaLeadItem[]; total?: number } | MetaLeadItem[] | undefined;
  const items = Array.isArray(raw) ? (raw as MetaLeadItem[]) : ((raw as { leads?: MetaLeadItem[] })?.leads ?? []);
  const total = Array.isArray(raw) ? items.length : ((raw as { total?: number })?.total ?? 0);

  const visible = search.trim()
    ? items.filter(i =>
        i.phone?.toLowerCase().includes(search.toLowerCase()) ||
        i.name?.toLowerCase().includes(search.toLowerCase()) ||
        i.toNumber?.toLowerCase().includes(search.toLowerCase())
      )
    : items;

  const extraFilters = [...new Set(
    items
      .filter(i => i.disposition && !["pending","calling","completed","failed","skipped"].includes(i.disposition))
      .map(i => i.disposition!)
  )];

  function changeFilter(f: string) { setFilter(f); setPage(0); }

  async function handleRedialAll() {
    const ids = [...new Set(items.map(i => i.campaignId))];
    let queued = 0;
    for (const id of ids) {
      try { queued += ((await redial.mutateAsync({ id })) as { queued?: number })?.queued ?? 0; } catch { /* skip */ }
    }
    await qc.invalidateQueries({ queryKey: getListMetaCampaignLeadsQueryKey() });
    toast({ title: "Redial queued", description: `${queued} lead${queued !== 1 ? "s" : ""} scheduled` });
  }

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden mb-6">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-border">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/40">
                Campaign Leads
              </span>
            </div>
            <h2 className="text-base font-semibold text-foreground leading-none">Lead Activity</h2>
            <p className="text-xs text-muted-foreground/50 mt-1">Calls triggered via Meta Lead Ads &amp; webhooks</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground">
              <Download className="h-3 w-3" /> Export
            </Button>
            <span className="text-[11px] text-muted-foreground/50 tabular-nums">
              {isLoading ? "…" : total} leads
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FilterBar active={filter} onChange={changeFilter} extra={extraFilters} />
          <div className="relative ml-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/30" />
            <Input
              type="search"
              placeholder="Search leads…"
              className="pl-8 h-8 text-xs w-44 bg-muted/30 border-border/60"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="divide-y divide-border/40">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5">
              <Skeleton className="h-5 w-16 rounded-md" />
              <Skeleton className="h-3 w-24 rounded" />
              <Skeleton className="h-3 w-28 rounded ml-auto" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="py-16 text-center">
          <div className="h-11 w-11 rounded-2xl bg-muted border border-border flex items-center justify-center mx-auto mb-3">
            <Phone className="h-5 w-5 text-muted-foreground/20" />
          </div>
          <p className="text-sm font-medium text-muted-foreground/40">
            {search ? "No leads match your search" : "No campaign leads yet"}
          </p>
          <p className="text-xs text-muted-foreground/30 mt-1">
            {search ? "Try a different query" : "Leads from Meta ads and webhooks will appear here"}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/60 bg-muted/20">
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium text-muted-foreground/40 uppercase tracking-widest">Status</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium text-muted-foreground/40 uppercase tracking-widest">Time</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium text-muted-foreground/40 uppercase tracking-widest hidden sm:table-cell">From</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium text-muted-foreground/40 uppercase tracking-widest">To</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium text-muted-foreground/40 uppercase tracking-widest hidden md:table-cell">Duration</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium text-muted-foreground/40 uppercase tracking-widest hidden lg:table-cell">Campaign</th>
                  <th className="px-4 py-2.5 w-16" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {visible.map(lead => (
                  <LeadRow key={lead.id} lead={lead} filter={filter} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-border/60 bg-muted/10">
              <p className="text-xs text-muted-foreground/40">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </p>
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}

          {filter === "no_pickup" && items.length > 0 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-amber-500/5">
              <p className="text-xs text-amber-600/70">{items.length} no-pickup — redial to retry all</p>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 border-amber-500/20 text-amber-600 hover:bg-amber-500/10"
                onClick={() => void handleRedialAll()}
                disabled={redial.isPending}
              >
                <RotateCcw className="h-3 w-3" /> Redial All
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Campaign row ──────────────────────────────────────────────────────────

function CampaignRow({
  campaign,
  onEdit,
  onDelete,
}: {
  campaign: Campaign;
  onEdit: (c: Campaign) => void;
  onDelete: (c: Campaign) => void;
}) {
  const [, navigate] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const calledPct = campaign.totalLeads > 0
    ? Math.round((campaign.calledLeads / campaign.totalLeads) * 100)
    : 0;
  const webhookUrl = `${window.location.origin}${BASE}/api/webhooks/lead/${campaign.webhookToken}`;

  return (
    <div
      className="group flex items-center gap-4 px-5 py-4 hover:bg-muted/20 transition-colors cursor-pointer border-b border-border/40 last:border-0 relative"
      onClick={() => navigate(`${BASE}/app/campaigns/${campaign.id}`)}
    >
      {/* Icon */}
      <div className="h-9 w-9 rounded-xl bg-muted border border-border flex items-center justify-center shrink-0">
        <Megaphone className="h-4 w-4 text-muted-foreground/40" />
      </div>

      {/* Name + description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-foreground truncate">{campaign.name}</span>
          <CampaignStatusBadge status={campaign.status} />
        </div>
        {campaign.description ? (
          <p className="text-xs text-muted-foreground/50 truncate mt-0.5">{campaign.description}</p>
        ) : (
          <p className="text-xs text-muted-foreground/30 mt-0.5">{formatDistanceToNow(new Date(campaign.createdAt), { addSuffix: true })}</p>
        )}
      </div>

      {/* Stats */}
      <div className="hidden sm:flex items-center gap-6 shrink-0">
        <div className="text-center">
          <p className="text-[9px] text-muted-foreground/30 uppercase tracking-widest">Total</p>
          <p className="text-sm font-semibold text-foreground mt-0.5 tabular-nums">{campaign.totalLeads}</p>
        </div>
        <div className="text-center">
          <p className="text-[9px] text-muted-foreground/30 uppercase tracking-widest">Called</p>
          <p className="text-sm font-semibold text-foreground mt-0.5 tabular-nums">{campaign.calledLeads}</p>
        </div>
        <div className="text-center">
          <p className="text-[9px] text-muted-foreground/30 uppercase tracking-widest">Attempts</p>
          <p className="text-sm font-semibold text-foreground mt-0.5 tabular-nums">{campaign.maxAttempts}</p>
        </div>
      </div>

      {/* Progress */}
      {campaign.totalLeads > 0 && (
        <div className="hidden md:flex items-center gap-2 w-28 shrink-0">
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-foreground/20 rounded-full transition-all"
              style={{ width: `${calledPct}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground/40 w-7 text-right font-mono">{calledPct}%</span>
        </div>
      )}

      {/* Webhook copy */}
      <div
        className="hidden xl:flex items-center gap-1.5 max-w-[200px] shrink-0"
        onClick={e => e.stopPropagation()}
      >
        <code className="text-[9px] font-mono text-muted-foreground/30 truncate">{webhookUrl}</code>
        <CopyButton text={webhookUrl} />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
          onClick={e => { e.stopPropagation(); setMenuOpen(m => !m); }}
        >
          <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground/50" />
        </button>
        <ChevronRight className="h-4 w-4 text-muted-foreground/30" />
      </div>

      {/* Dropdown */}
      {menuOpen && (
        <div
          className="absolute z-20 right-12 top-8 bg-card border border-border rounded-xl shadow-xl py-1 min-w-[130px]"
          onClick={e => e.stopPropagation()}
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-muted transition-colors"
            onClick={() => { setMenuOpen(false); onEdit(campaign); }}
          >
            <Pencil className="h-3.5 w-3.5 text-muted-foreground/60" /> Edit
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-red-500/5 transition-colors"
            onClick={() => { setMenuOpen(false); onDelete(campaign); }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ── Campaign Form Dialog ──────────────────────────────────────────────────

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
    setName(""); setDesc(""); setAgentId(""); setFromNum(""); setDelay("5"); setMaxAtt("1");
    setMappings(DEFAULT_MAPPINGS);
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
          <DialogTitle className="text-base">{editing ? "Edit Campaign" : "New Campaign"}</DialogTitle>
          <DialogDescription className="text-xs">
            {editing ? "Update campaign settings." : "Set up a new outbound calling campaign."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={e => void handleSubmit(e)} className="space-y-4 mt-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Campaign Name <span className="text-destructive">*</span></Label>
            <Input placeholder="e.g. Summer Leads Q3" value={name} onChange={e => setName(e.target.value)} className="h-9 text-xs" required />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description <span className="text-muted-foreground/40">(optional)</span></Label>
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
                      <span className={cn(
                        "text-[10px] font-medium px-1.5 py-0.5 rounded",
                        liveAgentIds.has(a.id) ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"
                      )}>
                        {liveAgentIds.has(a.id) ? "LIVE" : "—"}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Field Mappings <span className="text-[10px] text-muted-foreground/40">(CSV column → role)</span></Label>
            <div className="grid grid-cols-3 gap-2">
              {(["phone", "name", "email"] as const).map(role => (
                <div key={role}>
                  <p className="text-[10px] text-muted-foreground/40 uppercase mb-1">{role}</p>
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
            <Label className="text-xs">From Number <span className="text-muted-foreground/40">(optional override)</span></Label>
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

  const totalCampaigns = campaigns?.length ?? 0;
  const activeCampaigns = campaigns?.filter(c => c.status === "active").length ?? 0;
  const totalLeads = campaigns?.reduce((s, c) => s + c.totalLeads, 0) ?? 0;
  const totalCalled = campaigns?.reduce((s, c) => s + c.calledLeads, 0) ?? 0;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-5 border-b border-border shrink-0">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Target className="h-3.5 w-3.5 text-muted-foreground/40" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/40">
                Voice Campaigns
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground leading-none">
              Campaigns
            </h1>
            <p className="text-xs text-muted-foreground/50 mt-1.5">
              Auto-call leads from Instagram ads, website forms, or CSV uploads
            </p>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 text-muted-foreground">
              <BarChart3 className="h-3.5 w-3.5" /> Analytics
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" /> New Campaign
            </Button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Campaigns", value: totalCampaigns, icon: <Megaphone className="h-4 w-4 text-muted-foreground/40" />, accent: "" },
            { label: "Active",          value: activeCampaigns, icon: <PlayCircle className="h-4 w-4 text-emerald-500" />,       accent: activeCampaigns > 0 ? "text-emerald-500" : "" },
            { label: "Total Leads",     value: totalLeads,      icon: <Users className="h-4 w-4 text-muted-foreground/40" />,    accent: "" },
            { label: "Leads Called",    value: totalCalled,     icon: <PhoneCall className="h-4 w-4 text-blue-500" />,           accent: totalCalled > 0 ? "text-blue-500" : "" },
          ].map(stat => (
            <div key={stat.label} className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3">
              <div className="h-8 w-8 rounded-lg bg-muted border border-border flex items-center justify-center shrink-0">
                {stat.icon}
              </div>
              <div>
                <p className="text-[9px] text-muted-foreground/40 uppercase tracking-widest leading-none mb-1">{stat.label}</p>
                <p className={cn("text-xl font-semibold tabular-nums leading-none", stat.accent || "text-foreground")}>
                  {stat.value}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-5">
        {/* Lead Activity */}
        <LeadActivitySection />

        {/* Campaigns List */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          {/* Section header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Campaigns</h2>
              <p className="text-xs text-muted-foreground/40 mt-0.5">Manage and monitor your campaigns</p>
            </div>
            {!isLoading && (campaigns?.length ?? 0) > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="h-3 w-3" /> New
              </Button>
            )}
          </div>

          {/* Column headers */}
          {!isLoading && (campaigns?.length ?? 0) > 0 && (
            <div className="hidden sm:flex items-center gap-4 px-5 py-2 bg-muted/20 border-b border-border/40">
              <div className="w-9 shrink-0" />
              <div className="flex-1 text-[10px] font-medium text-muted-foreground/30 uppercase tracking-widest">Campaign</div>
              <div className="flex items-center gap-6 shrink-0 pr-2">
                <span className="text-[10px] font-medium text-muted-foreground/30 uppercase tracking-widest w-10 text-center">Total</span>
                <span className="text-[10px] font-medium text-muted-foreground/30 uppercase tracking-widest w-10 text-center">Called</span>
                <span className="text-[10px] font-medium text-muted-foreground/30 uppercase tracking-widest w-14 text-center">Attempts</span>
              </div>
              <div className="hidden md:block w-28 shrink-0" />
              <div className="w-16 shrink-0" />
            </div>
          )}

          {isLoading ? (
            <div className="divide-y divide-border/40">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <Skeleton className="h-9 w-9 rounded-xl" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-40 rounded" />
                    <Skeleton className="h-2.5 w-24 rounded" />
                  </div>
                  <Skeleton className="hidden sm:block h-3 w-32 rounded" />
                </div>
              ))}
            </div>
          ) : !campaigns?.length ? (
            <div className="py-20 text-center">
              <div className="h-12 w-12 rounded-2xl bg-muted border border-border flex items-center justify-center mx-auto mb-4">
                <Megaphone className="h-5 w-5 text-muted-foreground/20" />
              </div>
              <h3 className="text-sm font-semibold text-foreground mb-1">No campaigns yet</h3>
              <p className="text-xs text-muted-foreground/40 max-w-xs mx-auto mb-5">
                Create a campaign to auto-call leads from Instagram ads, website forms, or CSV uploads.
              </p>
              <Button className="h-8 text-xs gap-2" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Create first campaign
              </Button>
            </div>
          ) : (
            campaigns.map(c => (
              <CampaignRow
                key={c.id}
                campaign={c}
                onEdit={setEditing}
                onDelete={setDeleting}
              />
            ))
          )}
        </div>
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
  );
}
