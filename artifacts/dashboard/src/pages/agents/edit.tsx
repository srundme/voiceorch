import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, Save, Bot, Plus, Trash2, PhoneForwarded, Webhook, ChevronDown, ChevronUp, BookOpen, Sparkles, List, Pencil, X, ToggleLeft, ToggleRight } from "lucide-react";
import {
  useGetAgent,
  useUpdateAgent,
  getGetAgentQueryKey,
  getListAgentsQueryKey,
  useListCalendars,
  useListEventTypes,
  useRunToolTest,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch, useFieldArray } from "react-hook-form";
import { agentFormSchema, type AgentFormValues } from "./edit.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatApiError, mapApiErrors } from "@/lib/format-api-error";
import {
  ASR_PROVIDERS,
  AGENT_TIMEZONES,
  LLM_PROVIDERS,
  TTS_PROVIDERS,
  LANGUAGES,
  ASR_MODELS,
  LLM_MODELS,
  TTS_MODELS,
  TTS_VOICES,
  getModelError,
  isTamilLanguage,
  defaultGeminiModel,
} from "@/lib/agent-providers";

export type { AgentFormValues } from "./edit.schema";

export function buildUpdateAgentPayload(data: AgentFormValues) {
  const {
    webhookSecret, promptVariables, vadSilenceMs, bargeInEnabled, bargeInEnergyThreshold, bargeInMinFrames,
    timezone, autoSwitchToEnglish, machineDetectionMode, voicemailAction, voicemailMessage, genderDetectionEnabled, recordingEnabled,
    startSpeakingWaitSecs, startSpeakingOnPunctuationSecs, startSpeakingOnNoPunctuationSecs, startSpeakingOnNumberSecs,
    stopSpeakingNumWords, stopSpeakingVoiceSecs, stopSpeakingBackOffSecs,
    complianceIrdai, complianceDpdp, complianceHipaa, complianceTrai,
    snapserveAgentId,
    contextWindowTurns, summarizationEnabled,
    stagedPromptEnabled, stagedPromptStages, stagedPromptCoreIdentity,
    ambientNoiseEnabled, ambientNoiseTrack,
    preferredManagedNumber,
    asrEndpointingSilenceMs, llmMaxTokens, ttsMinSentenceChars, linearDelayMs,
    ...rest
  } = data;
  const agentConfig: Record<string, unknown> = {};
  if (webhookSecret) agentConfig["webhookSecret"] = webhookSecret;
  if (promptVariables?.length) agentConfig["promptVariables"] = promptVariables;
  if (vadSilenceMs != null && vadSilenceMs !== 250) agentConfig["vadSilenceMs"] = vadSilenceMs;
  if (bargeInEnabled === false) agentConfig["bargeInEnabled"] = false;
  if (bargeInEnergyThreshold != null && bargeInEnergyThreshold !== 1200) agentConfig["bargeInEnergyThreshold"] = bargeInEnergyThreshold;
  if (bargeInMinFrames != null && bargeInMinFrames !== 4) agentConfig["bargeInMinFrames"] = bargeInMinFrames;
  if (timezone) agentConfig["timezone"] = timezone;
  agentConfig["autoSwitchToEnglish"] = !!autoSwitchToEnglish;
  if (machineDetectionMode && machineDetectionMode !== "disabled") agentConfig["machineDetectionMode"] = machineDetectionMode;
  if (voicemailAction && voicemailAction !== "hangup") agentConfig["voicemailAction"] = voicemailAction;
  if (voicemailMessage) agentConfig["voicemailMessage"] = voicemailMessage;
  agentConfig["genderDetectionEnabled"] = !!genderDetectionEnabled;
  agentConfig["recordingEnabled"] = !!recordingEnabled;
  agentConfig["summarizationEnabled"] = !!summarizationEnabled;
  agentConfig["ambientNoiseEnabled"] = !!ambientNoiseEnabled;
  if (ambientNoiseTrack) agentConfig["ambientNoiseTrack"] = ambientNoiseTrack;
  if (preferredManagedNumber) agentConfig["preferredManagedNumber"] = preferredManagedNumber;
  if (asrEndpointingSilenceMs != null && asrEndpointingSilenceMs !== 400) agentConfig["asrEndpointingSilenceMs"] = asrEndpointingSilenceMs;
  if (llmMaxTokens != null) agentConfig["llmMaxTokens"] = llmMaxTokens;
  if (ttsMinSentenceChars != null && ttsMinSentenceChars !== 15) agentConfig["ttsMinSentenceChars"] = ttsMinSentenceChars;
  if (linearDelayMs != null && linearDelayMs > 0) agentConfig["incrementalDelay"] = linearDelayMs;
  agentConfig["startSpeakingPlan"] = {
    waitSeconds:            startSpeakingWaitSecs          ?? 0,
    onPunctuationSeconds:   startSpeakingOnPunctuationSecs ?? 0.1,
    onNoPunctuationSeconds: startSpeakingOnNoPunctuationSecs ?? 1.5,
    onNumberSeconds:        startSpeakingOnNumberSecs      ?? 0.5,
  };
  agentConfig["stopSpeakingPlan"] = {
    numWords:       stopSpeakingNumWords    ?? 0,
    voiceSeconds:   stopSpeakingVoiceSecs   ?? 0.2,
    backOffSeconds: stopSpeakingBackOffSecs ?? 1,
  };
  agentConfig["compliance"] = {
    irdai: !!complianceIrdai,
    dpdp:  !!complianceDpdp,
    hipaa: !!complianceHipaa,
    trai:  !!complianceTrai,
  };

  const NATIVE_BOOKING_TYPES = new Set(["native_booking", "native_check_availability", "native_list_bookings", "native_reschedule", "native_cancel"]);

  const serializedTools = (rest.tools ?? []).map((t) => {
    // For native scheduling tools: preserve timezone and eventTypeId, strip only calendarId (UI-only hint)
    if (NATIVE_BOOKING_TYPES.has(t.type)) {
      const { calendarId: _cal, ...nativeTool } = t as any;
      return nativeTool;
    }
    const toolWithCoercedIds = {
      ...t,
      ...(t.calendarId != null ? { calendarId: Number(t.calendarId) } : {}),
      ...(t.eventTypeId != null ? { eventTypeId: Number(t.eventTypeId) } : {}),
    };
    if (t.type !== "webhook") return toolWithCoercedIds;
    const { parameters, ...toolRest } = toolWithCoercedIds;
    const paramList = parameters ?? [];
    const jsonSchema = paramList.length > 0 ? {
      type: "object" as const,
      properties: Object.fromEntries(
        paramList.map((p) => [p.paramName, { type: p.dataType, ...(p.paramDescription ? { description: p.paramDescription } : {}) }])
      ),
      required: paramList.filter((p) => p.required).map((p) => p.paramName),
    } : undefined;
    return { ...toolRest, ...(jsonSchema ? { parameters: jsonSchema } : {}) };
  });

  return {
    ...rest,
    firstSpeaker: rest.firstSpeaker === "user" ? "user" : "assistant",
    tools: serializedTools,
    asrLanguage: rest.asrLanguage || null,
    snapserveAgentId: snapserveAgentId || null,
    contextWindowTurns: contextWindowTurns ?? null,
    stagedPromptEnabled: stagedPromptEnabled ?? false,
    stagedPromptStages: stagedPromptStages ?? [],
    stagedPromptCoreIdentity: stagedPromptCoreIdentity || undefined,
    ...(Object.keys(agentConfig).length > 0 ? { agentConfig } : {}),
  };
}

/* ── Smart model select ───────────────────────────────────────────────────── */

