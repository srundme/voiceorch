import React from "react";
import { cn } from "@/lib/utils";

/**
 * Canonical in-app page header matching Campaign Operations style:
 * eyebrow + title + muted description + optional right actions.
 * Use this instead of one-off h1 stacks so ops pages feel one product.
 */
export function AppPageHeader({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
  compact = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Optional content below the title row (filters, metric strip, etc.) */
  children?: React.ReactNode;
  className?: string;
  /** Tighter padding when nested under a sub-nav (e.g. Scheduling tabs) */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "border-b border-border shrink-0",
        compact ? "px-6 pt-5 pb-4" : "px-6 pt-6 pb-5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/45 mb-1.5">
              {eyebrow}
            </p>
          )}
          <h1 className="text-2xl font-semibold tracking-tight text-foreground leading-none">
            {title}
          </h1>
          {description && (
            <p className="text-xs text-muted-foreground/55 mt-1.5 leading-relaxed max-w-2xl">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0 pt-0.5">{actions}</div>
        )}
      </div>
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
