/**
 * Channels → Meetings (Phase 4).
 *
 * Join / delegate / memory toggles live here.
 * Meeting prompt is owned by Agent Builder → Prompt / Talk (In meetings).
 */

import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  useGetAgent,
  useListAgents,
  useUpdateAgent,
  getGetAgentQueryKey,
  getListAgentsQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { ExternalLink, FileText, Loader2, Save } from "lucide-react";

export type MeetingsForm = {
  enabled: boolean;
  whoJoins: "self" | "delegate";
  meetingPrompt: string;
  delegateAgentId: string; // "" | number string
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

export function MeetingsChannelCard({ agentId }: { agentId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const agentQ = useGetAgent(agentId, {
    query: { queryKey: getGetAgentQueryKey(agentId), staleTime: 15_000 },
  });
  const agentsQ = useListAgents({
    query: { queryKey: getListAgentsQueryKey(), staleTime: 30_000 },
  });
  const update = useUpdateAgent();

  const identityQ = useQuery({
    queryKey: ["meet-bot-identity"],
    queryFn: () =>
      customFetch<{ botEmail: string | null; signedInGoogleMeet: boolean }>("/api/meet-bots/identity"),
    staleTime: 60_000,
  });

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
  const meetPromptPreview = form.meetingPrompt.trim();

  const set = (patch: Partial<MeetingsForm>) => setForm((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    if (form.whoJoins === "delegate" && !form.delegateAgentId) {
      toast({
        title: "Pick a meeting agent",
        description: "Choose which agent joins the meeting, or switch to “This agent”.",
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
              // Prompt is owned by Builder — keep existing value on channel save.
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
      toast({ title: "Meeting channel saved" });
    } catch (err) {
      toast({ title: "Could not save", description: formatApiError(err), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Meetings</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Meet, Zoom, Teams — who joins and what context is passed.
          </p>
        </div>
        <Button asChild type="button" variant="outline" size="sm" className="h-8 shrink-0 text-xs">
          <Link href={`/app/meet?agentId=${agentId}`}>Join now</Link>
        </Button>
      </div>

      {!loaded || agentQ.isLoading ? (
        <div className="h-28 animate-pulse rounded-md bg-muted/40" />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 border-y border-border py-3">
            <div>
              <p className="text-[13px] font-medium">Can join meetings</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Off skips auto-join from bookings; you can still launch manually.
              </p>
            </div>
            <Switch checked={form.enabled} onCheckedChange={(v) => set({ enabled: v })} />
          </div>

          {identityQ.data && (
            <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2.5 text-[11px] text-muted-foreground leading-relaxed">
              {identityQ.data.botEmail ? (
                <>
                  Bot joins as{" "}
                  <span className="font-mono text-foreground">{identityQ.data.botEmail}</span>
                  {" — "}admit this address, or add it to the Meet invite.
                </>
              ) : (
                <>
                  Managed meeting agent joins as a guest. Google Meet may ask the host to admit it by
                  the agent&apos;s name (no email shown).
                </>
              )}
            </div>
          )}

          {form.enabled && (
            <>
              <div className="space-y-2">
                <Label className="text-[11px]">Who joins</Label>
                <div className="grid sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => set({ whoJoins: "self" })}
                    className={
                      form.whoJoins === "self"
                        ? "rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5 text-left"
                        : "rounded-lg border border-border/50 px-3 py-2.5 text-left hover:bg-muted/30"
                    }
                  >
                    <p className="text-[12px] font-medium">This agent</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Uses the meeting prompt from Builder</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => set({ whoJoins: "delegate" })}
                    className={
                      form.whoJoins === "delegate"
                        ? "rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5 text-left"
                        : "rounded-lg border border-border/50 px-3 py-2.5 text-left hover:bg-muted/30"
                    }
                  >
                    <p className="text-[12px] font-medium">Another agent</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Delegate joins the room</p>
                  </button>
                </div>
              </div>

              {form.whoJoins === "self" ? (
                <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <FileText className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium">Meeting prompt</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {meetPromptPreview
                          ? `${meetPromptPreview.slice(0, 120)}${meetPromptPreview.length > 120 ? "…" : ""}`
                          : "Not set — meetings will use the call prompt."}
                      </p>
                    </div>
                  </div>
                  <Button asChild type="button" variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                    <Link href={`/app/agents/${agentId}?section=prompt`}>
                      Edit in Builder
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-[11px]">Meeting agent</Label>
                  <Select
                    value={form.delegateAgentId || undefined}
                    onValueChange={(v) => set({ delegateAgentId: v })}
                  >
                    <SelectTrigger className="h-8 text-xs">
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
                  <p className="text-[10px] text-muted-foreground">
                    That agent’s meeting prompt (or call prompt) is used in the room.{" "}
                    {form.delegateAgentId ? (
                      <Link href={`/app/agents/${form.delegateAgentId}?section=prompt`} className="underline underline-offset-2">
                        Edit their prompt
                      </Link>
                    ) : null}
                  </p>
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-3 py-2">
                  <div>
                    <p className="text-[12px] font-medium">Pass contact memory</p>
                    <p className="text-[10px] text-muted-foreground">Facts about the person when available</p>
                  </div>
                  <Switch checked={form.passMemory} onCheckedChange={(v) => set({ passMemory: v })} />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-3 py-2">
                  <div>
                    <p className="text-[12px] font-medium">Pass recent call context</p>
                    <p className="text-[10px] text-muted-foreground">Summary from the prior call when booked</p>
                  </div>
                  <Switch
                    checked={form.passCallContext}
                    onCheckedChange={(v) => set({ passCallContext: v })}
                  />
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs gap-1.5"
              disabled={update.isPending}
              onClick={() => void save()}
            >
              {update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save meetings
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
