import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  CampaignBusinessDisposition,
  CampaignReportingPayload,
  CampaignReportingView,
} from "@/lib/campaign-lead-reporting";

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
  if (loading) return <Skeleton className="h-20 w-full rounded-xl" />;
  const chips = items ?? [];

  return (
    <section className="space-y-2 min-w-0 shrink-0">
      <div>
        <h2 className="text-sm font-semibold">Business dispositions</h2>
        <p className="text-[11px] text-muted-foreground">Answered conversations only. Carrier outcomes are shown separately.</p>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5">
        {chips.map((chip) => {
          const selected = active === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => onSelect(selected ? null : chip.key)}
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
                {chip.label}
              </p>
              {chip.sub && (
                <p className={cn(
                  "text-[10px] truncate",
                  selected ? "text-background/55" : "text-muted-foreground/70",
                )}>
                  {chip.primary}
                </p>
              )}
              <p className="text-xl font-semibold tabular-nums leading-tight">{chip.count}</p>
            </button>
          );
        })}
      </div>
      {chips.length === 0 && (
        <p className="rounded-xl border border-dashed px-3 py-4 text-xs text-muted-foreground">
          No answered conversations have a business disposition yet.
        </p>
      )}
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
  if (loading) return <Skeleton className="h-20 w-full rounded-xl" />;
  const cards: Array<{ id: CampaignReportingView | "all"; label: string; count: number }> = [
    { id: "all", label: "All leads", count: reporting?.funnel.imported ?? 0 },
    { id: "answered", label: "Answered", count: reporting?.funnel.answered ?? 0 },
    { id: "busy", label: "Busy", count: reporting?.workTechnical.busy ?? 0 },
    { id: "no_pickup", label: "No Pickup", count: reporting?.workTechnical.noPickup ?? 0 },
    { id: "voicemail", label: "Voicemail", count: reporting?.workTechnical.voicemail ?? 0 },
    { id: "technical_failed", label: "Failed", count: reporting?.workTechnical.technicalFailed ?? 0 },
  ];
  return (
    <section className="space-y-2 min-w-0 shrink-0">
      <div>
        <h2 className="text-sm font-semibold">Contact outcomes</h2>
        <p className="text-[11px] text-muted-foreground">Sticky answer history plus terminal telephony outcomes.</p>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
        {cards.map((card) => {
          const selected = card.id === "all" ? (allSelected ?? !active) : active === card.id;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onSelect(card.id === "all" || selected ? null : card.id)}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-left transition-colors cursor-pointer min-w-0",
                selected
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card hover:bg-muted/40",
              )}
            >
              <p className={cn("text-[11px] truncate", selected ? "text-background/70" : "text-muted-foreground")}>{card.label}</p>
              <p className="text-xl font-semibold tabular-nums leading-tight">{card.count}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
