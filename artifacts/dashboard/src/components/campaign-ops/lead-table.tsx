import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CallDetailDrawer } from "@/components/call-detail-drawer";
import {
  attemptStatusLabel,
  displayDispositionLabel,
  humanizeSnakeLabel,
  type CampaignReportingLead,
  type CampaignReportingView,
  OUTCOME_CARDS,
} from "@/lib/campaign-lead-reporting";
import { cn } from "@/lib/utils";
import { ChevronRight, Clock, MoreHorizontal, Phone, StickyNote } from "lucide-react";
import { useState } from "react";

export type LeadTableColumns = {
  outcome: boolean;
  duration: boolean;
  attempts: boolean;
  next: boolean;
};

export const DEFAULT_LEAD_COLUMNS: LeadTableColumns = {
  outcome: true,
  duration: true,
  attempts: true,
  next: true,
};

function displayPhone(phone: string | null | undefined): string {
  return phone?.trim() || "—";
}

function clockDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function whenLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round((startTarget.getTime() - startToday.getTime()) / 86_400_000);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (dayDiff === 0) return `Today, ${time}`;
  if (dayDiff === 1) return `Tomorrow, ${time}`;
  if (dayDiff === -1) return `Yesterday, ${time}`;
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${date}, ${time}`;
}

export function callResultLabel(lead: CampaignReportingLead): string {
  const status = (lead.lastAttemptStatus ?? "").trim().toLowerCase();
  if (status === "voicemail") return "Voicemail";
  if (lead.answeredEver || lead.contactState === "answered") return "Human answered";
  if (status === "busy") return "Busy";
  if (status === "no_pickup" || status === "no_answer") return "No answer";
  if (
    status === "calling" ||
    status === "connected" ||
    lead.lifecycleStatus === "calling" ||
    lead.lifecycleStatus === "connected"
  ) {
    return lead.lifecycleStatus === "connected" || status === "connected" ? "Talking" : "Ringing";
  }
  if (status === "failed" || status === "dial_error" || status === "stuck_calling") return "Couldn't reach";
  if (lead.callAttempts === 0) return "Not called";
  return attemptStatusLabel(lead.lastAttemptStatus);
}

export function outcomePresentation(lead: CampaignReportingLead): { text: string; review: boolean } | null {
  if (lead.dispositionState === "needs_classification") return { text: "Needs review", review: true };
  if (lead.callbackRequested || lead.operationalOutcome === "callback_requested") {
    return { text: "Callback requested", review: false };
  }
  if (lead.bookingCreated || lead.operationalOutcome === "booking_created") {
    return { text: "Booked", review: false };
  }
  if (lead.transferCompleted || lead.operationalOutcome === "transfer_completed") {
    return { text: "Transferred", review: false };
  }
  const raw = (lead.disposition ?? "").replace(/^outcome:\s*/i, "").trim();
  if (raw && lead.dispositionState === "classified") {
    return { text: humanizeSnakeLabel(raw), review: false };
  }
  const bucket = lead.dispositionBucket;
  if (bucket && bucket !== "unlabeled" && bucket !== "needs_classification") {
    return { text: displayDispositionLabel(bucket), review: false };
  }
  return null;
}

export function LeadReportingTable({
  campaignId,
  items,
  total,
  loading,
  error,
  emptyView,
  columns,
  selectedIds,
  onToggle,
  onTogglePage,
  onRetry,
  onCancelRetry,
  onRefresh,
}: {
  campaignId: number;
  items: CampaignReportingLead[];
  total: number;
  loading?: boolean;
  error?: string | null;
  emptyView?: CampaignReportingView | null;
  columns: LeadTableColumns;
  selectedIds: Set<number>;
  onToggle: (leadId: number) => void;
  onTogglePage: (leadIds: number[], on: boolean) => void;
  onRetry?: (leadId: number) => void;
  onCancelRetry?: (leadId: number) => void;
  onRefresh?: () => void;
}) {
  const [, navigate] = useLocation();
  const [callId, setCallId] = useState<number | null>(null);
  const emptyCopy = OUTCOME_CARDS.find((c) => c.view === emptyView);
  const pageIds = items.map((l) => l.leadId);
  const allOn = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));

  if (loading) {
    return (
      <div className="space-y-1 p-3">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-md" />)}
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        variant="panel"
        title="Couldn’t load leads"
        description={error}
        action={onRefresh ? { label: "Retry", onClick: onRefresh } : undefined}
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        variant="panel"
        title={emptyCopy ? `No ${emptyCopy.label.toLowerCase()} leads` : "No leads"}
        description={emptyCopy?.empty ?? "Nothing matches this filter."}
      />
    );
  }

  return (
    <>
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b border-border text-left text-[12px] font-medium text-muted-foreground">
            <th className="w-10 px-3 py-2.5">
              <input
                type="checkbox"
                aria-label="Select leads on this page"
                checked={allOn}
                onChange={(e) => onTogglePage(pageIds, e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-foreground"
              />
            </th>
            <th className="px-3 py-2.5 font-medium">Lead</th>
            <th className="px-3 py-2.5 font-medium">Call result</th>
            {columns.outcome && <th className="px-3 py-2.5 font-medium">Outcome</th>}
            {columns.duration && <th className="px-3 py-2.5 font-medium">Duration</th>}
            {columns.attempts && <th className="px-3 py-2.5 font-medium">Attempts</th>}
            {columns.next && <th className="px-3 py-2.5 font-medium">Next action</th>}
            <th className="w-16 px-2 py-2.5"><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((lead) => {
            const name = (lead.name || "").trim();
            const showName = !!name && name.toLowerCase() !== "unknown";
            const open = () => navigate(`/app/campaigns/${campaignId}/leads/${lead.leadId}`);
            const outcome = outcomePresentation(lead);
            const needsReview = lead.dispositionState === "needs_classification";
            const when = whenLabel(lead.retryScheduledAt);
            return (
              <tr
                key={lead.leadId}
                className="border-b border-border/80 hover:bg-muted/40 cursor-pointer"
                onClick={open}
              >
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${showName ? name : lead.phone ?? "lead"}`}
                    checked={selectedIds.has(lead.leadId)}
                    onChange={() => onToggle(lead.leadId)}
                    className="h-3.5 w-3.5 rounded border-border accent-foreground"
                  />
                </td>
                <td className="px-3 py-3">
                  <p className="font-medium text-foreground leading-tight">
                    {showName ? name : displayPhone(lead.phone)}
                  </p>
                  {showName ? (
                    <p className="mt-0.5 text-[12px] text-muted-foreground font-mono tracking-tight">
                      {displayPhone(lead.phone)}
                    </p>
                  ) : null}
                </td>
                <td className="px-3 py-3 text-foreground whitespace-nowrap">{callResultLabel(lead)}</td>
                {columns.outcome && (
                  <td className="px-3 py-3">
                    {outcome ? (
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-medium",
                          outcome.review
                            ? "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300"
                            : "border-border bg-muted/50 text-foreground",
                        )}
                      >
                        {outcome.text}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                )}
                {columns.duration && (
                  <td className="px-3 py-3 tabular-nums text-muted-foreground whitespace-nowrap">
                    {clockDuration(lead.latestAnsweredDuration)}
                  </td>
                )}
                {columns.attempts && (
                  <td className="px-3 py-3 tabular-nums text-foreground">{lead.callAttempts}</td>
                )}
                {columns.next && (
                  <td className="px-3 py-3 whitespace-nowrap">
                    {needsReview ? (
                      <span className="inline-flex items-center text-[13px] font-medium text-orange-700 dark:text-orange-300">
                        Review call
                        <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                      </span>
                    ) : when ? (
                      <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        {when}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                )}
                <td className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="inline-flex items-center">
                    <RowMenu
                      lead={lead}
                      onOpen={open}
                      onCall={() => {
                        const id = lead.latestCallId ?? lead.latestAnsweredCallId;
                        if (id != null) setCallId(id);
                      }}
                      onRetry={onRetry}
                      onCancelRetry={onCancelRetry}
                    />
                    <button
                      type="button"
                      aria-label="Open lead"
                      onClick={open}
                      className="h-8 w-8 inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="sr-only">{total} leads</p>
      <CallDetailDrawer callId={callId} open={callId != null} onClose={() => setCallId(null)} />
    </>
  );
}

