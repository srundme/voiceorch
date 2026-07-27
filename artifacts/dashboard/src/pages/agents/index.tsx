/**
 * /app/agents — tabbed page
 * Tabs: All agents (the existing AgentBuilder list) | Squads
 *
 * Note: /app/agents/:id continues to route directly to AgentBuilder (no tabs).
 *
 * Special cases:
 *  - Partner acting-as a client (Partner Hub → client → Agents): full builder,
 *    Squads hidden (squad routes are not part of the managed-client surface).
 *  - Managed client (account run by a partner): read-only ClientAgentsView.
 */
import { PageTabs } from "@/components/page-tabs";
import AgentBuilder from "./builder";
import SquadsPage from "@/pages/squads/index";
import ClientAgentsView from "./client-view";
import { usePartnerContext } from "@/hooks/use-partner";
import { loadActingAs } from "@/lib/acting-as";

export default function AgentsTabPage() {
  const { data: partnerCtx, isLoading } = usePartnerContext();

  // Partner managing a client's account — builder only, no Squads tab.
  if (loadActingAs()) return <AgentBuilder />;

  // Brief window on hard refresh before the context loads: render nothing
  // rather than flashing the full builder at a managed client.
  if (isLoading) return null;

  if (partnerCtx?.isManagedClient) return <ClientAgentsView />;

  return (
    <PageTabs
      defaultTab="all-agents"
      tabs={[
        {
          key: "all-agents",
          label: "All agents",
          content: <AgentBuilder />,
        },
        {
          key: "squads",
          label: "Squads",
          content: <SquadsPage />,
        },
      ]}
    />
  );
}
