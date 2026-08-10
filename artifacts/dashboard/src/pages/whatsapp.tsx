import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch, useListAgents } from "@workspace/api-client-react";
import { StripePage } from "@/components/stripe-page";
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
import { usePartnerManagedWorkspace } from "@/hooks/use-partner";
import { ByonPanel } from "@/components/whatsapp/byon-flow";
import { EngageSection } from "@/components/whatsapp/engage-section";
import {
  Copy, CheckCircle2, MessageCircle, Plus, Trash2, Pencil, ExternalLink,
  ArrowRight, PhoneIncoming, Send, Sparkles, Building2, ChevronDown, ChevronRight,
  ArrowUpRight, ArrowDownLeft, AlertTriangle, Webhook,
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
  templates?: {
    default?: string;
    call_summary?: string;
    booking_confirmed?: string;
    callback_scheduled?: string;
  };
  templateCatalog?: MetaTplInfo[];
  metaConnected?: boolean;
  metaPhoneNumberId?: string | null;
  metaWabaId?: string | null;
  metaTemplates?: Record<string, MetaTplChoice>;
  active: boolean;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastError: string | null;
};

type MetaTplChoice = { name: string; language: string; paramCount: number };

type MetaTplInfo = {
  name: string;
  language: string;
  status: string;
  category: string | null;
  paramCount: number;
  bodyPreview: string;
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
  chatbotEnabled?: boolean;
  chatbotAgentId?: number | null;
  brochureAssetId?: string | null;
  brochureAutoSend?: boolean;
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
  /** WhatsApp number bought through SnapServe (hidden from the voice numbers page). */
  purchasedNumber: { id: number; number: string; nextRenewalAt: string | null; renewalPaise: number } | null;
};

type WaAvailableNumbers = {
  numbers: { number: string; country: string; region: string | null }[];
  pricing: { basePaise: number; gstPaise: number; totalPaise: number; renewalPaise: number; currency: string };
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

/** Razorpay checkout script loader (same pattern as the Phone Numbers page). */
function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve) => {
    if (window.Razorpay) { resolve(); return; }
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    document.body.appendChild(s);
  });
}

const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/* ── Native tier section ─────────────────────────────────────────────────── */

