/**
 * Thin WhatsApp + Email status for Tools tab.
 * Credentials live under Connections — Tools only toggles capability + template pick when ready.
 */

import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useEmailChannelReady } from "./email-channel-card";
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
      {waLoading ? (
        <Skeleton className="h-10 w-full rounded-md" />
      ) : agentConnection || waData?.channel ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[12px] font-medium">
                {agentConnection?.name
                  || waData?.channel?.businessName
                  || "WhatsApp connected"}
              </p>
              <p className="text-[10px] text-muted-foreground">
                Credentials live under Connections. Pick mid-call templates here.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusLine ready label="Ready" />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-[10px]"
                onClick={() => navigate(`/app/connections?setup=whatsapp&agentId=${agentId}`)}
              >
                Connections
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
        <div className="rounded-lg bg-muted/25 px-3 py-3">
          <p className="text-[12px] font-medium">WhatsApp not connected</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Set up Instant WhatsApp under Connections, then return here for templates.
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
  const [, navigate] = useLocation();
  const ready = useEmailChannelReady();

  return (
    <div className="border-t border-border/30 px-4 pb-4 pt-3">
      <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/25 px-3 py-3">
        <div className="min-w-0">
          <p className="text-[12px] font-medium">
            {ready ? "Brevo email ready" : "Email not connected"}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {ready
              ? "Sender and template are managed under Connections."
              : "Connect Brevo under Connections (from address + API key + test)."}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusLine ready={ready} label={ready ? "Ready" : "Needs setup"} />
          <Button
            type="button"
            size="sm"
            variant={ready ? "outline" : "default"}
            className="h-7 text-[10px]"
            onClick={() => navigate("/app/connections?setup=email")}
          >
            {ready ? "Connections" : "Set up email"}
          </Button>
        </div>
      </div>
    </div>
  );
}
