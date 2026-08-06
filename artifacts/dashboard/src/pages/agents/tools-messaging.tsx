/**
 * WhatsApp + Email setup for Tools tab (replaces Channels → messaging).
 */

import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { EmailChannelCard } from "./email-channel-card";
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
  const [, navigate] = useLocation();

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

  return (
    <div className="space-y-3 border-t border-border/30 px-4 pb-4 pt-3">
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Pick the WhatsApp connection and templates this agent can send mid-call.
      </p>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-[10px]"
          onClick={() => navigate(`/app/connections?setup=whatsapp&agentId=${agentId}`)}
        >
          Connections
        </Button>
      </div>
      {waLoading ? (
        <Skeleton className="h-14 w-full rounded-md" />
      ) : agentConnection ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-[12px] font-medium">
                {agentConnection.name || "WhatsApp connection"}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {agentConnection.metaPhoneNumberId || agentConnection.metaConnected
                  ? "WhatsApp Business · Meta API"
                  : "BSP webhook"}
              </p>
            </div>
            <StatusLine ready label="Active" />
          </div>
          {(agentConnection.metaPhoneNumberId || agentConnection.metaConnected) ? (
            <AgentWhatsappTemplatePicks
              agentId={agentId}
              connectionId={agentConnection.id}
              initialTemplates={agentConnection.metaTemplates}
              initialCatalog={agentConnection.templateCatalog}
            />
          ) : null}
        </div>
      ) : waData?.channel ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-[12px] font-medium">
                {waData.channel.businessName || "WhatsApp channel"}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {waData.channel.mode === "own" ? "Own number" : "Legacy Instant"}
                {waData.channel.phoneE164 ? ` · ${waData.channel.phoneE164}` : ""}
              </p>
            </div>
            <StatusLine
              ready={!!waData.channel.active}
              label={waData.channel.status || (waData.channel.active ? "Active" : "Inactive")}
            />
          </div>
          <AgentWhatsappTemplatePicks
            agentId={agentId}
            nativeMode
            initialCatalog={waData.channel.templateCatalog}
          />
        </div>
      ) : (
        <div className="rounded-lg bg-muted/25 px-3 py-3">
          <p className="text-[12px] font-medium">No WhatsApp connected</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Connect one under Connections, then select templates here.
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-2 h-7 text-[10px]"
            onClick={() => navigate(`/app/connections?setup=whatsapp&agentId=${agentId}`)}
          >
            Set up WhatsApp
          </Button>
        </div>
      )}
    </div>
  );
}

export function ToolsEmailSetup() {
  return (
    <div className="border-t border-border/30 px-4 pb-4 pt-3">
      <EmailChannelCard forceExpanded />
    </div>
  );
}
