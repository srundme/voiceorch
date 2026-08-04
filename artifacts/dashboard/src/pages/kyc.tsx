import { useState, useEffect, useCallback, useRef } from "react";
import { useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck, ShieldAlert, ShieldQuestion, Loader2, RefreshCw,
  ArrowUpRight, CheckCircle2, Clock, Phone, Zap, Building2,
  CreditCard, FileText, User, Lock, Maximize2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  useGetKycStatus,
  useStartKyc,
  getGetKycStatusQueryKey,
} from "@workspace/api-client-react";

/* ── helpers ───────────────────────────────────────────────────────────────── */
function isCompleted(s?: string | null) {
  return s === "completed" || s === "kyc_completed";
}

/* ── Step indicator ────────────────────────────────────────────────────────── */
const STEPS = ["Prepare", "Verify", "Done"] as const;

function StepIndicator({ step }: { step: 0 | 1 | 2 }) {
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-colors ${
                done ? "bg-emerald-500 border-emerald-500 text-white"
                     : active ? "bg-primary border-primary text-primary-foreground"
                     : "bg-background border-border text-muted-foreground"
              }`}>
                {done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
              </div>
              <span className={`text-[11px] font-medium ${
                active ? "text-foreground" : done ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
              }`}>{label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-0.5 w-16 mx-1 mb-5 rounded-full transition-colors ${i < step ? "bg-emerald-400" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function DocItem({ icon: Icon, title, desc }: { icon: React.ElementType; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/30">
      <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

function UnlockItem({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
      <div className="h-6 w-6 rounded-full bg-emerald-100 dark:bg-emerald-950/50 flex items-center justify-center shrink-0">
        <Icon className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
      </div>
      {label}
    </div>
  );
}

/* ── Embedded KYC Modal ────────────────────────────────────────────────────── */
function KycModal({
  open,
  widgetUrl,
  onClose,
  onComplete,
}: {
  open: boolean;
  widgetUrl: string;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [iframeBlocked, setIframeBlocked] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { toast } = useToast();

  // Reset state when modal opens with a fresh URL
  useEffect(() => {
    if (open) {
      setIframeBlocked(false);
      setIframeLoaded(false);
    }
  }, [open, widgetUrl]);

  // Listen for postMessage from VoBiz widget (completion signal)
  useEffect(() => {
    if (!open) return;
    function handleMessage(e: MessageEvent) {
      try {
        const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        const type: string = data?.type ?? data?.event ?? "";
        if (
          type === "kyc.completed" ||
          type === "kyc_completed" ||
          type === "verification_complete" ||
          type === "KYC_COMPLETE"
        ) {
          toast({ title: "Verification complete!", description: "Your identity has been confirmed." });
          onComplete();
          onClose();
        }
      } catch {
        // non-JSON message — ignore
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [open, onComplete, onClose, toast]);

  // Detect X-Frame-Options blocking — if the iframe fires an error or stays
  // blank after 8s, offer the fallback new-tab link.
  useEffect(() => {
    if (!open || iframeLoaded) return;
    const t = setTimeout(() => {
      if (!iframeLoaded) setIframeBlocked(true);
    }, 8000);
    return () => clearTimeout(t);
  }, [open, iframeLoaded]);

  function openInNewTab() {
    window.open(widgetUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl w-full h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="flex-none flex flex-row items-center justify-between px-4 py-3 border-b border-border bg-card">
          <DialogTitle className="text-sm font-semibold">Identity Verification</DialogTitle>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={openInNewTab} className="gap-1.5 text-xs h-7">
              <Maximize2 className="h-3 w-3" />
              Open in tab
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* Iframe */}
        <div className="flex-1 relative bg-muted/20">
          {!iframeLoaded && !iframeBlocked && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Loading verification…</p>
            </div>
          )}

          {iframeBlocked ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
              <ShieldQuestion className="h-10 w-10 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Verification can't load inline</p>
                <p className="text-xs text-muted-foreground mt-1">
                  The verification service requires a separate window. Click below — it'll open in a new tab and return you here when done.
                </p>
              </div>
              <Button onClick={openInNewTab} className="gap-2">
                <ArrowUpRight className="h-4 w-4" />
                Open verification
              </Button>
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              src={widgetUrl}
              className={`w-full h-full border-0 transition-opacity duration-300 ${iframeLoaded ? "opacity-100" : "opacity-0"}`}
              title="Identity Verification"
              allow="camera; microphone"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
              onLoad={() => setIframeLoaded(true)}
              onError={() => setIframeBlocked(true)}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex-none flex items-center justify-between px-4 py-3 border-t border-border bg-card/80">
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Lock className="h-3 w-3" />
            Secured by VoBiz · RBI & MeitY compliant
          </p>
          <Button size="sm" onClick={() => { onComplete(); onClose(); }} className="h-7 text-xs gap-1.5">
            <CheckCircle2 className="h-3 w-3" />
            I'm done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Main page ─────────────────────────────────────────────────────────────── */
export default function KycPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const returnedOutcome = params.get("kyc");

  const [starting, setStarting] = useState(false);
  const [widgetUrl, setWidgetUrl] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const { data: kycData, isLoading } = useGetKycStatus({
    query: {
      queryKey: getGetKycStatusQueryKey(),
      refetchOnWindowFocus: true,
    },
  } as any);

  const startKyc = useStartKyc();

  const kycStatus     = (kycData as any)?.kycStatus     ?? "pending";
  const sessionStatus = (kycData as any)?.sessionStatus ?? null;
  const storedWidget  = (kycData as any)?.widgetUrl     ?? null;
  const completed     = isCompleted(kycStatus);
  const failed        = kycStatus === "failed";

  const activeUrl = widgetUrl ?? storedWidget;
  const hasActiveSession = !!activeUrl && !completed;

  const step: 0 | 1 | 2 = completed ? 2 : hasActiveSession ? 1 : 0;

  useEffect(() => {
    if (returnedOutcome === "completed") {
      toast({ title: "Verification complete!", description: "Your identity has been confirmed." });
      qc.invalidateQueries({ queryKey: getGetKycStatusQueryKey() });
    } else if (returnedOutcome === "pending") {
      toast({ title: "Verification not finished", description: "You can resume or restart at any time.", variant: "destructive" });
    }
  }, [returnedOutcome]); // eslint-disable-line

  const handleRefresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: getGetKycStatusQueryKey() });
  }, [qc]);

  const handleComplete = useCallback(() => {
    qc.invalidateQueries({ queryKey: getGetKycStatusQueryKey() });
  }, [qc]);

  async function handleStart() {
    setStarting(true);
    try {
      const res: any = await startKyc.mutateAsync(undefined as any);
      await qc.invalidateQueries({ queryKey: getGetKycStatusQueryKey() });
      const url = res?.widgetUrl as string | null;
      if (url) {
        setWidgetUrl(url);
        setModalOpen(true);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? err?.message ?? "Failed to start verification";
      toast({ title: "Verification error", description: msg, variant: "destructive" });
    } finally {
      setStarting(false);
    }
  }

  function handleOpenModal() {
    if (!activeUrl) return;
    setModalOpen(true);
  }

  return (
    <>
      {/* ── Embedded verification modal ──────────────────────────────────── */}
      {activeUrl && (
        <KycModal
          open={modalOpen}
          widgetUrl={activeUrl}
          onClose={() => setModalOpen(false)}
          onComplete={handleComplete}
        />
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">

          {/* Section intro — parent StripePage owns the page title */}
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              One-time identity verification required to activate telephony features on your account.
            </p>
            <Button variant="ghost" size="icon" onClick={handleRefresh} title="Refresh status" className="shrink-0">
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>

          {/* Step indicator */}
          <div className="flex justify-center py-2">
            <StepIndicator step={step} />
          </div>

          {/* ── COMPLETED ────────────────────────────────────────────────── */}
          {completed && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 p-6 text-center space-y-3">
              <div className="flex justify-center">
                <div className="h-14 w-14 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                  <ShieldCheck className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
                </div>
              </div>
              <div>
                <p className="text-base font-semibold text-emerald-800 dark:text-emerald-300">Your identity is verified</p>
                <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-1">
                  All telephony features are now active on your account.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                {["Phone numbers", "Outbound calls", "Inbound routing", "Higher limits"].map((f) => (
                  <Badge key={f} variant="secondary" className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800">
                    {f}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* ── FAILED ───────────────────────────────────────────────────── */}
          {failed && !completed && (
            <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 p-4 flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800 dark:text-red-300">Previous attempt failed</p>
                <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                  Your documents could not be verified. Please try again with clear, valid documents.
                </p>
              </div>
            </div>
          )}

          {/* ── IN-PROGRESS hint (when modal is closed) ─────────────────── */}
          {hasActiveSession && !modalOpen && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-primary shrink-0" />
                <p className="text-sm">Verification session is active — ready to continue</p>
              </div>
              <Button size="sm" onClick={handleOpenModal} className="gap-1.5 shrink-0">
                <ArrowUpRight className="h-3.5 w-3.5" />
                Continue
              </Button>
            </div>
          )}

          {/* ── MAIN ACTION CARD ──────────────────────────────────────────── */}
          {!completed && (
            <div className="rounded-xl border border-border bg-card p-5 space-y-5">

              {/* Status row */}
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Current status</p>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border ${
                  hasActiveSession ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300"
                                   : failed ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
                                   : "bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400"
                }`}>
                  {hasActiveSession ? <><Clock className="h-3 w-3" /> Session active</>
                                   : failed ? <><ShieldAlert className="h-3 w-3" /> Failed</>
                                   : <><ShieldQuestion className="h-3 w-3" /> Not started</>}
                </span>
              </div>

              <hr className="border-border" />

              {/* Document checklist */}
              <div className="space-y-3">
                <p className="text-sm font-medium">What you'll need</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Individual</p>
                    <DocItem icon={CreditCard} title="PAN Card" desc="For identity & tax verification" />
                    <DocItem icon={User} title="Aadhaar" desc="Via DigiLocker — no upload needed" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Company / Business</p>
                    <DocItem icon={Building2} title="Company PAN" desc="Registered company PAN number" />
                    <DocItem icon={FileText} title="GST Number" desc="GST registration certificate" />
                  </div>
                </div>
              </div>

              <hr className="border-border" />

              {/* CTA */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground max-w-[280px]">
                  Takes about <strong>2–3 minutes</strong>. Verification runs directly inside this page.
                </p>
                <div className="flex flex-wrap gap-2.5">
                  {hasActiveSession && (
                    <Button variant="outline" size="sm" onClick={handleStart} disabled={starting || isLoading} className="gap-1.5">
                      {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      Restart
                    </Button>
                  )}
                  <Button
                    onClick={hasActiveSession ? handleOpenModal : handleStart}
                    disabled={starting || isLoading}
                    className="gap-2"
                    size="sm"
                  >
                    {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                    {hasActiveSession ? "Continue verification" : failed ? "Retry verification" : "Start verification"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ── What this unlocks ─────────────────────────────────────────── */}
          {!completed && (
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <p className="text-sm font-medium">What verification unlocks</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <UnlockItem icon={Phone} label="Purchase & port phone numbers" />
                <UnlockItem icon={Zap} label="Outbound dialing" />
                <UnlockItem icon={Building2} label="Twilio, Plivo & Vonage integrations" />
                <UnlockItem icon={ShieldCheck} label="Higher concurrent call limits" />
              </div>
            </div>
          )}

          {/* ── Trust note ────────────────────────────────────────────────── */}
          {!completed && (
            <div className="rounded-xl border border-border bg-muted/20 p-4 flex items-start gap-3">
              <Lock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                Identity verification is handled by <strong className="text-foreground">VoBiz</strong>, a licensed KYC service
                regulated under RBI and MeitY guidelines. Your documents are processed securely and never stored on
                SnapServe's servers. The verification link is unique to your session and expires in 7 days.
              </p>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
