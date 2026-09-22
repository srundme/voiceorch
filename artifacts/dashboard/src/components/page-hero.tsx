import type { ReactNode } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { GhostBars, PulseBars } from "@/components/brand-moments";

/** Page hero: one job, one sentence, primary + optional secondary CTA — generous air. */
export function PageHero({
  title,
  description,
  primary,
  secondary,
  visual,
  className,
  variant = "default",
}: {
  title: string;
  description?: string;
  primary?: { label: string; href?: string; onClick?: () => void; icon?: ReactNode };
  secondary?: { label: string; href?: string; onClick?: () => void };
  visual?: ReactNode;
  className?: string;
  /** stage = full-bleed paper plane with ghost art (Home) */
  variant?: "default" | "stage";
}) {
  const isStage = variant === "stage";

  return (
    <section
      className={cn(
        "relative overflow-hidden",
        isStage
          ? "rounded-2xl border border-border/80 bg-gradient-to-br from-card via-card to-muted/40 px-6 py-8 sm:px-9 sm:py-10"
          : "rounded-2xl border border-border bg-card px-5 py-6 sm:px-7 sm:py-8",
        className,
      )}
    >
      {isStage ? (
        <GhostBars size={200} className="absolute -right-6 -top-4 hidden sm:block md:right-8 md:top-1/2 md:-translate-y-1/2" />
      ) : null}
      <div
        className={cn(
          "relative z-[1] flex flex-col gap-5",
          isStage ? "sm:flex-row sm:items-end sm:justify-between" : "sm:flex-row sm:items-center sm:justify-between",
        )}
      >
        <div className={cn("min-w-0 space-y-2.5", isStage ? "max-w-lg" : "max-w-xl")}>
          <h2
            className={cn(
              "font-semibold tracking-[-0.04em] text-foreground",
              isStage ? "text-[26px] leading-[1.15] sm:text-[32px]" : "text-xl sm:text-2xl tracking-tight",
            )}
          >
            {title}
          </h2>
          {description ? (
            <p
              className={cn(
                "leading-relaxed text-muted-foreground",
                isStage ? "text-[14px] sm:text-[15px]" : "text-sm",
              )}
            >
              {description}
            </p>
          ) : null}
          {(primary || secondary) && (
            <div className="flex flex-wrap items-center gap-2.5 pt-3">
              {primary ? (
                primary.href ? (
                  <Button asChild className={cn("gap-1.5 text-[13px]", isStage ? "h-10 rounded-full px-5" : "h-9 rounded-lg text-xs")}>
                    <Link href={primary.href}>
                      {primary.icon}
                      {primary.label}
                    </Link>
                  </Button>
                ) : (
                  <Button
                    className={cn("gap-1.5 text-[13px]", isStage ? "h-10 rounded-full px-5" : "h-9 rounded-lg text-xs")}
                    onClick={primary.onClick}
                  >
                    {primary.icon}
                    {primary.label}
                  </Button>
                )
              ) : null}
              {secondary ? (
                secondary.href ? (
                  <Button
                    asChild
                    variant={isStage ? "ghost" : "outline"}
                    className={cn(isStage ? "h-10 rounded-full px-4 text-[13px] text-muted-foreground" : "h-9 rounded-lg text-xs")}
                  >
                    <Link href={secondary.href}>{secondary.label}</Link>
                  </Button>
                ) : (
                  <Button
                    variant={isStage ? "ghost" : "outline"}
                    className={cn(isStage ? "h-10 rounded-full px-4 text-[13px] text-muted-foreground" : "h-9 rounded-lg text-xs")}
                    onClick={secondary.onClick}
                  >
                    {secondary.label}
                  </Button>
                )
              ) : null}
            </div>
          )}
        </div>
        {visual ? (
          <div className="relative z-[1] shrink-0 opacity-90">{visual}</div>
        ) : isStage ? null : (
          <PulseBars className="hidden sm:flex" />
        )}
      </div>
    </section>
  );
}

/** Illustrated empty — wraps EmptyState with hero variant defaults. */
export function ProductEmpty({
  title,
  description,
  primary,
  secondary,
  icon,
  className,
}: {
  title: string;
  description?: string;
  primary?: { label: string; onClick: () => void; icon?: ReactNode };
  secondary?: { label: string; onClick: () => void };
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <EmptyState
      variant="hero"
      icon={icon}
      title={title}
      description={description}
      action={primary}
      secondaryAction={secondary}
      className={className}
    />
  );
}

/** Compact three-bar chip for heroes that still want a small visual. */
export function SnapBarsVisual({ className }: { className?: string }) {
  return <PulseBars className={className} />;
}
