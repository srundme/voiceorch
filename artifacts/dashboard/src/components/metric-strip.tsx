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
        "bg-card border border-border/80 rounded-xl px-4 py-3.5 flex items-center gap-3.5 min-w-0 shadow-sm hover:shadow-md transition-shadow",
        className,
      )}
    >
      {icon && (
        <div className="h-9 w-9 rounded-xl bg-muted/60 border border-border/50 flex items-center justify-center shrink-0 [&_svg]:h-4 [&_svg]:w-4">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/50 leading-none mb-1.5 truncate">
          {label}
        </p>
        {loading ? (
          <Skeleton className="h-6 w-12 rounded-md" />
        ) : (
          <p className={cn("text-2xl font-bold tabular-nums leading-none tracking-tight", accent ?? "text-foreground")}>
            {value}
          </p>
        )}
        {sub && !loading && (
          <p className="text-[10px] font-medium text-muted-foreground/60 mt-1 truncate">{sub}</p>
        )}
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
    <div className={cn("grid gap-2.5", colClass, className)}>
      {children}
    </div>
  );
}
