import { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, type Agent } from "@workspace/api-client-react";
import { useAgentFromSearch } from "@/components/agent-context-bar";
import { StripePage } from "@/components/stripe-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { Video, Loader2, LogOut, Bot, Plus, CalendarDays, Unplug } from "lucide-react";
import { MeetingsChannelCard } from "@/pages/agents/meetings-channel-card";

const API = "/api";

function formatMeetError(err: unknown): string {
  const msg = formatApiError(err);
  if (msg === "Carrier unavailable, try again") {
    return "Could not reach the meeting-bot service. Try Join again in a moment.";
  }
  return msg;
}

/**
 * Meetings page only lists agents that can join Meet/Zoom/Teams:
 * - created as Phone + meetings (`agentConfig.meetings.enabled === true`), or
 * - have a non-empty meeting prompt.
 * Matches Builder: phone-only agents book meetings but do not join them.
 */
function isMeetingCapableAgent(agent: Agent): boolean {
  const cfg = (agent as { agentConfig?: { meetings?: unknown } }).agentConfig;
  const meetings = cfg?.meetings;
  if (!meetings || typeof meetings !== "object") return false;
  const m = meetings as { enabled?: unknown; meetingPrompt?: unknown };
  if (m.enabled === true) return true;
  return typeof m.meetingPrompt === "string" && m.meetingPrompt.trim().length > 0;
}

type ActiveBot = { botId: string; agentName: string; meetingUrl: string };

type CalendarConnection = {
  connected: boolean;
  id?: string;
  email?: string;
  status?: string;
};

type CalendarEventRow = {
  id: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  meetingUrl: string | null;
  canJoin: boolean;
  botEnabled: boolean;
  agentId: number | null;
  botId: string | null;
};

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

async function openMeetCalendarConnectPopup(): Promise<void> {
  const { url } = await customFetch<{ url: string }>(
    `${API}/meet-calendar/google/connect-url?returnOrigin=${encodeURIComponent(window.location.origin)}`,
  );
  window.open(url, "_blank", "noopener,width=520,height=680");
}

