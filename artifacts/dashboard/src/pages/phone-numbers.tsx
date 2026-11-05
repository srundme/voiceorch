import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Phone, Plus, Trash2, Link2, Link2Off, Search, Loader2, Globe, AlertCircle, GitFork, ShieldCheck, ShieldAlert, ExternalLink, CheckCircle2, Lock, X } from "lucide-react";
import {
  useListPhoneNumbers,
  useListAvailablePhoneNumbers,
  useInitiatePhoneNumberPurchase,
  useConfirmPhoneNumberPurchase,
  useQuotePhoneNumberPromo,
  type PhonePromoQuote,
  useAssignPhoneNumber,
  useReleasePhoneNumber,
  useListAgents,
  useListProviders,
  getListProvidersQueryKey,
  useGetKycStatus,
  useStartKyc,
  useGetWallet,
  getListPhoneNumbersQueryKey,
  getListAvailablePhoneNumbersQueryKey,
  getListAgentsQueryKey,
  getGetKycStatusQueryKey,
  getGetWalletQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePartnerContext, usePartnerManagedWorkspace, partnerFetch } from "@/hooks/use-partner";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PhoneNumber } from "@workspace/api-client-react";

declare global {
  interface Window {
    Razorpay: new (opts: Record<string, unknown>) => { open(): void };
  }
}

function loadRazorpay(): Promise<void> {
  return new Promise((resolve) => {
    if (window.Razorpay) { resolve(); return; }
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    document.body.appendChild(s);
  });
}

const COUNTRY_OPTIONS = [
  { code: "IN", name: "India" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "AU", name: "Australia" },
  { code: "CA", name: "Canada" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "SG", name: "Singapore" },
  { code: "AE", name: "UAE" },
];

// ── KYC Banner ────────────────────────────────────────────────────────────────

