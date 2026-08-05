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
      const botEmail = identityQ.data?.botEmail;
      toast({
        title: "Bot is joining the meeting",
        description: botEmail
          ? `Admit ${botEmail}${delegated ? ` (${agentName})` : ""} from the waiting room, or add it to the invite.`
          : delegated
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
      title="Meetings"
      description="Paste a Google Meet, Zoom, or Teams link and send an agent into the call."
      back={{ href: "/app/connections", label: "Connections" }}
      actions={
        <AgentContextBar agents={agents} selectedId={selectedId} onChange={setAgentId} />
      }
    >
      <div className="max-w-xl space-y-3 rounded-lg border border-border bg-muted/20 px-4 py-3 text-[12px] text-muted-foreground leading-relaxed">
        <p className="font-medium text-foreground text-[13px]">How to use</p>
        <ol className="list-decimal pl-4 space-y-1">
          <li>
            Pick an agent above (use a dedicated meetings agent if you want it separate from phone calls — no phone number required).
          </li>
          <li>
            Set the <span className="text-foreground">In meetings</span> prompt on the agent, and turn on{" "}
            <span className="text-foreground">Channels → Meetings</span>.
          </li>
          <li>Paste the meeting link below and click Join meeting. Admit the bot if the host asks.</li>
        </ol>
      </div>

      <div className="max-w-xl space-y-4 rounded-lg border p-4">
        {agentId ? (
          <p className="text-[11px] text-muted-foreground">
            Meeting prompt:{" "}
            <a className="underline underline-offset-2" href={`/app/agents/${agentId}?section=prompt`}>
              Agent → Prompt
            </a>
            {" · "}
            Join / delegate:{" "}
            <a className="underline underline-offset-2" href={`/app/channels?agentId=${agentId}&channel=meetings`}>
              Agent channels → Meetings
            </a>
            .
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">Select an agent first.</p>
        )}
        {identityQ.data?.botEmail ? (
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Bot joins as <span className="font-mono text-foreground">{identityQ.data.botEmail}</span>
            {" — "}admit this address or add it to the Meet invite.
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Google Meet may ask the host to admit the bot by name (guest — no email).
          </p>
        )}
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
