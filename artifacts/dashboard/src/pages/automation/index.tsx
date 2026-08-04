/**
 * Automation — lead sources, campaign studios, call rules, and after-call journeys.
 */

import { Link, useLocation } from "wouter";
import { Loader2, Plus, Workflow } from "lucide-react";
import { getGetAgentQueryKey, useGetAgent } from "@workspace/api-client-react";
import { AgentContextBar, useAgentFromSearch } from "@/components/agent-context-bar";
import { StripePage } from "@/components/stripe-page";
import { Button } from "@/components/ui/button";
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
        description="Create an agent first, then wire forms, sheets, lists, call rules, and journeys."
      >
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Workflow className="mb-3 size-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No agents yet.</p>
          <Button asChild className="mt-5 gap-1.5">
            <Link href="/app/agents?create=1">
              <Plus className="size-4" />
              Create agent
            </Link>
          </Button>
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
          <SequenceRulesPanel agentId={selectedId} agentName={agent?.name} />
        </div>
      )}
    </StripePage>
  );
}
