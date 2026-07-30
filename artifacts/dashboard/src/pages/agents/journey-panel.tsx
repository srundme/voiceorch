import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Copy, GitBranch, Loader2, Pause, Phone, Play, Plus, RefreshCw, Webhook,
} from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { cn } from "@/lib/utils";
import { useEmailChannelReady } from "./email-channel-card";

const _DASH_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DASH_API = `${_DASH_BASE}/api`;

type JourneyPresetMeta = {
  id: string;
  label: string;
  trigger: string;
  firstContact: string;
  followups: string;
  channels: string;
  memory: string;
};

type JourneyStep = {
  id: string;
  type: string;
  label?: string;
  agentId?: number;
  phoneField?: string;
  field?: string;
  op?: string;
  value?: string;
  delaySeconds?: number;
  callbackDelayDays?: number;
  url?: string;
  whatsappHint?: string;
  notes?: string;
};

type JourneySettings = {
  callbackDelayDays?: number;
  whatsappHint?: "call_summary" | "booking_confirmed" | "callback_scheduled";
  webhookUrl?: string | null;
  followUpOnNoAnswer?: boolean;
  followUpOnInterested?: boolean;
  sendWhatsappAfterCall?: boolean;
  sendEmailAfterCall?: boolean;
  emailSubject?: string | null;
  emailBody?: string | null;
};

type Journey = {
  id: number;
  agentId: number;
  name: string;
  description: string | null;
  status: "draft" | "active" | "paused";
  presetId: string;
  steps: JourneyStep[];
  settings: JourneySettings;
  workflowId: number | null;
  publicToken: string | null;
  hookUrl: string | null;
  totalRuns: number;
  lastRunAt: string | null;
};

type JourneyRun = {
  id: number;
  status: string;
  triggeredBy: string | null;
  error: string | null;
  createdAt: string;
  currentStepIndex: number;
};

type JourneyFollowup = {
  id: number;
  toNumber: string;
  status: string;
  reason: string | null;
  notes: string | null;
  scheduledAt: string;
};

function statusClass(status: string) {
  if (status === "active" || status === "completed" || status === "triggered") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-400";
  }
  if (status === "paused" || status === "pending" || status === "waiting_call" || status === "waiting_delay" || status === "running") {
    return "border-amber-500/25 bg-amber-500/10 text-amber-400";
  }
  if (status === "failed" || status === "cancelled") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }
  return "border-border/50 bg-muted/30 text-muted-foreground";
}

