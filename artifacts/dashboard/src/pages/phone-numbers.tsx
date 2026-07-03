import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Phone, Plus, Trash2, Link2, Link2Off, Search, Loader2, Globe, AlertCircle, GitFork, DollarSign, ShieldCheck, ShieldAlert, ExternalLink, CheckCircle2, Lock, Wrench } from "lucide-react";
import {
  useListPhoneNumbers,
  useListAvailablePhoneNumbers,
  useInitiatePhoneNumberPurchase,
  useConfirmPhoneNumberPurchase,
  useAssignPhoneNumber,
  useReleasePhoneNumber,
  useListAgents,
  useGetKycStatus,
  useStartKyc,
  getListPhoneNumbersQueryKey,
  getListAvailablePhoneNumbersQueryKey,
  getListAgentsQueryKey,
  getGetKycStatusQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
    !["revoked", "kyc_completed"].includes(kycData.sessionStatus);

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

  function handleSave() {
    assign.mutate(
      {
        id: number.id,
        data: { agentId: selectedAgentId === "none" ? null : parseInt(selectedAgentId, 10) },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPhoneNumbersQueryKey() });
          toast({ title: "Assignment updated" });
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
          <DialogTitle>Assign Number</DialogTitle>
          <DialogDescription>
            Route inbound calls on <span className="font-mono text-foreground">{number.number}</span> to an agent.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label className="text-sm">Agent</Label>
          <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
            <SelectTrigger>
              <SelectValue placeholder="Select agent…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Unassigned —</SelectItem>
              {agents?.map(a => (
                <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
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

// ── Buy Number Dialog ─────────────────────────────────────────────────────────

function BuyNumberDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [country, setCountry] = useState("IN");
  const [pattern, setPattern] = useState("");
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const { data: available, isFetching, error: searchError, refetch } = useListAvailablePhoneNumbers(
    { countryCode: country, pattern: pattern || undefined },
    { query: { enabled: false, queryKey: getListAvailablePhoneNumbersQueryKey({ countryCode: country }), retry: false } }
  );

  const platformNotConfigured =
    searchError != null &&
    (searchError as any)?.response?.status === 503;

  const initiate = useInitiatePhoneNumberPurchase();
  const confirm  = useConfirmPhoneNumberPurchase();
  const [payingViaCheckout, setPayingViaCheckout] = useState(false);

  const selectedNum = available?.find(n => n.number === selected);
  // The $10 first-purchase fee (real payment) — shown here, distinct from the
  // $8/mo auto-renewal charged from the wallet balance every 30 days.
  const totalCents = selectedNum ? (selectedNum.monthlyRateCents ?? 0) : 0;

  function handleSearch() {
    setSearched(true);
    setSelected(null);
    void refetch();
  }

  async function handlePurchase() {
    if (!selected) return;
    setPayingViaCheckout(true);
    try {
      const order = await initiate.mutateAsync({
        data: {
          number: selected,
          countryCode: country,
          region: selectedNum?.region ?? undefined,
          numberType: selectedNum?.numberType ?? "local",
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
          description: `Phone number purchase — ${selected}`,
          theme: { color: "#ededed" },
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Purchase</DialogTitle>
            <DialogDescription>
              You are about to purchase <span className="font-mono text-foreground font-semibold">{selected}</span>.
            </DialogDescription>
          </DialogHeader>
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
              <span className="text-foreground font-medium">Aitel</span>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground">First purchase (pay now)</span>
              <span className="font-semibold text-foreground">{totalCents > 0 ? `$${(totalCents / 100).toFixed(2)}` : "Free"}</span>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground">Renews monthly (from wallet)</span>
              <span className="text-foreground">$8.00/mo</span>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg border border-zinc-500/20 bg-zinc-500/5 text-foreground text-xs">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>You'll be charged ${(totalCents / 100).toFixed(2)} now via card/UPI to activate this number. It then renews automatically at $8.00/mo from your wallet balance every 30 days until you release the number.</span>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={payingViaCheckout}>Back</Button>
            <Button
              className="bg-black/85 hover:bg-black/90 text-foreground"
              onClick={handlePurchase}
              disabled={payingViaCheckout}
            >
              {payingViaCheckout ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Pay ${(totalCents / 100).toFixed(2)} & Get Number
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Get a Phone Number</DialogTitle>
          <DialogDescription>
            Browse live number inventory from Aitel. Pricing varies by country and number type — fees are deducted from your SnapServe wallet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
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
                          {(n.monthlyRateCents ?? 0) > 0 ? `$${((n.monthlyRateCents ?? 0) / 100).toFixed(2)}/mo` : "Free"}
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
            className="bg-black/85 hover:bg-black/90 text-foreground gap-1.5"
            disabled={!selected}
            onClick={() => setConfirming(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            {selected && totalCents > 0
              ? `Purchase — $${(totalCents / 100).toFixed(2)}/mo`
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
    fetch(`/api/phone-numbers/${number.id}/routing-rules`)
      .then(r => r.json() as Promise<{ routingRules: RoutingRule[] }>)
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
      const resp = await fetch(`/api/phone-numbers/${number.id}/routing-rules`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routingRules: rules }),
      });
      if (!resp.ok) throw new Error("Save failed");
      toast({ title: "Routing rules saved" });
      onClose();
    } catch {
      toast({ title: "Error", variant: "destructive", description: "Failed to save routing rules" });
    } finally { setSaving(false); }
  }

  const agentList = agents ?? [];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-xl">
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
                  <button type="button" onClick={() => removeRule(i)} className="text-muted-foreground hover:text-foreground text-xs px-1 transition-colors">✕</button>
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
          <Button onClick={handleSave} disabled={saving} className="bg-black/85 hover:bg-black/90 text-foreground gap-1.5">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save Rules
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PhoneNumbersPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: numbers, isLoading } = useListPhoneNumbers({ query: { queryKey: getListPhoneNumbersQueryKey() } });
  const { data: kycData, isLoading: kycLoading } = useGetKycStatus({ query: { queryKey: getGetKycStatusQueryKey() } });
  const startKyc = useStartKyc();
  const release = useReleasePhoneNumber();
  const [buyOpen, setBuyOpen] = useState(false);
  const [kycGateOpen, setKycGateOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<PhoneNumber | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<PhoneNumber | null>(null);
  const [routingTarget, setRoutingTarget] = useState<PhoneNumber | null>(null);

  const kycCompleted = kycData?.kycStatus === "completed";
  const [fixingWebhookId, setFixingWebhookId] = useState<number | null>(null);

  async function handleFixWebhook(n: PhoneNumber) {
    setFixingWebhookId(n.id);
    try {
      const token = localStorage.getItem("voiceorch:session");
      const resp = await fetch(`/api/phone-numbers/${n.id}/configure-webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({})) as { error?: string };
        toast({ title: "Fix failed", description: body.error ?? `HTTP ${resp.status}`, variant: "destructive" });
      } else {
        toast({ title: "Inbound routing fixed", description: `${n.number} is now linked to our webhook in VoBiz.` });
      }
    } catch {
      toast({ title: "Network error", description: "Could not reach the server.", variant: "destructive" });
    } finally {
      setFixingWebhookId(null);
    }
  }

  // Handle return from KYC redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const kyc = params.get("kyc");
    if (!kyc) return;

    setLocation("/phone-numbers", { replace: true });

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
    if (!kycLoading && !kycCompleted) {
      setKycGateOpen(true);
    } else {
      setBuyOpen(true);
    }
  }

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
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center gap-3 shrink-0">
        <Phone className="w-5 h-5 text-foreground" />
        <h1 className="font-semibold text-foreground text-lg">Phone Numbers</h1>
        <span className="text-xs text-muted-foreground ml-auto">Powered by Aitel</span>
        <Button
          size="sm"
          className="h-8 gap-1.5 bg-black/85 hover:bg-black/90 text-foreground"
          onClick={handleGetNumber}
        >
          <Plus className="h-3.5 w-3.5" /> Get Number
        </Button>
      </div>

      <div className="p-6 max-w-4xl mx-auto space-y-4">
        {/* KYC banner */}
        <KycBanner />

        {/* Info banner */}
        <div className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card">
          <Globe className="h-5 w-5 text-foreground mt-0.5 shrink-0" />
          <div className="text-sm text-muted-foreground space-y-0.5">
            <p className="text-foreground font-medium">Self-serve number provisioning</p>
            <p>Search live inventory across 130+ countries via Aitel. Purchase a number and it's immediately active — assign it to any agent and inbound calls route straight to its pipeline. <span className="text-muted-foreground">Releasing returns the number to inventory.</span></p>
          </div>
        </div>

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
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
            <Phone className="w-12 h-12 mb-4 opacity-30" />
            <p className="text-sm mb-3">No phone numbers yet.</p>
            <Button size="sm" className="gap-1.5 bg-black/85 hover:bg-black/90 text-foreground" onClick={handleGetNumber}>
              <Plus className="h-3.5 w-3.5" /> Get your first number
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {numbers.map(n => (
              <div
                key={n.id}
                className="flex items-center gap-4 px-4 py-3 rounded-lg border border-border/60 bg-card hover:bg-card transition-colors"
              >
                <div className="shrink-0">
                  <p className="font-mono font-semibold text-foreground text-sm">{n.number}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{n.countryCode}{n.region ? ` · ${n.region}` : ""}</p>
                </div>

                <Badge variant="outline" className="text-[10px] capitalize shrink-0">
                  {n.numberType.replace("_", " ")}
                </Badge>

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

                {(n.monthlyRateCents ?? 0) > 0 && (
                  <div className="flex items-center gap-0.5 text-xs text-muted-foreground shrink-0">
                    <DollarSign className="h-3 w-3" />
                    <span>{((n.monthlyRateCents ?? 0) / 100).toFixed(2)}/mo</span>
                  </div>
                )}

                <div className="flex items-center gap-2 shrink-0">
                  {n.agentId && (
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
                    title="Re-link this number's inbound webhook in VoBiz (fixes 'not linked with any application' errors)"
                    onClick={() => handleFixWebhook(n)}
                    disabled={fixingWebhookId === n.id}
                  >
                    {fixingWebhookId === n.id
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Wrench className="h-3 w-3" />
                    }
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                    onClick={() => setAssignTarget(n)}
                  >
                    <Link2 className="h-3 w-3" /> {n.agentId ? "Reassign" : "Assign"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                    onClick={() => setReleaseTarget(n)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
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
          onClose={() => setKycGateOpen(false)}
          onStartKyc={handleStartKycFromGate}
          isPending={startKyc.isPending}
        />
      )}
      {buyOpen && <BuyNumberDialog onClose={() => setBuyOpen(false)} />}
      {assignTarget && <AssignDialog number={assignTarget} onClose={() => setAssignTarget(null)} />}
      {routingTarget && <RoutingRulesDialog number={routingTarget} onClose={() => setRoutingTarget(null)} />}
    </div>
  );
}
