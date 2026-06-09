import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  ArrowLeft, Save, Bot, Plus, Trash2, PhoneForwarded,
  ChevronDown, ChevronUp, Database, ClipboardList, Building2,
} from "lucide-react";
import { z } from "zod";
import { useForm, useWatch, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useFamilyStore, InsuranceAgent, AgentStatus } from "@/lib/family-store";
import { AGENT_TIMEZONES } from "@/lib/agent-providers";

/* ── Provider / model catalogues ─────────────────────────────────────────── */

const ASR_PROVIDERS = [
  { value: "deepgram",   label: "Deepgram Nova" }, { value: "azure",      label: "Azure Speech" },
  { value: "assemblyai", label: "AssemblyAI" },    { value: "sarvam",     label: "Sarvam (Saarika)" },
  { value: "cartesia",   label: "Cartesia" },
];
const LLM_PROVIDERS = [
  { value: "openai",    label: "OpenAI" },          { value: "anthropic", label: "Anthropic Claude" },
  { value: "google",    label: "Google Gemini" },   { value: "deepseek",  label: "DeepSeek" },
  { value: "mistral",   label: "Mistral AI" },      { value: "cohere",    label: "Cohere" },
  { value: "qwen",      label: "Qwen (via Groq)" }, { value: "groq",      label: "Groq" },
  { value: "sarvam",    label: "Sarvam" },
];
const TTS_PROVIDERS = [
  { value: "elevenlabs",    label: "ElevenLabs" },    { value: "openai_tts",    label: "OpenAI TTS" },
  { value: "cartesia",      label: "Cartesia (Sonic)" }, { value: "deepgram_aura", label: "Deepgram Aura" },
  { value: "azure_tts",     label: "Azure TTS" },    { value: "sarvam",        label: "Sarvam (Bulbul)" },
];
const TELEPHONY_PROVIDERS = [
  { value: "twilio", label: "Twilio" }, { value: "plivo", label: "Plivo" }, { value: "vobiz", label: "Vobiz" },
];
const LANGUAGES = [
  { value: "en-US", label: "English (US)" }, { value: "en-GB", label: "English (UK)" },
  { value: "en-IN", label: "English (India)" }, { value: "es",    label: "Spanish" },
  { value: "hi",    label: "Hindi" },     { value: "ta-IN", label: "Tamil" },
  { value: "te-IN", label: "Telugu" },    { value: "kn-IN", label: "Kannada" },
  { value: "ml-IN", label: "Malayalam" }, { value: "bn-IN", label: "Bengali (India)" },
  { value: "fr",    label: "French" },    { value: "de",    label: "German" },
  { value: "ja",    label: "Japanese" },  { value: "ko",    label: "Korean" },
  { value: "zh",    label: "Chinese (Mandarin)" }, { value: "ar",    label: "Arabic" },
];
const ASR_MODELS: Record<string, { value: string; label: string }[]> = {
  deepgram:   [{ value: "nova-2", label: "Nova-2 (recommended)" }, { value: "nova-2-phonecall", label: "Nova-2 Phone Call" }],
  azure:      [{ value: "en-US-standard", label: "en-US-standard" }, { value: "en-US-enhanced", label: "en-US-enhanced" }, { value: "en-IN-standard", label: "en-IN-standard" }],
  assemblyai: [{ value: "best", label: "Best (default)" }, { value: "nano", label: "Nano (fast)" }],
  sarvam:     [{ value: "saaras:v3", label: "Saaras v3 (recommended)" }, { value: "saarika:v2.5", label: "Saarika v2.5" }, { value: "saarika:flash", label: "Saarika Flash" }],
  cartesia:   [{ value: "sonic-english", label: "Sonic English" }, { value: "sonic-multilingual", label: "Sonic Multilingual" }],
};
const LLM_MODELS: Record<string, { value: string; label: string }[]> = {
  openai:    [{ value: "gpt-4o-mini", label: "GPT-4o Mini" }, { value: "gpt-4o", label: "GPT-4o" }, { value: "gpt-4-turbo", label: "GPT-4 Turbo" }],
  anthropic: [{ value: "claude-opus-4-5", label: "Claude Opus 4 (best)" }, { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" }, { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" }],
  google:    [{ value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (recommended)" }, { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" }, { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" }],
  deepseek:  [{ value: "deepseek-chat", label: "DeepSeek V3 (chat)" }, { value: "deepseek-reasoner", label: "DeepSeek R1" }],
  mistral:   [{ value: "mistral-large-latest", label: "Mistral Large" }, { value: "mistral-small-latest", label: "Mistral Small" }],
  cohere:    [{ value: "command-r-plus-08-2024", label: "Command R+" }, { value: "command-r-08-2024", label: "Command R" }],
  qwen:      [{ value: "qwen/qwen3-32b", label: "Qwen 3 32B (recommended)" }, { value: "qwen/qwen3-235b-a22b", label: "Qwen 3 235B" }],
  groq:      [{ value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" }, { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B" }],
  sarvam:    [{ value: "sarvam-30b", label: "Sarvam 30B (recommended)" }, { value: "sarvam-105b", label: "Sarvam 105B" }],
};
const TTS_MODELS: Record<string, { value: string; label: string }[]> = {
  cartesia: [
    { value: "sonic-3.5", label: "Sonic 3.5 ✦ New" }, { value: "sonic-3", label: "Sonic 3" },
    { value: "sonic-2", label: "Sonic 2 (stable)" },  { value: "sonic-turbo", label: "Sonic Turbo" },
  ],
};
const TTS_VOICES: Record<string, { value: string; label: string }[] | null> = {
  elevenlabs: null, cartesia: null, azure_tts: null,
  openai_tts: [
    { value: "alloy", label: "Alloy" }, { value: "ash", label: "Ash" }, { value: "coral", label: "Coral" },
    { value: "echo", label: "Echo" },  { value: "fable", label: "Fable" }, { value: "onyx", label: "Onyx" },
    { value: "nova", label: "Nova" },  { value: "sage", label: "Sage" },  { value: "shimmer", label: "Shimmer" },
  ],
  deepgram_aura: [
    { value: "aura-2-en", label: "Aura 2 (default)" }, { value: "aura-asteria-en", label: "Asteria (warm female)" },
    { value: "aura-luna-en", label: "Luna (soft female)" }, { value: "aura-zeus-en", label: "Zeus (deep male)" },
  ],
  sarvam: [
    { value: "meera", label: "Meera (female)" }, { value: "pavithra", label: "Pavithra (female)" },
    { value: "arvind", label: "Arvind (male)" }, { value: "amol", label: "Amol (male)" },
    { value: "neel", label: "Neel (male)" },     { value: "maya", label: "Maya (female)" },
  ],
};

const STATUS_LIST: AgentStatus[] = ["draft", "training", "testing", "approved", "published"];

/* ── Form schema (same as new) ────────────────────────────────────────────── */

const agentFormSchema = z.object({
  status:            z.enum(["draft", "training", "testing", "approved", "published"]),
  companyId:         z.string().min(1, "Company is required"),
  policyId:          z.string().optional(),
  agentType:         z.string().optional(),
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
  greetingMessage:         z.string().optional(),
  endCallPhrases:          z.string().optional(),
  silenceTimeoutSeconds:   z.number().min(5).max(300).optional(),
  language:                z.string().optional(),
  backchannelingEnabled:   z.boolean().optional(),
  backchannelingFrequency: z.number().min(0).max(1).optional(),
  backchannelPhrases:      z.string().optional(),
  webhookUrl:              z.string().optional(),
  noiseCancellationEnabled: z.boolean().optional(),
  inactivityMessage:        z.string().optional(),
  asrLanguage:              z.string().optional(),
  asrBackgroundDenoising:   z.boolean().optional(),
  asrConfidenceThreshold:   z.number().min(0).max(1).optional(),
  asrEndOfTurnConfidence:   z.number().min(0.3).max(1).optional(),
  asrEndOfTurnTimeout:      z.number().min(100).max(30000).optional(),
  asrKeyterms:              z.string().optional(),
  asrSmartEndpointing:      z.enum(["off", "vapi", "livekit"]).optional(),
  asrAutoFallback:          z.boolean().optional(),
  webhookSecret:            z.string().optional(),
  promptVariables: z.array(z.object({
    key: z.string().min(1, "Key required"), defaultValue: z.string(), description: z.string().optional(),
  })).optional(),
  vadSilenceMs:           z.number().min(50).max(2000).optional(),
  bargeInEnabled:         z.boolean().optional(),
  bargeInEnergyThreshold: z.number().min(100).max(5000).optional(),
  bargeInMinFrames:       z.number().min(1).max(20).optional(),
  timezone:               z.string().optional(),
  maxConcurrentCalls:     z.number().min(1).max(100).optional(),
  monthlySpendLimitCents: z.number().min(100).optional(),
  tools: z.array(z.object({
    type: z.literal("call_transfer"),
    name: z.string().min(1, "Function name required"),
    description: z.string().min(1, "Description required"),
    transferTo: z.string().min(1, "Phone number required"),
    warmHandoffMessage: z.string().optional(),
    transferMode: z.enum(["cold", "warm_summary"]).optional(),
    summaryPrompt: z.string().optional(),
  })).optional(),
  dispositionSchema: z.array(z.object({
    key: z.string().min(1, "Key required"), label: z.string().min(1, "Label required"),
    type: z.enum(["text", "number", "boolean", "choice"]),
    required: z.boolean().optional(), options: z.string().optional(),
  })).optional(),
  memoryEnabled:          z.boolean().optional(),
  crossCallMemoryEnabled: z.boolean().optional(),
  contextWindowMessages:  z.number().min(5).max(100).optional(),
  autoCallbackEnabled:      z.boolean().optional(),
  autoCallbackRetries:      z.number().min(1).max(10).optional(),
  autoCallbackDelaySeconds: z.number().min(10).max(3600).optional(),
});

type AgentFormValues = z.infer<typeof agentFormSchema>;

/* ── Smart model select ───────────────────────────────────────────────────── */

function ModelSelect({
  options, value, onChange, placeholder,
}: { options: { value: string; label: string }[]; value: string | undefined; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <Select value={value ?? ""} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder={placeholder ?? "Select model"} /></SelectTrigger>
      <SelectContent>
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

const STATUS_COLORS: Record<AgentStatus, string> = {
  draft: "bg-zinc-700 text-zinc-300", training: "bg-yellow-900/60 text-yellow-300",
  testing: "bg-blue-900/60 text-blue-300", approved: "bg-emerald-900/60 text-emerald-300",
  published: "bg-green-900/60 text-green-300",
};

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function FamilyAgentDetail() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { companies, agents, policies, saveAgents, isLoaded } = useFamilyStore();
  const [showAdvancedSTT, setShowAdvancedSTT] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const agent = agents.find(a => a.id === params.id);
  const formInitialized = useRef(false);

  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: {
      status: "draft", companyId: "", policyId: "", agentType: "inbound_support",
      name: "", description: "",
      asrProvider: "azure", asrModel: "", llmProvider: "openai", llmModel: "",
      ttsProvider: "elevenlabs", ttsVoice: "", ttsModel: "", telephonyProvider: "twilio",
      systemPrompt: "", temperature: 0.7, maxDuration: 600,
      greetingMessage: "", endCallPhrases: "", silenceTimeoutSeconds: 30,
      language: "en-IN", backchannelingEnabled: true, backchannelingFrequency: 0.5,
      backchannelPhrases: "", webhookUrl: "", noiseCancellationEnabled: true,
      inactivityMessage: "", asrLanguage: "",
      asrBackgroundDenoising: false, asrConfidenceThreshold: 0.40,
      asrEndOfTurnConfidence: 0.70, asrEndOfTurnTimeout: 5000,
      asrKeyterms: "", asrSmartEndpointing: "off" as const, asrAutoFallback: true,
      webhookSecret: "", promptVariables: [],
      vadSilenceMs: 250, bargeInEnabled: true, bargeInEnergyThreshold: 1200, bargeInMinFrames: 4,
      timezone: "", tools: [], dispositionSchema: [],
      memoryEnabled: false, crossCallMemoryEnabled: false, contextWindowMessages: 20,
      autoCallbackEnabled: false, autoCallbackRetries: 3, autoCallbackDelaySeconds: 300,
    },
  });

  const { fields: toolFields, append: appendTool, remove: removeTool } = useFieldArray({ control: form.control, name: "tools" });
  const { fields: dispositionFields, append: appendDisposition, remove: removeDisposition } = useFieldArray({ control: form.control, name: "dispositionSchema" });
  const { fields: promptVarFields, append: appendPromptVar, remove: removePromptVar } = useFieldArray({ control: form.control, name: "promptVariables" });

  const asrProvider = useWatch({ control: form.control, name: "asrProvider" });
  const ttsProvider = useWatch({ control: form.control, name: "ttsProvider" });
  const backchannelingEnabled = useWatch({ control: form.control, name: "backchannelingEnabled" });
  const backchannelingFrequency = useWatch({ control: form.control, name: "backchannelingFrequency" });
  const selectedCompanyId = useWatch({ control: form.control, name: "companyId" });
  const memoryEnabled = useWatch({ control: form.control, name: "memoryEnabled" });
  const autoCallbackEnabled = useWatch({ control: form.control, name: "autoCallbackEnabled" });
  const llmProvider = useWatch({ control: form.control, name: "llmProvider" });

  useEffect(() => {
    if (!agent || formInitialized.current || !isLoaded) return;
    formInitialized.current = true;
    form.reset({
      status:            agent.status,
      companyId:         agent.companyId,
      policyId:          agent.policyId ?? "",
      agentType:         agent.agentType ?? "inbound_support",
      name:              agent.name,
      description:       agent.description ?? "",
      asrProvider:       agent.asrProvider ?? "azure",
      asrModel:          agent.asrModel ?? (ASR_MODELS[agent.asrProvider ?? "azure"]?.[0]?.value ?? ""),
      llmProvider:       agent.llmProvider ?? "openai",
      llmModel:          agent.llmModel ?? "",
      ttsProvider:       agent.ttsProvider ?? "elevenlabs",
      ttsVoice:          agent.ttsVoice ?? "",
      ttsModel:          agent.ttsModel ?? "",
      telephonyProvider: agent.telephonyProvider ?? "twilio",
      systemPrompt:      agent.systemPrompt,
      temperature:       agent.temperature ?? 0.7,
      maxDuration:       agent.maxDuration ?? 600,
      greetingMessage:         agent.greetingMessage ?? "",
      endCallPhrases:          agent.endCallPhrases ?? "",
      silenceTimeoutSeconds:   agent.silenceTimeoutSeconds ?? 30,
      language:                agent.language ?? "en-IN",
      backchannelingEnabled:   agent.backchannelingEnabled ?? true,
      backchannelingFrequency: agent.backchannelingFrequency ?? 0.5,
      backchannelPhrases:      agent.backchannelPhrases ?? "",
      webhookUrl:              agent.webhookUrl ?? "",
      webhookSecret:           agent.webhookSecret ?? "",
      noiseCancellationEnabled: agent.noiseCancellationEnabled ?? true,
      inactivityMessage:        agent.inactivityMessage ?? "",
      asrLanguage:              agent.asrLanguage ?? "",
      asrBackgroundDenoising:   agent.asrBackgroundDenoising ?? false,
      asrConfidenceThreshold:   agent.asrConfidenceThreshold ?? 0.40,
      asrEndOfTurnConfidence:   agent.asrEndOfTurnConfidence ?? 0.70,
      asrEndOfTurnTimeout:      agent.asrEndOfTurnTimeout ?? 5000,
      asrKeyterms:              agent.asrKeyterms ?? "",
      asrSmartEndpointing:      agent.asrSmartEndpointing ?? "off",
      asrAutoFallback:          agent.asrAutoFallback ?? true,
      timezone:                 agent.timezone ?? "",
      promptVariables: (agent.promptVariables ?? []) as AgentFormValues["promptVariables"],
      vadSilenceMs:             agent.vadSilenceMs ?? 250,
      bargeInEnabled:           agent.bargeInEnabled ?? true,
      bargeInEnergyThreshold:   agent.bargeInEnergyThreshold ?? 1200,
      bargeInMinFrames:         agent.bargeInMinFrames ?? 4,
      tools: (agent.tools ?? []) as AgentFormValues["tools"],
      dispositionSchema: (agent.dispositionSchema ?? []).map((f: any) => ({
        ...f,
        options: Array.isArray(f.options) ? f.options.join(", ") : (f.options ?? ""),
      })) as AgentFormValues["dispositionSchema"],
      maxConcurrentCalls:     agent.maxConcurrentCalls,
      monthlySpendLimitCents: agent.monthlySpendLimitCents,
      memoryEnabled:          agent.memoryEnabled ?? false,
      crossCallMemoryEnabled: agent.crossCallMemoryEnabled ?? false,
      contextWindowMessages:  agent.contextWindowMessages ?? 20,
      autoCallbackEnabled:      agent.autoCallbackEnabled ?? false,
      autoCallbackRetries:      agent.autoCallbackRetries ?? 3,
      autoCallbackDelaySeconds: agent.autoCallbackDelaySeconds ?? 300,
    });
  }, [agent, isLoaded]);

  const policiesForCompany = policies.filter(p => p.companyId === selectedCompanyId);

  const onSubmit = (data: AgentFormValues) => {
    if (!agent) return;
    setIsSaving(true);
    const company = companies.find(c => c.id === data.companyId);
    const policy = policies.find(p => p.id === data.policyId);
    const updated: InsuranceAgent = {
      ...agent,
      status:      data.status,
      companyId:   data.companyId,
      companyName: company?.name ?? agent.companyName,
      policyId:    data.policyId || undefined,
      policyName:  policy?.name || undefined,
      name:        data.name,
      description: data.description,
      agentMode:   agent.agentMode,
      agentType:   data.agentType as any,
      systemPrompt: data.systemPrompt,
      voiceId:     data.ttsVoice ?? "",
      lastUpdated: new Date().toISOString(),
      asrProvider: data.asrProvider, asrModel: data.asrModel,
      asrLanguage: data.asrLanguage || undefined,
      asrBackgroundDenoising: data.asrBackgroundDenoising,
      asrConfidenceThreshold: data.asrConfidenceThreshold,
      asrEndOfTurnConfidence: data.asrEndOfTurnConfidence,
      asrEndOfTurnTimeout: data.asrEndOfTurnTimeout,
      asrKeyterms: data.asrKeyterms || undefined,
      asrSmartEndpointing: data.asrSmartEndpointing,
      asrAutoFallback: data.asrAutoFallback,
      llmProvider: data.llmProvider, llmModel: data.llmModel,
      ttsProvider: data.ttsProvider, ttsVoice: data.ttsVoice, ttsModel: data.ttsModel,
      telephonyProvider: data.telephonyProvider,
      temperature: data.temperature, maxDuration: data.maxDuration,
      greetingMessage: data.greetingMessage || undefined,
      endCallPhrases: data.endCallPhrases || undefined,
      silenceTimeoutSeconds: data.silenceTimeoutSeconds,
      language: data.language,
      backchannelingEnabled: data.backchannelingEnabled,
      backchannelingFrequency: data.backchannelingFrequency,
      backchannelPhrases: data.backchannelPhrases || undefined,
      webhookUrl: data.webhookUrl || undefined,
      webhookSecret: data.webhookSecret || undefined,
      noiseCancellationEnabled: data.noiseCancellationEnabled,
      inactivityMessage: data.inactivityMessage || undefined,
      timezone: data.timezone || undefined,
      promptVariables: data.promptVariables,
      vadSilenceMs: data.vadSilenceMs,
      bargeInEnabled: data.bargeInEnabled,
      bargeInEnergyThreshold: data.bargeInEnergyThreshold,
      bargeInMinFrames: data.bargeInMinFrames,
      tools: data.tools?.map(t => ({ ...t, transferMode: t.transferMode ?? "cold" })),
      dispositionSchema: data.dispositionSchema?.map(f => ({
        ...f,
        options: f.options ? f.options.split(",").map(s => s.trim()).filter(Boolean).join(", ") : undefined,
      })),
      maxConcurrentCalls: data.maxConcurrentCalls,
      monthlySpendLimitCents: data.monthlySpendLimitCents,
      memoryEnabled: data.memoryEnabled,
      crossCallMemoryEnabled: data.crossCallMemoryEnabled,
      contextWindowMessages: data.contextWindowMessages,
      autoCallbackEnabled: data.autoCallbackEnabled,
      autoCallbackRetries: data.autoCallbackRetries,
      autoCallbackDelaySeconds: data.autoCallbackDelaySeconds,
    };
    saveAgents(agents.map(a => a.id === agent.id ? updated : a));
    toast({ title: "Agent updated", description: "Changes saved successfully." });
    setIsSaving(false);
    setLocation("/family/agents");
  };

  if (!isLoaded) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-10 w-[200px]" />
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Agent not found.{" "}
        <Link href="/family/agents"><span className="text-primary underline cursor-pointer">Back to agents</span></Link>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-6 md:p-8 pt-6 max-w-5xl mx-auto h-full flex flex-col">
      <div className="flex items-center gap-4">
        <Link href="/family/agents">
          <Button variant="outline" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            Edit Agent
          </h2>
          <p className="text-muted-foreground">Update the configuration for <strong>{agent.name}</strong>.</p>
        </div>
        <Badge className={STATUS_COLORS[agent.status]}>{agent.status}</Badge>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pb-20">

          {/* ── Status & Company & Policy ── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                Company, Policy &amp; Status
              </CardTitle>
              <CardDescription>Associate this agent and manage its deployment status.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <FormField control={form.control} name="companyId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company <span className="text-destructive">*</span></FormLabel>
                    <Select onValueChange={v => { field.onChange(v); form.setValue("policyId", ""); }} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger></FormControl>
                      <SelectContent className="max-h-64">
                        {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="policyId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Policy <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""} disabled={!selectedCompanyId}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select policy" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {policiesForCompany.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="agentType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Agent Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="inbound_support">Inbound Support</SelectItem>
                        <SelectItem value="outbound_sales">Outbound Sales</SelectItem>
                        <SelectItem value="appointment_booking">Appointment Booking</SelectItem>
                        <SelectItem value="lead_qualification">Lead Qualification</SelectItem>
                        <SelectItem value="general_purpose">General Purpose</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {STATUS_LIST.map(s => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormDescription className="text-[11px]">Advance through draft → training → testing → approved → published.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </CardContent>
          </Card>

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
                    <FormControl><Input placeholder="e.g. Motor Claims Agent" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (Optional)</FormLabel>
                    <FormControl><Input placeholder="e.g. Handles motor insurance claims queries" {...field} /></FormControl>
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
                      <Textarea placeholder="You are a helpful insurance assistant..." className="min-h-[120px] font-mono text-sm" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="timezone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Timezone</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="No timezone (server UTC used)" /></SelectTrigger>
                      </FormControl>
                      <SelectContent className="max-h-64">
                        {AGENT_TIMEZONES.map(tz => <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormDescription>Current date &amp; time in this timezone is injected into every LLM call.</FormDescription>
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
                    <FormField control={form.control} name="greetingMessage" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Greeting Message</FormLabel>
                        <FormControl>
                          <Textarea placeholder="e.g. Hello! Thanks for calling. How can I help you today?" className="min-h-[80px]" {...field} />
                        </FormControl>
                        <FormDescription>First thing the agent says. Leave blank to let the LLM generate one.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="endCallPhrases" render={({ field }) => (
                      <FormItem>
                        <FormLabel>End-Call Phrases</FormLabel>
                        <FormControl><Input placeholder="goodbye, bye, have a great day, thank you for calling" {...field} /></FormControl>
                        <FormDescription>Comma-separated. Triggers automatic hangup when detected.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="inactivityMessage" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Inactivity Message</FormLabel>
                        <FormControl><Input placeholder="e.g. Are you still there? How can I help you?" {...field} /></FormControl>
                        <FormDescription>Spoken when the caller goes silent beyond the silence timeout.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField control={form.control} name="language" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Language</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value ?? ""}>
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
                              <SelectContent><SelectItem value="false">Off</SelectItem><SelectItem value="true">On</SelectItem></SelectContent>
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
                              <SelectContent><SelectItem value="false">Off</SelectItem><SelectItem value="true">On</SelectItem></SelectContent>
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
                          <FormField control={form.control} name="backchannelPhrases" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Backchannel Phrases</FormLabel>
                              <FormControl><Input placeholder="I see, Got it, Okay, हाँ, समझ गया" {...field} /></FormControl>
                              <FormDescription>Comma-separated. Leave blank for default phrases.</FormDescription>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </>
                      )}
                    </div>
                    <FormField control={form.control} name="webhookUrl" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Post-Call Webhook URL</FormLabel>
                        <FormControl><Input placeholder="https://your-server.com/webhook/calls" {...field} /></FormControl>
                        <FormDescription>Receives a JSON summary when each call ends.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="webhookSecret" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Webhook Signing Secret</FormLabel>
                        <FormControl><Input type="password" placeholder="Optional — enables HMAC signature header" {...field} /></FormControl>
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
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold shrink-0">1</span>
                      <p className="text-sm font-semibold">ASR <span className="text-muted-foreground font-normal text-xs">— Speech-to-Text</span></p>
                    </div>
                    <FormField control={form.control} name="asrProvider" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Provider</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>{ASR_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    {ASR_MODELS[asrProvider] && (
                      <FormField control={form.control} name="asrModel" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Model</FormLabel>
                          <FormControl><ModelSelect options={ASR_MODELS[asrProvider]} value={field.value} onChange={field.onChange} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}
                    <FormField control={form.control} name="maxDuration" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Max Duration (s)</FormLabel>
                        <FormControl>
                          <Input type="number" min={10} max={3600} placeholder="600"
                            {...field} onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                        </FormControl>
                        <FormDescription className="text-[11px]">Hard limit on call length.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  {/* Step 2 — LLM */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold shrink-0">2</span>
                      <p className="text-sm font-semibold">LLM <span className="text-muted-foreground font-normal text-xs">— Language Model</span></p>
                    </div>
                    <FormField control={form.control} name="llmProvider" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Provider</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>{LLM_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    {LLM_MODELS[llmProvider] && (
                      <FormField control={form.control} name="llmModel" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Model</FormLabel>
                          <FormControl><ModelSelect options={LLM_MODELS[llmProvider]} value={field.value} onChange={field.onChange} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}
                  </div>
                  {/* Step 3 — TTS */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold shrink-0">3</span>
                      <p className="text-sm font-semibold">TTS <span className="text-muted-foreground font-normal text-xs">— Text-to-Speech</span></p>
                    </div>
                    <FormField control={form.control} name="ttsProvider" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Provider</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>{TTS_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    {TTS_VOICES[ttsProvider] !== undefined && TTS_VOICES[ttsProvider] !== null && (
                      <FormField control={form.control} name="ttsVoice" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Voice</FormLabel>
                          <FormControl><ModelSelect options={TTS_VOICES[ttsProvider]!} value={field.value} onChange={field.onChange} placeholder="Select voice" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}
                    {TTS_VOICES[ttsProvider] === null && (
                      <FormField control={form.control} name="ttsVoice" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Voice ID</FormLabel>
                          <FormControl><Input placeholder="Paste a voice ID from your provider account" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}
                    {TTS_MODELS[ttsProvider] && (
                      <FormField control={form.control} name="ttsModel" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Model</FormLabel>
                          <FormControl><ModelSelect options={TTS_MODELS[ttsProvider]} value={field.value} onChange={field.onChange} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}
                  </div>
                  {/* Step 4 — Telephony */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold shrink-0">4</span>
                      <p className="text-sm font-semibold">Telephony</p>
                    </div>
                    <FormField control={form.control} name="telephonyProvider" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Provider</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>{TELEPHONY_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── Advanced STT ── */}
          <Card>
            <CardHeader className="pb-3 cursor-pointer" onClick={() => setShowAdvancedSTT(v => !v)}>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Advanced STT Settings</CardTitle>
                  <CardDescription>Fine-tune streaming STT behaviour, confidence thresholds, and end-of-turn detection.</CardDescription>
                </div>
                {showAdvancedSTT ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
            </CardHeader>
            {showAdvancedSTT && (
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  <FormField control={form.control} name="asrKeyterms" render={({ field }) => (
                    <FormItem className="sm:col-span-2 lg:col-span-3">
                      <FormLabel>Key-terms / Boosted Words</FormLabel>
                      <FormControl><Input placeholder="e.g. ICICI, Lombard, policyholder, IRDA, claim, deductible" {...field} /></FormControl>
                      <FormDescription className="text-[11px]">Comma-separated words the ASR should recognise with higher accuracy.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="asrSmartEndpointing" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Smart Endpointing</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? "off"}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="off">Off (default)</SelectItem>
                          <SelectItem value="vapi">Vapi-style</SelectItem>
                          <SelectItem value="livekit">LiveKit-style</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="asrConfidenceThreshold" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confidence Threshold: {field.value?.toFixed(2)}</FormLabel>
                      <FormControl>
                        <Slider min={0} max={1} step={0.05} value={[field.value ?? 0.40]}
                          onValueChange={vals => field.onChange(vals[0])} />
                      </FormControl>
                      <FormDescription className="text-[11px]">Transcripts below this confidence are discarded.</FormDescription>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="asrEndOfTurnConfidence" render={({ field }) => (
                    <FormItem>
                      <FormLabel>End-of-Turn Confidence: {field.value?.toFixed(2)}</FormLabel>
                      <FormControl>
                        <Slider min={0.3} max={1} step={0.05} value={[field.value ?? 0.70]}
                          onValueChange={vals => field.onChange(vals[0])} />
                      </FormControl>
                      <FormDescription className="text-[11px]">How sure ASR must be the user stopped speaking.</FormDescription>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="asrEndOfTurnTimeout" render={({ field }) => (
                    <FormItem>
                      <FormLabel>End-of-Turn Timeout (ms)</FormLabel>
                      <FormControl>
                        <Input type="number" min={100} max={30000} placeholder="5000" {...field}
                          onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                      </FormControl>
                    </FormItem>
                  )} />
                  <div className="space-y-3 p-3 border rounded-md bg-muted/20">
                    <div className="flex items-center justify-between">
                      <div><p className="text-sm font-medium">Background Denoising</p></div>
                      <FormField control={form.control} name="asrBackgroundDenoising" render={({ field }) => (
                        <FormItem>
                          <Select onValueChange={v => field.onChange(v === "true")} value={field.value ? "true" : "false"}>
                            <FormControl><SelectTrigger className="w-[80px]"><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent><SelectItem value="false">Off</SelectItem><SelectItem value="true">On</SelectItem></SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                    </div>
                  </div>
                  <div className="space-y-3 p-3 border rounded-md bg-muted/20">
                    <div className="flex items-center justify-between">
                      <div><p className="text-sm font-medium">Auto Fallback</p></div>
                      <FormField control={form.control} name="asrAutoFallback" render={({ field }) => (
                        <FormItem>
                          <Select onValueChange={v => field.onChange(v === "true")} value={field.value ? "true" : "false"}>
                            <FormControl><SelectTrigger className="w-[80px]"><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent><SelectItem value="false">Off</SelectItem><SelectItem value="true">On</SelectItem></SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                    </div>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          {/* ── Knowledge Base ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="h-4 w-4 text-primary" />
                Knowledge Base <span className="text-muted-foreground font-normal text-sm ml-1">(policy-linked)</span>
              </CardTitle>
              <CardDescription>
                The agent's knowledge base is managed through the Company → Policy page.
                The policy selected above determines which KB this agent uses for RAG.
              </CardDescription>
            </CardHeader>
          </Card>

          {/* ── Prompt Variables ── */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Prompt Variables</CardTitle>
                  <CardDescription>Define <code>{"{{key}}"}</code> placeholders for your system prompt.</CardDescription>
                </div>
                <Button type="button" variant="outline" size="sm" className="gap-1"
                  onClick={() => appendPromptVar({ key: "", defaultValue: "", description: "" })}>
                  <Plus className="h-3.5 w-3.5" /> Add Variable
                </Button>
              </div>
            </CardHeader>
            {promptVarFields.length > 0 && (
              <CardContent className="space-y-3 max-h-96 overflow-y-auto">
                {promptVarFields.map((field, index) => (
                  <div key={field.id} className="relative grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 border rounded-md bg-muted/20">
                    <Button type="button" variant="ghost" size="icon"
                      className="absolute top-2 right-2 h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => removePromptVar(index)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <FormField control={form.control} name={`promptVariables.${index}.key`} render={({ field: f }) => (
                      <FormItem><FormLabel className="text-xs">Key</FormLabel><FormControl><Input placeholder="e.g. company_name" className="h-8 text-sm" {...f} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name={`promptVariables.${index}.defaultValue`} render={({ field: f }) => (
                      <FormItem><FormLabel className="text-xs">Default Value</FormLabel><FormControl><Input placeholder="e.g. ICICI Lombard" className="h-8 text-sm" {...f} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name={`promptVariables.${index}.description`} render={({ field: f }) => (
                      <FormItem><FormLabel className="text-xs">Description (optional)</FormLabel><FormControl><Input placeholder="e.g. The insurance company name" className="h-8 text-sm" {...f} /></FormControl><FormMessage /></FormItem>
                    )} />
                  </div>
                ))}
              </CardContent>
            )}
          </Card>

          {/* ── VAD / Barge-in ── */}
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
                    <FormControl><Input type="number" min={50} max={2000} step={50} value={field.value ?? 250} onChange={e => field.onChange(parseInt(e.target.value, 10))} /></FormControl>
                    <FormDescription className="text-[11px]">Silence before STT flushes. Default: 250 ms</FormDescription>
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
                    <FormControl><Input type="number" min={100} max={5000} step={100} value={field.value ?? 1200} onChange={e => field.onChange(parseInt(e.target.value, 10))} /></FormControl>
                    <FormDescription className="text-[11px]">Min RMS energy to count as speech. Default: 1200</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="bargeInMinFrames" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Barge-in Min Frames</FormLabel>
                    <FormControl><Input type="number" min={1} max={20} value={field.value ?? 4} onChange={e => field.onChange(parseInt(e.target.value, 10))} /></FormControl>
                    <FormDescription className="text-[11px]">Consecutive speech frames to trigger barge-in. Default: 4</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </CardContent>
          </Card>

          {/* ── Tools ── */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><PhoneForwarded className="h-4 w-4" /> Tools</CardTitle>
                  <CardDescription>Actions the LLM can trigger mid-call.</CardDescription>
                </div>
                <Button type="button" variant="outline" size="sm"
                  onClick={() => appendTool({ type: "call_transfer", name: "transfer_to_human", description: "Transfer the call to a human agent when the caller requests it or the issue cannot be resolved automatically.", transferTo: "", warmHandoffMessage: "" })}>
                  <Plus className="h-4 w-4 mr-1" /> Add Tool
                </Button>
              </div>
            </CardHeader>
            {toolFields.length > 0 && (
              <CardContent className="space-y-4">
                {toolFields.map((field, index) => (
                  <div key={field.id} className="border rounded-md p-4 bg-muted/20 space-y-3 relative">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Call Transfer</span>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeTool(index)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <FormField control={form.control} name={`tools.${index}.name`} render={({ field: f }) => (
                        <FormItem><FormLabel className="text-xs">Function Name</FormLabel><FormControl><Input placeholder="e.g. transfer_to_human" {...f} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name={`tools.${index}.transferTo`} render={({ field: f }) => (
                        <FormItem><FormLabel className="text-xs">Transfer To (phone number)</FormLabel><FormControl><Input placeholder="+911234567890" {...f} /></FormControl><FormMessage /></FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name={`tools.${index}.description`} render={({ field: f }) => (
                      <FormItem><FormLabel className="text-xs">Description (shown to LLM)</FormLabel><FormControl><Textarea className="min-h-[60px] text-sm" {...f} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name={`tools.${index}.warmHandoffMessage`} render={({ field: f }) => (
                      <FormItem><FormLabel className="text-xs">Hold Message (optional)</FormLabel><FormControl><Input placeholder="e.g. I'm connecting you with a specialist now. Please hold." {...f} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name={`tools.${index}.transferMode`} render={({ field: f }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Transfer Mode</FormLabel>
                        <div className="flex gap-2 mt-1">
                          {([["cold", "Cold Transfer"], ["warm_summary", "Warm — Brief Operator"]] as const).map(([val, label]) => (
                            <button key={val} type="button" onClick={() => f.onChange(val)}
                              className={"flex-1 text-xs font-medium py-2 rounded-lg border transition-colors " + ((f.value ?? "cold") === val ? "bg-foreground text-background border-foreground" : "bg-card text-muted-foreground border-border hover:border-foreground/40")}>
                              {label}
                            </button>
                          ))}
                        </div>
                      </FormItem>
                    )} />
                  </div>
                ))}
              </CardContent>
            )}
          </Card>

          {/* ── Disposition Schema ── */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><ClipboardList className="h-4 w-4" /> Disposition Fields</CardTitle>
                  <CardDescription>Define fields the AI will automatically extract from each call transcript.</CardDescription>
                </div>
                <Button type="button" variant="outline" size="sm"
                  onClick={() => appendDisposition({ type: "text", key: "", label: "", required: false, options: "" })}>
                  <Plus className="h-4 w-4 mr-1" /> Add Field
                </Button>
              </div>
            </CardHeader>
            {dispositionFields.length > 0 && (
              <CardContent className="space-y-3">
                {dispositionFields.map((field, index) => {
                  const watchedType = form.watch(`dispositionSchema.${index}.type`);
                  return (
                    <div key={field.id} className="border rounded-md p-4 bg-muted/20 space-y-3 relative">
                      <Button type="button" variant="ghost" size="icon" className="absolute top-2 right-2 h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeDisposition(index)}><Trash2 className="h-4 w-4" /></Button>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <FormField control={form.control} name={`dispositionSchema.${index}.key`} render={({ field: f }) => (
                          <FormItem><FormLabel className="text-xs">Key</FormLabel><FormControl><Input placeholder="e.g. call_outcome" {...f} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name={`dispositionSchema.${index}.label`} render={({ field: f }) => (
                          <FormItem><FormLabel className="text-xs">Label</FormLabel><FormControl><Input placeholder="e.g. Call Outcome" {...f} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name={`dispositionSchema.${index}.type`} render={({ field: f }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Type</FormLabel>
                            <Select onValueChange={f.onChange} value={f.value}>
                              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="text">Text</SelectItem><SelectItem value="number">Number</SelectItem>
                                <SelectItem value="boolean">Yes / No</SelectItem><SelectItem value="choice">Choice</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      {watchedType === "choice" && (
                        <FormField control={form.control} name={`dispositionSchema.${index}.options`} render={({ field: f }) => (
                          <FormItem><FormLabel className="text-xs">Options</FormLabel><FormControl><Input placeholder="e.g. resolved, escalated, callback" {...f} /></FormControl><FormMessage /></FormItem>
                        )} />
                      )}
                    </div>
                  );
                })}
              </CardContent>
            )}
          </Card>

          {/* ── Usage Limits ── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Usage Limits <span className="text-muted-foreground font-normal text-sm ml-1">(optional)</span></CardTitle>
              <CardDescription>Cap concurrent calls and monthly spend for this agent.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="maxConcurrentCalls" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max concurrent calls</FormLabel>
                    <FormControl><Input type="number" placeholder="No limit" min={1} max={100} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="monthlySpendLimitCents" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monthly spend limit (USD)</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="absolute left-3 top-2.5 text-muted-foreground text-sm">$</span>
                        <Input type="number" placeholder="No limit" min={1} step={1} className="pl-6"
                          value={field.value != null ? (field.value / 100).toFixed(2) : ""}
                          onChange={(e) => field.onChange(e.target.value === "" ? undefined : Math.round(Number(e.target.value) * 100))} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </CardContent>
          </Card>

          {/* ── Memory ── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Memory &amp; Context</CardTitle>
              <CardDescription>Configure in-call and cross-call memory for this agent.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <FormField control={form.control} name="memoryEnabled" render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>In-Call Memory</FormLabel>
                    <div className="flex items-center gap-3 pt-2">
                      <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
                      <span className="text-sm text-muted-foreground">{(field.value ?? false) ? "Enabled" : "Disabled"}</span>
                    </div>
                    <FormDescription className="text-[11px]">Agent remembers context within the current call.</FormDescription>
                  </FormItem>
                )} />
                <FormField control={form.control} name="crossCallMemoryEnabled" render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Cross-Call Memory</FormLabel>
                    <div className="flex items-center gap-3 pt-2">
                      <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
                      <span className="text-sm text-muted-foreground">{(field.value ?? false) ? "Enabled" : "Disabled"}</span>
                    </div>
                    <FormDescription className="text-[11px]">Agent remembers past calls with the same customer.</FormDescription>
                  </FormItem>
                )} />
                {memoryEnabled && (
                  <FormField control={form.control} name="contextWindowMessages" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Context Window (messages)</FormLabel>
                      <FormControl><Input type="number" min={5} max={100} placeholder="20" value={field.value ?? 20} onChange={e => field.onChange(parseInt(e.target.value, 10))} /></FormControl>
                      <FormDescription className="text-[11px]">Previous messages to include in each LLM call.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
              </div>
            </CardContent>
          </Card>

          {/* ── Auto Callback ── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Auto Callback</CardTitle>
              <CardDescription>Automatically retry calls when the customer doesn't answer.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <FormField control={form.control} name="autoCallbackEnabled" render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Enable Auto Callback</FormLabel>
                    <div className="flex items-center gap-3 pt-2">
                      <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
                      <span className="text-sm text-muted-foreground">{(field.value ?? false) ? "Enabled" : "Disabled"}</span>
                    </div>
                    <FormDescription className="text-[11px]">Retry the call if it goes unanswered.</FormDescription>
                  </FormItem>
                )} />
                {autoCallbackEnabled && (
                  <>
                    <FormField control={form.control} name="autoCallbackRetries" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Max Retries</FormLabel>
                        <FormControl><Input type="number" min={1} max={10} placeholder="3" value={field.value ?? 3} onChange={e => field.onChange(parseInt(e.target.value, 10))} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="autoCallbackDelaySeconds" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Delay Between Retries (s)</FormLabel>
                        <FormControl><Input type="number" min={10} max={3600} placeholder="300" value={field.value ?? 300} onChange={e => field.onChange(parseInt(e.target.value, 10))} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ── Fixed bottom bar ── */}
          <div className="fixed bottom-0 left-0 md:left-64 right-0 p-4 bg-background/80 backdrop-blur-sm border-t border-border flex justify-end z-10">
            <div className="max-w-5xl mx-auto w-full flex justify-end gap-4">
              <Link href="/family/agents">
                <Button type="button" variant="outline">Cancel</Button>
              </Link>
              <Button type="submit" disabled={isSaving}>
                <Save className="mr-2 h-4 w-4" />
                {isSaving ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
