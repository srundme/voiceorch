/**
 * Agent channels — phone, WhatsApp, email, meetings, booking.
 * Standalone Integrations-style surface (not part of the agent builder).
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

const _DASH_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DASH_API = `${_DASH_BASE}/api`;

type BuilderWhatsappChannel = {
  active: boolean;
  status?: string | null;
  businessName?: string | null;
  mode?: string | null;
  phoneE164?: string | null;
};

type BuilderWhatsappResponse = {
  channel: BuilderWhatsappChannel | null;
};

type BuilderWhatsappConnection = {
  active: boolean;
  agentId: number | null;
  name?: string | null;
  metaPhoneNumberId?: string | null;
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
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        ready
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
          : "border-amber-500/25 bg-amber-500/10 text-amber-400",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", ready ? "bg-emerald-400" : "bg-amber-400")} />
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
    knowledgeSourceIds: (Array.isArray(agent?.knowledgeSourceIds) ? agent.knowledgeSourceIds : []) as number[],
    webhookUrl: typeof agent?.webhookUrl === "string" ? agent.webhookUrl.trim() : "",
    name: typeof agent?.name === "string" ? agent.name : "",
    systemPrompt: typeof agent?.systemPrompt === "string" ? agent.systemPrompt : "",
  };
}

function JourneyReadinessPanel({ agent }: { agent: any }) {
  const cfg = channelConfig(agent);
  const [hasInboundPhone, setHasInboundPhone] = useState(false);
  const emailReady = useEmailChannelReady();

  const { data: phoneNumbersRaw } = useListPhoneNumbers({
    query: { queryKey: getListPhoneNumbersQueryKey(), staleTime: 60_000 },
  });

  const { data: waData } = useQuery({
    queryKey: ["builder-whatsapp-channel", agent?.id],
    enabled: !!agent?.id,
    queryFn: () => customFetch<BuilderWhatsappResponse>(`${DASH_API}/whatsapp/channel`),
    staleTime: 60_000,
  });

  const { data: waConnData } = useQuery({
    queryKey: ["builder-whatsapp-connections", agent?.id],
    enabled: !!agent?.id,
    queryFn: () =>
      customFetch<{ connections: Array<{ active: boolean; agentId: number | null }> }>(
        `${DASH_API}/whatsapp/connections`,
      ),
    staleTime: 60_000,
  });
  const waConnActive = (Array.isArray(waConnData?.connections) ? waConnData.connections : []).some(
    (c) => c.active && (c.agentId === agent?.id || c.agentId == null),
  );
  const waReady = !!waData?.channel?.active || waConnActive;

  useEffect(() => {
    const phoneNumbers = Array.isArray(phoneNumbersRaw) ? phoneNumbersRaw : [];
    setHasInboundPhone(phoneNumbers.some((p: any) => p.agentId === agent?.id));
  }, [phoneNumbersRaw, agent?.id]);

  const checks = [
    { label: "Voice + prompt", ready: !!cfg.name.trim() && !!cfg.systemPrompt.trim() },
    { label: "Knowledge attached", ready: cfg.knowledgeSourceIds.length > 0 },
    { label: "Phone channel", ready: hasInboundPhone },
    { label: "WhatsApp channel", ready: waReady },
    { label: "Email channel", ready: emailReady },
    { label: "Booking channel", ready: !!cfg.schedulingCalendarId && !!cfg.schedulingEventTypeId },
    { label: "Follow-up output", ready: waReady || emailReady || !!cfg.webhookUrl },
  ];

  const readyCount = checks.filter((c) => c.ready).length;

  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Channel readiness
          </p>
          <h3 className="mt-1 text-sm font-semibold">Connect the pipes this agent can use</h3>
        </div>
        <span className="text-xs font-semibold text-muted-foreground">
          {readyCount}/{checks.length}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {checks.map((check) => (
          <div
            key={check.label}
            className="flex items-center justify-between rounded-lg border border-border/40 bg-background/40 px-3 py-2"
          >
            <span className="text-xs">{check.label}</span>
            <StatusBadge ready={check.ready} readyLabel="Connected" emptyLabel="Pending" />
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Messaging channels are Email (your Brevo) + WhatsApp (Instant / Business / BSP). SMS is not a messaging channel.
      </p>
    </div>
  );
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

  const channelItems = [
    { id: "phone" as const, label: "Phone", detail: "Inbound & outbound", ready: !!agent?.id },
    {
      id: "whatsapp" as const,
      label: "WhatsApp",
      detail: "Messages & follow-ups",
      ready: !!agentConnection || !!waData?.channel?.active,
    },
    { id: "email" as const, label: "Email", detail: "Your Brevo account", ready: false },
    { id: "meetings" as const, label: "Meetings", detail: "Meet, Zoom & Teams", ready: !!agent?.id },
    {
      id: "booking" as const,
      label: "Booking",
      detail: "Calendar & event type",
      ready: !!cfg.schedulingCalendarId && !!cfg.schedulingEventTypeId,
    },
  ];

  return (
    <div className={cn("space-y-5", !embedded && "px-4 py-5 sm:px-6 lg:px-8")}>
      {!embedded && (
        <section>
          <h2 className="text-[15px] font-semibold tracking-[-0.02em]">Channels</h2>
          <p className="mt-0.5 max-w-xl text-[12px] leading-5 text-muted-foreground">
            Wire how{" "}
            {agent?.name ? <span className="text-foreground">{agent.name}</span> : "this agent"}{" "}
            talks — phone, WhatsApp, email, meetings, booking.
          </p>
        </section>
      )}

      <section className="grid min-h-[480px] overflow-hidden rounded-lg border border-border bg-card md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="border-b border-border bg-muted/[0.16] p-2.5 md:border-b-0 md:border-r">
          <div className="grid grid-cols-2 gap-1 md:grid-cols-1">
            {channelItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveChannel(item.id)}
                className={cn(
                  "flex min-h-11 items-center gap-2.5 rounded-md px-2.5 text-left transition-colors",
                  activeChannel === item.id
                    ? "bg-foreground/[0.08] text-foreground"
                    : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
                )}
              >
                <StatusDot tone={item.ready ? "success" : "neutral"} />
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium">{item.label}</p>
                  <p className="hidden truncate text-[10px] text-muted-foreground md:block">{item.detail}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0 p-5 sm:p-6">
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
                    Managed, VoBiz, or BYO BSP messages and follow-ups.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => navigate(`/app/whatsapp${agent?.id ? `?agentId=${agent.id}` : ""}`)}
                >
                  Configure
                </Button>
              </div>
              {waLoading ? (
                <Skeleton className="h-20 w-full rounded-md" />
              ) : agentConnection ? (
                <div className="flex items-center justify-between border-y border-border py-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">
                      {agentConnection.name || "WhatsApp connection"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {agentConnection.metaPhoneNumberId
                        ? "WhatsApp Business · Meta API"
                        : "BSP webhook connection"}
                    </p>
                  </div>
                  <StatusBadge ready readyLabel="Active" emptyLabel="Inactive" />
                </div>
              ) : waData?.channel ? (
                <div className="flex items-center justify-between border-y border-border py-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">
                      {waData.channel.businessName || "WhatsApp channel"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {waData.channel.mode === "own" ? "Own number" : "Shared SnapServe channel"}
                      {waData.channel.phoneE164 ? ` · ${waData.channel.phoneE164}` : ""}
                    </p>
                  </div>
                  <StatusBadge
                    ready={waData.channel.active}
                    readyLabel={waData.channel.status || "Active"}
                    emptyLabel="Inactive"
                  />
                </div>
              ) : (
                <div className="border-y border-border py-6">
                  <p className="text-[13px] font-medium">No WhatsApp channel</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Connect one for summaries, reminders, and chat replies.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="mt-4 h-8"
                    onClick={() => navigate(`/app/whatsapp${agent?.id ? `?agentId=${agent.id}` : ""}`)}
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => navigate("/app/scheduling")}
                >
                  Open scheduling
                </Button>
              </div>
              <div className="flex items-center justify-between border-y border-border py-3.5">
                <div>
                  <p className="text-[13px] font-medium">Calendar + event type</p>
                  <p className="text-xs text-muted-foreground">
                    {cfg.schedulingCalendarId && cfg.schedulingEventTypeId
                      ? "Booking tools and notifications are linked."
                      : "Link scheduling in agent Tools → Booking before promising bookings."}
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
                  <Link href={`/app/agents/${agent.id}?section=tools`}>Open agent Tools → Booking</Link>
                </Button>
              )}
            </div>
          )}
        </div>
      </section>

      <details className="rounded-lg border border-border bg-card">
        <summary className="cursor-pointer px-4 py-3.5 text-[12px] font-medium">Channel readiness</summary>
        <div className="border-t border-border p-4">
          <JourneyReadinessPanel agent={agent} />
        </div>
      </details>
    </div>
  );
}
