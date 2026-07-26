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
  ArrowRight, PhoneIncoming, Send, Sparkles, Building2, ChevronDown, ChevronRight,
  ArrowUpRight, ArrowDownLeft, AlertTriangle,
} from "lucide-react";

const API = "/api";

/* ── Types ────────────────────────────────────────────────────────────────── */

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

type WaChannel = {
  id: string;
  mode: "shared" | "own";
  businessName: string;
  notifyBookingConfirmed: boolean;
  notifyCallSummary: boolean;
  notifyCallbackScheduled: boolean;
  inboundAgentId: number | null;
  dailyCap: number;
  wabaId: string | null;
  phoneNumberId: string | null;
  phoneE164: string | null;
  vobizChannelId: string | null;
  accessTokenLast4: string | null;
  status: string;
  lastError: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type WaChannelResponse = {
  channel: WaChannel | null;
  sharedTierAvailable: boolean;
  usage: { used24h: number; cap: number } | null;
};

type WaMessage = {
  id: string;
  callId: number | null;
  direction: "outbound" | "inbound";
  phone: string;
  msgType: string;
  templateName: string | null;
  bodyPreview: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

/* ── Small helpers ───────────────────────────────────────────────────────── */

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

const MSG_STATUS_STYLES: Record<string, string> = {
  pending: "bg-muted/60 text-muted-foreground",
  sent: "bg-sky-500/15 text-sky-400",
  delivered: "bg-emerald-500/15 text-emerald-400",
  read: "bg-teal-500/15 text-teal-300",
  failed: "bg-red-500/15 text-red-400",
  received: "bg-violet-500/15 text-violet-300",
};

function MsgStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${MSG_STATUS_STYLES[status] ?? "bg-muted/60 text-muted-foreground"}`}>
      {status}
    </span>
  );
}

/* ── Native tier section ─────────────────────────────────────────────────── */

function NativeSection({
  agents,
}: {
  agents: { id: number; name: string }[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["whatsapp-channel"],
    queryFn: () => customFetch<WaChannelResponse>(`${API}/whatsapp/channel`),
  });
  const channel = data?.channel && data.channel.active ? data.channel : null;

  const { data: msgData } = useQuery({
    queryKey: ["whatsapp-native-messages"],
    queryFn: () => customFetch<{ messages: WaMessage[] }>(`${API}/whatsapp/native/messages?limit=50`),
    enabled: !!channel,
    refetchInterval: 30_000,
  });
  const messages = msgData?.messages ?? [];

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["whatsapp-channel"] });
    void qc.invalidateQueries({ queryKey: ["whatsapp-native-messages"] });
  };

  /* dialogs */
  const [sharedOpen, setSharedOpen] = useState(false);
  const [ownOpen, setOwnOpen] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [inboundAgentId, setInboundAgentId] = useState<number | "">("");
  const [wabaId, setWabaId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [phoneE164, setPhoneE164] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [existingChannelId, setExistingChannelId] = useState("");
  const [testPhone, setTestPhone] = useState("");

  const enrollShared = useMutation({
    mutationFn: () =>
      customFetch<WaChannel>(`${API}/whatsapp/channel/shared`, {
        method: "POST",
        body: JSON.stringify({
          businessName,
          inboundAgentId: inboundAgentId === "" ? null : Number(inboundAgentId),
        }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      invalidate();
      setSharedOpen(false);
      toast({ title: "WhatsApp notifications enabled", description: "Post-call messages now go out automatically — no other setup needed." });
    },
    onError: (err: Error) => toast({ title: "Could not enable", description: err.message, variant: "destructive" }),
  });

  const connectOwn = useMutation({
    mutationFn: () =>
      customFetch<WaChannel>(`${API}/whatsapp/channel/own`, {
        method: "POST",
        body: JSON.stringify({
          businessName,
          wabaId: wabaId.trim() || undefined,
          phoneNumberId: phoneNumberId.trim() || undefined,
          phoneE164: phoneE164.trim() || undefined,
          accessToken: accessToken.trim() || undefined,
          vobizChannelId: existingChannelId.trim() || undefined,
          inboundAgentId: inboundAgentId === "" ? null : Number(inboundAgentId),
        }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      invalidate();
      setOwnOpen(false);
      setAccessToken("");
      toast({ title: "Your WhatsApp channel is connected" });
    },
    onError: (err: Error) => toast({ title: "Connect failed", description: err.message, variant: "destructive" }),
  });

  const patchChannel = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch<WaChannel>(`${API}/whatsapp/channel`, {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const deactivate = useMutation({
    mutationFn: () => customFetch(`${API}/whatsapp/channel`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast({ title: "WhatsApp notifications turned off" });
    },
  });

  const testSend = useMutation({
    mutationFn: () =>
      customFetch<{ ok: boolean }>(`${API}/whatsapp/native/test`, {
        method: "POST",
        body: JSON.stringify({ phone: testPhone }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Test message sent", description: "Check WhatsApp on that phone. Delivery status appears in the log below." });
    },
    onError: (err: Error) => toast({ title: "Test failed", description: err.message, variant: "destructive" }),
  });

  const openSharedDialog = () => {
    setBusinessName(channel?.businessName ?? "");
    setInboundAgentId(channel?.inboundAgentId ?? "");
    setSharedOpen(true);
  };
  const openOwnDialog = () => {
    setBusinessName(channel?.businessName ?? "");
    setInboundAgentId(channel?.inboundAgentId ?? "");
    setWabaId("");
    setPhoneNumberId("");
    setPhoneE164("");
    setAccessToken("");
    setExistingChannelId("");
    setOwnOpen(true);
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground px-6">Loading…</p>;
  }

  return (
    <div className="mx-6 space-y-4">
      {!channel ? (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Shared tier */}
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.04] p-5 flex flex-col">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-semibold">SnapServe WhatsApp</h3>
              <Badge className="bg-emerald-500/15 text-emerald-400 border-transparent text-[10px]">Recommended · zero setup</Badge>
            </div>
            <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground flex-1">
              <li>• Booking confirmations, call summaries &amp; callback alerts sent <strong className="text-foreground">automatically after every call</strong></li>
              <li>• Sent from SnapServe's verified WhatsApp business number — your business name appears in the message</li>
              <li>• Customers can reply “call me” to get a call from your AI agent</li>
              <li>• No Meta account, no templates, no approval process</li>
              <li>• Fair-use limit of 50 messages/day (upgrade to your own number for more)</li>
            </ul>
            <Button
              size="sm"
              className="mt-4 w-full"
              disabled={!data?.sharedTierAvailable}
              onClick={openSharedDialog}
            >
              Enable in 10 seconds
            </Button>
            {!data?.sharedTierAvailable && (
              <p className="mt-2 text-[11px] text-amber-400/90">
                Temporarily unavailable — the platform channel isn't configured yet. Use “your own number” below or check back soon.
              </p>
            )}
          </div>

          {/* Own tier */}
          <div className="rounded-lg border border-border/60 bg-card/30 p-5 flex flex-col">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Your own WhatsApp number</h3>
              <Badge variant="outline" className="text-[10px]">Your brand</Badge>
            </div>
            <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground flex-1">
              <li>• Messages come from <strong className="text-foreground">your</strong> WhatsApp Business number with your name &amp; logo</li>
              <li>• Higher limits: 250/day to start, scales to 2,000+ automatically as customers engage</li>
              <li>• No company registration needed — a Meta Business account is enough</li>
              <li>• Needs a number not already on personal WhatsApp (a SnapServe number works great)</li>
            </ul>
            <Button size="sm" variant="outline" className="mt-4 w-full" onClick={openOwnDialog}>
              Connect my number
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 bg-card/30 p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                {channel.mode === "shared"
                  ? <Sparkles className="w-4 h-4 text-emerald-400" />
                  : <Building2 className="w-4 h-4 text-sky-400" />}
                <h3 className="text-sm font-semibold">
                  {channel.mode === "shared" ? "SnapServe WhatsApp" : "Your WhatsApp number"}
                </h3>
                <Badge
                  className={channel.status === "active"
                    ? "bg-emerald-500/15 text-emerald-400 border-transparent text-[10px]"
                    : "bg-amber-500/15 text-amber-400 border-transparent text-[10px]"}
                >
                  {channel.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Business name in messages: <strong className="text-foreground">{channel.businessName || "—"}</strong>
                {channel.mode === "own" && channel.phoneE164 && <> · Number: {channel.phoneE164}</>}
                {channel.mode === "shared" && data?.usage && (
                  <> · {data.usage.used24h}/{data.usage.cap} messages used (24h)</>
                )}
              </p>
            </div>
            <div className="flex gap-1.5">
              {channel.mode === "shared" && (
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={openOwnDialog}>
                  Upgrade to own number
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={openSharedDialog}>
                <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-destructive"
                onClick={() => {
                  if (confirm("Turn off WhatsApp notifications?")) deactivate.mutate();
                }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {channel.lastError && (
            <div className="flex items-start gap-2 rounded-md border border-red-500/25 bg-red-500/5 px-3 py-2 text-[11px] text-red-400">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span className="break-all">{channel.lastError}</span>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            {([
              ["Booking confirmations", "notifyBookingConfirmed", channel.notifyBookingConfirmed],
              ["Call summaries", "notifyCallSummary", channel.notifyCallSummary],
              ["Callback alerts", "notifyCallbackScheduled", channel.notifyCallbackScheduled],
            ] as const).map(([label, key, value]) => (
              <div key={key} className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2">
                <span className="text-xs">{label}</span>
                <Switch
                  checked={value}
                  onCheckedChange={(v) => patchChannel.mutate({ [key]: v })}
                />
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                When a customer replies “call me”, dial
              </Label>
              <select
                className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={channel.inboundAgentId ?? ""}
                onChange={(e) =>
                  patchChannel.mutate({ inboundAgentId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">Don't dial (log only)</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Send yourself a test message
              </Label>
              <div className="mt-1 flex gap-2">
                <Input
                  className="h-9"
                  placeholder="+91 98765 43210"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                />
                <Button
                  size="sm"
                  className="h-9"
                  disabled={!testPhone.trim() || testSend.isPending}
                  onClick={() => testSend.mutate()}
                >
                  <Send className="w-3.5 h-3.5 mr-1" /> Test
                </Button>
              </div>
            </div>
          </div>

          {/* Message log */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Recent messages
            </h4>
            {messages.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No messages yet — they'll appear here after your next call (or send a test above).
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border/50">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Time</th>
                      <th className="px-3 py-2 font-medium"></th>
                      <th className="px-3 py-2 font-medium">Phone</th>
                      <th className="px-3 py-2 font-medium">Message</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {messages.map((m) => (
                      <tr key={m.id} className="border-b border-border/30 last:border-0">
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                          {new Date(m.createdAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2">
                          {m.direction === "outbound"
                            ? <ArrowUpRight className="w-3.5 h-3.5 text-sky-400" />
                            : <ArrowDownLeft className="w-3.5 h-3.5 text-violet-400" />}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{m.phone}</td>
                        <td className="px-3 py-2 max-w-[280px]">
                          <span className="block truncate">
                            {m.templateName && <code className="text-[10px] bg-muted/50 px-1 rounded mr-1">{m.templateName}</code>}
                            {m.bodyPreview}
                          </span>
                          {m.errorMessage && (
                            <span className="block truncate text-[10px] text-red-400">{m.errorMessage}</span>
                          )}
                        </td>
                        <td className="px-3 py-2"><MsgStatusBadge status={m.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Shared enroll / edit dialog */}
      <Dialog open={sharedOpen} onOpenChange={setSharedOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{channel ? "WhatsApp settings" : "Enable WhatsApp notifications"}</DialogTitle>
            <DialogDescription>
              {channel?.mode === "own"
                ? "Update the business name shown in your messages and the reply-call agent."
                : "Messages are sent from SnapServe's WhatsApp business number with your business name inside."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Business name (appears in every message) *</Label>
              <Input
                className="mt-1 h-9"
                placeholder="e.g. Sharma Dental Clinic"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">When a customer replies “call me”, dial (optional)</Label>
              <select
                className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={inboundAgentId}
                onChange={(e) => setInboundAgentId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Don't dial (log only)</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSharedOpen(false)}>Cancel</Button>
            <Button
              disabled={!businessName.trim() || enrollShared.isPending || patchChannel.isPending}
              onClick={() => {
                if (channel) {
                  // Edit of an existing channel (either tier) must PATCH — never
                  // re-enroll shared, which would wipe own-channel fields.
                  patchChannel.mutate(
                    { businessName, inboundAgentId: inboundAgentId === "" ? null : Number(inboundAgentId) },
                    { onSuccess: () => { setSharedOpen(false); toast({ title: "Saved" }); } },
                  );
                } else {
                  enrollShared.mutate();
                }
              }}
            >
              {channel ? "Save" : "Enable"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Own-channel connect dialog */}
      <Dialog open={ownOpen} onOpenChange={setOwnOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect your own WhatsApp number</DialogTitle>
            <DialogDescription>
              From Meta's{" "}
              <a href="https://business.facebook.com/settings/whatsapp-business-accounts" target="_blank" rel="noreferrer" className="underline">
                WhatsApp Business settings
              </a>{" "}
              copy your WABA ID, Phone Number ID and a System User access token. No company registration is
              required — you start at 250 conversations/day and Meta raises it automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300/90">
              The number must not be in use on the personal WhatsApp app. Most customers use a SnapServe
              phone number here — buy one on the Phone Numbers page, then register it with Meta.
            </div>
            <div>
              <Label className="text-xs">Business name (appears in messages) *</Label>
              <Input className="mt-1 h-9" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">WABA ID *</Label>
                <Input className="mt-1 h-9" value={wabaId} onChange={(e) => setWabaId(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Phone Number ID *</Label>
                <Input className="mt-1 h-9" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs">WhatsApp number (E.164)</Label>
              <Input className="mt-1 h-9" placeholder="+9198…" value={phoneE164} onChange={(e) => setPhoneE164(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Permanent access token *</Label>
              <Input
                className="mt-1 h-9"
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Passed securely to the messaging carrier — SnapServe never stores it.
              </p>
            </div>
            <details className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer">Already created a channel on VoBiz? Link it instead</summary>
              <div className="mt-2">
                <Label className="text-xs">Existing VoBiz channel ID</Label>
                <Input className="mt-1 h-9" value={existingChannelId} onChange={(e) => setExistingChannelId(e.target.value)} />
              </div>
            </details>
            <div>
              <Label className="text-xs">When a customer replies “call me”, dial (optional)</Label>
              <select
                className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={inboundAgentId}
                onChange={(e) => setInboundAgentId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Don't dial (log only)</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOwnOpen(false)}>Cancel</Button>
            <Button
              disabled={
                !businessName.trim()
                || connectOwn.isPending
                || (!existingChannelId.trim() && (!wabaId.trim() || !phoneNumberId.trim() || !accessToken.trim()))
              }
              onClick={() => connectOwn.mutate()}
            >
              Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── BYO-BSP (advanced) — existing webhook integration, unchanged ────────── */

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
    <div className="space-y-5">
      <div className="rounded-lg border border-border/60 bg-card/30 p-5">
        <h2 className="text-sm font-semibold">How to set this up</h2>
        <p className="mt-1 text-xs text-muted-foreground max-w-2xl">
          With this option SnapServe does not send WhatsApp messages itself. Your Interakt / Wati / AiSensy / Zapier
          account does. You connect the two with webhooks — about 10 minutes if templates already exist.
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
                After the AI call → send a WhatsApp template (outbound)
              </p>
              <p className="text-xs text-muted-foreground">
                WhatsApp only allows sending <strong>pre-approved templates</strong> — you create and get
                those approved on your BSP (Interakt / Wati / AiSensy). SnapServe does not send messages itself.
              </p>
              <p className="text-xs text-muted-foreground">
                After every call, SnapServe POSTs to your outbound URL. Your Zap / Make / BSP automation
                reads <code className="text-[10px] bg-muted/50 px-1 rounded">template_hint</code> to know{" "}
                <em>which</em> of your pre-approved templates to fire, then sends it to{" "}
                <code className="text-[10px] bg-muted/50 px-1 rounded">phone</code>.
              </p>
              <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1.5">
                <li>
                  <code className="text-[10px] bg-muted/50 px-1 rounded">booking_confirmed</code> —
                  call ended with a meeting booked. Fill your booking template's variables using{" "}
                  <code className="text-[10px] bg-muted/50 px-1 rounded">meeting_time</code> and{" "}
                  <code className="text-[10px] bg-muted/50 px-1 rounded">meet_link</code>.
                </li>
                <li>
                  <code className="text-[10px] bg-muted/50 px-1 rounded">callback_scheduled</code> —
                  caller asked to be called back at a specific time.
                </li>
                <li>
                  <code className="text-[10px] bg-muted/50 px-1 rounded">call_summary</code> —
                  call ended without a booking (general follow-up template).
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

  const [showByo, setShowByo] = useState(false);
  const byoVisible = showByo || connections.length > 0;

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
        description="Automatic WhatsApp follow-ups after every AI call — booking confirmations, summaries and callback alerts. Customers can reply to get a call back."
      />

      <NativeSection agents={agents} />

      {/* Advanced: BYO BSP webhooks */}
      <div className="mx-6 pb-8 space-y-4">
        <button
          type="button"
          className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
          onClick={() => setShowByo((v) => !v)}
        >
          {byoVisible ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Advanced: use your own BSP (Interakt / Wati / AiSensy / Zapier)
          {connections.length > 0 && (
            <Badge variant="secondary" className="text-[10px] ml-1">{connections.length} active</Badge>
          )}
        </button>

        {byoVisible && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground max-w-xl">
                Already running WhatsApp campaigns on a BSP? Keep it — SnapServe will trigger your webhooks
                instead of sending messages itself. Agents with a BSP connection use it; everything else uses
                the built-in WhatsApp above.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  resetForm();
                  setAgentId(agents[0]?.id ?? "");
                  setCreateOpen(true);
                }}
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Add connection
              </Button>
            </div>

            {createdSecret && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
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
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : connections.length === 0 ? (
              <EmptyState
                icon={<MessageCircle className="w-5 h-5" />}
                title="No BSP connections"
                description="Only needed if you want your own BSP to send the messages. Otherwise use the built-in WhatsApp above."
                action={{
                  label: "Add connection",
                  onClick: () => {
                    resetForm();
                    setAgentId(agents[0]?.id ?? "");
                    setCreateOpen(true);
                  },
                }}
              />
            ) : (
              <div className="space-y-3">
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
          </div>
        )}
      </div>

      {/* Create */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add WhatsApp connection</DialogTitle>
            <DialogDescription>
              After creating, copy the inbound URL into Zapier or your BSP. Works with Interakt, Wati, AiSensy, Gupshup.
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
