import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch, useListAgents } from "@workspace/api-client-react";
import { AppPageHeader } from "@/components/app-page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Copy, CheckCircle2, MessageCircle, Plus, Trash2, Pencil, ExternalLink,
} from "lucide-react";

const API = "/api";

type WaConnection = {
  id: string;
  name: string;
  agentId: number;
  agentName?: string | null;
  campaignId: number | null;
  inboundToken: string;
  inboundWebhookUrl: string;
  outboundWebhookUrl: string | null;
  outboundSecret?: string;
  outboundSecretHint: string | null;
  requestCallEnabled: boolean;
  postCallEnabled: boolean;
  buttonIds: string[];
  active: boolean;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastError: string | null;
};

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      {copied ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
      {label && <span>{copied ? "Copied" : label}</span>}
    </button>
  );
}

const SAMPLE_INBOUND = `{
  "phone": "9876543210",
  "event": "request_call",
  "name": "Customer Name",
  "button_id": "request_a_call"
}`;

const SAMPLE_OUTBOUND = `{
  "event": "call.ended",
  "action": "send_whatsapp",
  "phone": "+919876543210",
  "call_id": 1234,
  "summary": "…",
  "disposition": "Booked",
  "template_hint": "booking_confirmed",
  "meeting_time": "20 Jul 2026, 10:00 am"
}`;

