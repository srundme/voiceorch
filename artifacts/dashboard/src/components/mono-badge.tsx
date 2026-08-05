/**
 * Greyscale status chips — SnapServe chrome stays mono (logo is black/grey).
 * Prefer these over emerald/sky/amber pills in product UI.
 */

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Filled chip — primary states (Confirmed, Synced, Ready). */
export const MONO_BADGE =
  "bg-muted text-foreground border-border hover:bg-muted capitalize font-medium";

/** Outline chip — secondary / empty states (No calendar, Web). */
export const MONO_BADGE_OUTLINE =
  "bg-transparent text-muted-foreground border-border hover:bg-muted/40 capitalize font-medium";

export function MonoBadge({
  children,
  className,
  outline = false,
  size = "sm",
}: {
  children: React.ReactNode;
  className?: string;
  outline?: boolean;
  size?: "sm" | "xs";
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        outline ? MONO_BADGE_OUTLINE : MONO_BADGE,
        size === "xs" ? "text-[10px] px-1.5 py-0 h-5" : "text-xs",
        className,
      )}
    >
      {children}
    </Badge>
  );
}

export function titleCaseStatus(status: string): string {
  if (!status) return status;
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
