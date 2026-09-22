import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  humanizeSnakeLabel,
  type CampaignBusinessDisposition,
  type CampaignReportingPayload,
  type CampaignReportingView,
} from "@/lib/campaign-lead-reporting";

/** True when the agent has configured outcome labels (not just empty / needs-outcome). */
export function hasConfiguredOutcomes(items?: CampaignBusinessDisposition[]): boolean {
  return (items ?? []).some((d) => d.kind === "configured");
}

function FilterPill({
  label,
  count,
  hint,
  selected,
  muted,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  hint?: string;
  selected?: boolean;
  muted?: boolean;
  /** Color hierarchy for call-status chips */
  tone?: "neutral" | "good" | "warn" | "bad";
  onClick: () => void;
}) {
  const toneIdle =
    tone === "good"
      ? "border-emerald-500/40 text-emerald-800 dark:text-emerald-300"
      : tone === "warn"
        ? "border-amber-500/40 text-amber-900 dark:text-amber-200"
        : tone === "bad"
          ? "border-rose-500/40 text-rose-900 dark:text-rose-200"
          : "";
  return (
    <button
      type="button"
      data-on={selected ? "true" : "false"}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-left transition-colors cursor-pointer shrink-0",
        selected
          ? "border-foreground bg-foreground text-background"
          : cn("border-border bg-background hover:bg-muted/50", toneIdle),
        muted && !selected && "opacity-45",
      )}
    >
      <span className="min-w-0">
        <span
          className={cn(
            "block text-xs font-medium leading-tight truncate max-w-[10rem]",
            selected ? "text-background" : "text-inherit",
          )}
        >
          {label}
        </span>
        {hint ? (
          <span
            className={cn(
              "block text-[10px] leading-tight truncate max-w-[10rem]",
              selected ? "text-background/65" : "text-muted-foreground",
            )}
          >
            {hint}
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "text-sm font-semibold tabular-nums",
          selected ? "text-background" : "text-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}

/** ROI funnel: always Leads → Called → Answered; Interested/Booked only with Outcomes. */
export function ResultsFunnel({
  reporting,
  showOutcomes,
  loading,
}: {
  reporting?: CampaignReportingPayload;
  showOutcomes: boolean;
  loading?: boolean;
}) {
  if (loading) return <Skeleton className="h-20 w-full rounded-xl" />;
  if (!reporting?.funnel) return null;
  const f = reporting.funnel;
  const rates = reporting.rates;
  const steps: Array<{ label: string; value: number; accent?: string; sub?: string }> = [
    { label: "Leads", value: f.imported },
    { label: "Called", value: f.attempted },
    {
      label: "Answered",
      value: f.answered,
      accent: "text-emerald-700 dark:text-emerald-400",
      sub: rates ? `${rates.answerRatePct}%` : undefined,
    },
  ];
  if (showOutcomes) {
    steps.push({
      label: "Interested",
      value: f.interested,
      accent: "text-emerald-700 dark:text-emerald-400",
      sub: rates ? `${rates.interestRatePct}%` : undefined,
    });
    steps.push({
      label: "Booked",
      value: f.booked,
      accent: "text-foreground",
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card px-3 py-3 sm:px-4">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2.5 px-0.5">
        Results
      </p>
      <div className="flex flex-wrap items-stretch gap-1 sm:gap-0">
        {steps.map((step, i) => (
          <div key={step.label} className="flex items-center min-w-0">
            {i > 0 ? (
              <span className="hidden sm:inline text-muted-foreground/40 px-1.5 text-sm" aria-hidden>
                →
              </span>
            ) : null}
            <div className="min-w-[4.5rem] rounded-lg px-2.5 py-1.5 sm:px-3">
              <p className="text-[10px] text-muted-foreground leading-none mb-1">{step.label}</p>
              <p
                className={cn(
                  "text-xl font-semibold tabular-nums leading-none tracking-tight",
                  step.accent,
                )}
              >
                {step.value}
              </p>
              {step.sub ? (
                <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">{step.sub}</p>
              ) : (
                <p className="text-[10px] text-transparent mt-1 select-none">.</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
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
  // Hide entirely when agent has no configured outcomes (two-layer model).
  if (!hasConfiguredOutcomes(items)) return null;

  const chips = items ?? [];

  return (
    <section className="min-w-0 shrink-0 space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide px-0.5">
        Outcomes
      </p>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin">
        {chips.map((chip) => {
          const selected = active === chip.key;
          const label =
            chip.key === "needs_classification"
              ? "Needs outcome"
              : humanizeSnakeLabel(chip.label || chip.key);
          return (
            <FilterPill
              key={chip.key}
              label={label}
              count={chip.count}
              hint={chip.sub ? humanizeSnakeLabel(chip.primary) : undefined}
              selected={selected}
              muted={chip.count === 0}
              tone={chip.kind === "needs_classification" ? "warn" : "good"}
              onClick={() => onSelect(selected ? null : chip.key)}
            />
          );
        })}
      </div>
    </section>
  );
}

/** Vobiz call-status filters — always shown. */
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
  const cards: Array<{
    id: CampaignReportingView | "all";
    label: string;
    count: number;
    hint?: string;
    tone?: "neutral" | "good" | "warn" | "bad";
  }> = [
    { id: "all", label: "All leads", count: reporting?.funnel.imported ?? 0, tone: "neutral" },
    { id: "answered", label: "Answered", count: reporting?.funnel.answered ?? 0, tone: "good" },
    { id: "no_pickup", label: "No answer", count: reporting?.workTechnical.noPickup ?? 0, tone: "warn" },
    { id: "busy", label: "Busy", count: reporting?.workTechnical.busy ?? 0, tone: "warn" },
    { id: "voicemail", label: "Voicemail", count: reporting?.workTechnical.voicemail ?? 0, tone: "warn" },
    {
      id: "technical_failed",
      label: "Couldn’t reach",
      count: reporting?.workTechnical.technicalFailed ?? 0,
      tone: "bad",
    },
    { id: "retry", label: "Retrying", count: reporting?.workTechnical.retryPending ?? 0, tone: "neutral" },
  ];
  return (
    <section className="min-w-0 shrink-0 space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide px-0.5">
        Call status
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
              tone={card.tone}
              selected={selected}
              onClick={() => onSelect(card.id === "all" || selected ? null : card.id)}
            />
          );
        })}
      </div>
    </section>
  );
}
