/**
 * /app/agents — agent list (AgentBuilder)
 *
 * Squads live at /app/squads (own sidebar entry).
 * Note: /app/agents/:id continues to route directly to AgentBuilder.
 *
 * Special cases:
 *  - Partner acting-as a client (Partner Hub → client → Configure): full
 *    builder operating on the client's account.
 *  - Managed client (account run by a partner): read-only ClientAgentsView.
 */
import AgentBuilder from "./builder";
import ClientAgentsView from "./client-view";
import { usePartnerContext } from "@/hooks/use-partner";
import { loadActingAs } from "@/lib/acting-as";

export default function AgentsTabPage() {
  const { data: partnerCtx, isLoading } = usePartnerContext();

  // Partner managing a client's account — straight to the builder.
  if (loadActingAs()) return <AgentBuilder />;

  // Brief window on hard refresh before the context loads: render nothing
  // rather than flashing the full builder at a managed client.
  if (isLoading) return null;

  if (partnerCtx?.isManagedClient) return <ClientAgentsView />;

  return <AgentBuilder />;
}
