import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Facebook, Plus, Trash2, Copy, Link2, Phone, Zap, Users,
  CheckCircle2, XCircle, Clock, AlertCircle, ChevronDown, ChevronUp, Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  id:           number;
  integrationId:number;
  leadgenId:    string;
  phone:        string | null;
  name:         string | null;
  email:        string | null;
  callStatus:   string;
  callAttempts: number;
  createdAt:    string;
}

function useIntegrations() {
  return useQuery<{ integrations: MetaIntegration[] }>({
    queryKey: ["meta-integrations"],
    queryFn:  async () => {
      const r = await fetch("/api/meta/integrations");
      if (!r.ok) throw new Error("Failed to load integrations");
      return r.json();
    },
  });
}

function useLeads(integrationId?: number) {
  return useQuery<{ leads: MetaLead[] }>({
    queryKey: ["meta-leads", integrationId],
    enabled:  integrationId !== undefined,
    queryFn:  async () => {
      const r = await fetch(`/api/meta/leads?integrationId=${integrationId}`);
      if (!r.ok) throw new Error("Failed to load leads");
      return r.json();
    },
    refetchInterval: 15_000,
  });
}

const WEBHOOK_BASE = `${window.location.origin}/api/meta/webhook`;

function callStatusBadge(status: string) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pending:   { label: "Pending",   variant: "secondary" },
    calling:   { label: "Calling",   variant: "default" },
    completed: { label: "Completed", variant: "outline" },
    failed:    { label: "Failed",    variant: "destructive" },
  };
  const s = map[status] ?? { label: status, variant: "secondary" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

function IntegrationCard({
  integration,
  agents,
  phoneNumbers,
  onDelete,
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
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          agentId:       agentId ? Number(agentId) : null,
          phoneNumberId: phoneId ? Number(phoneId) : null,
        }),
      });
      if (!r.ok) throw new Error("Failed to update");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meta-integrations"] });
      toast({ title: "Saved", description: "Integration updated." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async (active: boolean) => {
      const r = await fetch(`/api/meta/integrations/${integration.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ active }),
      });
      if (!r.ok) throw new Error("Failed to update");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meta-integrations"] }),
  });

  const leads = leadsData?.leads ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Facebook className="w-4 h-4 text-blue-500 shrink-0" />
              {integration.formName ?? integration.formId}
            </CardTitle>
            {integration.pageName && (
              <CardDescription className="mt-0.5">{integration.pageName}</CardDescription>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Switch
              checked={integration.active}
              onCheckedChange={(v) => toggleMutation.mutate(v)}
            />
            <Button size="icon" variant="ghost" className="text-destructive h-8 w-8" onClick={() => onDelete(integration.id)}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Webhook URL */}
        <div className="flex items-center gap-2 mt-2">
          <code className="flex-1 text-xs bg-muted rounded px-2 py-1.5 font-mono truncate">
            {WEBHOOK_BASE}/{integration.webhookToken}
          </code>
          <Button size="icon" variant="outline" className="h-7 w-7 shrink-0" onClick={copyWebhookUrl}>
            <Copy className="w-3 h-3" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Agent + phone assignment */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">AI Agent</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select agent" />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id.toString()}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Phone Number</Label>
            <Select value={phoneId} onValueChange={setPhoneId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select number" />
              </SelectTrigger>
              <SelectContent>
                {phoneNumbers.map((p) => (
                  <SelectItem key={p.id} value={p.id.toString()}>{p.number}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
          {updateMutation.isPending ? "Saving…" : "Save Assignment"}
        </Button>

        {/* Lead log toggle */}
        <button
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {leads.length} leads received
        </button>

        {open && leads.length > 0 && (
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Name</th>
                  <th className="text-left px-3 py-2 font-medium">Phone</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-left px-3 py-2 font-medium">Received</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {leads.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2">{l.name ?? "—"}</td>
                    <td className="px-3 py-2 font-mono">{l.phone ?? "—"}</td>
                    <td className="px-3 py-2">{callStatusBadge(l.callStatus)}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(l.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {open && leads.length === 0 && (
          <p className="text-xs text-muted-foreground">No leads yet — waiting for Meta to send lead events.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function MetaLeadsPage() {
  const { data, isLoading } = useIntegrations();
  const { data: agentsData }  = useListAgents({});
  const { data: phonesData }  = useListPhoneNumbers();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [addOpen,  setAddOpen]  = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ pageName: "", formId: "", formName: "", accessToken: "" });

  const createMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/meta/integrations", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(form),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed to create"); }
      return r.json() as Promise<{ webhookUrl: string; verifyToken: string }>;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["meta-integrations"] });
      setAddOpen(false);
      setForm({ pageName: "", formId: "", formName: "", accessToken: "" });
      navigator.clipboard.writeText(data.webhookUrl).catch(() => {});
      toast({
        title: "Integration created",
        description: "Webhook URL copied to clipboard. Paste it in your Meta Lead Ads setup.",
      });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/meta/integrations/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meta-integrations"] });
      setDeleteId(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const integrations = data?.integrations ?? [];
  const agents       = (agentsData ?? []).map((a) => ({ id: a.id, name: a.name }));
  const phoneNumbers = (phonesData ?? []).map((p) => ({ id: p.id, number: p.number ?? "" }));

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Facebook className="w-6 h-6 text-blue-500" /> Meta Lead Ads
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Automatically call leads the moment they fill your Meta Lead Ad form.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="w-4 h-4 mr-2" /> Connect Form
        </Button>
      </div>

      {/* Setup guide */}
      <Card className="border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/20">
        <CardContent className="pt-4 pb-4">
          <ol className="text-sm space-y-1.5 text-blue-800 dark:text-blue-300 list-decimal list-inside">
            <li>Create an integration below and copy the webhook URL</li>
            <li>In Meta Events Manager → Leads Center, add the webhook URL</li>
            <li>Use the <strong>Verify Token</strong> (your webhook token) when Meta asks</li>
            <li>Assign an AI agent and phone number to the integration</li>
            <li>New leads will be called automatically within seconds</li>
          </ol>
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : integrations.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed rounded-lg">
          <Facebook className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No integrations yet</p>
          <p className="text-muted-foreground text-sm mt-1">Connect a Meta Lead Ad form to start auto-calling leads.</p>
          <Button className="mt-4" onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> Connect First Form
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {integrations.map((i) => (
            <IntegrationCard
              key={i.id}
              integration={i}
              agents={agents}
              phoneNumbers={phoneNumbers}
              onDelete={setDeleteId}
            />
          ))}
        </div>
      )}

      {/* Add integration dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Connect Meta Lead Ad Form</DialogTitle>
            <DialogDescription>
              Enter your Meta page details and a Page Access Token. The webhook URL will be generated automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Page Name <span className="text-muted-foreground">(optional)</span></Label>
                <Input placeholder="My Business Page" value={form.pageName}
                  onChange={(e) => setForm({ ...form, pageName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Form Name <span className="text-muted-foreground">(optional)</span></Label>
                <Input placeholder="Lead Gen Form" value={form.formName}
                  onChange={(e) => setForm({ ...form, formName: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Form ID <span className="text-red-500">*</span></Label>
              <Input placeholder="123456789012345" value={form.formId}
                onChange={(e) => setForm({ ...form, formId: e.target.value })} />
              <p className="text-xs text-muted-foreground">Found in Meta Lead Ads → Form Library → Form ID</p>
            </div>
            <div className="space-y-1.5">
              <Label>Page Access Token <span className="text-red-500">*</span></Label>
              <Input type="password" placeholder="EAAxxxxxx…" value={form.accessToken}
                onChange={(e) => setForm({ ...form, accessToken: e.target.value })} />
              <p className="text-xs text-muted-foreground">Get from Meta Graph Explorer with pages_manage_ads permission</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              disabled={!form.formId || !form.accessToken || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "Connecting…" : "Connect Form"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Integration?</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop receiving new leads from this form. Existing lead records will be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => deleteId !== null && deleteMutation.mutate(deleteId)}
            >
              {deleteMutation.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
