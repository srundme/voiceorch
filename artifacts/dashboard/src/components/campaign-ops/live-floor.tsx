import { Skeleton } from "@/components/ui/skeleton";
import type { CampaignReportingPayload } from "@/lib/campaign-lead-reporting";

function Cell({ label, value, live }: { label: string; value: number; live?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
        {value}
        {live && <span className="ml-1.5 align-middle text-[10px] font-medium uppercase tracking-wider text-muted-foreground">now</span>}
      </p>
    </div>
  );
}

export function LiveFloor({
  data,
  loading,
}: {
  data?: CampaignReportingPayload["liveFloor"] & { retryPending: number };
  loading?: boolean;
}) {
  if (loading) {
    return <Skeleton className="h-24 w-full rounded-xl" />;
  }
  if (!data) return null;
  return (
    <section className="rounded-xl border border-border bg-card px-5 py-4">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h2 className="text-sm font-semibold">Live floor</h2>
        <p className="text-xs text-muted-foreground tabular-nums">
          Slots {data.slotsUsed} / {data.concurrencyLimit}
          {data.availableConcurrency != null && (
            <span className="text-muted-foreground/70"> · {data.availableConcurrency} free</span>
          )}
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
        <Cell label="Queued" value={data.queued} />
        <Cell label="Calling" value={data.calling} live />
        <Cell label="Talking" value={data.talking} live />
        <Cell label="Retry pending" value={data.retryPending} />
      </div>
    </section>
  );
}
