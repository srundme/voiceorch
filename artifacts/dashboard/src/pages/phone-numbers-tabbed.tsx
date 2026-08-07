/**
 * /app/phone-numbers
 *   • Normal users / partners (own account) — My numbers | Verification + Get number
 *   • Partner-client workspaces (incl. acting-as) — assign / reassign only
 */
import { useLocation, useSearch } from "wouter";
import { Plus } from "lucide-react";
import { StripePage } from "@/components/stripe-page";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePartnerManagedWorkspace } from "@/hooks/use-partner";
import PhoneNumbersPage from "@/pages/phone-numbers";
import KycPage from "@/pages/kyc";

const OWNER_TABS = [
  { key: "my-numbers", label: "My numbers" },
  { key: "verification", label: "Verification" },
] as const;

export default function PhoneNumbersTabPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { isManagedWorkspace } = usePartnerManagedWorkspace();
  const tabs = isManagedWorkspace ? null : OWNER_TABS;

  const rawTab = new URLSearchParams(search).get("tab") ?? "my-numbers";
  // Legacy ?tab=buy-number → open purchase on the list page
  const buyIntent = !isManagedWorkspace && rawTab === "buy-number";
  const activeKey = buyIntent ? "my-numbers" : rawTab;
  const active = tabs?.some((t) => t.key === activeKey) ? activeKey : "my-numbers";

  const setTab = (key: string) => {
    const sp = new URLSearchParams(search);
    if (key === "my-numbers") sp.delete("tab");
    else sp.set("tab", key);
    const q = sp.toString();
    navigate(q ? `${window.location.pathname}?${q}` : window.location.pathname);
  };

  return (
    <StripePage
      title="Phone Numbers"
      description={
        isManagedWorkspace
          ? "Assign provider numbers to your agents, move them between agents, or remove a line."
          : "Buy a number, assign it to an agent for inbound + caller ID, reassign or release anytime."
      }
      back={{ href: "/app/connections", label: "Connections" }}
      actions={
        !isManagedWorkspace ? (
          <Button
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => {
              const sp = new URLSearchParams(search);
              sp.set("tab", "buy-number");
              navigate(`${window.location.pathname}?${sp.toString()}`);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Get number
          </Button>
        ) : undefined
      }
      fullBleed
      contentClassName="!px-0 !py-0 max-w-none"
      tabs={
        tabs ? (
          <div className="flex items-center gap-0 -mx-1">
            {tabs.map((tab) => (
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
        ) : undefined
      }
    >
      {(active === "my-numbers" || buyIntent) && (
        <PhoneNumbersPage
          autoOpenBuy={buyIntent}
          onBuyClosed={() => setTab("my-numbers")}
        />
      )}
      {active === "verification" && !isManagedWorkspace && <KycPage />}
    </StripePage>
  );
}
