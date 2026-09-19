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

  return (
    <section className="space-y-2 min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Dispositions</h2>
        <p className="text-[11px] text-muted-foreground">Click a result to list those calls</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn(
            "rounded-lg border px-3.5 py-2.5 text-left transition-colors cursor-pointer min-w-[5rem]",
            !active
              ? "border-foreground bg-foreground text-background"
              : "border-border bg-card hover:bg-muted/40",
          )}
        >
          <p className={cn("text-[10px] uppercase tracking-wider", !active ? "text-background/70" : "text-muted-foreground")}>All</p>
          <p className="text-2xl font-semibold tabular-nums leading-none">
            {chips.reduce((n, c) => n + c.count, 0)}
          </p>
        </button>
        {chips.map((chip) => {
          const selected = active === chip.bucket;
          return (
            <button
              key={chip.bucket}
              type="button"
              onClick={() => onSelect(selected ? null : chip.bucket)}
              className={cn(
                "rounded-lg border px-3.5 py-2.5 text-left transition-colors cursor-pointer min-w-[6rem] max-w-[12rem]",
                selected
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card hover:bg-muted/40",
                chip.count === 0 && "opacity-50",
              )}
            >
              <p className={cn(
                "text-[10px] uppercase tracking-wider truncate",
                selected ? "text-background/70" : "text-muted-foreground",
              )}>
                {displayDispositionLabel(chip.bucket)}
              </p>
              <p className="text-2xl font-semibold tabular-nums leading-none">{chip.count}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
