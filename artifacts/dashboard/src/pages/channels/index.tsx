/**
 * Agent channels — deep-link from Connections / Meet (not primary nav).
 */

import { Link, useSearch } from "wouter";
import { Loader2, Plus, Radio } from "lucide-react";
import { getGetAgentQueryKey, useGetAgent } from "@workspace/api-client-react";
import { AgentContextBar, useAgentFromSearch } from "@/components/agent-context-bar";
import { StripePage } from "@/components/stripe-page";
import { Button } from "@/components/ui/button";
import { ChannelsPanel, type ChannelId } from "@/pages/agents/channels-panel";

const CHANNEL_IDS: ChannelId[] = ["phone", "whatsapp", "email", "meetings", "booking"];

function channelFromSearch(search: string): ChannelId {
  const raw = new URLSearchParams(search).get("channel");
  return CHANNEL_IDS.includes(raw as ChannelId) ? (raw as ChannelId) : "phone";
}

export default function ChannelsPage() {
  const search = useSearch();
  const { agents, isLoading, selectedId, selectedAgent, setAgentId } = useAgentFromSearch();
  const initialChannel = channelFromSearch(search);

  const agentQ = useGetAgent(selectedId ?? 0, {
    query: {
      queryKey: getGetAgentQueryKey(selectedId ?? 0),
      enabled: selectedId != null,
      staleTime: 20_000,
    },
  });
  const agent = agentQ.data ?? selectedAgent;

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
        title="Agent channels"
        description="Create an agent first, then attach phone, WhatsApp, email, meetings, and booking."
        back={{ href: "/app/connections", label: "Connections" }}
      >
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Radio className="mb-3 size-5 text-muted-foreground" />
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
      title="Agent channels"
      description={`${agentLabel} · WhatsApp, email, meetings join · workspace wiring under Connections`}
      back={{ href: "/app/connections", label: "Connections" }}
      actions={
        <AgentContextBar agents={agents} selectedId={selectedId} onChange={setAgentId} />
      }
    >
      {agent && (
        <ChannelsPanel agent={agent} initialChannel={initialChannel} embedded />
      )}
    </StripePage>
  );
}
