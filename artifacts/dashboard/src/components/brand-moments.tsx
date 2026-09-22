import type { ReactNode } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SnapServeIcon } from "@/components/logo";

/**
 * World-class brand moments — Sarvam-grade restraint, SnapServe identity.
 * Ghost mark for empty/idle; MomentCard for billing / next-action art (accents OK).
 */

/** Large three-bar silhouette — almost no ink, calm empty/hero art. */
export function GhostBars({
  size = 120,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("pointer-events-none select-none text-foreground/[0.07] dark:text-foreground/[0.12]", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <SnapServeIcon size={size} className="size-full" />
    </div>
  );
}

/** Soft listening/speaking bars for live or “ready” moments. */
export function PulseBars({
  className,
  active = false,
}: {
  className?: string;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-14 w-14 flex-col justify-center gap-1.5 rounded-2xl border border-border/60 bg-card/80 p-3",
        className,
      )}
      aria-hidden
    >
      <span
        className={cn(
          "h-1.5 w-full rounded-full bg-foreground transition-opacity",
          active && "animate-pulse",
        )}
      />
      <span className="h-1.5 w-[70%] rounded-full bg-foreground/55" />
      <span className="h-1.5 w-[40%] rounded-full bg-foreground/30" />
    </div>
  );
}

/**
 * Premium art CTA — one line + one pill. Soft brand wash (billing / marketing moments only).
 * Inspired by Sarvam “Upgrade for higher rate limits” card.
 */
export function MomentCard({
  title,
  description,
  action,
  href,
  onClick,
  className,
  tone = "brand",
}: {
  title: string;
  description?: string;
  action: string;
  href?: string;
  onClick?: () => void;
  className?: string;
  /** brand = saffron→teal wash; ink = paper + ink only */
  tone?: "brand" | "ink";
}) {
  const cta = (
    <span className="inline-flex h-9 min-w-[7.5rem] items-center justify-center rounded-full bg-white px-5 text-[13px] font-medium text-foreground shadow-sm transition-transform duration-200 group-hover:scale-[1.02]">
      {action}
    </span>
  );

  const body = (
    <>
      <div className="relative z-[1] max-w-[16rem]">
        <p
          className={cn(
            "text-[17px] font-semibold leading-snug tracking-[-0.03em]",
            tone === "brand" ? "text-white" : "text-foreground",
          )}
        >
          {title}
        </p>
        {description ? (
          <p
            className={cn(
              "mt-1.5 text-[12px] leading-relaxed",
              tone === "brand" ? "text-white/80" : "text-muted-foreground",
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      <div className="relative z-[1] pt-5">{cta}</div>
    </>
  );

  const shell = cn(
    "group relative flex min-h-[148px] flex-col justify-between overflow-hidden rounded-2xl border p-5 text-left transition-shadow duration-200",
    tone === "brand"
      ? "border-white/20 shadow-sm hover:shadow-md"
      : "border-border bg-card hover:border-foreground/20",
    className,
  );

  const wash =
    tone === "brand" ? (
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 100% at 0% 0%, #6366f1 0%, transparent 45%), radial-gradient(100% 120% at 100% 20%, #ff9933 0%, transparent 50%), radial-gradient(90% 100% at 60% 100%, #14b8a6 0%, transparent 55%), linear-gradient(145deg, #1e293b 0%, #0f172a 100%)",
        }}
        aria-hidden
      />
    ) : (
      <GhostBars size={140} className="absolute -bottom-6 -right-4 opacity-100" />
    );

  if (href) {
    return (
      <Link href={href} className={shell}>
        {wash}
        {body}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={shell}>
      {wash}
      {body}
    </button>
  );
}

/** Centered empty with ghost mark — world-class idle state. */
export function GhostEmpty({
  title,
  description,
  primary,
  secondary,
  className,
  children,
}: {
  title: string;
  description?: string;
  primary?: { label: string; href?: string; onClick?: () => void; icon?: ReactNode };
  secondary?: { label: string; href?: string; onClick?: () => void };
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center overflow-hidden px-6 py-16 text-center sm:py-20",
        className,
      )}
    >
      <GhostBars size={160} className="mb-8" />
      <h2 className="max-w-md text-[22px] font-semibold tracking-[-0.04em] text-foreground sm:text-[26px]">
        {title}
      </h2>
      {description ? (
        <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {children}
      {(primary || secondary) && (
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
          {primary ? (
            primary.href ? (
              <Button asChild className="h-10 gap-1.5 rounded-full px-5 text-[13px]">
                <Link href={primary.href}>
                  {primary.icon}
                  {primary.label}
                </Link>
              </Button>
            ) : (
              <Button className="h-10 gap-1.5 rounded-full px-5 text-[13px]" onClick={primary.onClick}>
                {primary.icon}
                {primary.label}
              </Button>
            )
          ) : null}
          {secondary ? (
            secondary.href ? (
              <Button asChild variant="ghost" className="h-10 rounded-full px-4 text-[13px] text-muted-foreground">
                <Link href={secondary.href}>{secondary.label}</Link>
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="h-10 rounded-full px-4 text-[13px] text-muted-foreground"
                onClick={secondary.onClick}
              >
                {secondary.label}
              </Button>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}
