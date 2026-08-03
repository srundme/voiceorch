import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { customFetch, useListAgents } from "@workspace/api-client-react";
import { AppPageHeader } from "@/components/app-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Video, Loader2, LogOut } from "lucide-react";

const API = "/api";

type ActiveBot = { botId: string; agentName: string; meetingUrl: string };

export default function MeetPage() {
  const { toast } = useToast();
  const { data: agentsData } = useListAgents();
  const agents: Array<{ id: number; name: string }> = (agentsData as any)?.agents ?? (agentsData as any) ?? [];

  const [agentId, setAgentId] = useState<string>(() => {
    try {
      const raw = new URLSearchParams(window.location.search).get("agentId");
      return raw && /^\d+$/.test(raw) ? raw : "";
    } catch {
      return "";
    }
  });
  const [meetingUrl, setMeetingUrl] = useState("");
  const [bots, setBots] = useState<ActiveBot[]>([]);

  const launch = useMutation({
    mutationFn: async () =>
      customFetch<{ botId: string; status: string }>(`${API}/meet-bots`, {
        method: "POST",
        body: JSON.stringify({ agentId: Number(agentId), meetingUrl: meetingUrl.trim() }),
      }),
    onSuccess: (data) => {
      const agentName = agents.find((a) => String(a.id) === agentId)?.name ?? "Agent";
      setBots((prev) => [...prev, { botId: data.botId, agentName, meetingUrl: meetingUrl.trim() }]);
      setMeetingUrl("");
      toast({ title: "Bot is joining the meeting", description: "It appears as a participant within ~30 seconds. Admit it from the waiting room if prompted." });
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
    <div className="space-y-6">
      <AppPageHeader
        title="Meeting Bots"
        description="Send a voice agent into a Google Meet, Zoom, or Teams meeting as a live participant."
      />

      <div className="max-w-xl space-y-4 rounded-lg border p-4">
        <div className="space-y-2">
          <Label>Agent</Label>
          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger><SelectValue placeholder="Choose an agent" /></SelectTrigger>
            <SelectContent>
              {agents.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
        <div className="max-w-xl space-y-2">
          <Label>Active bots (this session)</Label>
          {bots.map((b) => (
            <BotRow key={b.botId} bot={b} onRemove={() => remove.mutate(b.botId)} removing={remove.isPending} />
          ))}
        </div>
      )}
    </div>
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
