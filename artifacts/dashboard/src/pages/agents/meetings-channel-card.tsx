/**
 * Meeting memory / delegate toggles for phone+meetings agents.
 * Attendance capacity is fixed by agent type (meetings.enabled):
 * phone+meet → joins Meet when Booking is on; phone-only → never joins.
 */

import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  useGetAgent,
  useListAgents,
  useUpdateAgent,
  getGetAgentQueryKey,
  getListAgentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { Loader2, Save } from "lucide-react";

export type MeetingsForm = {
  enabled: boolean;
  whoJoins: "self" | "delegate";
  meetingPrompt: string;
  delegateAgentId: string;
  passMemory: boolean;
  passCallContext: boolean;
};

const EMPTY: MeetingsForm = {
  enabled: true,
  whoJoins: "self",
  meetingPrompt: "",
  delegateAgentId: "",
  passMemory: true,
  passCallContext: true,
};

function readMeetings(agent: any): MeetingsForm {
  const m = (agent?.agentConfig as any)?.meetings ?? {};
  return {
    enabled: m.enabled !== false,
    whoJoins: m.whoJoins === "delegate" ? "delegate" : "self",
    meetingPrompt: typeof m.meetingPrompt === "string" ? m.meetingPrompt : "",
    delegateAgentId:
      m.delegateAgentId != null && Number(m.delegateAgentId) > 0
        ? String(m.delegateAgentId)
        : "",
    passMemory: m.passMemory !== false,
    passCallContext: m.passCallContext !== false,
  };
}

export function MeetingsChannelCard({
  agentId,
  showJoinLink: _showJoinLink = true,
}: {
  agentId: number;
  showJoinLink?: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const agentQ = useGetAgent(agentId, {
    query: { queryKey: getGetAgentQueryKey(agentId), staleTime: 15_000 },
  });
  const agentsQ = useListAgents({
    query: { queryKey: getListAgentsQueryKey(), staleTime: 30_000 },
  });
  const update = useUpdateAgent();

  const [form, setForm] = useState<MeetingsForm>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!agentQ.data) return;
    setForm(readMeetings(agentQ.data));
    setLoaded(true);
  }, [agentQ.data]);

  const agents = (Array.isArray(agentsQ.data) ? agentsQ.data : (agentsQ.data as any)?.agents ?? []) as Array<{
    id: number;
    name: string;
  }>;
  const others = agents.filter((a) => a.id !== agentId);
  const canAttend = form.enabled;

  const set = (patch: Partial<MeetingsForm>) => setForm((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    if (canAttend && form.whoJoins === "delegate" && !form.delegateAgentId) {
      toast({
        title: "Pick a meeting agent",
        description: "Choose which agent joins, or switch to “This agent”.",
        variant: "destructive",
      });
      return;
    }
    try {
      await update.mutateAsync({
        id: agentId,
        data: {
          agentConfig: {
            meetings: {
              enabled: form.enabled,
              whoJoins: form.whoJoins,
              meetingPrompt: form.meetingPrompt,
              delegateAgentId:
                form.whoJoins === "delegate" && form.delegateAgentId
                  ? Number(form.delegateAgentId)
                  : null,
              passMemory: form.passMemory,
              passCallContext: form.passCallContext,
            },
          } as any,
        },
      });
      qc.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) });
      toast({ title: "Meeting settings saved" });
    } catch (err) {
      toast({ title: "Could not save", description: formatApiError(err), variant: "destructive" });
    }
  };

  if (!loaded || agentQ.isLoading) {
    return <div className="h-20 animate-pulse rounded-lg bg-muted/40" />;
  }

  if (!canAttend) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3 text-[12px] text-muted-foreground leading-relaxed">
        Phone-only agent — can book calendar from calls, but will not join Google Meet.
        Create a <span className="text-foreground">Phone + meetings</span> agent if you need the bot in the room.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-muted-foreground leading-relaxed">
        This agent joins Meet when Booking is enabled under Tools. Optional: send a delegate or pass call context.
      </p>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
          Who joins
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => set({ whoJoins: "self" })}
            className={
              form.whoJoins === "self"
                ? "rounded-lg border border-foreground/20 bg-foreground px-3 py-2.5 text-left text-background"
                : "rounded-lg border border-border/50 bg-muted/35 px-3 py-2.5 text-left hover:bg-muted/55"
            }
          >
            <p className="text-[12px] font-medium">This agent</p>
            <p className={`text-[10px] mt-0.5 ${form.whoJoins === "self" ? "text-background/70" : "text-muted-foreground"}`}>
              Uses the meeting prompt from Builder
            </p>
          </button>
          <button
            type="button"
            onClick={() => set({ whoJoins: "delegate" })}
            className={
              form.whoJoins === "delegate"
                ? "rounded-lg border border-foreground/20 bg-foreground px-3 py-2.5 text-left text-background"
                : "rounded-lg border border-border/50 bg-muted/35 px-3 py-2.5 text-left hover:bg-muted/55"
            }
          >
            <p className="text-[12px] font-medium">Another agent</p>
            <p className={`text-[10px] mt-0.5 ${form.whoJoins === "delegate" ? "text-background/70" : "text-muted-foreground"}`}>
              Delegate joins the room
            </p>
          </button>
        </div>
        {form.whoJoins === "delegate" && (
          <Select
            value={form.delegateAgentId || undefined}
            onValueChange={(v) => set({ delegateAgentId: v })}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder={others.length ? "Choose agent…" : "Create another agent first"} />
            </SelectTrigger>
            <SelectContent>
              {others.map((a) => (
                <SelectItem key={a.id} value={String(a.id)} className="text-xs">
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {form.whoJoins === "self" && (
          <Link
            href={`/app/agents/${agentId}?section=prompt`}
            className="inline-flex text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Edit meeting prompt
          </Link>
        )}
      </div>

      <div className="divide-y divide-border/60 rounded-lg border border-border/60">
        <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5">
          <span>
            <span className="block text-[13px] font-medium">Contact memory</span>
            <span className="block text-[11px] text-muted-foreground">Facts about the person when available</span>
          </span>
          <Switch checked={form.passMemory} onCheckedChange={(v) => set({ passMemory: v })} />
        </label>
        <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5">
          <span>
            <span className="block text-[13px] font-medium">Recent call context</span>
            <span className="block text-[11px] text-muted-foreground">Summary from the call that booked this</span>
          </span>
          <Switch
            checked={form.passCallContext}
            onCheckedChange={(v) => set({ passCallContext: v })}
          />
        </label>
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={update.isPending}
          onClick={() => void save()}
        >
          {update.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save
        </Button>
      </div>
    </div>
  );
}
