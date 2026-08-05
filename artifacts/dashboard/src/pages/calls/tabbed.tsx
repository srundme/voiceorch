/**
 * /app/history (and legacy /app/calls) — what happened.
 */
import { useLocation, useSearch } from "wouter";
import { StripePage } from "@/components/stripe-page";
import { cn } from "@/lib/utils";
import CallsList from "./index";
import CallbacksPage from "@/pages/callbacks";
import TransfersPage from "@/pages/transfers";

const TABS = [
  { key: "all-calls", label: "Calls" },
  { key: "callbacks", label: "Callbacks" },
  { key: "transfers", label: "Transfers" },
] as const;

export default function CallsTabPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const activeKey = new URLSearchParams(search).get("tab") ?? "all-calls";
  const active = TABS.some((t) => t.key === activeKey) ? activeKey : "all-calls";

  const setTab = (key: string) => {
    const sp = new URLSearchParams(search);
    sp.set("tab", key);
    navigate(`${window.location.pathname}?${sp.toString()}`);
  };

  return (
    <StripePage
      title="History"
      description="Calls, callbacks, and transfers — what happened for each person."
      back={{ href: "/app/home", label: "Home" }}
      fullBleed
      contentClassName="!px-0 !py-0 max-w-none"
      tabs={
        <div className="flex items-center gap-0 -mx-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setTab(tab.key)}
              className={cn(
                "relative px-3 pb-3 text-[13px] font-medium transition-colors whitespace-nowrap",
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
      }
    >
      {active === "all-calls" && <CallsList />}
      {active === "callbacks" && <CallbacksPage />}
      {active === "transfers" && <TransfersPage />}
    </StripePage>
  );
}
