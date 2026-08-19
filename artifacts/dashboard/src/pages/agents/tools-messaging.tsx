/**
 * WhatsApp + Email setup that lives inside Agent Builder (Actions tab).
 * Connect, pick templates, and test without leaving the agent.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { EmailChannelCard } from "./email-channel-card";
import WhatsAppPage from "@/pages/whatsapp";
import {
  AgentWhatsappTemplatePicks,
  type AgentWaTemplates,
  type WaCatalogEntry,
} from "@/components/whatsapp/agent-template-picks";

const _DASH_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DASH_API = `${_DASH_BASE}/api`;

type BuilderWhatsappChannel = {
  active: boolean;
  status?: string | null;
  businessName?: string | null;
  mode?: string | null;
  phoneE164?: string | null;
  templateCatalog?: WaCatalogEntry[];
};

type BuilderWhatsappConnection = {
  id: string;
  active: boolean;
  agentId: number | null;
  name?: string | null;
  metaPhoneNumberId?: string | null;
  metaConnected?: boolean;
  metaTemplates?: AgentWaTemplates;
  templateCatalog?: WaCatalogEntry[];
};

function StatusLine({ ready, label }: { ready: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium",
        ready
          ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
          : "bg-muted text-muted-foreground",
      )}
    >
      <span className={cn("size-1.5 rounded-full", ready ? "bg-emerald-500" : "bg-muted-foreground/50")} />
      {label}
    </span>
  );
}

export function ToolsWhatsappSetup({ agentId }: { agentId: number }) {
  const [showConnect, setShowConnect] = useState(false);

  const { data: waData, isLoading: waLoading } = useQuery({
    queryKey: ["builder-whatsapp-channel", agentId],
    queryFn: () => customFetch<{ channel: BuilderWhatsappChannel | null }>(`${DASH_API}/whatsapp/channel`),
    staleTime: 60_000,
  });

  const { data: waConnections } = useQuery({
    queryKey: ["builder-whatsapp-connections", agentId],
    queryFn: () => customFetch<{ connections: BuilderWhatsappConnection[] }>(`${DASH_API}/whatsapp/connections`),
    staleTime: 60_000,
  });
  const waConnList = Array.isArray(waConnections?.connections) ? waConnections.connections : [];
  const agentConnection =
    waConnList.find((c) => c.active && c.agentId === agentId)
    ?? waConnList.find((c) => c.active)
    ?? null;
  const connected = Boolean(agentConnection || waData?.channel);

  return (
    <div className="space-y-3 border-t border-border/30 px-4 pb-4 pt-3">
      {waLoading ? (
        <Skeleton className="h-10 w-full rounded-md" />
      ) : connected && !showConnect ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[12px] font-medium">
                {agentConnection?.name
                  || waData?.channel?.businessName
                  || "WhatsApp connected"}
              </p>
              <p className="text-[10px] text-muted-foreground">
                Pick which approved template to send mid-call, after a call, after a booking, or after a callback.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusLine ready label="Ready" />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-[10px]"
                onClick={() => setShowConnect(true)}
              >
                Change number
              </Button>
            </div>
          </div>
          {agentConnection && (agentConnection.metaPhoneNumberId || agentConnection.metaConnected) ? (
            <AgentWhatsappTemplatePicks
              agentId={agentId}
              connectionId={agentConnection.id}
              initialTemplates={agentConnection.metaTemplates}
              initialCatalog={agentConnection.templateCatalog}
            />
          ) : waData?.channel ? (
            <AgentWhatsappTemplatePicks
              agentId={agentId}
              nativeMode
              initialCatalog={waData.channel.templateCatalog}
            />
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {!connected ? (
            <div>
              <p className="text-[12px] font-medium">Connect WhatsApp for this agent</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Pick a number and approved templates here. After-call rules still live under After the call.
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] font-medium">Change WhatsApp number</p>
              <Button type="button" variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => setShowConnect(false)}>
                Back to templates
              </Button>
            </div>
          )}
          <WhatsAppPage embedded forAgentId={agentId} />
        </div>
      )}
    </div>
  );
}

export function ToolsEmailSetup() {
  return (
    <div className="border-t border-border/30 px-4 pb-4 pt-3">
      <EmailChannelCard embedded forceExpanded />
    </div>
  );
}