function RowMenu({
  lead,
  onOpen,
  onCall,
  onRetry,
  onCancelRetry,
}: {
  lead: CampaignReportingLead;
  onOpen: () => void;
  onCall: () => void;
  onRetry?: (leadId: number) => void;
  onCancelRetry?: (leadId: number) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onOpen}>Open lead</DropdownMenuItem>
        {(lead.latestCallId != null || lead.latestAnsweredCallId != null) && (
          <DropdownMenuItem onClick={onCall} className="gap-2">
            <Phone className="h-3.5 w-3.5" /> Call recording
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onOpen} className="gap-2">
          <StickyNote className="h-3.5 w-3.5" /> Add note
        </DropdownMenuItem>
        {onRetry && (
          <DropdownMenuItem onClick={() => onRetry(lead.leadId)}>Call again</DropdownMenuItem>
        )}
        {lead.retryPending && onCancelRetry && (
          <DropdownMenuItem onClick={() => onCancelRetry(lead.leadId)}>Cancel retry</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LeadFilterChips({
  views,
  active,
  onSelect,
}: {
  views: { id: string; label: string }[];
  active: string | null | undefined;
  onSelect: (id: "all" | CampaignReportingView) => void;
}) {
  return (
    <div className="flex gap-1 min-w-0">
      {views.map((v) => {
        const selected = active === v.id;
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onSelect(selected ? "all" : v.id as CampaignReportingView)}
            className={cn(
              "shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
              selected
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
            )}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
