import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Facebook, Plus, Trash2, Copy, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useListAgents, useListPhoneNumbers } from "@workspace/api-client-react";

interface MetaIntegration {
  id:            number;
  pageName:      string | null;
  formId:        string;
  formName:      string | null;
  agentId:       number | null;
  phoneNumberId: number | null;
  webhookToken:  string;
  active:        boolean;
  createdAt:     string;
  agentName:     string | null;
}
interface MetaLead {
  id:            number;
  integrationId: number;
  leadgenId:     string;
  phone:         string | null;
  name:          string | null;
  email:         string | null;
  callStatus:    string;
  callAttempts:  number;
  createdAt:     string;
}

function useIntegrations() {
  return useQuery<{ integrations: MetaIntegration[] }>({
    queryKey: ["meta-integrations"],
    queryFn: async () => {
      const r = await fetch("/api/meta/integrations");
      if (!r.ok) throw new Error("Failed to load integrations");
      return r.json();
    },
  });
}
function useLeads(integrationId?: number) {
  return useQuery<{ leads: MetaLead[] }>({
    queryKey: ["meta-leads", integrationId],
    enabled: integrationId !== undefined,
    queryFn: async () => {
      const r = await fetch(`/api/meta/leads?integrationId=${integrationId}`);
      if (!r.ok) throw new Error("Failed to load leads");
      return r.json();
    },
    refetchInterval: 15_000,
  });
}

const WEBHOOK_BASE = `${window.location.origin}/api/meta/webhook`;

