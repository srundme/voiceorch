/**
 * /app/phone-numbers — My numbers | Buy | Verification
 */
import { useLocation, useSearch } from "wouter";
import { StripePage } from "@/components/stripe-page";
import { cn } from "@/lib/utils";
import PhoneNumbersPage from "@/pages/phone-numbers";
import KycPage from "@/pages/kyc";

const TABS = [
  { key: "my-numbers", label: "My numbers" },
  { key: "buy-number", label: "Buy number" },
  { key: "verification", label: "Verification" },
] as const;

export default function PhoneNumbersTabPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const activeKey = new URLSearchParams(search).get("tab") ?? "my-numbers";
  const active = TABS.some((t) => t.key === activeKey) ? activeKey : "my-numbers";

  const setTab = (key: string) => {
    const sp = new URLSearchParams(search);
    sp.set("tab", key);
    navigate(`${window.location.pathname}?${sp.toString()}`);
  };

  return (
    <StripePage
      title="Phone Numbers"
      description="Buy numbers and assign them on Agents → Overview."
      back={{ href: "/app/agents", label: "Agents" }}
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
      {(active === "my-numbers" || active === "buy-number") && <PhoneNumbersPage />}
      {active === "verification" && <KycPage />}
    </StripePage>
  );
}
