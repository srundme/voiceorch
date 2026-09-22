import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Canonical Stripe-style full page:
 * single h1 · one-line description · right actions · optional tabs · constrained content.
 * Layout must not render a duplicate page title (utility strip only).
 *
 * Scroll model:
 * - Default: grow with content; the Layout shell scrolls (no nested overflow trap).
 * - lockScroll: fill the viewport and scroll inside the body (tables / split panes).
 *
 * Back always navigates to `back.href` so the label matches the destination.
 * (history.back() previously skipped parent hubs after Connections setup used
 * replace — Agents → Connections → WhatsApp → Back landed on Agents.)
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
  lockScroll = false,
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
  /** Pin page chrome and let children manage their own vertical scroll. */
  lockScroll?: boolean;
}) {
  const [, navigate] = useLocation();

  const onBack = () => {
    if (!back) return;
    navigate(back.href);
  };

  return (
    <div
      className={cn(
        "flex w-full flex-col",
        lockScroll ? "h-full min-h-0 flex-1 overflow-hidden" : "min-h-0",
        className,
      )}
    >
      <header className="shrink-0 border-b border-border px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
        {back && (
          <button
            type="button"
            onClick={onBack}
            className="mb-3 inline-flex items-center gap-1 rounded-md text-[12px] font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
      <div
        className={cn(
          lockScroll ? "min-h-0 flex-1 overflow-y-auto overscroll-y-contain" : undefined,
        )}
      >
        <div
          className={cn(
            "mx-auto w-full px-5 py-5 sm:px-6 sm:py-6",
            // Extra bottom pad so the last block clears mobile bottom nav / safe area
            !lockScroll && "pb-10 sm:pb-8",
            fullBleed ? "max-w-none" : "max-w-[1200px]",
            lockScroll && "flex min-h-0 flex-1 flex-col",
            contentClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
