import { useState } from "react";
import { Link } from "wouter";
import {
  useListCampaigns,
  useCreateCampaign,
  useUpdateCampaign,
  useDeleteCampaign,
  getListCampaignsQueryKey,
} from "@workspace/api-client-react";
import type { Campaign, CampaignCreate } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
  Megaphone, Plus, MoreHorizontal, Trash2, Pencil, Copy, Check,
  Users, PhoneCall, ChevronRight, Zap,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function statusColor(status: string) {
  if (status === "active")  return "bg-zinc-50 text-zinc-700 border-zinc-200";
  if (status === "paused")  return "bg-zinc-50 text-zinc-700 border-zinc-200";
  return "bg-gray-50 text-gray-500 border-gray-200";
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
      onClick={(e) => { e.preventDefault(); copy(); }}
      className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors font-mono"
      title="Click to copy webhook URL"
    >
      {copied ? <Check className="h-3 w-3 text-zinc-500" /> : <Copy className="h-3 w-3" />}
      <span className="truncate max-w-[200px]">/webhooks/lead/{token.slice(0, 8)}…</span>
    </button>
  );
}

type FormState = {
  name: string;
  description: string;
  agentId: string;
  phoneField: string;
  nameField: string;
  emailField: string;
  fromNumber: string;
  callDelaySeconds: string;
  maxAttempts: string;
};

function defaultForm(): FormState {
  return {
    name: "", description: "", agentId: "",
    phoneField: "phone", nameField: "name", emailField: "email",
    fromNumber: "", callDelaySeconds: "5", maxAttempts: "1",
  };
}

function CampaignFormDialog({
  open, onClose, editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: Campaign | null;
}) {
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
    if (!form.name.trim())    { toast({ title: "Name required", variant: "destructive" }); return; }
    if (!form.agentId)        { toast({ title: "Select an agent", variant: "destructive" }); return; }
    if (!form.phoneField.trim()) { toast({ title: "Phone field mapping required", variant: "destructive" }); return; }

    const fieldMappings: Record<string, string> = { phone: form.phoneField.trim() };
    if (form.nameField.trim())  fieldMappings["name"]  = form.nameField.trim();
    if (form.emailField.trim()) fieldMappings["email"] = form.emailField.trim();

    const payload: CampaignCreate = {
      name:              form.name.trim(),
      description:       form.description.trim() || undefined,
      agentId:           parseInt(form.agentId, 10),
      fieldMappings,
      fromNumber:        form.fromNumber.trim() || undefined,
      callDelaySeconds:  parseInt(form.callDelaySeconds, 10) || 5,
      maxAttempts:       parseInt(form.maxAttempts, 10) || 1,
    };

    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, data: payload });
        toast({ title: "Campaign updated" });
      } else {
        await create.mutateAsync({ data: payload });
        toast({ title: "Campaign created" });
      }
      await qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      onClose();
    } catch {
      toast({ title: "Error saving campaign", variant: "destructive" });
    }
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
          <div>
            <Label>Campaign name</Label>
            <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Q2 Instagram Leads" />
          </div>
          <div>
            <Label>Description</Label>
            <Input value={form.description} onChange={e => set("description", e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <Label>Agent</Label>
            <select
              className="w-full border border-input bg-background rounded-md px-3 py-2 text-sm"
              value={form.agentId}
              onChange={e => set("agentId", e.target.value)}
            >
              <option value="">Select agent…</option>
              {agents?.map((a: Agent) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div className="border rounded-lg p-3 space-y-3 bg-muted/40">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Field Mappings</p>
            <p className="text-xs text-muted-foreground">Enter the field name from your lead source that contains each value.</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Phone field *</Label>
                <Input value={form.phoneField} onChange={e => set("phoneField", e.target.value)} placeholder="phone" className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Name field</Label>
                <Input value={form.nameField} onChange={e => set("nameField", e.target.value)} placeholder="name" className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Email field</Label>
                <Input value={form.emailField} onChange={e => set("emailField", e.target.value)} placeholder="email" className="h-8 text-sm" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Call delay (seconds)</Label>
              <Input type="number" value={form.callDelaySeconds} onChange={e => set("callDelaySeconds", e.target.value)} min={0} max={3600} />
            </div>
            <div>
              <Label>Max attempts</Label>
              <Input type="number" value={form.maxAttempts} onChange={e => set("maxAttempts", e.target.value)} min={1} max={10} />
            </div>
          </div>
          <div>
            <Label>From number (optional override)</Label>
            <Input value={form.fromNumber} onChange={e => set("fromNumber", e.target.value)} placeholder="Uses provider default if empty" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create campaign"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
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
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  }

  const successRate = campaign.totalLeads > 0
    ? Math.round((campaign.calledLeads / campaign.totalLeads) * 100)
    : 0;

  return (
    <>
      <Link href={`/app/campaigns/${campaign.id}`}>
        <div className="group bg-white border border-gray-100 rounded-2xl p-5 hover:shadow-md transition-all cursor-pointer">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2.5 rounded-xl bg-zinc-50 text-zinc-600 shrink-0">
                <Megaphone className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-[15px] text-gray-900 truncate">{campaign.name}</h3>
                {campaign.description && (
                  <p className="text-xs text-gray-400 truncate mt-0.5">{campaign.description}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className={`text-[10px] font-medium ${statusColor(campaign.status)}`}>
                {campaign.status}
              </Badge>
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => e.preventDefault()}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={e => { e.preventDefault(); setEditOpen(true); setMenuOpen(false); }}>
                    <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-red-600 focus:text-red-600"
                    onClick={e => { e.preventDefault(); setDeleteOpen(true); setMenuOpen(false); }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div className="bg-gray-50 rounded-xl p-2.5">
              <p className="text-[11px] text-gray-400 mb-0.5">Total leads</p>
              <p className="text-lg font-bold text-gray-900">{campaign.totalLeads}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-2.5">
              <p className="text-[11px] text-gray-400 mb-0.5">Called</p>
              <p className="text-lg font-bold text-gray-900">{campaign.calledLeads}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-2.5">
              <p className="text-[11px] text-gray-400 mb-0.5">Called %</p>
              <p className="text-lg font-bold text-gray-900">{successRate}%</p>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <CopiedToken token={campaign.webhookToken} />
            <div className="flex items-center gap-2">
              <Switch
                checked={campaign.isActive}
                onCheckedChange={e => { void toggleActive(); }}
                onClick={e => e.preventDefault()}
                className="scale-90"
              />
              <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
            </div>
          </div>

          <p className="mt-2 text-[10px] text-gray-300">
            Created {formatDistanceToNow(new Date(campaign.createdAt), { addSuffix: true })}
          </p>
        </div>
      </Link>

      <CampaignFormDialog open={editOpen} onClose={() => setEditOpen(false)} editing={campaign} />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{campaign.name}</strong> and all its leads. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function CampaignsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data: campaigns, isLoading } = useListCampaigns();

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Auto-call leads from Instagram ads or website forms
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> New campaign
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <div key={i} className="bg-white border border-gray-100 rounded-2xl p-5 h-48 animate-pulse" />
          ))}
        </div>
      ) : !campaigns?.length ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="p-4 rounded-2xl bg-zinc-50 text-zinc-400 mb-4">
            <Megaphone className="h-8 w-8" />
          </div>
          <h3 className="text-lg font-semibold text-gray-700 mb-1">No campaigns yet</h3>
          <p className="text-sm text-gray-400 max-w-sm mb-6">
            Create a campaign to auto-call leads from Instagram ads or any website form.
          </p>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Create first campaign
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