function ModelSelect({
  options, value, onChange, placeholder,
}: {
  options: { value: string; label: string }[];
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Select value={value ?? ""} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder ?? "Select model"} />
      </SelectTrigger>
      <SelectContent>
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/* ── Webhook parameter editor ─────────────────────────────────────────────── */

import type { Control } from "react-hook-form";

export function StagedPromptEditor({ control }: { control: Control<AgentFormValues> }) {
  const { fields, append, remove } = useFieldArray({ control, name: "stagedPromptStages" as any });
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Stages</span>
        <Button type="button" variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => append({ name: "", content: "" })}>
          <Plus className="h-3 w-3 mr-1" /> Add Stage
        </Button>
      </div>
      {fields.length === 0 && (
        <p className="text-[10px] text-muted-foreground italic">No stages defined yet. Add a stage to get started.</p>
      )}
      {fields.map((stage, idx) => (
        <div key={stage.id} className="rounded-lg border border-border p-3 space-y-2 bg-muted/10">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground font-mono w-4">{idx + 1}.</span>
            <FormField control={control} name={`stagedPromptStages.${idx}.name` as any} render={({ field: f }) => (
              <FormItem className="flex-1 space-y-0">
                <FormControl><Input placeholder="Stage name (e.g. Greeting)" className="h-7 text-xs" {...f} /></FormControl>
                <FormMessage className="text-[10px]" />
              </FormItem>
            )} />
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0" onClick={() => remove(idx)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <FormField control={control} name={`stagedPromptStages.${idx}.content` as any} render={({ field: f }) => (
            <FormItem className="space-y-0">
              <FormControl><Textarea placeholder="System prompt content for this stage…" className="min-h-[80px] text-xs" {...f} /></FormControl>
              <FormMessage className="text-[10px]" />
            </FormItem>
          )} />
        </div>
      ))}
    </div>
  );
}

