import type { ReactNode } from "react";
import { AppPageHeader } from "@/components/app-page-header";
import { cn } from "@/lib/utils";

/**
 * Shared chrome for Operate pages (Integrations, Channels, Automation):
 * Back · single title · short description · actions, then dense ~1120px content.
 */
export function OperateShell({
  title,
  description,
  back = { href: "/app/home", label: "Back" },
  actions,
  children,
  className,
  contentClassName,
}: {
  title: string;
  description?: string;
  back?: { href: string; label: string };
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <AppPageHeader
        compact
        back={back}
        title={title}
        description={description}
        actions={actions}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn(
            "mx-auto w-full max-w-[1120px] px-5 py-4 sm:px-6 sm:py-5",
            contentClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
