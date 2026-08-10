/**
 * /app/agents — agent list + builder (AgentBuilder).
 *
 * Squads live at /app/squads. Partner-managed clients get the full builder
 * (same as real users); phone numbers remain partner-owned elsewhere.
 */
import AgentBuilder from "./builder";

export default function AgentsTabPage() {
  return <AgentBuilder />;
}

/** Same entry for /app/agents/:id deep links. */
export function AgentBuilderPage() {
  return <AgentBuilder />;
}
