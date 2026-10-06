import React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldAlert, Bot, Users, ArrowUpRight, Mail } from "lucide-react";

export interface PlanLimitModalProps {
  open: boolean;
  onClose: () => void;
  type: "agent" | "client";
  limit?: number | null;
  partnerSupportEmail?: string | null;
}

export function PlanLimitModal({
  open,
  onClose,
  type,
  limit,
  partnerSupportEmail,
}: PlanLimitModalProps) {
  if (!open) return null;

  const isAgent = type === "agent";
  const limitNumber = limit != null && limit > 0 ? limit : (isAgent ? 10 : 3);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="sm:max-w-[440px] p-0 overflow-hidden border border-border/80 bg-background/95 backdrop-blur-xl shadow-2xl rounded-2xl"
      >
        {/* Top visual banner with subtle glowing gradient */}
        <div className="relative overflow-hidden px-6 pt-7 pb-4 text-center bg-gradient-to-b from-amber-500/10 via-amber-500/5 to-transparent border-b border-border/40">
          <div className="mx-auto mb-3.5 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-500 shadow-inner">
            {isAgent ? (
              <Bot className="h-7 w-7 text-amber-500 animate-pulse" />
            ) : (
              <Users className="h-7 w-7 text-amber-500 animate-pulse" />
            )}
          </div>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 mb-2">
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>Plan Limit Exceeded</span>
          </div>

          <h2 className="text-xl font-bold tracking-tight text-foreground">
            {isAgent ? "Agent Limit Reached" : "Client Limit Reached"}
          </h2>
        </div>

        {/* Modal body */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-muted-foreground text-center leading-relaxed">
            Your existing plan has the limit of{" "}
            <span className="font-semibold text-foreground">
              {limitNumber} {isAgent ? "agents" : "clients"}
            </span>{" "}
            only. Upgrade your plan for creating more{" "}
            {isAgent ? "agents" : "clients"}.
          </p>

          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 dark:bg-amber-950/20 p-3.5 text-center space-y-1.5">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
              Please contact your partner for further plan upgrade.
            </p>
            <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
              Contact us at{" "}
              <a
                href="mailto:support@snapserve.ai?subject=Plan%20Upgrade%20Request"
                className="underline underline-offset-2 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
              >
                support@snapserve.ai
              </a>
            </p>
          </div>
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
            size="sm"
            className="w-full sm:w-auto h-9 text-xs px-5 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={onClose}
          >
            Got it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
