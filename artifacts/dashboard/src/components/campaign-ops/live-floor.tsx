import { Skeleton } from "@/components/ui/skeleton";
import type { CampaignReportingPayload, CampaignReportingView } from "@/lib/campaign-lead-reporting";

function Cell({
  label,
  value,
  live,
  onClick,
}: {
  label: string;
  value: number;
  live?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums tracking-tight">
        {value}
        {live && (
          <span className="ml-1.5 align-middle text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            now
          </span>
        )}
      </p>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="min-w-0 text-left rounded-lg -m-1 p-1 hover:bg-muted/50 transition-colors cursor-pointer"
      >
        {body}
      </button>
    );
  }
  return <div className="min-w-0">{body}</div>;
}

export function LiveFloor({
  data,
  loading,
  onSelect,
}: {
  data?: CampaignReportingPayload["liveFloor"] & { retryPending: number };
  loading?: boolean;
  onSelect?: (view: CampaignReportingView | "queued" | "calling" | "talking") => void;
}) {
  if (loading) {
    return <Skeleton className="h-16 w-full rounded-lg" />;
  }
  if (!data) return null;
  return (
    <section className="border-b border-border pb-4 mb-1">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-sm font-medium text-muted-foreground">Live</h2>
        <p className="text-xs text-muted-foreground tabular-nums">
          Slots {data.slotsUsed}/{data.concurrencyLimit}
          {data.availableConcurrency != null && (
            <span className="text-muted-foreground/70"> · {data.availableConcurrency} free</span>
          )}
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Cell label="Queued" value={data.queued} onClick={onSelect ? () => onSelect("queued") : undefined} />
        <Cell label="Calling" value={data.calling} live onClick={onSelect ? () => onSelect("calling") : undefined} />
        <Cell label="Talking" value={data.talking} live onClick={onSelect ? () => onSelect("talking") : undefined} />
        <Cell
          label="Retry"
          value={data.retryPending}
          onClick={onSelect ? () => onSelect("retry") : undefined}
        />
      </div>
    </section>
  );
}
