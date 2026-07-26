import { useLocation, useSearch } from "wouter";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";

export interface TabDef {
  key: string;
  label: string;
  content: ReactNode;
  badge?: number;
}

interface PageTabsProps {
  tabs: TabDef[];
  defaultTab?: string;
}

/**
 * Underline-style tab bar that syncs active tab to ?tab= query param.
 * Only renders the active tab's content (no data fetched for hidden tabs).
 */
export function PageTabs({ tabs, defaultTab }: PageTabsProps) {
  const [, navigate] = useLocation();
  // useSearch() is reactive to query-string changes (unlike window.location.search)
  const search = useSearch();

  const activeKey =
    new URLSearchParams(search).get("tab") ??
    defaultTab ??
    tabs[0]?.key ??
    "";

  const activeTab = tabs.find((t) => t.key === activeKey) ?? tabs[0];

  const setTab = (key: string) => {
    const sp = new URLSearchParams(search);
    sp.set("tab", key);
    navigate(`${window.location.pathname}?${sp.toString()}`);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar — sticky so it stays visible while page content scrolls */}
      <div className="shrink-0 border-b border-border bg-background sticky top-0 z-10 flex items-center gap-0 px-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setTab(tab.key)}
            className={cn(
              "relative flex items-center gap-1.5 px-3 py-3 text-[13px] font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
              activeTab?.key === tab.key
                ? "text-foreground border-foreground"
                : "text-muted-foreground border-transparent hover:text-foreground/80"
            )}
          >
            {tab.label}
            {tab.badge != null && tab.badge > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500/20 text-amber-500 text-[10px] font-semibold leading-none">
                {tab.badge > 99 ? "99+" : tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Active tab content only — inactive tabs are not mounted */}
      <div className="flex-1 min-h-0">
        {activeTab && activeTab.content}
      </div>
    </div>
  );
}
