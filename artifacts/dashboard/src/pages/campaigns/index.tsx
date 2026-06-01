import { useState } from "react";
import { Link } from "wouter";
import {
  useListCampaigns, useCreateCampaign, useUpdateCampaign, useDeleteCampaign,
  getListCampaignsQueryKey,
  useListMetaCampaignLeads,
  useRetryCampaignLead,
  useRedialCampaignNoPickup,
  getListMetaCampaignLeadsQueryKey,
} from "@workspace/api-client-react";
import type { Campaign, CampaignCreate } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useListAgents } from "@workspace/api-client-react";
import type { Agent } from "@workspace/api-client-react";
import {
  Megaphone, Plus, MoreHorizontal, Trash2, Pencil, Copy, Check, ChevronRight,
  Phone, RotateCcw, PhoneCall,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function statusDot(status: string) {
  if (status === "active")  return "bg-foreground/50";
  if (status === "paused")  return "bg-muted-foreground/30";
  return "bg-muted-foreground/20";
}

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

function CopiedToken({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const webhookUrl = `${window.location.origin}${BASE}/api/webhooks/lead/${token}`;
  function copy() {
    void navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={e => { e.preventDefault(); copy(); }}
      className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors font-mono"
      title="Click to copy webhook URL"
    >
      {copied ? <Check className="h-3 w-3 text-foreground/50" /> : <Copy className="h-3 w-3" />}
      <span className="truncate max-w-[200px]">/webhooks/lead/{token.slice(0, 8)}…</span>
    </button>
  );
}

// ── Campaign form dialog ───────────────────────────────────────────────────────

type FormState = {
  name: string; description: string; agentId: string;
  phoneField: string; nameField: string; emailField: string;
  fromNumber: string; callDelaySeconds: string; maxAttempts: string;
};
function defaultForm(): FormState {
  return { name: "", description: "", agentId: "", phoneField: "phone", nameField: "name", emailField: "email", fromNumber: "", callDelaySeconds: "5", maxAttempts: "1" };
}

function CampaignFormDialog({ open, onClose, editing }: { open: boolean; onClose: () => void; editing: Campaign | null }) {
  const [form, setForm] = useState<FormState>(editing ? {
    name:             editing.name,
    description:      editing.description ?? "",
    agentId:          String(editing.agentId ?? ""),
    phoneField:       (editing.fieldMappings as Record<string,string>)["phone"] ?? "phone",
    nameField:        (editing.fieldMappings as Record<string,string>)["name"]  ?? "name",
    emailField:       (editing.fieldMappings as Record<string,string>)["email"] ?? "email",
    fromNumber:       editing.fromNumber ?? "",
    callDelaySeconds: String(editing.callDelaySeconds),
    maxAttempts:      String(editing.maxAttempts),
  } : defaultForm());

  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateCampaign();
  const update = useUpdateCampaign();
  const { data: agents } = useListAgents();
  function set(k: keyof FormState, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function submit() {
    if (!form.name.trim())       { toast({ title: "Name required", variant: "destructive" }); return; }
    if (!form.agentId)           { toast({ title: "Select an agent", variant: "destructive" }); return; }
    if (!form.phoneField.trim()) { toast({ title: "Phone field mapping required", variant: "destructive" }); return; }
    const fieldMappings: Record<string, string> = { phone: form.phoneField.trim() };
    if (form.nameField.trim())  fieldMappings["name"]  = form.nameField.trim();
    if (form.emailField.trim()) fieldMappings["email"] = form.emailField.trim();
    const payload: CampaignCreate = {
      name:             form.name.trim(),
      description:      form.description.trim() || undefined,
      agentId:          parseInt(form.agentId, 10),
      fieldMappings,
      fromNumber:       form.fromNumber.trim() || undefined,
      callDelaySeconds: parseInt(form.callDelaySeconds, 10) || 5,
      maxAttempts:      parseInt(form.maxAttempts, 10) || 1,
    };
    try {
      if (editing) { await update.mutateAsync({ id: editing.id, data: payload }); toast({ title: "Campaign updated" }); }
      else         { await create.mutateAsync({ data: payload }); toast({ title: "Campaign created" }); }
      await qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      onClose();
    } catch { toast({ title: "Error saving campaign", variant: "destructive" }); }
  }

  const busy = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit campaign" : "New campaign"}</DialogTitle>
          <DialogDescription>Configure the auto-call campaign and lead field mappings.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div><Label>Campaign name</Label><Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Q2 Instagram Leads" /></div>
          <div><Label>Description</Label><Input value={form.description} onChange={e => set("description", e.target.value)} placeholder="Optional" /></div>
          <div>
            <Label>Agent</Label>
            <select className="w-full border border-input bg-background rounded-md px-3 py-2 text-sm" value={form.agentId} onChange={e => set("agentId", e.target.value)}>
              <option value="">Select agent…</option>
              {agents?.map((a: Agent) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="border border-border rounded-xl p-3.5 space-y-3 bg-elevated/30">
            <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest">Field Mappings</p>
            <p className="text-xs text-muted-foreground/60">Enter the field name from your lead source that contains each value.</p>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">Phone field *</Label><Input value={form.phoneField} onChange={e => set("phoneField", e.target.value)} placeholder="phone" className="h-8 text-sm" /></div>
              <div><Label className="text-xs">Name field</Label><Input value={form.nameField} onChange={e => set("nameField", e.target.value)} placeholder="name" className="h-8 text-sm" /></div>
              <div><Label className="text-xs">Email field</Label><Input value={form.emailField} onChange={e => set("emailField", e.target.value)} placeholder="email" className="h-8 text-sm" /></div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Call delay (seconds)</Label><Input type="number" value={form.callDelaySeconds} onChange={e => set("callDelaySeconds", e.target.value)} min={0} max={3600} /></div>
            <div><Label>Max attempts</Label><Input type="number" value={form.maxAttempts} onChange={e => set("maxAttempts", e.target.value)} min={1} max={10} /></div>
          </div>
          <div><Label>From number (optional override)</Label><Input value={form.fromNumber} onChange={e => set("fromNumber", e.target.value)} placeholder="Uses provider default if empty" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create campaign"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Campaign card ─────────────────────────────────────────────────────────────

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const [menuOpen,   setMenuOpen]   = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen,   setEditOpen]   = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const del = useDeleteCampaign();
  const upd = useUpdateCampaign();

  async function toggleActive() {
    await upd.mutateAsync({ id: campaign.id, data: { isActive: !campaign.isActive } });
    await qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
  }
  async function confirmDelete() {
    try {
      await del.mutateAsync({ id: campaign.id });
      await qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      toast({ title: "Campaign deleted" });
    } catch { toast({ title: "Delete failed", variant: "destructive" }); }
  }

  const successRate = campaign.totalLeads > 0
    ? Math.round((campaign.calledLeads / campaign.totalLeads) * 100) : 0;

  return (
    <>
      <Link href={`/app/campaigns/${campaign.id}`}>
        <div className="group bg-card border border-border rounded-2xl p-5 hover:border-border/80 hover:bg-elevated/20 transition-all cursor-pointer">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-9 w-9 rounded-xl bg-elevated border border-border flex items-center justify-center shrink-0">
                <Megaphone className="h-4 w-4 text-muted-foreground/60" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-sm text-foreground truncate">{campaign.name}</h3>
                {campaign.description && <p className="text-xs text-muted-foreground/50 truncate mt-0.5">{campaign.description}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">
                <span className={`h-1.5 w-1.5 rounded-full ${statusDot(campaign.status)}`} />
                {campaign.status}
              </span>
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground/50 hover:text-foreground" onClick={e => e.preventDefault()}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={e => { e.preventDefault(); setEditOpen(true); setMenuOpen(false); }}>
                    <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-foreground focus:text-foreground" onClick={e => { e.preventDefault(); setDeleteOpen(true); setMenuOpen(false); }}>
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Total leads", value: campaign.totalLeads },
              { label: "Called",      value: campaign.calledLeads },
              { label: "Called %",    value: `${successRate}%` },
            ].map(stat => (
              <div key={stat.label} className="bg-elevated border border-border/40 rounded-xl p-2.5">
                <p className="text-[10px] text-muted-foreground/50 mb-1 uppercase tracking-widest font-semibold">{stat.label}</p>
                <p className="text-base font-bold text-foreground tabular-nums">{stat.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <CopiedToken token={campaign.webhookToken} />
            <div className="flex items-center gap-2">
              <Switch
                checked={campaign.isActive}
                onCheckedChange={() => { void toggleActive(); }}
                onClick={e => e.preventDefault()}
                className="scale-90"
              />
              <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
            </div>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground/40">Created {formatDistanceToNow(new Date(campaign.createdAt), { addSuffix: true })}</p>
        </div>
      </Link>

      <CampaignFormDialog open={editOpen} onClose={() => setEditOpen(false)} editing={campaign} />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete campaign?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete <strong>{campaign.name}</strong> and all its leads. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-foreground hover:bg-foreground">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Meta Leads section ────────────────────────────────────────────────────────

type MetaFilter = "all" | "no_pickup" | "inbound" | "callbacks" | string;

const STATIC_FILTERS: { key: MetaFilter; label: string }[] = [
  { key: "all",       label: "All" },
  { key: "no_pickup", label: "No Pickup" },
  { key: "inbound",   label: "Inbound" },
  { key: "callbacks", label: "Callbacks" },
];

function MetaLeadsSection({ campaigns }: { campaigns: Campaign[] }) {
  const [filter, setFilter]   = useState<MetaFilter>("all");
  const [page, setPage]       = useState(0);
  const PAGE_SIZE             = 20;
  const qc                    = useQueryClient();
  const { toast }             = useToast();
  const retry                 = useRetryCampaignLead();
  const redialMutation        = useRedialCampaignNoPickup();

  const { data, isLoading } = useListMetaCampaignLeads(
    { filter, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
  );

  const leads  = (data as { leads: MetaLeadItem[] } | MetaLeadItem[] | undefined);
  const items  = Array.isArray(leads) ? leads : (leads as { leads?: MetaLeadItem[] })?.leads ?? [];
  const total  = Array.isArray(leads) ? items.length : (leads as { total?: number })?.total ?? 0;

  // Collect dynamic dispositions from current data (across all pages conceptually)
  const dynamicDispositions = [...new Set(items.filter(i => i.disposition).map(i => i.disposition!))];

  const allFilters = [
    ...STATIC_FILTERS,
    ...dynamicDispositions
      .filter(d => !STATIC_FILTERS.some(f => f.key === d))
      .map(d => ({ key: d, label: d.charAt(0).toUpperCase() + d.slice(1) })),
  ];

  async function handleRedialAll() {
    if (!campaigns.length) return;
    const uniqueCampaignIds = [...new Set(items.filter(i => i.callStatus === "failed" || i.callStatus === "skipped").map(i => i.campaignId))];
    let total = 0;
    for (const cid of uniqueCampaignIds) {
      try {
        const res = await redialMutation.mutateAsync({ id: cid });
        total += (res as { queued?: number })?.queued ?? 0;
      } catch { /* continue */ }
    }
    await qc.invalidateQueries({ queryKey: getListMetaCampaignLeadsQueryKey() });
    toast({ title: `Redial queued: ${total} leads` });
  }

  async function handleRetry(campaignId: number, leadId: number) {
    try {
      await retry.mutateAsync({ id: campaignId, leadId });
      await qc.invalidateQueries({ queryKey: getListMetaCampaignLeadsQueryKey() });
      toast({ title: "Retry queued" });
    } catch { toast({ title: "Retry failed", variant: "destructive" }); }
  }

  if (!isLoading && items.length === 0 && filter === "all") return null;

  return (
    <div className="mb-10">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Meta Campaign Leads</h2>
          <p className="text-xs text-muted-foreground/60 mt-0.5">Webhook &amp; Instagram Ads leads across all campaigns</p>
        </div>
        {filter === "no_pickup" && items.some(i => i.callStatus === "failed" || i.callStatus === "skipped") && (
          <Button
            size="sm" variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={() => void handleRedialAll()}
            disabled={redialMutation.isPending}
          >
            <PhoneCall className="h-3 w-3" />
            {redialMutation.isPending ? "Redialing…" : "Redial All No Pickup"}
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
        {isLoading ? (
          <div className="divide-y divide-border">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="px-4 py-3 flex gap-4 animate-pulse">
                <div className="h-4 w-28 bg-muted rounded" />
                <div className="h-4 w-24 bg-muted rounded" />
                <div className="h-4 w-16 bg-muted rounded ml-auto" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="py-10 text-center">
            <Phone className="h-7 w-7 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground/50">
              {filter === "inbound" ? "Inbound call tracking coming soon" : `No ${filter === "all" ? "" : filter.replace("_", " ") + " "}leads`}
            </p>
          </div>
        ) : (
          <>
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-elevated/40">
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Phone</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest hidden sm:table-cell">Name</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest hidden md:table-cell">Campaign</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Status</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest hidden lg:table-cell">Disposition</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest hidden md:table-cell">Date</th>
                  <th className="px-4 py-2.5 w-16" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((lead) => (
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
                    <td className="px-4 py-3 hidden md:table-cell">
                      <Link href={`/app/campaigns/${lead.campaignId}`}>
                        <span className="text-xs text-foreground hover:underline cursor-pointer">{lead.campaignName}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={`text-[10px] ${callStatusBadge(lead.callStatus)}`}>
                        {lead.callStatus}
                      </Badge>
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
                          onClick={() => void handleRetry(lead.campaignId, lead.id)}
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
  );
}

type MetaLeadItem = {
  id: number;
  campaignId: number;
  campaignName: string;
  phone: string;
  name: string | null;
  callStatus: string;
  disposition: string | null;
  createdAt: string;
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data: campaigns, isLoading } = useListCampaigns();

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Section 1: Meta Campaign Leads */}
      <MetaLeadsSection campaigns={campaigns ?? []} />

      {/* Section 2: Campaign management */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Campaigns</h1>
          <p className="text-sm text-muted-foreground/60 mt-0.5">Auto-call leads from Instagram ads or website forms</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="h-8 text-xs gap-2">
          <Plus className="h-3.5 w-3.5" /> New campaign
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="bg-card border border-border rounded-2xl h-48 animate-pulse" />)}
        </div>
      ) : !campaigns?.length ? (
        <div className="flex flex-col items-center justify-center py-24 text-center bg-card border border-border rounded-2xl">
          <div className="h-12 w-12 rounded-2xl bg-elevated border border-border flex items-center justify-center mb-3">
            <Megaphone className="h-5 w-5 text-muted-foreground/40" />
          </div>
          <h3 className="text-sm font-semibold text-foreground mb-1">No campaigns yet</h3>
          <p className="text-xs text-muted-foreground/60 max-w-sm mb-5">Create a campaign to auto-call leads from Instagram ads or any website form.</p>
          <Button onClick={() => setCreateOpen(true)} className="h-8 text-xs gap-2">
            <Plus className="h-3.5 w-3.5" /> Create first campaign
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {campaigns.map(c => <CampaignCard key={c.id} campaign={c} />)}
        </div>
      )}

      <CampaignFormDialog open={createOpen} onClose={() => setCreateOpen(false)} editing={null} />
    </div>
  );
}