function callStatusBadge(status: string) {
  const cls =
    status === "completed" ? "text-foreground/60 border-foreground/[0.07] bg-foreground/[0.05]" :
    status === "failed"    ? "text-muted-foreground/60 border-border bg-transparent" :
    status === "calling"   ? "text-foreground/70 border-border bg-elevated" :
                             "text-muted-foreground/40 border-border/50 bg-transparent";
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${cls}`}>{status}</span>;
}

function IntegrationCard({
  integration, agents, phoneNumbers, onDelete,
}: {
  integration: MetaIntegration;
  agents: { id: number; name: string }[];
  phoneNumbers: { id: number; number: string }[];
  onDelete: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState<string>(integration.agentId?.toString() ?? "");
  const [phoneId, setPhoneId] = useState<string>(integration.phoneNumberId?.toString() ?? "");
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: leadsData } = useLeads(open ? integration.id : undefined);

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(`${WEBHOOK_BASE}/${integration.webhookToken}`);
    toast({ title: "Copied", description: "Webhook URL copied to clipboard." });
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/meta/integrations/${integration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agentId ? Number(agentId) : null, phoneNumberId: phoneId ? Number(phoneId) : null }),
      });
      if (!r.ok) throw new Error("Failed to update");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["meta-integrations"] }); toast({ title: "Saved" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async (active: boolean) => {
      const r = await fetch(`/api/meta/integrations/${integration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      if (!r.ok) throw new Error("Failed to update");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meta-integrations"] }),
  });

  const leads = leadsData?.leads ?? [];

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-4 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{integration.formName ?? integration.formId}</p>
          {integration.pageName && <p className="text-xs text-muted-foreground/60 mt-0.5">{integration.pageName}</p>}
          <div className="flex items-center gap-2 mt-2">
            <code className="flex-1 text-[11px] bg-elevated border border-border/50 rounded-lg px-2.5 py-1.5 font-mono truncate text-muted-foreground/70">
              {WEBHOOK_BASE}/{integration.webhookToken}
            </code>
            <button onClick={copyWebhookUrl} className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg border border-border bg-elevated hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
              <Copy className="w-3 h-3" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Switch checked={integration.active} onCheckedChange={v => toggleMutation.mutate(v)} />
          <button onClick={() => onDelete(integration.id)} className="h-7 w-7 flex items-center justify-center rounded-lg border border-border bg-elevated hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="border-t border-border/50 px-5 py-4 space-y-3 bg-elevated/20">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground/60">AI Agent</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger className="h-8 text-xs bg-card border-border text-foreground"><SelectValue placeholder="Select agent" /></SelectTrigger>
              <SelectContent>{agents.map(a => <SelectItem key={a.id} value={a.id.toString()} className="text-xs">{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground/60">Phone Number</Label>
            <Select value={phoneId} onValueChange={setPhoneId}>
              <SelectTrigger className="h-8 text-xs bg-card border-border text-foreground"><SelectValue placeholder="Select number" /></SelectTrigger>
              <SelectContent>{phoneNumbers.map(p => <SelectItem key={p.id} value={p.id.toString()} className="text-xs">{p.number}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending} className="h-7 text-xs">
          {updateMutation.isPending ? "Saving…" : "Save Assignment"}
        </Button>

        <button className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-foreground transition-colors w-full pt-1" onClick={() => setOpen(o => !o)}>
          {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {leads.length} leads received
        </button>

        {open && leads.length > 0 && (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="border-b border-border">
                <tr>
                  {["Name","Phone","Status","Received"].map(h => <th key={h} className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {leads.map(l => (
                  <tr key={l.id} className="hover:bg-elevated/40 transition-colors">
                    <td className="px-3 py-2 text-foreground/70">{l.name ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground/60">{l.phone ?? "—"}</td>
                    <td className="px-3 py-2">{callStatusBadge(l.callStatus)}</td>
                    <td className="px-3 py-2 text-muted-foreground/40">{new Date(l.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {open && leads.length === 0 && (
          <p className="text-xs text-muted-foreground/50">No leads yet — waiting for Meta to send lead events.</p>
        )}
      </div>
    </div>
  );
}

export default function MetaLeadsPage() {
  const { data, isLoading } = useIntegrations();
  const { data: agentsData } = useListAgents({});
  const { data: phonesData } = useListPhoneNumbers();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [addOpen,  setAddOpen]  = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ pageName: "", formId: "", formName: "", accessToken: "" });

  const createMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/meta/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed to create"); }
      return r.json() as Promise<{ webhookUrl: string; verifyToken: string }>;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["meta-integrations"] });
      setAddOpen(false);
      setForm({ pageName: "", formId: "", formName: "", accessToken: "" });
      navigator.clipboard.writeText(data.webhookUrl).catch(() => {});
      toast({ title: "Integration created", description: "Webhook URL copied to clipboard." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/meta/integrations/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["meta-integrations"] }); setDeleteId(null); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const integrations = data?.integrations ?? [];
  const agents       = (agentsData ?? []).map(a => ({ id: a.id, name: a.name }));
  const phoneNumbers = (phonesData ?? []).map(p => ({ id: p.id, number: p.number ?? "" }));

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-elevated border border-border flex items-center justify-center shrink-0">
              <Facebook className="w-3.5 h-3.5 text-muted-foreground/60" />
            </div>
            Meta Lead Ads
          </h1>
          <p className="text-sm text-muted-foreground/60 mt-1">Automatically call leads the moment they fill your Meta Lead Ad form.</p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="gap-2 h-8 text-xs">
          <Plus className="w-3.5 h-3.5" /> Connect Form
        </Button>
      </div>

      {/* Setup guide */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3">Setup Guide</p>
        <ol className="space-y-2">
          {[
            "Create an integration below and copy the webhook URL",
            "In Meta Events Manager → Leads Center, add the webhook URL",
            <>Use the <strong className="text-foreground/70 font-semibold">Verify Token</strong> (your webhook token) when Meta asks</>,
            "Assign an AI agent and phone number to the integration",
            "New leads will be called automatically within seconds",
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="h-5 w-5 rounded-full bg-elevated border border-border/60 flex items-center justify-center text-[10px] font-semibold text-muted-foreground/60 shrink-0 mt-px">{i + 1}</span>
              <span className="text-sm text-muted-foreground/70 leading-snug pt-px">{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2].map(i => <div key={i} className="h-32 rounded-2xl bg-card border border-border animate-pulse" />)}</div>
      ) : integrations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-card border border-border rounded-2xl">
          <div className="h-12 w-12 rounded-2xl bg-elevated border border-border flex items-center justify-center mb-3">
            <Facebook className="w-5 h-5 text-muted-foreground/40" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">No integrations yet</p>
          <p className="text-xs text-muted-foreground/50 mt-1 max-w-xs">Connect a Meta Lead Ad form to start auto-calling leads.</p>
          <Button className="mt-5 h-8 text-xs gap-2" onClick={() => setAddOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> Connect First Form
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {integrations.map(i => (
            <IntegrationCard key={i.id} integration={i} agents={agents} phoneNumbers={phoneNumbers} onDelete={setDeleteId} />
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Connect Meta Lead Ad Form</DialogTitle>
            <DialogDescription>Enter your Meta page details and a Page Access Token.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Page Name <span className="text-muted-foreground">(optional)</span></Label>
                <Input placeholder="My Business Page" value={form.pageName} onChange={e => setForm({ ...form, pageName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Form Name <span className="text-muted-foreground">(optional)</span></Label>
                <Input placeholder="Lead Gen Form" value={form.formName} onChange={e => setForm({ ...form, formName: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Form ID <span className="text-foreground">*</span></Label>
              <Input placeholder="123456789012345" value={form.formId} onChange={e => setForm({ ...form, formId: e.target.value })} />
              <p className="text-xs text-muted-foreground/50">Found in Meta Lead Ads → Form Library → Form ID</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Page Access Token <span className="text-foreground">*</span></Label>
              <Input type="password" placeholder="EAAxxxxxx…" value={form.accessToken} onChange={e => setForm({ ...form, accessToken: e.target.value })} />
              <p className="text-xs text-muted-foreground/50">Get from Meta Graph Explorer with pages_manage_ads permission</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button disabled={!form.formId || !form.accessToken || createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? "Connecting…" : "Connect Form"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={o => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Integration?</AlertDialogTitle>
            <AlertDialogDescription>This will stop receiving new leads from this form. Existing lead records will be deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => deleteId !== null && deleteMutation.mutate(deleteId)}>
              {deleteMutation.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
