import { History } from "lucide-react";
import type { RecentNumber } from "@/hooks/use-recent-numbers";

interface RecentNumbersListProps {
  numbers: RecentNumber[];
  onSelect: (number: string) => void;
}

export function RecentNumbersList({ numbers, onSelect }: RecentNumbersListProps) {
  if (numbers.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <History className="h-3 w-3" />
        Recently dialed
      </p>
      <div className="flex flex-wrap gap-1.5">
        {numbers.map((entry) => (
          <button
            key={entry.number}
            type="button"
            onClick={() => onSelect(entry.number)}
            className="rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {entry.number}
          </button>
        ))}
      </div>
    </div>
  );
}
