import React, { useState, useCallback } from "react";
import { Wallet, Plus, RefreshCw, ArrowDownLeft, ArrowUpRight, Zap, CreditCard, ToggleLeft, ToggleRight, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useGetWallet, useCreateTopup, useVerifyPayment, useListTransactions, useUpdateAutopay, getGetWalletQueryKey } from "@workspace/api-client-react";
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

function txTypeLabel(type: string): { label: string; color: string; icon: React.ReactNode } {
  switch (type) {
    case "free_credit": return { label: "Free Credit", color: "text-white/75", icon: <Zap className="w-3.5 h-3.5" /> };
    case "topup":       return { label: "Top-up",       color: "text-blue-400",    icon: <ArrowDownLeft className="w-3.5 h-3.5" /> };
    case "auto_topup":  return { label: "Auto Top-up",  color: "text-blue-400",    icon: <RefreshCw className="w-3.5 h-3.5" /> };
    case "call_debit":  return { label: "Call Usage",   color: "text-white/50",    icon: <ArrowUpRight className="w-3.5 h-3.5" /> };
    default:            return { label: type,            color: "text-white/50",    icon: null };
  }
}

const TOPUP_PRESETS = [10, 25, 50, 100];

export default function WalletPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [topupAmount, setTopupAmount] = useState(25);
  const [customAmount, setCustomAmount] = useState("");
  const [loading, setLoading] = useState(false);

  const { data: wallet, isLoading: walletLoading } = useGetWallet();
  const { data: transactions = [] } = useListTransactions({ limit: 50, offset: 0 });
  const { mutateAsync: createTopup } = useCreateTopup();
  const { mutateAsync: verifyPayment } = useVerifyPayment();
  const { mutateAsync: updateAutopay } = useUpdateAutopay();

  const effectiveAmount = customAmount ? Math.max(10, Number(customAmount)) : topupAmount;

  const handleTopup = useCallback(async () => {
    const amountCents = effectiveAmount * 100;
    if (amountCents < 1000) {
      toast({ title: "Minimum top-up is $10", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await loadRazorpay();
      const order = await createTopup({ data: { amountCents } });
      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amountCents,
        currency: order.currency,
        order_id: order.orderId,
        name: "SnapServe",
        description: `Wallet top-up — ${centsToUsd(amountCents)}`,
        theme: { color: "#10b981" },
        handler: async (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            await verifyPayment({
              data: {
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              },
            });
            queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
            toast({ title: `Wallet topped up — ${centsToUsd(amountCents)} added!` });
          } catch {
            toast({ title: "Payment verification failed", variant: "destructive" });
          }
        },
      });
      rzp.open();
    } catch (err) {
      toast({ title: "Failed to initiate payment", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [effectiveAmount, createTopup, verifyPayment, queryClient, toast]);

  const handleToggleAutopay = useCallback(async () => {
    if (!wallet) return;
    await updateAutopay({ data: { autoPayEnabled: !wallet.autoPayEnabled } });
    queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
  }, [wallet, updateAutopay, queryClient]);

  const handleAutopaySettings = useCallback(async (thresholdUsd: number, amountUsd: number) => {
    await updateAutopay({
      data: {
        autoPayThresholdCents: Math.round(thresholdUsd * 100),
        autoPayAmountCents: Math.round(amountUsd * 100),
      },
    });
    queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
  }, [updateAutopay, queryClient]);

  const balanceLow = wallet && wallet.balanceCents < 100;

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="border-b border-white/[0.06] px-6 py-4 flex items-center gap-3 shrink-0">
        <Wallet className="w-5 h-5 text-white/75" />
        <h1 className="font-semibold text-white/85 text-lg">Wallet & Billing</h1>
        <span className="text-xs text-white/35 ml-auto">$0.03 / minute platform fee</span>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">

          {/* Balance Card */}
          <div className={`rounded-xl border p-6 ${balanceLow ? "border-amber-500/30 bg-amber-500/5" : "border-white/[0.07] bg-card/90 backdrop-blur-xl"}`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-white/35 uppercase tracking-widest mb-1">Available Balance</p>
                {walletLoading ? (
                  <div className="h-10 w-32 bg-card/[0.08] rounded animate-pulse" />
                ) : (
                  <p className="text-4xl font-bold text-white/85 tabular-nums">
                    {centsToUsd(wallet?.balanceCents ?? 0)}
                  </p>
                )}
                <p className="text-xs text-white/35 mt-2">
                  {wallet?.freeCreditsGranted && <span className="text-white/75 mr-2">✓ $5 free credit applied</span>}
                  Approx. {Math.floor((wallet?.balanceCents ?? 0) / 3)} minutes of orchestration remaining <span className="text-white/35">(platform fee only — provider costs billed separately to your keys)</span>
                </p>
              </div>
              {balanceLow && (
                <div className="flex items-center gap-1.5 text-amber-400 text-xs bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Low balance — top up to continue making calls
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top-up */}
            <div className="rounded-xl border border-white/[0.07] bg-card/90 backdrop-blur-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-white/50" />
                <h2 className="font-medium text-white/85 text-sm">Add Funds</h2>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {TOPUP_PRESETS.map((amt) => (
                  <button
                    key={amt}
                    onClick={() => { setTopupAmount(amt); setCustomAmount(""); }}
                    className={`rounded-lg py-2 text-sm font-medium border transition-colors ${
                      !customAmount && topupAmount === amt
                        ? "bg-card/[0.04] border-[#ACADB1]/60 text-white/75"
                        : "border-white/[0.07] text-white/50 hover:border-[#ACADB1] hover:text-white/75"
                    }`}
                  >
                    ${amt}
                  </button>
                ))}
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-white/35">Custom amount (min $10)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50 text-sm">$</span>
                  <Input
                    type="number"
                    min={10}
                    placeholder="Enter amount"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    className="pl-7 bg-card/[0.08] border-white/[0.07] text-white/85"
                  />
                </div>
              </div>

              <Button
                className="w-full bg-black/80 hover:bg-black/80 text-white/90 font-semibold"
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
            <div className="rounded-xl border border-white/[0.07] bg-card/90 backdrop-blur-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-white/50" />
                  <h2 className="font-medium text-white/85 text-sm">Auto-pay</h2>
                </div>
                <button onClick={handleToggleAutopay} className="text-white/50 hover:text-white/85 transition-colors">
                  {wallet?.autoPayEnabled
                    ? <ToggleRight className="w-6 h-6 text-white/75" />
                    : <ToggleLeft className="w-6 h-6" />}
                </button>
              </div>

              <p className="text-xs text-white/35">
                Automatically top up your wallet when the balance drops below the threshold. Requires a saved Razorpay payment method.
              </p>

              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-white/35">Trigger when balance below</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50 text-sm">$</span>
                    <Input
                      type="number"
                      min={1}
                      defaultValue={(wallet?.autoPayThresholdCents ?? 100) / 100}
                      onBlur={(e) => handleAutopaySettings(Number(e.target.value), (wallet?.autoPayAmountCents ?? 1000) / 100)}
                      className="pl-7 bg-card/[0.08] border-white/[0.07] text-white/85"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-white/35">Auto top-up amount (min $10)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50 text-sm">$</span>
                    <Input
                      type="number"
                      min={10}
                      defaultValue={(wallet?.autoPayAmountCents ?? 1000) / 100}
                      onBlur={(e) => handleAutopaySettings((wallet?.autoPayThresholdCents ?? 100) / 100, Number(e.target.value))}
                      className="pl-7 bg-card/[0.08] border-white/[0.07] text-white/85"
                    />
                  </div>
                </div>
              </div>

              <div className={`text-xs px-3 py-2 rounded-lg ${wallet?.autoPayEnabled ? "bg-card/[0.04] text-white/75 border border-white/[0.08]" : "bg-card/[0.08] text-white/35"}`}>
                {wallet?.autoPayEnabled
                  ? `Auto-pay ON — will top up ${centsToUsd(wallet.autoPayAmountCents)} when balance < ${centsToUsd(wallet.autoPayThresholdCents)}`
                  : "Auto-pay is disabled"}
              </div>
            </div>
          </div>

          {/* Transaction history */}
          <div className="rounded-xl border border-white/[0.07] bg-card/90 backdrop-blur-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06]">
              <h2 className="font-medium text-white/85 text-sm">Transaction History</h2>
            </div>
            {transactions.length === 0 ? (
              <div className="text-center py-12 text-white/35 text-sm">No transactions yet</div>
            ) : (
              <div className="divide-y divide-black/[0.06]">
                {transactions.map((txn) => {
                  const { label, color, icon } = txTypeLabel(txn.type);
                  const isCredit = txn.amountCents >= 0;
                  return (
                    <div key={txn.id} className="flex items-center px-5 py-3.5 gap-4">
                      <div className={`${color} shrink-0`}>{icon}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white/75 truncate">{txn.description}</p>
                        <p className="text-xs text-white/35">{label} · {new Date(txn.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-sm font-medium tabular-nums ${isCredit ? "text-white/75" : "text-white/50"}`}>
                          {isCredit ? "+" : ""}{centsToUsd(txn.amountCents)}
                        </p>
                        <Badge variant="outline" className={`text-[10px] ${txn.status === "completed" ? "border-white/[0.10] text-white/75" : txn.status === "pending" ? "border-amber-500/30 text-amber-400" : "border-red-500/30 text-red-400"}`}>
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
