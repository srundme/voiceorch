import { useState, useEffect, useCallback } from "react";
import { useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck, ShieldAlert, ShieldQuestion, Loader2,
  RefreshCw, ArrowUpRight, CheckCircle2, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  useGetKycStatus,
  useStartKyc,
  getGetKycStatusQueryKey,
} from "@workspace/api-client-react";

/* ── helpers ─────────────────────────────────────────────────────────────── */

function isCompleted(s?: string | null) {
  return s === "completed" || s === "kyc_completed";
}

/* ── Status badge ───────────────────────────────────────────────────────── */
function StatusBadge({ kycStatus, sessionStatus }: { kycStatus: string; sessionStatus?: string | null }) {
  if (isCompleted(kycStatus)) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
        <ShieldCheck className="h-3.5 w-3.5" /> Verified
      </span>
    );
  }
  if (kycStatus === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 dark:bg-red-950/40 px-3 py-1 text-xs font-medium text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
        <ShieldAlert className="h-3.5 w-3.5" /> Failed
      </span>
    );
  }
  if (sessionStatus && sessionStatus !== "revoked") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-950/40 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
        <Clock className="h-3.5 w-3.5" /> In Progress
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
      <ShieldQuestion className="h-3.5 w-3.5" /> Not Started
    </span>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */
export default function KycPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const returnedOutcome = params.get("kyc"); // "completed" | "pending" | null

  const [starting, setStarting] = useState(false);
  const [widgetUrl, setWidgetUrl] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  const { data: kycData, isLoading } = useGetKycStatus({
    query: {
      queryKey: getGetKycStatusQueryKey(),
      refetchOnWindowFocus: true, // re-check when user tabs back after VoBiz
    },
  } as any);

  const startKyc = useStartKyc();

  const kycStatus     = (kycData as any)?.kycStatus     ?? "pending";
  const sessionStatus = (kycData as any)?.sessionStatus ?? null;
  const storedWidget  = (kycData as any)?.widgetUrl     ?? null;
  const completed     = isCompleted(kycStatus);

  // Prefer freshly-created URL, fall back to persisted one
  const activeUrl = widgetUrl ?? storedWidget;
  const hasActiveSession = !!activeUrl && !completed;

  // If VoBiz redirected back with ?kyc=completed, show a toast once
  useEffect(() => {
    if (returnedOutcome === "completed") {
      toast({ title: "Verification complete!", description: "Your identity has been confirmed." });
      qc.invalidateQueries({ queryKey: getGetKycStatusQueryKey() });
    } else if (returnedOutcome === "pending") {
      toast({ title: "Verification not finished", description: "You can resume or restart at any time.", variant: "destructive" });
    }
  }, [returnedOutcome]); // eslint-disable-line react-hooks/exhaustive-deps

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
      } else {
        toast({ title: "Session created", description: "Refreshing status…" });
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
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">Identity Verification</h1>
            <p className="text-sm text-muted-foreground">
              Complete KYC verification to unlock telephony features and phone number provisioning.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleRefresh} title="Refresh status">
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Status card */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Verification Status</p>
            {isLoading
              ? <span className="text-xs text-muted-foreground">Checking…</span>
              : <StatusBadge kycStatus={kycStatus} sessionStatus={sessionStatus} />
            }
          </div>

          {/* Completed */}
          {completed && (
            <div className="flex items-center gap-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-4">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div>
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">You're verified</p>
                <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                  Your identity has been confirmed. All telephony features are now available.
                </p>
              </div>
            </div>
          )}

          {/* Failed */}
          {kycStatus === "failed" && (
            <div className="flex items-center gap-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-4">
              <ShieldAlert className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-800 dark:text-red-300">Verification failed</p>
                <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">
                  Your previous attempt could not be verified. Click below to start a new session.
                </p>
              </div>
            </div>
          )}

          {/* Description */}
          {!completed && (
            <p className="text-xs text-muted-foreground">
              You'll need a government-issued ID (PAN / Aadhaar for individuals; Company PAN / GST for businesses).
              The process takes about 2–3 minutes in your browser.
            </p>
          )}

          {/* Action buttons */}
          {!completed && (
            <div className="flex flex-wrap gap-3">
              <Button onClick={handleStart} disabled={starting || isLoading} variant={hasActiveSession ? "outline" : "default"}>
                {starting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {hasActiveSession ? "Restart Verification" : "Start Verification"}
              </Button>

              {hasActiveSession && (
                <Button onClick={handleOpenWidget} className="gap-2">
                  <ArrowUpRight className="h-4 w-4" />
                  {opened ? "Continue Verification" : "Open Verification"}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* After opening: instruction panel */}
        {hasActiveSession && opened && (
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <p className="text-sm font-medium">Verification opened in a new tab</p>
            <p className="text-xs text-muted-foreground">
              Complete all steps in that tab. Once done, come back here and click <strong>Refresh</strong> to update your status.
            </p>
            <div className="flex gap-3">
              <Button size="sm" variant="outline" onClick={handleOpenWidget} className="gap-2">
                <ArrowUpRight className="h-3.5 w-3.5" />
                Reopen tab
              </Button>
              <Button size="sm" onClick={handleRefresh} className="gap-2">
                <RefreshCw className="h-3.5 w-3.5" />
                Check status
              </Button>
            </div>
          </div>
        )}

        {/* What this unlocks */}
        {!completed && (
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-sm font-medium mb-3">What verification unlocks</p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {[
                "Purchase and port phone numbers",
                "Make and receive calls via Twilio, Plivo, and Vonage",
                "Run outbound calling campaigns",
                "Access higher concurrent call limits",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
