import { useState, useEffect, useCallback } from "react";
import { useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck, ShieldAlert, ShieldQuestion, Loader2, RefreshCw,
  ArrowUpRight, CheckCircle2, Clock, Phone, Zap, Building2,
  CreditCard, FileText, User, Lock, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
              <div
                className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-colors ${
                  done
                    ? "bg-emerald-500 border-emerald-500 text-white"
                    : active
                    ? "bg-primary border-primary text-primary-foreground"
                    : "bg-background border-border text-muted-foreground"
                }`}
              >
                {done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
              </div>
              <span
                className={`text-[11px] font-medium ${
                  active ? "text-foreground" : done ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`h-0.5 w-16 mx-1 mb-5 rounded-full transition-colors ${
                  i < step ? "bg-emerald-400" : "bg-border"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Document checklist item ───────────────────────────────────────────────── */
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

/* ── Unlock feature item ───────────────────────────────────────────────────── */
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

/* ── Main page ─────────────────────────────────────────────────────────────── */
export default function KycPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const returnedOutcome = params.get("kyc");

  const [starting, setStarting] = useState(false);
  const [widgetUrl, setWidgetUrl] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

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

  async function handleStart() {
    setStarting(true);
    try {
      const res: any = await startKyc.mutateAsync(undefined as any);
      await qc.invalidateQueries({ queryKey: getGetKycStatusQueryKey() });
      const url = res?.widgetUrl as string | null;
      if (url) {
        setWidgetUrl(url);
        setOpened(false);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? err?.message ?? "Failed to start verification";
      toast({ title: "Verification error", description: msg, variant: "destructive" });
    } finally {
      setStarting(false);
    }
  }

  function handleOpenWidget() {
    if (!activeUrl) return;
    window.open(activeUrl, "_blank", "noopener,noreferrer");
    setOpened(true);
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold tracking-tight">Identity Verification</h1>
            <Button variant="ghost" size="icon" onClick={handleRefresh} title="Refresh status" className="shrink-0">
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            One-time verification required to activate telephony features on your account.
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex justify-center py-2">
          <StepIndicator step={step} />
        </div>

        {/* ── COMPLETED STATE ─────────────────────────────────────────────── */}
        {completed && (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 p-6 text-center space-y-3">
            <div className="flex justify-center">
              <div className="h-14 w-14 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                <ShieldCheck className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>
            <div>
              <p className="text-base font-semibold text-emerald-800 dark:text-emerald-300">
                Your identity is verified
              </p>
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

        {/* ── FAILED STATE ────────────────────────────────────────────────── */}
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

        {/* ── IN-PROGRESS: waiting panel ──────────────────────────────────── */}
        {hasActiveSession && opened && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Clock className="h-4.5 w-4.5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">Verification in progress</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Complete all steps in the verification tab, then come back here.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button size="sm" onClick={handleOpenWidget} className="gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" />
                Reopen verification tab
              </Button>
              <Button size="sm" variant="outline" onClick={handleRefresh} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                Check status
              </Button>
            </div>
          </div>
        )}

        {/* ── PRE-START: main action card ─────────────────────────────────── */}
        {!completed && (
          <div className="rounded-xl border border-border bg-card p-5 space-y-5">

            {/* Status row */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Current status</p>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border ${
                hasActiveSession
                  ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300"
                  : failed
                  ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
                  : "bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400"
              }`}>
                {hasActiveSession
                  ? <><Clock className="h-3 w-3" /> Session active</>
                  : failed
                  ? <><ShieldAlert className="h-3 w-3" /> Failed</>
                  : <><ShieldQuestion className="h-3 w-3" /> Not started</>
                }
              </span>
            </div>

            <hr className="border-border" />

            {/* What to prepare */}
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
              <p className="text-xs text-muted-foreground max-w-[300px]">
                Takes about <strong>2–3 minutes</strong>. The process opens in a new browser tab and returns you here when done.
              </p>
              <div className="flex flex-wrap gap-2.5">
                {hasActiveSession && (
                  <Button variant="outline" size="sm" onClick={handleStart} disabled={starting || isLoading} className="gap-1.5">
                    {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Restart
                  </Button>
                )}
                <Button
                  onClick={hasActiveSession ? handleOpenWidget : handleStart}
                  disabled={starting || isLoading}
                  className="gap-2"
                  size="sm"
                >
                  {starting
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <ArrowUpRight className="h-3.5 w-3.5" />
                  }
                  {hasActiveSession ? "Continue verification" : failed ? "Retry verification" : "Start verification"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── What this unlocks ───────────────────────────────────────────── */}
        {!completed && (
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <p className="text-sm font-medium">What verification unlocks</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <UnlockItem icon={Phone} label="Purchase & port phone numbers" />
              <UnlockItem icon={Zap} label="Outbound calling campaigns" />
              <UnlockItem icon={Building2} label="Twilio, Plivo & Vonage integrations" />
              <UnlockItem icon={ShieldCheck} label="Higher concurrent call limits" />
            </div>
          </div>
        )}

        {/* ── Verification partner trust note ────────────────────────────── */}
        {!completed && (
          <div className="rounded-xl border border-border bg-muted/20 p-4 flex items-start gap-3">
            <Lock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Identity verification is handled by <strong className="text-foreground">VoBiz</strong>, a licensed KYC
              service regulated under RBI and MeitY guidelines. Your documents are processed securely and never stored on
              SnapServe's servers. The verification link is unique to your session and expires in 7 days.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
