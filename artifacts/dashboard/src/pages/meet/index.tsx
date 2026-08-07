import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAgentFromSearch } from "@/components/agent-context-bar";
import { StripePage } from "@/components/stripe-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Video, Loader2, LogOut, Bot, Plus } from "lucide-react";
import { MeetingsChannelCard } from "@/pages/agents/meetings-channel-card";

const API = "/api";

type ActiveBot = { botId: string; agentName: string; meetingUrl: string };

export default function MeetPage() {
  const { toast } = useToast();
  const { agents, selectedId, setAgentId, isLoading: agentsLoading } = useAgentFromSearch();
  const agentId = selectedId != null ? String(selectedId) : "";
  const agentIdNum = selectedId != null && selectedId > 0 ? selectedId : 0;
  const selectedName = agents.find((a) => a.id === selectedId)?.name ?? "Agent";

  const [meetingUrl, setMeetingUrl] = useState("");
  const [bots, setBots] = useState<ActiveBot[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  const identityQ = useQuery({
    queryKey: ["meet-bot-identity"],
    queryFn: () =>
      customFetch<{ botEmail: string | null; signedInGoogleMeet: boolean }>(`${API}/meet-bots/identity`),
    staleTime: 60_000,
  });

  const launch = useMutation({
    mutationFn: async () =>
      customFetch<{ botId: string; status: string; agentId?: number; configuredAgentId?: number }>(`${API}/meet-bots`, {
        method: "POST",
        body: JSON.stringify({
          agentId: Number(agentId),
          meetingUrl: meetingUrl.trim(),
          // Meet page: the agent picker above is who joins — ignore booking "delegate".
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
      toast({ title: "Could not join meeting", description: err?.message ?? "Unknown error", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (botId: string) => customFetch(`${API}/meet-bots/${botId}`, { method: "DELETE" }),
    onSuccess: (_d, botId) => setBots((prev) => prev.filter((b) => b.botId !== botId)),
    onError: (err: any) =>
      toast({ title: "Could not remove bot", description: err?.message ?? "Unknown error", variant: "destructive" }),
  });

  return (
    <StripePage
      title="Meetings"
      description="Send an agent into Google Meet, Zoom, or Teams."
      back={{ href: "/app/connections", label: "Connections" }}
    >
      <div className="mx-auto max-w-xl space-y-6">
        {/* 1. Agent — primary, findable */}
        <section className="space-y-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[13px] font-semibold tracking-tight">1. Agent</h2>
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
              <p className="text-sm text-muted-foreground">No agents yet.</p>
              <Button asChild size="sm" className="mt-3 h-8 gap-1.5 text-xs">
                <Link href="/app/agents?create=1">
                  <Plus className="size-3.5" />
                  Create an agent
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
              <span className="font-medium text-foreground">{selectedName}</span> will join the call.
              Use a Phone + meetings agent (no number required for Meet-only).
            </p>
          )}
        </section>

        {/* 2. Link + join */}
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="text-[13px] font-semibold tracking-tight">2. Meeting link</h2>
          <div className="space-y-2">
            <Label className="text-[12px]">Paste Meet / Zoom / Teams URL</Label>
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

        {/* Active bots */}
        {bots.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-[13px] font-semibold tracking-tight">In this session</h2>
            {bots.map((b) => (
              <BotRow key={b.botId} bot={b} onRemove={() => remove.mutate(b.botId)} removing={remove.isPending} />
            ))}
          </section>
        )}

        {/* 3. Optional settings — collapsed by default */}
        {agentIdNum > 0 && (
          <section className="space-y-3">
            <button
              type="button"
              onClick={() => setShowSettings((v) => !v)}
              className="flex w-full items-center justify-between rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5 text-left text-[13px] font-medium hover:bg-muted/35"
            >
              <span>3. Waiting, length &amp; presentation</span>
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
