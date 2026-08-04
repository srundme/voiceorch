import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AgentContextBar, useAgentFromSearch } from "@/components/agent-context-bar";
import { StripePage } from "@/components/stripe-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Video, Loader2, LogOut } from "lucide-react";

const API = "/api";

type ActiveBot = { botId: string; agentName: string; meetingUrl: string };

export default function MeetPage() {
  const { toast } = useToast();
  const { agents, selectedId, setAgentId } = useAgentFromSearch();
  const agentId = selectedId != null ? String(selectedId) : "";

  const [meetingUrl, setMeetingUrl] = useState("");
  const [bots, setBots] = useState<ActiveBot[]>([]);

  const launch = useMutation({
    mutationFn: async () =>
      customFetch<{ botId: string; status: string; agentId?: number; configuredAgentId?: number }>(`${API}/meet-bots`, {
        method: "POST",
        body: JSON.stringify({ agentId: Number(agentId), meetingUrl: meetingUrl.trim() }),
      }),
    onSuccess: (data) => {
      const runtimeId = data.agentId != null ? String(data.agentId) : agentId;
      const agentName = agents.find((a) => String(a.id) === runtimeId)?.name
        ?? agents.find((a) => String(a.id) === agentId)?.name
        ?? "Agent";
      setBots((prev) => [...prev, { botId: data.botId, agentName, meetingUrl: meetingUrl.trim() }]);
      setMeetingUrl("");
      const delegated = data.agentId != null && data.configuredAgentId != null && data.agentId !== data.configuredAgentId;
      toast({
        title: "Bot is joining the meeting",
        description: delegated
          ? `${agentName} is joining (meeting delegate). Admit it from the waiting room if prompted.`
          : "It appears as a participant within ~30 seconds. Admit it from the waiting room if prompted.",
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
      title="Meeting Bots"
      description="Send a voice agent into a Google Meet, Zoom, or Teams meeting. Meeting prompt and delegate live under Channels → Meetings."
      actions={
        <AgentContextBar agents={agents} selectedId={selectedId} onChange={setAgentId} />
      }
    >
      <div className="max-w-xl space-y-4 rounded-lg border p-4">
        {agentId ? (
          <p className="text-[11px] text-muted-foreground">
            Meeting prompt and delegates:{" "}
            <a className="underline underline-offset-2" href={`/app/channels?agentId=${agentId}&channel=meetings`}>
              Channels → Meetings
            </a>
            .
          </p>
        ) : null}
        <div className="space-y-2">
          <Label>Meeting link</Label>
          <Input
            placeholder="https://meet.google.com/abc-defg-hij"
            value={meetingUrl}
            onChange={(e) => setMeetingUrl(e.target.value)}
          />
        </div>
        <Button
          disabled={!agentId || !meetingUrl.trim() || launch.isPending}
          onClick={() => launch.mutate()}
        >
          {launch.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Video className="mr-2 h-4 w-4" />}
          Join meeting
        </Button>
      </div>

      {bots.length > 0 && (
        <div className="mt-6 max-w-xl space-y-2">
          <Label>Active bots (this session)</Label>
          {bots.map((b) => (
            <BotRow key={b.botId} bot={b} onRemove={() => remove.mutate(b.botId)} removing={remove.isPending} />
          ))}
        </div>
      )}
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
