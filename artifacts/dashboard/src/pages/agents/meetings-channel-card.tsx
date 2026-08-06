/**
 * Meeting join / delegate / memory toggles (Channels → Meetings).
 * Meeting prompt is owned by Agent → Prompt → In meetings.
 */

import { useEffect, useState, type ReactNode } from "react";
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
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { ExternalLink, Loader2, Save, User, Bot, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type MeetingsForm = {
  /** false = book only, human attends (no auto-join bot) */
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

function Choice({
  selected,
  onSelect,
  icon,
  title,
  hint,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
        selected
          ? "bg-foreground text-background"
          : "bg-muted/35 text-foreground hover:bg-muted/55",
      )}
    >
      <span className={cn("mt-0.5 shrink-0", selected ? "opacity-90" : "text-muted-foreground")}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium leading-tight">{title}</span>
        <span
          className={cn(
            "mt-0.5 block text-[11px] leading-snug",
            selected ? "text-background/70" : "text-muted-foreground",
          )}
        >
          {hint}
        </span>
      </span>
    </button>
  );
}

export function MeetingsChannelCard({
  agentId,
  showJoinLink = true,
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
  const humanAttends = !form.enabled;

  const set = (patch: Partial<MeetingsForm>) => setForm((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    if (!humanAttends && form.whoJoins === "delegate" && !form.delegateAgentId) {
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
    <div className="space-y-5">
      {showJoinLink && !humanAttends ? (
        <div className="flex justify-end">
          <Button asChild type="button" variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2 text-xs">
            <Link href={`/app/meet?agentId=${agentId}`}>
              Join now <ChevronRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      ) : null}

      {!loaded || agentQ.isLoading ? (
        <div className="h-28 animate-pulse rounded-lg bg-muted/40" />
      ) : (
        <div className="space-y-5">
          <section className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
              1 · Who attends
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Choice
                selected={humanAttends}
                onSelect={() => set({ enabled: false })}
                icon={<User className="size-4" />}
                title="Human"
                hint="Books the calendar. A person joins — no AI bot."
              />
              <Choice
                selected={!humanAttends}
                onSelect={() => set({ enabled: true })}
                icon={<Bot className="size-4" />}
                title="AI joins"
                hint="Meet bot auto-joins from the booking."
              />
            </div>
            {humanAttends ? (
              <p className="text-[11px] text-muted-foreground leading-relaxed pt-0.5">
                Calendar booking still works on the call. SnapServe will not send a meeting bot.
              </p>
            ) : identityQ.data ? (
              <p className="text-[11px] text-muted-foreground leading-relaxed pt-0.5">
                {identityQ.data.botEmail ? (
                  <>
                    Bot joins as{" "}
                    <span className="font-mono text-foreground">{identityQ.data.botEmail}</span>
                    — admit this address or add it to the invite.
                  </>
                ) : (
                  <>
                    Managed bot joins as a guest. Meet may ask the host to admit it by agent name.
                  </>
                )}
              </p>
            ) : null}
          </section>

          {!humanAttends && (
            <>
              <section className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                  2 · Which AI
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Choice
                    selected={form.whoJoins === "self"}
                    onSelect={() => set({ whoJoins: "self" })}
                    icon={<Bot className="size-4" />}
                    title="This agent"
                    hint="Uses this agent’s meeting prompt"
                  />
                  <Choice
                    selected={form.whoJoins === "delegate"}
                    onSelect={() => set({ whoJoins: "delegate" })}
                    icon={<User className="size-4" />}
                    title="Another agent"
                    hint="Delegate joins the room"
                  />
                </div>

                {form.whoJoins === "self" ? (
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium">Meeting prompt</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {meetPromptPreview
                          ? meetPromptPreview
                          : "Not set — falls back to the call prompt"}
                      </p>
                    </div>
                    <Button asChild type="button" variant="outline" size="sm" className="h-8 shrink-0 gap-1 text-xs">
                      <Link href={`/app/agents/${agentId}?section=prompt`}>
                        Edit <ExternalLink className="size-3" />
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
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
                    {form.delegateAgentId ? (
                      <Link
                        href={`/app/agents/${form.delegateAgentId}?section=prompt`}
                        className="inline-flex text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      >
                        Edit their meeting prompt
                      </Link>
                    ) : null}
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                  3 · Context for the meeting
                </p>
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
              </section>
            </>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
            <p className="text-[11px] text-muted-foreground">
              Channel settings save here — agent prompt still uses the main Save.
            </p>
            <Button
              type="button"
              size="sm"
              className="h-8 shrink-0 gap-1.5 text-xs"
              disabled={update.isPending}
              onClick={() => void save()}
            >
              {update.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Save meetings
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
