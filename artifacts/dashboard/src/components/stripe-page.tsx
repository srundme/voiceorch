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
  /** Skip max-width for dense tables (Activity, Campaign Studios, etc.). */
  fullBleed?: boolean;
}) {
  const [, navigate] = useLocation();

  const onBack = () => {
    if (!back) return;
    if (canGoBackInApp()) window.history.back();
    else navigate(back.href);
  };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col bg-background/50", className)}>
      <header className="shrink-0 border-b border-border/60 bg-card/40 backdrop-blur-md px-6 py-5 sm:px-8 sm:py-6 relative">
        {/* Subtle top accent line */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary/40 via-primary/10 to-transparent" />

        {back && (
          <button
            type="button"
            onClick={onBack}
            className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground/70 transition-all hover:text-foreground hover:translate-x-[-2px] group"
          >
            <ChevronLeft className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            {back.label}
          </button>
        )}
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold leading-tight tracking-tight text-foreground sm:text-3xl">
              {title}
            </h1>
            {description && (
              <p className="mt-1.5 max-w-3xl text-xs sm:text-sm leading-relaxed text-muted-foreground/80 font-normal">
                {description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2.5 pt-0.5 empty:hidden">
            {actions}
            <div id="stripe-page-actions" className="contents" />
          </div>
        </div>
        {tabs && <div className="mt-5 -mb-5">{tabs}</div>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn(
            "mx-auto w-full px-6 py-6 sm:px-8 sm:py-8 space-y-6",
            fullBleed ? "max-w-none" : "max-w-[1280px]",
            contentClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
