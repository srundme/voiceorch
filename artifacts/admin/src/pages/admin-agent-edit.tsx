import React, { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { z } from "zod";
import { useForm, useWatch, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft, Bot, Save, Plus, Trash2, PhoneForwarded, Webhook,
  ToggleLeft, ToggleRight,
} from "lucide-react";
import {
  useAdminGetAgent,
  useAdminEditAgent,
} from "@/hooks/use-admin-api";
import {
  ASR_PROVIDERS, LLM_PROVIDERS, TTS_PROVIDERS, TELEPHONY_PROVIDERS,
  ASR_MODELS, LLM_MODELS, TTS_MODELS, TTS_VOICES, LANGUAGES, AGENT_TIMEZONES,
  getModelError,
} from "@/lib/agent-providers";
import { formatAdminError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import type { Control } from "react-hook-form";

// ─── Schema (mirrors dashboard's edit.schema.ts) ──────────────────────────────

const agentFormSchema = z.object({
  name:              z.string().min(1, "Name is required"),
  description:       z.string().optional(),
  asrProvider:       z.string().min(1, "ASR Provider is required"),
  asrModel:          z.string().optional(),
  llmProvider:       z.string().min(1, "LLM Provider is required"),
  llmModel:          z.string().optional(),
  ttsProvider:       z.string().min(1, "TTS Provider is required"),
  ttsVoice:          z.string().optional(),
  ttsModel:          z.string().optional(),
  telephonyProvider: z.string().min(1, "Telephony Provider is required"),
  systemPrompt:      z.string().min(1, "System prompt is required"),
  temperature:       z.number().min(0).max(2).optional(),
  maxDuration:       z.number().min(10).max(3600).optional(),
  greetingMessage:          z.string().optional(),
  firstSpeaker:             z.preprocess((v) => (v === "user" ? "user" : "assistant"), z.enum(["assistant", "user"])),
  endCallPhrases:           z.string().optional(),
  silenceTimeoutSeconds:    z.number().min(5).max(300).optional(),
  language:                 z.string().optional(),
  asrLanguage:              z.string().optional(),
  backchannelingEnabled:    z.boolean().optional(),
  backchannelingFrequency:  z.number().min(0).max(1).optional(),
  webhookUrl:               z.string().optional().refine(
    (v) => !v || v.startsWith("https://"),
    { message: "Webhook URL must start with https://" }
  ),
  webhookSecret:            z.string().optional(),
  noiseCancellationEnabled: z.boolean().optional(),
  ambientNoiseEnabled:      z.boolean().optional(),
  ambientNoiseTrack:        z.string().optional(),
  promptVariables: z.array(z.object({
    key:          z.string().min(1, "Key required"),
    defaultValue: z.string(),
    description:  z.string().optional(),
  })).optional(),
  vadSilenceMs:           z.number().min(50).max(2000).optional(),
  bargeInEnabled:         z.boolean().optional(),
  bargeInEnergyThreshold: z.number().min(100).max(5000).optional(),
  bargeInMinFrames:       z.number().min(1).max(20).optional(),
  timezone:               z.string().optional(),
  autoSwitchToEnglish:    z.boolean().optional(),
  machineDetectionMode:   z.enum(["disabled", "enable", "detect_message_end"]).optional(),
  voicemailAction:        z.enum(["hangup", "leave_message", "continue"]).optional(),
  voicemailMessage:       z.string().optional(),
  tools: z.array(z.object({
    type: z.enum(["call_transfer", "webhook", "send_sms", "end_call", "cal_com", "native_booking", "native_check_availability", "native_list_bookings", "native_reschedule", "native_cancel", "transfer_cold", "transfer_warm", "transfer_agent"]),
    name: z.string().optional(),
    description: z.string().optional(),
    transferTo: z.string().optional(),
    warmHandoffMessage: z.string().optional(),
    url: z.string().optional(),
    method: z.enum(["GET", "POST"]).optional(),
    secret: z.string().optional(),
    preToolMessage: z.string().optional(),
    calendarId: z.preprocess(v => (v === "" || v == null ? undefined : Number(v)), z.number().optional()),
    eventTypeId: z.preprocess(v => (v === "" || v == null ? undefined : Number(v)), z.number().optional()),
    timezone: z.string().optional(),
    goodbyeMessage: z.string().optional(),
    targetNumber: z.string().optional(),
    holdMessage: z.string().optional(),
    targetAgentId: z.number().optional(),
    parameters: z.array(z.object({
      paramName: z.string().min(1, "Name required"),
      dataType: z.enum(["string", "number", "boolean"]),
      paramDescription: z.string().optional(),
      required: z.boolean().optional(),
    })).optional(),
  })).optional(),
  genderDetectionEnabled: z.boolean().optional(),
  recordingEnabled: z.boolean().optional(),
  startSpeakingWaitSecs:          z.number().min(0).max(5).optional(),
  startSpeakingOnPunctuationSecs: z.number().min(0).max(3).optional(),
  startSpeakingOnNoPunctuationSecs: z.number().min(0).max(3).optional(),
  startSpeakingOnNumberSecs:      z.number().min(0).max(3).optional(),
  stopSpeakingNumWords:    z.number().min(0).max(10).optional(),
  stopSpeakingVoiceSecs:   z.number().min(0).max(0.5).optional(),
  stopSpeakingBackOffSecs: z.number().min(0).max(10).optional(),
  complianceIrdai: z.boolean().optional(),
  complianceDpdp:  z.boolean().optional(),
  complianceHipaa: z.boolean().optional(),
  complianceTrai:  z.boolean().optional(),
  snapserveAgentId: z.string().optional(),
  contextWindowTurns: z.number().min(1).max(1000).optional().nullable(),
  summarizationEnabled: z.boolean().optional(),
  stagedPromptEnabled: z.boolean().optional(),
  stagedPromptStages: z.array(z.object({ name: z.string(), content: z.string() })).optional(),
  stagedPromptCoreIdentity: z.string().optional(),
  asrEndpointingSilenceMs: z.number().min(50).max(2000).optional(),
  llmMaxTokens: z.number().min(1).max(16000).optional().nullable(),
  ttsMinSentenceChars: z.number().min(5).max(200).optional(),
  linearDelayMs: z.number().min(0).max(2000).optional(),
}).superRefine((data, ctx) => {
  const asrErr = getModelError(data.asrProvider, data.asrModel, ASR_MODELS);
  if (asrErr) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["asrModel"], message: asrErr });
  const llmErr = getModelError(data.llmProvider, data.llmModel, LLM_MODELS);
  if (llmErr) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["llmModel"], message: llmErr });
  const ttsErr = getModelError(data.ttsProvider, data.ttsModel, TTS_MODELS);
  if (ttsErr) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ttsModel"], message: ttsErr });
});

