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
  ArrowRight, PhoneIncoming, Send,
} from "lucide-react";

const API = "/api";

type WaConnection = {
  id: string;
  name: string;
  agentId: number;
  agentName?: string | null;
  campaignId: number | null;
  provider: "vobiz" | "webhook";
  vobizWabaId: string | null;
  vobizChannelId: string | null;
  vobizPhone: string | null;
  postCallTemplate: string | null;
  midCallEnabled: boolean;
  rules?: WhatsappRule[];
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

function SetupGuide({ hasConnection }: { hasConnection: boolean }) {
  return (
    <div className="mx-6 space-y-5">
      <div className="rounded-lg border border-border/60 bg-card/30 p-5">
        <h2 className="text-sm font-semibold">How to set this up</h2>
        <p className="mt-1 text-xs text-muted-foreground max-w-2xl">
          SnapServe sends WhatsApp messages natively via <strong>SnapServe Engine</strong> or connects to custom webhooks (Zapier / n8n / BSP).
        </p>

        <ol className="mt-4 space-y-4">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background text-[11px] font-semibold">1</span>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">Create a connection in SnapServe</p>
              <p className="text-xs text-muted-foreground">
                Click <strong>Add connection</strong>, pick the AI agent that should call the customer.
                Optionally paste your Zapier / Make / n8n / BSP webhook URL for post-call messages.
                {hasConnection ? " Then copy the inbound URL from your connection below." : ""}
              </p>
            </div>
          </li>

          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background text-[11px] font-semibold">2</span>
            <div className="min-w-0 space-y-1.5">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <PhoneIncoming className="w-3.5 h-3.5 text-muted-foreground" />
                Request a Call → AI dials (inbound)
              </p>
              <p className="text-xs text-muted-foreground">
                In your WhatsApp tool, create a template with a button (e.g. “Request a Call”).
                When that button is tapped, send a webhook to SnapServe:
              </p>
              <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1">
                <li>
                  <strong>Zapier / Make:</strong> Trigger = WhatsApp button / interactive reply → Action = Webhooks POST
                  to your SnapServe inbound URL with the JSON below.
                </li>
                <li>
                  <strong>Interakt / Wati / AiSensy:</strong> Use their “webhook on button click” or “automation” →
                  POST the customer phone to the SnapServe inbound URL.
                </li>
                <li>
                  Required field: <code className="text-[10px] bg-muted/50 px-1 rounded">phone</code>.
                  Set <code className="text-[10px] bg-muted/50 px-1 rounded">event</code> to{" "}
                  <code className="text-[10px] bg-muted/50 px-1 rounded">request_call</code>{" "}
                  or use button id <code className="text-[10px] bg-muted/50 px-1 rounded">request_a_call</code>.
                </li>
              </ul>
              <pre className="text-[11px] bg-muted/40 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">{SAMPLE_INBOUND}</pre>
              <p className="text-[11px] text-muted-foreground">
                Tip: test with curl — you should get <code className="text-[10px]">action: &quot;dialed&quot;</code> and see a ringing call in Call Logs.
              </p>
            </div>
          </li>

          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background text-[11px] font-semibold">3</span>
            <div className="min-w-0 space-y-1.5">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5 text-muted-foreground" />
                After the AI call → send WhatsApp (outbound)
              </p>
              <p className="text-xs text-muted-foreground">
                Create a Zap / automation that starts when SnapServe POSTs to your outbound URL.
                Map fields to your approved WhatsApp template and send to{" "}
                <code className="text-[10px] bg-muted/50 px-1 rounded">phone</code>.
              </p>
              <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1">
                <li>
                  Use <code className="text-[10px] bg-muted/50 px-1 rounded">template_hint</code> to pick the template:
                  <code className="text-[10px] bg-muted/50 px-1 rounded ml-1">call_summary</code>,{" "}
                  <code className="text-[10px] bg-muted/50 px-1 rounded">booking_confirmed</code>, or{" "}
                  <code className="text-[10px] bg-muted/50 px-1 rounded">callback_scheduled</code>.
                </li>
                <li>
                  For bookings, fill template variables from{" "}
                  <code className="text-[10px] bg-muted/50 px-1 rounded">meeting_time</code> /{" "}
                  <code className="text-[10px] bg-muted/50 px-1 rounded">meet_link</code>.
                </li>
                <li>
                  Optional: verify <code className="text-[10px] bg-muted/50 px-1 rounded">X-SnapServe-Signature</code>{" "}
                  with the outbound secret shown once when you create the connection.
                </li>
              </ul>
              <pre className="text-[11px] bg-muted/40 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">{SAMPLE_OUTBOUND}</pre>
            </div>
          </li>

          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background text-[11px] font-semibold">4</span>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">Test end-to-end</p>
              <p className="text-xs text-muted-foreground">
                Send yourself the WhatsApp template → tap Request a Call → confirm the AI dials →
                finish the call → confirm your BSP sends the follow-up template.
                Check <strong>Last inbound</strong> / <strong>Last outbound</strong> on the connection card if something fails.
              </p>
            </div>
          </li>
        </ol>

        <div className="mt-5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground border-t border-border/50 pt-4">
          <span>Flow:</span>
          <span className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-2 py-0.5">
            WhatsApp button <ArrowRight className="w-3 h-3" /> SnapServe dials AI
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-2 py-0.5">
            Call ends <ArrowRight className="w-3 h-3" /> Your webhook sends WhatsApp
          </span>
        </div>
      </div>
    </div>
  );
}

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
  const [provider, setProvider] = useState<"vobiz" | "webhook">("vobiz");
  const [vobizWabaId, setVobizWabaId] = useState("");
  const [vobizChannelId, setVobizChannelId] = useState("");
  const [vobizPhone, setVobizPhone] = useState("");
  const [postCallTemplate, setPostCallTemplate] = useState("");
  const [midCallEnabled, setMidCallEnabled] = useState(true);
  const [rules, setRules] = useState<WhatsappRule[]>([]);
  const [outboundUrl, setOutboundUrl] = useState("");
  const [requestCall, setRequestCall] = useState(true);
  const [postCall, setPostCall] = useState(true);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const resetForm = () => {
    setName("WhatsApp");
    setAgentId(agents[0]?.id ?? "");
    setProvider("vobiz");
    setVobizWabaId("");
    setVobizChannelId("");
    setVobizPhone("");
    setPostCallTemplate("");
    setMidCallEnabled(true);
    setRules([]);
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
          provider,
          vobizWabaId: vobizWabaId.trim() || null,
          vobizChannelId: vobizChannelId.trim() || null,
          vobizPhone: vobizPhone.trim() || null,
          postCallTemplate: postCallTemplate.trim() || null,
          midCallEnabled,
          rules,
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
        description="Connect WhatsApp to AI Agents. Enable mid-call interactive links & automatic post-call WhatsApp summaries natively via SnapServe or custom webhooks."
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
          <p className="mt-2 text-[11px] text-amber-200/80">
            Next: copy the inbound webhook URL from your connection card and paste it into Zapier / your BSP.
          </p>
          <Button variant="ghost" size="sm" className="mt-2 h-7 text-xs" onClick={() => setCreatedSecret(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <SetupGuide hasConnection={connections.length > 0} />

      {isLoading ? (
        <p className="text-sm text-muted-foreground px-6">Loading…</p>
      ) : connections.length === 0 ? (
        <div className="px-6 pb-8">
          <EmptyState
            icon={<MessageCircle className="w-5 h-5" />}
            title="No WhatsApp connections yet"
            description="Start with step 1 above — add a connection, then wire your BSP webhooks."
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
          <h2 className="text-sm font-semibold">Your connections</h2>
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
                    setProvider(c.provider ?? "vobiz");
                    setVobizWabaId(c.vobizWabaId ?? "");
                    setVobizChannelId(c.vobizChannelId ?? "");
                    setVobizPhone(c.vobizPhone ?? "");
                    setPostCallTemplate(c.postCallTemplate ?? "");
                    setMidCallEnabled(c.midCallEnabled ?? true);
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
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Inbound webhook URL — paste this into Zapier / your BSP
                  </Label>
                  <div className="mt-1 flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
                    <code className="text-[11px] flex-1 break-all">{c.inboundWebhookUrl}</code>
                    <CopyButton text={c.inboundWebhookUrl} label="Copy" />
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Your outbound URL — SnapServe POSTs here after each call
                  </Label>
                  {c.outboundWebhookUrl ? (
                    <div className="mt-1 flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
                      <code className="text-[11px] flex-1 break-all">{c.outboundWebhookUrl}</code>
                      <a href={c.outboundWebhookUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Not set — edit this connection to add a Zapier/Make/BSP URL for post-call WhatsApp.
                    </p>
                  )}
                </div>
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
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add WhatsApp Connection</DialogTitle>
            <DialogDescription>
              Connect WhatsApp to your AI agent natively via SnapServe Engine or via custom Webhooks (Zapier/n8n).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5">
            <div>
              <Label className="text-xs">Connection Name</Label>
              <Input className="mt-1 h-9" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">AI Agent *</Label>
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
              <Label className="text-xs">Integration Mode</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <button
                  type="button"
                  className={`px-3 py-2 text-xs font-medium rounded-md border transition-all ${
                    provider === "vobiz" ? "border-primary bg-primary/10 text-primary font-semibold" : "border-input bg-background"
                  }`}
                  onClick={() => setProvider("vobiz")}
                >
                  SnapServe WhatsApp
                </button>
                <button
                  type="button"
                  className={`px-3 py-2 text-xs font-medium rounded-md border transition-all ${
                    provider === "webhook" ? "border-primary bg-primary/10 text-primary font-semibold" : "border-input bg-background"
                  }`}
                  onClick={() => setProvider("webhook")}
                >
                  Custom Webhook
                </button>
              </div>
            </div>

            {provider === "vobiz" ? (
              <>
                <div className="p-3 bg-muted/40 rounded-lg border border-border/50 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground flex items-center gap-1.5">
                      <MessageCircle className="w-3.5 h-3.5 text-emerald-500" />
                      How to get a WABA ID & Channel ID?
                    </span>
                    <a
                      href="https://business.facebook.com"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-primary hover:underline flex items-center gap-0.5"
                    >
                      Meta Manager <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <ol className="list-decimal list-inside text-[11px] text-muted-foreground space-y-1 pl-1">
                    <li>Log into <strong>Meta Business Manager</strong> &rarr; <em>WhatsApp Accounts</em>.</li>
                    <li>Copy your 15-digit <strong>WABA ID</strong> under Business Info.</li>
                    <li>Register your AI Agent's phone number to receive Meta SMS verification.</li>
                  </ol>
                </div>

                <div>
                  <Label className="text-xs">WhatsApp Business Account ID (WABA ID)</Label>
                  <Input
                    className="mt-1 h-9"
                    placeholder="e.g. 123456789012345 (from Meta Manager)"
                    value={vobizWabaId}
                    onChange={(e) => setVobizWabaId(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">WhatsApp Channel ID (optional)</Label>
                  <Input
                    className="mt-1 h-9"
                    placeholder="e.g. 0a1b2c3d-4e5f-6a7b..."
                    value={vobizChannelId}
                    onChange={(e) => setVobizChannelId(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Post-Call Meta Template (optional)</Label>
                  <Input
                    className="mt-1 h-9"
                    placeholder="e.g. call_summary_v1 (Meta approved template name)"
                    value={postCallTemplate}
                    onChange={(e) => setPostCallTemplate(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Meta requires approved templates for outbound post-call messages. Leave blank to send session text.
                  </p>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div>
                    <Label className="text-xs font-medium">Mid-Call Agent Tool (`send_whatsapp`)</Label>
                    <p className="text-[11px] text-muted-foreground">Allows AI to send links/brochures to caller during the call</p>
                  </div>
                  <Switch checked={midCallEnabled} onCheckedChange={setMidCallEnabled} />
                </div>

                <div className="pt-2 border-t border-border/50">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <Label className="text-xs font-semibold text-foreground">Dynamic Template Triggers ({rules.length})</Label>
                      <p className="text-[11px] text-muted-foreground">Trigger specific templates mid-call or post-call based on intent</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        const newRule: WhatsappRule = {
                          id: `rule_${Date.now()}`,
                          name: "Send Store Location",
                          triggerType: "mid_call_intent",
                          condition: "caller asks for address or location",
                          templateName: "location_map_v1",
                          enabled: true,
                        };
                        setRules([...rules, newRule]);
                      }}
                    >
                      <Plus className="w-3 h-3 mr-1" /> Add Rule
                    </Button>
                  </div>

                  {rules.length > 0 && (
                    <div className="space-y-2.5 max-h-52 overflow-y-auto pr-1">
                      {rules.map((rule, idx) => (
                        <div key={rule.id} className="p-2.5 bg-card/60 rounded-md border border-border/60 text-xs space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <Input
                              className="h-7 text-xs font-medium bg-background"
                              value={rule.name}
                              placeholder="Rule Name (e.g. Send Payment Link)"
                              onChange={(e) => {
                                const next = [...rules];
                                next[idx]!.name = e.target.value;
                                setRules(next);
                              }}
                            />
                            <button
                              type="button"
                              className="text-destructive hover:text-red-400 p-1"
                              onClick={() => setRules(rules.filter((_, i) => i !== idx))}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-[10px] text-muted-foreground">Trigger Type</Label>
                              <select
                                className="mt-0.5 w-full h-7 rounded border border-input bg-background px-1.5 text-[11px]"
                                value={rule.triggerType}
                                onChange={(e) => {
                                  const next = [...rules];
                                  next[idx]!.triggerType = e.target.value as any;
                                  setRules(next);
                                }}
                              >
                                <option value="mid_call_intent">Live Mid-Call Intent</option>
                                <option value="post_call_disposition">Post-Call Disposition</option>
                                <option value="post_call_transcript_ai">Post-Call AI Analysis</option>
                              </select>
                            </div>
                            <div>
                              <Label className="text-[10px] text-muted-foreground">Meta Template Name</Label>
                              <Input
                                className="mt-0.5 h-7 text-[11px] bg-background"
                                placeholder="e.g. location_map_v1"
                                value={rule.templateName}
                                onChange={(e) => {
                                  const next = [...rules];
                                  next[idx]!.templateName = e.target.value;
                                  setRules(next);
                                }}
                              />
                            </div>
                          </div>

                          <div>
                            <Label className="text-[10px] text-muted-foreground">Condition / Intent Description</Label>
                            <Input
                              className="mt-0.5 h-7 text-[11px] bg-background"
                              placeholder="e.g. caller asks for payment link or outcome is Booked"
                              value={rule.condition}
                              onChange={(e) => {
                                const next = [...rules];
                                next[idx]!.condition = e.target.value;
                                setRules(next);
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div>
                <Label className="text-xs">Outbound Webhook URL</Label>
                <Input
                  className="mt-1 h-9"
                  placeholder="https://hooks.zapier.com/… or your BSP endpoint"
                  value={outboundUrl}
                  onChange={(e) => setOutboundUrl(e.target.value)}
                />
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <Label className="text-xs">Post-call WhatsApp Summary</Label>
              <Switch checked={postCall} onCheckedChange={setPostCall} />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              disabled={!agentId || createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              Connect WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={!!editConn} onOpenChange={(o) => !o && setEditConn(null)}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit WhatsApp Connection</DialogTitle>
          </DialogHeader>
          <div className="space-y-3.5">
            <div>
              <Label className="text-xs">Connection Name</Label>
              <Input className="mt-1 h-9" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Integration Mode</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <button
                  type="button"
                  className={`px-3 py-2 text-xs font-medium rounded-md border transition-all ${
                    provider === "vobiz" ? "border-primary bg-primary/10 text-primary font-semibold" : "border-input bg-background"
                  }`}
                  onClick={() => setProvider("vobiz")}
                >
                  SnapServe WhatsApp
                </button>
                <button
                  type="button"
                  className={`px-3 py-2 text-xs font-medium rounded-md border transition-all ${
                    provider === "webhook" ? "border-primary bg-primary/10 text-primary font-semibold" : "border-input bg-background"
                  }`}
                  onClick={() => setProvider("webhook")}
                >
                  Custom Webhook
                </button>
              </div>
            </div>

            {provider === "vobiz" ? (
              <>
                <div>
                  <Label className="text-xs">WhatsApp Business Account ID (WABA ID)</Label>
                  <Input
                    className="mt-1 h-9"
                    placeholder="e.g. 123456789012345"
                    value={vobizWabaId}
                    onChange={(e) => setVobizWabaId(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">WhatsApp Channel ID (optional)</Label>
                  <Input
                    className="mt-1 h-9"
                    placeholder="e.g. 0a1b2c3d-4e5f-6a7b..."
                    value={vobizChannelId}
                    onChange={(e) => setVobizChannelId(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Post-Call Meta Template (optional)</Label>
                  <Input
                    className="mt-1 h-9"
                    placeholder="e.g. call_summary_v1"
                    value={postCallTemplate}
                    onChange={(e) => setPostCallTemplate(e.target.value)}
                  />
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div>
                    <Label className="text-xs font-medium">Mid-Call Agent Tool (`send_whatsapp`)</Label>
                    <p className="text-[11px] text-muted-foreground">Allows AI to send links/brochures to caller during the call</p>
                  </div>
                  <Switch checked={midCallEnabled} onCheckedChange={setMidCallEnabled} />
                </div>
              </>
            ) : (
              <div>
                <Label className="text-xs">Outbound Webhook URL</Label>
                <Input
                  className="mt-1 h-9"
                  placeholder="https://hooks.zapier.com/…"
                  value={outboundUrl}
                  onChange={(e) => setOutboundUrl(e.target.value)}
                />
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <Label className="text-xs">Post-call WhatsApp Summary</Label>
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
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setEditConn(null)}>Cancel</Button>
            <Button
              disabled={!editConn || patchMut.isPending}
              onClick={() => {
                if (!editConn) return;
                patchMut.mutate({
                  id: editConn.id,
                  body: {
                    name,
                    provider,
                    vobizWabaId: vobizWabaId.trim() || null,
                    vobizChannelId: vobizChannelId.trim() || null,
                    vobizPhone: vobizPhone.trim() || null,
                    postCallTemplate: postCallTemplate.trim() || null,
                    midCallEnabled,
                    outboundWebhookUrl: outboundUrl.trim() || null,
                    requestCallEnabled: requestCall,
                    postCallEnabled: postCall,
                    active: editConn.active,
                  },
                });
              }}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
