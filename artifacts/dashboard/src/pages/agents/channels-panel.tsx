/**
 * Agent channels — phone, WhatsApp, email, meetings, booking.
 * Embedded in Agent Builder → Channels (also usable standalone).
 */

import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  customFetch,
  getListPhoneNumbersQueryKey,
  useListPhoneNumbers,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/workspace/workspace";
import { cn } from "@/lib/utils";
import { EmailChannelCard, useEmailChannelReady } from "./email-channel-card";
import { MeetingsChannelCard } from "./meetings-channel-card";
import { AgentInboundPanel } from "./agent-inbound-panel";
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

type BuilderWhatsappResponse = {
  channel: BuilderWhatsappChannel | null;
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

export type ChannelId = "phone" | "whatsapp" | "email" | "meetings" | "booking";

function StatusBadge({
  ready,
  readyLabel = "Ready",
  emptyLabel = "Not set",
}: {
  ready: boolean;
  readyLabel?: string;
  emptyLabel?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <StatusDot tone={ready ? "success" : "neutral"} />
      {ready ? readyLabel : emptyLabel}
    </span>
  );
}

function channelConfig(agent: any) {
  const cfg = (agent?.agentConfig ?? {}) as Record<string, any>;
  const cal = (cfg.calendarCapability ?? {}) as Record<string, any>;
  return {
    schedulingCalendarId: (cal.defaultCalendarId as number | null | undefined) ?? null,
    schedulingEventTypeId: (cal.defaultEventTypeId as number | null | undefined) ?? null,
    preferredManagedNumber: (cfg.preferredManagedNumber as string | undefined) ?? null,
    telephonyProvider: (agent?.telephonyProvider as string | undefined)
      ?? (cfg.telephonyProvider as string | undefined)
      ?? "vobiz",
  };
}

export function ChannelsPanel({
  agent,
  initialChannel = "phone",
  embedded = false,
}: {
  agent: any;
  initialChannel?: ChannelId;
  /** When true, skip the duplicate page title (parent page already has one). */
  embedded?: boolean;
}) {
  const [, navigate] = useLocation();
  const [activeChannel, setActiveChannel] = useState<ChannelId>(initialChannel);
  const cfg = channelConfig(agent);

  useEffect(() => {
    setActiveChannel(initialChannel);
  }, [initialChannel, agent?.id]);

  const selectChannel = (id: ChannelId) => {
    setActiveChannel(id);
    if (!embedded || typeof window === "undefined") return;
    const next = new URL(window.location.href);
    next.searchParams.set("section", "channels");
    next.searchParams.set("channel", id);
    window.history.replaceState(window.history.state, "", `${next.pathname}${next.search}${next.hash}`);
  };

  const { data: waData, isLoading: waLoading } = useQuery({
    queryKey: ["builder-whatsapp-channel", agent?.id],
    enabled: !!agent?.id,
    queryFn: () => customFetch<BuilderWhatsappResponse>(`${DASH_API}/whatsapp/channel`),
    staleTime: 60_000,
  });

  const { data: waConnections } = useQuery({
    queryKey: ["builder-whatsapp-connections", agent?.id],
    enabled: !!agent?.id,
    queryFn: () => customFetch<{ connections: BuilderWhatsappConnection[] }>(`${DASH_API}/whatsapp/connections`),
    staleTime: 60_000,
  });
  const waConnList: BuilderWhatsappConnection[] = Array.isArray(waConnections?.connections)
    ? waConnections.connections
    : [];
  const agentConnection =
    waConnList.find((c) => c.active && c.agentId === agent?.id)
    ?? waConnList.find((c) => c.active)
    ?? null;

  const { data: phonesRaw } = useListPhoneNumbers({
    query: { queryKey: getListPhoneNumbersQueryKey(), staleTime: 60_000 },
  });
  const phoneReady = Array.isArray(phonesRaw) && phonesRaw.some((p: any) => p.agentId === agent?.id);
  const emailReady = useEmailChannelReady();

  const channelItems = [
    { id: "phone" as const, label: "Phone", ready: phoneReady },
    {
      id: "whatsapp" as const,
      label: "WhatsApp",
      ready: !!agentConnection || !!waData?.channel?.active,
    },
    { id: "email" as const, label: "Email", ready: emailReady },
    { id: "meetings" as const, label: "Meetings", ready: !!agent?.id },
    {
      id: "booking" as const,
      label: "Booking",
      ready: !!cfg.schedulingCalendarId && !!cfg.schedulingEventTypeId,
    },
  ];

  return (
    <div className={cn("space-y-5", !embedded && "px-4 py-5 sm:px-6")}>
      {!embedded && (
        <section>
          <h2 className="text-[15px] font-semibold tracking-[-0.02em]">Channels</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Wire how {agent?.name ? <span className="text-foreground">{agent.name}</span> : "this agent"} communicates.
          </p>
        </section>
      )}

      {/* Horizontal tabs — no nested card chrome */}
      <div className="flex gap-1 overflow-x-auto border-b border-border pb-px">
        {channelItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => selectChannel(item.id)}
            className={cn(
              "relative shrink-0 px-3 pb-2.5 pt-1 text-[13px] font-medium transition-colors",
              activeChannel === item.id
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              <StatusDot tone={item.ready ? "success" : "neutral"} />
              {item.label}
            </span>
            {activeChannel === item.id && (
              <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-foreground" />
            )}
          </button>
        ))}
      </div>

      <div className="min-w-0 max-w-2xl">
          {activeChannel === "phone" && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Phone</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Inbound routing, outbound caller ID, and test calls.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => navigate("/app/phone-numbers")}
                >
                  Manage numbers
                </Button>
              </div>
              {agent?.id ? (
                <AgentInboundPanel
                  agentId={agent.id}
                  preferredManagedNumber={cfg.preferredManagedNumber}
                  telephonyProvider={cfg.telephonyProvider}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Save the agent first to attach inbound phone numbers.
                </p>
              )}
            </div>
          )}

          {activeChannel === "whatsapp" && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">WhatsApp</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Meta Business API or BYO BSP messages and follow-ups.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => navigate(
                    `/app/connections?setup=whatsapp${agent?.id ? `&agentId=${agent.id}` : ""}`,
                  )}
                >
                  Configure
                </Button>
              </div>
              {waLoading ? (
                <Skeleton className="h-16 w-full rounded-md" />
              ) : agentConnection ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-y border-border py-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">
                        {agentConnection.name || "WhatsApp connection"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {agentConnection.metaPhoneNumberId || agentConnection.metaConnected
                          ? "WhatsApp Business · Meta API"
                          : "BSP webhook connection"}
                      </p>
                    </div>
                    <StatusBadge ready readyLabel="Active" emptyLabel="Inactive" />
                  </div>
                  {(agentConnection.metaPhoneNumberId || agentConnection.metaConnected) && agent?.id ? (
                    <AgentWhatsappTemplatePicks
                      agentId={agent.id}
                      connectionId={agentConnection.id}
                      initialTemplates={agentConnection.metaTemplates}
                      initialCatalog={agentConnection.templateCatalog}
                    />
                  ) : null}
                </div>
              ) : waData?.channel ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-y border-border py-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">
                        {waData.channel.businessName || "WhatsApp channel"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {waData.channel.mode === "own" ? "Own number" : "Legacy Instant channel"}
                        {waData.channel.phoneE164 ? ` · ${waData.channel.phoneE164}` : ""}
                      </p>
                    </div>
                    <StatusBadge
                      ready={waData.channel.active}
                      readyLabel={waData.channel.status || "Active"}
                      emptyLabel="Inactive"
                    />
                  </div>
                  {agent?.id ? (
                    <AgentWhatsappTemplatePicks
                      agentId={agent.id}
                      nativeMode
                      initialCatalog={waData.channel.templateCatalog}
                    />
                  ) : null}
                </div>
              ) : (
                <div className="border-y border-border py-5">
                  <p className="text-[13px] font-medium">No WhatsApp channel</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Connect one for summaries, reminders, and chat replies.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="mt-3 h-8"
                    onClick={() => navigate(
                      `/app/connections?setup=whatsapp${agent?.id ? `&agentId=${agent.id}` : ""}`,
                    )}
                  >
                    Set up WhatsApp
                  </Button>
                </div>
              )}
            </div>
          )}

          {activeChannel === "email" && <EmailChannelCard forceExpanded />}
          {activeChannel === "meetings" && agent?.id && <MeetingsChannelCard agentId={agent.id} />}
          {activeChannel === "booking" && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Booking</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Calendar, event type, meeting links, and notifications.
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => navigate(
                      `/app/connections?setup=calendar${agent?.id ? `&agentId=${agent.id}` : ""}`,
                    )}
                  >
                    Connections
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => navigate("/app/scheduling")}
                  >
                    Scheduling
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-between border-y border-border py-3">
                <div>
                  <p className="text-[13px] font-medium">Calendar + event type</p>
                  <p className="text-xs text-muted-foreground">
                    {cfg.schedulingCalendarId && cfg.schedulingEventTypeId
                      ? "Booking tools and notifications are linked."
                      : "Connect calendar, then link event type under Tools → Booking."}
                  </p>
                </div>
                <StatusBadge
                  ready={!!cfg.schedulingCalendarId && !!cfg.schedulingEventTypeId}
                  readyLabel="Linked"
                  emptyLabel="Unlinked"
                />
              </div>
              {agent?.id && (
                <Button asChild variant="ghost" size="sm" className="h-8 px-0 text-xs">
                  <Link href={`/app/agents/${agent.id}?section=tools`}>Open Tools → Booking</Link>
                </Button>
              )}
            </div>
          )}
      </div>
    </div>
  );
}
