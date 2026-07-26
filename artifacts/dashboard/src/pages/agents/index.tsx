/**
 * /app/agents — tabbed page
 * Tabs: All agents (the existing AgentBuilder list) | Squads
 *
 * Note: /app/agents/:id continues to route directly to AgentBuilder (no tabs).
 */
import { PageTabs } from "@/components/page-tabs";
import AgentBuilder from "./builder";
import SquadsPage from "@/pages/squads/index";

export default function AgentsTabPage() {
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
