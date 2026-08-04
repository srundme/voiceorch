/**
 * Channels — how an agent communicates (phone, WhatsApp, email, meetings, booking).
 */

import { useLocation, useSearch } from "wouter";
import { Loader2, Plus, Radio } from "lucide-react";
import { getGetAgentQueryKey, useGetAgent } from "@workspace/api-client-react";
import { AgentContextBar, useAgentFromSearch } from "@/components/agent-context-bar";
import { StripePage } from "@/components/stripe-page";
import { EmptyState } from "@/components/empty-state";
import { ChannelsPanel, type ChannelId } from "@/pages/agents/channels-panel";

const CHANNEL_IDS: ChannelId[] = ["phone", "whatsapp", "email", "meetings", "booking"];

function channelFromSearch(search: string): ChannelId {
  const raw = new URLSearchParams(search).get("channel");
  return CHANNEL_IDS.includes(raw as ChannelId) ? (raw as ChannelId) : "phone";
}

export default function ChannelsPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
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
        title="Channels"
        description="Phone, WhatsApp, email, meetings, and booking — all in one place."
      >
        <div className="flex min-h-[50vh] items-center justify-center">
          <EmptyState
            variant="hero"
            icon={<Radio />}
            title="Create an agent first"
            description="Channels belong to an agent. Build one, then connect how customers reach you."
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
      title="Channels"
      description={`${agentLabel} · phone, WhatsApp, email, meetings, booking`}
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
