import React from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/** Compact metric card — Campaign Operations style (no hover lift). */
export function MetricCard({
  label,
  value,
  sub,
  icon,
  accent,
  loading,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon?: React.ReactNode;
  accent?: string;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "h-full bg-card border border-border/60 rounded-xl px-4 py-3.5 flex items-center gap-3 min-w-0",
        className,
      )}
    >
      {icon && (
        <div className="size-8 rounded-lg bg-muted border border-border flex items-center justify-center shrink-0 text-muted-foreground [&_svg]:size-4">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1 flex flex-col justify-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground leading-none mb-1.5 truncate">
          {label}
        </p>
        {loading ? (
          <Skeleton className="h-5 w-10 rounded" />
        ) : (
          <p className={cn("text-xl font-semibold tabular-nums leading-none", accent ?? "text-foreground")}>
            {value}
          </p>
        )}
        {/* Reserve sub line so sibling cards stay the same height */}
        <p className="text-[10px] text-muted-foreground mt-0.5 truncate min-h-[1rem]">
          {!loading && sub ? sub : "\u00a0"}
        </p>
      </div>
    </div>
  );
}

/** Responsive grid wrapper for MetricCard rows. */
export function MetricStrip({
  children,
  cols = 4,
  className,
}: {
  children: React.ReactNode;
  cols?: 2 | 3 | 4 | 5 | 6;
  className?: string;
}) {
  const colClass =
    cols === 2
      ? "grid-cols-2"
      : cols === 3
        ? "grid-cols-2 sm:grid-cols-3"
        : cols === 5
          ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
          : cols === 6
            ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"
            : "grid-cols-2 sm:grid-cols-4";

  return (
    <div className={cn("grid gap-2.5 items-stretch", colClass, className)}>
      {children}
    </div>
  );
}
