import { cn } from "@/lib/utils";
import { displayDispositionLabel } from "@/lib/campaign-lead-reporting";
import { Skeleton } from "@/components/ui/skeleton";

export function DispositionHero({
  items,
  active,
  onSelect,
  loading,
}: {
  items?: Array<{ bucket: string; count: number }>;
  active?: string | null;
  onSelect: (bucket: string | null) => void;
  loading?: boolean;
}) {
  if (loading) return <Skeleton className="h-20 w-full rounded-xl" />;
  const chips = items ?? [];
  const total = chips.reduce((n, c) => n + c.count, 0);

  return (
    <section className="space-y-2 min-w-0 shrink-0">
      <h2 className="text-sm font-semibold">Dispositions</h2>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn(
            "rounded-xl border px-3 py-2.5 text-left transition-colors cursor-pointer min-w-0",
            !active
              ? "border-foreground bg-foreground text-background"
              : "border-border bg-card hover:bg-muted/40",
          )}
        >
          <p className={cn("text-[11px] truncate", !active ? "text-background/70" : "text-muted-foreground")}>All</p>
          <p className="text-xl font-semibold tabular-nums leading-tight">{total}</p>
        </button>
        {chips.map((chip) => {
          const selected = active === chip.bucket;
          return (
            <button
              key={chip.bucket}
              type="button"
              onClick={() => onSelect(selected ? null : chip.bucket)}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-left transition-colors cursor-pointer min-w-0",
                selected
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card hover:bg-muted/40",
                chip.count === 0 && "opacity-50",
              )}
            >
              <p className={cn(
                "text-[11px] truncate",
                selected ? "text-background/70" : "text-muted-foreground",
              )}>
                {displayDispositionLabel(chip.bucket)}
              </p>
              <p className="text-xl font-semibold tabular-nums leading-tight">{chip.count}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
