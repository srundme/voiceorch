import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { TablePagination } from "@/components/table-pagination";
import { EmptyState } from "@/components/empty-state";
import { LeadFilterChips, LeadReportingTable } from "@/components/campaign-ops/lead-table";
import { DispositionHero } from "@/components/campaign-ops/disposition-hero";
import { CallInspectorPanel } from "@/components/campaign-ops/call-inspector";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import {
  PRIMARY_LEAD_VIEWS,
  parseLeadsSearch,
  reportingLeadsQuery,
  type CampaignReportingFilter,
  type CampaignReportingLead,
  type CampaignReportingPayload,
} from "@/lib/campaign-lead-reporting";
import { useLocation, useSearch } from "wouter";
import { useEffect, useMemo, useState } from "react";

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
  const [selectedLead, setSelectedLead] = useState<CampaignReportingLead | null>(null);
  const [mobileInspector, setMobileInspector] = useState(false);
  const filter = useMemo(() => {
    const parsed = parseLeadsSearch(search);
    return lockedBatchId ? { ...parsed, batchId: lockedBatchId } : parsed;
  }, [search, lockedBatchId]);

  useEffect(() => {
    setPage(0);
  }, [search]);

  const qs = reportingLeadsQuery(filter, page, 50);
  const query = useQuery({
    queryKey: ["campaign-lead-reporting-leads", campaignId, qs],
    queryFn: () => customFetch<LeadsPage>(`/api/campaigns/${campaignId}/lead-reporting/leads?${qs}`),
    enabled: campaignId > 0,
  });
  const summary = useQuery({
    queryKey: ["campaign-lead-reporting", campaignId, lockedBatchId ?? "all"],
    queryFn: () => customFetch<CampaignReportingPayload>(
      lockedBatchId
        ? `/api/campaigns/${campaignId}/batches/${lockedBatchId}/lead-reporting`
        : `/api/campaigns/${campaignId}/lead-reporting`,
    ),
    enabled: campaignId > 0,
  });

  useEffect(() => {
    const items = query.data?.items ?? [];
    if (items.length === 0) {
      setSelectedLead(null);
      return;
    }
    if (!selectedLead || !items.some((l) => l.leadId === selectedLead.leadId)) {
      setSelectedLead(items[0] ?? null);
    }
  }, [query.data, selectedLead]);

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
      sp.set("tab", "leads");
    }
    const keys = [
      "view", "disposition", "dispositionBucket", "operationalOutcome", "answeredEver",
      "lifecycleStatus", "lastAttemptStatus", "retryPending", "batchId", "source", "search",
    ] as const;
    for (const key of keys) {
      if (lockedBatchId && key === "batchId") continue;
      const val = merged[key];
      if (val == null || val === "" || val === false && key !== "answeredEver" && key !== "retryPending") {
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
      await customFetch(`/api/campaigns/${campaignId}/leads/${leadId}/retries/cancel`, { method: "POST" });
      toast({ title: "Retry cancelled" });
      await qc.invalidateQueries({ queryKey: ["campaign-lead-reporting-leads", campaignId] });
    } catch {
      toast({ title: "Could not cancel retry", variant: "destructive" });
    }
  }

  function inspectLead(lead: CampaignReportingLead) {
    setSelectedLead(lead);
    if (typeof window !== "undefined" && !window.matchMedia("(min-width: 1280px)").matches) {
      setMobileInspector(true);
    }
  }

  const funnel = summary.data?.funnel;
  const rates = summary.data?.rates;

  return (
    <div className="flex flex-col gap-3 min-h-0 flex-1 max-w-full">
      {funnel && (
        <p className="text-xs text-muted-foreground tabular-nums">
          Imported {funnel.imported} · Attempted {funnel.attempted} · Answered {funnel.answered}
          {rates ? ` · Answer rate ${rates.answerRatePct}%` : ""}
        </p>
      )}

      <DispositionHero
        loading={summary.isLoading}
        items={summary.data?.dispositions}
        active={filter.dispositionBucket ?? null}
        onSelect={(bucket) => patchFilter({ dispositionBucket: bucket, view: null }, true)}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <LeadFilterChips
          views={PRIMARY_LEAD_VIEWS}
          active={filter.view ?? "all"}
          onSelect={(id) => patchFilter({ view: id === "all" ? null : id, dispositionBucket: null })}
        />
        <Input
          value={filter.search ?? ""}
          onChange={(e) => patchFilter({ search: e.target.value || null })}
          placeholder="Search name or phone"
          className="h-9 sm:w-64"
        />
      </div>

      {query.isError && !query.data ? (
        <EmptyState
          variant="panel"
          title="Couldn’t load leads"
          action={{ label: "Retry", onClick: () => void query.refetch() }}
        />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] gap-3 min-h-0 flex-1">
          <div className="min-w-0 min-h-0 overflow-auto">
            <LeadReportingTable
              campaignId={campaignId}
              items={query.data?.items ?? []}
              total={query.data?.total ?? 0}
              loading={query.isLoading}
              error={query.isError ? "The reporting API could not be reached." : null}
              emptyView={filter.view}
              selectedLeadId={selectedLead?.leadId}
              onSelectLead={inspectLead}
              onRetry={retryLead}
              onCancelRetry={cancelRetry}
              onRefresh={() => void query.refetch()}
            />
            {(query.data?.total ?? 0) > 50 && (
              <TablePagination
                page={page + 1}
                totalPages={Math.max(1, Math.ceil((query.data?.total ?? 0) / 50))}
                pageSize={50}
                totalItems={query.data?.total ?? 0}
                onPageChange={(p) => setPage(Math.max(0, p - 1))}
                onPageSizeChange={() => undefined}
              />
            )}
          </div>
          <div className="hidden xl:block min-h-0 h-full">
            <CallInspectorPanel campaignId={campaignId} lead={selectedLead} />
          </div>
        </div>
      )}

      <Sheet open={mobileInspector} onOpenChange={setMobileInspector}>
        <SheetContent side="right" className="w-[min(100vw,420px)] sm:max-w-none p-0">
          <SheetTitle className="sr-only">Call transcript</SheetTitle>
          <div className="h-full p-3">
            <CallInspectorPanel campaignId={campaignId} lead={selectedLead} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
