import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, ShieldAlert, ShieldQuestion, Loader2, RefreshCw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  useGetKycStatus,
  useStartKyc,
  getGetKycStatusQueryKey,
} from "@workspace/api-client-react";

/* ── Status helpers ─────────────────────────────────────────────────────── */

type KycStatus = "pending" | "completed" | "failed" | "link_ready" | "opened" | "in_progress";

function isCompleted(status: string | null | undefined): boolean {
  return status === "completed" || status === "kyc_completed";
}

function isInProgress(sessionStatus: string | null | undefined): boolean {
  return sessionStatus === "link_ready" || sessionStatus === "opened" || sessionStatus === "in_progress";
}

/* ── Status badge ───────────────────────────────────────────────────────── */

function StatusBadge({ status }: { status: string }) {
  if (isCompleted(status)) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
        <ShieldCheck className="h-3.5 w-3.5" />
        Verified
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 dark:bg-red-950/40 px-3 py-1 text-xs font-medium text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
        <ShieldAlert className="h-3.5 w-3.5" />
        Verification Failed
      </span>
    );
  }
  if (isInProgress(status)) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-950/40 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        In Progress
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
      <ShieldQuestion className="h-3.5 w-3.5" />
      Not Started
    </span>
  );
}

/* ── Main page ──────────────────────────────────────────────────────────── */

export default function KycPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [widgetUrl, setWidgetUrl] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const { data: kycData, isLoading } = useGetKycStatus({
    query: {
      queryKey: getGetKycStatusQueryKey(),
      onSuccess(data: any) {
        if (data?.widgetUrl && !isCompleted(data.kycStatus)) {
          setWidgetUrl(data.widgetUrl);
        }
      },
    },
  } as any);

  const startKyc = useStartKyc();

  const kycStatus  = (kycData as any)?.kycStatus  ?? "pending";
  const sessionStatus = (kycData as any)?.sessionStatus ?? null;
  const completed  = isCompleted(kycStatus);
  const hasPendingWidget = widgetUrl && !completed;

  async function handleStart() {
    setStarting(true);
    try {
      const res: any = await startKyc.mutateAsync(undefined as any);
      if (res?.widgetUrl) {
        setWidgetUrl(res.widgetUrl);
      }
      await qc.invalidateQueries({ queryKey: getGetKycStatusQueryKey() });
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? err?.message ?? "Failed to start verification";
      toast({ title: "Verification error", description: msg, variant: "destructive" });
    } finally {
      setStarting(false);
    }
  }

  async function handleRefresh() {
    await qc.invalidateQueries({ queryKey: getGetKycStatusQueryKey() });
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">Identity Verification</h1>
            <p className="text-sm text-muted-foreground">
              Complete KYC verification to unlock telephony features and phone number provisioning.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleRefresh} title="Refresh status">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* ── Status card ── */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Verification Status</p>
            {isLoading
              ? <span className="text-xs text-muted-foreground">Checking…</span>
              : <StatusBadge status={completed ? "completed" : (sessionStatus ?? kycStatus)} />
            }
          </div>

          {completed && (
            <div className="flex items-center gap-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-4">
              <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div>
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">You're verified</p>
                <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                  Your identity has been confirmed. All telephony features are now available.
                </p>
              </div>
            </div>
          )}

          {kycStatus === "failed" && (
            <div className="flex items-center gap-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-4">
              <ShieldAlert className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-800 dark:text-red-300">Verification failed</p>
                <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">
                  Your previous attempt could not be verified. Please start a new session.
                </p>
              </div>
            </div>
          )}

          {!completed && (
            <div className="text-xs text-muted-foreground space-y-1">
              <p>You'll need a government-issued ID and a live selfie. The process takes about 2–3 minutes.</p>
              <p>Your data is handled securely and not stored on SnapServe servers.</p>
            </div>
          )}

          {!completed && (
            <Button
              onClick={handleStart}
              disabled={starting || isLoading}
              className="w-full sm:w-auto"
            >
              {starting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {hasPendingWidget ? "Restart Verification" : "Start Verification"}
            </Button>
          )}
        </div>

        {/* ── Embedded widget ── */}
        {hasPendingWidget && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Complete your verification below</p>
              <a
                href={widgetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                Open in new tab
              </a>
            </div>
            <div className="rounded-xl border border-border overflow-hidden bg-card" style={{ height: 640 }}>
              <iframe
                src={widgetUrl}
                className="w-full h-full"
                allow="camera; microphone"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation-by-user-activation"
                title="Identity Verification"
              />
            </div>
            <p className="text-[11px] text-muted-foreground text-center">
              After completing verification, click Refresh to update your status.
              <button onClick={handleRefresh} className="ml-1 underline hover:text-foreground transition-colors">Refresh now</button>
            </p>
          </div>
        )}

        {/* ── What this unlocks ── */}
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
