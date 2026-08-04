/**
 * /app/campaigns — Campaign Studios (account-wide)
 * Tabs: List dials | Sheet dial | From Website
 *
 * Prefer Agent → Reach for new setups. Deep-link routes like /app/campaigns/:id
 * are handled separately in App.tsx and do NOT use this tabbed wrapper.
 */
import { useLocation, useSearch } from "wouter";
import { StripePage } from "@/components/stripe-page";
import { cn } from "@/lib/utils";
import CampaignsPage from "./index";
import AutomaticCallsPage from "@/pages/automatic-calls/index";
import FromWebsitePage from "./from-website";

const TABS = [
  { key: "active", label: "From list" },
  { key: "scheduled", label: "From spreadsheet" },
  { key: "lead-sources", label: "From website" },
] as const;

export default function CampaignsTabPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const activeKey = new URLSearchParams(search).get("tab") ?? "active";
  const active = TABS.some((t) => t.key === activeKey) ? activeKey : "active";

  const setTab = (key: string) => {
    const sp = new URLSearchParams(search);
    sp.set("tab", key);
    navigate(`${window.location.pathname}?${sp.toString()}`);
  };

  return (
    <StripePage
      title="Campaigns"
      description="Run outbound calling from lists, spreadsheets, or website leads."
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
      {active === "active" && <CampaignsPage />}
      {active === "scheduled" && <AutomaticCallsPage />}
      {active === "lead-sources" && <FromWebsitePage />}
    </StripePage>
  );
}