function KycBanner() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: kycData, isLoading } = useGetKycStatus({ query: { queryKey: getGetKycStatusQueryKey() } });
  const startKyc = useStartKyc();

  useEffect(() => {
    function handleFocus() {
      void queryClient.invalidateQueries({ queryKey: getGetKycStatusQueryKey() });
    }
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [queryClient]);

  if (isLoading) return null;
  if (kycData?.kycStatus === "completed") {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-zinc-500/20 bg-zinc-500/5 text-foreground text-sm">
        <ShieldCheck className="h-4 w-4 shrink-0" />
        <span className="font-medium">Identity verified</span>
        <span className="text-foreground/70 text-xs">— You can purchase Aadhaar-required Indian numbers.</span>
      </div>
    );
  }

  function handleStartKyc() {
    startKyc.mutate(undefined, {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getGetKycStatusQueryKey() });
        if (data.widgetUrl) {
          window.open(data.widgetUrl, "_blank", "noopener,noreferrer");
          toast({
            title: "KYC verification opened",
            description: "Complete your identity verification in the new tab. Return here when done.",
          });
        } else if (data.status === "kyc_completed") {
          toast({ title: "Already verified!", description: "Your identity is already verified." });
        }
      },
      onError: (err: unknown) => {
        toast({ title: "Verification failed to start", description: formatApiError(err), variant: "destructive" });
      },
    });
  }

  const hasActiveSession =
    kycData?.sessionStatus &&
    !["revoked", "kyc_completed", "expired"].includes(kycData.sessionStatus);

  const isFailed = kycData?.kycStatus === "failed";

  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border text-sm ${
      isFailed
        ? "border-border bg-muted/40"
        : "border-zinc-500/20 bg-zinc-500/5"
    }`}>
      {isFailed
        ? <ShieldAlert className="h-4 w-4 text-foreground mt-0.5 shrink-0" />
        : <ShieldAlert className="h-4 w-4 text-zinc-500 mt-0.5 shrink-0" />
      }
      <div className="flex-1 space-y-1">
        <p className="font-medium text-foreground">
          {isFailed
            ? "Identity verification failed"
            : hasActiveSession
              ? "Identity verification in progress"
              : "Identity verification required"}
        </p>
        <p className="text-xs leading-relaxed text-foreground/70">
          {isFailed
            ? "Your KYC verification was unsuccessful. Common reasons include a name mismatch or OTP failure. Click below to try again."
            : hasActiveSession
              ? "A verification session is open. If you closed the tab, click 'Resume Verification' to start a fresh session."
              : "Indian DID numbers require Aadhaar verification (PAN + Aadhaar OTP for individuals, PAN + GSTIN for businesses). No document uploads — verified instantly via government APIs."}
        </p>
      </div>
      <Button
        size="sm"
        className={`h-8 gap-1.5 shrink-0 text-xs ${
          isFailed
            ? "bg-foreground hover:bg-foreground text-white"
            : "bg-zinc-500 hover:bg-zinc-600 text-white"
        }`}
        disabled={startKyc.isPending}
        onClick={handleStartKyc}
      >
        {startKyc.isPending
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <ExternalLink className="h-3.5 w-3.5" />
        }
        {hasActiveSession ? "Resume Verification" : "Verify Identity"}
      </Button>
    </div>
  );
}

// ── KYC Gate Dialog ───────────────────────────────────────────────────────────
// Shown when user tries to buy a number before completing KYC.

function KycGateDialog({ onClose, onStartKyc, isPending }: {
  onClose: () => void;
  onStartKyc: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" /> Identity Verification Required
          </DialogTitle>
          <DialogDescription>
            You must complete KYC before purchasing a phone number.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="flex items-start gap-3 p-3 rounded-lg border border-zinc-500/20 bg-zinc-500/5 text-sm">
            <ShieldAlert className="h-4 w-4 text-zinc-400 mt-0.5 shrink-0" />
            <div className="space-y-1 text-foreground/80 text-xs leading-relaxed">
              <p className="text-foreground font-medium text-sm">Why is this required?</p>
              <p>Indian telecom regulations (DoT) mandate Aadhaar-based identity verification before a DID number can be provisioned. This is a one-time process.</p>
              <p className="mt-1">You'll need: <span className="text-foreground">PAN card + Aadhaar OTP</span> (individuals) or <span className="text-foreground">PAN + GSTIN</span> (businesses). No document uploads — verified instantly via government APIs.</p>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="gap-1.5"
            onClick={onStartKyc}
            disabled={isPending}
          >
            {isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <ExternalLink className="h-3.5 w-3.5" />
            }
            Start Verification
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Assign Dialog ────────────────────────────────────────────────────────────

function AssignDialog({
  number,
  onClose,
}: {
  number: PhoneNumber;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: agents } = useListAgents({ query: { queryKey: getListAgentsQueryKey() } });
  const assign = useAssignPhoneNumber();
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    number.agentId ? String(number.agentId) : "none"
  );

  // Partners can also point a number at one of their clients' agents.
  const { data: partnerCtx } = usePartnerContext();
  const { getToken } = useAuth();
  const { data: clientAgents } = useQuery<{
    clients: { clerkId: string; name: string; agents: { id: number; name: string }[] }[];
  }>({
    queryKey: ["partner-client-agents"],
    enabled: !!partnerCtx?.isPartner,
    staleTime: 60_000,
    queryFn: () => partnerFetch(getToken, "/api/partner/client-agents"),
  });
  const clientGroups = clientAgents?.clients ?? [];

  function handleSave() {
    const newAgentId = selectedAgentId === "none" ? null : parseInt(selectedAgentId, 10);
    assign.mutate(
      { id: number.id, data: { agentId: newAgentId } },
      {
        onSuccess: (data) => {
          queryClient.invalidateQueries({ queryKey: getListPhoneNumbersQueryKey() });
          const link = (data as { inboundLink?: { verified?: boolean; detail?: string } | null })?.inboundLink;
          if (newAgentId === null) {
            toast({ title: "Number unassigned" });
          } else if (link?.verified !== false) {
            toast({
              title: "Number assigned",
              description: "Inbound is linked to SnapServe — callers can reach this agent.",
            });
          } else {
            toast({
              title: "Assignment failed",
              description: "Could not link inbound automatically. Try again in a moment.",
              variant: "destructive",
            });
          }
          onClose();
        },
        onError: (err: unknown) => toast({ title: "Error", variant: "destructive", description: formatApiError(err) }),
      }
    );
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{number.agentId ? "Reassign number" : "Assign number"}</DialogTitle>
          <DialogDescription>
            {(number as { partnerAssigned?: boolean }).partnerAssigned
              ? <>Move <span className="font-mono text-foreground">{number.number}</span> between your agents, or remove it to return the line to your provider.</>
              : <>Pick which agent gets inbound + caller ID for <span className="font-mono text-foreground">{number.number}</span>. Leave unassigned to free it for another agent.</>}
            {number.agentId && selectedAgentId !== "none" && Number(selectedAgentId) !== number.agentId ? (
              <span className="mt-2 block text-amber-600 dark:text-amber-400">
                Moving this number will stop incoming calls on the agent that has it now. That is the only way to change which agent owns the line.
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label className="text-sm">Agent</Label>
          <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
            <SelectTrigger>
              <SelectValue placeholder="Select agent…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                {(number as { partnerAssigned?: boolean }).partnerAssigned
                  ? "— Remove from agent —"
                  : "— Unassigned (keep in account) —"}
              </SelectItem>
              {clientGroups.length > 0 ? (
                <SelectGroup>
                  <SelectLabel>Your agents</SelectLabel>
                  {agents?.map(a => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                  ))}
                </SelectGroup>
              ) : (
                agents?.map(a => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                ))
              )}
              {clientGroups.map(c => (
                <SelectGroup key={c.clerkId}>
                  <SelectLabel>Client — {c.name}</SelectLabel>
                  {c.agents.map(a => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={assign.isPending}>
            {assign.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Format paise as ₹1,234.56. Promo prices are not whole rupees once GST lands. */
function inr(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ── Buy Number Dialog ─────────────────────────────────────────────────────────

function BuyNumberDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [country, setCountry] = useState("IN");
  const [pattern, setPattern] = useState("");
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [renewalMode, setRenewalMode] = useState<"autopay" | "wallet">("wallet");
  const [promoInput, setPromoInput] = useState("");
  const [promo, setPromo] = useState<PhonePromoQuote | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);

  const { data: available, isFetching, error: searchError, refetch } = useListAvailablePhoneNumbers(
    { countryCode: country, pattern: pattern || undefined },
    { query: { enabled: false, queryKey: getListAvailablePhoneNumbersQueryKey({ countryCode: country }), retry: false } }
  );
  const { data: wallet } = useGetWallet();
  const mandateActive = wallet?.mandateActive ?? false;

  const platformNotConfigured =
    searchError != null &&
    (searchError as any)?.response?.status === 503;

  const initiate = useInitiatePhoneNumberPurchase();
  const confirm  = useConfirmPhoneNumberPurchase();
  const [payingViaCheckout, setPayingViaCheckout] = useState(false);
  const [payingFromWallet, setPayingFromWallet] = useState(false);

  const quotePromo = useQuotePhoneNumberPromo();

  const selectedNum = available?.find(n => n.number === selected);
  // Prefix-tiered pricing from the API: monthlyRateCents = monthly rental + ₹100 one-time setup (before GST).
  // +9180… = ₹599/mo, +9179… = ₹699/mo, others ₹659/mo. All maths is in paise
  // so a promo like ₹199 (GST ₹35.82) shows exact paise instead of rounding.
  const SETUP_PAISE = 10_000;
  /** Wallet-funded first purchase requires balance strictly above ₹20,000. */
  const WALLET_PURCHASE_MIN_PAISE = 2_000_000;
  const STANDARD_BASE_PAISE = selectedNum?.monthlyRateCents ?? 0; // rental + setup, pre-GST
  const MONTHLY_PAISE = Math.max(STANDARD_BASE_PAISE - SETUP_PAISE, 0);
  const promoActive = promo?.valid === true;
  const isFreeClaim = promoActive && (promo.payablePaise ?? 0) === 0;
  const BASE_PAISE = promoActive ? promo.basePaise : STANDARD_BASE_PAISE;
  const GST_PAISE = promoActive ? promo.gstPaise : Math.round(STANDARD_BASE_PAISE * 0.18);
  const TOTAL_PAISE = promoActive ? promo.payablePaise : STANDARD_BASE_PAISE + GST_PAISE;
  // Renewals are never discounted — the number renews at its normal tier price.
  const RENEWAL_TOTAL_PAISE = promo?.standardPayablePaise
    ?? STANDARD_BASE_PAISE + Math.round(STANDARD_BASE_PAISE * 0.18);
  const isPaidNumber = (selectedNum?.monthlyRateCents ?? 0) > 0;
  const walletBalancePaise = wallet?.balanceCents ?? 0;
  const canPayFromWallet =
    walletBalancePaise > WALLET_PURCHASE_MIN_PAISE && walletBalancePaise >= TOTAL_PAISE;
  const purchaseBusy = payingViaCheckout || payingFromWallet;

  async function handleApplyPromo() {
    const code = promoInput.trim();
    if (!code || !selected) return;
    setPromoError(null);
    try {
      const quote = await quotePromo.mutateAsync({ data: { code, number: selected } });
      if (quote.valid) {
        setPromo(quote);
      } else {
        setPromo(null);
        setPromoError(quote.message ?? "That promo code isn't valid.");
      }
    } catch (err) {
      setPromo(null);
      setPromoError(formatApiError(err));
    }
  }

  function handleRemovePromo() {
    setPromo(null);
    setPromoInput("");
    setPromoError(null);
  }

  // A quote is priced against one number (the renewal tier differs per series),
  // so discard it if the buyer goes back and picks a different number.
  useEffect(() => {
    setPromo(null);
    setPromoError(null);
  }, [selected]);

  function handleSearch() {
    setSearched(true);
    setSelected(null);
    void refetch();
  }

  async function handlePurchaseFromWallet() {
    if (!selected || (!canPayFromWallet && !isFreeClaim)) return;
    if (renewalMode === "autopay" && !mandateActive) {
      toast({
        title: "Card auto-pay required",
        description: "Set up a card mandate in Wallet first, then buy with Autopay renewal.",
        variant: "destructive",
      });
      return;
    }
    setPayingFromWallet(true);
    try {
      await customFetch("/api/phone-numbers/purchase/wallet", {
        method: "POST",
        body: JSON.stringify({
          number: selected,
          countryCode: country,
          region: selectedNum?.region ?? undefined,
          numberType: selectedNum?.numberType ?? "local",
          renewalMode,
          ...(promoActive ? { promoCode: promo.code ?? undefined } : {}),
        }),
      });
      queryClient.invalidateQueries({ queryKey: getListPhoneNumbersQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
      toast({
        title: isFreeClaim ? "Phone number added" : "Phone number purchased!",
        description: isFreeClaim
          ? `${selected} is on your account at ₹0 today. Renewals are billed at the normal rate.`
          : `${selected} was paid from your wallet and is now in your account.`,
      });
      onClose();
    } catch (err: unknown) {
      const code = (err as { data?: { code?: string } })?.data?.code;
      if (code === "KYC_REQUIRED") {
        toast({
          title: "Identity verification required",
          description: "Complete KYC verification first using the banner on the Phone Numbers page.",
          variant: "destructive",
        });
        onClose();
      } else if (code === "NEED_AUTOPAY_SETUP") {
        toast({
          title: "Card auto-pay required",
          description: "Open Wallet to set up a card mandate, then choose Autopay renewal.",
          variant: "destructive",
        });
      } else if (code === "PROMO_ALREADY_USED" || code === "PROMO_NEEDS_EMAIL" || code === "PROMO_INVALID") {
        toast({
          title: "Promo code not valid",
          description: formatApiError(err),
          variant: "destructive",
        });
      } else if (code === "WALLET_PURCHASE_NOT_ELIGIBLE" || code === "INSUFFICIENT_BALANCE") {
        toast({
          title: "Can't pay from wallet",
          description: formatApiError(err),
          variant: "destructive",
        });
      } else {
        toast({ title: "Purchase failed", description: formatApiError(err), variant: "destructive" });
        setConfirming(false);
      }
    } finally {
      setPayingFromWallet(false);
    }
  }

  async function handlePurchase() {
    if (!selected) return;
    if (isFreeClaim || TOTAL_PAISE <= 0) {
      await handlePurchaseFromWallet();
      return;
    }
    if (renewalMode === "autopay" && !mandateActive) {
      toast({
        title: "Card auto-pay required",
        description: "Set up a card mandate in Wallet first, then buy with Autopay renewal.",
        variant: "destructive",
      });
      return;
    }
    setPayingViaCheckout(true);
    try {
      const order = await initiate.mutateAsync({
        data: {
          number: selected,
          countryCode: country,
          region: selectedNum?.region ?? undefined,
          numberType: selectedNum?.numberType ?? "local",
          renewalMode,
          ...(promoActive ? { promoCode: promo.code ?? undefined } : {}),
        },
      });

      await loadRazorpay();

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

        const opts: Record<string, unknown> = {
          key:      order.keyId,
          amount:   order.amount,
          currency: order.currency,
          order_id: order.orderId,
          name:     "SnapServe",
          description: `Phone number — ${inr(BASE_PAISE)} + GST ${inr(GST_PAISE)}`,
          theme: { color: "#ededed" },
          config: {
            display: {
              blocks: {
                upi: {
                  name: "UPI / GPay / PhonePe / Paytm",
                  instruments: [{ method: "upi" }],
                },
                card: {
                  name: "Cards",
                  instruments: [{ method: "card" }],
                },
                netbanking: {
                  name: "Net Banking",
                  instruments: [{ method: "netbanking" }],
                },
              },
              sequence: ["block.upi", "block.card", "block.netbanking"],
              preferences: { show_default_blocks: true },
            },
          },
          modal: {
            ondismiss: () => settle(() => reject(new Error("cancelled"))),
          },
          handler: async (response: {
            razorpay_order_id: string;
            razorpay_payment_id: string;
            razorpay_signature: string;
          }) => {
            try {
              await confirm.mutateAsync({
                data: {
                  purchaseOrderId:   order.purchaseOrderId,
                  razorpayOrderId:   response.razorpay_order_id,
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpaySignature: response.razorpay_signature,
                },
              });
              settle(() => resolve());
            } catch (err) {
              settle(() => reject(err instanceof Error ? err : new Error("Payment verification failed")));
            }
          },
        };

        new window.Razorpay(opts).open();
      });

      queryClient.invalidateQueries({ queryKey: getListPhoneNumbersQueryKey() });
      toast({ title: "Phone number purchased!", description: `${selected} is now in your account.` });
      onClose();
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "cancelled") {
        setPayingViaCheckout(false);
        return;
      }
      const code = (err as { data?: { code?: string } })?.data?.code;
      if (code === "KYC_REQUIRED") {
        toast({
          title: "Identity verification required",
          description: "Complete KYC verification first using the banner on the Phone Numbers page.",
          variant: "destructive",
        });
        onClose();
      } else if (code === "NEED_AUTOPAY_SETUP") {
        toast({
          title: "Card auto-pay required",
          description: "Open Wallet to set up a card mandate, then choose Autopay renewal.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Purchase failed", description: formatApiError(err), variant: "destructive" });
        setConfirming(false);
      }
    } finally {
      setPayingViaCheckout(false);
    }
  }

  if (confirming && selected) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="sm:max-w-md max-h-[90dvh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
            <DialogTitle>Confirm Purchase</DialogTitle>
            <DialogDescription>
              You are about to purchase <span className="font-mono text-foreground font-semibold">{selected}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-4">
          <div className="rounded-lg border border-border bg-muted divide-y divide-border text-sm">
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground">Number</span>
              <span className="font-mono font-medium text-foreground">{selected}</span>
            </div>
            {selectedNum?.region && (
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-muted-foreground">Region</span>
                <span className="text-foreground">{selectedNum.region}</span>
              </div>
            )}
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground">Provider</span>
              <span className="text-foreground font-medium">VoBiz</span>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground">Telephony rental</span>
              <span className={promoActive ? "text-muted-foreground line-through" : "text-foreground"}>
                {inr(MONTHLY_PAISE)}
              </span>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground">Setup cost</span>
              <span className={promoActive ? "text-muted-foreground line-through" : "text-foreground"}>
                {inr(SETUP_PAISE)}
              </span>
            </div>
            {promoActive && (
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-emerald-600 dark:text-emerald-500">
                  {promo.label ?? promo.code} offer price
                </span>
                <span className="font-medium text-emerald-600 dark:text-emerald-500">
                  {inr(BASE_PAISE)}
                </span>
              </div>
            )}
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground">GST (18%)</span>
              <span className="text-foreground">{inr(GST_PAISE)}</span>
            </div>
            <div className="flex justify-between px-4 py-2.5 border-t border-border mt-1 pt-2.5">
              <span className="text-muted-foreground font-medium">Pay now</span>
              <span className="font-semibold text-foreground">
                {promoActive && (
                  <span className="mr-2 font-normal text-muted-foreground line-through">
                    {inr(RENEWAL_TOTAL_PAISE)}
                  </span>
                )}
                {inr(TOTAL_PAISE)}
              </span>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground">Renews every 30 days</span>
              <span className="text-foreground">{inr(RENEWAL_TOTAL_PAISE)}</span>
            </div>
            {canPayFromWallet && (
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-muted-foreground">Wallet balance</span>
                <span className="text-foreground">{inr(walletBalancePaise)}</span>
              </div>
            )}
          </div>

          {/* Promo code */}
          <div className="space-y-2">
            <Label className="text-xs">Promo code</Label>
            {promoActive ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">
                    {promo.code} applied
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {isFreeClaim
                      ? "₹0 today — one use per email account. Renewals stay at the normal number price."
                      : `${inr(promo.discountPaise)} off — you pay ${inr(TOTAL_PAISE)} today instead of ${inr(RENEWAL_TOTAL_PAISE)}.`}
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="h-8 shrink-0 text-xs" onClick={handleRemovePromo}>
                  Remove
                </Button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <Input
                    value={promoInput}
                    onChange={e => { setPromoInput(e.target.value.toUpperCase()); setPromoError(null); }}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleApplyPromo(); } }}
                    placeholder="Enter code"
                    className="h-9 font-mono uppercase"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={quotePromo.isPending || purchaseBusy}
                  />
                  <Button
                    variant="outline"
                    className="h-9 shrink-0"
                    onClick={() => void handleApplyPromo()}
                    disabled={!promoInput.trim() || quotePromo.isPending || purchaseBusy}
                  >
                    {quotePromo.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
                  </Button>
                </div>
                {promoError && (
                  <p className="text-xs text-destructive">{promoError}</p>
                )}
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs">How should renewals be paid?</Label>
            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => setRenewalMode("autopay")}
                className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                  renewalMode === "autopay"
                    ? "border-foreground/40 bg-muted"
                    : "border-border hover:border-foreground/20"
                }`}
              >
                <div className="font-medium text-foreground">Autopay — keep number safe</div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  On renewal day we top up your wallet via your card mandate, then charge {inr(RENEWAL_TOTAL_PAISE)}. Requires a card mandate in Wallet.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setRenewalMode("wallet")}
                className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                  renewalMode === "wallet"
                    ? "border-foreground/40 bg-muted"
                    : "border-border hover:border-foreground/20"
                }`}
              >
                <div className="font-medium text-foreground">Wallet only</div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Renew from wallet balance. If unpaid for 7 days after the due date, the number is released.
                </p>
              </button>
            </div>
            {renewalMode === "autopay" && !mandateActive && (
              <div className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  No card mandate yet.{" "}
                  <button
                    type="button"
                    className="underline text-foreground"
                    onClick={() => { onClose(); setLocation("/app/wallet"); }}
                  >
                    Set up auto-pay in Wallet
                  </button>
                  {" "}first.
                </span>
              </div>
            )}
          </div>

          <div className="flex items-start gap-3 p-3 rounded-lg border border-zinc-500/20 bg-zinc-500/5 text-foreground text-xs">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              {isFreeClaim
                ? <>Today is ₹0 with this code (one use per email). KYC still applies. From day 30 the number renews at {inr(RENEWAL_TOTAL_PAISE)}.</>
                : canPayFromWallet
                ? <>You can pay {inr(TOTAL_PAISE)} from your wallet ({inr(BASE_PAISE)} + 18% GST), or pay by card / UPI.</>
                : <>You&apos;ll pay {inr(TOTAL_PAISE)} now by card ({inr(BASE_PAISE)} + 18% GST).</>}
              {!isFreeClaim && (promoActive
                ? ` The ${promo.code} price covers this purchase only — from day 30 the number renews at ${inr(RENEWAL_TOTAL_PAISE)} every 30 days`
                : ` Every 30 days the same amount (${inr(RENEWAL_TOTAL_PAISE)}) is charged`)}
              {!isFreeClaim && (renewalMode === "autopay"
                ? " via Autopay (mandate → wallet → debit)."
                : " from your wallet; unpaid past 7 days releases the number.")}
              {!isFreeClaim && !canPayFromWallet && walletBalancePaise > 0 && (
                <> Wallet pay unlocks above {inr(WALLET_PURCHASE_MIN_PAISE)} balance.</>
              )}
            </span>
          </div>
          </div>
          <DialogFooter className="shrink-0 border-t border-border bg-background px-6 py-4 flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={purchaseBusy}>Back</Button>
            <div className="flex flex-col sm:flex-row gap-2 sm:ml-auto w-full sm:w-auto">
              {isFreeClaim ? (
                <Button
                  className="bg-primary text-primary-foreground hover:bg-primary/90 w-full sm:w-auto"
                  onClick={() => void handlePurchaseFromWallet()}
                  disabled={purchaseBusy || (renewalMode === "autopay" && !mandateActive)}
                >
                  {payingFromWallet ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                  Get this number free
                </Button>
              ) : (
                <>
              {canPayFromWallet && (
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => void handlePurchaseFromWallet()}
                  disabled={purchaseBusy || (renewalMode === "autopay" && !mandateActive)}
                >
                  {payingFromWallet ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                  Pay from wallet
                </Button>
              )}
              <Button
                className="bg-primary text-primary-foreground hover:bg-primary/90 w-full sm:w-auto"
                onClick={handlePurchase}
                disabled={purchaseBusy || (renewalMode === "autopay" && !mandateActive)}
              >
                {payingViaCheckout ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                {canPayFromWallet ? `Pay ${inr(TOTAL_PAISE)} by card` : `Pay ${inr(TOTAL_PAISE)} & Get Number`}
              </Button>
                </>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Get a Phone Number</DialogTitle>
          <DialogDescription>
            Browse live number inventory. Monthly rental depends on the series (80-series ₹599, 79-series ₹699, others ₹659) plus a one-time ₹100 setup and 18% GST — then renews from your wallet every 30 days.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Country</Label>
              <Select value={country} onValueChange={v => { setCountry(v); setSearched(false); setSelected(null); }}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRY_OPTIONS.map(c => (
                    <SelectItem key={c.code} value={c.code}>{c.name} ({c.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Filter by digits</Label>
              <Input
                className="h-9 font-mono text-sm"
                placeholder="e.g. 9122"
                value={pattern}
                onChange={e => setPattern(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
              />
            </div>
          </div>

          <Button size="sm" className="h-9 gap-1.5 w-full" onClick={handleSearch} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Search Available Numbers
          </Button>

          {searched && (
            <div className="border border-border/60 rounded-lg overflow-hidden max-h-56 overflow-y-auto">
              {isFetching ? (
                <div className="space-y-2 p-3">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : platformNotConfigured ? (
                <div className="flex flex-col gap-2 p-4">
                  <div className="flex items-start gap-2.5 text-foreground">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium">Platform not configured</p>
                      <p className="text-foreground/70 mt-0.5 text-xs leading-relaxed">
                        Carrier credentials are missing. Contact your platform administrator.
                      </p>
                    </div>
                  </div>
                </div>
              ) : !available || available.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-sm">
                  <Globe className="h-8 w-8 mb-2 opacity-30" />
                  <p>No numbers available for {country}{pattern ? ` matching "${pattern}"` : ""}</p>
                  <p className="text-xs mt-1 text-muted-foreground">Try a different country or remove the filter.</p>
                </div>
              ) : (
                <div className="divide-y divide-border/40">
                  {available.map(n => (
                    <button
                      key={n.number}
                      onClick={() => setSelected(n.number)}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors text-left ${
                        selected === n.number ? "bg-muted border-l-2 border-zinc-500" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-medium text-foreground">{n.number}</span>
                        {n.region && <span className="text-xs text-muted-foreground">{n.region}</span>}
                      </div>
                      <div className="flex items-center gap-2 text-xs shrink-0">
                        <span className="text-foreground font-medium">
                          {(n.monthlyRateCents ?? 0) > 0 ? `₹${Math.round((n.monthlyRateCents ?? 0) / 100)} + GST` : "Free"}
                        </span>
                        <Badge variant="outline" className="text-[10px] capitalize">{n.numberType.replace("_", " ")}</Badge>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5"
            disabled={!selected}
            onClick={() => setConfirming(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            {selected && isFreeClaim
              ? "Get number free"
              : selected && isPaidNumber
              ? `Purchase — ${inr(TOTAL_PAISE)}`
              : "Purchase Number"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Routing Rules Dialog ──────────────────────────────────────────────────────

type RoutingRule = {
  condition: "caller_prefix" | "time_range" | "always";
  value?: string;
  startHour?: number;
  endHour?: number;
  targetAgentId: number;
};

function RoutingRulesDialog({ number, onClose }: { number: PhoneNumber; onClose: () => void }) {
  const { toast } = useToast();
  const { data: agents } = useListAgents({ query: { queryKey: getListAgentsQueryKey() } });
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    customFetch<{ routingRules: RoutingRule[] }>(`/api/phone-numbers/${number.id}/routing-rules`)
      .then(d => { setRules(d.routingRules ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [number.id]);

  function addRule() {
    setRules(r => [...r, { condition: "always", targetAgentId: (agents?.[0]?.id ?? 0) }]);
  }

  function removeRule(i: number) {
    setRules(r => r.filter((_, idx) => idx !== i));
  }

  function updateRule(i: number, patch: Partial<RoutingRule>) {
    setRules(r => r.map((rule, idx) => idx === i ? { ...rule, ...patch } : rule));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await customFetch(`/api/phone-numbers/${number.id}/routing-rules`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routingRules: rules }),
      });
      toast({ title: "Routing rules saved" });
      onClose();
    } catch {
      toast({ title: "Error", variant: "destructive", description: "Failed to save routing rules" });
    } finally { setSaving(false); }
  }

  const agentList = agents ?? [];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Routing Rules — <span className="font-mono">{number.number}</span></DialogTitle>
          <DialogDescription>
            Rules are evaluated top-to-bottom; the first match routes the call to the target agent.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {rules.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No rules — all calls go to the assigned agent.</p>
            )}
            {rules.map((rule, i) => (
              <div key={i} className="rounded-lg border border-border bg-muted p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Select value={rule.condition} onValueChange={v => updateRule(i, { condition: v as RoutingRule["condition"] })}>
                    <SelectTrigger className="h-7 text-xs flex-1 bg-card border-border"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      <SelectItem value="caller_prefix" className="text-xs">Caller prefix matches</SelectItem>
                      <SelectItem value="time_range" className="text-xs">Time of day (UTC)</SelectItem>
                      <SelectItem value="always" className="text-xs">Always (catch-all)</SelectItem>
                    </SelectContent>
                  </Select>
                  <button type="button" onClick={() => removeRule(i)} className="text-muted-foreground hover:text-foreground text-xs px-1 transition-colors"><X className="h-3.5 w-3.5" /></button>
                </div>
                {rule.condition === "caller_prefix" && (
                  <Input value={rule.value ?? ""} onChange={e => updateRule(i, { value: e.target.value })}
                    placeholder="+1800 or +44" className="h-7 text-xs bg-card border-border" />
                )}
                {rule.condition === "time_range" && (
                  <div className="flex gap-2 items-center">
                    <Input type="number" min={0} max={23} value={rule.startHour ?? 9}
                      onChange={e => updateRule(i, { startHour: parseInt(e.target.value) })}
                      className="h-7 w-16 text-xs text-center bg-card border-border" />
                    <span className="text-xs text-muted-foreground">to</span>
                    <Input type="number" min={0} max={23} value={rule.endHour ?? 17}
                      onChange={e => updateRule(i, { endHour: parseInt(e.target.value) })}
                      className="h-7 w-16 text-xs text-center bg-card border-border" />
                    <span className="text-xs text-muted-foreground">UTC</span>
                  </div>
                )}
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Route to agent</p>
                  <Select value={String(rule.targetAgentId)} onValueChange={v => updateRule(i, { targetAgentId: parseInt(v) })}>
                    <SelectTrigger className="h-7 text-xs bg-card border-border"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {agentList.map(a => (
                        <SelectItem key={a.id} value={String(a.id)} className="text-xs">{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
            <button type="button" onClick={addRule}
              className="w-full text-xs text-muted-foreground hover:text-muted-foreground border border-dashed border-white/[0.12] rounded-lg py-2 transition-colors">
              + Add rule
            </button>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save Rules
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
// Used by both normal user accounts and partner-client accounts.
// Clients: assign / reassign / remove only. Owners: buy + assign + release + KYC.

export default function PhoneNumbersPage({
  autoOpenBuy = false,
  onBuyClosed,
}: {
  /** When true (Buy tab), open the purchase dialog once KYC allows it. */
  autoOpenBuy?: boolean;
  onBuyClosed?: () => void;
} = {}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { isManagedWorkspace } = usePartnerManagedWorkspace();
  const { data: numbers, isLoading } = useListPhoneNumbers({ query: { queryKey: getListPhoneNumbersQueryKey() } });
  // BYO telephony (Plivo/Twilio/VoBiz own account): surface the imported
  // "fromNumber" from each telephony provider key so users can see it here.
  const { data: providerKeys } = useListProviders({ query: { queryKey: getListProvidersQueryKey() } });
  const importedNumbers = (providerKeys ?? [])
    // Plivo and VoBiz BYO numbers are imported as REAL rows in the numbers
    // list (assignable to agents like any other number) — don't double-show them.
    .filter((p) => p.providerType === "telephony" && p.isActive && !["plivo", "vobiz"].includes(p.providerName.toLowerCase()))
    .map((p) => {
      let fromNumber = "";
      try { fromNumber = (JSON.parse(p.extraConfig ?? "{}") as Record<string, string>)["fromNumber"] ?? ""; } catch { /* ignore */ }
      return { id: p.id, providerName: p.providerName, fromNumber };
    })
    .filter((p) => p.fromNumber);
  const { data: kycData, isLoading: kycLoading } = useGetKycStatus({ query: { queryKey: getGetKycStatusQueryKey() } });
  const startKyc = useStartKyc();
  const release = useReleasePhoneNumber();
  const [buyOpen, setBuyOpen] = useState(false);
  const [kycGateOpen, setKycGateOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<PhoneNumber | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<PhoneNumber | null>(null);
  const [routingTarget, setRoutingTarget] = useState<PhoneNumber | null>(null);

  const kycCompleted = kycData?.kycStatus === "completed";
  // Handle return from KYC redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const kyc = params.get("kyc");
    if (!kyc) return;

    setLocation("/app/phone-numbers", { replace: true });

    if (kyc === "kyc_completed" || kyc === "completed") {
      queryClient.invalidateQueries({ queryKey: getGetKycStatusQueryKey() });
      toast({
        title: "Identity verified!",
        description: (
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-zinc-500 shrink-0" />
            <span>Your verification is complete. You can now purchase phone numbers.</span>
          </div>
        ) as any,
      });
    } else if (kyc === "failed" || kyc === "kyc_failed") {
      queryClient.invalidateQueries({ queryKey: getGetKycStatusQueryKey() });
      toast({
        title: "Verification failed",
        description: "Your KYC verification was unsuccessful. Try again from the banner below.",
        variant: "destructive",
      });
    }
  }, []);

  function handleGetNumber() {
    if (isManagedWorkspace) return;
    if (!kycLoading && !kycCompleted) {
      setKycGateOpen(true);
    } else {
      setBuyOpen(true);
    }
  }

  // Buy tab (normal users): open purchase form once; partner clients never buy here.
  const buyTabOpened = React.useRef(false);
  useEffect(() => {
    if (!autoOpenBuy) {
      buyTabOpened.current = false;
      return;
    }
    if (isManagedWorkspace || kycLoading || buyTabOpened.current) return;
    buyTabOpened.current = true;
    handleGetNumber();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once per Buy-tab visit
  }, [autoOpenBuy, isManagedWorkspace, kycLoading, kycCompleted]);

  function handleStartKycFromGate() {
    startKyc.mutate(undefined, {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getGetKycStatusQueryKey() });
        setKycGateOpen(false);
        if (data.widgetUrl) {
          window.open(data.widgetUrl, "_blank", "noopener,noreferrer");
          toast({
            title: "KYC verification opened",
            description: "Complete your identity verification in the new tab, then come back to purchase a number.",
          });
        } else if (data.status === "kyc_completed") {
          toast({ title: "Already verified!", description: "Your identity is already verified." });
          setBuyOpen(true);
        }
      },
      onError: (err: unknown) => {
        toast({ title: "Verification failed to start", description: formatApiError(err), variant: "destructive" });
      },
    });
  }

  function handleRelease(n: PhoneNumber) {
    release.mutate(
      { id: n.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPhoneNumbersQueryKey() });
          toast({ title: "Number released", description: `${n.number} has been returned to inventory.` });
          setReleaseTarget(null);
        },
        onError: (err: unknown) => toast({ title: "Error", variant: "destructive", description: formatApiError(err) }),
      }
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-transparent">
      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
        {/* KYC only for accounts that can buy (not partner clients) */}
        {!isManagedWorkspace && <KycBanner />}

        {/* Imported BYO telephony numbers (from Provider keys) */}
        {importedNumbers.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Imported numbers — your own telephony</p>
            {importedNumbers.map((n) => (
              <div key={`byo-${n.id}`} className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card">
                <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="font-mono text-sm text-foreground">{n.fromNumber}</span>
                <Badge variant="outline" className="capitalize">{n.providerName}</Badge>
                <span className="ml-auto text-xs text-muted-foreground">
                  Used automatically by agents with {n.providerName.charAt(0).toUpperCase() + n.providerName.slice(1)} telephony · manage in Settings → Voices and Providers
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Numbers list */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-28 ml-auto" />
              </div>
            ))}
          </div>
        ) : !numbers || numbers.length === 0 ? (
          importedNumbers.length > 0 ? null : (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
            <Phone className="w-12 h-12 mb-4 opacity-30" />
            <p className="text-sm mb-3">No phone numbers yet.</p>
            {isManagedWorkspace ? (
              <p className="text-xs text-muted-foreground/70 max-w-sm text-center">
                No numbers on your agents yet. Ask your provider to assign a line — then you can reassign it here.
              </p>
            ) : (
              <Button size="sm" className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleGetNumber}>
                <Plus className="h-3.5 w-3.5" /> Get Your First Number
              </Button>
            )}
          </div>
          )
        ) : (
          <div className="space-y-2">
            {numbers.map(n => (
              <div
                key={n.id}
                className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 px-4 py-3 rounded-lg border border-border/60 bg-card hover:bg-card transition-colors"
              >
                <div className="shrink-0">
                  <p className="font-mono font-semibold text-foreground text-sm">{n.number}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{n.countryCode}{n.region ? ` · ${n.region}` : ""}</p>
                </div>

                {(n as { provider?: string }).provider === "plivo" ? (
                  <Badge variant="secondary" className="text-[10px] shrink-0">Your Plivo number · Free</Badge>
                ) : (n as { provider?: string }).provider === "vobiz_byo" ? (
                  <Badge variant="secondary" className="text-[10px] shrink-0">Your Vobiz number · Free</Badge>
                ) : (
                  <>
                    <Badge variant="outline" className="text-[10px] capitalize shrink-0">
                      {n.numberType.replace("_", " ")}
                    </Badge>
                    {n.renewalMode === "autopay" ? (
                      <Badge variant="secondary" className="text-[10px] shrink-0">Autopay</Badge>
                    ) : n.renewalMode === "wallet" ? (
                      <Badge variant="outline" className="text-[10px] shrink-0">Wallet renew</Badge>
                    ) : null}
                    {n.renewalGraceUntil && (
                      <Badge variant="destructive" className="text-[10px] shrink-0">Renewal unpaid</Badge>
                    )}
                  </>
                )}

                <div className="flex-1 min-w-0">
                  {n.agentName ? (
                    <div className="flex items-center gap-1.5 text-xs text-foreground">
                      <Link2 className="h-3 w-3" />
                      <span className="truncate">{n.agentName}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Link2Off className="h-3 w-3" />
                      Unassigned
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto sm:ml-auto">
                  {(() => {
                    const partnerAssigned = !!(n as { partnerAssigned?: boolean }).partnerAssigned;
                    const workspaceShared = !!(n as { workspaceShared?: boolean }).workspaceShared;
                    const ownerExtras = !isManagedWorkspace && !partnerAssigned && !workspaceShared;
                    return (
                      <>
                        {partnerAssigned && (
                          <Badge variant="secondary" className="text-[10px] shrink-0">From provider</Badge>
                        )}
                        {workspaceShared && (
                          <Badge variant="secondary" className="text-[10px] shrink-0">Workspace</Badge>
                        )}
                        {ownerExtras && n.agentId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                            onClick={() => setRoutingTarget(n)}
                          >
                            <GitFork className="h-3 w-3" /> Rules
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                          onClick={() => setAssignTarget(n)}
                        >
                          <Link2 className="h-3 w-3" /> {n.agentId ? "Reassign" : "Assign"}
                        </Button>
                        {ownerExtras && !["plivo", "vobiz_byo"].includes((n as { provider?: string }).provider ?? "") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                            onClick={() => setReleaseTarget(n)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Release confirm */}
        {releaseTarget && (
          <Dialog open onOpenChange={() => setReleaseTarget(null)}>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Release Number</DialogTitle>
                <DialogDescription>
                  Return <span className="font-mono text-foreground">{releaseTarget.number}</span> to inventory? This cannot be undone — you'll lose this number permanently.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setReleaseTarget(null)}>Cancel</Button>
                <Button
                  variant="destructive"
                  onClick={() => handleRelease(releaseTarget)}
                  disabled={release.isPending}
                >
                  {release.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                  Release
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Dialogs */}
      {kycGateOpen && (
        <KycGateDialog
          onClose={() => {
            setKycGateOpen(false);
            if (autoOpenBuy) onBuyClosed?.();
          }}
          onStartKyc={handleStartKycFromGate}
          isPending={startKyc.isPending}
        />
      )}
      {buyOpen && (
        <BuyNumberDialog
          onClose={() => {
            setBuyOpen(false);
            onBuyClosed?.();
          }}
        />
      )}
      {assignTarget && <AssignDialog number={assignTarget} onClose={() => setAssignTarget(null)} />}
      {routingTarget && <RoutingRulesDialog number={routingTarget} onClose={() => setRoutingTarget(null)} />}
    </div>
  );
}
