import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { CampaignFunnel } from "@/components/campaign-ops/funnel";
import { LiveFloor } from "@/components/campaign-ops/live-floor";
import { DispositionHero } from "@/components/campaign-ops/disposition-hero";
import { OutcomeChips } from "@/components/campaign-ops/outcome-filters";
import {
  campaignLeadsHref,
  type CampaignReportingPayload,
  type CampaignReportingView,
} from "@/lib/campaign-lead-reporting";
import { BATCH_STATUS_MAP } from "@/lib/campaign-status";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

export function CampaignOverviewPanel({
  campaignId,
  reporting,
  loading,
  error,
  onRetry,
  hideBatches,
  leadsHref,
}: {
  campaignId: number;
  reporting?: CampaignReportingPayload;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  hideBatches?: boolean;
  leadsHref?: (view: CampaignReportingView) => string;
}) {
  const [, navigate] = useLocation();
  const liveBusy = ((reporting?.liveFloor.queued ?? 0)
    + (reporting?.liveFloor.calling ?? 0)
    + (reporting?.liveFloor.talking ?? 0)
    + (reporting?.workTechnical.retryPending ?? 0)) > 0;

  function openLeads(next: { view?: CampaignReportingView; dispositionBucket?: string | null }) {
    if (next.dispositionBucket) {
      navigate(`/app/campaigns/${campaignId}?tab=leads&dispositionBucket=${encodeURIComponent(next.dispositionBucket)}`);
      return;
    }
    if (next.view) {
      navigate(leadsHref ? leadsHref(next.view) : campaignLeadsHref(campaignId, { view: next.view }));
    }
  }

  if (error) {
    return (
      <EmptyState
        variant="panel"
        title="Couldn’t load campaign reporting"
        action={onRetry ? { label: "Retry", onClick: onRetry } : undefined}
      />
    );
  }

  return (
    <div className="space-y-5">
      <DispositionHero
        loading={loading}
        items={reporting?.dispositions}
        onSelect={(bucket) => {
          if (!bucket) navigate(`/app/campaigns/${campaignId}?tab=leads`);
          else openLeads({ dispositionBucket: bucket });
        }}
      />
      {(loading || liveBusy) && (
        <LiveFloor
          loading={loading}
          data={reporting ? { ...reporting.liveFloor, retryPending: reporting.workTechnical.retryPending } : undefined}
        />
      )}
      <CampaignFunnel loading={loading} data={reporting?.funnel} rates={reporting?.rates} />
      <OutcomeChips
        loading={loading}
        counts={{
          interested: reporting?.funnel.interested,
          callback: reporting?.workTechnical.callbacks,
          retry: reporting?.workTechnical.retryPending,
          no_pickup: reporting?.workTechnical.noPickup,
          busy: reporting?.workTechnical.busy,
          voicemail: reporting?.workTechnical.voicemail,
          technical_failed: reporting?.workTechnical.technicalFailed,
        }}
        onSelect={(view) => openLeads({ view })}
      />
      {reporting?.compare?.callbackSources
        && reporting.compare.callbackSources.callbackTables !== reporting.compare.callbackSources.operationalOutcome && (
        <p className="text-[11px] text-muted-foreground">
          Callback chip uses operational outcome ({reporting.compare.callbackSources.operationalOutcome}).
          Callback tables list {reporting.compare.callbackSources.callbackTables} distinct leads.
        </p>
      )}

      {!hideBatches && <BatchesSection campaignId={campaignId} batches={reporting?.batches} loading={loading} />}
    </div>
  );
}

function BatchesSection({
  campaignId,
  batches,
  loading,
}: {
  campaignId: number;
  batches?: CampaignReportingPayload["batches"];
  loading?: boolean;
}) {
  const [, navigate] = useLocation();
  if (loading) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (!batches?.length) {
    return (
      <EmptyState
        variant="panel"
        title="No batches yet"
        description="Create a batch to start calling leads."
      />
    );
  }
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">Batches</h2>
      <div className="rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-4 py-2">Batch</th>
              <th className="text-left font-medium px-3 py-2">Status</th>
              <th className="text-right font-medium px-3 py-2">Imported</th>
              <th className="text-right font-medium px-3 py-2">Attempted</th>
              <th className="text-right font-medium px-3 py-2">Answered</th>
              <th className="text-right font-medium px-3 py-2 hidden sm:table-cell">Interested</th>
              <th className="text-right font-medium px-3 py-2 hidden sm:table-cell">Retry</th>
              <th className="text-right font-medium px-3 py-2 hidden sm:table-cell">Progress</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => {
              const st = BATCH_STATUS_MAP[b.status] ?? { label: b.status, cls: "" };
              return (
                <tr
                  key={String(b.batchId)}
                  className="border-t border-border/70 hover:bg-muted/30 cursor-pointer"
                  onClick={() => b.batchId && navigate(`/app/campaigns/${campaignId}/batches/${b.batchId}`)}
                >
                  <td className="px-4 py-2.5 font-medium">{b.name}</td>
                  <td className="px-3 py-2.5">
                    <span className={cn("text-xs", st.cls.includes("text-") ? "" : "text-muted-foreground")}>{st.label}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{b.imported}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{b.attempted}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{b.answered}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums hidden sm:table-cell">{b.interested}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums hidden sm:table-cell">{b.retryPending}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums hidden sm:table-cell">{b.progressPct}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
