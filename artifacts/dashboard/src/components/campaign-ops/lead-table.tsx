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
import { DispositionBadge } from "@/components/campaign-ops/badges";
import {
  attemptStatusLabel,
  formatDuration,
  formatRetryAt,
  type CampaignReportingLead,
  type CampaignReportingView,
  OUTCOME_CARDS,
} from "@/lib/campaign-lead-reporting";
import { cn } from "@/lib/utils";
import { MoreHorizontal, Phone, StickyNote } from "lucide-react";
import { useState } from "react";

export function LeadReportingTable({
  campaignId,
  items,
  total,
  loading,
  error,
  emptyView,
  selectedLeadId,
  onSelectLead,
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
  selectedLeadId?: number | null;
  onSelectLead?: (lead: CampaignReportingLead) => void;
  onRetry?: (leadId: number) => void;
  onCancelRetry?: (leadId: number) => void;
  onRefresh?: () => void;
}) {
  const [, navigate] = useLocation();
  const [callId, setCallId] = useState<number | null>(null);
  const emptyCopy = OUTCOME_CARDS.find((c) => c.view === emptyView);
  const showRetryQueue = emptyView === "retry";

  function openCall(lead: CampaignReportingLead) {
    const id = lead.latestCallId ?? lead.latestAnsweredCallId;
    if (id != null) setCallId(id);
  }

  if (loading) {
    return (
      <div className="space-y-1 p-2">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
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
        title={emptyCopy ? `No ${emptyCopy.label} leads` : "No leads"}
        description={emptyCopy?.empty ?? "Nothing matches this filter."}
      />
    );
  }

  return (
    <>
      <div className="divide-y divide-border">
        {items.map((lead) => {
          const selected = selectedLeadId === lead.leadId;
          const name = (lead.name || "").trim();
          const showName = name && name.toLowerCase() !== "unknown";
          return (
            <div
              key={lead.leadId}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 cursor-pointer",
                selected ? "bg-muted" : "hover:bg-muted/40",
              )}
              onClick={() => onSelectLead?.(lead)}
            >
              <div className={cn("w-0.5 self-stretch rounded-full shrink-0", selected ? "bg-foreground" : "bg-transparent")} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="font-medium truncate">
                    {showName ? name : lead.phone || "Unknown"}
                  </p>
                  <DispositionBadge bucket={lead.dispositionBucket} label={lead.disposition} />
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                  {showName ? lead.phone : null}
                  {showName && lead.phone ? " · " : ""}
                  {attemptStatusLabel(lead.lastAttemptStatus)}
                  {showRetryQueue ? ` · ${formatRetryAt(lead.retryScheduledAt) ?? "retry"}` : ""}
                </p>
              </div>
              <p className="text-xs tabular-nums text-muted-foreground shrink-0">
                {formatDuration(lead.latestAnsweredDuration)}
              </p>
              <div onClick={(e) => e.stopPropagation()}>
                <RowMenu
                  lead={lead}
                  campaignId={campaignId}
                  onOpen={() => navigate(`/app/campaigns/${campaignId}/leads/${lead.leadId}`)}
                  onCall={() => openCall(lead)}
                  onRetry={onRetry}
                  onCancelRetry={onCancelRetry}
                />
              </div>
            </div>
          );
        })}
      </div>
      <p className="sr-only">{total} leads</p>
      <CallDetailDrawer callId={callId} open={callId != null} onClose={() => setCallId(null)} />
    </>
  );
}

function RowMenu({
  lead,
  campaignId,
  onOpen,
  onCall,
  onRetry,
  onCancelRetry,
}: {
  lead: CampaignReportingLead;
  campaignId: number;
  onOpen: () => void;
  onCall: () => void;
  onRetry?: (leadId: number) => void;
  onCancelRetry?: (leadId: number) => void;
}) {
  void campaignId;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onOpen}>Open lead</DropdownMenuItem>
        {(lead.latestCallId != null || lead.latestAnsweredCallId != null) && (
          <DropdownMenuItem onClick={onCall} className="gap-2">
            <Phone className="h-3.5 w-3.5" /> Full recording
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onOpen} className="gap-2">
          <StickyNote className="h-3.5 w-3.5" /> Add note
        </DropdownMenuItem>
        {onRetry && (
          <DropdownMenuItem onClick={() => onRetry(lead.leadId)}>Call / Retry</DropdownMenuItem>
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
