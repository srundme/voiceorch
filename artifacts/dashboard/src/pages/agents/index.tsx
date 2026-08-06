/**
 * /app/agents — agent list + builder (AgentBuilder).
 *
 * Squads live at /app/squads (under More in Phase 1 shell; later Agents sub-nav).
 * Note: /app/agents/:id continues to route directly to AgentBuilder.
 *
 * Special cases:
 *  - Partner acting-as a client: full builder on the client's account.
 *  - Managed client without canEditAgents: read-only ClientAgentsView.
 *  - Managed client with canEditAgents (partner toggle): full builder.
 */
import AgentBuilder from "./builder";
import ClientAgentsView from "./client-view";
import { usePartnerContext } from "@/hooks/use-partner";
import { loadActingAs } from "@/lib/acting-as";

function useManagedAgentGate(): "loading" | "readonly" | "builder" {
  const { data: partnerCtx, isLoading } = usePartnerContext();
  if (loadActingAs()) return "builder";
  if (isLoading) return "loading";
  if (partnerCtx?.isManagedClient && !partnerCtx.canEditAgents) return "readonly";
  return "builder";
}

export default function AgentsTabPage() {
  const gate = useManagedAgentGate();
  if (gate === "loading") return null;
  if (gate === "readonly") return <ClientAgentsView />;
  return <AgentBuilder />;
}

/** Same gate for /app/agents/:id deep links. */
export function AgentBuilderPage() {
  const gate = useManagedAgentGate();
  if (gate === "loading") return null;
  if (gate === "readonly") return <ClientAgentsView />;
  return <AgentBuilder />;
}