export default function WhatsAppPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: agentsData } = useListAgents({});
  const agents = useMemo(
    () => (agentsData ?? []).map((a) => ({ id: a.id, name: a.name })),
    [agentsData],
  );

  const { data, isLoading } = useQuery({
    queryKey: ["whatsapp-connections"],
    queryFn: () => customFetch<{ connections: WaConnection[] }>(`${API}/whatsapp/connections`),
  });
  const connections = data?.connections ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [editConn, setEditConn] = useState<WaConnection | null>(null);
  const [name, setName] = useState("WhatsApp");
  const [agentId, setAgentId] = useState<number | "">("");
  const [outboundUrl, setOutboundUrl] = useState("");
  const [requestCall, setRequestCall] = useState(true);
  const [postCall, setPostCall] = useState(true);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const resetForm = () => {
    setName("WhatsApp");
    setAgentId(agents[0]?.id ?? "");
    setOutboundUrl("");
    setRequestCall(true);
    setPostCall(true);
  };

  const createMut = useMutation({
    mutationFn: () =>
      customFetch<WaConnection>(`${API}/whatsapp/connections`, {
        method: "POST",
        body: JSON.stringify({
          name,
          agentId: Number(agentId),
          outboundWebhookUrl: outboundUrl.trim() || null,
          requestCallEnabled: requestCall,
          postCallEnabled: postCall,
        }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: (row) => {
      setCreatedSecret(row.outboundSecret ?? null);
      void qc.invalidateQueries({ queryKey: ["whatsapp-connections"] });
      toast({ title: "WhatsApp connection created" });
      setCreateOpen(false);
      resetForm();
    },
    onError: (err: Error) => toast({ title: "Create failed", description: err.message, variant: "destructive" }),
  });

  const patchMut = useMutation({
    mutationFn: (payload: { id: string; body: Record<string, unknown> }) =>
      customFetch<WaConnection>(`${API}/whatsapp/connections/${payload.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload.body),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["whatsapp-connections"] });
      setEditConn(null);
      toast({ title: "Saved" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      customFetch(`${API}/whatsapp/connections/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["whatsapp-connections"] });
      toast({ title: "Deleted" });
    },
  });

  return (
    <div className="space-y-6">
      <AppPageHeader
        title="WhatsApp"
        description="Request a Call button → AI dials. After each call, SnapServe notifies your webhook so you can send a WhatsApp template via Interakt, Wati, AiSensy, or any BSP."
        actions={
          <Button
            size="sm"
            onClick={() => {
              resetForm();
              setAgentId(agents[0]?.id ?? "");
              setCreateOpen(true);
            }}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Add connection
          </Button>
        }
      />

      {createdSecret && (
        <div className="mx-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <p className="font-medium text-amber-200">Outbound signing secret (copy now — shown once)</p>
          <div className="mt-2 flex items-center gap-2 font-mono text-xs break-all">
            <span>{createdSecret}</span>
            <CopyButton text={createdSecret} label="Copy" />
          </div>
          <Button variant="ghost" size="sm" className="mt-2 h-7 text-xs" onClick={() => setCreatedSecret(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 px-6">
        <div className="rounded-lg border border-border/60 bg-card/40 p-4 space-y-2">
          <h3 className="text-sm font-medium">Inbound — Request a Call</h3>
          <p className="text-xs text-muted-foreground">
            Point your BSP / Zapier button webhook at the SnapServe inbound URL. When someone taps
            “Request a Call”, we dial your AI agent.
          </p>
          <pre className="text-[11px] bg-muted/40 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">{SAMPLE_INBOUND}</pre>
        </div>
        <div className="rounded-lg border border-border/60 bg-card/40 p-4 space-y-2">
          <h3 className="text-sm font-medium">Outbound — after each AI call</h3>
          <p className="text-xs text-muted-foreground">
            SnapServe POSTs this JSON to your outbound URL. Map <code className="text-[10px]">template_hint</code> to
            your WhatsApp template and send to <code className="text-[10px]">phone</code>.
          </p>
          <pre className="text-[11px] bg-muted/40 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">{SAMPLE_OUTBOUND}</pre>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground px-6">Loading…</p>
      ) : connections.length === 0 ? (
        <div className="px-6">
          <EmptyState
            icon={<MessageCircle className="w-5 h-5" />}
            title="No WhatsApp connections"
            description="Connect your WhatsApp stack via webhook — works with any Indian BSP."
            action={{
              label: "Add connection",
              onClick: () => {
                resetForm();
                setAgentId(agents[0]?.id ?? "");
                setCreateOpen(true);
              },
            }}
          />
        </div>
      ) : (
        <div className="space-y-3 px-6 pb-8">
          {connections.map((c) => (
            <div key={c.id} className="rounded-lg border border-border/60 bg-card/30 p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">{c.name}</h3>
                    <Badge variant="outline" className="text-[10px]">
                      {c.active ? "Active" : "Paused"}
                    </Badge>
                    {c.requestCallEnabled && (
                      <Badge variant="secondary" className="text-[10px]">Request a Call</Badge>
                    )}
                    {c.postCallEnabled && (
                      <Badge variant="secondary" className="text-[10px]">Post-call</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Agent: {c.agentName ?? `#${c.agentId}`}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-8" onClick={() => {
                    setEditConn(c);
                    setName(c.name);
                    setAgentId(c.agentId);
                    setOutboundUrl(c.outboundWebhookUrl ?? "");
                    setRequestCall(c.requestCallEnabled);
                    setPostCall(c.postCallEnabled);
                  }}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-destructive"
                    onClick={() => {
                      if (confirm("Delete this WhatsApp connection?")) deleteMut.mutate(c.id);
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <div>
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Inbound webhook URL</Label>
                  <div className="mt-1 flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
                    <code className="text-[11px] flex-1 break-all">{c.inboundWebhookUrl}</code>
                    <CopyButton text={c.inboundWebhookUrl} label="Copy" />
                  </div>
                </div>
                {c.outboundWebhookUrl && (
                  <div>
                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Your outbound URL</Label>
                    <div className="mt-1 flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
                      <code className="text-[11px] flex-1 break-all">{c.outboundWebhookUrl}</code>
                      <a href={c.outboundWebhookUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                )}
              </div>

              {(c.lastInboundAt || c.lastOutboundAt || c.lastError) && (
                <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                  {c.lastInboundAt && <span>Last inbound: {new Date(c.lastInboundAt).toLocaleString()}</span>}
                  {c.lastOutboundAt && <span>Last outbound: {new Date(c.lastOutboundAt).toLocaleString()}</span>}
                  {c.lastError && <span className="text-red-400">Error: {c.lastError}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add WhatsApp connection</DialogTitle>
            <DialogDescription>
              Works with Interakt, Wati, AiSensy, Gupshup, Zapier — any tool that can POST a webhook.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input className="mt-1 h-9" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">AI agent to dial *</Label>
              <select
                className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Select agent</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Your outbound webhook URL (optional)</Label>
              <Input
                className="mt-1 h-9"
                placeholder="https://hooks.zapier.com/… or your BSP endpoint"
                value={outboundUrl}
                onChange={(e) => setOutboundUrl(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                After each AI call we POST here so you can send a WhatsApp template.
              </p>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Request a Call → dial AI</Label>
              <Switch checked={requestCall} onCheckedChange={setRequestCall} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Post-call WhatsApp notify</Label>
              <Switch checked={postCall} onCheckedChange={setPostCall} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              disabled={!agentId || createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={!!editConn} onOpenChange={(o) => !o && setEditConn(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit WhatsApp connection</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input className="mt-1 h-9" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Outbound webhook URL</Label>
              <Input
                className="mt-1 h-9"
                value={outboundUrl}
                onChange={(e) => setOutboundUrl(e.target.value)}
                placeholder="https://…"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Request a Call → dial AI</Label>
              <Switch checked={requestCall} onCheckedChange={setRequestCall} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Post-call WhatsApp notify</Label>
              <Switch checked={postCall} onCheckedChange={setPostCall} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Active</Label>
              <Switch
                checked={editConn?.active ?? true}
                onCheckedChange={(v) => editConn && setEditConn({ ...editConn, active: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditConn(null)}>Cancel</Button>
            <Button
              disabled={!editConn || patchMut.isPending}
              onClick={() => {
                if (!editConn) return;
                patchMut.mutate({
                  id: editConn.id,
                  body: {
                    name,
                    outboundWebhookUrl: outboundUrl.trim() || null,
                    requestCallEnabled: requestCall,
                    postCallEnabled: postCall,
                    active: editConn.active,
                  },
                });
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
