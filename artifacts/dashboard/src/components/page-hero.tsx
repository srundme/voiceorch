import type { ReactNode } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";

/** Page hero: one job, one sentence, primary + optional secondary CTA. */
export function PageHero({
  title,
  description,
  primary,
  secondary,
  visual,
  className,
}: {
  title: string;
  description?: string;
  primary?: { label: string; href?: string; onClick?: () => void; icon?: ReactNode };
  secondary?: { label: string; href?: string; onClick?: () => void };
  visual?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-card px-5 py-6 sm:px-7 sm:py-8",
        className,
      )}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 max-w-xl space-y-2">
          <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {title}
          </h2>
          {description ? (
            <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
          {(primary || secondary) && (
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {primary ? (
                primary.href ? (
                  <Button asChild className="h-9 gap-1.5 rounded-lg text-xs">
                    <Link href={primary.href}>
                      {primary.icon}
                      {primary.label}
                    </Link>
                  </Button>
                ) : (
                  <Button className="h-9 gap-1.5 rounded-lg text-xs" onClick={primary.onClick}>
                    {primary.icon}
                    {primary.label}
                  </Button>
                )
              ) : null}
              {secondary ? (
                secondary.href ? (
                  <Button asChild variant="outline" className="h-9 rounded-lg text-xs">
                    <Link href={secondary.href}>{secondary.label}</Link>
                  </Button>
                ) : (
                  <Button variant="outline" className="h-9 rounded-lg text-xs" onClick={secondary.onClick}>
                    {secondary.label}
                  </Button>
                )
              ) : null}
            </div>
          )}
        </div>
        {visual ? <div className="shrink-0 opacity-90">{visual}</div> : null}
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

/** Simple three-bar geometric mark for empty/hero visuals (SnapServe, not Sarvam). */
export function SnapBarsVisual({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex h-16 w-16 flex-col justify-center gap-1.5 rounded-2xl bg-muted/50 p-3", className)}
      aria-hidden
    >
      <span className="h-1.5 w-full rounded-full bg-foreground" />
      <span className="h-1.5 w-[70%] rounded-full bg-foreground/60" />
      <span className="h-1.5 w-[40%] rounded-full bg-foreground/35" />
    </div>
  );
}
