import { History, X } from "lucide-react";
import type { RecentNumber } from "@/hooks/use-recent-numbers";

interface RecentNumbersListProps {
  numbers: RecentNumber[];
  onSelect: (number: string) => void;
  onRemove?: (number: string) => void;
}

export function RecentNumbersList({ numbers, onSelect, onRemove }: RecentNumbersListProps) {
  if (numbers.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <History className="h-3 w-3" />
        Recently dialed
      </p>
      <div className="flex flex-wrap gap-1.5">
        {numbers.map((entry) => (
          <div
            key={entry.number}
            className="group relative flex items-center rounded-md border bg-muted/40 transition-colors hover:bg-muted"
          >
            <button
              type="button"
              onClick={() => onSelect(entry.number)}
              className="px-2 py-1 font-mono text-xs text-foreground/80 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {entry.number}
            </button>
            {onRemove && (
              <button
                type="button"
                aria-label={`Remove ${entry.number} from recently dialed`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(entry.number);
                }}
                className="mr-1 inline-flex rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