function WebhookParamsEditor({ control, toolIndex }: { control: Control<AgentFormValues>; toolIndex: number }) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: `tools.${toolIndex}.parameters` as any,
  });
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Parameters (LLM arguments)</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 text-xs px-2"
          onClick={() => append({ paramName: "", dataType: "string", paramDescription: "", required: false })}
        >
          <Plus className="h-3 w-3 mr-1" /> Add Param
        </Button>
      </div>
      {fields.length === 0 && (
        <p className="text-[10px] text-muted-foreground italic">No parameters — the LLM will pass a generic reason string.</p>
      )}
      {fields.map((param, pIdx) => (
        <div key={param.id} className="grid grid-cols-[1fr_100px_1fr_60px_24px] gap-2 items-start">
          <FormField control={control} name={`tools.${toolIndex}.parameters.${pIdx}.paramName` as any} render={({ field: f }) => (
            <FormItem className="space-y-0">
              <FormControl><Input placeholder="param_name" className="h-7 text-xs" {...f} /></FormControl>
              <FormMessage className="text-[10px]" />
            </FormItem>
          )} />
          <FormField control={control} name={`tools.${toolIndex}.parameters.${pIdx}.dataType` as any} render={({ field: f }) => (
            <FormItem className="space-y-0">
              <Select value={f.value ?? "string"} onValueChange={f.onChange}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="string">string</SelectItem>
                  <SelectItem value="number">number</SelectItem>
                  <SelectItem value="boolean">boolean</SelectItem>
                </SelectContent>
              </Select>
            </FormItem>
          )} />
          <FormField control={control} name={`tools.${toolIndex}.parameters.${pIdx}.paramDescription` as any} render={({ field: f }) => (
            <FormItem className="space-y-0">
              <FormControl><Input placeholder="Description for LLM" className="h-7 text-xs" {...f} /></FormControl>
            </FormItem>
          )} />
          <FormField control={control} name={`tools.${toolIndex}.parameters.${pIdx}.required` as any} render={({ field: f }) => (
            <FormItem className="space-y-0 flex items-center gap-1 pt-1">
              <FormControl>
                <Switch checked={!!f.value} onCheckedChange={f.onChange} className="scale-75 origin-left" />
              </FormControl>
              <span className="text-[10px] text-muted-foreground">req</span>
            </FormItem>
          )} />
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => remove(pIdx)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function AgentEdit() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: agent, isLoading } = useGetAgent(id, {
    query: { enabled: !!id, queryKey: getGetAgentQueryKey(id), staleTime: Infinity }
  });

  const formInitialized = useRef(false);

  const updateAgent = useUpdateAgent();

  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: {
      name: "", description: "", asrProvider: "azure", asrModel: "",
      llmProvider: "openai", llmModel: "", ttsProvider: "elevenlabs",
      ttsVoice: "", ttsModel: "", telephonyProvider: "twilio",
      systemPrompt: "", temperature: 0.10, maxDuration: 300,
      firstSpeaker: "assistant", endCallPhrases: "", silenceTimeoutSeconds: 30,
      language: "en-US", asrLanguage: "", backchannelingEnabled: true, backchannelingFrequency: 0.5,
      webhookUrl: "", webhookSecret: "", noiseCancellationEnabled: true,
      ambientNoiseEnabled: false, ambientNoiseTrack: "",
      promptVariables: [], vadSilenceMs: 250, bargeInEnabled: true, bargeInEnergyThreshold: 1200, bargeInMinFrames: 4,
      timezone: "",
      autoSwitchToEnglish: false,
      machineDetectionMode: "disabled", voicemailAction: "hangup",
      voicemailMessage: "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you.",
      tools: [],
      genderDetectionEnabled: false,
      recordingEnabled: false,
      snapserveAgentId: "",
      contextWindowTurns: undefined,
      summarizationEnabled: false,
      stagedPromptEnabled: false,
      stagedPromptStages: [],
      stagedPromptCoreIdentity: "",
      asrEndpointingSilenceMs: 400,
      llmMaxTokens: undefined,
      ttsMinSentenceChars: 15,
      linearDelayMs: 0,
    },
  });

  const { fields: toolFields, append: appendTool, remove: removeTool } = useFieldArray({
    control: form.control,
    name: "tools",
  });

  const { data: calendarsData } = useListCalendars();
  const agentCalendar = (calendarsData ?? []).find((cal: any) => cal.agentId === id);
  const calendarIdForEt = agentCalendar?.id;
  const { data: agentEventTypes } = useListEventTypes(
    calendarIdForEt ? { calendarId: calendarIdForEt } : undefined,
    { query: { enabled: !!calendarIdForEt, queryKey: ["agent-event-types", calendarIdForEt ?? null] } }
  );

  // Reset eventTypeId on native_list_bookings whenever the assigned calendar changes
  const prevCalendarIdRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (prevCalendarIdRef.current === undefined) {
      prevCalendarIdRef.current = calendarIdForEt;
      return;
    }
    if (prevCalendarIdRef.current !== calendarIdForEt) {
      prevCalendarIdRef.current = calendarIdForEt;
      const tools = form.getValues("tools") ?? [];
      const typesToReset = ["native_booking", "native_check_availability", "native_list_bookings", "native_reschedule", "native_cancel"];
      (tools as any[]).forEach((t: any, idx: number) => {
        if (typesToReset.includes(t.type)) {
          form.setValue(`tools.${idx}.eventTypeId` as any, undefined);
        }
      });
    }
  }, [calendarIdForEt]);

  const NATIVE_TOOL_TYPES = ["native_booking", "native_check_availability", "native_list_bookings", "native_reschedule", "native_cancel"];
  const watchedTools = (form.watch("tools") ?? []) as any[];
  const hasNativeTool = (type: string) => watchedTools.some((t: any) => t.type === type);
  const nativeToolIndex = (type: string) => watchedTools.findIndex((t: any) => t.type === type);
  const EDIT_TOOL_FN_NAMES: Record<string, string> = {
    native_booking: "book_appointment",
    native_check_availability: "check_availability",
    native_list_bookings: "list_bookings",
    native_reschedule: "reschedule_booking",
    native_cancel: "cancel_booking",
  };

  const toggleNativeTool = (type: string) => {
    const idx = nativeToolIndex(type);
    if (idx >= 0) { removeTool(idx); } else {
      appendTool({ type: type as any, name: EDIT_TOOL_FN_NAMES[type] ?? "", description: "" });
      const bookingTypes = ["native_booking", "native_check_availability", "native_list_bookings", "native_reschedule", "native_cancel"];
      if (bookingTypes.includes(type)) {
        if (!agentCalendar) {
          toast({ title: "No calendar configured", description: "No calendar configured for this agent. Go to Settings → Calendar to set one up.", variant: "destructive" });
        } else if (!(agentCalendar as any).connectedGoogleEmail) {
          toast({ title: "No Google account connected", description: `Connect a Google account to the "${agentCalendar.name}" calendar in Scheduling.`, variant: "destructive" });
        } else if ((agentEventTypes ?? []).length === 0 && ["native_booking", "native_check_availability", "native_list_bookings"].includes(type)) {
          toast({ title: "No event types found", description: "Create an event type in Scheduling before using this tool.", variant: "destructive" });
        }
      }
    }
  };

  const BOOKING_TOOLS = [
    { type: "native_booking", fnName: "book_appointment", icon: <BookOpen className="h-4 w-4" />, color: "emerald", label: "Book Appointment", description: "Lets the agent book a meeting slot for the caller. Agent collects name, email, and preferred time, then confirms the booking live." },
    { type: "native_check_availability", fnName: "check_availability", icon: <Sparkles className="h-4 w-4" />, color: "sky", label: "Check Availability", description: "Enables the agent to look up open slots before suggesting a time. Use alongside Book Appointment for a natural booking flow." },
    { type: "native_list_bookings", fnName: "list_bookings", icon: <List className="h-4 w-4" />, color: "violet", label: "List Bookings", description: "Allows the agent to retrieve existing bookings for the caller — useful for reschedule or cancellation flows." },
    { type: "native_reschedule", fnName: "reschedule_booking", icon: <Pencil className="h-4 w-4" />, color: "amber", label: "Reschedule Booking", description: "Lets the agent reschedule an existing booking to a new time slot chosen by the caller." },
    { type: "native_cancel", fnName: "cancel_booking", icon: <X className="h-4 w-4" />, color: "red", label: "Cancel Booking", description: "Allows the agent to cancel an upcoming booking on the caller's request." },
  ] as const;

  const BOOKING_TOOL_SCHEMAS: Record<string, object> = {
    native_booking: {
      name: "book_appointment",
      description: "Book an appointment for the caller.",
      parameters: {
        type: "object",
        properties: {
          attendee_name: { type: "string", description: "Full name of the person being booked" },
          attendee_email: { type: "string", description: "Email address of the person being booked" },
          preferred_date: { type: "string", description: "Optional preferred date/time, e.g. 'next Tuesday' or '2026-06-10'" },
          meeting_type: { type: "string", enum: ["google_meet", "in_person"], description: "Meeting format" },
          meeting_address: { type: "string", description: "Physical address (required when meeting_type is in_person)" },
        },
        required: ["attendee_name", "attendee_email"],
      },
    },
    native_check_availability: {
      name: "check_availability",
      description: "Check available appointment slots.",
      parameters: {
        type: "object",
        properties: {
          preferred_date: { type: "string", description: "Optional preferred date/time to check, e.g. 'tomorrow morning'" },
          timezone: { type: "string", description: "IANA timezone, e.g. 'America/New_York'" },
        },
        required: [],
      },
    },
    native_list_bookings: {
      name: "list_bookings",
      description: "List existing bookings for the caller.",
      parameters: {
        type: "object",
        properties: {
          attendee_name: { type: "string", description: "Full name of the caller whose bookings to look up" },
          timezone: { type: "string", description: "IANA timezone for formatting dates" },
        },
        required: ["attendee_name"],
      },
    },
    native_reschedule: {
      name: "reschedule_booking",
      description: "Reschedule an existing booking to a new time slot.",
      parameters: {
        type: "object",
        properties: {
          booking_id: { type: "string", description: "The booking reference ID to reschedule" },
          preferred_date: { type: "string", description: "Optional new preferred date/time" },
        },
        required: ["booking_id"],
      },
    },
    native_cancel: {
      name: "cancel_booking",
      description: "Cancel an upcoming booking on the caller's request.",
      parameters: {
        type: "object",
        properties: {
          booking_id: { type: "string", description: "The booking reference ID to cancel" },
        },
        required: ["booking_id"],
      },
    },
  };

  const [schemaViewType, setSchemaViewType] = useState<string | null>(null);

  const bookingColorMap: Record<string, { border: string; bg: string; iconBg: string; iconText: string; label: string; badge: string; badgeText: string }> = {
    emerald: { border: "border-emerald-400/40", bg: "bg-emerald-950/10", iconBg: "bg-emerald-500/15", iconText: "text-emerald-400", label: "text-emerald-300", badge: "bg-emerald-500/20", badgeText: "text-emerald-300" },
    sky:     { border: "border-sky-400/40",     bg: "bg-sky-950/10",     iconBg: "bg-sky-500/15",     iconText: "text-sky-400",     label: "text-sky-300",     badge: "bg-sky-500/20",     badgeText: "text-sky-300"     },
    violet:  { border: "border-violet-400/40",  bg: "bg-violet-950/10",  iconBg: "bg-violet-500/15",  iconText: "text-violet-400",  label: "text-violet-300",  badge: "bg-violet-500/20",  badgeText: "text-violet-300"  },
    amber:   { border: "border-amber-400/40",   bg: "bg-amber-950/10",   iconBg: "bg-amber-500/15",   iconText: "text-amber-400",   label: "text-amber-300",   badge: "bg-amber-500/20",   badgeText: "text-amber-300"   },
    red:     { border: "border-red-400/40",     bg: "bg-red-950/10",     iconBg: "bg-red-500/15",     iconText: "text-red-400",     label: "text-red-300",     badge: "bg-red-500/20",     badgeText: "text-red-300"     },
  };

  const { fields: promptVarFields, append: appendPromptVar, remove: removePromptVar } = useFieldArray({
    control: form.control,
    name: "promptVariables",
  });

  useEffect(() => {
    // Only populate the form once — the first time agent data arrives.
    // Subsequent query refetches or cache invalidations must NOT reset the
    // form, or the user would lose any unsaved changes mid-edit.
    if (!agent || formInitialized.current) return;
    formInitialized.current = true;
    form.reset({
      name:              agent.name,
      description:       agent.description ?? "",
      asrProvider:       agent.asrProvider,
      asrModel:          agent.asrModel || ASR_MODELS[agent.asrProvider]?.[0]?.value || "",
      llmProvider:       agent.llmProvider,
      llmModel:          agent.llmModel ?? "",
      ttsProvider:       agent.ttsProvider,
      ttsVoice:          agent.ttsVoice ?? "",
      ttsModel:          agent.ttsModel || TTS_MODELS[agent.ttsProvider]?.[0]?.value || "",
      telephonyProvider: agent.telephonyProvider,
      systemPrompt:      agent.systemPrompt,
      temperature:       agent.temperature ?? 0.10,
      maxDuration:       agent.maxDuration ?? 300,
      firstSpeaker:            ((agent as any).firstSpeaker === "user" ? "user" : "assistant") as AgentFormValues["firstSpeaker"],
      endCallPhrases:          agent.endCallPhrases ?? "",
      silenceTimeoutSeconds:   agent.silenceTimeoutSeconds ?? 30,
      language:                agent.language ?? "en-US",
      asrLanguage:             agent.asrLanguage ?? "",
      backchannelingEnabled:    agent.backchannelingEnabled ?? true,
      backchannelingFrequency:  agent.backchannelingFrequency ?? 0.5,
      webhookUrl:               (agent.webhookUrl && agent.webhookUrl.startsWith("https://")) ? agent.webhookUrl : "",
      webhookSecret:            ((agent as any).agentConfig?.webhookSecret as string | undefined) ?? "",
      noiseCancellationEnabled: agent.noiseCancellationEnabled ?? true,
      ambientNoiseEnabled:      ((agent as any).agentConfig?.ambientNoiseEnabled as boolean | undefined) ?? false,
      ambientNoiseTrack:        ((agent as any).agentConfig?.ambientNoiseTrack as string | undefined) ?? "",
      promptVariables:          (((agent as any).agentConfig?.promptVariables ?? []) as AgentFormValues["promptVariables"]),
      vadSilenceMs:             ((agent as any).agentConfig?.vadSilenceMs as number | undefined) ?? 250,
      bargeInEnabled:           ((agent as any).agentConfig?.bargeInEnabled as boolean | undefined) ?? true,
      bargeInEnergyThreshold:   ((agent as any).agentConfig?.bargeInEnergyThreshold as number | undefined) ?? 1200,
      bargeInMinFrames:         ((agent as any).agentConfig?.bargeInMinFrames as number | undefined) ?? 4,
      timezone:                 ((agent as any).agentConfig?.timezone as string | undefined) ?? "",
      autoSwitchToEnglish:      ((agent as any).agentConfig?.autoSwitchToEnglish as boolean | undefined) ?? false,
      machineDetectionMode:     ((agent as any).agentConfig?.machineDetectionMode as string | undefined) as AgentFormValues["machineDetectionMode"] ?? "disabled",
      voicemailAction:          ((agent as any).agentConfig?.voicemailAction as string | undefined) as AgentFormValues["voicemailAction"] ?? "hangup",
      voicemailMessage:         ((agent as any).agentConfig?.voicemailMessage as string | undefined) ?? "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you.",
      tools: (agent.tools ?? []) as AgentFormValues["tools"],
      genderDetectionEnabled: (agent as any).agentConfig?.genderDetectionEnabled ?? false,
      recordingEnabled: (agent as any).agentConfig?.recordingEnabled ?? false,
      snapserveAgentId: (agent as any).snapserveAgentId ?? "",
      contextWindowTurns: (agent as any).contextWindowTurns ?? undefined,
      summarizationEnabled: (agent as any).agentConfig?.summarizationEnabled ?? false,
      stagedPromptEnabled: (agent as any).stagedPromptEnabled ?? false,
      stagedPromptStages: (agent as any).stagedPromptStages ?? [],
      stagedPromptCoreIdentity: (agent as any).stagedPromptCoreIdentity ?? "",
      asrEndpointingSilenceMs: ((agent as any).agentConfig?.asrEndpointingSilenceMs as number | undefined) ?? 400,
      llmMaxTokens: ((agent as any).agentConfig?.llmMaxTokens as number | null | undefined) ?? null,
      ttsMinSentenceChars: ((agent as any).agentConfig?.ttsMinSentenceChars as number | undefined) ?? 15,
      linearDelayMs: ((agent as any).agentConfig?.incrementalDelay as number | undefined) ?? 0,
    });
  }, [agent]);

  const asrProvider = useWatch({ control: form.control, name: "asrProvider" });
  const llmProvider = useWatch({ control: form.control, name: "llmProvider" });
  const ttsProvider = useWatch({ control: form.control, name: "ttsProvider" });
  const backchannelingEnabled = useWatch({ control: form.control, name: "backchannelingEnabled" });
  const backchannelingFrequency = useWatch({ control: form.control, name: "backchannelingFrequency" });

  const onSubmit = (data: AgentFormValues) => {
    const submitData = buildUpdateAgentPayload(data);
    updateAgent.mutate(
      { id, data: submitData as any },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(id) });
          toast({ title: "Agent updated", description: "Changes saved successfully." });
          setLocation(`/app/agents/${id}`);
        },
        onError: (err: unknown) => {
          const fieldErrors = mapApiErrors(err);
          const fieldKeys = Object.keys(fieldErrors);
          if (fieldKeys.length > 0) {
            for (const [field, message] of Object.entries(fieldErrors)) {
              form.setError(field as Parameters<typeof form.setError>[0], { type: "server", message });
            }
            toast({ title: "Validation Error", description: "Please fix the highlighted fields.", variant: "destructive" });
          } else {
            toast({ title: "Error", description: formatApiError(err), variant: "destructive" });
          }
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-10 w-[200px]" />
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    );
  }

  if (!agent) {
    return <div className="p-8 text-center text-muted-foreground">Agent not found.</div>;
  }

  return (
    <div className="flex-1 space-y-6 p-6 md:p-8 pt-6 max-w-5xl mx-auto h-full flex flex-col">
      <div className="flex items-center gap-4">
        <Link href={`/app/agents/${id}`}>
          <Button variant="outline" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            Edit Agent
          </h2>
          <p className="text-muted-foreground">Update the configuration for <strong>{agent.name}</strong>.</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pb-20">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* ── General ── */}
            <Card>
              <CardHeader>
                <CardTitle>General Information</CardTitle>
                <CardDescription>Basic details about your agent.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Agent Name</FormLabel>
                    <FormControl><Input placeholder="e.g. Sales Assistant" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (Optional)</FormLabel>
                    <FormControl><Input placeholder="e.g. Handles inbound sales inquiries" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            {/* ── AI Behavior ── */}
            <Card>
              <CardHeader>
                <CardTitle>AI Behavior</CardTitle>
                <CardDescription>Configure how the agent responds.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="systemPrompt" render={({ field }) => (
                  <FormItem>
                    <FormLabel>System Prompt</FormLabel>
                    <FormControl>
                      <Textarea placeholder="You are a helpful assistant..." className="min-h-[120px] font-mono text-sm" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* ── Prompt Variables ── */}
                <div className="space-y-3 rounded-md border p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium leading-none">Prompt Variables</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Define <code>{"{{key}}"}</code> placeholders for your system prompt. Defaults are used unless overridden by inbound call parameters.
                      </p>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="gap-1"
                      onClick={() => appendPromptVar({ key: "", defaultValue: "", description: "" })}>
                      <Plus className="h-3.5 w-3.5" /> Add Variable
                    </Button>
                  </div>
                  {promptVarFields.length > 0 && (
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {promptVarFields.map((field, index) => (
                        <div key={field.id} className="relative grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 border rounded-md bg-muted/20">
                          <Button type="button" variant="ghost" size="icon"
                            className="absolute top-2 right-2 h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => removePromptVar(index)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                          <FormField control={form.control} name={`promptVariables.${index}.key`} render={({ field: f }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Key</FormLabel>
                              <FormControl><Input placeholder="e.g. customer_name" className="h-8 text-sm" {...f} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={form.control} name={`promptVariables.${index}.defaultValue`} render={({ field: f }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Default Value</FormLabel>
                              <FormControl><Input placeholder="e.g. valued customer" className="h-8 text-sm" {...f} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={form.control} name={`promptVariables.${index}.description`} render={({ field: f }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Description <span className="text-muted-foreground">(optional)</span></FormLabel>
                              <FormControl><Input placeholder="e.g. The caller's first name" className="h-8 text-sm" {...f} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <FormField control={form.control} name="timezone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Timezone</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="No timezone (server UTC used)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="max-h-64">
                        {AGENT_TIMEZONES.map(tz => (
                          <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>Current date &amp; time in this timezone is injected into every LLM call so the agent knows the time.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="temperature" render={({ field }) => (
                  <FormItem>
                    <div className="flex justify-between items-center mb-2">
                      <FormLabel>Temperature: {field.value}</FormLabel>
                    </div>
                    <FormControl>
                      <Slider min={0} max={2} step={0.1} value={[field.value ?? 0.7]}
                        onValueChange={(vals) => field.onChange(vals[0])} />
                    </FormControl>
                    <FormDescription>Higher = more creative. Lower = more deterministic.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            {/* ── Conversation Behavior ── */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Conversation Behavior</CardTitle>
                <CardDescription>Control how the agent opens, responds, and ends calls.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <FormField control={form.control} name="endCallPhrases" render={({ field }) => (
                      <FormItem>
                        <FormLabel>End-Call Phrases</FormLabel>
                        <FormControl>
                          <Input placeholder="goodbye, bye, have a great day, thank you for calling" {...field} />
                        </FormControl>
                        <FormDescription>Comma-separated. Triggers automatic hangup when detected.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="autoSwitchToEnglish" render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Auto Switch to English</FormLabel>
                        <div className="flex items-center gap-3 pt-2">
                          <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                          <span className="text-sm text-muted-foreground">{field.value ? "Enabled" : "Disabled"}</span>
                        </div>
                        <FormDescription>When enabled, the agent switches to English mid-conversation if the caller requests it, while defaulting to the primary language.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField control={form.control} name="language" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Language</FormLabel>
                          <Select onValueChange={(v) => {
                            field.onChange(v);
                            if (isTamilLanguage(v)) {
                              form.setValue("llmProvider", "google");
                              form.setValue("llmModel", defaultGeminiModel());
                            }
                          }} value={field.value ?? ""}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select language" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {LANGUAGES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormDescription>Passed to ASR + TTS.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} />

                      <FormField control={form.control} name="silenceTimeoutSeconds" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Silence Timeout (s)</FormLabel>
                          <FormControl>
                            <Input type="number" min={5} max={300} placeholder="30" {...field}
                              onChange={(e) => field.onChange(parseInt(e.target.value, 10))} />
                          </FormControl>
                          <FormDescription>Hang up after N seconds silence.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>

                    <FormField control={form.control} name="asrLanguage" render={({ field }) => (
                      <FormItem>
                        <FormLabel>ASR Language Override</FormLabel>
                        <FormControl><Input placeholder="e.g. en-IN, hi, ta-IN (leave blank to use Language above)" {...field} /></FormControl>
                        <FormDescription className="text-[11px]">Overrides the general language for ASR only. Leave blank to use the Language field above.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <div className="space-y-3 p-4 border rounded-md bg-muted/20">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium leading-none">Noise Cancellation</p>
                          <p className="text-xs text-muted-foreground mt-1">Request noise reduction from the ASR provider</p>
                        </div>
                        <FormField control={form.control} name="noiseCancellationEnabled" render={({ field }) => (
                          <FormItem>
                            <Select onValueChange={(v) => field.onChange(v === "true")} value={field.value ? "true" : "false"}>
                              <FormControl><SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="false">Off</SelectItem>
                                <SelectItem value="true">On</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )} />
                      </div>
                    </div>

                    <div className="space-y-3 p-4 border rounded-md bg-muted/20">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium leading-none">Backchanneling</p>
                          <p className="text-xs text-muted-foreground mt-1">Agent says "I see", "Got it" etc. while thinking</p>
                        </div>
                        <FormField control={form.control} name="backchannelingEnabled" render={({ field }) => (
                          <FormItem>
                            <Select onValueChange={(v) => field.onChange(v === "true")} value={field.value ? "true" : "false"}>
                              <FormControl><SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="false">Off</SelectItem>
                                <SelectItem value="true">On</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )} />
                      </div>
                      {backchannelingEnabled && (
                        <>
                          <FormField control={form.control} name="backchannelingFrequency" render={({ field }) => (
                            <FormItem>
                              <div className="flex justify-between text-xs text-muted-foreground">
                                <span>Frequency</span>
                                <span>{Math.round((backchannelingFrequency ?? 0.5) * 100)}% of turns</span>
                              </div>
                              <FormControl>
                                <Slider min={0} max={1} step={0.05} value={[field.value ?? 0.5]}
                                  onValueChange={(vals) => field.onChange(vals[0])} />
                              </FormControl>
                            </FormItem>
                          )} />
                        </>
                      )}
                    </div>

                    <FormField control={form.control} name="webhookUrl" render={({ field }) => {
                      const val = field.value ?? "";
                      const isEmail = val.includes("@") && !val.startsWith("http");
                      const isHttp  = val.length > 0 && val.startsWith("http://");
                      const wasCleared = !!(agent.webhookUrl && !agent.webhookUrl.startsWith("https://"));
                      return (
                        <FormItem>
                          <FormLabel>Post-Call Webhook URL</FormLabel>
                          <FormControl>
                            <Input placeholder="https://your-server.com/webhook/calls" {...field} />
                          </FormControl>
                          {wasCleared && (
                            <p className="text-xs text-amber-500 flex items-center gap-1">
                              ⚠ A previously saved URL was cleared because it didn't start with https://. Please re-enter a valid URL.
                            </p>
                          )}
                          {isEmail && (
                            <p className="text-xs text-destructive flex items-center gap-1">
                              ⚠ That looks like an email address, not a URL. Enter an <code>https://</code> endpoint.
                            </p>
                          )}
                          {isHttp && !isEmail && (
                            <p className="text-xs text-amber-500 flex items-center gap-1">
                              ⚠ HTTP URLs are not allowed — must be <code>https://</code>
                            </p>
                          )}
                          <FormDescription>Receives a JSON summary when each call ends. Must be HTTPS.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      );
                    }} />
                    <FormField control={form.control} name="webhookSecret" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Webhook Signing Secret</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="Optional — enables HMAC signature header" {...field} />
                        </FormControl>
                        <FormDescription>
                          When set, each webhook request includes an <code>X-SnapServe-Signature: sha256=…</code> header.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ── Pipeline ── */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Pipeline Configuration</CardTitle>
                <CardDescription>Select providers and models for each stage.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">

                  {/* Step 1 — ASR */}
                  <div className="space-y-4 p-4 border border-border/60 rounded-lg bg-card/50 relative">
                    <div className="absolute top-0 right-0 -mt-3 -mr-3 bg-primary/10 border border-primary/40 rounded-full px-2 py-0.5 text-[10px] font-bold text-primary uppercase tracking-wider">Step 1</div>
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/80 border-b border-border/50 pb-2">Speech-to-Text</h4>
                    <FormField control={form.control} name="asrProvider" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Provider</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select ASR" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {ASR_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="asrModel" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Model</FormLabel>
                        <FormControl>
                          {ASR_MODELS[asrProvider] ? (
                            <ModelSelect options={ASR_MODELS[asrProvider]!} value={field.value} onChange={field.onChange} placeholder="Select model" />
                          ) : (
                            <Input placeholder="Enter model name" {...field} />
                          )}
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  {/* Step 2 — LLM */}
                  <div className="space-y-4 p-4 border border-border/60 rounded-lg bg-card/50 relative">
                    <div className="absolute top-0 right-0 -mt-3 -mr-3 bg-primary/10 border border-primary/40 rounded-full px-2 py-0.5 text-[10px] font-bold text-primary uppercase tracking-wider">Step 2</div>
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/80 border-b border-border/50 pb-2">Language Model</h4>
                    <FormField control={form.control} name="llmProvider" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Provider</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select LLM" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {LLM_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="llmModel" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Model</FormLabel>
                        <FormControl>
                          {LLM_MODELS[llmProvider] ? (
                            <ModelSelect options={LLM_MODELS[llmProvider]!} value={field.value} onChange={field.onChange} placeholder="Select model" />
                          ) : (
                            <Input placeholder="Enter model name" {...field} />
                          )}
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  {/* Step 3 — TTS */}
                  <div className="space-y-4 p-4 border border-border/60 rounded-lg bg-card/50 relative">
                    <div className="absolute top-0 right-0 -mt-3 -mr-3 bg-primary/10 border border-primary/40 rounded-full px-2 py-0.5 text-[10px] font-bold text-primary uppercase tracking-wider">Step 3</div>
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/80 border-b border-border/50 pb-2">Synthesizer (TTS)</h4>
                    <FormField control={form.control} name="ttsProvider" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Provider</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select TTS" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {TTS_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    {TTS_MODELS[ttsProvider] && (
                      <FormField control={form.control} name="ttsModel" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Model</FormLabel>
                          <FormControl>
                            <ModelSelect options={TTS_MODELS[ttsProvider]!} value={field.value} onChange={field.onChange} placeholder="Select model" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}
                    <FormField control={form.control} name="ttsVoice" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">{TTS_VOICES[ttsProvider] ? "Voice" : "Voice ID"}</FormLabel>
                        <FormControl>
                          {TTS_VOICES[ttsProvider] ? (
                            <ModelSelect options={TTS_VOICES[ttsProvider]!} value={field.value} onChange={field.onChange} placeholder="Select voice" />
                          ) : (
                            <Input
                              placeholder={ttsProvider === "elevenlabs" ? "e.g. 21m00Tcm4TlvDq8ikWAM" : "e.g. 694f9389-aac1-45b6-b726-9d9369183238"}
                              {...field}
                            />
                          )}
                        </FormControl>
                        <FormDescription className="text-[10px]">
                          {ttsProvider === "elevenlabs" && "Voice ID from your ElevenLabs account"}
                          {ttsProvider === "cartesia"   && "Voice ID from your Cartesia account"}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  {/* Step 4 — Duration */}
                  <div className="space-y-4 p-4 border border-border/60 rounded-lg bg-card/50 relative">
                    <div className="absolute top-0 right-0 -mt-3 -mr-3 bg-primary/10 border border-primary/40 rounded-full px-2 py-0.5 text-[10px] font-bold text-primary uppercase tracking-wider">Step 4</div>
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/80 border-b border-border/50 pb-2">Call Settings</h4>
                    <FormField control={form.control} name="maxDuration" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Max Duration (seconds)</FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="e.g. 600" {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value, 10))} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── Latency Tuning ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Latency Tuning</CardTitle>
              <CardDescription>Control per-stage response speed. Lower values cut latency; higher values improve reliability for slow speakers.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <FormField control={form.control} name="asrEndpointingSilenceMs" render={({ field }) => (
                  <FormItem>
                    <FormLabel>STT Endpointing Silence (ms)</FormLabel>
                    <FormControl>
                      <Input type="number" min={100} max={2000} step={50}
                        value={field.value ?? 400}
                        onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                    </FormControl>
                    <FormDescription className="text-[11px]">
                      How long Azure waits after the last spoken word before sending the transcript. <strong>Lower = faster response.</strong> Default: 400ms. Range: 100–2000ms. Try 200ms for fast speakers.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="llmMaxTokens" render={({ field }) => (
                  <FormItem>
                    <FormLabel>LLM Max Output Tokens</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} max={16000} step={10}
                        placeholder="Model default (no cap)"
                        value={field.value ?? ""}
                        onChange={e => {
                          const v = e.target.value;
                          field.onChange(v === "" ? null : parseInt(v, 10));
                        }} />
                    </FormControl>
                    <FormDescription className="text-[11px]">
                      Cap how many tokens the LLM generates per turn. <strong>Lower = faster + shorter replies.</strong> Leave blank for model default. Try 80–120 for concise voice responses.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="ttsMinSentenceChars" render={({ field }) => (
                  <FormItem>
                    <FormLabel>TTS Early Dispatch Threshold (chars)</FormLabel>
                    <FormControl>
                      <Input type="number" min={5} max={200} step={5}
                        value={field.value ?? 15}
                        onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                    </FormControl>
                    <FormDescription className="text-[11px]">
                      Min chars before a comma-clause triggers an early TTS request mid-LLM-stream. <strong>Lower = TTS fires earlier.</strong> Default: 15. Range: 5–200.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="linearDelayMs" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Linear Delay (ms)</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} max={2000} step={50}
                        value={field.value ?? 0}
                        onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                    </FormControl>
                    <FormDescription className="text-[11px]">
                      Extra buffer added after the transcript arrives and before the LLM starts responding. Accounts for callers who pause mid-sentence. Default: 0ms (disabled).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </CardContent>
          </Card>

          {/* ── Voice Activity Detection ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Voice Activity Detection &amp; Barge-in</CardTitle>
              <CardDescription>Fine-tune how the agent detects speech and handles interruptions.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <FormField control={form.control} name="vadSilenceMs" render={({ field }) => (
                  <FormItem>
                    <FormLabel>VAD Silence Window (ms)</FormLabel>
                    <FormControl>
                      <Input type="number" min={50} max={2000} step={50}
                        value={field.value ?? 250}
                        onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                    </FormControl>
                    <FormDescription className="text-[11px]">Silence before STT flushes. Default: 2000 ms</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="bargeInEnabled" render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Allow Barge-in</FormLabel>
                    <div className="flex items-center gap-3 pt-2">
                      <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                      <span className="text-sm text-muted-foreground">{(field.value ?? true) ? "Enabled" : "Disabled"}</span>
                    </div>
                    <FormDescription className="text-[11px]">Caller can interrupt the agent while it's speaking.</FormDescription>
                  </FormItem>
                )} />
                <FormField control={form.control} name="bargeInEnergyThreshold" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Barge-in Energy Threshold</FormLabel>
                    <FormControl>
                      <Input type="number" min={100} max={5000} step={100}
                        value={field.value ?? 1200}
                        onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                    </FormControl>
                    <FormDescription className="text-[11px]">Min RMS energy to count as speech. Default: 1200</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="bargeInMinFrames" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Barge-in Min Frames</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} max={20}
                        value={field.value ?? 4}
                        onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                    </FormControl>
                    <FormDescription className="text-[11px]">Consecutive speech frames to trigger barge-in. Default: 4 (~80 ms)</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </CardContent>
          </Card>

          {/* ── Voicemail Detection ── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><PhoneForwarded className="h-4 w-4" /> Voicemail Detection (AMD)</CardTitle>
              <CardDescription>Outbound calls only. Detects answering machines and decides what to do when a voicemail picks up.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="machineDetectionMode" render={({ field }) => (
                <FormItem>
                  <FormLabel>Detection Mode</FormLabel>
                  <Select value={field.value ?? "disabled"} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="disabled">Disabled — no detection</SelectItem>
                      <SelectItem value="enable">Enable — detect at call start</SelectItem>
                      <SelectItem value="detect_message_end">Detect Message End — wait for beep</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription className="text-[11px]">"Detect Message End" waits for the beep so the left message doesn't get cut off.</FormDescription>
                </FormItem>
              )} />
              {form.watch("machineDetectionMode") !== "disabled" && (
                <>
                  <FormField control={form.control} name="voicemailAction" render={({ field }) => (
                    <FormItem>
                      <FormLabel>When voicemail is detected</FormLabel>
                      <Select value={field.value ?? "hangup"} onValueChange={field.onChange}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hangup">Hang up immediately</SelectItem>
                          <SelectItem value="leave_message">Leave a voicemail message</SelectItem>
                          <SelectItem value="continue">Continue — let the AI talk to the voicemail</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  {form.watch("voicemailAction") === "leave_message" && (
                    <FormField control={form.control} name="voicemailMessage" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Voicemail Message</FormLabel>
                        <FormControl>
                          <Textarea className="min-h-[80px] text-sm" placeholder="Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you." {...field} />
                        </FormControl>
                        <FormDescription className="text-[11px]">This text is spoken via TTS into the voicemail recording.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* ── Tools ── */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><PhoneForwarded className="h-4 w-4" /> Tools</CardTitle>
                  <CardDescription>Actions the LLM can trigger mid-call. The agent decides when to use them based on the conversation.</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => appendTool({ type: "call_transfer", name: "transfer_to_human", description: "Transfer the call to a human agent when the caller requests it or the issue cannot be resolved automatically.", transferTo: "", warmHandoffMessage: "" })}
                  >
                    <PhoneForwarded className="h-4 w-4 mr-1" /> Call Transfer
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => appendTool({ type: "webhook", name: "custom_action", description: "Invoke this when the caller requests a specific action.", url: "", method: "POST", secret: "", preToolMessage: "One moment, let me take care of that for you.", parameters: [] })}
                  >
                    <Webhook className="h-4 w-4 mr-1" /> Custom Function
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* ── Scheduling & Bookings ── */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 px-0.5 mb-2">Scheduling & Bookings</p>
                <div className="space-y-2">
                  {BOOKING_TOOLS.map(({ type, fnName, icon, color, description }) => {
                    const isOn = hasNativeTool(type);
                    const c = bookingColorMap[color];
                    return (
                      <div key={type} className={cn("rounded-xl border transition-all duration-150", isOn ? `${c.border} ${c.bg}` : "border-border/60 bg-card/20")}>
                        <button
                          type="button"
                          onClick={() => toggleNativeTool(type)}
                          className="w-full text-left p-4 flex items-start gap-3"
                        >
                          <div className={cn("mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center shrink-0", isOn ? c.iconBg : "bg-muted/30")}>
                            <span className={cn(isOn ? c.iconText : "text-muted-foreground/40")}>{icon}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <code className={cn("text-[11px] font-mono font-semibold", isOn ? c.label : "text-foreground/70")}>{fnName}</code>
                              <span className={cn("text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded", isOn ? `${c.badge} ${c.badgeText}` : "bg-muted/40 text-muted-foreground/40")}>
                                {isOn ? "ON" : "OFF"}
                              </span>
                              {isOn && (
                                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground/60">{fnName}</span>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground/60 leading-relaxed">{description}</p>
                          </div>
                          <div className="shrink-0 mt-0.5">
                            {isOn ? <ToggleRight className={cn("h-5 w-5", c.iconText)} /> : <ToggleLeft className="h-5 w-5 text-muted-foreground/30" />}
                          </div>
                        </button>
                        {isOn && (() => {
                          const idx = nativeToolIndex(type);
                          const toolTimezone = watchedTools[idx]?.timezone;
                          const toolEventTypeId = watchedTools[idx]?.eventTypeId;
                          return (
                            <div className="px-4 pb-4 -mt-1">
                              <div className="border-t border-border/30 pt-3 space-y-2">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {!agentCalendar ? (
                                      <p className="text-[10px] text-amber-400/80">No calendar found. Go to <span className="font-medium">Settings → Calendar</span> to create one.</p>
                                    ) : !(agentCalendar as any).connectedGoogleEmail ? (
                                      <>
                                        <span className="text-[10px] text-muted-foreground">Assigned calendar:</span>
                                        <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded", c.badge, c.badgeText)}>{agentCalendar.name || "Calendar"}</span>
                                        <span className="text-[10px] text-amber-400/80">No Google account connected.</span>
                                      </>
                                    ) : (
                                      <>
                                        <span className="text-[10px] text-muted-foreground">Assigned calendar:</span>
                                        <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded", c.badge, c.badgeText)}>{agentCalendar.name || "Calendar"}</span>
                                        <span className="text-[10px] text-muted-foreground/60">
                                          {(agentCalendar as any).connectedGoogleAccountsCount > 1
                                            ? `${(agentCalendar as any).connectedGoogleAccountsCount} accounts`
                                            : (agentCalendar as any).connectedGoogleEmail}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setSchemaViewType(type); }}
                                    className="text-[10px] text-muted-foreground/60 hover:text-foreground/80 underline underline-offset-2 transition-colors"
                                  >
                                    View schema
                                  </button>
                                </div>
                                {type === "native_list_bookings" && (
                                  <div className="space-y-1">
                                    <label className="text-[10px] text-muted-foreground block">Event Type (optional)</label>
                                    <Select
                                      value={toolEventTypeId != null ? String(toolEventTypeId) : "__none__"}
                                      onValueChange={(v) => form.setValue(`tools.${idx}.eventTypeId` as any, v === "__none__" ? undefined : Number(v))}
                                      disabled={!agentCalendar}
                                    >
                                      <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Any event type" /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="__none__" className="text-xs">Any event type</SelectItem>
                                        {(agentEventTypes ?? []).map((et: any) => (
                                          <SelectItem key={et.id} value={String(et.id)} className="text-xs">{et.title}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    {agentCalendar && (agentEventTypes ?? []).length === 0 && (
                                      <p className="text-[10px] text-amber-400/80">No event types found for this calendar. Create one in Scheduling.</p>
                                    )}
                                  </div>
                                )}
                                {agentCalendar && (agentEventTypes ?? []).length === 0 && type !== "native_list_bookings" && ["native_booking", "native_check_availability"].includes(type) && (
                                  <p className="text-[10px] text-amber-400/80">No event types found for this calendar. Create one in Scheduling.</p>
                                )}
                                <div className="space-y-1">
                                  <label className="text-[10px] text-muted-foreground block">Timezone (optional)</label>
                                  <Select
                                    value={toolTimezone || "__none__"}
                                    onValueChange={(v) => form.setValue(`tools.${idx}.timezone` as any, v === "__none__" ? undefined : v)}
                                  >
                                    <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Use caller timezone" /></SelectTrigger>
                                    <SelectContent className="max-h-[280px] overflow-y-auto">
                                      <SelectItem value="__none__" className="text-xs">Use caller timezone</SelectItem>
                                      {AGENT_TIMEZONES.map((tz) => (
                                        <SelectItem key={tz.value} value={tz.value} className="text-xs">{tz.label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* View Schema dialog */}
              <Dialog open={schemaViewType !== null} onOpenChange={(open) => { if (!open) setSchemaViewType(null); }}>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle className="font-mono text-sm">
                      {schemaViewType ? BOOKING_TOOLS.find(t => t.type === schemaViewType)?.fnName : ""}
                    </DialogTitle>
                  </DialogHeader>
                  <pre className="text-[11px] bg-muted/40 rounded-lg p-3 overflow-auto max-h-[60vh] leading-relaxed">
                    {schemaViewType ? JSON.stringify(BOOKING_TOOL_SCHEMAS[schemaViewType], null, 2) : ""}
                  </pre>
                </DialogContent>
              </Dialog>
            </CardContent>
            {toolFields.filter((_f, i) => !NATIVE_TOOL_TYPES.includes(form.getValues(`tools.${i}.type`) ?? "")).length > 0 && (
              <CardContent className="space-y-4">
                {toolFields.map((field, index) => {
                  const toolType = form.watch(`tools.${index}.type`) ?? "";
                  if (NATIVE_TOOL_TYPES.includes(toolType)) return null;
                  return (
                    <div key={field.id} className="border rounded-md p-4 bg-muted/20 space-y-3 relative">
                      <div className="flex items-center justify-between mb-1">
                        {toolType === "webhook" ? (
                          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            <Webhook className="h-3 w-3" /> Custom Function
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            <PhoneForwarded className="h-3 w-3" /> Call Transfer
                          </span>
                        )}
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeTool(index)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {toolType === "webhook" ? (
                        /* ── Webhook / Custom Function fields ── */
                        <>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <FormField control={form.control} name={`tools.${index}.name`} render={({ field: f }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Function Name</FormLabel>
                                <FormControl><Input placeholder="e.g. check_order_status" {...f} /></FormControl>
                                <FormDescription className="text-[10px]">snake_case — the LLM calls this by name</FormDescription>
                                <FormMessage />
                              </FormItem>
                            )} />
                            <FormField control={form.control} name={`tools.${index}.preToolMessage`} render={({ field: f }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Pre-call Message (optional)</FormLabel>
                                <FormControl><Input placeholder="One moment, let me check that for you." {...f} /></FormControl>
                                <FormDescription className="text-[10px]">Spoken aloud before the function is called</FormDescription>
                              </FormItem>
                            )} />
                          </div>
                          <FormField control={form.control} name={`tools.${index}.description`} render={({ field: f }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Description (shown to LLM)</FormLabel>
                              <FormControl><Textarea className="min-h-[60px] text-sm" placeholder="Invoke this when the caller asks about their order status or wants to track a delivery." {...f} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <div className="grid grid-cols-[1fr_120px] gap-3">
                            <FormField control={form.control} name={`tools.${index}.url`} render={({ field: f }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Endpoint URL</FormLabel>
                                <FormControl><Input placeholder="https://your-api.com/webhook" {...f} /></FormControl>
                                <FormMessage />
                              </FormItem>
                            )} />
                            <FormField control={form.control} name={`tools.${index}.method`} render={({ field: f }) => (
                              <FormItem>
                                <FormLabel className="text-xs">HTTP Method</FormLabel>
                                <Select value={f.value ?? "POST"} onValueChange={f.onChange}>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="POST">POST</SelectItem>
                                    <SelectItem value="GET">GET</SelectItem>
                                  </SelectContent>
                                </Select>
                              </FormItem>
                            )} />
                          </div>
                          <FormField control={form.control} name={`tools.${index}.secret`} render={({ field: f }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Secret — X-Webhook-Secret (optional)</FormLabel>
                              <FormControl><Input placeholder="optional-shared-secret" type="password" {...f} /></FormControl>
                              <FormDescription className="text-[10px]">Sent as the X-Webhook-Secret header so your server can verify requests</FormDescription>
                            </FormItem>
                          )} />
                          <div className="border-t pt-3 mt-1">
                            <WebhookParamsEditor control={form.control} toolIndex={index} />
                          </div>
                        </>
                      ) : (
                        /* ── Call Transfer fields ── */
                        <>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <FormField control={form.control} name={`tools.${index}.name`} render={({ field: f }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Function Name</FormLabel>
                                <FormControl><Input placeholder="e.g. transfer_to_human" {...f} /></FormControl>
                                <FormDescription className="text-[10px]">snake_case, no spaces — used by the LLM to call this tool</FormDescription>
                                <FormMessage />
                              </FormItem>
                            )} />
                            <FormField control={form.control} name={`tools.${index}.transferTo`} render={({ field: f }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Transfer To (phone number)</FormLabel>
                                <FormControl><Input placeholder="+12125551234" {...f} /></FormControl>
                                <FormDescription className="text-[10px]">E.164 format — the human agent's number</FormDescription>
                                <FormMessage />
                              </FormItem>
                            )} />
                          </div>
                          <FormField control={form.control} name={`tools.${index}.description`} render={({ field: f }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Description (shown to LLM)</FormLabel>
                              <FormControl><Textarea className="min-h-[60px] text-sm" placeholder="Transfer the call to a human agent when the caller is frustrated or the issue cannot be resolved automatically." {...f} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={form.control} name={`tools.${index}.warmHandoffMessage`} render={({ field: f }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Warm Handoff Message (optional)</FormLabel>
                              <FormControl><Input placeholder="e.g. I'm connecting you with a specialist now. Please hold for a moment." {...f} /></FormControl>
                              <FormDescription className="text-[10px]">Spoken to the caller before the transfer happens</FormDescription>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            )}
          </Card>

          {/* ── Token Optimization ── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-amber-400" /> Token Optimization
              </CardTitle>
              <CardDescription>Reduce LLM token usage to lower costs. Each layer is independent and can be enabled separately.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Layer 1: KV Cache — auto-enabled for Anthropic, read-only info */}
              <div className="flex items-start gap-4 p-3 rounded-lg border border-border bg-muted/20">
                <div className="flex-1">
                  <p className="text-sm font-medium">KV Cache (Anthropic only)</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Automatically enabled when LLM provider is Anthropic. Caches the system prompt across turns using <code className="text-[10px] bg-muted px-1 rounded">cache_control</code> blocks — saves 5× on repeated input tokens.</p>
                </div>
                <div className={`text-xs font-medium px-2 py-1 rounded ${llmProvider === "anthropic" ? "bg-amber-500/20 text-amber-300" : "bg-muted/40 text-muted-foreground"}`}>
                  {llmProvider === "anthropic" ? "Active" : "N/A"}
                </div>
              </div>

              {/* Layer 2: Sliding Window */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Sliding Window Context</p>
                    <p className="text-xs text-muted-foreground">Limit the number of past turns sent to the LLM each time. Older turns are dropped from context.</p>
                  </div>
                  <FormField control={form.control} name="contextWindowTurns" render={({ field }) => (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Last</span>
                      <Input
                        type="number"
                        min={1}
                        max={1000}
                        placeholder="off"
                        className="w-20 h-8 text-xs text-center"
                        value={field.value == null ? "" : String(field.value)}
                        onChange={(e) => field.onChange(e.target.value === "" ? null : parseInt(e.target.value, 10))}
                      />
                      <span className="text-xs text-muted-foreground">turns</span>
                    </div>
                  )} />
                </div>
              </div>

              {/* Layer 4: Staged Prompt */}
              <div className="space-y-3 border-t border-border pt-4">
                <FormField control={form.control} name="stagedPromptEnabled" render={({ field }) => (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Staged System Prompt</p>
                      <p className="text-xs text-muted-foreground">Serve a smaller, stage-specific system prompt block per conversation phase instead of the full prompt. The LLM signals stage transitions with <code className="text-[10px] bg-muted px-1 rounded">[STAGE:Name]</code>.</p>
                    </div>
                    <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                  </div>
                )} />
                {form.watch("stagedPromptEnabled") && (
                  <div className="space-y-4 pl-1">
                    <FormField control={form.control} name="stagedPromptCoreIdentity" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Core Identity (always included)</FormLabel>
                        <FormControl>
                          <Textarea
                            className="min-h-[60px] text-xs"
                            placeholder="You are a helpful assistant for Acme Corp. Always be polite and professional."
                            {...field}
                          />
                        </FormControl>
                        <FormDescription className="text-[10px]">Prepended to every stage prompt. Keep it short — name, role, tone only.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <StagedPromptEditor control={form.control} />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ── Auto Summarization ── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary" /> Auto Summarization
              </CardTitle>
              <CardDescription>Generate a concise AI summary of every completed call and show it in the call log.</CardDescription>
            </CardHeader>
            <CardContent>
              <FormField control={form.control} name="summarizationEnabled" render={({ field }) => (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Auto Summarization</p>
                    <p className="text-xs text-muted-foreground">When on, a short AI summary is created for every completed call — web or phone, any length.</p>
                  </div>
                  <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                </div>
              )} />
            </CardContent>
          </Card>

          {/* ── SnapServe Integration ── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="h-4 w-4" /> SnapServe Integration
              </CardTitle>
              <CardDescription>Connect this agent to a SnapServe agent to view live execution history in the call log.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="snapserveAgentId" render={({ field }) => (
                <FormItem>
                  <FormLabel>SnapServe Agent ID</FormLabel>
                  <FormControl>
                    <Input placeholder="3c90c3cc-0d44-4b50-8888-…" {...field} />
                  </FormControl>
                  <FormDescription className="text-[11px]">
                    The SnapServe platform agent UUID. Find it in your SnapServe dashboard. You also need a SnapServe API key saved on the{" "}
                    <Link href="/app/providers" className="text-foreground/70 hover:underline">Providers page</Link>.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <div className="fixed bottom-0 left-0 md:left-64 right-0 p-4 bg-background/80 backdrop-blur-sm border-t border-border flex justify-end z-10">
            <div className="max-w-5xl mx-auto w-full flex justify-end gap-4">
              <Link href={`/app/agents/${id}`}><Button type="button" variant="outline">Cancel</Button></Link>
              <Button type="submit" disabled={updateAgent.isPending}>
                <Save className="mr-2 h-4 w-4" />
                {updateAgent.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
