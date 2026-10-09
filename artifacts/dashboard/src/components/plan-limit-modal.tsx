import React, { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldAlert, Crown, Users, Mail, PlusCircle, Zap, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open(): void };
  }
}

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && window.Razorpay) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.body.appendChild(s);
  });
}

export interface PlanLimitModalProps {
  open: boolean;
  onClose: () => void;
  type: "agent" | "client";
  limit?: number | null;
  partnerSupportEmail?: string | null;
  priceInr?: number;
}

export function PlanLimitModal({
  open,
  onClose,
  type,
  limit,
  partnerSupportEmail,
  priceInr,
}: PlanLimitModalProps) {
  const [upgrading, setUpgrading] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const price = priceInr && priceInr > 0 ? priceInr : 899;

  if (!open) return null;

  const isAgent = type === "agent";
  const limitNumber = limit != null && limit > 0 ? limit : (isAgent ? 2 : 3);

  const handleUpgrade = async () => {
    try {
      setUpgrading(true);
      await loadRazorpayScript();

      const res = await fetch("/api/agents/upgrade-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create upgrade order");
      }

      const order = await res.json();

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (fn: () => void) => {
          if (!settled) {
            settled = true;
            fn();
          }
        };

        const opts: Record<string, unknown> = {
          key: order.keyId,
          amount: order.amount,
          currency: order.currency || "INR",
          order_id: order.orderId,
          name: "SnapServe",
          description: "Upgrade Plan — +1 Additional Agent Slot",
          prefill: order.prefill || undefined,
          theme: { color: "#6366f1" },
          modal: {
            ondismiss: () => settle(() => reject(new Error("cancelled"))),
          },
          handler: async (response: {
            razorpay_order_id: string;
            razorpay_payment_id: string;
            razorpay_signature: string;
          }) => {
            try {
              const verifyRes = await fetch("/api/agents/verify-upgrade", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                  razorpayOrderId: response.razorpay_order_id,
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpaySignature: response.razorpay_signature,
                }),
              });
              if (!verifyRes.ok) {
                const errData = await verifyRes.json().catch(() => ({}));
                throw new Error(errData.error || "Payment verification failed");
              }
              settle(() => resolve());
            } catch (err) {
              settle(() => reject(err instanceof Error ? err : new Error("Verification failed")));
            }
          },
        };

        if (!window.Razorpay) {
          throw new Error("Razorpay SDK could not be loaded");
        }
        // Close modal before opening Razorpay so Radix FocusTrap does not steal keyboard focus from Razorpay iframe
        onClose();
        new window.Razorpay(opts).open();
      });

      // Refetch context and agents
      await queryClient.invalidateQueries();
      toast({
        title: "Upgrade Successful! 🎉",
        description: "You unlocked an additional agent slot. You can now create your agent.",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "cancelled") {
        toast({
          title: "Upgrade Cancelled",
          description: "Payment was not completed. You can upgrade anytime.",
        });
      } else {
        toast({
          title: "Upgrade Failed",
          description: msg || "Payment could not be completed. Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      setUpgrading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !upgrading) onClose(); }}>
      <DialogContent
        className="sm:max-w-[440px] p-0 overflow-hidden border border-border/80 bg-background/95 backdrop-blur-xl shadow-2xl rounded-2xl"
      >
        {/* Top visual banner with subtle glowing gradient */}
        <div className="relative overflow-hidden px-6 pt-7 pb-4 text-center bg-gradient-to-b from-amber-500/10 via-amber-500/5 to-transparent border-b border-border/40">
          <div className="mx-auto mb-3.5 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-500 shadow-inner">
            {isAgent ? (
              <Crown className="h-7 w-7 text-amber-500" />
            ) : (
              <Users className="h-7 w-7 text-amber-500" />
            )}
          </div>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 mb-2">
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>Plan Limit Reached</span>
          </div>

          <h2 className="text-xl font-bold tracking-tight text-foreground">
            {isAgent ? "Agent Limit Reached" : "Client Limit Reached"}
          </h2>
        </div>

        {/* Modal body */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-muted-foreground text-center leading-relaxed">
            Your existing plan has a limit of{" "}
            <span className="font-semibold text-foreground">
              {limitNumber} {isAgent ? "agents" : "clients"}
            </span>{" "}
            only. Upgrade your plan to unlock additional {isAgent ? "agents" : "clients"}.
          </p>

          {isAgent && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-left space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <PlusCircle className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">Add +1 Agent Slot</span>
                </div>
                <div className="text-right">
                  <span className="text-base font-bold text-primary">₹{price}</span>
                  <span className="text-xs text-muted-foreground"> + GST</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Pay securely via Razorpay (UPI, Cards, NetBanking). Instantly increases your creation limit to {limitNumber + 1} agents.
              </p>
            </div>
          )}

          {partnerSupportEmail ? (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 dark:bg-amber-950/20 p-3.5 text-center space-y-1.5">
              <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                Managed under Partner. Please contact your partner for custom plan upgrades.
              </p>
            </div>
          ) : null}
        </div>

        {/* Modal footer / actions */}
        <div className="px-6 pb-6 pt-1 flex flex-col sm:flex-row gap-2.5 sm:justify-end">
          {partnerSupportEmail ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full sm:w-auto h-9 text-xs gap-1.5 border-border hover:bg-accent"
              onClick={() => {
                window.location.href = `mailto:${partnerSupportEmail}?subject=${encodeURIComponent(
                  `Plan Upgrade Request - ${isAgent ? "Agent" : "Client"} Limit`
                )}`;
              }}
            >
              <Mail className="h-3.5 w-3.5" />
              Contact Partner
            </Button>
          ) : null}

          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto h-9 text-xs border-border"
            disabled={upgrading}
            onClick={onClose}
          >
            Cancel
          </Button>

          {isAgent && (
            <Button
              size="sm"
              className="w-full sm:w-auto h-9 text-xs px-5 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 shadow-md font-medium"
              disabled={upgrading}
              onClick={handleUpgrade}
            >
              {upgrading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Opening Razorpay…
                </>
              ) : (
                <>
                  <Zap className="h-3.5 w-3.5" />
                  Upgrade Now (₹{price})
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
