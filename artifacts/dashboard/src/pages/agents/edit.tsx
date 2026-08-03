import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, Save, Bot, Plus, Trash2, PhoneForwarded, PhoneCall, Webhook, ChevronDown, ChevronUp, BookOpen, Sparkles, List, Pencil, X, ToggleLeft, ToggleRight, Calendar as CalendarIcon, AlertTriangle, Mail, MessageCircle } from "lucide-react";
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
import {
  agentFormSchema,
  hydrateToolsForForm,
  clampBargeInEnergyThreshold,
  clampEndpointingMs,
  clampLinearDelayMs,
  clampFragmentCoalesceListeningMs,
  clampFragmentCoalescePlayingMs,
  clampTelephonyTailDrainMs,
  clampSarvamSpeechEndFlushMs,
  clampSarvamIncompleteHoldMs,
  clampInterruptWords,
  voiceSecondsFromInterruptWords,
  type AgentFormValues,
} from "./edit.schema";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AgentConfigCard, EditConfigDialog } from "@/components/agent-config-card";
import { GeminiLiveVoicePicker } from "@/components/gemini-live-voice-picker";
import { Mic, Brain, Volume2, Globe } from "lucide-react";
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
  GEMINI_LIVE_LLM_MODEL,
  GEMINI_LIVE_THINKING_LEVELS,
  geminiLiveModelLabel,
  getModelError,
  isGeminiLiveAgent,
  isGeminiLiveLlmModel,
  voiceStackForLlmModel,
  languagesForAgent,
  isGeminiLiveLanguage,
} from "@/lib/agent-providers";

export type { AgentFormValues } from "./edit.schema";