type AgentFormValues = z.infer<typeof agentFormSchema>;

function buildUpdateAgentPayload(data: AgentFormValues) {
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

// ─── Small helpers ─────────────────────────────────────────────────────────────

function ModelSelect({ options, value, onChange, placeholder }: {
  options: { value: string; label: string }[];
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Select value={value ?? ""} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder={placeholder ?? "Select model"} /></SelectTrigger>
      <SelectContent>
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function WebhookParamsEditor({ control, toolIndex }: { control: Control<AgentFormValues>; toolIndex: number }) {
  const { fields, append, remove } = useFieldArray({ control, name: `tools.${toolIndex}.parameters` as any });
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Parameters (LLM arguments)</span>
        <Button type="button" variant="ghost" size="sm" className="h-6 text-xs px-2"
          onClick={() => append({ paramName: "", dataType: "string", paramDescription: "", required: false })}>
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
              <FormControl><Switch checked={!!f.value} onCheckedChange={f.onChange} className="scale-75 origin-left" /></FormControl>
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

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function AdminAgentEdit() {
  const { clerkId, agentId: agentIdStr } = useParams<{ clerkId: string; agentId: string }>();
  const agentId = parseInt(agentIdStr || "0", 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: agent, isLoading } = useAdminGetAgent(agentId);
  const editAgent = useAdminEditAgent(clerkId || "");
  const formInitialized = useRef(false);
  const [isDirty, setIsDirty] = useState(false);

  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: {
      name: "", description: "", asrProvider: "azure", asrModel: "",
      llmProvider: "openai", llmModel: "", ttsProvider: "cartesia",
      ttsVoice: "", ttsModel: "", telephonyProvider: "twilio",
      systemPrompt: "", temperature: 0.10, maxDuration: 300,
      firstSpeaker: "assistant", endCallPhrases: "", silenceTimeoutSeconds: 30,
      language: "en-US", asrLanguage: "", backchannelingEnabled: true, backchannelingFrequency: 0.5,
      webhookUrl: "", webhookSecret: "", noiseCancellationEnabled: true,
      ambientNoiseEnabled: false, ambientNoiseTrack: "",
      promptVariables: [], vadSilenceMs: 250, bargeInEnabled: true,
      bargeInEnergyThreshold: 1200, bargeInMinFrames: 4, timezone: "",
      autoSwitchToEnglish: false, machineDetectionMode: "disabled",
      voicemailAction: "hangup",
      voicemailMessage: "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you.",
      tools: [], genderDetectionEnabled: false, recordingEnabled: false,
      snapserveAgentId: "", contextWindowTurns: undefined, summarizationEnabled: false,
      stagedPromptEnabled: false, stagedPromptStages: [], stagedPromptCoreIdentity: "",
      asrEndpointingSilenceMs: 100, llmMaxTokens: undefined, ttsMinSentenceChars: 15, linearDelayMs: 0,
    },
  });

  const { fields: toolFields, append: appendTool, remove: removeTool } = useFieldArray({ control: form.control, name: "tools" });
  const { fields: promptVarFields, append: appendPromptVar, remove: removePromptVar } = useFieldArray({ control: form.control, name: "promptVariables" });

  const asrProvider = useWatch({ control: form.control, name: "asrProvider" });
  const llmProvider = useWatch({ control: form.control, name: "llmProvider" });
  const ttsProvider = useWatch({ control: form.control, name: "ttsProvider" });
  const backchannelingEnabled = useWatch({ control: form.control, name: "backchannelingEnabled" });
  const backchannelingFrequency = useWatch({ control: form.control, name: "backchannelingFrequency" });

  useEffect(() => {
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
      firstSpeaker:            (agent.firstSpeaker === "user" ? "user" : "assistant") as AgentFormValues["firstSpeaker"],
      endCallPhrases:          agent.endCallPhrases ?? "",
      silenceTimeoutSeconds:   agent.silenceTimeoutSeconds ?? 30,
      language:                agent.language ?? "en-US",
      asrLanguage:             agent.asrLanguage ?? "",
      backchannelingEnabled:    agent.backchannelingEnabled ?? true,
      backchannelingFrequency:  agent.backchannelingFrequency ?? 0.5,
      webhookUrl:               agent.webhookUrl ?? "",
      webhookSecret:            (agent.agentConfig?.webhookSecret as string | undefined) ?? "",
      noiseCancellationEnabled: agent.noiseCancellationEnabled ?? true,
      ambientNoiseEnabled:      (agent.agentConfig?.ambientNoiseEnabled as boolean | undefined) ?? false,
      ambientNoiseTrack:        (agent.agentConfig?.ambientNoiseTrack as string | undefined) ?? "",
      promptVariables:          (agent.agentConfig?.promptVariables ?? []) as AgentFormValues["promptVariables"],
      vadSilenceMs:             (agent.agentConfig?.vadSilenceMs as number | undefined) ?? 250,
      bargeInEnabled:           (agent.agentConfig?.bargeInEnabled as boolean | undefined) ?? true,
      bargeInEnergyThreshold:   (agent.agentConfig?.bargeInEnergyThreshold as number | undefined) ?? 1200,
      bargeInMinFrames:         (agent.agentConfig?.bargeInMinFrames as number | undefined) ?? 4,
      timezone:                 (agent.agentConfig?.timezone as string | undefined) ?? "",
      autoSwitchToEnglish:      (agent.agentConfig?.autoSwitchToEnglish as boolean | undefined) ?? false,
      machineDetectionMode:     ((agent.agentConfig?.machineDetectionMode as string | undefined) as AgentFormValues["machineDetectionMode"]) ?? "disabled",
      voicemailAction:          ((agent.agentConfig?.voicemailAction as string | undefined) as AgentFormValues["voicemailAction"]) ?? "hangup",
      voicemailMessage:         (agent.agentConfig?.voicemailMessage as string | undefined) ?? "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you.",
      tools: (agent.tools ?? []) as AgentFormValues["tools"],
      genderDetectionEnabled: agent.agentConfig?.genderDetectionEnabled ?? false,
      recordingEnabled: agent.agentConfig?.recordingEnabled ?? false,
      snapserveAgentId: agent.snapserveAgentId ?? "",
      contextWindowTurns: agent.contextWindowTurns ?? undefined,
      summarizationEnabled: agent.agentConfig?.summarizationEnabled ?? false,
      stagedPromptEnabled: agent.stagedPromptEnabled ?? false,
      stagedPromptStages: agent.stagedPromptStages ?? [],
      stagedPromptCoreIdentity: agent.stagedPromptCoreIdentity ?? "",
      asrEndpointingSilenceMs: (agent.agentConfig?.asrEndpointingSilenceMs as number | undefined) ?? 100,
      llmMaxTokens: (agent.agentConfig?.llmMaxTokens as number | null | undefined) ?? null,
      ttsMinSentenceChars: (agent.agentConfig?.ttsMinSentenceChars as number | undefined) ?? 15,
      linearDelayMs: (agent.agentConfig?.incrementalDelay as number | undefined) ?? 0,
      greetingMessage: agent.greetingMessage ?? "",
      complianceIrdai: (agent.agentConfig?.compliance?.irdai as boolean | undefined) ?? false,
      complianceDpdp:  (agent.agentConfig?.compliance?.dpdp  as boolean | undefined) ?? false,
      complianceHipaa: (agent.agentConfig?.compliance?.hipaa as boolean | undefined) ?? false,
      complianceTrai:  (agent.agentConfig?.compliance?.trai  as boolean | undefined) ?? false,
      startSpeakingWaitSecs: (agent.agentConfig?.startSpeakingPlan?.waitSeconds as number | undefined) ?? 0,
      startSpeakingOnPunctuationSecs: (agent.agentConfig?.startSpeakingPlan?.onPunctuationSeconds as number | undefined) ?? 0.1,
      startSpeakingOnNoPunctuationSecs: (agent.agentConfig?.startSpeakingPlan?.onNoPunctuationSeconds as number | undefined) ?? 1.5,
      startSpeakingOnNumberSecs: (agent.agentConfig?.startSpeakingPlan?.onNumberSeconds as number | undefined) ?? 0.5,
      stopSpeakingNumWords: (agent.agentConfig?.stopSpeakingPlan?.numWords as number | undefined) ?? 0,
      stopSpeakingVoiceSecs: (agent.agentConfig?.stopSpeakingPlan?.voiceSeconds as number | undefined) ?? 0.2,
      stopSpeakingBackOffSecs: (agent.agentConfig?.stopSpeakingPlan?.backOffSeconds as number | undefined) ?? 1,
    });
    setIsDirty(false);
  }, [agent]);

  useEffect(() => {
    const sub = form.watch(() => setIsDirty(true));
    return () => sub.unsubscribe();
  }, [form]);

  const onSubmit = (data: AgentFormValues) => {
    const payload = buildUpdateAgentPayload(data);
    editAgent.mutate({ agentId, data: payload as any }, {
      onSuccess: () => {
        toast({ title: "Agent saved", description: "Changes saved successfully." });
        setIsDirty(false);
      },
      onError: (err) => {
        toast({ title: "Save failed", description: formatAdminError(err), variant: "destructive" });
      },
    });
  };

  const handleBack = () => {
    if (isDirty && !confirm("You have unsaved changes. Leave anyway?")) return;
    setLocation(`/users/${clerkId}?tab=agents`);
  };

  const NATIVE_TOOL_TYPES = ["native_booking", "native_check_availability", "native_list_bookings", "native_reschedule", "native_cancel"];
  const watchedTools = (form.watch("tools") ?? []) as any[];
  const hasNativeTool = (type: string) => watchedTools.some((t: any) => t.type === type);
  const nativeToolIndex = (type: string) => watchedTools.findIndex((t: any) => t.type === type);

  const toggleNativeTool = (type: string) => {
    const idx = nativeToolIndex(type);
    if (idx >= 0) { removeTool(idx); } else {
      appendTool({ type: type as any, name: type, description: "" });
    }
  };

  const BOOKING_TOOLS = [
    { type: "native_booking", fnName: "book_appointment", label: "Book Appointment" },
    { type: "native_check_availability", fnName: "check_availability", label: "Check Availability" },
    { type: "native_list_bookings", fnName: "list_bookings", label: "List Bookings" },
    { type: "native_reschedule", fnName: "reschedule_booking", label: "Reschedule Booking" },
    { type: "native_cancel", fnName: "cancel_booking", label: "Cancel Booking" },
  ] as const;

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-10 w-[250px]" />
        <Skeleton className="h-[300px] w-full" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    );
  }

  if (!agent) {
    return <div className="p-8 text-center text-muted-foreground">Agent not found.</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-20">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2 truncate">
            <Bot className="h-5 w-5 text-primary shrink-0" />
            Edit Agent — {agent.name}
          </h2>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">id: {agentId} · user: {clerkId}</p>
        </div>
        <Button
          size="sm"
          className="gap-2 shrink-0"
          disabled={editAgent.isPending}
          onClick={form.handleSubmit(onSubmit)}
        >
          <Save className="h-4 w-4" />
          {editAgent.isPending ? "Saving…" : "Save Changes"}
        </Button>
      </div>

      {isDirty && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-400">
          You have unsaved changes.
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <Tabs defaultValue="core">
            <TabsList className="mb-6">
              <TabsTrigger value="core">Core</TabsTrigger>
              <TabsTrigger value="prompt">Prompt</TabsTrigger>
              <TabsTrigger value="voice">Voice & Audio</TabsTrigger>
              <TabsTrigger value="tools">Tools</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>

            {/* ── Core Tab ────────────────────────────────────────────── */}
            <TabsContent value="core" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>General</CardTitle>
                  <CardDescription>Basic agent identity and pipeline configuration.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField control={form.control} name="name" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl><Input placeholder="e.g. Sales Assistant" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="description" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl><Input placeholder="Optional description" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField control={form.control} name="language" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Language</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value ?? ""}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select language" /></SelectTrigger></FormControl>
                          <SelectContent className="max-h-64">
                            {LANGUAGES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="telephonyProvider" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Telephony Provider</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select telephony" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {TELEPHONY_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField control={form.control} name="maxDuration" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Max Duration (seconds)</FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="300" {...field}
                            onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="temperature" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Temperature: {field.value}</FormLabel>
                        <FormControl>
                          <Slider min={0} max={2} step={0.1} value={[field.value ?? 0.1]}
                            onValueChange={vals => field.onChange(vals[0])} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </CardContent>
              </Card>

              {/* Pipeline */}
              <Card>
                <CardHeader>
                  <CardTitle>Pipeline</CardTitle>
                  <CardDescription>ASR → LLM → TTS provider and model selection.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* ASR */}
                    <div className="space-y-3 p-4 border border-border/60 rounded-lg">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/70 border-b border-border/50 pb-2">Speech-to-Text (ASR)</h4>
                      <FormField control={form.control} name="asrProvider" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Provider</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
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
                              <ModelSelect options={ASR_MODELS[asrProvider]!} value={field.value} onChange={field.onChange} />
                            ) : (
                              <Input placeholder="Enter model name" {...field} />
                            )}
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="asrLanguage" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">ASR Language Override</FormLabel>
                          <FormControl><Input placeholder="e.g. en-IN (leave blank to inherit)" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>

                    {/* LLM */}
                    <div className="space-y-3 p-4 border border-border/60 rounded-lg">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/70 border-b border-border/50 pb-2">Language Model (LLM)</h4>
                      <FormField control={form.control} name="llmProvider" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Provider</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
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
                              <ModelSelect options={LLM_MODELS[llmProvider]!} value={field.value} onChange={field.onChange} />
                            ) : (
                              <Input placeholder="Enter model name" {...field} />
                            )}
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>

                    {/* TTS */}
                    <div className="space-y-3 p-4 border border-border/60 rounded-lg">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/70 border-b border-border/50 pb-2">Text-to-Speech (TTS)</h4>
                      <FormField control={form.control} name="ttsProvider" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Provider</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
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
                              <ModelSelect options={TTS_MODELS[ttsProvider]!} value={field.value} onChange={field.onChange} />
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
                              <Input placeholder="Voice ID" {...field} />
                            )}
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Timezone + admin-only fields */}
              <Card>
                <CardHeader><CardTitle>Call Settings</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField control={form.control} name="timezone" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Timezone</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value ?? ""}>
                          <FormControl><SelectTrigger><SelectValue placeholder="No timezone (server UTC)" /></SelectTrigger></FormControl>
                          <SelectContent className="max-h-64">
                            {AGENT_TIMEZONES.map(tz => <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormDescription className="text-[11px]">Date/time injected into every LLM call.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="silenceTimeoutSeconds" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Silence Timeout (s)</FormLabel>
                        <FormControl>
                          <Input type="number" min={5} max={300} {...field}
                            onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="snapserveAgentId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>SnapServe Agent ID (admin)</FormLabel>
                      <FormControl><Input placeholder="Optional managed agent reference" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Prompt Tab ──────────────────────────────────────────── */}
            <TabsContent value="prompt" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>System Prompt</CardTitle>
                  <CardDescription>The core instructions for the agent's behavior.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField control={form.control} name="systemPrompt" render={({ field }) => (
                    <FormItem>
                      <FormLabel>System Prompt</FormLabel>
                      <FormControl>
                        <Textarea placeholder="You are a helpful assistant..." className="min-h-[200px] font-mono text-sm" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="greetingMessage" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Greeting Message (optional)</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Hello! How can I help you today?" className="min-h-[80px]" {...field} />
                      </FormControl>
                      <FormDescription className="text-[11px]">Spoken at call start. If blank, the LLM generates the opener.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="endCallPhrases" render={({ field }) => (
                    <FormItem>
                      <FormLabel>End-Call Phrases</FormLabel>
                      <FormControl>
                        <Input placeholder="goodbye, bye, have a great day" {...field} />
                      </FormControl>
                      <FormDescription className="text-[11px]">Comma-separated. Triggers automatic hangup when detected.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Staged Prompt</CardTitle>
                  <CardDescription>Multi-stage prompts let the agent switch system prompts mid-call.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField control={form.control} name="stagedPromptEnabled" render={({ field }) => (
                    <FormItem className="flex items-center justify-between">
                      <div><FormLabel>Enable Staged Prompts</FormLabel></div>
                      <FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                  {form.watch("stagedPromptEnabled") && (
                    <>
                      <FormField control={form.control} name="stagedPromptCoreIdentity" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Core Identity (injected into all stages)</FormLabel>
                          <FormControl>
                            <Textarea placeholder="You are a helpful assistant for Acme Corp..." className="min-h-[80px] font-mono text-sm" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Stages</span>
                          <Button type="button" variant="ghost" size="sm" className="h-6 text-xs px-2"
                            onClick={() => form.setValue("stagedPromptStages", [...(form.getValues("stagedPromptStages") ?? []), { name: "", content: "" }])}>
                            <Plus className="h-3 w-3 mr-1" /> Add Stage
                          </Button>
                        </div>
                        {(form.watch("stagedPromptStages") ?? []).map((_, idx) => (
                          <div key={idx} className="rounded-lg border border-border p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <FormField control={form.control} name={`stagedPromptStages.${idx}.name` as any} render={({ field: f }) => (
                                <FormItem className="flex-1 space-y-0">
                                  <FormControl><Input placeholder="Stage name" className="h-7 text-xs" {...f} /></FormControl>
                                </FormItem>
                              )} />
                              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                                onClick={() => {
                                  const stages = [...(form.getValues("stagedPromptStages") ?? [])];
                                  stages.splice(idx, 1);
                                  form.setValue("stagedPromptStages", stages);
                                }}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                            <FormField control={form.control} name={`stagedPromptStages.${idx}.content` as any} render={({ field: f }) => (
                              <FormItem className="space-y-0">
                                <FormControl><Textarea placeholder="System prompt content…" className="min-h-[80px] text-xs" {...f} /></FormControl>
                              </FormItem>
                            )} />
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Prompt Variables</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-end">
                    <Button type="button" variant="outline" size="sm"
                      onClick={() => appendPromptVar({ key: "", defaultValue: "", description: "" })}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add Variable
                    </Button>
                  </div>
                  {promptVarFields.map((field, index) => (
                    <div key={field.id} className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 border rounded-md relative">
                      <Button type="button" variant="ghost" size="icon"
                        className="absolute top-2 right-2 h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => removePromptVar(index)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                      <FormField control={form.control} name={`promptVariables.${index}.key`} render={({ field: f }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Key</FormLabel>
                          <FormControl><Input placeholder="customer_name" className="h-8 text-sm" {...f} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`promptVariables.${index}.defaultValue`} render={({ field: f }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Default Value</FormLabel>
                          <FormControl><Input placeholder="valued customer" className="h-8 text-sm" {...f} /></FormControl>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`promptVariables.${index}.description`} render={({ field: f }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Description</FormLabel>
                          <FormControl><Input placeholder="optional" className="h-8 text-sm" {...f} /></FormControl>
                        </FormItem>
                      )} />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Voice & Audio Tab ────────────────────────────────────── */}
            <TabsContent value="voice" className="space-y-6">
              <Card>
                <CardHeader><CardTitle>Conversation Flow</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <FormField control={form.control} name="firstSpeaker" render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Speaker</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="assistant">Agent speaks first</SelectItem>
                          <SelectItem value="user">Caller speaks first</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="autoSwitchToEnglish" render={({ field }) => (
                    <FormItem className="flex items-center justify-between">
                      <div>
                        <FormLabel>Auto Switch to English</FormLabel>
                        <FormDescription className="text-xs">Switches mid-conversation if caller requests it.</FormDescription>
                      </div>
                      <FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Backchanneling</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <FormField control={form.control} name="backchannelingEnabled" render={({ field }) => (
                    <FormItem className="flex items-center justify-between">
                      <div>
                        <FormLabel>Enabled</FormLabel>
                        <FormDescription className="text-xs">Agent says "I see", "Got it" while thinking.</FormDescription>
                      </div>
                      <FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                  {backchannelingEnabled && (
                    <>
                      <FormField control={form.control} name="backchannelingFrequency" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Frequency: {Math.round((backchannelingFrequency ?? 0.5) * 100)}% of turns</FormLabel>
                          <FormControl>
                            <Slider min={0} max={1} step={0.05} value={[field.value ?? 0.5]}
                              onValueChange={vals => field.onChange(vals[0])} />
                          </FormControl>
                        </FormItem>
                      )} />
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Barge-In & VAD</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <FormField control={form.control} name="bargeInEnabled" render={({ field }) => (
                    <FormItem className="flex items-center justify-between">
                      <div>
                        <FormLabel>Barge-In Enabled</FormLabel>
                        <FormDescription className="text-xs">Allow caller to interrupt the agent mid-speech.</FormDescription>
                      </div>
                      <FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <FormField control={form.control} name="vadSilenceMs" render={({ field }) => (
                      <FormItem>
                        <FormLabel>VAD Silence (ms)</FormLabel>
                        <FormControl>
                          <Input type="number" min={50} max={2000} {...field}
                            onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="bargeInEnergyThreshold" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Barge-In Energy</FormLabel>
                        <FormControl>
                          <Input type="number" min={100} max={5000} {...field}
                            onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="bargeInMinFrames" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Barge-In Min Frames</FormLabel>
                        <FormControl>
                          <Input type="number" min={1} max={20} {...field}
                            onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Audio Processing</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <FormField control={form.control} name="noiseCancellationEnabled" render={({ field }) => (
                    <FormItem className="flex items-center justify-between">
                      <div><FormLabel>Noise Cancellation</FormLabel></div>
                      <FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="ambientNoiseEnabled" render={({ field }) => (
                    <FormItem className="flex items-center justify-between">
                      <div><FormLabel>Ambient Noise</FormLabel></div>
                      <FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                  {form.watch("ambientNoiseEnabled") && (
                    <FormField control={form.control} name="ambientNoiseTrack" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Ambient Noise Track</FormLabel>
                        <FormControl><Input placeholder="e.g. office, cafe" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Webhooks</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <FormField control={form.control} name="webhookUrl" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Post-Call Webhook URL</FormLabel>
                      <FormControl><Input placeholder="https://your-server.com/webhook/calls" {...field} /></FormControl>
                      <FormDescription className="text-xs">Must be HTTPS. Receives a JSON summary when each call ends.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="webhookSecret" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Webhook Signing Secret</FormLabel>
                      <FormControl><Input type="password" placeholder="Optional HMAC secret" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Tools Tab ────────────────────────────────────────────── */}
            <TabsContent value="tools" className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <PhoneForwarded className="h-4 w-4" /> Tools
                      </CardTitle>
                      <CardDescription>Actions the LLM can trigger mid-call.</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="outline" size="sm"
                        onClick={() => appendTool({ type: "call_transfer", name: "transfer_to_human", description: "Transfer the call to a human agent.", transferTo: "", warmHandoffMessage: "" })}>
                        <PhoneForwarded className="h-4 w-4 mr-1" /> Call Transfer
                      </Button>
                      <Button type="button" variant="outline" size="sm"
                        onClick={() => appendTool({ type: "webhook", name: "custom_action", description: "Custom webhook action.", url: "", method: "POST", secret: "", preToolMessage: "", parameters: [] })}>
                        <Webhook className="h-4 w-4 mr-1" /> Custom Function
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {/* Native booking tools */}
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-2">Native Scheduling Tools</p>
                    <div className="space-y-2">
                      {BOOKING_TOOLS.map(({ type, fnName, label }) => {
                        const isOn = hasNativeTool(type);
                        return (
                          <div key={type} className={`rounded-lg border transition-all ${isOn ? "border-primary/40 bg-primary/5" : "border-border/60"}`}>
                            <button type="button" onClick={() => toggleNativeTool(type)}
                              className="w-full text-left p-3 flex items-center gap-3">
                              <div className="flex-1">
                                <code className={`text-[11px] font-mono font-semibold ${isOn ? "text-primary" : "text-foreground/70"}`}>{fnName}</code>
                                <p className="text-[10px] text-muted-foreground">{label}</p>
                              </div>
                              <div>
                                {isOn
                                  ? <ToggleRight className="h-5 w-5 text-primary" />
                                  : <ToggleLeft className="h-5 w-5 text-muted-foreground/30" />}
                              </div>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Custom tools */}
                  {toolFields.filter((_, i) => !NATIVE_TOOL_TYPES.includes(form.getValues(`tools.${i}.type`) ?? "")).length > 0 && (
                    <div className="space-y-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Custom Tools</p>
                      {toolFields.map((field, index) => {
                        const toolType = form.watch(`tools.${index}.type`) ?? "";
                        if (NATIVE_TOOL_TYPES.includes(toolType)) return null;
                        return (
                          <div key={field.id} className="border rounded-md p-4 bg-muted/20 space-y-3 relative">
                            <div className="flex items-center justify-between mb-1">
                              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                {toolType === "webhook"
                                  ? <><Webhook className="h-3 w-3" /> Custom Function</>
                                  : <><PhoneForwarded className="h-3 w-3" /> Call Transfer</>}
                              </span>
                              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeTool(index)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>

                            {toolType === "webhook" ? (
                              <>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  <FormField control={form.control} name={`tools.${index}.name`} render={({ field: f }) => (
                                    <FormItem>
                                      <FormLabel className="text-xs">Function Name</FormLabel>
                                      <FormControl><Input placeholder="check_order_status" {...f} /></FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )} />
                                  <FormField control={form.control} name={`tools.${index}.preToolMessage`} render={({ field: f }) => (
                                    <FormItem>
                                      <FormLabel className="text-xs">Pre-call Message</FormLabel>
                                      <FormControl><Input placeholder="One moment…" {...f} /></FormControl>
                                    </FormItem>
                                  )} />
                                </div>
                                <FormField control={form.control} name={`tools.${index}.description`} render={({ field: f }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Description (shown to LLM)</FormLabel>
                                    <FormControl><Textarea className="min-h-[60px] text-sm" placeholder="Invoke when…" {...f} /></FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )} />
                                <div className="grid grid-cols-[1fr_120px] gap-3">
                                  <FormField control={form.control} name={`tools.${index}.url`} render={({ field: f }) => (
                                    <FormItem>
                                      <FormLabel className="text-xs">Endpoint URL</FormLabel>
                                      <FormControl><Input placeholder="https://api.example.com/webhook" {...f} /></FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )} />
                                  <FormField control={form.control} name={`tools.${index}.method`} render={({ field: f }) => (
                                    <FormItem>
                                      <FormLabel className="text-xs">Method</FormLabel>
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
                                    <FormLabel className="text-xs">Secret</FormLabel>
                                    <FormControl><Input placeholder="optional-shared-secret" type="password" {...f} /></FormControl>
                                  </FormItem>
                                )} />
                                <div className="border-t pt-3">
                                  <WebhookParamsEditor control={form.control} toolIndex={index} />
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  <FormField control={form.control} name={`tools.${index}.name`} render={({ field: f }) => (
                                    <FormItem>
                                      <FormLabel className="text-xs">Function Name</FormLabel>
                                      <FormControl><Input placeholder="transfer_to_human" {...f} /></FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )} />
                                  <FormField control={form.control} name={`tools.${index}.transferTo`} render={({ field: f }) => (
                                    <FormItem>
                                      <FormLabel className="text-xs">Transfer To</FormLabel>
                                      <FormControl><Input placeholder="+12125551234" {...f} /></FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )} />
                                </div>
                                <FormField control={form.control} name={`tools.${index}.description`} render={({ field: f }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Description</FormLabel>
                                    <FormControl><Textarea className="min-h-[60px] text-sm" placeholder="Transfer when…" {...f} /></FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )} />
                                <FormField control={form.control} name={`tools.${index}.warmHandoffMessage`} render={({ field: f }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Warm Handoff Message</FormLabel>
                                    <FormControl><Input placeholder="Connecting you now…" {...f} /></FormControl>
                                  </FormItem>
                                )} />
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Advanced Tab ─────────────────────────────────────────── */}
            <TabsContent value="advanced" className="space-y-6">
              <Card>
                <CardHeader><CardTitle>Recording & Detection</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <FormField control={form.control} name="recordingEnabled" render={({ field }) => (
                    <FormItem className="flex items-center justify-between">
                      <div>
                        <FormLabel>Recording</FormLabel>
                        <FormDescription className="text-xs">Record all calls for this agent.</FormDescription>
                      </div>
                      <FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="genderDetectionEnabled" render={({ field }) => (
                    <FormItem className="flex items-center justify-between">
                      <div>
                        <FormLabel>Gender Detection</FormLabel>
                        <FormDescription className="text-xs">Detect caller gender from voice.</FormDescription>
                      </div>
                      <FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="summarizationEnabled" render={({ field }) => (
                    <FormItem className="flex items-center justify-between">
                      <div>
                        <FormLabel>Call Summarization</FormLabel>
                        <FormDescription className="text-xs">Generate AI summary after each call.</FormDescription>
                      </div>
                      <FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Machine Detection & Voicemail</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <FormField control={form.control} name="machineDetectionMode" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Machine Detection Mode</FormLabel>
                      <Select value={field.value ?? "disabled"} onValueChange={field.onChange}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="disabled">Disabled</SelectItem>
                          <SelectItem value="enable">Enable (detect & hangup or leave msg)</SelectItem>
                          <SelectItem value="detect_message_end">Detect Message End (wait for beep)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  {form.watch("machineDetectionMode") !== "disabled" && (
                    <>
                      <FormField control={form.control} name="voicemailAction" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Voicemail Action</FormLabel>
                          <Select value={field.value ?? "hangup"} onValueChange={field.onChange}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="hangup">Hang up immediately</SelectItem>
                              <SelectItem value="leave_message">Leave a message</SelectItem>
                              <SelectItem value="continue">Continue</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                      {form.watch("voicemailAction") === "leave_message" && (
                        <FormField control={form.control} name="voicemailMessage" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Voicemail Message</FormLabel>
                            <FormControl><Textarea className="min-h-[80px]" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      )}
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Compliance</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {([
                    { name: "complianceIrdai", label: "IRDAI", desc: "Insurance Regulatory and Development Authority of India" },
                    { name: "complianceDpdp",  label: "DPDP",  desc: "Digital Personal Data Protection Act (India)" },
                    { name: "complianceHipaa", label: "HIPAA", desc: "Health Insurance Portability and Accountability Act (US)" },
                    { name: "complianceTrai",  label: "TRAI",  desc: "Telecom Regulatory Authority of India" },
                  ] as const).map(({ name, label, desc }) => (
                    <FormField key={name} control={form.control} name={name} render={({ field }) => (
                      <FormItem className="flex items-center justify-between">
                        <div>
                          <FormLabel>{label}</FormLabel>
                          <FormDescription className="text-xs">{desc}</FormDescription>
                        </div>
                        <FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                      </FormItem>
                    )} />
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Latency Tuning</CardTitle>
                  <CardDescription>Per-stage response speed. Lower values cut latency.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField control={form.control} name="asrEndpointingSilenceMs" render={({ field }) => (
                      <FormItem>
                        <FormLabel>STT Endpointing Silence (ms)</FormLabel>
                        <FormControl>
                          <Input type="number" min={100} max={2000} step={50}
                            value={field.value ?? 400}
                            onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                        </FormControl>
                        <FormDescription className="text-[11px]">Default: 400ms. Lower = faster response.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="llmMaxTokens" render={({ field }) => (
                      <FormItem>
                        <FormLabel>LLM Max Output Tokens</FormLabel>
                        <FormControl>
                          <Input type="number" min={1} max={16000} step={10}
                            placeholder="Model default"
                            value={field.value ?? ""}
                            onChange={e => field.onChange(e.target.value === "" ? null : parseInt(e.target.value, 10))} />
                        </FormControl>
                        <FormDescription className="text-[11px]">Leave blank for no cap.</FormDescription>
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
                        <FormDescription className="text-[11px]">Default: 15. Lower fires TTS earlier.</FormDescription>
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
                        <FormDescription className="text-[11px]">0 = disabled. Adds delay between TTS sentences.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <div className="border-t pt-4">
                    <p className="text-xs font-medium text-muted-foreground mb-3">Context Window</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FormField control={form.control} name="contextWindowTurns" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Sliding Window (turns)</FormLabel>
                          <FormControl>
                            <Input type="number" min={1} max={1000} placeholder="off (full history)"
                              value={field.value == null ? "" : String(field.value)}
                              onChange={e => field.onChange(e.target.value === "" ? null : parseInt(e.target.value, 10))} />
                          </FormControl>
                          <FormDescription className="text-[11px]">Limits how many turns are sent to LLM. Blank = all turns.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </form>
      </Form>
    </div>
  );
}
