import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { TablePagination } from "@/components/table-pagination";
import { EmptyState } from "@/components/empty-state";
import { LeadReportingTable } from "@/components/campaign-ops/lead-table";
import {
  ContactOutcomeHero,
  DispositionHero,
  ResultsFunnel,
  hasConfiguredOutcomes,
} from "@/components/campaign-ops/disposition-hero";
import { LiveFloor } from "@/components/campaign-ops/live-floor";
import { useToast } from "@/hooks/use-toast";
import {
  WORK_LEAD_VIEWS,
  CONTACT_OUTCOME_VIEWS,
  displayDispositionLabel,
  humanizeSnakeLabel,
  parseLeadsSearch,
  reportingLeadsQuery,
  type CampaignReportingFilter,
  type CampaignReportingLead,
  type CampaignReportingPayload,
} from "@/lib/campaign-lead-reporting";
import { useLocation, useSearch } from "wouter";
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";

type LeadsPage = {
  items: CampaignReportingLead[];
  total: number;
  page: number;
  limit: number;
  filter: CampaignReportingFilter;
};

export function CampaignLeadsWorkspace({
  campaignId,
  lockedBatchId,
}: {
  campaignId: number;
  lockedBatchId?: number;
}) {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [page, setPage] = useState(0);
  const filter = useMemo(() => {
    const parsed = parseLeadsSearch(search);
    return lockedBatchId ? { ...parsed, batchId: lockedBatchId } : parsed;
  }, [search, lockedBatchId]);
  const [searchDraft, setSearchDraft] = useState(filter.search ?? "");

  useEffect(() => {
    setPage(0);
  }, [search]);

  useEffect(() => {
    setSearchDraft(filter.search ?? "");
  }, [filter.search]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = searchDraft.trim() || null;
      if (next === (filter.search || null)) return;
      patchFilter({ search: next });
    }, 250);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  const qs = reportingLeadsQuery(filter, page, 50);
  const query = useQuery({
    queryKey: ["campaign-lead-reporting-leads", campaignId, qs],
    queryFn: () => customFetch<LeadsPage>(`/api/campaigns/${campaignId}/lead-reporting/leads?${qs}`),
    enabled: campaignId > 0,
  });
  const summary = useQuery({
    queryKey: ["campaign-lead-reporting", campaignId, lockedBatchId ?? "all"],
    queryFn: () =>
      customFetch<CampaignReportingPayload>(
        lockedBatchId
          ? `/api/campaigns/${campaignId}/batches/${lockedBatchId}/lead-reporting`
          : `/api/campaigns/${campaignId}/lead-reporting`,
      ),
    enabled: campaignId > 0,
  });

  function patchFilter(next: Partial<CampaignReportingFilter>, resetView?: boolean) {
    const merged: CampaignReportingFilter = {
      ...filter,
      ...next,
    };
    if (resetView) merged.view = null;
    const sp = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    if (lockedBatchId) {
      sp.delete("tab");
      sp.delete("batchId");
    } else {
      // Results is the default home — keep filter params, drop legacy tab=leads
      sp.delete("tab");
    }
    const keys = [
      "view",
      "disposition",
      "dispositionBucket",
      "operationalOutcome",
      "answeredEver",
      "lifecycleStatus",
      "lastAttemptStatus",
      "retryPending",
      "batchId",
      "source",
      "search",
    ] as const;
    for (const key of keys) {
      if (lockedBatchId && key === "batchId") continue;
      const val = merged[key];
      if (val == null || val === "" || (val === false && key !== "answeredEver" && key !== "retryPending")) {
        if (key === "answeredEver" && merged.answeredEver === false) sp.set(key, "false");
        else if (key === "retryPending" && merged.retryPending === false) sp.set(key, "false");
        else sp.delete(key);
      } else {
        sp.set(key, String(val));
      }
    }
    setPage(0);
    setLocation(`${window.location.pathname}?${sp.toString()}`);
  }

  async function retryLead(leadId: number) {
    try {
      await customFetch(`/api/campaigns/${campaignId}/leads/${leadId}/retry`, { method: "POST" });
      toast({ title: "Retry queued" });
      await qc.invalidateQueries({ queryKey: ["campaign-lead-reporting-leads", campaignId] });
    } catch {
      toast({ title: "Retry failed", variant: "destructive" });
    }
  }

  async function cancelRetry(leadId: number) {
    try {
      await customFetch(`/api/campaigns/${campaignId}/leads/${leadId}/retries/cancel`, {
        method: "POST",
      });
      toast({ title: "Retry cancelled" });
      await qc.invalidateQueries({ queryKey: ["campaign-lead-reporting-leads", campaignId] });
    } catch {
      toast({ title: "Could not cancel retry", variant: "destructive" });
    }
  }

  const showOutcomes = hasConfiguredOutcomes(summary.data?.dispositions);
  const liveBusy =
    ((summary.data?.liveFloor.queued ?? 0) +
      (summary.data?.liveFloor.calling ?? 0) +
      (summary.data?.liveFloor.talking ?? 0) +
      (summary.data?.workTechnical.retryPending ?? 0)) >
    0;
  const campaignRunning =
    (summary.data?.liveFloor.calling ?? 0) + (summary.data?.liveFloor.talking ?? 0) > 0 ||
    (summary.data?.batches?.some((b) => b.status === "running") ?? false);

  const listLabel = filter.disposition
    ? humanizeSnakeLabel(
        summary.data?.dispositions?.find((item) => item.key === filter.disposition)?.label ??
          filter.disposition,
      )
    : filter.dispositionBucket
      ? displayDispositionLabel(filter.dispositionBucket)
      : filter.view
        ? (CONTACT_OUTCOME_VIEWS.find((v) => v.id === filter.view)?.label ??
          WORK_LEAD_VIEWS.find((v) => v.id === filter.view)?.label ??
          filter.view)
        : "leads";

  return (
    <div className="flex flex-col gap-3 min-h-0 flex-1 h-full max-w-full overflow-hidden">
      <div className="shrink-0 space-y-3">
        <ResultsFunnel
          loading={summary.isLoading}
          reporting={summary.data}
          showOutcomes={showOutcomes}
        />
        <ContactOutcomeHero
          loading={summary.isLoading}
          reporting={summary.data}
          active={filter.view ?? null}
          allSelected={!filter.view && !filter.disposition && !filter.dispositionBucket}
          onSelect={(view) => patchFilter({ view, disposition: null, dispositionBucket: null })}
        />
        <DispositionHero
          loading={summary.isLoading}
          items={summary.data?.dispositions}
          active={filter.disposition ?? filter.dispositionBucket ?? null}
          onSelect={(key) =>
            patchFilter({
              disposition: key && key !== "needs_classification" ? key : null,
              dispositionBucket: key === "needs_classification" ? key : null,
              view: null,
            })
          }
        />
        {(summary.isLoading || liveBusy || campaignRunning) && !lockedBatchId && (
          <LiveFloor
            loading={summary.isLoading}
            data={
              summary.data
                ? {
                    ...summary.data.liveFloor,
                    retryPending: summary.data.workTechnical.retryPending,
                  }
                : undefined
            }
            onSelect={(key) => {
              if (key === "retry") patchFilter({ view: "retry", disposition: null, dispositionBucket: null });
              else if (key === "talking" || key === "calling") {
                patchFilter({ view: "answered", disposition: null, dispositionBucket: null });
              }
            }}
          />
        )}
      </div>

      {query.isError && !query.data ? (
        <EmptyState
          variant="panel"
          title="Couldn’t load leads"
          action={{ label: "Retry", onClick: () => void query.refetch() }}
        />
      ) : (
        <div className="min-w-0 min-h-0 flex-1 flex flex-col rounded-xl border border-border bg-card overflow-hidden">
          <div className="shrink-0 px-3 py-2 border-b border-border flex items-center gap-2">
            <p className="text-sm font-semibold tabular-nums mr-auto">
              {query.data?.total ?? 0}{" "}
              <span className="font-normal text-muted-foreground">{listLabel.toLowerCase()}</span>
            </p>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="Search phone"
                className="h-8 w-44 pl-7 text-xs"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <LeadReportingTable
              campaignId={campaignId}
              items={query.data?.items ?? []}
              total={query.data?.total ?? 0}
              loading={query.isLoading}
              error={query.isError ? "The reporting API could not be reached." : null}
              emptyView={filter.view}
              onRetry={retryLead}
              onCancelRetry={cancelRetry}
              onRefresh={() => void query.refetch()}
            />
          </div>
          {(query.data?.total ?? 0) > 50 && (
            <div className="shrink-0 border-t border-border px-3 py-2 overflow-x-auto">
              <TablePagination
                page={page + 1}
                totalPages={Math.max(1, Math.ceil((query.data?.total ?? 0) / 50))}
                pageSize={50}
                totalItems={query.data?.total ?? 0}
                onPageChange={(p) => setPage(Math.max(0, p - 1))}
                onPageSizeChange={() => undefined}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