export function JourneyPanel({
  agentId,
  webhookUrl,
  onConfigureEmail,
}: {
  agentId: number;
  webhookUrl?: string | null;
  onConfigureEmail?: () => void;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const emailReady = useEmailChannelReady();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [callbackDays, setCallbackDays] = useState(5);
  const [sendWa, setSendWa] = useState(true);
  const [sendEmail, setSendEmail] = useState(false);
  const [followNoAnswer, setFollowNoAnswer] = useState(true);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

  const { data: presets = [], isLoading: presetsLoading } = useQuery({
    queryKey: ["journey-presets"],
    queryFn: () => customFetch<JourneyPresetMeta[]>(`${DASH_API}/journeys/presets`),
    staleTime: 5 * 60_000,
  });

  const { data: journeys = [], isLoading: journeysLoading, refetch: refetchJourneys } = useQuery({
    queryKey: ["journeys", agentId],
    enabled: agentId > 0,
    queryFn: () => customFetch<Journey[]>(`${DASH_API}/journeys?agentId=${agentId}`),
  });

  const selected = useMemo(() => {
    if (!journeys.length) return null;
    if (selectedId != null) return journeys.find((j) => j.id === selectedId) ?? journeys[0] ?? null;
    return journeys[0] ?? null;
  }, [journeys, selectedId]);

  const { data: runs = [], refetch: refetchRuns } = useQuery({
    queryKey: ["journey-runs", selected?.id],
    enabled: !!selected?.id,
    queryFn: () => customFetch<JourneyRun[]>(`${DASH_API}/journeys/${selected!.id}/runs`),
    refetchInterval: selected?.status === "active" ? 10_000 : false,
  });

  const { data: followups = [], refetch: refetchFollowups } = useQuery({
    queryKey: ["journey-followups", selected?.id],
    enabled: !!selected?.id,
    queryFn: () => customFetch<JourneyFollowup[]>(`${DASH_API}/journeys/${selected!.id}/followups`),
    refetchInterval: 15_000,
  });

  const createFromPreset = useMutation({
    mutationFn: async (presetId: string) =>
      customFetch<Journey>(`${DASH_API}/journeys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          presetId,
          settings: {
            callbackDelayDays: callbackDays,
            sendWhatsappAfterCall: sendWa,
            sendEmailAfterCall: sendEmail,
            followUpOnNoAnswer: followNoAnswer,
            followUpOnInterested: true,
            webhookUrl: webhookUrl || null,
            emailSubject: emailSubject || null,
            emailBody: emailBody || null,
          },
        }),
      }),
    onSuccess: (j) => {
      queryClient.invalidateQueries({ queryKey: ["journeys", agentId] });
      setSelectedId(j.id);
      toast({ title: "Journey created", description: `${j.name} saved as draft.` });
    },
    onError: (err) => toast({ title: "Could not create journey", description: formatApiError(err), variant: "destructive" }),
  });

  const applyPreset = useMutation({
    mutationFn: async (presetId: string) =>
      customFetch<Journey>(`${DASH_API}/journeys/${selected!.id}/apply-preset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presetId,
          settings: {
            callbackDelayDays: callbackDays,
            sendWhatsappAfterCall: sendWa,
            sendEmailAfterCall: sendEmail,
            followUpOnNoAnswer: followNoAnswer,
            followUpOnInterested: true,
            webhookUrl: webhookUrl || null,
            emailSubject: emailSubject || null,
            emailBody: emailBody || null,
          },
        }),
      }),
    onSuccess: (j) => {
      queryClient.invalidateQueries({ queryKey: ["journeys", agentId] });
      setSelectedId(j.id);
      toast({ title: "Preset applied", description: `${j.name} rebuilt from preset.` });
    },
    onError: (err) => toast({ title: "Apply failed", description: formatApiError(err), variant: "destructive" }),
  });

  const saveSettings = useMutation({
    mutationFn: async () =>
      customFetch<Journey>(`${DASH_API}/journeys/${selected!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            ...(selected?.settings ?? {}),
            callbackDelayDays: callbackDays,
            sendWhatsappAfterCall: sendWa,
            sendEmailAfterCall: sendEmail,
            followUpOnNoAnswer: followNoAnswer,
            webhookUrl: webhookUrl || selected?.settings?.webhookUrl || null,
            emailSubject: emailSubject || null,
            emailBody: emailBody || null,
          },
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journeys", agentId] });
      toast({ title: "Journey settings saved" });
    },
    onError: (err) => toast({ title: "Save failed", description: formatApiError(err), variant: "destructive" }),
  });

  const setStatus = useMutation({
    mutationFn: async (action: "activate" | "pause") =>
      customFetch<Journey>(`${DASH_API}/journeys/${selected!.id}/${action}`, { method: "POST" }),
    onSuccess: (j) => {
      queryClient.invalidateQueries({ queryKey: ["journeys", agentId] });
      toast({ title: j.status === "active" ? "Journey live" : "Journey paused" });
    },
    onError: (err) => toast({ title: "Status update failed", description: formatApiError(err), variant: "destructive" }),
  });

  const testRun = useMutation({
    mutationFn: async () =>
      customFetch<{ runId: number }>(`${DASH_API}/journeys/${selected!.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: testPhone.trim(), name: "Test lead" }),
      }),
    onSuccess: (r) => {
      void refetchRuns();
      void refetchFollowups();
      toast({ title: "Test run started", description: `Run #${r.runId}` });
    },
    onError: (err) => toast({ title: "Test failed", description: formatApiError(err), variant: "destructive" }),
  });

  React.useEffect(() => {
    if (!selected) return;
    setCallbackDays(selected.settings?.callbackDelayDays ?? 5);
    setSendWa(selected.settings?.sendWhatsappAfterCall ?? true);
    setSendEmail(selected.settings?.sendEmailAfterCall ?? false);
    setFollowNoAnswer(selected.settings?.followUpOnNoAnswer ?? true);
    setEmailSubject(selected.settings?.emailSubject ?? "");
    setEmailBody(selected.settings?.emailBody ?? "");
  }, [selected?.id]);

  const fullHookUrl = selected?.hookUrl
    ? `${window.location.origin}${selected.hookUrl.startsWith("/") ? "" : "/"}${selected.hookUrl}`
    : null;

  const copyHook = async () => {
    if (!fullHookUrl) return;
    try {
      await navigator.clipboard.writeText(fullHookUrl);
      toast({ title: "Intake URL copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border/60 bg-card/20 p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" />
              Journey presets
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Create a real journey from a preset. It saves to the agent and runs through calls, WhatsApp, callbacks, and webhooks.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => void refetchJourneys()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
        </div>

        {presetsLoading ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {presets.map((preset) => {
              const isActivePreset = selected?.presetId === preset.id;
              return (
                <div
                  key={preset.id}
                  className={cn(
                    "rounded-xl border p-4 space-y-2.5",
                    isActivePreset ? "border-primary/40 bg-primary/5" : "border-border/50 bg-background/40",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold">{preset.label}</h4>
                    {isActivePreset ? <Badge variant="secondary" className="text-[10px]">Selected</Badge> : null}
                  </div>
                  <div className="space-y-1.5 text-[11px] text-muted-foreground">
                    <p><span className="text-foreground/80 font-medium">Lead source:</span> {preset.trigger}</p>
                    <p><span className="text-foreground/80 font-medium">First contact:</span> {preset.firstContact}</p>
                    <p><span className="text-foreground/80 font-medium">Follow-up:</span> {preset.followups}</p>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={createFromPreset.isPending}
                      onClick={() => createFromPreset.mutate(preset.id)}
                    >
                      {createFromPreset.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                      Create
                    </Button>
                    {selected && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={applyPreset.isPending}
                        onClick={() => applyPreset.mutate(preset.id)}
                      >
                        Apply to current
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border/60 bg-card/20 p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">This agent's journeys</h3>
            <p className="text-[11px] text-muted-foreground">Activate one journey to accept lead intake and run the sequence.</p>
          </div>
        </div>

        {journeysLoading ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : journeys.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/50 p-8 text-center">
            <GitBranch className="h-7 w-7 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-sm font-medium text-muted-foreground/50">No journeys yet</p>
            <p className="text-xs text-muted-foreground/30 mt-0.5">Create one from a preset above</p>
          </div>
        ) : (
          <div className="space-y-2">
            {journeys.map((j) => (
              <button
                key={j.id}
                type="button"
                onClick={() => setSelectedId(j.id)}
                className={cn(
                  "w-full text-left rounded-xl border px-3 py-2.5 transition-colors",
                  selected?.id === j.id ? "border-primary/40 bg-primary/5" : "border-border/50 bg-background/40 hover:bg-background/60",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{j.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {j.presetId.replace(/_/g, " ")} · {j.totalRuns} runs
                      {j.lastRunAt ? ` · last ${new Date(j.lastRunAt).toLocaleString()}` : ""}
                    </p>
                  </div>
                  <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize", statusClass(j.status))}>
                    {j.status}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {selected && (
        <>
          <section className="rounded-xl border border-border/60 bg-card/20 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">{selected.name}</h3>
                <p className="text-[11px] text-muted-foreground">{selected.description}</p>
              </div>
              <div className="flex gap-2">
                {selected.status === "active" ? (
                  <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={setStatus.isPending} onClick={() => setStatus.mutate("pause")}>
                    <Pause className="h-3.5 w-3.5 mr-1" /> Pause
                  </Button>
                ) : (
                  <Button type="button" size="sm" className="h-8 text-xs" disabled={setStatus.isPending} onClick={() => setStatus.mutate("activate")}>
                    <Play className="h-3.5 w-3.5 mr-1" /> Activate
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Callback delay (days)</Label>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  className="h-8 text-xs"
                  value={callbackDays}
                  onChange={(e) => setCallbackDays(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/40 px-3 py-2">
                <div>
                  <p className="text-xs font-medium">WhatsApp after call</p>
                  <p className="text-[10px] text-muted-foreground">Send template when the journey reaches that step</p>
                </div>
                <Switch checked={sendWa} onCheckedChange={setSendWa} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/40 px-3 py-2">
                <div>
                  <p className="text-xs font-medium">Email after call</p>
                  <p className="text-[10px] text-muted-foreground">Uses Channels → Email (SnapServe or Brevo)</p>
                  {sendEmail && !emailReady && (
                    <button
                      type="button"
                      className="mt-1 text-[10px] text-amber-400 underline underline-offset-2 hover:text-amber-300"
                      onClick={() => onConfigureEmail?.()}
                    >
                      Email channel not ready — open Channels → Email
                    </button>
                  )}
                </div>
                <Switch checked={sendEmail} onCheckedChange={setSendEmail} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/40 px-3 py-2 sm:col-span-3">
                <div>
                  <p className="text-xs font-medium">Callback on no answer</p>
                  <p className="text-[10px] text-muted-foreground">Schedule auto-dial follow-up</p>
                </div>
                <Switch checked={followNoAnswer} onCheckedChange={setFollowNoAnswer} />
              </div>
            </div>

            {sendEmail && (
              <div className="rounded-lg border border-border/40 bg-background/40 p-3 space-y-2">
                <p className="text-xs font-medium">Optional journey email override</p>
                <p className="text-[10px] text-muted-foreground">
                  Leave blank to use the Email channel default content. Supports {"{{name}}"}, {"{{summary}}"}, {"{{email}}"}, etc.
                </p>
                <Input
                  className="h-8 text-xs"
                  placeholder="Subject override"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                />
                <Textarea
                  className="min-h-[80px] text-xs font-mono"
                  placeholder="Body override (HTML or plain text)"
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                />
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={saveSettings.isPending} onClick={() => saveSettings.mutate()}>
                {saveSettings.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                Save follow-up settings
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => navigate("/app/callbacks")}>
                <Phone className="h-3.5 w-3.5 mr-1" /> Open callbacks
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => navigate("/app/whatsapp")}>
                WhatsApp channel
              </Button>
            </div>

            {fullHookUrl && (
              <div className="rounded-lg border border-border/40 bg-background/40 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Webhook className="h-3.5 w-3.5 text-violet-400" />
                  <p className="text-xs font-medium">Lead intake URL</p>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  POST JSON with <code className="font-mono">phone</code> (and optional name/email). Active journeys dial automatically.
                </p>
                <div className="flex items-center gap-2">
                  <Input readOnly className="h-8 text-[11px] font-mono" value={fullHookUrl} />
                  <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => void copyHook()}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2">Sequence</p>
              <ol className="space-y-1.5">
                {(selected.steps ?? []).map((step, idx) => (
                  <li key={step.id} className="flex items-start gap-2 rounded-lg border border-border/40 bg-background/30 px-3 py-2">
                    <span className="text-[10px] font-mono text-muted-foreground mt-0.5">{idx + 1}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{step.label || step.type}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{step.type}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="rounded-lg border border-border/40 bg-background/40 p-3 space-y-2">
              <p className="text-xs font-medium">Test run</p>
              <div className="flex gap-2">
                <Input
                  className="h-8 text-xs"
                  placeholder="+91…"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-8 text-xs shrink-0"
                  disabled={!testPhone.trim() || testRun.isPending}
                  onClick={() => testRun.mutate()}
                >
                  {testRun.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                  Run
                </Button>
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-xl border border-border/60 bg-card/20 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Recent runs</h3>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void refetchRuns()}>Refresh</Button>
              </div>
              {runs.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No runs yet. Activate the journey and post a lead, or start a test run.</p>
              ) : (
                <div className="space-y-2">
                  {runs.slice(0, 8).map((run) => (
                    <div key={run.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-background/40 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium">Run #{run.id}</p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {run.triggeredBy || "manual"} · step {run.currentStepIndex}
                          {run.error ? ` · ${run.error}` : ""}
                        </p>
                      </div>
                      <span className={cn("text-[10px] rounded-full border px-2 py-0.5 capitalize", statusClass(run.status))}>{run.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border/60 bg-card/20 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Scheduled follow-ups</h3>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void refetchFollowups()}>Refresh</Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Unified callback queue for this agent — journey steps, AI tool callbacks, and no-answer redials.
              </p>
              {followups.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No scheduled callbacks yet.</p>
              ) : (
                <div className="space-y-2">
                  {followups.slice(0, 8).map((f) => (
                    <div key={f.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-background/40 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium tabular-nums">{f.toNumber}</p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {f.reason || "callback"} · {new Date(f.scheduledAt).toLocaleString()}
                          {f.notes ? ` · ${f.notes}` : ""}
                        </p>
                      </div>
                      <span className={cn("text-[10px] rounded-full border px-2 py-0.5 capitalize", statusClass(f.status))}>{f.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