export function buildUpdateAgentPayload(data: AgentFormValues) {
  const {
    webhookSecret, promptVariables, vadSilenceMs, bargeInEnabled, bargeInEnergyThreshold, bargeInMinFrames, micSensitivity,
    timezone, autoSwitchToEnglish, languageAutoDetect, multilingualLanguages, sarvamIndicNumbers, machineDetectionMode, voicemailAction, voicemailMessage, voicemailLeadInSeconds, genderDetectionEnabled, voiceMemoryEnabled, recordingEnabled,
    startSpeakingWaitSecs, startSpeakingOnPunctuationSecs, startSpeakingOnNoPunctuationSecs, startSpeakingOnNumberSecs,
    stopSpeakingNumWords, stopSpeakingVoiceSecs, stopSpeakingBackOffSecs,
    complianceIrdai, complianceDpdp, complianceTrai,
    snapserveAgentId,
    contextWindowTurns, summarizationEnabled,
    stagedPromptEnabled, stagedPromptStages, stagedPromptCoreIdentity,
    ambientNoiseEnabled, ambientNoiseTrack, ambientNoiseVolume,
    preferredManagedNumber,
    asrEndpointingSilenceMs, llmMaxTokens, ttsMinSentenceChars, linearDelayMs, ttsSpeed,
    fragmentCoalesceListeningMs, fragmentCoalescePlayingMs, telephonyTailDrainMs,
    autoRedialEnabled, autoRedialMaxAttempts,
    sarvamSttMode, kbBakedOnly, schedulingCalendarId, schedulingEventTypeId,
    sarvamHighVadSensitivity, sarvamSpeechEndFlushMs, sarvamIncompleteHoldMs,
    voiceStack, geminiLiveVoiceName, geminiLiveThinkingLevel,
    // Inbound/outbound phone number assignment is read-only in the agent form —
    // it's managed exclusively from the Phone Numbers page now. Never forward
    // these to the server: they're populated from the agent's own (potentially
    // stale) columns at form-load time, and resending them on every unrelated
    // save re-triggers the server's assignment-sync logic with that stale
    // value, silently reassigning/stealing the number from whoever currently
    // owns it on the Phone Numbers page.
    inboundPhoneNumberId, outboundPhoneNumberId,
    ...rest
  } = data;
  const agentConfig: Record<string, unknown> = {};
  if (webhookSecret) agentConfig["webhookSecret"] = webhookSecret;
  if (promptVariables?.length) agentConfig["promptVariables"] = promptVariables;
  if (vadSilenceMs != null && vadSilenceMs !== 350) agentConfig["vadSilenceMs"] = vadSilenceMs;
  if (bargeInEnabled === false) agentConfig["bargeInEnabled"] = false;
  {
    const energy = clampBargeInEnergyThreshold(bargeInEnergyThreshold);
    if (energy !== 1200) agentConfig["bargeInEnergyThreshold"] = energy;
  }
  if (bargeInMinFrames != null && bargeInMinFrames !== 4) agentConfig["bargeInMinFrames"] = bargeInMinFrames;
  if (micSensitivity != null) agentConfig["micSensitivity"] = micSensitivity;
  if (timezone) agentConfig["timezone"] = timezone;
  agentConfig["autoSwitchToEnglish"] = !!autoSwitchToEnglish;
  agentConfig["languageAutoDetect"] = !!languageAutoDetect;
  {
    const langs = (multilingualLanguages ?? []).filter(Boolean);
    if (langs.length > 0) {
      agentConfig["multilingualLanguages"] = langs;
      agentConfig["isMultilingual"] = true;
      agentConfig["secondaryLanguages"] = langs;
    } else {
      agentConfig["isMultilingual"] = !!languageAutoDetect;
      agentConfig["multilingualLanguages"] = [];
      agentConfig["secondaryLanguages"] = [];
    }
  }
  agentConfig["sarvamIndicNumbers"] = sarvamIndicNumbers !== false;
  agentConfig["machineDetectionMode"] = machineDetectionMode ?? "disabled";
  agentConfig["voicemailAction"] = voicemailAction ?? "hangup";
  if (voicemailMessage) agentConfig["voicemailMessage"] = voicemailMessage;
  if (voicemailLeadInSeconds != null && voicemailLeadInSeconds !== 2) agentConfig["voicemailLeadInSeconds"] = voicemailLeadInSeconds;
  agentConfig["genderDetectionEnabled"] = !!genderDetectionEnabled;
  agentConfig["voiceMemoryEnabled"] = !!voiceMemoryEnabled;
  agentConfig["recordingEnabled"] = !!recordingEnabled;
  agentConfig["summarizationEnabled"] = !!summarizationEnabled;
  agentConfig["ambientNoiseEnabled"] = !!ambientNoiseEnabled;
  if (ambientNoiseTrack) agentConfig["ambientNoiseTrack"] = ambientNoiseTrack;
  if (ambientNoiseVolume != null) agentConfig["ambientNoiseVolume"] = ambientNoiseVolume;
  if (preferredManagedNumber) agentConfig["preferredManagedNumber"] = preferredManagedNumber;
  {
    // Always persist — Latency Tuning UI is the sole source of truth for STT
    // endpointing (Azure + Deepgram) and post-transcript linear delay.
    agentConfig["asrEndpointingSilenceMs"] = clampEndpointingMs(asrEndpointingSilenceMs);
  }
  if (sarvamSttMode) agentConfig["sarvamSttMode"] = sarvamSttMode;
  // Always persist Sarvam STT latency knobs (UI is source of truth; snappy defaults).
  agentConfig["sarvamHighVadSensitivity"] = sarvamHighVadSensitivity === true;
  agentConfig["sarvamSpeechEndFlushMs"] = clampSarvamSpeechEndFlushMs(sarvamSpeechEndFlushMs);
  agentConfig["sarvamIncompleteHoldMs"] = clampSarvamIncompleteHoldMs(sarvamIncompleteHoldMs);
  if (kbBakedOnly) agentConfig["kbBakedOnly"] = true;
  // Always persist speed so Sarvam pace / Cartesia speed stay UI-owned (1.0 clears prior boost).
  agentConfig["ttsSpeed"] = ttsSpeed != null && Number.isFinite(ttsSpeed) ? ttsSpeed : 1;
  // Always send the key (null clears it): the server MERGES agentConfig on
  // update, so omitting it when the field is blanked would silently keep the
  // old cap forever — "leave blank for default" would never actually work.
  agentConfig["llmMaxTokens"] = llmMaxTokens ?? null;
  if (ttsMinSentenceChars != null && ttsMinSentenceChars !== 18) agentConfig["ttsMinSentenceChars"] = ttsMinSentenceChars;
  agentConfig["incrementalDelay"] = clampLinearDelayMs(linearDelayMs);
  agentConfig["fragmentCoalesceListeningMs"] = clampFragmentCoalesceListeningMs(fragmentCoalesceListeningMs);
  agentConfig["fragmentCoalescePlayingMs"] = clampFragmentCoalescePlayingMs(fragmentCoalescePlayingMs);
  agentConfig["telephonyTailDrainMs"] = clampTelephonyTailDrainMs(telephonyTailDrainMs);
  agentConfig["autoRedial"] = {
    enabled:      !!autoRedialEnabled,
    maxAttempts:  autoRedialMaxAttempts  ?? 3,
  };
  agentConfig["startSpeakingPlan"] = {
    waitSeconds:            startSpeakingWaitSecs          ?? 0,
    onPunctuationSeconds:   startSpeakingOnPunctuationSecs ?? 0.1,
    onNoPunctuationSeconds: startSpeakingOnNoPunctuationSecs ?? 0.1,
    onNumberSeconds:        startSpeakingOnNumberSecs      ?? 0.1,
  };
  {
    // Bolna parity: one "words before interrupt" drives word-count AND energy floor.
    const numWords = clampInterruptWords(stopSpeakingNumWords);
    const voiceSeconds = voiceSecondsFromInterruptWords(numWords);
    agentConfig["wordsForInterruption"] = numWords;
    agentConfig["stopSpeakingPlan"] = {
      numWords,
      voiceSeconds,
      backOffSeconds: stopSpeakingBackOffSecs ?? 1,
    };
  }
  agentConfig["compliance"] = {
    irdai: !!complianceIrdai,
    dpdp:  !!complianceDpdp,
    trai:  !!complianceTrai,
  };
  if (schedulingCalendarId != null) {
    agentConfig["calendarCapability"] = {
      defaultCalendarId: schedulingCalendarId,
      ...(schedulingEventTypeId != null ? { defaultEventTypeId: schedulingEventTypeId } : {}),
    };
  }
  if (isGeminiLiveLlmModel(rest.llmModel) || voiceStack === "gemini_live") {
    agentConfig["voiceStack"] = "gemini_live";
    agentConfig["geminiLive"] = {
      voiceName: geminiLiveVoiceName || "Kore",
      thinkingLevel: geminiLiveThinkingLevel ?? "minimal",
    };
  } else if (voiceStack === "classic") {
    agentConfig["voiceStack"] = "classic";
  }

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

  const form = useForm<any>({
    resolver: zodResolver(agentFormSchema) as any,
    defaultValues: {
      name: "", description: "", asrProvider: "sarvam", asrModel: "saaras:v3",
      llmProvider: "openai", llmModel: "", ttsProvider: "sarvam",
      ttsVoice: "priya", ttsModel: "bulbul:v3", telephonyProvider: "vobiz",
      systemPrompt: "", temperature: 0.10, maxDuration: 300,
      firstSpeaker: "assistant", endCallPhrases: "", silenceTimeoutSeconds: 30,
      language: "en-US", asrLanguage: "", backchannelingEnabled: true, backchannelingFrequency: 0.5,
      webhookUrl: "", webhookSecret: "", noiseCancellationEnabled: true,
      ambientNoiseEnabled: false, ambientNoiseTrack: "", ambientNoiseVolume: 1.0,
      promptVariables: [], vadSilenceMs: 350, bargeInEnabled: true, bargeInEnergyThreshold: 1200, bargeInMinFrames: 4, micSensitivity: "normal",
      timezone: "",
      autoSwitchToEnglish: false,
      languageAutoDetect: false,
      multilingualLanguages: [],
      sarvamIndicNumbers: true,
      machineDetectionMode: "disabled", voicemailAction: "hangup",
      voicemailMessage: "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you.",
      voicemailLeadInSeconds: 2,
      tools: [{ type: "end_call" as const, name: "end_call", description: "End the call when the conversation is complete." }],
      genderDetectionEnabled: false,
      voiceMemoryEnabled: false,
      recordingEnabled: true,
      snapserveAgentId: "",
      contextWindowTurns: undefined,
      summarizationEnabled: false,
      stagedPromptEnabled: false,
      stagedPromptStages: [],
      stagedPromptCoreIdentity: "",
      asrEndpointingSilenceMs: 250,
      llmMaxTokens: null,
      ttsMinSentenceChars: 18,
      ttsSpeed: 1,
      linearDelayMs: 0,
      fragmentCoalesceListeningMs: 250,
      fragmentCoalescePlayingMs: 1000,
      telephonyTailDrainMs: 400,
      sarvamHighVadSensitivity: false,
      sarvamSpeechEndFlushMs: 80,
      sarvamIncompleteHoldMs: 700,
      kbBakedOnly: false,
      startSpeakingWaitSecs: 0,
      startSpeakingOnPunctuationSecs: 0.1,
      startSpeakingOnNoPunctuationSecs: 0.1,
      startSpeakingOnNumberSecs: 0.1,
      stopSpeakingNumWords: 3,
      stopSpeakingVoiceSecs: 0.45,
      stopSpeakingBackOffSecs: 1,
      autoRedialEnabled: false,
      autoRedialMaxAttempts: 3,
      schedulingCalendarId: null,
      schedulingEventTypeId: null,
      voiceStack: "classic",
      geminiLiveVoiceName: "Kore",
      geminiLiveThinkingLevel: "minimal",
    },
  });

  const { fields: toolFields, append: appendTool, remove: removeTool } = useFieldArray({
    control: form.control,
    name: "tools",
  });

  const { data: calendarsData } = useListCalendars();
  const schedulingCalendarId = form.watch("schedulingCalendarId");
  const schedulingEventTypeId = form.watch("schedulingEventTypeId");
  const agentCalendar = schedulingCalendarId != null
    ? (calendarsData ?? []).find((cal: any) => cal.id === schedulingCalendarId)
    : id
      ? ((calendarsData ?? []).find((cal: any) => cal.agentId === id) ?? (calendarsData ?? [])[0])
      : (calendarsData ?? [])[0];
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

  const NATIVE_TOOL_TYPES = ["native_booking", "native_check_availability", "native_list_bookings", "native_reschedule", "native_cancel", "send_email", "send_whatsapp"];
  const watchedTools = (form.watch("tools") ?? []) as any[];
  const hasNativeTool = (type: string) => watchedTools.some((t: any) => t.type === type);
  const nativeToolIndex = (type: string) => watchedTools.findIndex((t: any) => t.type === type);
  const EDIT_TOOL_FN_NAMES: Record<string, string> = {
    native_booking: "book_appointment",
    native_check_availability: "check_availability",
    native_list_bookings: "list_bookings",
    native_reschedule: "reschedule_booking",
    native_cancel: "cancel_booking",
    end_call: "end_call",
    send_email: "send_email",
    send_whatsapp: "send_whatsapp",
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

  const MESSAGING_TOOLS = [
    {
      type: "send_email",
      fnName: "send_email",
      icon: <Mail className="h-4 w-4" />,
      color: "sky",
      label: "Send Email",
      description: "Lets the agent email the caller mid-call using Channels → Email (SnapServe or your Brevo). Collects their address, then sends the channel template.",
    },
    {
      type: "send_whatsapp",
      fnName: "send_whatsapp",
      icon: <MessageCircle className="h-4 w-4" />,
      color: "emerald",
      label: "Send WhatsApp",
      description: "Lets the agent send a WhatsApp template mid-call via Instant/Business or your BSP webhook.",
    },
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
      ambientNoiseVolume:       ((agent as any).agentConfig?.ambientNoiseVolume as number | undefined) ?? 1.0,
      promptVariables:          (((agent as any).agentConfig?.promptVariables ?? []) as AgentFormValues["promptVariables"]),
      vadSilenceMs:             ((agent as any).agentConfig?.vadSilenceMs as number | undefined) ?? 350,
      bargeInEnabled:           ((agent as any).agentConfig?.bargeInEnabled as boolean | undefined) ?? true,
      bargeInEnergyThreshold:   clampBargeInEnergyThreshold((agent as any).agentConfig?.bargeInEnergyThreshold as number | undefined),
      bargeInMinFrames:         ((agent as any).agentConfig?.bargeInMinFrames as number | undefined) ?? 4,
      micSensitivity:           (((agent as any).agentConfig?.micSensitivity as AgentFormValues["micSensitivity"] | undefined) ?? "normal"),
      timezone:                 ((agent as any).agentConfig?.timezone as string | undefined) ?? "",
      autoSwitchToEnglish:      ((agent as any).agentConfig?.autoSwitchToEnglish as boolean | undefined) ?? false,
      languageAutoDetect:       ((agent as any).agentConfig?.languageAutoDetect as boolean | undefined) ?? false,
      multilingualLanguages:    ((agent as any).agentConfig?.multilingualLanguages as string[] | undefined)
        ?? ((agent as any).agentConfig?.secondaryLanguages as string[] | undefined)
        ?? [],
      sarvamIndicNumbers:       ((agent as any).agentConfig?.sarvamIndicNumbers as boolean | undefined) !== false,
      machineDetectionMode:     ((agent as any).agentConfig?.machineDetectionMode as string | undefined) as AgentFormValues["machineDetectionMode"] ?? "disabled",
      voicemailAction:          ((agent as any).agentConfig?.voicemailAction as string | undefined) as AgentFormValues["voicemailAction"] ?? "hangup",
      voicemailMessage:         ((agent as any).agentConfig?.voicemailMessage as string | undefined) ?? "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you.",
      voicemailLeadInSeconds:   ((agent as any).agentConfig?.voicemailLeadInSeconds as number | undefined) ?? 2,
      tools: hydrateToolsForForm(agent.tools ?? []),
      genderDetectionEnabled: (agent as any).agentConfig?.genderDetectionEnabled ?? false,
      voiceMemoryEnabled: (agent as any).agentConfig?.voiceMemoryEnabled ?? false,
      recordingEnabled: (agent as any).agentConfig?.recordingEnabled ?? false,
      snapserveAgentId: (agent as any).snapserveAgentId ?? "",
      contextWindowTurns: (agent as any).contextWindowTurns ?? undefined,
      summarizationEnabled: (agent as any).agentConfig?.summarizationEnabled ?? false,
      stagedPromptEnabled: (agent as any).stagedPromptEnabled ?? false,
      stagedPromptStages: (agent as any).stagedPromptStages ?? [],
      stagedPromptCoreIdentity: (agent as any).stagedPromptCoreIdentity ?? "",
      asrEndpointingSilenceMs: clampEndpointingMs((agent as any).agentConfig?.asrEndpointingSilenceMs as number | undefined),
      llmMaxTokens: ((agent as any).agentConfig?.llmMaxTokens as number | null | undefined) ?? null,
      ttsMinSentenceChars: ((agent as any).agentConfig?.ttsMinSentenceChars as number | undefined) ?? 18,
      linearDelayMs: clampLinearDelayMs((agent as any).agentConfig?.incrementalDelay as number | undefined),
      fragmentCoalesceListeningMs: clampFragmentCoalesceListeningMs((agent as any).agentConfig?.fragmentCoalesceListeningMs as number | undefined),
      fragmentCoalescePlayingMs: clampFragmentCoalescePlayingMs((agent as any).agentConfig?.fragmentCoalescePlayingMs as number | undefined),
      telephonyTailDrainMs: clampTelephonyTailDrainMs((agent as any).agentConfig?.telephonyTailDrainMs as number | undefined),
      sarvamHighVadSensitivity: ((agent as any).agentConfig?.sarvamHighVadSensitivity as boolean | undefined) === true,
      sarvamSpeechEndFlushMs: clampSarvamSpeechEndFlushMs((agent as any).agentConfig?.sarvamSpeechEndFlushMs as number | undefined),
      sarvamIncompleteHoldMs: clampSarvamIncompleteHoldMs((agent as any).agentConfig?.sarvamIncompleteHoldMs as number | undefined),
      kbBakedOnly: ((agent as any).agentConfig?.kbBakedOnly as boolean | undefined) ?? false,
      startSpeakingWaitSecs:            ((agent as any).agentConfig?.startSpeakingPlan?.waitSeconds as number | undefined)            ?? 0,
      startSpeakingOnPunctuationSecs:   ((agent as any).agentConfig?.startSpeakingPlan?.onPunctuationSeconds as number | undefined)   ?? 0.1,
      startSpeakingOnNoPunctuationSecs: ((agent as any).agentConfig?.startSpeakingPlan?.onNoPunctuationSeconds as number | undefined) ?? 0.1,
      startSpeakingOnNumberSecs:        ((agent as any).agentConfig?.startSpeakingPlan?.onNumberSeconds as number | undefined)        ?? 0.1,
      stopSpeakingNumWords: (() => {
        const fromWords = (agent as any).agentConfig?.wordsForInterruption as number | undefined;
        const fromPlan = (agent as any).agentConfig?.stopSpeakingPlan?.numWords as number | undefined;
        return clampInterruptWords(fromWords ?? fromPlan ?? 3);
      })(),
      stopSpeakingVoiceSecs: (() => {
        const words = clampInterruptWords(
          ((agent as any).agentConfig?.wordsForInterruption as number | undefined)
            ?? ((agent as any).agentConfig?.stopSpeakingPlan?.numWords as number | undefined)
            ?? 3,
        );
        return voiceSecondsFromInterruptWords(words);
      })(),
      stopSpeakingBackOffSecs: ((agent as any).agentConfig?.stopSpeakingPlan?.backOffSeconds as number | undefined) ?? 1,
      complianceIrdai: ((agent as any).agentConfig?.compliance?.irdai as boolean | undefined) ?? false,
      complianceDpdp:  ((agent as any).agentConfig?.compliance?.dpdp  as boolean | undefined) ?? false,
      complianceTrai:  ((agent as any).agentConfig?.compliance?.trai  as boolean | undefined) ?? false,
      autoRedialEnabled:      ((agent as any).agentConfig?.autoRedial?.enabled as boolean | undefined) ?? false,
      autoRedialMaxAttempts:  ((agent as any).agentConfig?.autoRedial?.maxAttempts as number | undefined) ?? 3,
      schedulingCalendarId:   ((agent as any).agentConfig?.calendarCapability?.defaultCalendarId as number | null | undefined) ?? null,
      schedulingEventTypeId:  ((agent as any).agentConfig?.calendarCapability?.defaultEventTypeId as number | null | undefined) ?? null,
      voiceStack:               (((agent as any).agentConfig?.voiceStack as string | undefined) === "gemini_live" ? "gemini_live" : "classic") as AgentFormValues["voiceStack"],
      geminiLiveVoiceName:      ((agent as any).agentConfig?.geminiLive?.voiceName as string | undefined) ?? "Kore",
      geminiLiveThinkingLevel:  ((agent as any).agentConfig?.geminiLive?.thinkingLevel as AgentFormValues["geminiLiveThinkingLevel"] | undefined) ?? "minimal",
    });
    const cfg = (agent as any).agentConfig;
    if (cfg?.voiceStack === "gemini_live") {
      form.setValue("llmProvider", "google");
      form.setValue("llmModel", GEMINI_LIVE_LLM_MODEL);
    }
  }, [agent]);

  const asrProvider = useWatch({ control: form.control, name: "asrProvider" });
  const llmProvider = useWatch({ control: form.control, name: "llmProvider" });
  const llmModel = useWatch({ control: form.control, name: "llmModel" });
  const ttsProvider = useWatch({ control: form.control, name: "ttsProvider" });
  const voiceStack = useWatch({ control: form.control, name: "voiceStack" });
  const geminiLiveVoiceName = useWatch({ control: form.control, name: "geminiLiveVoiceName" });
  const isGeminiLive = isGeminiLiveAgent({ llmModel, voiceStack });
  // "Paste custom Voice ID" UI mode — selecting the option must NOT erase an
  // already-saved voice ID; the value only changes when the user types into
  // the custom input or picks a different curated voice.
  const [voiceCustomMode, setVoiceCustomMode] = useState(false);
  const backchannelingEnabled = useWatch({ control: form.control, name: "backchannelingEnabled" });
  const backchannelingFrequency = useWatch({ control: form.control, name: "backchannelingFrequency" });

  // ── Pipeline config modals (Transcriber / Model / Voice) ─────────────────
  // Fields are still bound directly to the shared `form` instance (same
  // controls, same validation, same submit) — the dialogs are purely a
  // presentation change. A snapshot is taken on open so an outside-click/
  // ESC/close-icon dismissal with unsaved changes can prompt before
  // discarding, and Cancel can restore the pre-edit values.
  type PipelineSection = "transcriber" | "model" | "voice";
  const SECTION_FIELDS: Record<PipelineSection, (keyof AgentFormValues)[]> = {
    transcriber: ["language", "asrProvider", "asrModel", "languageAutoDetect"],
    model: ["llmProvider", "llmModel", "temperature"],
    voice: ["voiceStack", "ttsProvider", "ttsModel", "ttsVoice", "geminiLiveVoiceName", "geminiLiveThinkingLevel"],
  };
  const [openSection, setOpenSection] = useState<PipelineSection | null>(null);
  const [confirmDiscardSection, setConfirmDiscardSection] = useState<PipelineSection | null>(null);
  const sectionSnapshotRef = useRef<{ values: Partial<AgentFormValues>; voiceCustomMode: boolean }>({ values: {}, voiceCustomMode: false });

  const openPipelineDialog = (section: PipelineSection) => {
    const snap: Partial<AgentFormValues> = {};
    for (const field of SECTION_FIELDS[section]) {
      (snap as any)[field] = form.getValues(field);
    }
    sectionSnapshotRef.current = { values: snap, voiceCustomMode };
    setOpenSection(section);
  };

  const isSectionDirty = (section: PipelineSection) => {
    const snap = sectionSnapshotRef.current;
    const fieldsDirty = SECTION_FIELDS[section].some(
      (field) => JSON.stringify(form.getValues(field)) !== JSON.stringify((snap.values as any)[field])
    );
    if (section === "voice" && voiceCustomMode !== snap.voiceCustomMode) return true;
    return fieldsDirty;
  };

  const requestClosePipelineDialog = () => {
    if (!openSection) return;
    if (isSectionDirty(openSection)) {
      setConfirmDiscardSection(openSection);
    } else {
      setOpenSection(null);
    }
  };

  const discardPipelineChanges = () => {
    if (confirmDiscardSection) {
      const snap = sectionSnapshotRef.current;
      for (const field of SECTION_FIELDS[confirmDiscardSection]) {
        form.setValue(field, (snap.values as any)[field] as any);
      }
      if (confirmDiscardSection === "voice") setVoiceCustomMode(snap.voiceCustomMode);
    }
    setConfirmDiscardSection(null);
    setOpenSection(null);
  };

  const savePipelineDialog = () => setOpenSection(null);

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
                          <SelectValue placeholder="Not set (defaults to Asia/Kolkata IST)" />
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
                        <FormDescription>Comma-separated. Agent hangs up after it says any of these phrases.</FormDescription>
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
                      <FormField control={form.control} name="language" render={({ field }) => {
                        const langOpts = languagesForAgent(isGeminiLive);
                        const current = field.value ?? "";
                        const options = (!isGeminiLive || !current || isGeminiLiveLanguage(current) || langOpts.some(l => l.value === current))
                          ? langOpts
                          : [{ value: current, label: LANGUAGES.find(l => l.value === current)?.label ?? current }, ...langOpts];
                        return (
                        <FormItem>
                          <FormLabel>Language</FormLabel>
                          <Select onValueChange={(v) => {
                            field.onChange(v);
                            // Do not auto-swap LLM/voice stack when language changes —
                            // Tamil must not force Gemini Live; model is an explicit choice.
                          }} value={field.value ?? ""}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select language" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {options.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormDescription>
                            {isGeminiLive
                              ? "Gemini Live speaks and listens in this language."
                              : "Passed to ASR + TTS."}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                        );
                      }} />

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
                          <p className="text-xs text-muted-foreground mt-1">Software noise filtering on caller audio. VoBiz and web calls are already denoised upstream (carrier / browser), so this applies to other carriers.</p>
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
                            <Input placeholder="https://your-server.com/webhook/calls" autoComplete="off" {...field} />
                          </FormControl>
                          {wasCleared && (
                            <p className="text-xs text-amber-500 flex items-center gap-1">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />A previously saved URL was cleared because it didn't start with https://. Please re-enter a valid URL.
                            </p>
                          )}
                          {isEmail && (
                            <p className="text-xs text-destructive flex items-center gap-1">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />That looks like an email address, not a URL. Enter an <code>https://</code> endpoint.
                            </p>
                          )}
                          {isHttp && !isEmail && (
                            <p className="text-xs text-amber-500 flex items-center gap-1">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />HTTP URLs are not allowed — must be <code>https://</code>
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
                          <Input type="password" placeholder="Optional — enables HMAC signature header" autoComplete="new-password" {...field} />
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

            {/* ── Pipeline summary cards ── */}
            <div className="md:col-span-2 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <AgentConfigCard
                  icon={isGeminiLive ? <Globe /> : <Mic />}
                  label={isGeminiLive ? "Language" : "Transcriber"}
                  value={
                    isGeminiLive
                      ? (LANGUAGES.find(l => l.value === form.watch("language"))?.label ?? form.watch("language") ?? "Select language")
                      : (ASR_PROVIDERS.find(p => p.value === asrProvider)?.label ?? asrProvider)
                  }
                  subtext={
                    isGeminiLive
                      ? "Gemini Live conversation language"
                      : (form.watch("asrModel") || "Default model")
                  }
                  onClick={() => openPipelineDialog("transcriber")}
                />
                <AgentConfigCard
                  icon={<Brain />}
                  label="Model"
                  value={isGeminiLive ? geminiLiveModelLabel() : (LLM_PROVIDERS.find(p => p.value === llmProvider)?.label ?? llmProvider)}
                  subtext={isGeminiLive ? "Native realtime audio" : (llmModel || "Default model")}
                  onClick={() => openPipelineDialog("model")}
                />
                <AgentConfigCard
                  icon={<Volume2 />}
                  label="Voice"
                  value={
                    isGeminiLive
                      ? (geminiLiveVoiceName || "Kore")
                      : (TTS_PROVIDERS.find(p => p.value === ttsProvider)?.label ?? ttsProvider)
                  }
                  subtext={
                    isGeminiLive
                      ? "Gemini Live preset voice"
                      : (form.watch("ttsModel") || form.watch("ttsVoice") || "Default voice")
                  }
                  onClick={() => openPipelineDialog("voice")}
                />
              </div>

              {/* ── Call Settings (kept inline — not part of a provider stage) ── */}
              <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border/60 bg-card/50 px-4 py-3">
                <FormField control={form.control} name="maxDuration" render={({ field }) => (
                  <FormItem className="flex items-center gap-3 space-y-0 flex-1 min-w-[260px]">
                    <FormLabel className="text-xs text-muted-foreground whitespace-nowrap">Max Call Duration (seconds)</FormLabel>
                    <FormControl>
                      <Input type="number" className="h-8 max-w-[140px]" placeholder="e.g. 600" {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value, 10))} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="telephonyProvider" render={({ field }) => (
                  <FormItem className="flex items-center gap-3 space-y-0">
                    <FormLabel className="text-xs text-muted-foreground whitespace-nowrap">Telephony</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? "vobiz"}>
                      <FormControl><SelectTrigger className="h-8 w-[220px]"><SelectValue placeholder="VoBiz (managed)" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="vobiz">VoBiz (platform / own number)</SelectItem>
                        <SelectItem value="plivo">Plivo — your own account</SelectItem>
                        <SelectItem value="twilio">Twilio — your own account</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </div>
          </div>

          {/* ── Transcriber / Language dialog ── */}
          <EditConfigDialog
            open={openSection === "transcriber"}
            onRequestClose={requestClosePipelineDialog}
            onSave={savePipelineDialog}
            icon={isGeminiLive ? <Globe /> : <Mic />}
            title={isGeminiLive ? "Language" : "Transcriber"}
            description={
              isGeminiLive
                ? "Choose the conversation language for Gemini Live. Native audio has no separate STT — language is enforced via system instructions."
                : "Choose the speech-to-text provider and model used to transcribe caller audio."
            }
          >
            {isGeminiLive ? (
              <>
                <p className="text-[11px] text-muted-foreground rounded-md border border-border/60 bg-muted/30 px-3 py-2 mb-2">
                  Gemini Live supports ~97 languages. Pick the primary language callers should hear and speak.
                </p>
                <FormField control={form.control} name="language" render={({ field }) => {
                  const langOpts = languagesForAgent(true);
                  const current = field.value ?? "";
                  const options = (!current || isGeminiLiveLanguage(current) || langOpts.some(l => l.value === current))
                    ? langOpts
                    : [{ value: current, label: LANGUAGES.find(l => l.value === current)?.label ?? current }, ...langOpts];
                  return (
                  <FormItem>
                    <FormLabel className="text-xs">Language</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select language" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {options.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormDescription>Gemini Live speaks and listens in this language.</FormDescription>
                    <FormMessage />
                  </FormItem>
                  );
                }} />
              </>
            ) : (
              <>
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
              </>
            )}
            <div className="flex items-center justify-between border-t pt-4 mt-2">
              <div>
                <p className="text-xs font-medium">Multilingual</p>
                <p className="text-[11px] text-muted-foreground">
                  {isGeminiLive
                    ? "Allow Gemini Live to follow the caller when they switch languages mid-call."
                    : "Automatically detects and switches between supported languages during the conversation."}
                </p>
              </div>
              <FormField control={form.control} name="languageAutoDetect" render={({ field }) => (
                <Switch
                  checked={field.value ?? false}
                  onCheckedChange={(v) => field.onChange(v)}
                />
              )} />
            </div>
          </EditConfigDialog>

          {/* ── Model dialog ── */}
          <EditConfigDialog
            open={openSection === "model"}
            onRequestClose={requestClosePipelineDialog}
            onSave={savePipelineDialog}
            icon={<Brain />}
            title="Model"
            description="Choose the language model that powers the agent's responses."
          >
            {isGeminiLive && (
              <p className="text-[11px] text-muted-foreground rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                Gemini Live uses native speech-to-speech. Classic STT/TTS are skipped — set language in the Language card and pick a preset voice in Voice.
              </p>
            )}
            <FormField control={form.control} name="llmProvider" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Provider</FormLabel>
                <Select onValueChange={(v) => {
                  field.onChange(v);
                  form.setValue("llmModel", "");
                  form.setValue("voiceStack", "classic");
                }} value={field.value}>
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
                    <ModelSelect
                      options={LLM_MODELS[llmProvider]!}
                      value={field.value}
                      onChange={(v) => {
                        field.onChange(v);
                        form.setValue("voiceStack", voiceStackForLlmModel(v));
                        if (isGeminiLiveLlmModel(v)) {
                          form.setValue("llmProvider", "google");
                        }
                      }}
                      placeholder="Select model"
                    />
                  ) : (
                    <Input placeholder="Enter model name" {...field} />
                  )}
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            {!isGeminiLive && (
            <FormField control={form.control} name="temperature" render={({ field }) => (
              <FormItem>
                <div className="flex justify-between items-center mb-2">
                  <FormLabel className="text-xs">Temperature: {field.value}</FormLabel>
                </div>
                <FormControl>
                  <Slider min={0} max={2} step={0.1} value={[field.value ?? 0.7]}
                    onValueChange={(vals) => field.onChange(vals[0])} />
                </FormControl>
                <FormDescription className="text-[11px]">Higher = more creative. Lower = more deterministic.</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
            )}
          </EditConfigDialog>

          {/* ── Voice dialog ── */}
          <EditConfigDialog
            open={openSection === "voice"}
            onRequestClose={requestClosePipelineDialog}
            onSave={savePipelineDialog}
            icon={<Volume2 />}
            title="Voice"
            description={isGeminiLive ? "Choose a Gemini Live preset voice for this agent." : "Choose the TTS provider and voice for spoken responses."}
          >
            {isGeminiLive ? (
              <>
                <FormField control={form.control} name="geminiLiveVoiceName" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Voice</FormLabel>
                    <FormControl>
                      <GeminiLiveVoicePicker value={field.value ?? "Kore"} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="geminiLiveThinkingLevel" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Thinking level</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? "minimal"}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select thinking level" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {GEMINI_LIVE_THINKING_LEVELS.map((p) => (
                          <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </>
            ) : (
              <>
            <FormField control={form.control} name="ttsProvider" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Provider</FormLabel>
                <Select onValueChange={(v) => { field.onChange(v); setVoiceCustomMode(false); }} value={field.value}>
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
            <FormField control={form.control} name="ttsVoice" render={({ field }) => {
              const voiceList = TTS_VOICES[ttsProvider];
              const curatedValues = voiceList ? voiceList.filter(v => v.value !== "__custom__").map(v => v.value) : [];
              const inCurated = curatedValues.includes(field.value ?? "");
              // When provider has a voice list but saved UUID isn't in it, treat as custom
              const showDropdown = !!voiceList;
              const showCustomInput = !voiceList || !inCurated || voiceCustomMode;
              const dropdownVal = inCurated && !voiceCustomMode ? (field.value ?? "") : (field.value || voiceCustomMode ? "__custom__" : "");
              return (
                <FormItem>
                  <FormLabel className="text-xs">{voiceList ? "Voice" : "Voice ID"}</FormLabel>
                  <FormControl>
                    <div className="space-y-2">
                      {showDropdown && (
                        <ModelSelect
                          options={voiceList!}
                          value={dropdownVal}
                          onChange={(v) => {
                            if (v === "__custom__") {
                              // Show the custom input without erasing the saved voice ID.
                              setVoiceCustomMode(true);
                              return;
                            }
                            setVoiceCustomMode(false);
                            field.onChange(v);
                          }}
                          placeholder="Select voice"
                        />
                      )}
                      {showCustomInput && (
                        <Input
                          placeholder={ttsProvider === "elevenlabs" ? "e.g. 21m00Tcm4TlvDq8ikWAM" : "e.g. 694f9389-aac1-45b6-b726-9d9369183238"}
                          value={field.value ?? ""}
                          onChange={field.onChange}
                        />
                      )}
                    </div>
                  </FormControl>
                  <FormDescription className="text-[10px]">
                    {ttsProvider === "elevenlabs" && "Voice ID from your ElevenLabs account"}
                    {ttsProvider === "cartesia"   && "Voice ID from your Cartesia account"}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              );
            }} />
              </>
            )}
          </EditConfigDialog>

          {/* ── Unsaved changes confirmation ── */}
          <AlertDialog open={confirmDiscardSection !== null} onOpenChange={(v) => { if (!v) setConfirmDiscardSection(null); }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
                <AlertDialogDescription>
                  You have unsaved changes in this dialog. Closing now will discard them.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setConfirmDiscardSection(null)}>Keep Editing</AlertDialogCancel>
                <AlertDialogAction onClick={discardPipelineChanges}>Discard Changes</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* ── Latency Tuning ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Latency Tuning</CardTitle>
              <CardDescription>Control per-stage response speed. Lower values cut latency; higher values improve reliability for slow speakers.</CardDescription>
            </CardHeader>
            <CardContent>
              <FormField control={form.control} name="kbBakedOnly" render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-3 mb-5 p-3 rounded-lg border border-border/60 bg-muted/40">
                  <FormControl>
                    <input type="checkbox" className="mt-1 h-4 w-4 rounded border-border accent-primary cursor-pointer"
                      checked={!!field.value}
                      onChange={e => field.onChange(e.target.checked)} />
                  </FormControl>
                  <div>
                    <FormLabel className="cursor-pointer font-medium">Skip per-turn KB retrieval (baked only)</FormLabel>
                    <FormDescription className="text-[11px] mt-0.5">
                      Skips the per-turn vector search before each LLM call — <strong>saves ~150–200ms</strong>. Use when your KB is small and already baked into the system prompt.
                    </FormDescription>
                  </div>
                </FormItem>
              )} />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <FormField control={form.control} name="asrEndpointingSilenceMs" render={({ field }) => (
                  <FormItem>
                    <FormLabel>STT Endpointing Silence (ms)</FormLabel>
                    <FormControl>
                      <Input type="number" min={100} max={800} step={25}
                        disabled={asrProvider === "sarvam"}
                        value={field.value ?? 250}
                        onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                    </FormControl>
                    {asrProvider === "sarvam" ? (
                      <FormDescription className="text-[11px]">
                        <strong>Not used with Sarvam STT.</strong> Use the pause-detection controls below instead. This knob applies to Azure and Deepgram only.
                      </FormDescription>
                    ) : (
                      <FormDescription className="text-[11px]">
                        Silence after caller's last word before the transcript fires (Azure + Deepgram). <strong>Lower = faster.</strong> Presets: 150ms fast · 250ms balanced · 500ms patient.
                      </FormDescription>
                    )}
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {([150, 250, 400, 500] as const).map(v => (
                        <button key={v} type="button"
                          disabled={asrProvider === "sarvam"}
                          onClick={() => field.onChange(v)}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${asrProvider === "sarvam" ? "opacity-40 cursor-not-allowed bg-muted text-muted-foreground border-border" : field.value === v ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:border-primary/50"}`}>
                          {v}ms
                        </button>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="llmMaxTokens" render={({ field }) => (
                  <FormItem>
                    <FormLabel>LLM Max Output Tokens</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} max={16000} step={10}
                        placeholder="Voice default (200)"
                        value={field.value ?? ""}
                        onChange={e => {
                          const v = e.target.value;
                          field.onChange(v === "" ? null : parseInt(v, 10));
                        }} />
                    </FormControl>
                    <FormDescription className="text-[11px]">
                      Cap on reply length per turn. <strong>Too low cuts sentences mid-word.</strong> Blank = voice default (200). Tamil/Hindi/Indic scripts use 2–4× more tokens than English — use 200–300 there. Gemini 3.x "thinking" overhead is compensated automatically.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="ttsMinSentenceChars" render={({ field }) => (
                  <FormItem>
                    <FormLabel>TTS Early Dispatch Threshold (chars)</FormLabel>
                    <FormControl>
                      <Input type="number" min={5} max={200} step={5}
                        value={field.value ?? 18}
                        onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                    </FormControl>
                    <FormDescription className="text-[11px]">
                      Min chars before a comma-clause triggers an early TTS request mid-LLM-stream. <strong>Lower = TTS fires earlier.</strong> Default: 18 (voice). Range: 5–200.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="linearDelayMs" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Linear Delay (ms)</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} max={1500} step={50}
                        value={field.value ?? 0}
                        onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                    </FormControl>
                    <FormDescription className="text-[11px]">
                      Extra buffer after the transcript arrives and before the LLM starts. Default: <strong>0ms</strong> (off). Raise only if callers pause mid-sentence and get cut off.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="fragmentCoalesceListeningMs" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fragment Hold — Listening (ms)</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} max={2000} step={50}
                        value={field.value ?? 150}
                        onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                    </FormControl>
                    <FormDescription className="text-[11px]">
                      Hold short STT fragments ("Okay.") while the agent is silent, waiting for a follow-up final. <strong>0 = off.</strong> Default 250ms.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="fragmentCoalescePlayingMs" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fragment Hold — Playing (ms)</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} max={3000} step={50}
                        value={field.value ?? 800}
                        onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                    </FormControl>
                    <FormDescription className="text-[11px]">
                      Hold short acks while the agent is speaking (true backchannels). <strong>0 = off.</strong> Default 1000ms.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="telephonyTailDrainMs" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telephony Tail Drain (ms)</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} max={2000} step={50}
                        value={field.value ?? 400}
                        onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                    </FormControl>
                    <FormDescription className="text-[11px]">
                      Silence frames after the last TTS chunk so carriers don't clip the goodbye. Default 400ms. Does not affect mid-call turn latency.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="ttsSpeed" render={({ field }) => (
                  <FormItem>
                    <FormLabel>TTS Playback Speed</FormLabel>
                    <FormControl>
                      <Input type="number" min={0.7} max={1.5} step={0.05}
                        value={field.value ?? 1}
                        onChange={e => field.onChange(parseFloat(e.target.value))} />
                    </FormControl>
                    <FormDescription className="text-[11px]">
                      Playback speed multiplier. 1.0 = normal. <strong>1.05–1.2</strong> sounds slightly quicker without rushing.
                      Applied for Sarvam (Bulbul pace), Cartesia, and ElevenLabs.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {asrProvider === "sarvam" && (
                <div className="mt-6">
                  <p className="text-sm font-medium text-foreground mb-0.5">How quickly the agent hears you stop talking</p>
                  <p className="text-[11px] text-muted-foreground mb-4">
                    These settings control how fast the agent decides you finished speaking. Defaults are already tuned for natural phone calls.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    <FormField control={form.control} name="sarvamHighVadSensitivity" render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Detect pauses quickly</FormLabel>
                        <div className="flex items-center gap-3 pt-2">
                          <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                          <span className="text-sm text-muted-foreground">{field.value ? "On (faster)" : "Off (more patient)"}</span>
                        </div>
                        <FormDescription className="text-[11px]">
                          Default <strong>Off</strong> — avoids cutting callers mid-sentence on phone audio. Turn on only if replies feel too slow.
                        </FormDescription>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="sarvamSpeechEndFlushMs" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Reply kickoff delay (ms)</FormLabel>
                        <FormControl>
                          <Input type="number" min={0} max={200} step={10}
                            value={field.value ?? 80}
                            onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                        </FormControl>
                        <FormDescription className="text-[11px]">
                          Tiny pause after the caller finishes before the agent starts thinking. Default <strong>80</strong>.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="sarvamIncompleteHoldMs" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Wait for unfinished thoughts (ms)</FormLabel>
                        <FormControl>
                          <Input type="number" min={50} max={1000} step={10}
                            value={field.value ?? 700}
                            onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                        </FormControl>
                        <FormDescription className="text-[11px]">
                          Extra wait when someone seems mid-sentence (e.g. “I want…”). Default <strong>700</strong>. Raise if callers get cut off while thinking.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>
              )}

              <div className="mt-6">
                <p className="text-sm font-medium text-foreground mb-0.5">Response Timing — Start Speaking Delays</p>
                <p className="text-[11px] text-muted-foreground mb-4">
                  How long the agent waits after end-of-turn detection before it starts speaking. Values are applied exactly as set here (no silent pipeline cap).
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {(
                    [
                      { name: "startSpeakingWaitSecs",            label: "Base Wait",            desc: "Flat extra pause before any response. 0 = off.", default: 0, step: 0.1, max: 5 },
                      { name: "startSpeakingOnPunctuationSecs",   label: "After Punctuation",    desc: "Extra delay when turn ends with . ? ! or ।. Default 0.1s.", default: 0.1, step: 0.05, max: 3 },
                      { name: "startSpeakingOnNoPunctuationSecs", label: "After No Punctuation", desc: "Extra delay when no terminal punctuation. Default 0.1s — raise if callers trail off mid-sentence.", default: 0.1, step: 0.05, max: 3 },
                      { name: "startSpeakingOnNumberSecs",        label: "After Number",         desc: "Extra delay when turn ends with a digit. Default 0.1s — raise to avoid cutting off phone/OTP numbers.", default: 0.1, step: 0.05, max: 3 },
                    ] as const
                  ).map(({ name, label, desc, default: def, step, max }) => (
                    <FormField key={name} control={form.control} name={name} render={({ field }) => (
                      <FormItem>
                        <FormLabel>{label}</FormLabel>
                        <FormControl>
                          <Input type="number" min={0} max={max} step={step}
                            value={field.value ?? def}
                            onChange={e => field.onChange(parseFloat(e.target.value))} />
                        </FormControl>
                        <FormDescription className="text-[11px]">{desc}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                  ))}
                </div>
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
                    <FormLabel>Thinking Pause Tolerance (ms)</FormLabel>
                    <FormControl>
                      <Input type="number" min={50} max={2000} step={50}
                        value={field.value ?? 350}
                        onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                    </FormControl>
                    <FormDescription className="text-[11px]">How long the caller can pause mid-thought before the agent responds. Default: 350 ms. Increase to 500–700 ms if the agent interrupts during "ahhh…" thinking pauses.</FormDescription>
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
                <FormField control={form.control} name="micSensitivity" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mic Sensitivity</FormLabel>
                    <Select value={field.value ?? "normal"} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="low">Low — filter noisy rooms</SelectItem>
                        <SelectItem value="normal">Normal — default</SelectItem>
                        <SelectItem value="high">High — catch soft replies</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription className="text-[11px]">Scales the noise gate, VAD, and barge-in thresholds together. Low filters out nearby background talkers most aggressively; High catches quieter caller replies but lets more noise through. Advanced thresholds above override this when set.</FormDescription>
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
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  {form.watch("voicemailAction") === "leave_message" && (
                    <>
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
                      <FormField control={form.control} name="voicemailLeadInSeconds" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Lead-in Pause (seconds)</FormLabel>
                          <FormControl>
                            <Input type="number" min={0} max={15} step={1}
                              value={field.value ?? 2}
                              onChange={e => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
                          </FormControl>
                          <FormDescription className="text-[11px]">Wait this long before speaking so the machine's greeting and beep finish first — the whole message gets recorded. Default 2s.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </>
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
                  {/* Event type picker — shared across all booking tools */}
                  <div className="rounded-xl border border-border/60 bg-card/20 px-4 py-3 flex items-center gap-3">
                    <CalendarIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-[11px] text-muted-foreground/70">
                        {agentCalendar ? (
                          <>Calendar: <span className="font-medium text-foreground/80">{agentCalendar.name}</span></>
                        ) : "Event type used by booking tools"}
                      </p>
                      <Select
                        value={schedulingEventTypeId != null ? String(schedulingEventTypeId) : "__none__"}
                        onValueChange={v => form.setValue("schedulingEventTypeId", v === "__none__" ? null : Number(v))}
                        disabled={!calendarIdForEt}
                      >
                        <SelectTrigger className="h-7 text-xs bg-background/50">
                          <SelectValue placeholder="Any event type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__" className="text-xs text-muted-foreground">Any event type</SelectItem>
                          {(agentEventTypes ?? []).map((et: any) => (
                            <SelectItem key={et.id} value={String(et.id)} className="text-xs">{et.title || et.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {calendarIdForEt && (agentEventTypes ?? []).length === 0 && (
                        <p className="text-[10px] text-amber-400/80">No event types yet. Create one in Scheduling → Event Types.</p>
                      )}
                    </div>
                  </div>
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
                          return (
                            <div className="px-4 pb-4 -mt-1">
                              <div className="border-t border-border/30 pt-3 flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {!agentCalendar ? (
                                    <p className="text-[10px] text-amber-400/80">No calendar found for this agent.</p>
                                  ) : !(agentCalendar as any).connectedGoogleEmail ? (
                                    <>
                                      <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded", c.badge, c.badgeText)}>{agentCalendar.name || "Calendar"}</span>
                                      <span className="text-[10px] text-amber-400/80">No Google account connected.</span>
                                    </>
                                  ) : (
                                    <>
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
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 px-0.5 mb-2">Messaging</p>
                <div className="space-y-2">
                  {MESSAGING_TOOLS.map(({ type, icon, color, label, description }) => {
                    const isOn = hasNativeTool(type);
                    const c = bookingColorMap[color];
                    return (
                      <div key={type} className={cn("rounded-xl border transition-all duration-150", isOn ? `${c.border} ${c.bg}` : "border-border/60 bg-card/20")}>
                        <button
                          type="button"
                          className="w-full text-left p-4 flex items-start gap-3"
                          onClick={() => toggleNativeTool(type)}
                        >
                          <div className={cn("mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center shrink-0", isOn ? c.iconBg : "bg-muted/30")}>
                            <span className={cn(isOn ? c.iconText : "text-muted-foreground/35")}>{icon}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className={cn("text-xs font-semibold", isOn ? c.label : "text-foreground/80")}>{label}</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground/60 leading-relaxed">{description}</p>
                          </div>
                          <div className="shrink-0 mt-1 text-muted-foreground/50">
                            {isOn ? <ToggleRight className="h-5 w-5" /> : <ToggleLeft className="h-5 w-5" />}
                          </div>
                        </button>
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
                          <FormField control={form.control} name={`tools.${index}.transferMode`} render={({ field: f }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Transfer Mode</FormLabel>
                              <Select value={f.value ?? "cold"} onValueChange={f.onChange}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="cold">Cold — connect the caller immediately</SelectItem>
                                  <SelectItem value="warm_summary">Warm — brief the human agent first (context-aware)</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormDescription className="text-[10px]">Warm mode generates an AI summary of the conversation and speaks it privately to the human agent before bridging the caller.</FormDescription>
                              <FormMessage />
                            </FormItem>
                          )} />
                          {form.watch(`tools.${index}.transferMode`) === "warm_summary" && (
                            <FormField control={form.control} name={`tools.${index}.summaryPrompt`} render={({ field: f }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Briefing Prompt (optional)</FormLabel>
                                <FormControl><Textarea className="min-h-[60px] text-sm" placeholder="Defaults to: customer name, core issue, priority/urgency, and key context the agent needs to resolve it quickly." {...f} /></FormControl>
                                <FormDescription className="text-[10px]">Instructions for how the AI should summarise the call for the human agent. Leave blank to use the default.</FormDescription>
                                <FormMessage />
                              </FormItem>
                            )} />
                          )}
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

          {/* ── Conversation Continuity ── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PhoneCall className="h-4 w-4 text-green-400" /> Conversation Continuity
              </CardTitle>
              <CardDescription>Automatically call the customer back if the call drops mid-conversation, and resume from where you left off.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="autoRedialEnabled" render={({ field }) => (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Auto-retry on network drop</p>
                    <p className="text-xs text-muted-foreground">When a call drops unexpectedly, automatically call the customer back within 30 seconds and resume the conversation from the last topic. One retry attempt only. Campaign calls are excluded.</p>
                  </div>
                  <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                </div>
              )} />
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
