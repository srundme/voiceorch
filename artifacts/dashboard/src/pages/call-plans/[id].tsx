/**
 * Call plan builder — single screen: Agent + Who + What happens → Start.
 * Activity log: /app/call-plans/:id/activity.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useListAgents,
  useListCampaigns,
  getListAgentsQueryKey,
  getListCampaignsQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import {
  Loader2, Pause, Play, Save, Trash2, ExternalLink, Users, Square, Clock,
  MoreHorizontal,
} from "lucide-react";
import { StripePage } from "@/components/stripe-page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { cn } from "@/lib/utils";
import { CallPlanStepEditor, type CallPlanStep, type CallPlanPeopleHint } from "./step-editor";
import { CallPlanActivitySummary } from "./activity-panel";

type WhoTab = "list" | "sheet" | "paste" | "form" | "meta";

const _DASH_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DASH_API = `${_DASH_BASE}/api`;

type CallPlanSettings = {
  peopleSource?: string;
  campaignId?: number | null;
  sheetPipelineId?: string | null;
  runMode?: "once" | "live";
  sheetCursorRow?: number;
  startOffset?: number;
  startSourceTotal?: number;
  autoFeed?: boolean;
  isCallingHoursEnabled?: boolean;
  businessHoursStart?: number | null;
  businessHoursEnd?: number | null;
  timezone?: string | null;
};

const CALL_PLAN_TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "America/New_York",
  "UTC",
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${String(h).padStart(2, "0")}:00`,
}));

type CallPlan = {
  id: number;
  agentId: number;
  name: string;
  description: string | null;
  status: "draft" | "active" | "paused";
  steps: CallPlanStep[];
  trigger?: { type: string };
  publicToken?: string | null;
  hookUrl?: string | null;
  settings: CallPlanSettings;
  totalRuns: number;
  lastRunAt: string | null;
};

type StartOnceResult = {
  started: number;
  skipped?: number;
  keepLive?: boolean;
  hasMore?: boolean;
  nextOffset?: number;
  sourceTotal?: number;
  batchMax?: number;
  autoFeed?: boolean;
  concurrentLimit?: number;
  queue?: boolean;
};

type StartPreviewResult = {
  wouldStart: number;
  wouldSkip: number;
  sampleSkipped: Array<{ phone: string; name?: string }>;
  hasMore?: boolean;
  nextOffset?: number;
  sourceTotal?: number;
  batchMax?: number;
  inBatch?: number;
};

function statusClass(status: string) {
  if (status === "active" || status === "completed") {
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

export default function CallPlanDetailPage() {
  const params = useParams<{ id: string }>();
  const planId = Number(params.id);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState<number | null>(null);
  const [steps, setSteps] = useState<CallPlanStep[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [sheetPipelineId, setSheetPipelineId] = useState<string>("");
  const [manualPhones, setManualPhones] = useState("");
  const [peopleMode, setPeopleMode] = useState<"campaign" | "sheet" | "manual">("campaign");
  const [runMode, setRunMode] = useState<"once" | "live">("once");
  const [callingHoursEnabled, setCallingHoursEnabled] = useState(true);
  const [hoursStart, setHoursStart] = useState(9);
  const [hoursEnd, setHoursEnd] = useState(19);
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [dirty, setDirty] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [forceOpen, setForceOpen] = useState(false);
  const [pendingForce, setPendingForce] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<StartPreviewResult | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [continueOffset, setContinueOffset] = useState(0);
  const [lastHasMore, setLastHasMore] = useState(false);
  const [intakeMode, setIntakeMode] = useState<"manual" | "form_lead" | "instagram_lead">("manual");
  const [hookUrl, setHookUrl] = useState<string | null>(null);

  const agentsQ = useListAgents({
    query: { queryKey: getListAgentsQueryKey(), staleTime: 30_000 },
  });
  const agents = (Array.isArray(agentsQ.data) ? agentsQ.data : []) as Array<{ id: number; name: string }>;

  const campaignsQ = useListCampaigns({
    query: { queryKey: getListCampaignsQueryKey(), staleTime: 30_000 },
  });
  const campaigns = useMemo(() => {
    const raw = Array.isArray(campaignsQ.data) ? campaignsQ.data : [];
    return (raw as Array<{ id: number; name: string; totalLeads?: number; leadSource?: string }>)
      .filter((c) => c.leadSource === "csv");
  }, [campaignsQ.data]);

  const sheetsQ = useQuery({
    queryKey: ["automatic-calls"],
    queryFn: () => customFetch<Array<{ id: string; name: string; status: string; spreadsheetTitle?: string | null }>>(
      `${DASH_API}/automatic-calls`,
    ),
    staleTime: 30_000,
  });
  const sheetPipelines = sheetsQ.data ?? [];

  const planQ = useQuery({
    queryKey: ["call-plans", planId],
    queryFn: () => customFetch<CallPlan>(`${DASH_API}/journeys/${planId}`),
    enabled: Number.isFinite(planId) && planId > 0,
  });

  const waReadyQ = useQuery({
    queryKey: ["call-plan-wa-ready"],
    queryFn: () => customFetch<{ channel: { active?: boolean } | null }>(`${DASH_API}/whatsapp/channel`),
    staleTime: 60_000,
  });
  const emailReadyQ = useQuery({
    queryKey: ["call-plan-email-ready"],
    queryFn: () => customFetch<{ channel: { active?: boolean; mode?: string } | null }>(`${DASH_API}/email/channel`),
    staleTime: 60_000,
    retry: false,
  });

  const needsWhatsapp = steps.some((s) => s.type === "send_whatsapp");
  const needsEmail = steps.some((s) => s.type === "send_email");
  const waReady = !!waReadyQ.data?.channel?.active;
  const emailReady = !!emailReadyQ.data?.channel?.active;

  useEffect(() => {
    const plan = planQ.data;
    if (!plan) return;
    setName(plan.name);
    setAgentId(plan.agentId);
    setSteps(Array.isArray(plan.steps) ? plan.steps : []);
    const cid = plan.settings?.campaignId;
    const sid = plan.settings?.sheetPipelineId;
    const peopleSrc = plan.settings?.peopleSource;
    if (sid) {
      setSheetPipelineId(String(sid));
      setPeopleMode("sheet");
    } else if (cid != null && Number(cid) > 0) {
      setCampaignId(String(cid));
      setPeopleMode("campaign");
    } else if (peopleSrc === "sheet" || peopleSrc === "manual" || peopleSrc === "campaign") {
      // From create flow: lead source chosen before anything is attached yet.
      setPeopleMode(peopleSrc);
    }
    setRunMode(plan.settings?.runMode === "live" ? "live" : "once");
    setCallingHoursEnabled(plan.settings?.isCallingHoursEnabled !== false);
    setHoursStart(
      typeof plan.settings?.businessHoursStart === "number" ? plan.settings.businessHoursStart : 9,
    );
    setHoursEnd(
      typeof plan.settings?.businessHoursEnd === "number" ? plan.settings.businessHoursEnd : 19,
    );
    setTimezone(
      typeof plan.settings?.timezone === "string" && plan.settings.timezone
        ? plan.settings.timezone
        : "Asia/Kolkata",
    );
    const t = plan.trigger?.type;
    setIntakeMode(t === "form_lead" || t === "instagram_lead" ? t : "manual");
    setHookUrl(plan.hookUrl ?? (plan.publicToken ? `/api/workflows/hook/${plan.publicToken}` : null));
    const savedOffset = plan.settings?.startOffset;
    const savedTotal = plan.settings?.startSourceTotal;
    if (typeof savedOffset === "number" && savedOffset > 0) {
      setContinueOffset(savedOffset);
      setLastHasMore(
        typeof savedTotal === "number" ? savedOffset < savedTotal : true,
      );
    } else {
      setContinueOffset(0);
      setLastHasMore(false);
    }
    setDirty(false);
  }, [planQ.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (agentId == null) throw new Error("Agent required");
      return customFetch<CallPlan>(`${DASH_API}/journeys/${planId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || "Call plan",
          agentId,
          steps: steps.map((s) =>
            s.type === "make_call" || s.type === "send_whatsapp" || s.type === "schedule_callback" || s.type === "join_meeting"
              ? { ...s, agentId }
              : s,
          ),
          settings: {
            ...(planQ.data?.settings ?? {}),
            peopleSource: peopleMode,
            campaignId: peopleMode === "campaign" && campaignId
              ? Number(campaignId)
              : null,
            sheetPipelineId: peopleMode === "sheet" && sheetPipelineId
              ? sheetPipelineId
              : null,
            runMode: peopleMode === "sheet" ? runMode : "once",
            isCallingHoursEnabled: callingHoursEnabled,
            businessHoursStart: callingHoursEnabled ? hoursStart : null,
            businessHoursEnd: callingHoursEnabled ? hoursEnd : null,
            timezone,
          },
          trigger: { type: intakeMode },
        }),
      });
    },
    onSuccess: (plan) => {
      qc.setQueryData(["call-plans", planId], plan);
      qc.invalidateQueries({ queryKey: ["call-plans"] });
      setHookUrl(plan.hookUrl ?? (plan.publicToken ? `/api/workflows/hook/${plan.publicToken}` : null));
      setDirty(false);
      toast({ title: "Plan saved" });
    },
    onError: (err) => {
      toast({ title: "Could not save", description: formatApiError(err), variant: "destructive" });
    },
  });

  function buildStartBody(opts?: { force?: boolean; offset?: number }): Record<string, unknown> {
    const body: Record<string, unknown> = {
      runMode: peopleMode === "sheet" ? runMode : "once",
      ...(opts?.force ? { force: true } : {}),
      ...(opts?.offset != null && opts.offset > 0 ? { offset: opts.offset } : {}),
    };
    if (peopleMode === "manual") {
      const phones = manualPhones
        .split(/[\n,;]+/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (phones.length === 0) throw new Error("Paste at least one phone number");
      body.phones = phones;
    } else if (peopleMode === "sheet") {
      if (!sheetPipelineId) throw new Error("Pick a Sheet list");
      body.sheetPipelineId = sheetPipelineId;
    } else {
      if (!campaignId) throw new Error("Pick a lead list");
      body.campaignId = Number(campaignId);
    }
    return body;
  }

  const startOnce = useMutation({
    mutationFn: async (opts?: { force?: boolean; offset?: number }) => {
      if (dirty) await save.mutateAsync();
      const body = buildStartBody(opts);
      return customFetch<StartOnceResult>(`${DASH_API}/journeys/${planId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    onSuccess: (res) => {
      setForceOpen(false);
      setPreviewOpen(false);
      setPreviewData(null);
      setPendingForce(false);
      if (res.autoFeed || res.queue) {
        setContinueOffset(0);
        setLastHasMore(false);
      } else if (res.hasMore && typeof res.nextOffset === "number") {
        setContinueOffset(res.nextOffset);
        setLastHasMore(true);
      } else {
        setContinueOffset(0);
        setLastHasMore(false);
      }
      qc.invalidateQueries({ queryKey: ["call-plans", planId] });
      qc.invalidateQueries({ queryKey: ["call-plans", planId, "runs"] });
      const total = res.sourceTotal ?? 0;
      const conc = res.concurrentLimit;
      const batchDesc = res.keepLive
        ? `${res.started} started now — new sheet rows will keep entering.`
        : res.autoFeed || res.queue
          ? `Queued ${res.started}${total > 0 ? ` of ${total}` : ""} — dials up to your concurrency${conc != null ? ` (${conc})` : ""}; the rest feed automatically.`
          : `${res.started} ${res.started === 1 ? "lead" : "leads"} walking this plan${
              res.skipped ? ` · ${res.skipped} already walked (skipped)` : ""
            }.`;
      toast({
        title: res.keepLive ? "Live" : "Dial queue started",
        description: batchDesc,
      });
    },
    onError: (err) => {
      const msg = formatApiError(err);
      if (/already walked|force=true/i.test(msg) && !pendingForce) {
        setForceOpen(true);
        return;
      }
      toast({ title: "Could not start", description: msg, variant: "destructive" });
    },
  });

  async function handleStartClick() {
    try {
      if (dirty) await save.mutateAsync();
      setPreviewPending(true);
      const body = buildStartBody({});
      const preview = await customFetch<StartPreviewResult>(
        `${DASH_API}/journeys/${planId}/start-preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (preview.wouldSkip > 0) {
        setPreviewData(preview);
        setPreviewOpen(true);
        return;
      }
      startOnce.mutate({});
    } catch (err) {
      toast({ title: "Could not start", description: formatApiError(err), variant: "destructive" });
    } finally {
      setPreviewPending(false);
    }
  }

  const setStatus = useMutation({
    mutationFn: async (action: "activate" | "pause") =>
      customFetch<CallPlan>(`${DASH_API}/journeys/${planId}/${action}`, { method: "POST" }),
    onSuccess: (plan) => {
      qc.setQueryData(["call-plans", planId], plan);
      qc.invalidateQueries({ queryKey: ["call-plans"] });
      toast({ title: plan.status === "active" ? "Resumed" : "Paused" });
    },
    onError: (err) => {
      toast({ title: "Could not update status", description: formatApiError(err), variant: "destructive" });
    },
  });

  const stopLive = useMutation({
    mutationFn: () =>
      customFetch<{ ok: boolean }>(`${DASH_API}/journeys/${planId}/stop-live`, { method: "POST" }),
    onSuccess: () => {
      setRunMode("once");
      qc.invalidateQueries({ queryKey: ["call-plans", planId] });
      toast({ title: "Drip stopped", description: "New sheet rows will no longer enter this plan." });
    },
    onError: (err) => {
      toast({ title: "Could not stop drip", description: formatApiError(err), variant: "destructive" });
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      await customFetch(`${DASH_API}/journeys/${planId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["call-plans"] });
      navigate("/app/call-plans");
    },
    onError: (err) => {
      toast({ title: "Could not delete", description: formatApiError(err), variant: "destructive" });
    },
  });

  if (!Number.isFinite(planId) || planId <= 0) {
    return (
      <StripePage title="Call plan" description="Invalid plan.">
        <Button asChild variant="outline"><Link href="/app/call-plans">Back</Link></Button>
      </StripePage>
    );
  }

  if (planQ.isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (planQ.isError || !planQ.data) {
    return (
      <StripePage title="Call plan" description="Not found." back={{ href: "/app/call-plans", label: "Call plans" }}>
        <p className="text-sm text-muted-foreground">This plan doesn’t exist or you don’t have access.</p>
      </StripePage>
    );
  }

  const plan = planQ.data;
  const selectedCampaign = campaigns.find((c) => String(c.id) === campaignId);
  const settingsOffset = typeof plan.settings?.startOffset === "number" ? plan.settings.startOffset : 0;
  const settingsTotal = typeof plan.settings?.startSourceTotal === "number" ? plan.settings.startSourceTotal : 0;
  const autoFeedOn = plan.settings?.autoFeed === true && plan.status === "active";
  const startBusy = startOnce.isPending || previewPending || save.isPending || setStatus.isPending;

  const whoTab: WhoTab =
    intakeMode === "form_lead" ? "form"
      : intakeMode === "instagram_lead" ? "meta"
        : peopleMode === "sheet" ? "sheet"
          : peopleMode === "manual" ? "paste"
            : "list";

  function setWhoTab(tab: WhoTab) {
    if (tab === "form") {
      setPeopleMode("manual");
      setIntakeMode("form_lead");
      setRunMode("once");
    } else if (tab === "meta") {
      setPeopleMode("manual");
      setIntakeMode("instagram_lead");
      setRunMode("once");
    } else if (tab === "sheet") {
      setPeopleMode("sheet");
      setIntakeMode("manual");
    } else if (tab === "paste") {
      setPeopleMode("manual");
      setIntakeMode("manual");
      setRunMode("once");
    } else {
      setPeopleMode("campaign");
      setIntakeMode("manual");
      setRunMode("once");
    }
    setDirty(true);
  }

  const isIntakeWho = whoTab === "form" || whoTab === "meta";
  const whoReady =
    isIntakeWho
    || (whoTab === "list" && Boolean(campaignId))
    || (whoTab === "sheet" && Boolean(sheetPipelineId))
    || (whoTab === "paste" && manualPhones.trim().length > 0);

  const startBlockedReason =
    steps.length === 0 ? "Pick a starter for steps first"
      : !whoReady
        ? (isIntakeWho ? "Save to mint the hook URL, then go live" : "Attach leads first")
        : null;

  const startLabel =
    isIntakeWho ? "Go live"
      : peopleMode === "sheet" && runMode === "live" ? "Start drip"
        : "Start queue";

  const peopleHint: CallPlanPeopleHint =
    whoTab === "sheet" ? "sheet"
      : whoTab === "paste" ? "manual"
        : whoTab === "form" || whoTab === "meta" ? "form"
          : "campaign";

  async function handlePrimaryStart() {
    if (startBlockedReason) return;
    if (isIntakeWho) {
      if (dirty) await save.mutateAsync();
      setStatus.mutate("activate");
      return;
    }
    void handleStartClick();
  }

  return (
    <StripePage
      title={name || plan.name}
      description="Who talks · Who to reach · What happens · Start."
      back={{ href: "/app/call-plans", label: "Call plans" }}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn("text-[10px] h-5 px-1.5 capitalize", statusClass(plan.status))}>
            {plan.status}
          </Badge>
          {autoFeedOn && (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-border/70 text-muted-foreground">
              Auto-feeding
              {settingsTotal > 0 ? ` · ${settingsOffset}/${settingsTotal}` : ""}
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save
          </Button>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              className="h-9 gap-1.5"
              disabled={startBusy || Boolean(startBlockedReason)}
              title={startBlockedReason ?? undefined}
              onClick={() => { void handlePrimaryStart(); }}
            >
              {startBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              {startLabel}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 w-9 px-0" aria-label="More actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {plan.status === "active" && (
                  <DropdownMenuItem disabled={setStatus.isPending} onClick={() => setStatus.mutate("pause")}>
                    <Pause className="size-3.5 mr-2" /> Pause
                  </DropdownMenuItem>
                )}
                {plan.status === "paused" && (
                  <DropdownMenuItem disabled={setStatus.isPending} onClick={() => setStatus.mutate("activate")}>
                    <Play className="size-3.5 mr-2" /> Resume
                  </DropdownMenuItem>
                )}
                {peopleMode === "sheet" && runMode === "live" && plan.status === "active" && (
                  <DropdownMenuItem disabled={stopLive.isPending} onClick={() => stopLive.mutate()}>
                    <Square className="size-3.5 mr-2" /> Stop drip
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="size-3.5 mr-2" /> Delete plan
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {startBlockedReason && (
            <span className="text-[10px] text-muted-foreground max-w-[140px] leading-snug hidden sm:inline">
              {startBlockedReason}
            </span>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        {(needsWhatsapp || needsEmail) && (
          <div className="flex flex-wrap gap-2 text-[11px]">
            {needsWhatsapp && (
              <span
                className={cn(
                  "rounded-md border px-2.5 py-1",
                  waReady
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-400",
                )}
              >
                WhatsApp {waReady ? "ready" : "not connected"} —{" "}
                <Link href="/app/whatsapp" className="underline underline-offset-2">Connections</Link>
              </span>
            )}
            {needsEmail && (
              <span
                className={cn(
                  "rounded-md border px-2.5 py-1",
                  emailReady
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-400",
                )}
              >
                Email {emailReady ? "ready" : "not set up"} —{" "}
                <Link href="/app/connections?setup=email" className="underline underline-offset-2">Connections</Link>
              </span>
            )}
          </div>
        )}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
          <div className="space-y-5 min-w-0">
            <section className="space-y-3 rounded-xl border border-border/50 bg-card/20 p-3.5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-[11px]">Plan name</Label>
                  <Input
                    className="h-9"
                    value={name}
                    onChange={(e) => { setName(e.target.value); setDirty(true); }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px]">Agent who talks</Label>
                  <Select
                    value={agentId != null ? String(agentId) : undefined}
                    onValueChange={(v) => {
                      setAgentId(Number(v));
                      setDirty(true);
                    }}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Choose agent…" />
                    </SelectTrigger>
                    <SelectContent>
                      {agents.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {agentId != null && (
                    <Link
                      href={`/app/agents/${agentId}`}
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      Edit agent <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              </div>
            </section>

            <section className="space-y-3 rounded-xl border border-border/60 bg-card/40 p-4 ring-1 ring-border/40">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">Who</h2>
                </div>
                <p className="text-[10px] text-muted-foreground">Leads for this plan</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { id: "list" as const, label: "List" },
                    { id: "sheet" as const, label: "Sheet" },
                    { id: "paste" as const, label: "Paste" },
                    { id: "form" as const, label: "Form" },
                    { id: "meta" as const, label: "Meta" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setWhoTab(tab.id)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-[11px] transition-colors",
                      whoTab === tab.id
                        ? "border-primary/40 bg-primary/5 font-medium"
                        : "border-border/50 text-muted-foreground hover:bg-muted/30",
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {whoTab === "list" && (
                <div className="space-y-2">
                  <Select
                    value={campaignId || undefined}
                    onValueChange={(v) => { setCampaignId(v); setDirty(true); }}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder={campaigns.length ? "Choose a list…" : "Upload a list in Leads first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {campaigns.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)} className="text-xs">
                          {c.name}
                          {typeof c.totalLeads === "number" ? ` · ${c.totalLeads}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    {selectedCampaign
                      ? (
                        <>
                          Dial queue uses your account concurrency.{" "}
                          <Link href="/app/wallet" className="underline underline-offset-2">Wallet</Link>
                        </>
                      )
                      : (
                        <>
                          No list yet?{" "}
                          <Link href="/app/people" className="underline underline-offset-2">Upload CSV under Leads</Link>
                        </>
                      )}
                  </p>
                </div>
              )}

              {whoTab === "sheet" && (
                <div className="space-y-3">
                  {sheetsQ.isLoading ? (
                    <div className="flex h-9 items-center gap-2 text-[11px] text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading sheets…
                    </div>
                  ) : sheetsQ.isError ? (
                    <p className="text-[11px] text-destructive">Could not load sheets. Reconnect under Connections.</p>
                  ) : sheetPipelines.length === 0 ? (
                    <div className="space-y-2 rounded-lg border border-dashed border-border/70 bg-muted/20 p-3">
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Connect Google under Connections, then set up one sheet.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button asChild size="sm" className="h-8 text-xs">
                          <Link href="/app/automatic-calls/new">Set up Google Sheet</Link>
                        </Button>
                        <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                          <Link href="/app/connections?setup=sheets">Connections</Link>
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Select
                      value={sheetPipelineId || undefined}
                      onValueChange={(v) => { setSheetPipelineId(v); setDirty(true); }}
                    >
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue placeholder="Choose a sheet…" />
                      </SelectTrigger>
                      <SelectContent>
                        {sheetPipelines.map((p) => (
                          <SelectItem key={p.id} value={p.id} className="text-xs">
                            {p.name}
                            {p.spreadsheetTitle ? ` · ${p.spreadsheetTitle}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => { setRunMode("once"); setDirty(true); }}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left text-[11px]",
                        runMode === "once"
                          ? "border-primary/40 bg-primary/5 font-medium"
                          : "border-border/50 hover:bg-muted/30",
                      )}
                    >
                      <p className="font-medium">Drain this list</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Queue today’s rows once</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRunMode("live"); setDirty(true); }}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left text-[11px]",
                        runMode === "live"
                          ? "border-primary/40 bg-primary/5 font-medium"
                          : "border-border/50 hover:bg-muted/30",
                      )}
                    >
                      <p className="font-medium">Drip new rows</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Keep watching the sheet</p>
                    </button>
                  </div>
                </div>
              )}

              {whoTab === "paste" && (
                <div className="space-y-1.5">
                  <Textarea
                    rows={4}
                    className="text-xs font-mono"
                    placeholder={"+9198…\n+9180…"}
                    value={manualPhones}
                    onChange={(e) => setManualPhones(e.target.value)}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    One phone per line. Dialed up to your account concurrency.
                  </p>
                </div>
              )}

              {(whoTab === "form" || whoTab === "meta") && (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {whoTab === "form"
                      ? "Website form leads enter this plan automatically."
                      : "Meta Lead Ads enter this plan automatically."}
                    {" "}
                    <Link
                      href={whoTab === "form" ? "/app/connections?setup=website" : "/app/connections?setup=meta"}
                      className="underline underline-offset-2"
                    >
                      Connections
                    </Link>
                  </p>
                  {hookUrl ? (
                    <div className="space-y-1">
                      <Label className="text-[11px]">Hook URL</Label>
                      <div className="flex gap-2">
                        <Input
                          className="h-8 text-[11px] font-mono"
                          readOnly
                          value={typeof window !== "undefined" ? `${window.location.origin}${hookUrl}` : hookUrl}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0 text-[11px]"
                          onClick={() => {
                            const full = `${window.location.origin}${hookUrl}`;
                            void navigator.clipboard.writeText(full);
                            toast({ title: "Hook URL copied" });
                          }}
                        >
                          Copy
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-amber-400">Save the plan to mint a hook URL.</p>
                  )}
                </div>
              )}
            </section>

            <details className="group rounded-xl border border-border/50 bg-card/20 open:bg-card/30">
              <summary className="cursor-pointer list-none px-3.5 py-3 flex items-center justify-between gap-2 text-[12px] font-medium [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2 text-muted-foreground group-open:text-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  More settings
                  <span className="font-normal text-[10px]">
                    Calling hours{callingHoursEnabled ? " on" : ""}
                  </span>
                </span>
                <span className="text-[10px] text-muted-foreground group-open:hidden">Show</span>
                <span className="text-[10px] text-muted-foreground hidden group-open:inline">Hide</span>
              </summary>
              <div className="space-y-3 border-t border-border/50 px-3.5 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-[12px] font-semibold">Calling hours</h3>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Queue holds outside this window.
                    </p>
                  </div>
                  <Switch
                    checked={callingHoursEnabled}
                    onCheckedChange={(v) => { setCallingHoursEnabled(v); setDirty(true); }}
                  />
                </div>
                {callingHoursEnabled && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-[11px]">Start</Label>
                      <Select
                        value={String(hoursStart)}
                        onValueChange={(v) => { setHoursStart(Number(v)); setDirty(true); }}
                      >
                        <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {HOUR_OPTIONS.map((h) => (
                            <SelectItem key={h.value} value={h.value} className="text-xs">{h.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px]">End</Label>
                      <Select
                        value={String(hoursEnd)}
                        onValueChange={(v) => { setHoursEnd(Number(v)); setDirty(true); }}
                      >
                        <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {HOUR_OPTIONS.map((h) => (
                            <SelectItem key={h.value} value={h.value} className="text-xs">{h.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px]">Timezone</Label>
                      <Select
                        value={timezone}
                        onValueChange={(v) => { setTimezone(v); setDirty(true); }}
                      >
                        <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CALL_PLAN_TIMEZONES.map((tz) => (
                            <SelectItem key={tz} value={tz} className="text-xs">{tz}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>
            </details>
          </div>

          {/* Steps */}
          <div className="space-y-5 min-w-0">
            <section className="space-y-3 rounded-xl border border-border/60 bg-card/40 p-4 ring-1 ring-border/40">
              <div>
                <h2 className="text-sm font-semibold">What happens next</h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Ordered steps for each lead. Pick a starter when empty.
                </p>
              </div>
              {agentId != null ? (
                <CallPlanStepEditor
                  steps={steps}
                  agentId={agentId}
                  peopleHint={peopleHint}
                  onChange={(next) => { setSteps(next); setDirty(true); }}
                />
              ) : (
                <p className="text-[12px] text-muted-foreground">Pick an agent first.</p>
              )}
            </section>
          </div>
        </div>

        {/* Compact activity summary — full log on dedicated page */}
        <CallPlanActivitySummary planId={plan.id} totalRuns={plan.totalRuns} />
      </div>

      <AlertDialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Some leads already walked this plan</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  {previewData
                    ? `${previewData.wouldSkip} would be skipped · ${previewData.wouldStart} would start`
                    : "Some numbers already have a run on this plan."}
                </p>
                {previewData?.sampleSkipped && previewData.sampleSkipped.length > 0 && (
                  <ul className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-[11px] font-mono space-y-0.5 max-h-32 overflow-y-auto">
                    {previewData.sampleSkipped.map((p) => (
                      <li key={p.phone}>
                        {p.phone}
                        {p.name ? ` · ${p.name}` : ""}
                      </li>
                    ))}
                    {previewData.wouldSkip > previewData.sampleSkipped.length && (
                      <li className="text-muted-foreground/70">
                        +{previewData.wouldSkip - previewData.sampleSkipped.length} more
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                startOnce.mutate({});
              }}
            >
              Start (skip dups)
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                setPendingForce(true);
                startOnce.mutate({ force: true });
              }}
            >
              Re-dial all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={forceOpen} onOpenChange={setForceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-dial leads already on this plan?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone in this list already walked this plan. Start again only if you want to call them again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingForce(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setPendingForce(true);
                startOnce.mutate({ force: true });
              }}
            >
              Re-dial anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this call plan?</AlertDialogTitle>
            <AlertDialogDescription>
              Stops future starts. Past runs and calls are kept in History.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => remove.mutate()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </StripePage>
  );
}
