import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  OUTCOME_CARDS,
  type CampaignReportingView,
} from "@/lib/campaign-lead-reporting";

export function OutcomeChips({
  counts,
  onSelect,
  loading,
}: {
  counts: Partial<Record<CampaignReportingView, number>>;
  onSelect: (view: CampaignReportingView) => void;
  loading?: boolean;
}) {
  if (loading) return <Skeleton className="h-16 w-full rounded-xl" />;

  const visible = OUTCOME_CARDS.map((card) => ({ ...card, value: counts[card.view] ?? 0 }));

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">Outcomes</h2>
      <div className="flex gap-2 overflow-x-auto pb-1 min-w-0 max-w-full">
        {visible.map((card) => (
          <button
            key={card.view}
            type="button"
            onClick={() => onSelect(card.view)}
            className={cn(
              "shrink-0 rounded-lg border border-border bg-card px-3.5 py-2.5 text-left hover:bg-muted/40 transition-colors min-w-[108px]",
              card.value === 0 && "opacity-50",
            )}
          >
            <p className="text-[11px] text-muted-foreground">{card.label}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">{card.value}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
