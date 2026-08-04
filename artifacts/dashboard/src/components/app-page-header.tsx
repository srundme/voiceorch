import React from "react";
import { useLocation } from "wouter";
import { ChevronLeft } from "lucide-react";
import { canGoBackInApp } from "@/lib/nav-history";
import { cn } from "@/lib/utils";

/**
 * Page header — prefer StripePage for full screens.
 * Kept for tabbed pages and legacy surfaces that need a header block only.
 */
export function AppPageHeader({
  back,
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
  compact = false,
}: {
  /** Prefer in-app history.back(); otherwise navigate to href. */
  back?: { href: string; label: string };
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const [, navigate] = useLocation();

  const onBack = () => {
    if (!back) return;
    if (canGoBackInApp()) window.history.back();
    else navigate(back.href);
  };

  return (
    <div
      className={cn(
        "shrink-0 border-b border-border",
        compact ? "px-5 pb-4 pt-4 sm:px-6" : "px-5 pb-5 pt-5 sm:px-6 sm:pt-6",
        className,
      )}
    >
      {back && (
        <button
          type="button"
          onClick={onBack}
          className="mb-3 inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          {back.label}
        </button>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/45">
              {eyebrow}
            </p>
          )}
          <h1 className="text-[22px] font-semibold leading-none tracking-tight text-foreground sm:text-2xl">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2 pt-0.5">{actions}</div>
        )}
      </div>
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
