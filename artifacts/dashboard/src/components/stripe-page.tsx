import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { ChevronLeft } from "lucide-react";
import { canGoBackInApp } from "@/lib/nav-history";
import { cn } from "@/lib/utils";

/**
 * Canonical Stripe-style full page:
 * single h1 · one-line description · right actions · optional tabs · constrained content.
 * Layout must not render a duplicate page title (utility strip only).
 */
export function StripePage({
  title,
  description,
  back,
  actions,
  tabs,
  children,
  className,
  contentClassName,
  fullBleed = false,
}: {
  title: string;
  description?: string;
  back?: { href: string; label: string };
  actions?: ReactNode;
  /** Optional underline tab row rendered under the header (inside the page). */
  tabs?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  /** Skip max-width for dense tables (Activity, Dial flows, etc.). */
  fullBleed?: boolean;
}) {
  const [, navigate] = useLocation();

  const onBack = () => {
    if (!back) return;
    if (canGoBackInApp()) window.history.back();
    else navigate(back.href);
  };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <header className="shrink-0 border-b border-border px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
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
            <h1 className="text-[24px] font-semibold leading-none tracking-tight text-foreground sm:text-[26px]">
              {title}
            </h1>
            {description && (
              <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {actions && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 pt-0.5">
              {actions}
            </div>
          )}
        </div>
        {tabs && <div className="mt-4 -mb-4">{tabs}</div>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn(
            "mx-auto w-full px-5 py-5 sm:px-6 sm:py-6",
            fullBleed ? "max-w-none" : "max-w-[1200px]",
            contentClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
