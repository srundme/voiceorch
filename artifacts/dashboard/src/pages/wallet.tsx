import React, { useState, useCallback } from "react";
import { Wallet, Plus, RefreshCw, ArrowDownLeft, ArrowUpRight, Zap, CreditCard, ToggleLeft, ToggleRight, AlertCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useGetWallet, useCreateTopup, useVerifyPayment, useListTransactions, useUpdateAutopay, getGetWalletQueryKey, getListTransactionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

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

function centsToUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function paiseToinr(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

function txTypeLabel(type: string): { label: string; color: string; icon: React.ReactNode } {
  switch (type) {
    case "free_credit": return { label: "Free Credit",   color: "text-foreground",        icon: <Zap          className="w-3.5 h-3.5" /> };
    case "topup":       return { label: "Top-up",        color: "text-zinc-400",           icon: <ArrowDownLeft className="w-3.5 h-3.5" /> };
    case "auto_topup":  return { label: "Auto Top-up",   color: "text-zinc-400",           icon: <RefreshCw    className="w-3.5 h-3.5" /> };
    case "call_debit":  return { label: "Call Usage",    color: "text-muted-foreground",   icon: <ArrowUpRight  className="w-3.5 h-3.5" /> };
    default:            return { label: type,             color: "text-muted-foreground",   icon: null };
  }
}

const TOPUP_PRESETS = [10, 25, 50, 100];

export default function WalletPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [topupAmount, setTopupAmount]     = useState(25);
  const [customAmount, setCustomAmount]   = useState("");
  const [loading, setLoading]             = useState(false);
  const [mandateLoading, setMandateLoading] = useState(false);

  const { data: wallet, isLoading: walletLoading } = useGetWallet();
  const { data: transactions = [] }                 = useListTransactions({ limit: 50, offset: 0 });
  const { mutateAsync: createTopup }                = useCreateTopup();
  const { mutateAsync: verifyPayment }              = useVerifyPayment();
  const { mutateAsync: updateAutopay }              = useUpdateAutopay();

  const effectiveAmount = customAmount ? Math.max(10, Number(customAmount)) : topupAmount;

  // Open Razorpay checkout — handles both normal topup and mandate setup
  const openCheckout = useCallback(async (amountCents: number, setupMandate = false) => {
    await loadRazorpay();
    const order = await createTopup({ data: { amountCents, setupMandate } });

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

      const opts: Record<string, unknown> = {
        key:       order.keyId,
        amount:    order.amountPaise,
        currency:  order.currency,
        order_id:  order.orderId,
        name:      "SnapServe",
        description: setupMandate
          ? `Auto-pay mandate — ${centsToUsd(amountCents)}`
          : `Wallet top-up — ${centsToUsd(amountCents)}`,
        theme: { color: "#ededed" },
        modal: {
          // Called when user closes the modal without completing payment
          ondismiss: () => settle(() => reject(new Error("cancelled"))),
        },
        handler: async (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          try {
            const updated = await verifyPayment({
              data: {
                razorpayOrderId:   response.razorpay_order_id,
                razorpayPaymentId:  response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              },
            });
            // Immediately update the wallet cache with the verified balance
            // so the UI reflects the new balance without waiting for a refetch.
            queryClient.setQueryData(getGetWalletQueryKey(), updated);
            // Also refresh the transaction list to show the new top-up entry.
            queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
            settle(() => resolve());
          } catch {
            settle(() => reject(new Error("Payment verification failed")));
          }
        },
      };

      // Pass customer_id + recurring flag when setting up a mandate
      if (setupMandate && order.customerId) {
        opts.customer_id = order.customerId;
        opts.recurring   = 1;
      }

      new window.Razorpay(opts).open();
    });
  }, [createTopup, verifyPayment, queryClient]);

  const handleTopup = useCallback(async () => {
    const amountCents = effectiveAmount * 100;
    if (amountCents < 1000) {
      toast({ title: "Minimum top-up is $10", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await openCheckout(amountCents, false);
      toast({ title: `Wallet topped up — ${centsToUsd(amountCents)} added!` });
    } catch {
      toast({ title: "Payment failed or cancelled", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [effectiveAmount, openCheckout, toast]);

  const handleSetupMandate = useCallback(async () => {
    const amountCents = (wallet?.autoPayAmountCents ?? 1000);
    setMandateLoading(true);
    try {
      await openCheckout(amountCents, true);
      toast({ title: "Auto-pay mandate set up! Wallet will top up automatically." });
    } catch {
      toast({ title: "Mandate setup failed or cancelled", variant: "destructive" });
    } finally {
      setMandateLoading(false);
    }
  }, [wallet, openCheckout, toast]);

  const handleToggleAutopay = useCallback(async () => {
    if (!wallet) return;
    await updateAutopay({ data: { autoPayEnabled: !wallet.autoPayEnabled } });
    queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
  }, [wallet, updateAutopay, queryClient]);

  const handleAutopaySettings = useCallback(async (thresholdUsd: number, amountUsd: number) => {
    await updateAutopay({
      data: {
        autoPayThresholdCents: Math.round(thresholdUsd * 100),
        autoPayAmountCents:    Math.round(amountUsd * 100),
      },
    });
    queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
  }, [updateAutopay, queryClient]);

  const balanceLow    = wallet && wallet.balanceCents < 100;
  const mandateActive = wallet?.mandateActive ?? false;

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="border-b border-border px-6 py-4 flex items-center gap-3 shrink-0">
        <Wallet className="w-5 h-5 text-foreground" />
        <h1 className="font-semibold text-foreground text-lg">Wallet & Billing</h1>
        <span className="text-xs text-muted-foreground ml-auto">$0.03 / minute platform fee</span>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">

          {/* Balance Card */}
          <div className={`rounded-xl border p-6 ${balanceLow ? "border-border bg-zinc-500/5" : "border-border bg-card"}`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Available Balance</p>
                {walletLoading ? (
                  <div className="h-10 w-32 bg-muted rounded animate-pulse" />
                ) : (
                  <p className="text-4xl font-bold text-foreground tabular-nums">
                    {centsToUsd(wallet?.balanceCents ?? 0)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  {wallet?.freeCreditsGranted && <span className="text-foreground mr-2">✓ $5 free credit applied</span>}
                  Approx. {Math.floor((wallet?.balanceCents ?? 0) / 3)} minutes of orchestration remaining <span className="text-muted-foreground">(platform fee only — provider costs billed separately to your keys)</span>
                </p>
              </div>
              {balanceLow && (
                <div className="flex items-center gap-1.5 text-foreground text-xs bg-zinc-400/10 border border-zinc-400/20 rounded-lg px-3 py-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Low balance — top up to continue making calls
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top-up */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-muted-foreground" />
                <h2 className="font-medium text-foreground text-sm">Add Funds</h2>
                <span className="ml-auto text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">Card · UPI · QR · NetBanking</span>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {TOPUP_PRESETS.map((amt) => (
                  <button
                    key={amt}
                    onClick={() => { setTopupAmount(amt); setCustomAmount(""); }}
                    className={`rounded-lg py-2 text-sm font-medium border transition-colors ${
                      !customAmount && topupAmount === amt
                        ? "bg-muted border-[#ACADB1]/60 text-foreground"
                        : "border-border text-muted-foreground hover:border-[#ACADB1] hover:text-foreground"
                    }`}
                  >
                    ${amt}
                  </button>
                ))}
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Custom amount (min $10)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input
                    type="number"
                    min={10}
                    placeholder="Enter amount"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    className="pl-7 bg-muted border-border text-foreground"
                  />
                </div>
              </div>

              <Button
                className="w-full bg-primary hover:opacity-90 text-primary-foreground font-semibold"
                onClick={handleTopup}
                disabled={loading}
              >
                {loading ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4 mr-2" />
                )}
                Add {centsToUsd(effectiveAmount * 100)} via Razorpay
              </Button>
            </div>

            {/* Auto-pay */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-muted-foreground" />
                  <h2 className="font-medium text-foreground text-sm">Auto-pay</h2>
                  {mandateActive && (
                    <span className="flex items-center gap-1 text-[10px] text-foreground bg-muted border border-border rounded px-1.5 py-0.5">
                      <ShieldCheck className="w-3 h-3" /> Mandate active
                    </span>
                  )}
                </div>
                <button onClick={handleToggleAutopay} className="text-muted-foreground hover:text-foreground transition-colors">
                  {wallet?.autoPayEnabled
                    ? <ToggleRight className="w-6 h-6 text-foreground" />
                    : <ToggleLeft  className="w-6 h-6" />}
                </button>
              </div>

              <p className="text-xs text-muted-foreground">
                Automatically top up your wallet when the balance drops below the threshold.
                {!mandateActive && " Authorize once via UPI or card to enable."}
              </p>

              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Trigger when balance below</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      type="number"
                      min={1}
                      defaultValue={(wallet?.autoPayThresholdCents ?? 100) / 100}
                      onBlur={(e) => handleAutopaySettings(Number(e.target.value), (wallet?.autoPayAmountCents ?? 1000) / 100)}
                      className="pl-7 bg-muted border-border text-foreground"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Auto top-up amount (min $10)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      type="number"
                      min={10}
                      defaultValue={(wallet?.autoPayAmountCents ?? 1000) / 100}
                      onBlur={(e) => handleAutopaySettings((wallet?.autoPayThresholdCents ?? 100) / 100, Number(e.target.value))}
                      className="pl-7 bg-muted border-border text-foreground"
                    />
                  </div>
                </div>
              </div>

              {/* Mandate setup / status */}
              {!mandateActive ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleSetupMandate}
                  disabled={mandateLoading}
                >
                  {mandateLoading ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-4 h-4 mr-2" />
                  )}
                  Set up Auto-pay Mandate
                </Button>
              ) : (
                <div className={`text-xs px-3 py-2 rounded-lg ${wallet?.autoPayEnabled ? "bg-muted text-foreground border border-border" : "bg-muted text-muted-foreground"}`}>
                  {wallet?.autoPayEnabled
                    ? `Auto-pay ON — will charge ${centsToUsd(wallet.autoPayAmountCents)} when balance < ${centsToUsd(wallet.autoPayThresholdCents)}`
                    : "Mandate saved — enable the toggle to activate auto-pay"}
                </div>
              )}
            </div>
          </div>

          {/* Transaction history */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="font-medium text-foreground text-sm">Transaction History</h2>
            </div>
            {transactions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No transactions yet</div>
            ) : (
              <div className="divide-y divide-black/[0.06]">
                {transactions.map((txn) => {
                  const { label, color, icon } = txTypeLabel(txn.type);
                  const isCredit = txn.amountCents >= 0;
                  return (
                    <div key={txn.id} className="flex items-center px-5 py-3.5 gap-4">
                      <div className={`${color} shrink-0`}>{icon}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground truncate">{txn.description}</p>
                        <p className="text-xs text-muted-foreground">{label} · {new Date(txn.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-sm font-medium tabular-nums ${isCredit ? "text-foreground" : "text-muted-foreground"}`}>
                          {isCredit ? "+" : ""}{centsToUsd(txn.amountCents)}
                        </p>
                        <Badge variant="outline" className="text-[10px] border-border text-foreground">
                          {txn.status}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
