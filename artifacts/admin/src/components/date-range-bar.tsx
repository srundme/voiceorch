import { DATE_PRESETS, COMPARE_OPTIONS, type DateRange } from "@/hooks/use-date-range";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function DateRangeBar({
  range,
  className,
  showCompare = true,
  updatedAt,
}: {
  range: DateRange;
  className?: string;
  showCompare?: boolean;
  updatedAt?: Date | null;
}) {
  const updatedLabel = updatedAt
    ? `Updated ${Math.max(0, Math.round((Date.now() - updatedAt.getTime()) / 60000))} min ago`
    : null;

  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {DATE_PRESETS.filter((p) => p.id !== "custom").map((p) => (
          <Button
            key={p.id}
            type="button"
            size="sm"
            variant={range.preset === p.id ? "default" : "outline"}
            className="h-8 text-xs"
            onClick={() => range.setPreset(p.id)}
          >
            {p.label}
          </Button>
        ))}
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            className="h-8 w-[140px] text-xs"
            value={range.fromParam}
            onChange={(e) => range.setCustomRange(e.target.value, range.toParam)}
          />
          <span className="text-xs text-muted-foreground">→</span>
          <Input
            type="date"
            className="h-8 w-[140px] text-xs"
            value={range.toParam}
            onChange={(e) => range.setCustomRange(range.fromParam, e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {showCompare && (
          <Select value={range.compare} onValueChange={(v) => range.setCompare(v as DateRange["compare"])}>
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue placeholder="Compare" />
            </SelectTrigger>
            <SelectContent>
              {COMPARE_OPTIONS.map((o) => (
                <SelectItem key={o.id} value={o.id} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {updatedLabel && (
          <span className="text-[11px] text-muted-foreground tabular-nums">{updatedLabel}</span>
        )}
      </div>
    </div>
  );
}
