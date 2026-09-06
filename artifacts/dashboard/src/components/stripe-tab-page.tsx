/**
 * Shared Stripe-style underline tabs for settings-family pages.
 * Syncs active tab to `?tab=` query param.
 */
import { useLocation, useSearch } from "wouter";
import type { ReactNode } from "react";
import { StripePage } from "@/components/stripe-page";
import { cn } from "@/lib/utils";

export function StripeTabPage({
  title,
  description,
  tabs,
  defaultTab,
  fullBleed = true,
  actions,
  tabActions,
}: {
  title: string;
  description: string;
  tabs: { key: string; label: string; content: ReactNode }[];
  defaultTab: string;
  fullBleed?: boolean;
  actions?: ReactNode;
  /** Right-aligned controls on the tab row (e.g. clone buttons). */
  tabActions?: ReactNode;
}) {
  const [, navigate] = useLocation();
  const search = useSearch();
  const activeKey = new URLSearchParams(search).get("tab") ?? defaultTab;
  const active = tabs.some((t) => t.key === activeKey) ? activeKey : defaultTab;
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0];

  const setTab = (key: string) => {
    const sp = new URLSearchParams(search);
    sp.set("tab", key);
    navigate(`${window.location.pathname}?${sp.toString()}`);
  };

  return (
    <StripePage
      title={title}
      description={description}
      actions={actions}
      fullBleed={fullBleed}
      contentClassName={fullBleed ? "!px-0 !py-0 max-w-none" : undefined}
      tabs={
        <div className="flex items-end justify-between gap-3 -mx-1">
          <div className="flex items-center gap-0 overflow-x-auto min-w-0">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setTab(tab.key)}
                className={cn(
                  "relative shrink-0 px-3 pb-3 text-[13px] font-medium transition-colors whitespace-nowrap",
                  active === tab.key
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground/80",
                )}
              >
                {tab.label}
                {active === tab.key && (
                  <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-foreground" />
                )}
              </button>
            ))}
          </div>
          {tabActions && (
            <div className="flex shrink-0 items-center justify-end gap-2 pb-2 pr-1">
              {tabActions}
            </div>
          )}
        </div>
      }
    >
      {activeTab?.content}
    </StripePage>
  );
}
