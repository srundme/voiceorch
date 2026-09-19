import { Skeleton } from "@/components/ui/skeleton";
import type { CampaignReportingPayload } from "@/lib/campaign-lead-reporting";

function Step({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}

export function CampaignFunnel({
  data,
  rates,
  loading,
}: {
  data?: CampaignReportingPayload["funnel"];
  rates?: CampaignReportingPayload["rates"];
  loading?: boolean;
}) {
  if (loading) return <Skeleton className="h-28 w-full rounded-xl" />;
  if (!data) return null;
  return (
    <section className="rounded-xl border border-border bg-card px-5 py-4 space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Results</h2>
        {rates && (
          <p className="text-xs text-muted-foreground tabular-nums">
            Answer Rate {rates.answerRatePct}% · Interest Rate {rates.interestRatePct}% · Conversion Rate {rates.conversionRatePct}%
          </p>
        )}
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
        <Step label="Imported" value={data.imported} />
        <Step label="Attempted" value={data.attempted} />
        <Step label="Answered" value={data.answered} />
        <Step label="Interested" value={data.interested} />
        <Step label="Booked" value={data.booked} />
        <Step label="Transferred" value={data.transferred} />
      </div>
    </section>
  );
}