export default function MeetPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const search = useSearch();
  const {
    agents: allAgents,
    selectedId: rawSelectedId,
    setAgentId,
    isLoading: agentsLoading,
  } = useAgentFromSearch();

  const agents = useMemo(
    () => allAgents.filter(isMeetingCapableAgent),
    [allAgents],
  );

  // Prefer URL selection when it is meeting-capable; otherwise first meeting agent.
  const selectedId = useMemo(() => {
    if (rawSelectedId != null && agents.some((a) => a.id === rawSelectedId)) {
      return rawSelectedId;
    }
    return agents[0]?.id ?? null;
  }, [agents, rawSelectedId]);

  useEffect(() => {
    if (selectedId == null) return;
    if (rawSelectedId === selectedId) return;
    setAgentId(selectedId);
  }, [rawSelectedId, selectedId, setAgentId]);

  const agentId = selectedId != null ? String(selectedId) : "";
  const agentIdNum = selectedId != null && selectedId > 0 ? selectedId : 0;
  const selectedName = agents.find((a) => a.id === selectedId)?.name ?? "Agent";

  const [meetingUrl, setMeetingUrl] = useState("");
  const [bots, setBots] = useState<ActiveBot[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [togglingEventId, setTogglingEventId] = useState<string | null>(null);

  const identityQ = useQuery({
    queryKey: ["meet-bot-identity"],
    queryFn: () =>
      customFetch<{ botEmail: string | null; signedInGoogleMeet: boolean }>(`${API}/meet-bots/identity`),
    staleTime: 60_000,
  });

  const connectionQ = useQuery({
    queryKey: ["meet-calendar-connection"],
    queryFn: () => customFetch<CalendarConnection>(`${API}/meet-calendar/connection`),
    staleTime: 15_000,
  });

  const eventsQ = useQuery({
    queryKey: ["meet-calendar-events"],
    queryFn: () =>
      customFetch<{ events: CalendarEventRow[]; email?: string; status?: string }>(
        `${API}/meet-calendar/events`,
      ),
    enabled: Boolean(connectionQ.data?.connected && connectionQ.data.status !== "disconnected"),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const calendar = params.get("calendar");
    if (calendar === "connected") {
      toast({ title: "Google Calendar connected", description: "Toggle Join on meetings below." });
      void qc.invalidateQueries({ queryKey: ["meet-calendar-connection"] });
      void qc.invalidateQueries({ queryKey: ["meet-calendar-events"] });
    } else if (calendar === "error") {
      toast({
        title: "Could not connect Google Calendar",
        description: "Try again, or publish your Google OAuth app if tokens expire in 7 days.",
        variant: "destructive",
      });
    }
  }, [search, toast, qc]);

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.data?.type === "meet-calendar-oauth" && ev.data?.ok) {
        void qc.invalidateQueries({ queryKey: ["meet-calendar-connection"] });
        void qc.invalidateQueries({ queryKey: ["meet-calendar-events"] });
      }
    };
    window.addEventListener("message", onMsg);
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel("meet-calendar-oauth");
      ch.onmessage = () => {
        void qc.invalidateQueries({ queryKey: ["meet-calendar-connection"] });
        void qc.invalidateQueries({ queryKey: ["meet-calendar-events"] });
      };
    } catch {
      /* ignore */
    }
    return () => {
      window.removeEventListener("message", onMsg);
      ch?.close();
    };
  }, [qc]);

  const connectMut = useMutation({
    mutationFn: () => openMeetCalendarConnectPopup(),
    onError: (err: Error) =>
      toast({ title: "Could not start Google connect", description: err.message, variant: "destructive" }),
  });

  const disconnectMut = useMutation({
    mutationFn: () => customFetch(`${API}/meet-calendar/connection`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["meet-calendar-connection"] });
      void qc.invalidateQueries({ queryKey: ["meet-calendar-events"] });
      toast({ title: "Disconnected Google Calendar" });
    },
    onError: (err: Error) =>
      toast({ title: "Disconnect failed", description: err.message, variant: "destructive" }),
  });

  const toggleBot = async (ev: CalendarEventRow, enable: boolean) => {
    if (!agentIdNum && enable) {
      toast({ title: "Select an agent first", variant: "destructive" });
      return;
    }
    setTogglingEventId(ev.id);
    try {
      if (enable) {
        await customFetch(`${API}/meet-calendar/events/${encodeURIComponent(ev.id)}/bot`, {
          method: "POST",
          body: JSON.stringify({ agentId: agentIdNum }),
        });
        toast({ title: "Bot scheduled", description: ev.title });
      } else {
        await customFetch(`${API}/meet-calendar/events/${encodeURIComponent(ev.id)}/bot`, {
          method: "DELETE",
        });
        toast({ title: "Bot removed", description: ev.title });
      }
      await qc.invalidateQueries({ queryKey: ["meet-calendar-events"] });
    } catch (err: unknown) {
      toast({
        title: enable ? "Could not schedule bot" : "Could not remove bot",
        description: formatMeetError(err),
        variant: "destructive",
      });
    } finally {
      setTogglingEventId(null);
    }
  };

  const launch = useMutation({
    mutationFn: async () =>
      customFetch<{ botId: string; status: string; agentId?: number; configuredAgentId?: number }>(`${API}/meet-bots`, {
        method: "POST",
        body: JSON.stringify({
          agentId: Number(agentId),
          meetingUrl: meetingUrl.trim(),
          joinAsSelected: true,
        }),
      }),
    onSuccess: (data) => {
      const runtimeId = data.agentId != null ? String(data.agentId) : agentId;
      const agentName = agents.find((a) => String(a.id) === runtimeId)?.name
        ?? agents.find((a) => String(a.id) === agentId)?.name
        ?? "Agent";
      setBots((prev) => [...prev, { botId: data.botId, agentName, meetingUrl: meetingUrl.trim() }]);
      setMeetingUrl("");
      const botEmail = identityQ.data?.botEmail;
      toast({
        title: "Bot is joining the meeting",
        description: botEmail
          ? `Admit ${botEmail} from the waiting room, or add it to the invite.`
          : "Admit the bot from the waiting room if the host is asked.",
      });
    },
    onError: (err: any) =>
      toast({ title: "Could not join meeting", description: formatMeetError(err), variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (botId: string) => customFetch(`${API}/meet-bots/${botId}`, { method: "DELETE" }),
    onSuccess: (_d, botId) => setBots((prev) => prev.filter((b) => b.botId !== botId)),
    onError: (err: any) =>
      toast({ title: "Could not remove bot", description: formatMeetError(err), variant: "destructive" }),
  });

  const connected = Boolean(connectionQ.data?.connected);
  const calendarStatus = connectionQ.data?.status;

  return (
    <StripePage
      title="Meeting bots"
      description="Send an agent into a Meet / Zoom / Teams room that already exists. This is not the same as booking a calendar appointment."
      back={{ href: "/app/connections", label: "Connections" }}
    >
      <div className="mx-auto max-w-xl space-y-6">
        <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 space-y-2">
          <p className="text-[12px] font-medium text-foreground">Three ways to join</p>
          <ul className="space-y-1.5 text-[11px] text-muted-foreground leading-relaxed">
            <li>
              <span className="font-medium text-foreground">Join now</span> — paste a Meet/Zoom/Teams link (manual).
            </li>
            <li>
              <span className="font-medium text-foreground">Calendar Join</span> — connect Google below, toggle Join on events (semi-auto).
            </li>
            <li>
              <span className="font-medium text-foreground">From bookings</span> — when a booking invite has a Meet link and this agent has meetings enabled, SnapServe can auto-join near the slot.
            </li>
          </ul>
          <p className="text-[11px] text-muted-foreground">
            To <span className="font-medium text-foreground">create</span> calendar appointments with Meet links, use{" "}
            <Link href="/app/connections?setup=calendar" className="underline underline-offset-2 text-foreground">
              Connections → Bookings calendar
            </Link>
            — that is a different Google connect.
          </p>
        </div>

        {/* 1. Agent */}
        <section className="space-y-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[13px] font-semibold tracking-tight">1. Pick agent</h2>
            <Link
              href="/app/agents?create=1"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3" />
              New agent
            </Link>
          </div>
          {agentsLoading ? (
            <div className="h-10 animate-pulse rounded-lg bg-muted/40" />
          ) : agents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center">
              <p className="text-sm text-muted-foreground">
                {allAgents.length === 0
                  ? "No agents yet."
                  : "No phone + meetings agents yet. Create one with meetings enabled, or add a meeting prompt."}
              </p>
              <Button asChild size="sm" className="mt-3 h-8 gap-1.5 text-xs">
                <Link href="/app/agents?create=1">
                  <Plus className="size-3.5" />
                  Create phone + meetings agent
                </Link>
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={selectedId != null ? String(selectedId) : undefined}
                onValueChange={(v) => setAgentId(Number(v))}
              >
                <SelectTrigger className="h-10 flex-1 min-w-[200px] bg-background text-sm">
                  <SelectValue placeholder="Select agent" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={String(agent.id)}>
                      {agent.name || `Agent ${agent.id}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedId != null && (
                <Button asChild variant="outline" size="sm" className="h-10 gap-1.5 text-xs">
                  <Link href={`/app/agents/${selectedId}?section=prompt`}>
                    <Bot className="size-3.5" />
                    Meeting prompt
                  </Link>
                </Button>
              )}
            </div>
          )}
          {selectedId != null && (
            <p className="text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">{selectedName}</span> will join when you toggle Join or paste a link.
              Only phone + meetings agents (or agents with a meeting prompt) are listed.
            </p>
          )}
        </section>

        {/* 2. Paste link — primary / clearest path */}
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="text-[13px] font-semibold tracking-tight flex items-center gap-1.5">
            <Video className="size-3.5" />
            2. Join now (paste link)
          </h2>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Manual: paste a room URL and send the agent in immediately.
          </p>
          <div className="space-y-2">
            <Label className="text-[12px]">Meet / Zoom / Teams URL</Label>
            <Input
              className="h-10"
              placeholder="https://meet.google.com/abc-defg-hij"
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
            />
          </div>
          {identityQ.data?.botEmail ? (
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Admit <span className="font-mono text-foreground">{identityQ.data.botEmail}</span> if asked.
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Host may need to admit the bot from the waiting room.
            </p>
          )}
          <Button
            className="h-10 w-full sm:w-auto"
            disabled={!agentId || !meetingUrl.trim() || launch.isPending}
            onClick={() => launch.mutate()}
          >
            {launch.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Video className="mr-2 h-4 w-4" />}
            Join meeting
          </Button>
        </section>

        {bots.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-[13px] font-semibold tracking-tight">In this session</h2>
            {bots.map((b) => (
              <BotRow key={b.botId} bot={b} onRemove={() => remove.mutate(b.botId)} removing={remove.isPending} />
            ))}
          </section>
        )}

        {/* 3. Calendar Join */}
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-semibold tracking-tight flex items-center gap-1.5">
                <CalendarDays className="size-3.5" />
                3. Calendar Join (auto on events you choose)
              </h2>
              <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                Connect Google so you can toggle <span className="font-medium text-foreground">Join</span> on upcoming
                events. This calendar is for meeting bots only — not the Bookings calendar under Connections.
              </p>
            </div>
          </div>

          {!connected ? (
            <Button
              className="h-10 w-full sm:w-auto"
              disabled={connectMut.isPending}
              onClick={() => connectMut.mutate()}
            >
              {connectMut.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CalendarDays className="mr-2 h-4 w-4" />
              )}
              Connect Google Calendar
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={calendarStatus === "disconnected" ? "destructive" : "secondary"}>
                  {calendarStatus === "disconnected" ? "Disconnected" : calendarStatus || "Connected"}
                </Badge>
                <span className="text-xs text-muted-foreground truncate">
                  {connectionQ.data?.email}
                </span>
                <div className="flex-1" />
                {calendarStatus === "disconnected" ? (
                  <Button size="sm" variant="outline" onClick={() => connectMut.mutate()}>
                    Reconnect
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  disabled={disconnectMut.isPending}
                  onClick={() => disconnectMut.mutate()}
                >
                  <Unplug className="mr-1 h-3.5 w-3.5" />
                  Disconnect
                </Button>
              </div>

              {calendarStatus === "disconnected" ? (
                <p className="text-[11px] text-destructive">
                  Google revoked access (or OAuth app is still in testing mode). Reconnect to continue.
                </p>
              ) : eventsQ.isLoading ? (
                <div className="h-16 animate-pulse rounded-lg bg-muted/40" />
              ) : eventsQ.isError ? (
                <p className="text-[11px] text-destructive">
                  {(eventsQ.error as Error)?.message || "Could not load events"}
                </p>
              ) : (eventsQ.data?.events?.length ?? 0) === 0 ? (
                <p className="text-[11px] text-muted-foreground">No upcoming calendar events found.</p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {eventsQ.data!.events.map((ev) => (
                    <li key={ev.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{ev.title}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {formatWhen(ev.startTime)}
                          {!ev.canJoin ? " · no Meet/Zoom/Teams link" : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {ev.botEnabled && (
                          <Badge variant="secondary" className="text-[10px]">
                            Joining
                          </Badge>
                        )}
                        <Switch
                          checked={ev.botEnabled}
                          disabled={!ev.canJoin || togglingEventId === ev.id || !agentIdNum}
                          onCheckedChange={(on) => void toggleBot(ev, on)}
                          aria-label={`Join ${ev.title}`}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-dashed border-border/70 px-4 py-3 space-y-1">
          <p className="text-[12px] font-medium text-foreground">From bookings</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            When the agent books a slot (Tools → Booking) and the invite has a Meet link, SnapServe can
            auto-dispatch this meeting bot near the start time — if this agent has meetings enabled.
            Set up invites under{" "}
            <Link href="/app/connections?setup=calendar" className="underline underline-offset-2 text-foreground">
              Bookings calendar
            </Link>
            .
          </p>
        </section>

        {agentIdNum > 0 && (
          <section className="space-y-3">
            <button
              type="button"
              onClick={() => setShowSettings((v) => !v)}
              className="flex w-full items-center justify-between rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5 text-left text-[13px] font-medium hover:bg-muted/35"
            >
              <span>Advanced — waiting room, length, slides</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                {showSettings ? "Hide" : "Show"}
              </span>
            </button>
            {showSettings && (
              <MeetingsChannelCard agentId={agentIdNum} showJoinLink={false} variant="meet-page" />
            )}
          </section>
        )}
      </div>
    </StripePage>
  );
}

function BotRow({ bot, onRemove, removing }: { bot: ActiveBot; onRemove: () => void; removing: boolean }) {
  const { data } = useQuery({
    queryKey: ["meet-bot", bot.botId],
    queryFn: async () => customFetch<{ status: string | null }>(`${API}/meet-bots/${bot.botId}`),
    refetchInterval: 10_000,
  });
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{bot.agentName}</div>
        <div className="truncate text-xs text-muted-foreground">{bot.meetingUrl}</div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{data?.status ?? "starting"}</Badge>
        <Button size="sm" variant="outline" disabled={removing} onClick={onRemove}>
          <LogOut className="mr-1 h-3.5 w-3.5" /> Leave
        </Button>
      </div>
    </div>
  );
}
