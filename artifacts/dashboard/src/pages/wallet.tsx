import React, { useState, useCallback, useMemo, useEffect } from "react";
import { Wallet, Plus, RefreshCw, ArrowDownLeft, ArrowUpRight, Zap, CreditCard, ToggleLeft, ToggleRight, AlertCircle, ShieldCheck, CheckCircle2, FileText, Download } from "lucide-react";
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

const GST_RATE = 0.18;
const MIN_TOPUP_INR = 100;
const TOPUP_PRESETS = [500, 1000, 2000, 5000];

interface InvoiceRow {
  id: number;
  invoiceNumber: string;
  type: string;
  description: string;
  totalCents: number;
  status: string;
  createdAt: string;
}

function sessionToken(): string | null {
  try { return localStorage.getItem("voiceorch:session"); } catch { return null; }
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

function paiseToInr(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

function formatInrRupees(rupees: number): string {
  return `₹${rupees.toFixed(2)}`;
}

function withGstRupees(baseRupees: number): { base: number; gst: number; total: number } {
  const base = Math.round(baseRupees * 100) / 100;
  const gst = Math.round(base * GST_RATE * 100) / 100;
  return { base, gst, total: Math.round((base + gst) * 100) / 100 };
}

function txTypeLabel(type: string): { label: string; color: string; icon: React.ReactNode } {
  switch (type) {
    case "free_credit": return { label: "Free Credit",   color: "text-foreground",        icon: <Zap          className="w-3.5 h-3.5" /> };
    case "topup":       return { label: "Top-up",        color: "text-zinc-400",           icon: <ArrowDownLeft className="w-3.5 h-3.5" /> };
    case "auto_topup":  return { label: "Auto Top-up",   color: "text-zinc-400",           icon: <RefreshCw    className="w-3.5 h-3.5" /> };
    case "call_debit":  return { label: "Call Usage",    color: "text-muted-foreground",   icon: <ArrowUpRight  className="w-3.5 h-3.5" /> };
    case "partner_earning":      return { label: "Partner Earning", color: "text-emerald-400",       icon: <ArrowDownLeft className="w-3.5 h-3.5" /> };
    case "partner_transfer_in":  return { label: "Partner Credit",  color: "text-emerald-400",       icon: <ArrowDownLeft className="w-3.5 h-3.5" /> };
    case "partner_transfer_out": return { label: "Client Transfer", color: "text-muted-foreground",  icon: <ArrowUpRight  className="w-3.5 h-3.5" /> };
    default:            return { label: type,             color: "text-muted-foreground",   icon: null };
  }
}

export default function WalletPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [topupAmount, setTopupAmount]     = useState(1000);
  const [customAmount, setCustomAmount]   = useState("");
  const [loading, setLoading]             = useState(false);
  const [mandateLoading, setMandateLoading] = useState(false);

  const { data: wallet, isLoading: walletLoading } = useGetWallet();
  const { data: transactions = [] }                 = useListTransactions({ limit: 50, offset: 0 });
  const { mutateAsync: createTopup }                = useCreateTopup();
  const { mutateAsync: verifyPayment }              = useVerifyPayment();
  const { mutateAsync: updateAutopay }              = useUpdateAutopay();

  const [invoices, setInvoices]           = useState<InvoiceRow[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const loadInvoices = useCallback(async () => {
    try {
      const token = sessionToken();
      const r = await fetch("/api/wallet/invoices?limit=100", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (r.ok) setInvoices((await r.json()) as InvoiceRow[]);
    } catch {
      /* non-fatal */
    } finally {
      setInvoicesLoading(false);
    }
  }, []);

  useEffect(() => { void loadInvoices(); }, [loadInvoices]);

  // Handle the redirect-mode return from Razorpay (?topup=success|failed). One-
  // time top-ups navigate away to the bank and come back here via the server
  // callback, so success is reported on return rather than via the JS handler.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const topup = params.get("topup");
    if (!topup) return;
    if (topup === "success") {
      toast({ title: "Payment successful — wallet updated!" });
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
      setTimeout(() => { void loadInvoices(); }, 2500);
    } else if (topup === "failed") {
      toast({ title: "Payment failed or cancelled", variant: "destructive" });
    }
    params.delete("topup");
    const clean = window.location.pathname + (params.toString() ? `?${params.toString()}` : "");
    window.history.replaceState({}, "", clean);
    // Run once on mount for the return redirect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const downloadInvoice = useCallback(async (inv: InvoiceRow) => {
    setDownloadingId(inv.id);
    try {
      const token = sessionToken();
      const r = await fetch(`/api/wallet/invoices/${inv.id}/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error("failed");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${inv.invoiceNumber.replace(/\//g, "-")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Could not download invoice", variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  }, [toast]);

  const effectiveAmount = customAmount ? Math.max(MIN_TOPUP_INR, Number(customAmount) || 0) : topupAmount;
  const payableBreakdown = useMemo(() => withGstRupees(effectiveAmount), [effectiveAmount]);

  const openCheckout = useCallback(async (amountPaise: number, setupMandate = false) => {
    await loadRazorpay();
    const order = await createTopup({ data: { amountCents: amountPaise, setupMandate } });
    // Derive the label strictly from the order the server actually created
    // (amountPaise == base credit sent, order.amount == payable incl. GST) so the
    // Razorpay description can never drift from the real charge.
    const baseLabelPaise = amountPaise;
    const gstLabelPaise = Math.max(0, (order.amount ?? amountPaise) - amountPaise);

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

      const opts: Record<string, unknown> = {
        key:       order.keyId,
        amount:    order.amount,
        currency:  order.currency ?? "INR",
        order_id:  order.orderId,
        name:      "SnapServe",
        description: setupMandate
          ? `Auto-pay mandate — ${paiseToInr(baseLabelPaise)} + GST`
          : `Wallet top-up — ${paiseToInr(baseLabelPaise)} + GST ${paiseToInr(gstLabelPaise)}`,
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
            const updated = await verifyPayment({
              data: {
                razorpayOrderId:   response.razorpay_order_id,
                razorpayPaymentId:  response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              },
            });
            queryClient.setQueryData(getGetWalletQueryKey(), updated);
            queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
            settle(() => resolve());
          } catch {
            settle(() => reject(new Error("Payment verification failed")));
          }
        },
      };

      if (setupMandate && order.customerId) {
        // Recurring auto-pay mandates must be backed by a card (net banking
        // cannot authorize a recurring card mandate), so restrict to card only.
        // Mandates use the popup/handler flow (redirect mode is card-only here).
        opts.customer_id = order.customerId;
        opts.recurring   = 1;
        opts.config = {
          display: {
            blocks: {
              card: { name: "Pay using Card", instruments: [{ method: "card" }] },
            },
            sequence: ["block.card"],
            preferences: { show_default_blocks: false },
          },
        };
      } else {
        // One-time top-ups: use redirect mode. Net banking (and some UPI) open a
        // bank page that browsers refuse to render inside Razorpay's popup/iframe
        // (the popup stays at about:blank). Redirect mode makes the whole flow a
        // top-level navigation and returns to our server callback, which credits
        // the wallet and 302s back here with ?topup=success|failed. The default
        // menu (Card, UPI, Net Banking, Wallets) is used — no custom config.
        const returnUrl = `${window.location.origin}${window.location.pathname}`;
        opts.redirect = true;
        opts.callback_url = `${window.location.origin}/api/wallet/payment-callback?return=${encodeURIComponent(returnUrl)}`;
      }

      new window.Razorpay(opts).open();
    });
  }, [createTopup, verifyPayment, queryClient]);

  const handleTopup = useCallback(async () => {
    const amountPaise = Math.round(effectiveAmount * 100);
    if (amountPaise < MIN_TOPUP_INR * 100) {
      toast({ title: `Minimum top-up is ₹${MIN_TOPUP_INR}`, variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await openCheckout(amountPaise, false);
      toast({ title: `Wallet topped up — ${formatInrRupees(effectiveAmount)} credit added!` });
      // Invoice is generated server-side just after payment verification; give it
      // a moment then refresh the list.
      setTimeout(() => { void loadInvoices(); }, 2500);
    } catch {
      toast({ title: "Payment failed or cancelled", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [effectiveAmount, openCheckout, toast]);

  const handleSetupMandate = useCallback(async () => {
    const amountPaise = wallet?.autoPayAmountCents ?? 50_000;
    setMandateLoading(true);
    try {
      await openCheckout(amountPaise, true);
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

  const handleAutopaySettings = useCallback(async (thresholdInr: number, amountInr: number) => {
    await updateAutopay({
      data: {
        autoPayThresholdCents: Math.round(thresholdInr * 100),
        autoPayAmountCents:    Math.round(amountInr * 100),
      },
    });
    queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
  }, [updateAutopay, queryClient]);

  const balanceLow    = wallet && wallet.balanceCents < 10_000; // < ₹100
  const mandateActive = wallet?.mandateActive ?? false;
  const minsRemaining = Math.floor(
    (wallet?.balanceCents ?? 0) / (wallet?.effectiveRateCentsPerMin ?? 500),
  );

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="border-b border-border px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 shrink-0">
        <div className="flex items-center gap-3">
        <Wallet className="w-5 h-5 text-foreground" />
        <h1 className="font-semibold text-foreground text-lg">Wallet & Billing</h1>
        </div>
        <span className="text-xs text-muted-foreground sm:ml-auto">₹5 / minute · INR · GST on top-ups</span>
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="max-w-4xl mx-auto space-y-6">

          <div className={`rounded-xl border p-6 ${balanceLow ? "border-border bg-zinc-500/5" : "border-border bg-card"}`}>
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Available Balance</p>
                {walletLoading ? (
                  <div className="h-10 w-32 bg-muted rounded animate-pulse" />
                ) : (
                  <p className="text-4xl font-bold text-foreground tabular-nums">
                    {paiseToInr(wallet?.balanceCents ?? 0)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  {wallet?.freeCreditsGranted && (
                    <span className="text-foreground mr-2 inline-flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                      ₹500 free credit applied
                    </span>
                  )}
                  Approx. {minsRemaining} minutes remaining at ₹5/min
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
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-muted-foreground" />
                <h2 className="font-medium text-foreground text-sm">Add Funds</h2>
                <span className="ml-auto text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">Card, UPI & Net Banking</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {TOPUP_PRESETS.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => { setTopupAmount(amt); setCustomAmount(""); }}
                    className={`rounded-lg py-2 text-sm font-medium border transition-colors ${
                      !customAmount && topupAmount === amt
                        ? "bg-muted border-[#ACADB1]/60 text-foreground"
                        : "border-border text-muted-foreground hover:border-[#ACADB1] hover:text-foreground"
                    }`}
                  >
                    ₹{amt}
                  </button>
                ))}
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Custom amount (min ₹{MIN_TOPUP_INR})</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">₹</span>
                  <Input
                    type="number"
                    min={MIN_TOPUP_INR}
                    placeholder="Enter amount"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    className="pl-7 bg-muted border-border text-foreground"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-xs space-y-1">
                <div className="flex justify-between text-muted-foreground">
                  <span>Wallet credit</span>
                  <span className="tabular-nums text-foreground">{formatInrRupees(payableBreakdown.base)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>GST (18%)</span>
                  <span className="tabular-nums text-foreground">{formatInrRupees(payableBreakdown.gst)}</span>
                </div>
                <div className="flex justify-between font-medium text-foreground pt-1 border-t border-border/50">
                  <span>You pay</span>
                  <span className="tabular-nums">{formatInrRupees(payableBreakdown.total)}</span>
                </div>
              </div>

              <Button
                className="w-full min-h-11 h-11 bg-primary hover:opacity-90 text-primary-foreground font-semibold"
                onClick={handleTopup}
                disabled={loading}
              >
                <Plus className="w-4 h-4 mr-2" />
                {loading ? "Processing…" : `Pay ${formatInrRupees(payableBreakdown.total)}`}
              </Button>
            </div>

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
                <button
                  type="button"
                  onClick={handleToggleAutopay}
                  disabled={!mandateActive}
                  className={mandateActive ? "text-foreground" : "text-muted-foreground opacity-40 cursor-not-allowed"}
                  title={mandateActive ? undefined : "Set up a card mandate first"}
                >
                  {wallet?.autoPayEnabled ? <ToggleRight className="w-6 h-6" /> : <ToggleLeft className="w-6 h-6" />}
                </button>
              </div>

              <p className="text-xs text-muted-foreground">
                Automatically top up when balance drops below the threshold. Auto top-ups also include 18% GST.
                {!mandateActive && " Authorize once with your card to enable."}
              </p>

              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Trigger when balance below</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">₹</span>
                    <Input
                      type="number"
                      min={1}
                      defaultValue={(wallet?.autoPayThresholdCents ?? 10_000) / 100}
                      onBlur={(e) => handleAutopaySettings(Number(e.target.value), (wallet?.autoPayAmountCents ?? 50_000) / 100)}
                      className="pl-7 bg-muted border-border text-foreground"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Auto top-up credit (min ₹{MIN_TOPUP_INR})</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">₹</span>
                    <Input
                      type="number"
                      min={MIN_TOPUP_INR}
                      defaultValue={(wallet?.autoPayAmountCents ?? 50_000) / 100}
                      onBlur={(e) => handleAutopaySettings((wallet?.autoPayThresholdCents ?? 10_000) / 100, Number(e.target.value))}
                      className="pl-7 bg-muted border-border text-foreground"
                    />
                  </div>
                </div>
              </div>

              {!mandateActive && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleSetupMandate}
                  disabled={mandateLoading}
                >
                  <ShieldCheck className="w-4 h-4 mr-2" />
                  {mandateLoading ? "Setting up…" : "Set Up Card Auto-pay"}
                </Button>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center gap-2">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-medium text-foreground text-sm">Invoices &amp; Receipts</h2>
              <span className="ml-auto text-[10px] text-muted-foreground">GST tax invoices · PDF</span>
            </div>
            {invoicesLoading ? (
              <div className="text-center py-10 text-muted-foreground text-sm">Loading invoices…</div>
            ) : invoices.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm">No invoices yet. Invoices are generated automatically on every purchase.</div>
            ) : (
              <div className="divide-y divide-black/[0.06]">
                {invoices.map((inv) => (
                  <div key={inv.id} className="flex items-center px-5 py-3.5 gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{inv.invoiceNumber}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {inv.description} · {new Date(inv.createdAt).toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    </div>
                    <p className="text-sm font-medium tabular-nums text-foreground shrink-0">{paiseToInr(inv.totalCents)}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => downloadInvoice(inv)}
                      disabled={downloadingId === inv.id}
                    >
                      <Download className="w-3.5 h-3.5 mr-1.5" />
                      {downloadingId === inv.id ? "…" : "PDF"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

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
                        <p className="text-xs text-muted-foreground">{label} · {new Date(txn.createdAt).toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-sm font-medium tabular-nums ${isCredit ? "text-foreground" : "text-muted-foreground"}`}>
                          {isCredit ? "+" : ""}{paiseToInr(txn.amountCents)}
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
