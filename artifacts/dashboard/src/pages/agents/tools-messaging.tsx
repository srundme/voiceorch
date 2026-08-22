/**
 * Agent Builder consumes workspace connections — it does not connect them.
 * Credentials live under Connections. Templates are mapped on After the call.
 */

import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useEmailChannelReady } from "./email-channel-card";
import {
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
  vobizChannelId?: string | null;
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

type EmailChannelPeek = {
  channel?: {
    active?: boolean;
    fromName?: string | null;
    fromEmail?: string | null;
    defaultTemplateId?: number | null;
  } | null;
  templates?: Array<{ id: number; name: string; isDefault: boolean }>;
  identities?: Array<{ fromName: string; fromEmail: string; isDefault: boolean }>;
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

export function connectionsSetupHref(
  setup: "whatsapp" | "email" | "calendar",
  agentId: number,
  section: "tools" | "outcomes" = "tools",
) {
  const returnTo = encodeURIComponent(`/app/agents/${agentId}?section=${section}`);
  const returnLabel = encodeURIComponent(section === "outcomes" ? "After the call" : "Actions");
  return `/app/connections?setup=${setup}&agentId=${agentId}&returnTo=${returnTo}&returnLabel=${returnLabel}`;
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
  const metaReady = Boolean(
    agentConnection && (agentConnection.metaConnected || agentConnection.metaPhoneNumberId),
  );
  const nativeReady = Boolean(
    waData?.channel?.active && (waData.channel.status === "active" || waData.channel.vobizChannelId || waData.channel.phoneE164),
  );

  return (
    <div className="space-y-3 border-t border-border bg-muted/20 px-4 pb-4 pt-3">
      {waLoading ? (
        <Skeleton className="h-10 w-full rounded-md" />
      ) : metaReady && agentConnection ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-[12px] font-medium">
              {agentConnection.name || "WhatsApp"}
            </p>
            <StatusLine ready label="Connected" />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Mid-call uses the After the call default. Map one template for all outcomes, or different templates per disposition, on After the call.
          </p>
        </div>
      ) : nativeReady ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-[12px] font-medium">
              {waData?.channel?.businessName || "WhatsApp"}
            </p>
            <StatusLine ready label="Connected" />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Mid-call uses the After the call default. Map templates by outcome there.
          </p>
        </div>
      ) : agentConnection ? (
        <div className="rounded-lg bg-muted/25 px-3 py-3">
          <p className="text-[12px] font-medium">{agentConnection.name || "WhatsApp"} is saved, not fully wired</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Meta Business verification is not enough. Paste the Phone Number ID, WABA ID, and a permanent
            System User token on Connections, then Refresh templates here.
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-2 h-7 text-[10px]"
            onClick={() => navigate(connectionsSetupHref("whatsapp", agentId))}
          >
            Finish on Connections
          </Button>
        </div>
      ) : (
        <div className="rounded-lg bg-muted/25 px-3 py-3">
          <p className="text-[12px] font-medium">WhatsApp is not connected yet</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Connect the number once under Connections. Then come back here to pick a template.
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-2 h-7 text-[10px]"
            onClick={() => navigate(connectionsSetupHref("whatsapp", agentId))}
          >
            Open Connections
          </Button>
        </div>
      )}
    </div>
  );
}

export function ToolsEmailSetup({ agentId }: { agentId?: number }) {
  const [, navigate] = useLocation();
  const ready = useEmailChannelReady();
  const { data, isLoading } = useQuery({
    queryKey: ["email-channel"],
    queryFn: () => customFetch<EmailChannelPeek>(`${DASH_API}/email/channel`),
    staleTime: 30_000,
  });
  const from =
    data?.identities?.find((i) => i.isDefault)
    ?? data?.identities?.[0];
  const tpl =
    data?.templates?.find((t) => t.id === data.channel?.defaultTemplateId)
    ?? data?.templates?.find((t) => t.isDefault)
    ?? data?.templates?.[0];

  return (
    <div className="border-t border-border bg-muted/20 px-4 pb-4 pt-3">
      {isLoading ? (
        <Skeleton className="h-16 w-full rounded-md" />
      ) : ready ? (
        <div className="flex items-start justify-between gap-3 rounded-lg bg-muted/25 px-3 py-3">
          <div className="min-w-0">
            <p className="truncate text-[12px] font-medium">
              {from ? `${from.fromName} · ${from.fromEmail}` : "Email connected"}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {tpl ? `Sends “${tpl.name}”. Edit From and templates under Connections.` : "Using the workspace default template."}
            </p>
          </div>
          <StatusLine ready label="Connected" />
        </div>
      ) : (
        <div className="rounded-lg bg-muted/25 px-3 py-3">
          <p className="text-[12px] font-medium">Email is not connected yet</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Paste the Brevo key and From address under Connections. This agent only turns send on.
          </p>
          {agentId ? (
            <Button
              type="button"
              size="sm"
              className="mt-2 h-7 text-[10px]"
              onClick={() => navigate(connectionsSetupHref("email", agentId))}
            >
              Open Connections
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
