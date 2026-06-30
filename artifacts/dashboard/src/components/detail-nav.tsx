import { useLocation } from "wouter";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { canGoBackInApp } from "@/lib/nav-history";

export interface Crumb {
  label: string;
  /** Parent link target. Omit for the current (last) crumb. */
  href?: string;
}

interface DetailNavProps {
  /**
   * Explicit parent target used when there is no in-app history to pop
   * (deep link / fresh load). Falls back to the first crumb's href, then "/app".
   */
  backTo?: string;
  /** Tooltip / aria label for the back button, e.g. "Back to Calls". */
  backLabel?: string;
  /** Breadcrumb trail. The last entry renders as the current page (no link). */
  crumbs?: Crumb[];
  /**
   * Optional custom back handler. When provided it is used instead of the
   * default explicit-target navigation in the no-history case (e.g. clearing a
   * selection inside a master-detail view). `window.history.back()` is still
   * preferred when in-app history exists.
   */
  onBack?: () => void;
  /**
   * Force `onBack` to take priority over `window.history.back()` even when
   * in-app history exists. Used by overlay/drawer surfaces where "back" should
   * dismiss the overlay (e.g. close a drawer) rather than pop the page route.
   */
  preferOnBack?: boolean;
  className?: string;
}

/**
 * Shared back / breadcrumb control for every detail surface in the dashboard.
 *
 * Renders a consistent "← Back" icon button plus an optional breadcrumb trail.
 * The back button prefers `window.history.back()` when the user reached this
 * page via in-app navigation (so the parent list's URL query params and scroll
 * position are restored by the browser), and falls back to an explicit parent
 * target otherwise.
 */
export function DetailNav({ backTo, backLabel, crumbs, onBack, preferOnBack, className }: DetailNavProps) {
  const [, navigate] = useLocation();

  const fallbackHref =
    backTo ?? crumbs?.find((c) => c.href)?.href ?? "/app";
  const label = backLabel ?? "Back";

  const handleBack = () => {
    if (preferOnBack && onBack) {
      onBack();
      return;
    }
    if (canGoBackInApp()) {
      window.history.back();
      return;
    }
    if (onBack) {
      onBack();
      return;
    }
    navigate(fallbackHref);
  };

  return (
    <div className={cn("flex items-center gap-2 min-w-0", className)}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={handleBack}
        aria-label={label}
        title={label}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>

      {crumbs && crumbs.length > 0 && (
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1.5 text-xs min-w-0 overflow-hidden"
        >
          {crumbs.map((crumb, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <span key={`${crumb.label}-${i}`} className="flex items-center gap-1.5 min-w-0">
                {i > 0 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground/30 shrink-0" />
                )}
                {crumb.href && !isLast ? (
                  <button
                    type="button"
                    onClick={() => navigate(crumb.href!)}
                    className="text-muted-foreground/60 hover:text-foreground transition-colors truncate"
                  >
                    {crumb.label}
                  </button>
                ) : (
                  <span
                    className={cn(
                      "truncate",
                      isLast ? "text-foreground font-medium" : "text-muted-foreground/60",
                    )}
                  >
                    {crumb.label}
                  </span>
                )}
              </span>
            );
          })}
        </nav>
      )}
    </div>
  );
}
