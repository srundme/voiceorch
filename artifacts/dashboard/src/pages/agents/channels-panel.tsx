/**
 * Agent channels — phone, WhatsApp, email, meetings, booking.
 * Embedded in Agent Builder → Channels (also usable standalone).
 */

import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  customFetch,
  getListPhoneNumbersQueryKey,
  useListPhoneNumbers,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { EmailChannelCard, useEmailChannelReady } from "./email-channel-card";
import { MeetingsChannelCard } from "./meetings-channel-card";
import { AgentInboundPanel } from "./agent-inbound-panel";
import {
  AgentWhatsappTemplatePicks,
  type AgentWaTemplates,
  type WaCatalogEntry,
} from "@/components/whatsapp/agent-template-picks";
import {
  Phone, MessageCircle, Mail, Video, CalendarDays, ChevronRight,
} from "lucide-react";

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

function ChannelShell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-[-0.02em]">{title}</h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground leading-relaxed">{subtitle}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function StatusLine({ ready, readyLabel, emptyLabel }: { ready: boolean; readyLabel: string; emptyLabel: string }) {
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
  const bookingReady = !!cfg.schedulingCalendarId && !!cfg.schedulingEventTypeId;
  const meetingsCfg = ((agent?.agentConfig as any)?.meetings ?? {}) as Record<string, unknown>;
  const meetingsReady =
    meetingsCfg.enabled === false
    || meetingsCfg.whoJoins !== "delegate"
    || (meetingsCfg.delegateAgentId != null && Number(meetingsCfg.delegateAgentId) > 0);

  const channelItems: Array<{
    id: ChannelId;
    label: string;
    icon: ReactNode;
    ready: boolean;
    status: string;
  }> = [
    {
      id: "phone",
      label: "Phone",
      icon: <Phone className="size-3.5" />,
      ready: phoneReady,
      status: phoneReady ? "Live" : "Setup",
    },
    {
      id: "whatsapp",
      label: "WhatsApp",
      icon: <MessageCircle className="size-3.5" />,
      ready: !!agentConnection || !!waData?.channel?.active,
      status: !!agentConnection || !!waData?.channel?.active ? "Live" : "Setup",
    },
    {
      id: "email",
      label: "Email",
      icon: <Mail className="size-3.5" />,
      ready: emailReady,
      status: emailReady ? "Live" : "Setup",
    },
    {
      id: "meetings",
      label: "Meetings",
      icon: <Video className="size-3.5" />,
      ready: meetingsReady,
      status: meetingsCfg.enabled === false ? "Human" : "AI",
    },
    {
      id: "booking",
      label: "Booking",
      icon: <CalendarDays className="size-3.5" />,
      ready: bookingReady,
      status: bookingReady ? "Linked" : "Setup",
    },
  ];

  return (
    <div className={cn("space-y-5", !embedded && "px-4 py-5 sm:px-6", embedded && "p-5 sm:p-6")}>
      {!embedded && (
        <section>
          <h2 className="text-[15px] font-semibold tracking-[-0.02em]">Channels</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            How {agent?.name ? <span className="text-foreground">{agent.name}</span> : "this agent"} reaches people.
          </p>
        </section>
      )}

      {embedded && (
        <section className="space-y-0.5">
          <h2 className="text-[15px] font-semibold tracking-[-0.02em]">Channels</h2>
          <p className="text-[12px] text-muted-foreground">
            Pick a channel, finish setup, then save. Phone is required to go live.
          </p>
        </section>
      )}

      {/* Channel switcher — icon + label + status, not green-dot soup */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {channelItems.map((item) => {
          const active = activeChannel === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => selectChannel(item.id)}
              className={cn(
                "flex min-w-[6.5rem] shrink-0 flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors",
                active
                  ? "border-foreground/20 bg-card shadow-sm"
                  : "border-transparent bg-muted/30 hover:bg-muted/50",
              )}
            >
              <span className="flex items-center gap-1.5 text-[12px] font-medium">
                <span className={cn(active ? "text-foreground" : "text-muted-foreground")}>{item.icon}</span>
                {item.label}
              </span>
              <StatusLine
                ready={item.ready}
                readyLabel={item.status}
                emptyLabel={item.status}
              />
            </button>
          );
        })}
      </div>

      <div className="min-w-0 max-w-2xl rounded-xl border border-border/70 bg-card/30 p-4 sm:p-5">
        {activeChannel === "phone" && (
          <ChannelShell
            title="Phone"
            subtitle="Inbound routing, outbound caller ID, and test calls."
            action={(
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => navigate("/app/phone-numbers")}
              >
                Manage numbers
              </Button>
            )}
          >
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
          </ChannelShell>
        )}

        {activeChannel === "whatsapp" && (
          <ChannelShell
            title="WhatsApp"
            subtitle="Templates, summaries, and chat replies."
            action={(
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
            )}
          >
            {waLoading ? (
              <Skeleton className="h-16 w-full rounded-md" />
            ) : agentConnection ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2.5">
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
                  <StatusLine ready readyLabel="Active" emptyLabel="Inactive" />
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
                <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">
                      {waData.channel.businessName || "WhatsApp channel"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {waData.channel.mode === "own" ? "Own number" : "Legacy Instant channel"}
                      {waData.channel.phoneE164 ? ` · ${waData.channel.phoneE164}` : ""}
                    </p>
                  </div>
                  <StatusLine
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
              <div className="rounded-lg bg-muted/25 px-4 py-5">
                <p className="text-[13px] font-medium">No WhatsApp yet</p>
                <p className="mt-1 text-xs text-muted-foreground max-w-sm">
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
          </ChannelShell>
        )}

        {activeChannel === "email" && <EmailChannelCard forceExpanded />}

        {activeChannel === "meetings" && (
          <ChannelShell
            title="Meetings"
            subtitle="When a call books a calendar slot — who shows up on the Meet?"
          >
            {agent?.id ? (
              <MeetingsChannelCard agentId={agent.id} />
            ) : (
              <p className="text-xs text-muted-foreground">Save the agent first to configure meetings.</p>
            )}
          </ChannelShell>
        )}

        {activeChannel === "booking" && (
          <ChannelShell
            title="Booking"
            subtitle="Calendar, event type, meeting links, and notifications."
            action={(
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
            )}
          >
            <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 px-3 py-3">
              <div>
                <p className="text-[13px] font-medium">Calendar + event type</p>
                <p className="text-xs text-muted-foreground">
                  {bookingReady
                    ? "Booking tools and notifications are linked."
                    : "Connect calendar, then link event type under Tools → Booking."}
                </p>
              </div>
              <StatusLine
                ready={bookingReady}
                readyLabel="Linked"
                emptyLabel="Unlinked"
              />
            </div>
            {agent?.id && (
              <Button asChild variant="ghost" size="sm" className="h-8 gap-1 px-0 text-xs">
                <Link href={`/app/agents/${agent.id}?section=tools`}>
                  Open Tools → Booking <ChevronRight className="size-3.5" />
                </Link>
              </Button>
            )}
          </ChannelShell>
        )}
      </div>
    </div>
  );
}
