/**
 * /app/calls — Activity (calls, callbacks, transfers)
 */
import { useLocation, useSearch } from "wouter";
import { StripePage } from "@/components/stripe-page";
import { cn } from "@/lib/utils";
import CallsList from "./index";
import CallbacksPage from "@/pages/callbacks";
import TransfersPage from "@/pages/transfers";
import { SequenceRulesPanel } from "@/pages/automation/sequence-rules-panel";
import { useAgentFromSearch } from "@/components/agent-context-bar";

const TABS = [
  { key: "all-calls", label: "All calls" },
  { key: "callbacks", label: "Callbacks" },
  { key: "transfers", label: "Transfers" },
  { key: "automations", label: "Automations & Meet" },
] as const;

export default function CallsTabPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { agents, selectedId } = useAgentFromSearch();
  const activeKey =
    new URLSearchParams(search).get("tab") ?? "all-calls";
  const active = TABS.some((t) => t.key === activeKey) ? activeKey : "all-calls";

  const setTab = (key: string) => {
    const sp = new URLSearchParams(search);
    sp.set("tab", key);
    navigate(`${window.location.pathname}?${sp.toString()}`);
  };

  const defaultAgentId = selectedId ?? agents[0]?.id ?? 1;

  return (
    <StripePage
      title="Activity"
      description="Calls, callbacks, transfers, and automations across your agents."
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
      {active === "automations" && (
        <div className="p-6">
          <SequenceRulesPanel agents={agents} agentId={defaultAgentId} />
        </div>
      )}
    </StripePage>
  );
}
