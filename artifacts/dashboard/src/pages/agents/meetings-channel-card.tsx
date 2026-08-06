/**
 * Meeting settings for phone+meetings agents (Builder / Meet page): who joins,
 * waiting patience, max length, presentation deck, and memory/context toggles.
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
  /** Meeting hard cut-off (seconds). Default 45 min. */
  maxDurationSeconds: number;
  /** Silence before soft check-in (seconds). Default 3 min. */
  silenceTimeoutSeconds: number;
  /** When false, silence never ends the meeting. */
  silenceHangupEnabled: boolean;
  /** HTTPS Google Slides / PDF / webpage the bot can screenshare. */
  presentationUrl: string;
  /** Start screenshare when the bot joins. */
  presentationAutoStart: boolean;
};

const DEFAULT_MAX = 45 * 60;
const DEFAULT_SILENCE = 3 * 60;

const EMPTY: MeetingsForm = {
  enabled: true,
  whoJoins: "self",
  meetingPrompt: "",
  delegateAgentId: "",
  passMemory: true,
  passCallContext: true,
  maxDurationSeconds: DEFAULT_MAX,
  silenceTimeoutSeconds: DEFAULT_SILENCE,
  silenceHangupEnabled: true,
  presentationUrl: "",
  presentationAutoStart: false,
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function readMeetings(agent: any): MeetingsForm {
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
    maxDurationSeconds: clamp(
      typeof m.maxDurationSeconds === "number" ? m.maxDurationSeconds : DEFAULT_MAX,
      60,
      7200,
    ),
    silenceTimeoutSeconds: clamp(
      typeof m.silenceTimeoutSeconds === "number" ? m.silenceTimeoutSeconds : DEFAULT_SILENCE,
      0,
      600,
    ),
    silenceHangupEnabled: m.silenceHangupEnabled !== false,
    presentationUrl: typeof m.presentationUrl === "string" ? m.presentationUrl.trim() : "",
    presentationAutoStart: m.presentationAutoStart === true,
  };
}

function fmtMins(secs: number): string {
  const m = Math.round(secs / 60);
  return m === 1 ? "1 min" : `${m} min`;
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
    const deck = form.presentationUrl.trim();
    if (deck) {
      try {
        const u = new URL(deck);
        if (u.protocol !== "https:") throw new Error("https only");
      } catch {
        toast({
          title: "Invalid presentation URL",
          description: "Use an https:// Google Slides, PDF, or webpage link.",
          variant: "destructive",
        });
        return;
      }
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
              maxDurationSeconds: form.maxDurationSeconds,
              silenceTimeoutSeconds: form.silenceTimeoutSeconds,
              silenceHangupEnabled: form.silenceHangupEnabled,
              presentationUrl: deck,
              presentationAutoStart: deck ? form.presentationAutoStart : false,
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

  const silenceMins = Math.max(1, Math.round(form.silenceTimeoutSeconds / 60));
  const maxMins = Math.max(1, Math.round(form.maxDurationSeconds / 60));

  return (
    <div className="space-y-5">
      <p className="text-[12px] text-muted-foreground leading-relaxed">
        Meetings are not phone calls — people often ask the bot to wait 2–3 minutes for others.
        Set patience and length here (separate from Engine phone silence / Limits).
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

      <div className="space-y-3 rounded-lg border border-border/60 bg-muted/15 p-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
            Waiting &amp; length
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
            Phone silence (~15s) does not apply here. Default: wait quietly for 3 minutes, then a soft check-in.
          </p>
        </div>

        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span>
            <span className="block text-[13px] font-medium">Leave if room stays quiet</span>
            <span className="block text-[11px] text-muted-foreground">
              Off = stay until max meeting length (best when people ask you to wait)
            </span>
          </span>
          <Switch
            checked={form.silenceHangupEnabled}
            onCheckedChange={(v) => set({ silenceHangupEnabled: v })}
          />
        </label>

        {form.silenceHangupEnabled && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium">Wait patiently for</span>
              <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-primary">
                {fmtMins(form.silenceTimeoutSeconds)}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={silenceMins}
              onChange={(e) => set({ silenceTimeoutSeconds: parseInt(e.target.value, 10) * 60 })}
              className="w-full accent-foreground"
            />
            <div className="flex justify-between text-[9px] text-muted-foreground/50">
              <span>1 min</span>
              <span>10 min</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              After this quiet stretch: soft “I’m still here”, then leave if still silent.
            </p>
          </div>
        )}

        <div className="space-y-1.5 border-t border-border/50 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium">Max meeting length</span>
            <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-primary">
              {fmtMins(form.maxDurationSeconds)}
            </span>
          </div>
          <input
            type="range"
            min={10}
            max={120}
            step={5}
            value={maxMins}
            onChange={(e) => set({ maxDurationSeconds: parseInt(e.target.value, 10) * 60 })}
            className="w-full accent-foreground"
          />
          <div className="flex justify-between text-[9px] text-muted-foreground/50">
            <span>10 min</span>
            <span>2 hr</span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Hard cut-off for the meeting bot only — does not change phone call limits.
          </p>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-border/60 bg-muted/15 p-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
            Presentation
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
            Bot screenshares this deck in Meet (voice stays separate). Ask the agent to present, or auto-start on join.
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium" htmlFor="meet-presentation-url">
            Deck / PDF / webpage URL
          </label>
          <input
            id="meet-presentation-url"
            type="url"
            placeholder="https://docs.google.com/presentation/d/…/edit"
            value={form.presentationUrl}
            onChange={(e) => set({ presentationUrl: e.target.value })}
            className="h-9 w-full rounded-md border border-border/60 bg-background px-3 text-[12px] outline-none focus:border-foreground/30"
          />
        </div>
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span>
            <span className="block text-[13px] font-medium">Share when bot joins</span>
            <span className="block text-[11px] text-muted-foreground">
              Off = agent starts sharing when asked in the meeting
            </span>
          </span>
          <Switch
            checked={form.presentationAutoStart && !!form.presentationUrl.trim()}
            disabled={!form.presentationUrl.trim()}
            onCheckedChange={(v) => set({ presentationAutoStart: v })}
          />
        </label>
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
          Save meeting settings
        </Button>
      </div>
    </div>
  );
}
