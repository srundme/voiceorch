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
import { ByonPanel } from "@/components/whatsapp/byon-flow";
import { EngageSection } from "@/components/whatsapp/engage-section";
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
  const [bizOpen, setBizOpen] = useState(false);
  const [bizStep, setBizStep] = useState<1 | 2>(1);
  const [numberChoice, setNumberChoice] = useState<"buy" | "direct" | "voice">("buy");
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
    <div className="mx-6 space-y-4">
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
              </div>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold">Which describes you best?</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              WhatsApp for business runs on Meta's platform — the right setup depends on whether you have a Meta Business account (WABA).
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Non-business → instant shared tier */}
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.04] p-5 flex flex-col">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold">I don't have one — just make it work</h3>
                <Badge className="bg-emerald-500/15 text-emerald-400 border-transparent text-[10px]">Instant · most users</Badge>
              </div>
              <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground flex-1">
                <li>• Live in 30 seconds — <strong className="text-foreground">no Meta account, no number purchase, no documents</strong></li>
                <li>• Booking confirmations, call summaries &amp; callback alerts sent automatically after every call</li>
                <li>• Sent from SnapServe's verified WhatsApp number with your business name inside every message</li>
                <li>• Customers reply “call me” and your AI agent calls them back</li>
                <li>• Fair-use 50 messages/day — upgrade to Business WhatsApp any time</li>
              </ul>
              <Button
                size="sm"
                className="mt-4 w-full"
                disabled={!data?.sharedTierAvailable}
                onClick={openSharedDialog}
              >
                Enable Instant WhatsApp
              </Button>
              {!data?.sharedTierAvailable && (
                <p className="mt-2 text-[11px] text-amber-400/90">
                  Temporarily unavailable — the platform channel isn't configured yet. Check back soon or use Business WhatsApp.
                </p>
              )}
            </div>

            {/* Business → own-brand wizard */}
            <div className="rounded-lg border border-border/60 bg-card/30 p-5 flex flex-col">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-semibold">I have a Meta Business account</h3>
                <Badge variant="outline" className="text-[10px]">Your brand</Badge>
              </div>
              <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground flex-1">
                <li>• Messages come from <strong className="text-foreground">your own WhatsApp number</strong> with your name &amp; logo</li>
                <li>• Higher limits: 250/day to start, Meta raises it to 2,000+ automatically</li>
                <li>• Buy a WhatsApp-ready number from SnapServe (Phone Number ID auto-assigned), or connect one already registered in your WABA</li>
                <li>• Needs your WABA ID + a permanent Meta access token</li>
              </ul>
              <Button size="sm" variant="outline" className="mt-4 w-full" onClick={() => openBizWizard()}>
                Start Business setup
              </Button>
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
              {/* Option A — buy from SnapServe */}
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

              {/* Option C — WhatsApp-enable an existing voice number (BYON) */}
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
