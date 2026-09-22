import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  humanizeSnakeLabel,
  type CampaignBusinessDisposition,
  type CampaignReportingPayload,
  type CampaignReportingView,
} from "@/lib/campaign-lead-reporting";

function FilterPill({
  label,
  count,
  hint,
  selected,
  muted,
  onClick,
}: {
  label: string;
  count: number;
  hint?: string;
  selected?: boolean;
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-left transition-colors cursor-pointer shrink-0",
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background hover:bg-muted/50",
        muted && !selected && "opacity-45",
      )}
    >
      <span className="min-w-0">
        <span className={cn("block text-xs font-medium leading-tight truncate max-w-[10rem]", selected ? "text-background" : "text-foreground")}>
          {label}
        </span>
        {hint ? (
          <span className={cn("block text-[10px] leading-tight truncate max-w-[10rem]", selected ? "text-background/65" : "text-muted-foreground")}>
            {hint}
          </span>
        ) : null}
      </span>
      <span className={cn("text-sm font-semibold tabular-nums", selected ? "text-background" : "text-foreground")}>
        {count}
      </span>
    </button>
  );
}

export function DispositionHero({
  items,
  active,
  onSelect,
  loading,
}: {
  items?: CampaignBusinessDisposition[];
  active?: string | null;
  onSelect: (key: string | null) => void;
  loading?: boolean;
}) {
  if (loading) return <Skeleton className="h-10 w-full rounded-full" />;
  const chips = items ?? [];
  if (chips.length === 0) {
    return (
      <p className="text-xs text-muted-foreground px-0.5">
        No business dispositions yet on answered calls.
      </p>
    );
  }

  return (
    <section className="min-w-0 shrink-0 space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide px-0.5">
        Dispositions
      </p>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin">
        {chips.map((chip) => {
          const selected = active === chip.key;
          const label = chip.key === "needs_classification"
            ? "Needs classification"
            : humanizeSnakeLabel(chip.label || chip.key);
          return (
            <FilterPill
              key={chip.key}
              label={label}
              count={chip.count}
              hint={chip.sub ? humanizeSnakeLabel(chip.primary) : undefined}
              selected={selected}
              muted={chip.count === 0}
              onClick={() => onSelect(selected ? null : chip.key)}
            />
          );
        })}
      </div>
    </section>
  );
}

export function ContactOutcomeHero({
  reporting,
  active,
  allSelected,
  onSelect,
  loading,
}: {
  reporting?: CampaignReportingPayload;
  active?: CampaignReportingView | null;
  allSelected?: boolean;
  onSelect: (view: CampaignReportingView | null) => void;
  loading?: boolean;
}) {
  if (loading) return <Skeleton className="h-10 w-full rounded-full" />;
  const cards: Array<{ id: CampaignReportingView | "all"; label: string; count: number; hint?: string }> = [
    { id: "all", label: "All", count: reporting?.funnel.imported ?? 0 },
    { id: "answered", label: "Answered", count: reporting?.funnel.answered ?? 0 },
    { id: "retry", label: "Retry", count: reporting?.workTechnical.retryPending ?? 0 },
    { id: "busy", label: "Busy", count: reporting?.workTechnical.busy ?? 0 },
    { id: "no_pickup", label: "No pickup", count: reporting?.workTechnical.noPickup ?? 0 },
    { id: "voicemail", label: "Voicemail", count: reporting?.workTechnical.voicemail ?? 0 },
    { id: "technical_failed", label: "Failed", count: reporting?.workTechnical.technicalFailed ?? 0, hint: "Never answered" },
  ];
  return (
    <section className="min-w-0 shrink-0 space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide px-0.5">
        Contact
      </p>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {cards.map((card) => {
          const selected = card.id === "all" ? (allSelected ?? !active) : active === card.id;
          return (
            <FilterPill
              key={card.id}
              label={card.label}
              count={card.count}
              hint={card.hint}
              selected={selected}
              onClick={() => onSelect(card.id === "all" || selected ? null : card.id)}
            />
          );
        })}
      </div>
    </section>
  );
}
