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
import { AttemptStatusBadge, BusinessOutcomeBadge, ContactStateBadge, RetryState } from "@/components/campaign-ops/badges";
import {
  formatDuration,
  formatRetryAt,
  nextWorkLabel,
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
  onRetry?: (leadId: number) => void;
  onCancelRetry?: (leadId: number) => void;
  onRefresh?: () => void;
}) {
  const [, navigate] = useLocation();
  const [callId, setCallId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const emptyCopy = OUTCOME_CARDS.find((c) => c.view === emptyView);
  const showRetryQueue = emptyView === "retry";

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
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
      <div className="hidden md:block rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="w-8 px-3 py-2.5" />
              <th className="text-left font-medium px-4 py-2.5">Lead</th>
              <th className="text-left font-medium px-3 py-2.5 hidden lg:table-cell">Phone</th>
              <th className="text-left font-medium px-3 py-2.5">Contact</th>
              <th className="text-left font-medium px-3 py-2.5">Business</th>
              <th className="text-left font-medium px-3 py-2.5 hidden lg:table-cell">Disposition</th>
              <th className="text-left font-medium px-3 py-2.5">Latest attempt</th>
              <th className="text-right font-medium px-3 py-2.5">Attempts</th>
              <th className="text-right font-medium px-3 py-2.5 hidden xl:table-cell">Duration</th>
              {showRetryQueue && (
                <>
                  <th className="text-left font-medium px-3 py-2.5">Retry</th>
                  <th className="text-left font-medium px-3 py-2.5">Scheduled</th>
                </>
              )}
              <th className="text-left font-medium px-3 py-2.5">Next work</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {items.map((lead) => (
              <tr
                key={lead.leadId}
                className="border-t border-border/70 hover:bg-muted/30 cursor-pointer"
                onClick={() => navigate(`/app/campaigns/${campaignId}/leads/${lead.leadId}`)}
              >
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={!!selected[lead.leadId]}
                    onChange={(e) => setSelected((s) => ({ ...s, [lead.leadId]: e.target.checked }))}
                    aria-label={`Select ${lead.name || lead.phone || lead.leadId}`}
                  />
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium truncate max-w-[180px]">{lead.name || "Unknown"}</p>
                  <p className="text-xs text-muted-foreground font-mono lg:hidden">{lead.phone}</p>
                </td>
                <td className="px-3 py-3 hidden lg:table-cell font-mono text-xs text-muted-foreground">{lead.phone}</td>
                <td className="px-3 py-3"><ContactStateBadge state={lead.contactState} /></td>
                <td className="px-3 py-3"><BusinessOutcomeBadge outcome={lead.operationalOutcome} /></td>
                <td className="px-3 py-3 hidden lg:table-cell text-xs text-muted-foreground truncate max-w-[160px]">
                  {lead.disposition || "—"}
                </td>
                <td className="px-3 py-3">
                  <AttemptStatusBadge status={lead.lastAttemptStatus} answeredEver={lead.answeredEver} />
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{lead.callAttempts}</td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground hidden xl:table-cell">
                  {formatDuration(lead.latestAnsweredDuration)}
                </td>
                {showRetryQueue && (
                  <>
                    <td className="px-3 py-3"><RetryState lead={lead} /></td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{formatRetryAt(lead.retryScheduledAt) ?? "—"}</td>
                  </>
                )}
                <td className="px-3 py-3 text-xs">{nextWorkLabel(lead)}</td>
                <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                  <RowMenu
                    lead={lead}
                    campaignId={campaignId}
                    onOpen={() => navigate(`/app/campaigns/${campaignId}/leads/${lead.leadId}`)}
                    onCall={() => lead.latestAnsweredCallId && setCallId(lead.latestAnsweredCallId)}
                    onRetry={onRetry}
                    onCancelRetry={onCancelRetry}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-2">
        {items.map((lead) => (
          <div key={lead.leadId} className="rounded-xl border border-border bg-card px-4 py-3">
            <button
              type="button"
              onClick={() => navigate(`/app/campaigns/${campaignId}/leads/${lead.leadId}`)}
              className="w-full text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{lead.name || "Unknown"}</p>
                  <p className="text-xs text-muted-foreground font-mono">{lead.phone}</p>
                </div>
                <BusinessOutcomeBadge outcome={lead.operationalOutcome} />
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <ContactStateBadge state={lead.contactState} />
                <AttemptStatusBadge status={lead.lastAttemptStatus} answeredEver={lead.answeredEver} />
                <span className="text-xs text-muted-foreground">{nextWorkLabel(lead)}</span>
              </div>
            </button>
            <div className="mt-3 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
              <Button
                size="sm"
                className="h-8 text-xs"
                onClick={() => onRetry?.(lead.leadId)}
              >
                Call
              </Button>
              <RowMenu
                lead={lead}
                campaignId={campaignId}
                onOpen={() => navigate(`/app/campaigns/${campaignId}/leads/${lead.leadId}`)}
                onCall={() => lead.latestAnsweredCallId && setCallId(lead.latestAnsweredCallId)}
                onRetry={onRetry}
                onCancelRetry={onCancelRetry}
              />
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground tabular-nums pt-2">{total} leads</p>
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
        {lead.latestAnsweredCallId != null && (
          <DropdownMenuItem onClick={onCall} className="gap-2">
            <Phone className="h-3.5 w-3.5" /> Transcript / recording
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
  views: { id: "all" | CampaignReportingView; label: string }[];
  active: string | null | undefined;
  onSelect: (id: "all" | CampaignReportingView) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 min-w-0 max-w-full">
      {views.map((v) => {
        const selected = (active ?? "all") === v.id || (!active && v.id === "all");
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onSelect(v.id)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              selected
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
