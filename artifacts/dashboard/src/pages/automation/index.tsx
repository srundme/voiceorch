/**
 * Automation — lead sources, campaign studios, call rules, and after-call journeys.
 */

import { useLocation } from "wouter";
import { Loader2, Plus, Workflow } from "lucide-react";
import { getGetAgentQueryKey, useGetAgent } from "@workspace/api-client-react";
import { AgentContextBar, useAgentFromSearch } from "@/components/agent-context-bar";
import { StripePage } from "@/components/stripe-page";
import { EmptyState } from "@/components/empty-state";
import { SequenceRulesPanel } from "./sequence-rules-panel";

export default function AutomationPage() {
  const [, navigate] = useLocation();
  const { agents, isLoading, selectedId, selectedAgent, setAgentId } = useAgentFromSearch();

  const agentQ = useGetAgent(selectedId ?? 0, {
    query: {
      queryKey: getGetAgentQueryKey(selectedId ?? 0),
      enabled: selectedId != null,
      staleTime: 20_000,
    },
  });
  const agent = agentQ.data ?? selectedAgent;
  const webhookUrl =
    agent && typeof (agent as { webhookUrl?: string }).webhookUrl === "string"
      ? (agent as { webhookUrl?: string }).webhookUrl
      : null;

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <StripePage
        title="Automation"
        description="Connect forms, spreadsheets, and call rules once you have an agent."
      >
        <div className="flex min-h-[50vh] items-center justify-center">
          <EmptyState
            variant="hero"
            icon={<Workflow />}
            title="Create an agent first"
            description="Automation runs on top of an agent — build one, then connect lead sources and call sequences."
            action={{
              label: "Create agent",
              onClick: () => navigate("/app/vibe"),
              icon: <Plus className="w-3.5 h-3.5" />,
            }}
          />
        </div>
      </StripePage>
    );
  }

  const agentLabel = agent?.name || (selectedId != null ? `Agent ${selectedId}` : "Agent");

  return (
    <StripePage
      title="Automation"
      description={`Sources and sequences for ${agentLabel}.`}
      actions={
        <AgentContextBar agents={agents} selectedId={selectedId} onChange={setAgentId} />
      }
    >
      {selectedId != null && (
        <div className="mt-4">
          <SequenceRulesPanel agents={agents} agentId={selectedId} agentName={agent?.name} />
        </div>
      )}
    </StripePage>
  );
}
