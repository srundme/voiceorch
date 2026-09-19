import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { TablePagination } from "@/components/table-pagination";
import { EmptyState } from "@/components/empty-state";
import { LeadFilterChips, LeadReportingTable } from "@/components/campaign-ops/lead-table";
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
    queryKey: ["campaign-lead-reporting", campaignId],
    queryFn: () => customFetch<CampaignReportingPayload>(`/api/campaigns/${campaignId}/lead-reporting`),
    enabled: campaignId > 0 && !lockedBatchId,
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
      sp.set("tab", "leads");
    }
    const keys = [
      "view", "disposition", "operationalOutcome", "answeredEver",
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

  const callbackNote = filter.view === "callback";

  return (
    <div className="space-y-4 min-w-0 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Leads</h2>
        <Input
          value={filter.search ?? ""}
          onChange={(e) => patchFilter({ search: e.target.value || null })}
          placeholder="Search name or phone"
          className="h-9 sm:w-64"
        />
      </div>

      <LeadFilterChips
        views={PRIMARY_LEAD_VIEWS}
        active={filter.view ?? "all"}
        onSelect={(id) => patchFilter({ view: id === "all" ? null : id })}
      />

      <div className="flex flex-wrap gap-2">
        <SecondarySelect
          label="Lifecycle"
          value={filter.lifecycleStatus ?? ""}
          options={[
            ["", "All"],
            ["calling", "Calling"],
            ["connected", "Talking"],
            ["pending", "Pending"],
            ["completed", "Completed"],
            ["failed", "Failed (raw)"],
          ]}
          onChange={(v) => patchFilter({ lifecycleStatus: v || null })}
        />
        <SecondarySelect
          label="Latest attempt"
          value={filter.lastAttemptStatus ?? ""}
          options={[
            ["", "All"],
            ["completed", "Completed"],
            ["caller_hangup", "Caller hangup"],
            ["busy", "Busy"],
            ["no_pickup", "No pickup"],
            ["voicemail", "Voicemail"],
            ["dropped", "Dropped"],
            ["failed", "Failed"],
          ]}
          onChange={(v) => patchFilter({ lastAttemptStatus: v || null })}
        />
        <SecondarySelect
          label="Outcome"
          value={filter.operationalOutcome ?? ""}
          options={[
            ["", "All"],
            ["interest_confirmed", "Interested"],
            ["callback_requested", "Callback"],
            ["booking_created", "Booked"],
            ["transfer_completed", "Transferred"],
            ["no_contact", "No contact"],
            ["not_interested", "Not interested"],
            ["dnc_blocked", "DNC"],
          ]}
          onChange={(v) => patchFilter({ operationalOutcome: v || null })}
        />
        <SecondarySelect
          label="Answered ever"
          value={filter.answeredEver == null ? "" : String(filter.answeredEver)}
          options={[["", "All"], ["true", "Yes"], ["false", "No"]]}
          onChange={(v) => patchFilter({ answeredEver: v === "" ? null : v === "true" })}
        />
        <SecondarySelect
          label="Retry"
          value={filter.retryPending == null ? "" : String(filter.retryPending)}
          options={[["", "All"], ["true", "Pending"], ["false", "None"]]}
          onChange={(v) => patchFilter({ retryPending: v === "" ? null : v === "true" })}
        />
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          Disposition
          <Input
            value={filter.disposition ?? ""}
            onChange={(e) => patchFilter({ disposition: e.target.value || null })}
            placeholder="Exact label"
            className="h-8 w-36 text-xs"
          />
        </label>
        <SecondarySelect
          label="Source"
          value={filter.source ?? ""}
          options={[
            ["", "All"],
            ["csv", "CSV"],
            ["crm", "CRM"],
            ["meta_ads", "Meta Ads"],
            ["google_sheets", "Google Sheets"],
            ["webhook", "Webhook"],
          ]}
          onChange={(v) => patchFilter({ source: v || null })}
        />
        {!lockedBatchId && (
          <SecondarySelect
            label="Batch"
            value={filter.batchId ? String(filter.batchId) : ""}
            options={[
              ["", "All batches"],
              ...(summary.data?.batches ?? [])
                .filter((b) => b.batchId != null)
                .map((b) => [String(b.batchId), b.name] as [string, string]),
            ]}
            onChange={(v) => patchFilter({ batchId: v ? Number(v) : null })}
          />
        )}
      </div>

      {callbackNote && (
        <p className="text-[11px] text-muted-foreground">
          This list is <span className="text-foreground">operational_outcome = callback_requested</span>.
          A separate callbacks table may include extra rows; those counts are shown on Overview when they differ.
        </p>
      )}

      {query.isError && !query.data ? (
        <EmptyState
          variant="panel"
          title="Couldn’t load leads"
          action={{ label: "Retry", onClick: () => void query.refetch() }}
        />
      ) : (
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
      )}

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
  );
}

function SecondarySelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}