function NativeSection({
  agents,
  onChooseBsp,
  onChooseMeta,
  metaConnected,
}: {
  agents: { id: number; name: string }[];
  onChooseBsp?: () => void;
  onChooseMeta?: () => void;
  metaConnected?: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isManagedWorkspace } = usePartnerManagedWorkspace();

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
  const [bizOpen, setBizOpen] = useState(false);
  const [bizStep, setBizStep] = useState<1 | 2>(1);
  const [numberChoice, setNumberChoice] = useState<"buy" | "direct" | "voice">(
    isManagedWorkspace ? "direct" : "buy",
  );
  const [selectedNumber, setSelectedNumber] = useState<string | null>(null);
  const [voiceNumberId, setVoiceNumberId] = useState<number | null>(null);
  /** Set when reconnecting an already-purchased WhatsApp number (channel create failed). */
  const [retryNumber, setRetryNumber] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [inboundAgentId, setInboundAgentId] = useState<number | "">("");
  const [wabaId, setWabaId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [phoneE164, setPhoneE164] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [existingChannelId, setExistingChannelId] = useState("");
  const [testPhone, setTestPhone] = useState("");

  const connectOwn = useMutation({
    mutationFn: (vars: { numberSource: "direct" | "purchased" | "voice_number"; voicePhoneNumberId?: number }) =>
      customFetch<WaChannel>(`${API}/whatsapp/channel/own`, {
        method: "POST",
        body: JSON.stringify({
          businessName,
          numberSource: vars.numberSource,
          voicePhoneNumberId: vars.voicePhoneNumberId,
          wabaId: wabaId.trim() || undefined,
          phoneNumberId: vars.numberSource !== "purchased" ? (phoneNumberId.trim() || undefined) : undefined,
          phoneE164: vars.numberSource === "voice_number" ? undefined : (phoneE164.trim() || undefined),
          accessToken: accessToken.trim() || undefined,
          vobizChannelId: vars.numberSource === "direct" ? (existingChannelId.trim() || undefined) : undefined,
          inboundAgentId: inboundAgentId === "" ? null : Number(inboundAgentId),
        }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: (ch) => {
      invalidate();
      setBizOpen(false);
      setAccessToken("");
      toast(ch.status === "active"
        ? { title: "Your WhatsApp channel is connected" }
        : { title: "Channel created — provisioning", description: "VoBiz is finishing the Meta registration. Use “Check status” on the card to refresh." });
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

  /* Business-tier: live WhatsApp-capable inventory (separate from voice DIDs). */
  const { data: waNumbers, isFetching: numbersLoading, refetch: refetchNumbers, error: numbersError } = useQuery({
    queryKey: ["whatsapp-available-numbers"],
    queryFn: () => customFetch<WaAvailableNumbers>(`${API}/whatsapp/numbers/available?country=IN`),
    enabled: bizOpen && bizStep === 2 && numberChoice === "buy",
    staleTime: 60_000,
    retry: false,
  });
  const pricing = waNumbers?.pricing ?? { basePaise: 80000, gstPaise: 14400, totalPaise: 94400, renewalPaise: 82600, currency: "INR" };

  const refreshChannel = useMutation({
    mutationFn: () => customFetch<WaChannel>(`${API}/whatsapp/channel/refresh`, { method: "POST" }),
    onSuccess: (ch) => {
      invalidate();
      toast(ch.status === "active"
        ? { title: "Your WhatsApp number is live!", description: "Post-call messages now go out from your own number." }
        : { title: "Still provisioning", description: "The carrier hasn't finished registering the number with Meta yet — check again in a few minutes." });
    },
    onError: (err: Error) => toast({ title: "Refresh failed", description: err.message, variant: "destructive" }),
  });

  const releaseNumber = useMutation({
    mutationFn: (id: number) => customFetch(`${API}/phone-numbers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast({ title: "WhatsApp number released", description: "The 30-day renewal billing has stopped." });
    },
    onError: (err: Error) => toast({ title: "Release failed", description: err.message, variant: "destructive" }),
  });

  const openSharedDialog = () => {
    setBusinessName(channel?.businessName ?? "");
    setInboundAgentId(channel?.inboundAgentId ?? "");
    setSharedOpen(true);
  };
  const openBizWizard = (reconnectNumber?: string) => {
    setBusinessName(channel?.businessName ?? "");
    setInboundAgentId(channel?.inboundAgentId ?? "");
    setWabaId(channel?.wabaId ?? "");
    setPhoneNumberId("");
    setPhoneE164(reconnectNumber ?? "");
    setAccessToken("");
    setExistingChannelId("");
    setRetryNumber(reconnectNumber ?? null);
    setBizStep(1);
    setNumberChoice("buy");
    setSelectedNumber(null);
    setBizOpen(true);
  };

  /** Buy flow: Razorpay order → checkout → confirm (number + channel created server-side). */
  const handleBuyAndConnect = async () => {
    if (!selectedNumber) return;
    setBuying(true);
    try {
      const init = await customFetch<{ purchaseOrderId: number; orderId: string; amountCents: number; keyId?: string }>(
        `${API}/whatsapp/numbers/purchase/initiate`,
        {
          method: "POST",
          body: JSON.stringify({ number: selectedNumber, countryCode: "IN" }),
          headers: { "Content-Type": "application/json" },
        },
      );
      await loadRazorpayScript();
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };
        const opts: Record<string, unknown> = {
          key: init.keyId,
          order_id: init.orderId,
          amount: init.amountCents,
          currency: "INR",
          name: "SnapServe",
          description: `WhatsApp number ${selectedNumber}`,
          modal: { ondismiss: () => settle(() => reject(new Error("cancelled"))) },
          handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
            try {
              const result = await customFetch<{ channel: WaChannel | null; channelError: string | null }>(
                `${API}/whatsapp/numbers/purchase/confirm`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    purchaseOrderId: init.purchaseOrderId,
                    razorpayOrderId: r.razorpay_order_id,
                    razorpayPaymentId: r.razorpay_payment_id,
                    razorpaySignature: r.razorpay_signature,
                    wabaId: wabaId.trim(),
                    accessToken: accessToken.trim(),
                    businessName: businessName.trim(),
                    inboundAgentId: inboundAgentId === "" ? null : Number(inboundAgentId),
                  }),
                  headers: { "Content-Type": "application/json" },
                },
              );
              if (result.channelError) {
                toast({
                  title: "Number purchased — connection needs one more try",
                  description: `${result.channelError} — use “Retry connection” on the card (your number is safe).`,
                  variant: "destructive",
                });
              } else {
                toast({ title: "WhatsApp number purchased!", description: "The carrier is registering it with Meta — usually ready in a few minutes." });
              }
              settle(() => resolve());
            } catch (err) {
              settle(() => reject(err instanceof Error ? err : new Error("Payment verification failed")));
            }
          },
        };
        new window.Razorpay(opts).open();
      });
      invalidate();
      setBizOpen(false);
      setAccessToken("");
    } catch (err) {
      if (err instanceof Error && err.message === "cancelled") return;
      const msg = err instanceof Error ? err.message : "Unknown error";
      const code = (err as { data?: { code?: string } })?.data?.code;
      if (code === "KYC_REQUIRED" || /identity verification/i.test(msg)) {
        toast({
          title: "Identity verification required",
          description: "Indian numbers need a one-time KYC — complete it on the Phone Numbers page (takes ~2 minutes), then come back.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Purchase failed", description: msg, variant: "destructive" });
      }
    } finally {
      setBuying(false);
    }
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground px-6">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      {!channel ? (
        <div className="space-y-4">
          {data?.purchasedNumber && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2">
              <p className="text-[11px] text-amber-300/90">
                You own WhatsApp number <strong className="text-foreground">{data.purchasedNumber.number}</strong> but it isn't connected yet.
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => openBizWizard(data.purchasedNumber!.number)}>
                  Finish connecting
                </Button>
                {!isManagedWorkspace && (
                  <Button
                    size="sm" variant="ghost" className="h-7 text-[11px] text-red-400"
                    disabled={releaseNumber.isPending}
                    onClick={() => {
                      if (confirm(`Release ${data.purchasedNumber!.number}? The 30-day renewal billing stops and the number is gone for good.`)) {
                        releaseNumber.mutate(data.purchasedNumber!.id);
                      }
                    }}
                  >
                    Release
                  </Button>
                )}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold">Connect WhatsApp Business</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Use your own WhatsApp Business account via Meta API. SnapServe Instant WhatsApp is no longer offered.
            </p>
          </div>

          <div className="max-w-xl">
            {/* Business → direct Meta Cloud API */}
            <div className="flex flex-col rounded-lg border border-sky-500/25 bg-sky-500/[0.04] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Building2 className="h-4 w-4 text-sky-400" />
                <h3 className="text-sm font-semibold">I have a WhatsApp Business account</h3>
                <Badge className="border-transparent bg-sky-500/15 text-[10px] text-sky-300">Meta API · your brand</Badge>
              </div>
              <ul className="mt-3 flex-1 space-y-1.5 text-xs text-muted-foreground">
                <li>• Messages from <strong className="text-foreground">your own WhatsApp number</strong></li>
                <li>• Connect with Meta token — we pull your approved templates</li>
                <li>• Templates for call summary, booking &amp; callback</li>
                <li>• Post-call, mid-call tool, and Request-a-Call supported</li>
              </ul>
              {metaConnected ? (
                <>
                  <div className="mt-4 flex items-center justify-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 py-2 text-xs font-medium text-emerald-400">
                    ✓ Already configured — see Your connections below
                  </div>
                  <Button size="sm" variant="ghost" className="mt-2 h-9 w-full text-[11px] text-muted-foreground" onClick={() => onChooseMeta?.()}>
                    Add another connection
                  </Button>
                </>
              ) : (
                <Button size="sm" className="mt-4 h-9 w-full" onClick={() => onChooseMeta?.()}>
                  Connect Meta API
                </Button>
              )}
            </div>
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
                  {channel.mode === "shared" ? "Legacy Instant WhatsApp" : "Your WhatsApp number"}
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
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => openBizWizard()}>
                  Upgrade to Business WhatsApp
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
            <div className="flex items-start justify-between gap-2 rounded-md border border-red-500/25 bg-red-500/5 px-3 py-2 text-[11px] text-red-400">
              <div className="flex items-start gap-2 min-w-0">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span className="break-all">{channel.lastError}</span>
              </div>
              {channel.mode === "own" && !channel.vobizChannelId && data?.purchasedNumber && (
                <Button
                  size="sm" variant="outline" className="h-7 text-[11px] shrink-0"
                  onClick={() => openBizWizard(data.purchasedNumber!.number)}
                >
                  Retry connection
                </Button>
              )}
            </div>
          )}

          {channel.mode === "own" && channel.vobizChannelId && channel.status !== "active" && (
            <div className="flex items-start justify-between gap-2 rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2">
              <p className="text-[11px] text-amber-300/90">
                {channel.phoneNumberId
                  ? "Almost ready — waiting for the carrier to activate the channel."
                  : "Provisioning — the carrier is registering your WhatsApp number with Meta. Usually ready in a few minutes."}
              </p>
              <Button
                size="sm" variant="outline" className="h-7 text-[11px] shrink-0"
                disabled={refreshChannel.isPending}
                onClick={() => refreshChannel.mutate()}
              >
                {refreshChannel.isPending ? "Checking…" : "Check status"}
              </Button>
            </div>
          )}

          {channel.mode === "own" && data?.purchasedNumber && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
              <span>
                SnapServe WhatsApp number <strong className="text-foreground">{data.purchasedNumber.number}</strong>
                {data.purchasedNumber.nextRenewalAt && (
                  <> · renews {new Date(data.purchasedNumber.nextRenewalAt).toLocaleDateString()} ({inr(data.purchasedNumber.renewalPaise)} from wallet)</>
                )}
              </span>
              {!isManagedWorkspace && (
                <button
                  type="button"
                  className="text-red-400 hover:text-red-300"
                  onClick={() => {
                    if (confirm(`Release ${data.purchasedNumber!.number}? WhatsApp sends from this number stop and renewal billing ends.`)) {
                      releaseNumber.mutate(data.purchasedNumber!.id);
                    }
                  }}
                >
                  Release
                </button>
              )}
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

      {/* Engagement tools — chatbot, brochure, templates */}
      {channel && (
        <EngageSection
          channel={channel}
          agents={agents}
          onPatch={(body) => patchChannel.mutate(body)}
          patching={patchChannel.isPending}
        />
      )}

      {/* Edit channel settings (existing Instant or Business) */}
      <Dialog open={sharedOpen} onOpenChange={setSharedOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>WhatsApp settings</DialogTitle>
            <DialogDescription>
              {channel?.mode === "own"
                ? "Update the business name shown in your messages and the reply-call agent."
                : "Update the business name and reply-call agent. New Instant WhatsApp enrollments are closed — upgrade to Meta API / Business for your own number."}
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
              disabled={!channel || !businessName.trim() || patchChannel.isPending}
              onClick={() => {
                if (!channel) return;
                patchChannel.mutate(
                  { businessName, inboundAgentId: inboundAgentId === "" ? null : Number(inboundAgentId) },
                  { onSuccess: () => { setSharedOpen(false); toast({ title: "Saved" }); } },
                );
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Business WhatsApp wizard (own channel) */}
      <Dialog open={bizOpen} onOpenChange={setBizOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {retryNumber ? "Reconnect your WhatsApp number" : `Business WhatsApp — step ${bizStep} of 2`}
            </DialogTitle>
            <DialogDescription>
              {bizStep === 1 ? (
                <>
                  From Meta's{" "}
                  <a href="https://business.facebook.com/settings/whatsapp-business-accounts" target="_blank" rel="noreferrer" className="underline">
                    WhatsApp Business settings
                  </a>{" "}
                  copy your WABA ID and a permanent (System User) access token. You start at 250
                  conversations/day and Meta raises it automatically.
                </>
              ) : (
                "Choose the WhatsApp number your customers will see."
              )}
            </DialogDescription>
          </DialogHeader>

          {bizStep === 1 ? (
            <div className="space-y-3">
              {retryNumber && (
                <div className="rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300/90">
                  Number <strong className="text-foreground">{retryNumber}</strong> is already yours — re-enter
                  your Meta details to finish connecting it. You won't be charged again.
                </div>
              )}
              <div>
                <Label className="text-xs">Business name (appears in messages) *</Label>
                <Input className="mt-1 h-9" placeholder="e.g. Sharma Dental Clinic" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">WABA ID *</Label>
                <Input className="mt-1 h-9" value={wabaId} onChange={(e) => setWabaId(e.target.value)} />
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
              {!retryNumber && (
                <details className="text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer">Advanced: already created a channel in the VoBiz console?</summary>
                  <div className="mt-2">
                    <Label className="text-xs">Existing VoBiz channel ID</Label>
                    <Input className="mt-1 h-9" value={existingChannelId} onChange={(e) => setExistingChannelId(e.target.value)} />
                    <p className="mt-1">Linking an existing channel skips number selection entirely.</p>
                  </div>
                </details>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Option A — buy from SnapServe (owners only; partner funds client numbers) */}
              {!isManagedWorkspace && (
              <label className={`block rounded-lg border p-3 cursor-pointer transition-colors ${numberChoice === "buy" ? "border-sky-500/50 bg-sky-500/[0.04]" : "border-border/60 hover:border-border"}`}>
                <div className="flex items-start gap-2">
                  <input type="radio" className="mt-1" checked={numberChoice === "buy"} onChange={() => setNumberChoice("buy")} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">Buy a WhatsApp-ready number from SnapServe</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {inr(pricing.totalPaise)} first month (incl. GST), then {inr(pricing.renewalPaise)}/30 days
                      from your wallet. The Phone Number ID is assigned automatically — no Meta number registration needed.
                    </p>
                    {numberChoice === "buy" && (
                      <div className="mt-2 space-y-1.5">
                        {numbersLoading ? (
                          <p className="text-[11px] text-muted-foreground">Loading available numbers…</p>
                        ) : numbersError ? (
                          <div className="text-[11px] text-red-400">
                            Couldn't load numbers.{" "}
                            <button type="button" className="underline" onClick={() => refetchNumbers()}>Try again</button>
                          </div>
                        ) : (waNumbers?.numbers?.length ?? 0) === 0 ? (
                          <p className="text-[11px] text-amber-400/90">
                            No WhatsApp numbers in stock right now — try again shortly, or connect a Meta-registered number below.
                          </p>
                        ) : (
                          <div className="max-h-36 overflow-y-auto rounded-md border border-border/50 divide-y divide-border/40">
                            {waNumbers!.numbers.slice(0, 20).map((n) => (
                              <button
                                key={n.number}
                                type="button"
                                className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs hover:bg-muted/40 ${selectedNumber === n.number ? "bg-sky-500/10 text-foreground" : "text-muted-foreground"}`}
                                onClick={() => setSelectedNumber(n.number)}
                              >
                                <span className="font-mono">{n.number}</span>
                                {selectedNumber === n.number && <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </label>
              )}

              {/* Option B — Meta-registered number */}
              <label className={`block rounded-lg border p-3 cursor-pointer transition-colors ${numberChoice === "direct" ? "border-sky-500/50 bg-sky-500/[0.04]" : "border-border/60 hover:border-border"}`}>
                <div className="flex items-start gap-2">
                  <input type="radio" className="mt-1" checked={numberChoice === "direct"} onChange={() => setNumberChoice("direct")} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">My number is already registered in my WABA</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Direct connection — you already have a Meta Phone Number ID for it. The number must not be
                      in use on the personal WhatsApp app.
                    </p>
                    {numberChoice === "direct" && (
                      <div className="mt-2 grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">Phone Number ID *</Label>
                          <Input className="mt-1 h-9" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} />
                        </div>
                        <div>
                          <Label className="text-xs">Number (E.164)</Label>
                          <Input className="mt-1 h-9" placeholder="+9198…" value={phoneE164} onChange={(e) => setPhoneE164(e.target.value)} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </label>

              {/* Option C — WhatsApp-enable an existing voice number (owners only) */}
              {!isManagedWorkspace && (
              <label className={`block rounded-lg border p-3 cursor-pointer transition-colors ${numberChoice === "voice" ? "border-sky-500/50 bg-sky-500/[0.04]" : "border-border/60 hover:border-border"}`}>
                <div className="flex items-start gap-2">
                  <input type="radio" className="mt-1" checked={numberChoice === "voice"} onChange={() => setNumberChoice("voice")} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">Use one of my SnapServe voice numbers <span className="text-emerald-400 font-semibold">₹0</span></p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      WhatsApp-enable a number you already rent for calls — it keeps taking voice calls.
                      Verification calls land on the number itself, so SnapServe captures the code for you.
                    </p>
                    {numberChoice === "voice" && (
                      <ByonPanel
                        voiceNumberId={voiceNumberId}
                        onSelectNumber={setVoiceNumberId}
                        metaPhoneNumberId={phoneNumberId}
                        onMetaPhoneNumberId={setPhoneNumberId}
                      />
                    )}
                  </div>
                </div>
              </label>
              )}
            </div>
          )}

          <DialogFooter>
            {bizStep === 2 && (
              <Button variant="ghost" onClick={() => setBizStep(1)}>Back</Button>
            )}
            <Button variant="ghost" onClick={() => setBizOpen(false)}>Cancel</Button>
            {bizStep === 1 ? (
              retryNumber ? (
                <Button
                  disabled={!businessName.trim() || !wabaId.trim() || !accessToken.trim() || connectOwn.isPending}
                  onClick={() => connectOwn.mutate({ numberSource: "purchased" })}
                >
                  {connectOwn.isPending ? "Connecting…" : "Reconnect"}
                </Button>
              ) : existingChannelId.trim() ? (
                <Button
                  disabled={!businessName.trim() || !wabaId.trim() || connectOwn.isPending}
                  onClick={() => connectOwn.mutate({ numberSource: "direct" })}
                >
                  {connectOwn.isPending ? "Linking…" : "Link channel"}
                </Button>
              ) : (
                <Button
                  disabled={!businessName.trim() || !wabaId.trim() || !accessToken.trim()}
                  onClick={() => setBizStep(2)}
                >
                  Next
                </Button>
              )
            ) : numberChoice === "buy" ? (
              <Button disabled={!selectedNumber || buying} onClick={() => void handleBuyAndConnect()}>
                {buying ? "Processing…" : `Pay ${inr(pricing.totalPaise)} & connect`}
              </Button>
            ) : numberChoice === "voice" ? (
              <Button
                disabled={voiceNumberId == null || !phoneNumberId.trim() || connectOwn.isPending}
                onClick={() => connectOwn.mutate({ numberSource: "voice_number", voicePhoneNumberId: voiceNumberId ?? undefined })}
              >
                {connectOwn.isPending ? "Connecting…" : "Connect voice number"}
              </Button>
            ) : (
              <Button
                disabled={!phoneNumberId.trim() || connectOwn.isPending}
                onClick={() => connectOwn.mutate({ numberSource: "direct" })}
              >
                {connectOwn.isPending ? "Connecting…" : "Connect"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── BYO-BSP adopter ─────────────────────────────────────────────────────── */

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
  "template_hint": "booking_confirmed",
  "template_name": "ss_booking_confirmed",
  "summary": "…"
}`;

function BspAdopterGuide() {
  const [showPayload, setShowPayload] = useState(false);
  return (
    <div className="rounded-lg border border-border/60 bg-card/30 p-5 space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Bring your BSP — 4 steps</h2>
        <p className="mt-1 text-xs text-muted-foreground max-w-2xl">
          Create templates in your WhatsApp provider. SnapServe POSTs to your webhook; your BSP sends the message.
          A BSP connection for an agent overrides Meta API / Business post-call for that agent.
        </p>
      </div>
      <ol className="space-y-2 text-xs text-muted-foreground">
        <li><span className="font-medium text-foreground/90">1.</span> Select the AI agent</li>
        <li><span className="font-medium text-foreground/90">2.</span> Paste your outbound webhook URL (BSP / Zapier / Make / n8n)</li>
        <li><span className="font-medium text-foreground/90">3.</span> Map template names you already approved in your BSP</li>
        <li><span className="font-medium text-foreground/90">4.</span> Toggle post-call and/or Request-a-Call; enable Tools → Send WhatsApp for mid-call</li>
      </ol>
      <button
        type="button"
        className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        onClick={() => setShowPayload((v) => !v)}
      >
        {showPayload ? "Hide" : "Show"} webhook payload reference
      </button>
      {showPayload && (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Inbound (Request a Call)</p>
            <pre className="text-[11px] bg-muted/40 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">{SAMPLE_INBOUND}</pre>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Outbound (post-call / mid-call)</p>
            <pre className="text-[11px] bg-muted/40 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">{SAMPLE_OUTBOUND}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WhatsAppPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const search = useSearch();
  const urlAgentId = Number(new URLSearchParams(search).get("agentId") || "");
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
  const [agentId, setAgentId] = useState<number | "">(
    Number.isFinite(urlAgentId) && urlAgentId > 0 ? urlAgentId : "",
  );

  // Prefill agent when opened with ?agentId=.
  useEffect(() => {
    if (Number.isFinite(urlAgentId) && urlAgentId > 0) setAgentId(urlAgentId);
  }, [urlAgentId]);
  const [outboundUrl, setOutboundUrl] = useState("");
  const [requestCall, setRequestCall] = useState(true);
  const [postCall, setPostCall] = useState(true);
  const [tplDefault, setTplDefault] = useState("");
  const [tplSummary, setTplSummary] = useState("");
  const [tplBooking, setTplBooking] = useState("");
  const [tplCallback, setTplCallback] = useState("");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  // Direct Meta Cloud API mode
  const [connMode, setConnMode] = useState<"webhook" | "meta">("webhook");
  const [metaToken, setMetaToken] = useState("");
  const [metaPhoneId, setMetaPhoneId] = useState("");
  const [metaWabaId, setMetaWabaId] = useState("");
  const [metaApiBase, setMetaApiBase] = useState("");
  const [metaTplList, setMetaTplList] = useState<MetaTplInfo[] | null>(null);
  const [metaFetching, setMetaFetching] = useState(false);
  const [metaPhoneInfo, setMetaPhoneInfo] = useState<string | null>(null);
  const [metaSelDefault, setMetaSelDefault] = useState("");   // JSON of MetaTplChoice or ""
  const [metaSelSummary, setMetaSelSummary] = useState("");   // JSON of MetaTplChoice or ""
  const [metaSelBooking, setMetaSelBooking] = useState("");
  const [metaSelCallback, setMetaSelCallback] = useState("");

  const fetchMetaTemplates = async (connectionId?: string) => {
    setMetaFetching(true);
    setMetaPhoneInfo(null);
    try {
      const res = await customFetch<{ templates: MetaTplInfo[]; phone: { displayPhone: string | null; verifiedName: string | null } | null }>(
        `${API}/whatsapp/meta/templates`,
        {
          method: "POST",
          body: JSON.stringify({
            accessToken: metaToken.trim() || undefined,
            wabaId: metaWabaId.trim() || undefined,
            phoneNumberId: metaPhoneId.trim() || undefined,
            apiBase: metaApiBase.trim() || undefined,
            connectionId,
          }),
          headers: { "Content-Type": "application/json" },
        },
      );
      setMetaTplList(res.templates);
      // Auto-pick the first approved template for Default + After a call so the
      // connection works out of the box — user can still change it.
      if (res.templates.length > 0) {
        const first = res.templates[0]!;
        const opt = JSON.stringify({ name: first.name, language: first.language, paramCount: first.paramCount });
        if (!metaSelDefault) setMetaSelDefault(opt);
        if (!metaSelSummary) setMetaSelSummary(opt);
      }
      if (res.phone) {
        setMetaPhoneInfo(`✓ ${res.phone.verifiedName ?? ""} ${res.phone.displayPhone ?? ""}`.trim());
      }
      if (res.templates.length === 0) {
        toast({ title: "Connected, but no approved templates found", description: "Create and approve templates in Meta WhatsApp Manager first." });
      } else {
        toast({ title: `Found ${res.templates.length} approved templates` });
      }
    } catch (err) {
      setMetaTplList(null);
      toast({ title: "Meta connection failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setMetaFetching(false);
    }
  };

  const metaTemplatesPayload = () => {
    const parse = (s: string): MetaTplChoice | null => {
      try { return s ? (JSON.parse(s) as MetaTplChoice) : null; } catch { return null; }
    };
    const out: Record<string, MetaTplChoice> = {};
    const d = parse(metaSelDefault); if (d) out.default = d;
    const s = parse(metaSelSummary); if (s) out.call_summary = s;
    const b = parse(metaSelBooking); if (b) out.booking_confirmed = b;
    const c = parse(metaSelCallback); if (c) out.callback_scheduled = c;
    return out;
  };

  const tplOption = (t: MetaTplInfo) => JSON.stringify({ name: t.name, language: t.language, paramCount: t.paramCount });

  const renderMetaTplSelect = (label: string, value: string, onChange: (v: string) => void) => {
    const list = metaTplList ?? [];
    const inList = value && list.some((t) => tplOption(t) === value);
    let savedLabel = "";
    if (value && !inList) {
      try {
        const v = JSON.parse(value) as MetaTplChoice;
        savedLabel = `${v.name} (${v.language}, saved)`;
      } catch { /* ignore */ }
    }
    return (
      <div>
        <Label className="text-[10px] text-muted-foreground">{label}</Label>
        <select
          className="mt-1 w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={list.length === 0 && !value}
        >
          <option value="">— none —</option>
          {savedLabel && <option value={value}>{savedLabel}</option>}
          {list.map((t) => (
            <option key={`${t.name}|${t.language}`} value={tplOption(t)}>
              {t.name} ({t.language}, {t.paramCount} variable{t.paramCount === 1 ? "" : "s"})
            </option>
          ))}
        </select>
      </div>
    );
  };

  const renderMetaFields = (connectionId?: string) => (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Meta permanent access token {connectionId ? "" : "*"}</Label>
        <Input
          className="mt-1 h-9 font-mono text-xs"
          type="password"
          placeholder={connectionId ? "Leave blank to keep the saved token" : "EAAG…"}
          value={metaToken}
          onChange={(e) => setMetaToken(e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground mt-1">
          Meta Business → System user → Generate token with <code>whatsapp_business_messaging</code> + <code>whatsapp_business_management</code>.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Phone number ID *</Label>
          <Input className="mt-1 h-9 font-mono text-xs" placeholder="123456789012345" value={metaPhoneId} onChange={(e) => setMetaPhoneId(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">WhatsApp Business Account ID *</Label>
          <Input className="mt-1 h-9 font-mono text-xs" placeholder="WABA ID" value={metaWabaId} onChange={(e) => setMetaWabaId(e.target.value)} />
        </div>
      </div>
      <div>
        <Label className="text-xs">API base URL (optional)</Label>
        <Input
          className="mt-1 h-9 font-mono text-xs"
          placeholder="https://graph.facebook.com/v21.0 (default) — or your panel's API URL"
          value={metaApiBase}
          onChange={(e) => setMetaApiBase(e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground mt-1">
          Only needed if your token comes from a reseller panel (BSP) like whatsapi.in — paste the panel's "API URL" here. Leave blank for a real Meta token.
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={metaFetching || ((!metaToken.trim() || !metaWabaId.trim()) && !connectionId)}
        onClick={() => void fetchMetaTemplates(connectionId)}
      >
        {metaFetching ? "Connecting to Meta…" : "Fetch approved templates"}
      </Button>
      {metaPhoneInfo && <p className="text-[11px] text-emerald-500">{metaPhoneInfo}</p>}
      {metaTplList && (
        <div className="rounded-md border border-border/50 p-3 space-y-2">
          <p className="text-xs font-medium">Link templates ({metaTplList.length} approved found)</p>
          {renderMetaTplSelect("Default (fallback)", metaSelDefault, setMetaSelDefault)}
          {renderMetaTplSelect("After a call", metaSelSummary, setMetaSelSummary)}
          {renderMetaTplSelect("After a booking", metaSelBooking, setMetaSelBooking)}
          {renderMetaTplSelect("After a callback", metaSelCallback, setMetaSelCallback)}
          <p className="text-[10px] text-muted-foreground">
            These rows are SnapServe send-moments — each dropdown lists any approved template from your WABA (any Meta name).
          </p>
        </div>
      )}
    </div>
  );

  const templatesPayload = () => ({
    ...(tplDefault.trim() ? { default: tplDefault.trim() } : {}),
    ...(tplSummary.trim() ? { call_summary: tplSummary.trim() } : {}),
    ...(tplBooking.trim() ? { booking_confirmed: tplBooking.trim() } : {}),
    ...(tplCallback.trim() ? { callback_scheduled: tplCallback.trim() } : {}),
  });

  const resetForm = () => {
    setName("WhatsApp");
    setAgentId(agents[0]?.id ?? "");
    setOutboundUrl("");
    setRequestCall(true);
    setPostCall(true);
    setTplDefault("");
    setTplSummary("");
    setTplBooking("");
    setTplCallback("");
    setConnMode("webhook");
    setMetaToken("");
    setMetaPhoneId("");
    setMetaWabaId("");
    setMetaTplList(null);
    setMetaPhoneInfo(null);
    setMetaSelDefault("");
    setMetaSelSummary("");
    setMetaSelBooking("");
    setMetaSelCallback("");
  };

  const openBspCreate = (mode: "webhook" | "meta" = "webhook") => {
    resetForm();
    setAgentId(agents[0]?.id ?? "");
    setConnMode(mode);
    setShowByo(true);
    setCreateOpen(true);
  };

  const createMut = useMutation({
    mutationFn: () =>
      customFetch<WaConnection>(`${API}/whatsapp/connections`, {
        method: "POST",
        body: JSON.stringify({
          name,
          agentId: Number(agentId),
          outboundWebhookUrl: connMode === "webhook" ? (outboundUrl.trim() || null) : null,
          requestCallEnabled: requestCall,
          postCallEnabled: postCall,
          templates: templatesPayload(),
          ...(connMode === "meta"
            ? {
                metaAccessToken: metaToken.trim() || null,
                metaPhoneNumberId: metaPhoneId.trim() || null,
                metaWabaId: metaWabaId.trim() || null,
                metaApiBase: metaApiBase.trim() || null,
                metaTemplates: metaTemplatesPayload(),
              }
            : {}),
        }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: (row) => {
      // The signing secret is only relevant for webhook (BSP/Zapier) sending —
      // don't confuse Meta API users with it.
      setCreatedSecret(row.metaPhoneNumberId ? null : row.outboundSecret ?? null);
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
    <StripePage
      title="WhatsApp"
      description="Automatic WhatsApp follow-ups after every AI call — booking confirmations, summaries and callback alerts. Customers can reply to get a call back."
      back={{ href: "/app/connections", label: "Connections" }}
    >
      <div className="space-y-6">
      <NativeSection agents={agents} onChooseBsp={() => openBspCreate("webhook")} onChooseMeta={() => openBspCreate("meta")} metaConnected={connections.some((c) => c.active && c.metaPhoneNumberId)} />

      {/* Your connections */}
      {(connections.length > 0 || createdSecret || isLoading) && (
      <div className="space-y-4 pb-4" id="bsp-adopter">
          <div className="space-y-5">
            {createdSecret && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
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

            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : connections.length === 0 ? null : (
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
                          setConnMode(c.metaConnected ? "meta" : "webhook");
                          setMetaToken("");
                          setMetaPhoneId(c.metaPhoneNumberId ?? "");
                          setMetaWabaId(c.metaWabaId ?? "");
                          setMetaApiBase((c as any).metaApiBase ?? "");
                          setMetaTplList(null);
                          setMetaPhoneInfo(null);
                          setMetaSelDefault(c.metaTemplates?.default ? JSON.stringify(c.metaTemplates.default) : "");
                          setMetaSelSummary(c.metaTemplates?.call_summary ? JSON.stringify(c.metaTemplates.call_summary) : "");
                          setMetaSelBooking(c.metaTemplates?.booking_confirmed ? JSON.stringify(c.metaTemplates.booking_confirmed) : "");
                          setMetaSelCallback(c.metaTemplates?.callback_scheduled ? JSON.stringify(c.metaTemplates.callback_scheduled) : "");
                          // Prefill catalog from saved connection so picks work without re-fetch.
                          const savedCat = (c as { templateCatalog?: MetaTplInfo[] }).templateCatalog;
                          if (Array.isArray(savedCat) && savedCat.length) setMetaTplList(savedCat as MetaTplInfo[]);
                          setTplDefault(c.templates?.default ?? "");
                          setTplSummary(c.templates?.call_summary ?? "");
                          setTplBooking(c.templates?.booking_confirmed ?? "");
                          setTplCallback(c.templates?.callback_scheduled ?? "");
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

                    {c.requestCallEnabled && (
                      <div>
                        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Inbound URL — POST here to trigger a call
                        </Label>
                        <div className="mt-1 flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
                          <code className="text-[11px] flex-1 break-all">{c.inboundWebhookUrl}</code>
                          <CopyButton text={c.inboundWebhookUrl} label="Copy" />
                        </div>
                      </div>
                    )}
                    {c.metaPhoneNumberId && !c.outboundWebhookUrl ? (
                      <p className="text-[11px] text-muted-foreground">
                        Sending via Meta API · Phone ID {c.metaPhoneNumberId}
                      </p>
                    ) : (
                      <div>
                        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Outbound webhook — SnapServe POSTs here to send a template
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
                            Not set — edit to add your BSP webhook for sending.
                          </p>
                        )}
                      </div>
                    )}
                    {(c.templates?.call_summary || c.templates?.booking_confirmed || c.templates?.callback_scheduled) && (
                      <p className="text-[11px] text-muted-foreground font-mono">
                        Templates:{" "}
                        {[
                          c.templates.call_summary && `summary=${c.templates.call_summary}`,
                          c.templates.booking_confirmed && `booking=${c.templates.booking_confirmed}`,
                          c.templates.callback_scheduled && `callback=${c.templates.callback_scheduled}`,
                        ].filter(Boolean).join(" · ")}
                      </p>
                    )}

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
      </div>
      )}

      </div>

      {/* Create */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Connect WhatsApp</DialogTitle>
            <DialogDescription>
              Connect your Meta account directly, or paste a BSP/Zapier webhook.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-1 rounded-md border border-border/50 p-1">
              <button
                type="button"
                className={`h-8 rounded text-xs font-medium ${connMode === "meta" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setConnMode("meta")}
              >
                Meta Cloud API (direct)
              </button>
              <button
                type="button"
                className={`h-8 rounded text-xs font-medium ${connMode === "webhook" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setConnMode("webhook")}
              >
                Webhook (BSP / Zapier)
              </button>
            </div>
            <div>
              <Label className="text-xs">Name</Label>
              <Input className="mt-1 h-9" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">AI agent *</Label>
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
            {connMode === "meta" ? renderMetaFields() : (<>
            <div>
              <Label className="text-xs">Outbound webhook URL</Label>
              <Input
                className="mt-1 h-9"
                placeholder="https://hooks.zapier.com/… or your BSP endpoint"
                value={outboundUrl}
                onChange={(e) => setOutboundUrl(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                SnapServe POSTs here when a template should be sent (post-call or mid-call tool).
              </p>
            </div>
            <div className="rounded-md border border-border/50 p-3 space-y-2">
              <p className="text-xs font-medium">Map SnapServe moments → your BSP template names</p>
              <div>
                <Label className="text-[10px] text-muted-foreground">Default (fallback)</Label>
                <Input className="mt-1 h-8 text-xs font-mono" placeholder="your_default_template" value={tplDefault} onChange={(e) => setTplDefault(e.target.value)} />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">After a call</Label>
                <Input className="mt-1 h-8 text-xs font-mono" placeholder="any_approved_name" value={tplSummary} onChange={(e) => setTplSummary(e.target.value)} />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">After a booking</Label>
                <Input className="mt-1 h-8 text-xs font-mono" placeholder="any_approved_name" value={tplBooking} onChange={(e) => setTplBooking(e.target.value)} />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">After a callback</Label>
                <Input className="mt-1 h-8 text-xs font-mono" placeholder="any_approved_name" value={tplCallback} onChange={(e) => setTplCallback(e.target.value)} />
              </div>
            </div>
            </>)}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs">Post-call messages</Label>
                <p className="text-[10px] text-muted-foreground">Send after each call ends</p>
              </div>
              <Switch checked={postCall} onCheckedChange={setPostCall} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs">WhatsApp can trigger a call</Label>
                <p className="text-[10px] text-muted-foreground">Inbound URL dials this agent</p>
              </div>
              <Switch checked={requestCall} onCheckedChange={setRequestCall} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              For mid-call sends, enable <strong>Tools → Send WhatsApp</strong> on the agent after saving.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              disabled={!agentId || createMut.isPending || (connMode === "meta" && (!metaToken.trim() || !metaPhoneId.trim()))}
              onClick={() => createMut.mutate()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={!!editConn} onOpenChange={(o) => !o && setEditConn(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{connMode === "meta" ? "Edit Meta connection" : "Edit BSP connection"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input className="mt-1 h-9" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {connMode === "meta" ? renderMetaFields(editConn?.id) : (<>
            <div>
              <Label className="text-xs">Outbound webhook URL</Label>
              <Input
                className="mt-1 h-9"
                value={outboundUrl}
                onChange={(e) => setOutboundUrl(e.target.value)}
                placeholder="https://…"
              />
            </div>
            <div className="rounded-md border border-border/50 p-3 space-y-2">
              <p className="text-xs font-medium">Map SnapServe moments → your BSP template names</p>
              <div>
                <Label className="text-[10px] text-muted-foreground">Default (fallback)</Label>
                <Input className="mt-1 h-8 text-xs font-mono" value={tplDefault} onChange={(e) => setTplDefault(e.target.value)} />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">After a call</Label>
                <Input className="mt-1 h-8 text-xs font-mono" value={tplSummary} onChange={(e) => setTplSummary(e.target.value)} />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">After a booking</Label>
                <Input className="mt-1 h-8 text-xs font-mono" value={tplBooking} onChange={(e) => setTplBooking(e.target.value)} />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">After a callback</Label>
                <Input className="mt-1 h-8 text-xs font-mono" value={tplCallback} onChange={(e) => setTplCallback(e.target.value)} />
              </div>
            </div>
            </>)}
            <div className="flex items-center justify-between">
              <Label className="text-xs">Post-call messages</Label>
              <Switch checked={postCall} onCheckedChange={setPostCall} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">WhatsApp can trigger a call</Label>
              <Switch checked={requestCall} onCheckedChange={setRequestCall} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Active</Label>
              <Switch
                checked={editConn?.active ?? true}
                onCheckedChange={(v) => editConn && setEditConn({ ...editConn, active: v })}
              />
            </div>
            {editConn?.requestCallEnabled || requestCall ? (
              <div>
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Inbound URL</Label>
                <div className="mt-1 flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
                  <code className="text-[11px] flex-1 break-all">{editConn?.inboundWebhookUrl}</code>
                  {editConn && <CopyButton text={editConn.inboundWebhookUrl} label="Copy" />}
                </div>
              </div>
            ) : null}
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
                    outboundWebhookUrl: connMode === "webhook" ? (outboundUrl.trim() || null) : null,
                    requestCallEnabled: requestCall,
                    postCallEnabled: postCall,
                    active: editConn.active,
                    templates: templatesPayload(),
                    ...(connMode === "meta"
                      ? {
                          ...(metaToken.trim() ? { metaAccessToken: metaToken.trim() } : {}),
                          metaPhoneNumberId: metaPhoneId.trim() || null,
                          metaWabaId: metaWabaId.trim() || null,
                          metaApiBase: metaApiBase.trim() || null,
                          metaTemplates: metaTemplatesPayload(),
                        }
                      : { metaAccessToken: null, metaPhoneNumberId: null, metaWabaId: null, metaApiBase: null, metaTemplates: {} }),
                  },
                });
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StripePage>
  );
}
