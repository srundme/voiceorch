import { cn } from "@/lib/utils";
import {
  attemptStatusLabel,
  businessOutcomeLabel,
  contactStateLabel,
  displayDispositionLabel,
  primaryLeadTone,
  type CampaignContactState,
  type CampaignReportingLead,
} from "@/lib/campaign-lead-reporting";

function chip(className: string, children: React.ReactNode) {
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium", className)}>
      {children}
    </span>
  );
}

export function ContactStateBadge({ state }: { state: CampaignContactState }) {
  if (state === "answered") {
    return chip("border-border bg-foreground text-background", contactStateLabel(state));
  }
  if (state === "attempted") {
    return chip("border-border bg-muted text-foreground", contactStateLabel(state));
  }
  return chip("border-border bg-transparent text-muted-foreground", contactStateLabel(state));
}

export function BusinessOutcomeBadge({ outcome }: { outcome: string | null | undefined }) {
  const label = businessOutcomeLabel(outcome);
  if (outcome === "interest_confirmed" || outcome === "booking_created" || outcome === "transfer_completed") {
    return chip("border-border bg-foreground/90 text-background", label);
  }
  if (outcome === "callback_requested") {
    return chip("border-border bg-muted text-foreground", label);
  }
  if (outcome === "dnc_blocked") {
    return chip("border-destructive/40 bg-destructive/10 text-destructive", label);
  }
  return chip("border-border bg-transparent text-muted-foreground", label);
}

export function AttemptStatusBadge({
  status,
  answeredEver,
}: {
  status: string | null | undefined;
  answeredEver?: boolean;
}) {
  const label = attemptStatusLabel(status);
  const failedish = status === "failed" || status === "dropped" || status === "dial_error" || status === "stuck_calling";
  if (failedish && !answeredEver) {
    return chip("border-destructive/40 bg-destructive/10 text-destructive", label);
  }
  return chip("border-border bg-muted/40 text-muted-foreground", label);
}

export function DispositionBadge({
  bucket,
  label,
}: {
  bucket?: string | null;
  label?: string | null;
}) {
  const shown = bucket && bucket !== "unlabeled"
    ? displayDispositionLabel(bucket)
    : (label && label.trim() ? label : "No label");
  if (bucket === "voicemail") {
    return chip("border-border bg-foreground text-background", shown);
  }
  if (bucket === "interested" || bucket === "callback requested") {
    return chip("border-border bg-foreground/90 text-background", shown);
  }
  if (bucket === "not interested" || bucket === "do not call") {
    return chip("border-destructive/40 bg-destructive/10 text-destructive", shown);
  }
  return chip("border-border bg-muted/50 text-foreground", shown);
}

export function RetryState({ lead }: { lead: Pick<CampaignReportingLead, "retryPending" | "retryReason" | "retryScheduledAt" | "retryAttemptNumber" | "workState"> }) {
  if (lead.workState === "live") {
    return <span className="text-xs text-foreground">Live</span>;
  }
  if (!lead.retryPending) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <span className="text-xs text-foreground">
      {lead.retryReason ? lead.retryReason.replace(/_/g, " ") : "Retry"}
      {lead.retryAttemptNumber ? ` · #${lead.retryAttemptNumber}` : ""}
    </span>
  );
}

export function leadPrimaryBadgeClass(lead: CampaignReportingLead): string {
  return primaryLeadTone(lead) === "attention"
    ? "text-destructive"
    : "text-foreground";
}
