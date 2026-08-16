import React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Shared empty state for ops / list pages.
 * - hero: full-width guided empty (no data yet)
 * - panel: bordered card empty (section inside a page)
 * - inline: compact centered empty inside a table/list
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  variant = "panel",
  className,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void; icon?: React.ReactNode };
  secondaryAction?: { label: string; onClick: () => void };
  variant?: "hero" | "panel" | "inline";
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        variant === "hero" && "py-16 px-6",
        variant === "panel" && "rounded-xl border border-border/50 bg-card/30 py-12 px-6",
        variant === "inline" && "py-14 px-4",
        className,
      )}
    >
      {icon && (
        <div className="mb-4 h-12 w-12 rounded-2xl border border-border/50 bg-muted/40 flex items-center justify-center text-muted-foreground [&_svg]:h-5 [&_svg]:w-5" aria-hidden="true">
          {icon}
        </div>
      )}
      <h2 className="text-sm font-semibold text-foreground tracking-tight">{title}</h2>
      {description && (
        <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed max-w-md">
          {description}
        </p>
      )}
      {children && <div className="mt-5 w-full max-w-lg">{children}</div>}
      {(action || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action && (
            <Button size="sm" className="h-8 text-xs gap-1.5 rounded-lg" onClick={action.onClick}>
              {action.icon}
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5 rounded-lg"
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
