import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  CheckCircle2, Copy, GitBranch, Loader2, Pause, Phone, Play, Plus, RefreshCw, Save, Webhook, Wrench,
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
import {
  ReachStepEditor,
  defaultStep,
  type ReachStep,
} from "./reach-step-editor";

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
  squadId?: number | null;
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

type WaChannelResponse = {
  channel: { active?: boolean; mode?: string } | null;
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
  onOpenChannels,
}: {
  agentId: number;
  webhookUrl?: string | null;
  onConfigureEmail?: () => void;
  onOpenChannels?: () => void;
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
  const [showPresets, setShowPresets] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [editingSteps, setEditingSteps] = useState(false);
  const [draftSteps, setDraftSteps] = useState<ReachStep[]>([]);
  const [draftDirty, setDraftDirty] = useState(false);

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

  const { data: waData } = useQuery({
    queryKey: ["builder-whatsapp-channel", agentId],
    enabled: agentId > 0,
    queryFn: () => customFetch<WaChannelResponse>(`${DASH_API}/whatsapp/channel`),
    staleTime: 60_000,
  });
  const waReady = !!waData?.channel?.active;

  const selected = useMemo(() => {
    if (!journeys.length) return null;
    if (selectedId != null) return journeys.find((j) => j.id === selectedId) ?? journeys[0] ?? null;
    const active = journeys.find((j) => j.status === "active");
    return active ?? journeys[0] ?? null;
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

  React.useEffect(() => {
    if (journeys.length === 0) setShowPresets(true);
  }, [journeys.length]);

  const settingsPayload = () => ({
    callbackDelayDays: callbackDays,
    sendWhatsappAfterCall: sendWa,
    sendEmailAfterCall: sendEmail,
    followUpOnNoAnswer: followNoAnswer,
    followUpOnInterested: true,
    webhookUrl: webhookUrl || null,
    emailSubject: emailSubject || null,
    emailBody: emailBody || null,
  });

  const fullHookUrlFor = (j: Journey | null) => {
    if (!j?.hookUrl) return null;
    return `${window.location.origin}${j.hookUrl.startsWith("/") ? "" : "/"}${j.hookUrl}`;
  };

  const copyUrl = async (url: string | null) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Lead intake URL copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const createFromPreset = useMutation({
    mutationFn: async (presetId: string) =>
      customFetch<Journey>(`${DASH_API}/journeys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, presetId, settings: settingsPayload() }),
      }),
    onSuccess: (j) => {
      queryClient.invalidateQueries({ queryKey: ["journeys", agentId] });
      setSelectedId(j.id);
      setShowPresets(false);
      setEditingSteps(false);
      toast({
        title: "Journey attached to this agent",
        description: "Next: turn it live and copy the lead intake URL.",
      });
    },
    onError: (err) => toast({ title: "Could not create journey", description: formatApiError(err), variant: "destructive" }),
  });

  const createBlankCustom = useMutation({
    mutationFn: async () =>
      customFetch<Journey>(`${DASH_API}/journeys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          presetId: "custom",
          name: "Custom sequence",
          description: "Editable Reach sequence for this agent",
          trigger: { type: "form_lead", fieldMap: { phone: "phone", name: "name", email: "email" } },
          settings: settingsPayload(),
          steps: [defaultStep("make_call", agentId)],
        }),
      }),
    onSuccess: (j) => {
      queryClient.invalidateQueries({ queryKey: ["journeys", agentId] });
      setSelectedId(j.id);
      setShowPresets(false);
      setDraftSteps((j.steps ?? []) as ReachStep[]);
      setEditingSteps(true);
      setDraftDirty(false);
      toast({
        title: "Custom sequence attached",
        description: "Add WhatsApp, email, waits, or callbacks — then Go live.",
      });
    },
    onError: (err) => toast({ title: "Could not create sequence", description: formatApiError(err), variant: "destructive" }),
  });

  const saveCustomSteps = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No journey selected");
      if (draftSteps.length === 0) throw new Error("Add at least one step");
      if (!draftSteps.some((s) => s.type === "make_call")) {
        throw new Error("Sequence needs a Call step");
      }
      for (const s of draftSteps) {
        if (s.type === "send_webhook" && !(s.url ?? "").trim()) {
          throw new Error("Webhook step needs a URL");
        }
      }
      return customFetch<Journey>(`${DASH_API}/journeys/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presetId: "custom",
          name: selected.presetId === "custom" ? selected.name : `${selected.name} (custom)`,
          steps: draftSteps.map((s) => {
            if (s.type !== "make_call") return s;
            if (s.squadId == null || !(Number(s.squadId) > 0)) {
              const { squadId: _drop, ...rest } = s;
              return rest;
            }
            return { ...s, squadId: Number(s.squadId) };
          }),
        }),
      });
    },
    onSuccess: (j) => {
      queryClient.invalidateQueries({ queryKey: ["journeys", agentId] });
      setSelectedId(j.id);
      setDraftSteps((j.steps ?? []) as ReachStep[]);
      setDraftDirty(false);
      setEditingSteps(true);
      toast({ title: "Custom sequence saved", description: "This journey is now custom — template knobs won’t rewrite steps." });
    },
    onError: (err) => toast({ title: "Could not save steps", description: formatApiError(err), variant: "destructive" }),
  });

  const beginCustomize = () => {
    if (!selected) return;
    setDraftSteps((selected.steps ?? []).map((s) => ({ ...s })) as ReachStep[]);
    setDraftDirty(false);
    setEditingSteps(true);
  };

  const cancelCustomize = () => {
    setEditingSteps(false);
    setDraftDirty(false);
    setDraftSteps((selected?.steps ?? []) as ReachStep[]);
  };

  const applyPreset = useMutation({
    mutationFn: async (presetId: string) =>
      customFetch<Journey>(`${DASH_API}/journeys/${selected!.id}/apply-preset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presetId, settings: settingsPayload() }),
      }),
    onSuccess: (j) => {
      queryClient.invalidateQueries({ queryKey: ["journeys", agentId] });
      setSelectedId(j.id);
      setEditingSteps(false);
      setDraftDirty(false);
      setDraftSteps((j.steps ?? []).map((s) => ({ ...s })) as ReachStep[]);
      toast({ title: "Template replaced", description: `${j.name} is draft again — turn it live when ready.` });
    },
    onError: (err) => toast({ title: "Replace failed", description: formatApiError(err), variant: "destructive" }),
  });

  const saveSettings = useMutation({
    mutationFn: async () =>
      customFetch<Journey>(`${DASH_API}/journeys/${selected!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            ...(selected?.settings ?? {}),
            ...settingsPayload(),
            webhookUrl: webhookUrl || selected?.settings?.webhookUrl || null,
          },
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journeys", agentId] });
      toast({ title: "Follow-up settings saved" });
    },
    onError: (err) => toast({ title: "Save failed", description: formatApiError(err), variant: "destructive" }),
  });

  const setStatus = useMutation({
    mutationFn: async (action: "activate" | "pause") =>
      customFetch<Journey>(`${DASH_API}/journeys/${selected!.id}/${action}`, { method: "POST" }),
    onSuccess: async (j) => {
      queryClient.invalidateQueries({ queryKey: ["journeys", agentId] });
      if (j.status === "active") {
        const url = fullHookUrlFor(j);
        if (url) {
          try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
        }
        toast({
          title: "Journey is live on this agent",
          description: url
            ? "Lead intake URL copied. POST { phone } to start the sequence."
            : "Website / Sheets / forms can now trigger this agent’s journey.",
        });
      } else {
        toast({ title: "Journey paused" });
      }
    },
    onError: (err) => toast({ title: "Status update failed", description: formatApiError(err), variant: "destructive" }),
  });

  const goLive = useMutation({
    mutationFn: async (journeyId: number) => {
      await customFetch(`${DASH_API}/journeys/${journeyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            ...settingsPayload(),
            webhookUrl: webhookUrl || null,
          },
        }),
      });
      return customFetch<Journey>(`${DASH_API}/journeys/${journeyId}/activate`, { method: "POST" });
    },
    onSuccess: async (j) => {
      queryClient.invalidateQueries({ queryKey: ["journeys", agentId] });
      setSelectedId(j.id);
      const url = fullHookUrlFor(j);
      if (url) {
        try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
      }
      toast({
        title: "Live — intake URL copied",
        description: "Paste it into your website form, Sheet, or Zap. New leads dial this agent.",
      });
    },
    onError: (err) => toast({ title: "Could not go live", description: formatApiError(err), variant: "destructive" }),
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
    setDraftSteps((selected.steps ?? []).map((s) => ({ ...s })) as ReachStep[]);
    setDraftDirty(false);
    setEditingSteps(selected.presetId === "custom");
  }, [selected?.id]);

  const fullHookUrl = fullHookUrlFor(selected);
  const defaultPreset = presets.find((p) => p.id === "event_outreach") ?? presets[0];
  const isLive = selected?.status === "active";

  return (
    <div className="space-y-5">
      {/* Binding explainer — always first */}
      <section className="rounded-xl border border-border/60 bg-card/20 p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Bind a journey to this agent</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5 max-w-2xl">
            A journey is the auto-pilot around this agent: lead comes in → agent calls → WhatsApp/email/callback follow-ups.
            It is already scoped to <strong className="text-foreground/80">this agent</strong> — you only attach one sequence and turn it live.
          </p>
        </div>
        <ol className="grid gap-2 sm:grid-cols-3 text-[11px]">
          <li className={cn(
            "rounded-lg border px-3 py-2",
            journeys.length > 0 ? "border-emerald-500/25 bg-emerald-500/5" : "border-border/50 bg-background/40",
          )}>
            <p className="font-semibold text-foreground/90 flex items-center gap-1.5">
              {journeys.length > 0 ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <span className="text-muted-foreground">1.</span>}
              Attach a template
            </p>
            <p className="text-muted-foreground mt-0.5">Pick Event Outreach (or another preset) for this agent</p>
          </li>
          <li className={cn(
            "rounded-lg border px-3 py-2",
            isLive ? "border-emerald-500/25 bg-emerald-500/5" : "border-border/50 bg-background/40",
          )}>
            <p className="font-semibold text-foreground/90 flex items-center gap-1.5">
              {isLive ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <span className="text-muted-foreground">2.</span>}
              Turn it live
            </p>
            <p className="text-muted-foreground mt-0.5">Draft does nothing for website leads — Live accepts intake</p>
          </li>
          <li className="rounded-lg border border-border/50 bg-background/40 px-3 py-2">
            <p className="font-semibold text-foreground/90">3. Copy lead intake URL</p>
            <p className="text-muted-foreground mt-0.5">Paste into website / Sheet / Zap — POSTs dial this agent</p>
          </li>
        </ol>
        <div className="flex flex-wrap gap-2 text-[10px]">
          <button
            type="button"
            onClick={() => onOpenChannels?.()}
            className={cn(
              "rounded-full border px-2.5 py-0.5",
              waReady ? "border-emerald-500/30 text-emerald-400" : "border-amber-500/30 text-amber-400",
            )}
          >
            WhatsApp {waReady ? "ready" : "set up in Channels"}
          </button>
          <button
            type="button"
            onClick={() => (emailReady ? onOpenChannels?.() : onConfigureEmail?.())}
            className={cn(
              "rounded-full border px-2.5 py-0.5",
              emailReady ? "border-emerald-500/30 text-emerald-400" : "border-border/50 text-muted-foreground",
            )}
          >
            Email {emailReady ? "ready" : "optional · Channels"}
          </button>
        </div>
      </section>

      {/* Empty: one big CTA */}
      {!journeysLoading && journeys.length === 0 && (
        <section className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-6 text-center space-y-3">
          <GitBranch className="h-8 w-8 text-primary/50 mx-auto" />
          <div>
            <p className="text-sm font-semibold">No journey on this agent yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
              Attach a ready-made sequence. Recommended for Voiceathon: Event Outreach (lead → call → WhatsApp → callback).
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            className="h-9"
            disabled={!defaultPreset || createFromPreset.isPending}
            onClick={() => defaultPreset && createFromPreset.mutate(defaultPreset.id)}
          >
            {createFromPreset.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
            Attach {defaultPreset?.label ?? "Event Outreach"} to this agent
          </Button>
          <button
            type="button"
            className="block mx-auto text-[11px] text-muted-foreground underline underline-offset-2"
            onClick={() => setShowPresets(true)}
          >
            Or choose a different template
          </button>
          <button
            type="button"
            className="block mx-auto text-[11px] text-muted-foreground underline underline-offset-2"
            disabled={createBlankCustom.isPending}
            onClick={() => createBlankCustom.mutate()}
          >
            Or start a blank custom sequence
          </button>
        </section>
      )}

      {/* Presets — shown when empty (via toggle) or user expands */}
      {(showPresets || journeys.length === 0) && (
        <section className="rounded-xl border border-border/60 bg-card/20 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Templates</h3>
              <p className="text-[11px] text-muted-foreground">Each template becomes a journey owned by this agent.</p>
            </div>
            {journeys.length > 0 && (
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowPresets(false)}>
                Hide
              </Button>
            )}
          </div>
          {presetsLoading ? (
            <div className="grid gap-3 xl:grid-cols-2">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
            </div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {presets.map((preset) => (
                <div key={preset.id} className="rounded-xl border border-border/50 bg-background/40 p-4 space-y-2">
                  <h4 className="text-sm font-semibold">{preset.label}</h4>
                  <p className="text-[11px] text-muted-foreground line-clamp-2">
                    {preset.trigger} → {preset.firstContact}
                  </p>
                  <div className="flex gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={createFromPreset.isPending}
                      onClick={() => createFromPreset.mutate(preset.id)}
                    >
                      {createFromPreset.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                      Attach to agent
                    </Button>
                    {selected && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={applyPreset.isPending}
                        onClick={() => {
                          if (confirm("Replace the current journey sequence with this template? It will go back to draft.")) {
                            applyPreset.mutate(preset.id);
                          }
                        }}
                      >
                        Replace current
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              <div className="rounded-xl border border-dashed border-border/60 bg-background/20 p-4 space-y-2">
                <h4 className="text-sm font-semibold">Custom sequence</h4>
                <p className="text-[11px] text-muted-foreground line-clamp-2">
                  Build your own steps: call → wait → WhatsApp → email → callback → webhook.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={createBlankCustom.isPending}
                  onClick={() => createBlankCustom.mutate()}
                >
                  {createBlankCustom.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Wrench className="h-3.5 w-3.5 mr-1" />}
                  Start blank
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Selected journey — primary workspace */}
      {journeysLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : selected ? (
        <section className="rounded-xl border border-primary/30 bg-card/30 p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold truncate">{selected.name}</h3>
                <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize", statusClass(selected.status))}>
                  {selected.status === "active" ? "Live on this agent" : selected.status}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Bound to this agent · {selected.presetId === "custom" ? "custom sequence" : selected.presetId.replace(/_/g, " ")} · {selected.totalRuns} runs
                {selected.lastRunAt ? ` · last ${new Date(selected.lastRunAt).toLocaleString()}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selected.status === "active" ? (
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={setStatus.isPending} onClick={() => setStatus.mutate("pause")}>
                  <Pause className="h-3.5 w-3.5 mr-1" /> Pause
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={goLive.isPending || setStatus.isPending}
                  onClick={() => goLive.mutate(selected.id)}
                >
                  {(goLive.isPending || setStatus.isPending) ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                  Go live &amp; copy intake URL
                </Button>
              )}
              <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setShowPresets((v) => !v)}>
                Change template
              </Button>
            </div>
          </div>

          {/* Intake URL hero */}
          {fullHookUrl && (
            <div className={cn(
              "rounded-lg border p-3 space-y-2",
              isLive ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/25 bg-amber-500/5",
            )}>
              <div className="flex items-center gap-2">
                <Webhook className="h-3.5 w-3.5 text-violet-400" />
                <p className="text-xs font-medium">Lead intake URL (starts this agent’s journey)</p>
                {!isLive && <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">Works after Go live</Badge>}
              </div>
              <p className="text-[11px] text-muted-foreground">
                POST JSON <code className="font-mono text-[10px]">{"{ \"phone\": \"+91…\", \"name\": \"…\", \"email\": \"…\" }"}</code>
              </p>
              <div className="flex items-center gap-2">
                <Input readOnly className="h-8 text-[11px] font-mono" value={fullHookUrl} />
                <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => void copyUrl(fullHookUrl)}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* Follow-ups — template knobs (rebuild steps unless custom) */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2">After the call</p>
            {selected.presetId === "custom" ? (
              <p className="text-[11px] text-muted-foreground mb-2 rounded-lg border border-border/40 bg-background/30 px-3 py-2">
                This is a <span className="font-medium text-foreground/80">custom sequence</span> — edit steps below.
                Template toggles won’t rewrite the list.
              </p>
            ) : null}
            <div className={cn("grid gap-2 sm:grid-cols-2", selected.presetId === "custom" && "opacity-60")}>
              <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/40 px-3 py-2">
                <div>
                  <p className="text-xs font-medium">WhatsApp after call</p>
                  <p className="text-[10px] text-muted-foreground">
                    {waReady ? "Uses Channels → WhatsApp" : (
                      <button type="button" className="text-amber-400 underline" onClick={() => onOpenChannels?.()}>Set up WhatsApp in Channels</button>
                    )}
                  </p>
                </div>
                <Switch checked={sendWa} onCheckedChange={setSendWa} disabled={selected.presetId === "custom"} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/40 px-3 py-2">
                <div>
                  <p className="text-xs font-medium">Email after call</p>
                  <p className="text-[10px] text-muted-foreground">
                    {emailReady ? "Uses Channels → Email" : (
                      <button type="button" className="text-amber-400 underline" onClick={() => onConfigureEmail?.()}>Set up Email in Channels</button>
                    )}
                  </p>
                </div>
                <Switch checked={sendEmail} onCheckedChange={setSendEmail} disabled={selected.presetId === "custom"} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/40 px-3 py-2">
                <div>
                  <p className="text-xs font-medium">Callback if no answer</p>
                  <p className="text-[10px] text-muted-foreground">Auto-dial again later</p>
                </div>
                <Switch checked={followNoAnswer} onCheckedChange={setFollowNoAnswer} disabled={selected.presetId === "custom"} />
              </div>
              <div className="space-y-1 rounded-lg border border-border/40 bg-background/40 px-3 py-2">
                <Label className="text-[10px] text-muted-foreground">Callback delay (days)</Label>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  className="h-7 text-xs"
                  value={callbackDays}
                  disabled={selected.presetId === "custom"}
                  onChange={(e) => setCallbackDays(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            </div>
            {sendEmail && selected.presetId !== "custom" && (
              <div className="mt-2 rounded-lg border border-border/40 bg-background/40 p-3 space-y-2">
                <p className="text-xs font-medium">Optional email override</p>
                <Input className="h-8 text-xs" placeholder="Subject override" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
                <Textarea className="min-h-[72px] text-xs font-mono" placeholder="Body override" value={emailBody} onChange={(e) => setEmailBody(e.target.value)} />
              </div>
            )}
            {selected.presetId !== "custom" && (
              <div className="flex flex-wrap gap-2 mt-3">
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={saveSettings.isPending} onClick={() => saveSettings.mutate()}>
                  {saveSettings.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                  Save follow-ups
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={() => navigate("/app/connections?setup=whatsapp")}>
                  WhatsApp page
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={() => navigate("/app/callbacks")}>
                  <Phone className="h-3.5 w-3.5 mr-1" /> Callbacks
                </Button>
              </div>
            )}
          </div>

          {/* Sequence — read-only for presets, editor for custom / customize mode */}
          <div id="reach-custom-steps" className="scroll-mt-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  What this agent will do
                </p>
                {selected.presetId === "custom" && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">Custom sequence · edit freely</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {!editingSteps ? (
                  <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={beginCustomize}>
                    <Wrench className="h-3.5 w-3.5" />
                    Customize sequence
                  </Button>
                ) : (
                  <>
                    {selected.presetId !== "custom" && (
                      <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={cancelCustomize}>
                        Cancel
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 text-xs gap-1.5"
                      disabled={saveCustomSteps.isPending || (selected.presetId === "custom" && !draftDirty)}
                      onClick={() => saveCustomSteps.mutate()}
                    >
                      {saveCustomSteps.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      {selected.presetId === "custom" ? "Save steps" : "Save as custom"}
                    </Button>
                  </>
                )}
              </div>
            </div>
            {editingSteps ? (
              <ReachStepEditor
                steps={draftSteps}
                agentId={agentId}
                onChange={(next) => {
                  setDraftSteps(next);
                  setDraftDirty(true);
                }}
              />
            ) : (
              <ReachStepEditor steps={(selected.steps ?? []) as ReachStep[]} agentId={agentId} onChange={() => {}} readOnly />
            )}
            {editingSteps && selected.presetId !== "custom" && (
              <p className="text-[10px] text-muted-foreground">
                Saving forks this template into a custom sequence. You can replace from a template later.
              </p>
            )}
          </div>

          {/* Test + multi-journey */}
          <div className="rounded-lg border border-border/40 bg-background/40 p-3 space-y-2">
            <p className="text-xs font-medium">Quick test (works even while draft)</p>
            <div className="flex gap-2">
              <Input className="h-8 text-xs" placeholder="+91…" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
              <Button type="button" size="sm" className="h-8 text-xs shrink-0" disabled={!testPhone.trim() || testRun.isPending} onClick={() => testRun.mutate()}>
                {testRun.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                Test
              </Button>
            </div>
          </div>

          {journeys.length > 1 && (
            <div className="space-y-2">
              <button type="button" className="text-[11px] text-muted-foreground underline" onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? "Hide" : "Show"} other journeys on this agent ({journeys.length})
              </button>
              {showAdvanced && (
                <div className="space-y-1.5">
                  {journeys.map((j) => (
                    <button
                      key={j.id}
                      type="button"
                      onClick={() => setSelectedId(j.id)}
                      className={cn(
                        "w-full text-left rounded-lg border px-3 py-2 text-xs",
                        selected.id === j.id ? "border-primary/40 bg-primary/5" : "border-border/40",
                      )}
                    >
                      <span className="font-medium">{j.name}</span>
                      <span className={cn("ml-2 text-[10px] capitalize", statusClass(j.status))}>{j.status}</span>
                    </button>
                  ))}
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setShowPresets(true); }}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Attach another template
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void refetchJourneys()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
            </Button>
          </div>
        </section>
      ) : null}

      {/* Runs */}
      {selected && (
        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-border/60 bg-card/20 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Recent runs</h3>
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void refetchRuns()}>Refresh</Button>
            </div>
            {runs.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No runs yet. Go live, then POST a lead — or use Quick test.</p>
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
                      </p>
                    </div>
                    <span className={cn("text-[10px] rounded-full border px-2 py-0.5 capitalize", statusClass(f.status))}>{f.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
