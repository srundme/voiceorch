import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Save, Bot, Plus, Trash2, PhoneForwarded, Sparkles, ChevronDown, ChevronUp, ClipboardList } from "lucide-react";
import { z } from "zod";
import { useForm, useWatch, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
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
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useFamilyStore, DEFAULT_COMPANIES, InsuranceAgent } from "@/lib/family-store";

/* ── Provider / model catalogues ─────────────────────────────────────────── */

const ASR_PROVIDERS = [
  { value: "deepgram",   label: "Deepgram Nova" },
  { value: "azure",      label: "Azure Speech" },
  { value: "assemblyai", label: "AssemblyAI" },
  { value: "sarvam",     label: "Sarvam (Saarika)" },
  { value: "cartesia",   label: "Cartesia" },
];

const LLM_PROVIDERS = [
  { value: "openai",    label: "OpenAI" },
  { value: "anthropic", label: "Anthropic Claude" },
  { value: "google",    label: "Google Gemini" },
  { value: "deepseek",  label: "DeepSeek" },
  { value: "mistral",   label: "Mistral AI" },
  { value: "cohere",    label: "Cohere" },
  { value: "qwen",      label: "Qwen (via Groq)" },
  { value: "groq",      label: "Groq" },
  { value: "sarvam",    label: "Sarvam" },
];

const TTS_PROVIDERS = [
  { value: "elevenlabs",    label: "ElevenLabs" },
  { value: "openai_tts",    label: "OpenAI TTS" },
  { value: "cartesia",      label: "Cartesia (Sonic)" },
  { value: "deepgram_aura", label: "Deepgram Aura" },
  { value: "azure_tts",     label: "Azure TTS" },
  { value: "sarvam",        label: "Sarvam (Bulbul)" },
];

const TELEPHONY_PROVIDERS = [
  { value: "twilio", label: "Twilio" },
  { value: "plivo",  label: "Plivo" },
  { value: "vobiz",  label: "Vobiz" },
];

const LANGUAGES = [
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "en-IN", label: "English (India)" },
  { value: "es",    label: "Spanish" },
  { value: "fr",    label: "French" },
  { value: "de",    label: "German" },
  { value: "hi",    label: "Hindi" },
  { value: "ta-IN", label: "Tamil" },
  { value: "te-IN", label: "Telugu" },
  { value: "kn-IN", label: "Kannada" },
  { value: "ml-IN", label: "Malayalam" },
  { value: "bn-IN", label: "Bengali (India)" },
  { value: "mr-IN", label: "Marathi" },
  { value: "gu-IN", label: "Gujarati" },
  { value: "pa-IN", label: "Punjabi" },
  { value: "ja",    label: "Japanese" },
  { value: "ko",    label: "Korean" },
  { value: "zh",    label: "Chinese (Mandarin)" },
];

const ASR_MODELS: Record<string, { value: string; label: string }[]> = {
  deepgram:   [{ value: "nova-2", label: "Nova-2 (recommended)" }, { value: "nova-2-phonecall", label: "Nova-2 Phone Call" }, { value: "nova-2-meeting", label: "Nova-2 Meeting" }, { value: "whisper-large", label: "Whisper Large" }],
  azure:      [{ value: "en-US-standard", label: "en-US-standard" }, { value: "en-US-enhanced", label: "en-US-enhanced" }, { value: "en-IN-standard", label: "en-IN-standard" }],
  assemblyai: [{ value: "best", label: "Best (default)" }, { value: "nano", label: "Nano (fast)" }],
  sarvam:     [{ value: "saaras:v3", label: "Saaras v3 — real-time streaming (recommended)" }, { value: "saarika:v2.5", label: "Saarika v2.5 — batch" }, { value: "saarika:flash", label: "Saarika Flash — batch (fast)" }],
  cartesia:   [{ value: "sonic-english", label: "Sonic English" }, { value: "sonic-multilingual", label: "Sonic Multilingual" }],
};

const LLM_MODELS: Record<string, { value: string; label: string }[]> = {
  openai:    [{ value: "gpt-4o-mini", label: "GPT-4o Mini" }, { value: "gpt-4o", label: "GPT-4o" }, { value: "gpt-4-turbo", label: "GPT-4 Turbo" }],
  anthropic: [{ value: "claude-opus-4-5", label: "Claude Opus 4 (best)" }, { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" }, { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku (fast)" }],
  google:    [{ value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (recommended)" }, { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" }, { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" }],
  deepseek:  [{ value: "deepseek-chat", label: "DeepSeek V3 (chat)" }, { value: "deepseek-reasoner", label: "DeepSeek R1 (reasoner)" }],
  mistral:   [{ value: "mistral-large-latest", label: "Mistral Large (best)" }, { value: "mistral-small-latest", label: "Mistral Small (fast)" }],
  cohere:    [{ value: "command-r-plus-08-2024", label: "Command R+ (best)" }, { value: "command-r-08-2024", label: "Command R" }],
  qwen:      [{ value: "qwen/qwen3-32b", label: "Qwen 3 32B (recommended)" }, { value: "qwen/qwen3-235b-a22b", label: "Qwen 3 235B" }],
  groq:      [{ value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (recommended)" }, { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B (fast)" }],
  sarvam:    [{ value: "sarvam-30b", label: "Sarvam 30B (recommended)" }, { value: "sarvam-105b", label: "Sarvam 105B" }],
};

const TTS_MODELS: Record<string, { value: string; label: string }[]> = {
  cartesia: [
    { value: "sonic-3.5",   label: "Sonic 3.5 ✦ New — 42 languages, lowest latency" },
    { value: "sonic-3",     label: "Sonic 3" },
    { value: "sonic-2",     label: "Sonic 2 (stable)" },
    { value: "sonic-turbo", label: "Sonic Turbo (fast)" },
  ],
};

const TTS_VOICES: Record<string, { value: string; label: string }[] | null> = {
  elevenlabs:    null,
  cartesia:      null,
  azure_tts:     null,
  openai_tts: [
    { value: "alloy",   label: "Alloy (neutral)" },
    { value: "ash",     label: "Ash (warm)" },
    { value: "coral",   label: "Coral (friendly)" },
    { value: "echo",    label: "Echo (deep)" },
    { value: "nova",    label: "Nova (energetic)" },
    { value: "shimmer", label: "Shimmer (clear)" },
  ],
  deepgram_aura: [
    { value: "aura-2-en",       label: "Aura 2 (default)" },
    { value: "aura-asteria-en", label: "Asteria (warm female)" },
    { value: "aura-luna-en",    label: "Luna (soft female)" },
    { value: "aura-zeus-en",    label: "Zeus (deep male)" },
    { value: "aura-orion-en",   label: "Orion (male)" },
  ],
  sarvam: [
    { value: "meera",    label: "Meera (female)" },
    { value: "pavithra", label: "Pavithra (female)" },
    { value: "maitreyi", label: "Maitreyi (female)" },
    { value: "arvind",   label: "Arvind (male)" },
    { value: "amol",     label: "Amol (male)" },
    { value: "neel",     label: "Neel (male)" },
    { value: "arjun",    label: "Arjun (male)" },
    { value: "maya",     label: "Maya (female)" },
  ],
};

const AGENT_TIMEZONES = [
  { value: "Asia/Kolkata",    label: "Asia/Kolkata (IST, UTC+5:30)" },
  { value: "Asia/Dubai",      label: "Asia/Dubai (GST, UTC+4)" },
  { value: "Asia/Singapore",  label: "Asia/Singapore (SGT, UTC+8)" },
  { value: "Asia/Tokyo",      label: "Asia/Tokyo (JST, UTC+9)" },
  { value: "Europe/London",   label: "Europe/London (GMT/BST)" },
  { value: "America/New_York",label: "America/New_York (ET)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (PT)" },
  { value: "UTC",             label: "UTC" },
];

const DEFAULT_ASR_MODEL = (p: string) => ASR_MODELS[p]?.[0]?.value ?? "";
const DEFAULT_LLM_MODEL = (p: string) => LLM_MODELS[p]?.[0]?.value ?? "";
const DEFAULT_TTS_VOICE = (p: string) => TTS_VOICES[p]?.[0]?.value ?? "";

/* ── Form schema ──────────────────────────────────────────────────────────── */

const agentFormSchema = z.object({
  insuranceCompanyId: z.string().min(1, "Insurance company is required"),
  name:               z.string().min(1, "Agent name is required"),
  description:        z.string().optional(),
  agentMode:          z.enum(["managed", "byop"]),
  asrProvider:        z.string().min(1, "ASR Provider is required"),
  asrModel:           z.string().optional(),
  llmProvider:        z.string().min(1, "LLM Provider is required"),
  llmModel:           z.string().optional(),
  ttsProvider:        z.string().min(1, "TTS Provider is required"),
  ttsVoice:           z.string().optional(),
  ttsModel:           z.string().optional(),
  telephonyProvider:  z.string().min(1, "Telephony Provider is required"),
  systemPrompt:       z.string().min(1, "System prompt is required"),
  temperature:        z.number().min(0).max(2).optional(),
  maxDuration:        z.number().min(10).max(3600).optional(),
  greetingMessage:          z.string().optional(),
  endCallPhrases:           z.string().optional(),
  silenceTimeoutSeconds:    z.number().min(5).max(300).optional(),
  language:                 z.string().optional(),
  backchannelingEnabled:    z.boolean().optional(),
  backchannelingFrequency:  z.number().min(0).max(1).optional(),
  backchannelPhrases:       z.string().optional(),
  noiseCancellationEnabled: z.boolean().optional(),
  inactivityMessage:        z.string().optional(),
  webhookUrl:               z.string().optional(),
  webhookSecret:            z.string().optional(),
  asrLanguage:              z.string().optional(),
  asrBackgroundDenoising:   z.boolean().optional(),
  asrConfidenceThreshold:   z.number().min(0).max(1).optional(),
  asrEndOfTurnConfidence:   z.number().min(0.3).max(1).optional(),
  asrEndOfTurnTimeout:      z.number().min(100).max(30000).optional(),
  asrKeyterms:              z.string().optional(),
  asrSmartEndpointing:      z.enum(["off", "vapi", "livekit"]).optional(),
  asrAutoFallback:          z.boolean().optional(),
  timezone:                 z.string().optional(),
  maxConcurrentCalls:       z.number().min(1).max(100).optional(),
  monthlySpendLimitCents:   z.number().min(100).optional(),
  vadSilenceMs:             z.number().min(50).max(2000).optional(),
  bargeInEnabled:           z.boolean().optional(),
  bargeInEnergyThreshold:   z.number().min(100).max(5000).optional(),
  bargeInMinFrames:         z.number().min(1).max(20).optional(),
  promptVariables: z.array(z.object({
    key:          z.string().min(1, "Key required"),
    defaultValue: z.string(),
    description:  z.string().optional(),
  })).optional(),
  tools: z.array(z.object({
    type:               z.literal("call_transfer"),
    name:               z.string().min(1, "Function name required"),
    description:        z.string().min(1, "Description required"),
    transferTo:         z.string().min(1, "Phone number required"),
    warmHandoffMessage: z.string().optional(),
    transferMode:       z.enum(["cold", "warm_summary"]).optional(),
    summaryPrompt:      z.string().optional(),
  })).optional(),
  dispositionSchema: z.array(z.object({
    key:      z.string().min(1, "Key required"),
    label:    z.string().min(1, "Label required"),
    type:     z.enum(["text", "number", "boolean", "choice"]),
    required: z.boolean().optional(),
    options:  z.string().optional(),
  })).optional(),
});

type AgentFormValues = z.infer<typeof agentFormSchema>;

/* ── Smart model select ───────────────────────────────────────────────────── */

function ModelSelect({ options, value, onChange, placeholder }: {
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

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function FamilyAgentNewPage() {
  const [, setLocation] = useLocation();
  const { agents, saveAgents } = useFamilyStore();
  const [showAdvancedSTT, setShowAdvancedSTT] = useState(false);
  const [saving, setSaving] = useState(false);

  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: {
      insuranceCompanyId:   "",
      name:                 "",
      description:          "",
      agentMode:            "managed",
      asrProvider:          "deepgram",
      asrModel:             "nova-2",
      llmProvider:          "qwen",
      llmModel:             "qwen/qwen3-32b",
      ttsProvider:          "cartesia",
      ttsVoice:             "",
      ttsModel:             "sonic-3",
      telephonyProvider:    "twilio",
      systemPrompt:         "You are a helpful AI voice assistant for an insurance company in India.",
      temperature:          0.7,
      maxDuration:          600,
      greetingMessage:      "",
      endCallPhrases:       "",
      silenceTimeoutSeconds: 30,
      language:             "en-IN",
      backchannelingEnabled: true,
      backchannelingFrequency: 0.5,
      backchannelPhrases:   "",
      noiseCancellationEnabled: true,
      inactivityMessage:    "",
      webhookUrl:           "",
      webhookSecret:        "",
      asrLanguage:          "",
      asrBackgroundDenoising: false,
      asrConfidenceThreshold: 0.40,
      asrEndOfTurnConfidence: 0.70,
      asrEndOfTurnTimeout:    5000,
      asrKeyterms:            "",
      asrSmartEndpointing:    "off",
      asrAutoFallback:        true,
      timezone:               "Asia/Kolkata",
      vadSilenceMs:           250,
      bargeInEnabled:         true,
      bargeInEnergyThreshold: 1200,
      bargeInMinFrames:       4,
      promptVariables:        [],
      tools:                  [],
      dispositionSchema:      [],
    },
  });

  const agentMode = useWatch({ control: form.control, name: "agentMode" });
  const asrProvider = useWatch({ control: form.control, name: "asrProvider" });
  const llmProvider = useWatch({ control: form.control, name: "llmProvider" });
  const ttsProvider = useWatch({ control: form.control, name: "ttsProvider" });
  const backchannelingEnabled = useWatch({ control: form.control, name: "backchannelingEnabled" });
  const backchannelingFrequency = useWatch({ control: form.control, name: "backchannelingFrequency" });

  const { fields: toolFields, append: appendTool, remove: removeTool } = useFieldArray({ control: form.control, name: "tools" });
  const { fields: dispositionFields, append: appendDisposition, remove: removeDisposition } = useFieldArray({ control: form.control, name: "dispositionSchema" });
  const { fields: promptVarFields, append: appendPromptVar, remove: removePromptVar } = useFieldArray({ control: form.control, name: "promptVariables" });

  const isMounted = useRef(false);
  useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return; }
    form.setValue("asrModel", DEFAULT_ASR_MODEL(asrProvider));
  }, [asrProvider]);
  useEffect(() => { form.setValue("llmModel", DEFAULT_LLM_MODEL(llmProvider)); }, [llmProvider]);
  useEffect(() => { form.setValue("ttsVoice", DEFAULT_TTS_VOICE(ttsProvider)); }, [ttsProvider]);
  useEffect(() => { form.setValue("ttsModel", TTS_MODELS[ttsProvider]?.[0]?.value ?? ""); }, [ttsProvider]);

  useEffect(() => {
    if (agentMode === "managed") {
      form.setValue("asrProvider", "deepgram");
      form.setValue("asrModel", "nova-2");
      form.setValue("llmProvider", "qwen");
      form.setValue("llmModel", "qwen/qwen3-32b");
      form.setValue("ttsProvider", "cartesia");
      form.setValue("ttsModel", "sonic-3");
    }
  }, [agentMode]);

  const onSubmit = (data: AgentFormValues) => {
    setSaving(true);
    const company = DEFAULT_COMPANIES.find(c => c.id === data.insuranceCompanyId);
    const newAgent: InsuranceAgent = {
      id: `a${Date.now()}`,
      companyId: data.insuranceCompanyId,
      companyName: company?.name ?? "",
      name: data.name,
      description: data.description,
      status: "draft",
      systemPrompt: data.systemPrompt,
      voiceId: data.ttsVoice ?? "v1",
      kbEntries: 0,
      totalCalls: 0,
      conversionRate: 0,
      lastUpdated: new Date().toISOString(),
      agentMode: data.agentMode,
      asrProvider: data.asrProvider,
      asrModel: data.asrModel,
      asrLanguage: data.asrLanguage,
      asrBackgroundDenoising: data.asrBackgroundDenoising,
      asrConfidenceThreshold: data.asrConfidenceThreshold,
      asrEndOfTurnConfidence: data.asrEndOfTurnConfidence,
      asrEndOfTurnTimeout: data.asrEndOfTurnTimeout,
      asrKeyterms: data.asrKeyterms,
      asrSmartEndpointing: data.asrSmartEndpointing,
      asrAutoFallback: data.asrAutoFallback,
      llmProvider: data.llmProvider,
      llmModel: data.llmModel,
      temperature: data.temperature,
      ttsProvider: data.ttsProvider,
      ttsVoice: data.ttsVoice,
      ttsModel: data.ttsModel,
      telephonyProvider: data.telephonyProvider,
      language: data.language,
      timezone: data.timezone,
      greetingMessage: data.greetingMessage,
      endCallPhrases: data.endCallPhrases,
      silenceTimeoutSeconds: data.silenceTimeoutSeconds,
      backchannelingEnabled: data.backchannelingEnabled,
      backchannelingFrequency: data.backchannelingFrequency,
      backchannelPhrases: data.backchannelPhrases,
      noiseCancellationEnabled: data.noiseCancellationEnabled,
      inactivityMessage: data.inactivityMessage,
      webhookUrl: data.webhookUrl,
      webhookSecret: data.webhookSecret,
      maxDuration: data.maxDuration,
      maxConcurrentCalls: data.maxConcurrentCalls,
      monthlySpendLimitCents: data.monthlySpendLimitCents,
      vadSilenceMs: data.vadSilenceMs,
      bargeInEnabled: data.bargeInEnabled,
      bargeInEnergyThreshold: data.bargeInEnergyThreshold,
      bargeInMinFrames: data.bargeInMinFrames,
      promptVariables: data.promptVariables,
      tools: data.tools as InsuranceAgent["tools"],
      dispositionSchema: data.dispositionSchema as InsuranceAgent["dispositionSchema"],
    };

    const current = JSON.parse(localStorage.getItem("family_agents") ?? "[]") as InsuranceAgent[];
    saveAgents([...current, newAgent]);

    toast.success("Agent created", { description: `${newAgent.name} saved as draft.` });
    setSaving(false);
    setLocation(`/family-agents/${newAgent.id}`);
  };

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center gap-4">
        <Link href="/family-agents">
          <Button variant="outline" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            Create Insurance AI Agent
          </h2>
          <p className="text-muted-foreground">Configure a new AI voice agent for the Family mobile app.</p>
        </div>
      </div>

      {/* ── Mode Selector ── */}
      <div className="grid grid-cols-2 gap-4 max-w-2xl">
        <button
          type="button"
          onClick={() => form.setValue("agentMode", "managed")}
          className={`text-left p-4 rounded-xl border-2 transition-all ${
            agentMode === "managed"
              ? "border-primary bg-primary/5"
              : "border-border bg-card hover:border-muted-foreground/40 hover:bg-muted/40"
          }`}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <Sparkles className={`h-4 w-4 ${agentMode === "managed" ? "text-primary" : "text-muted-foreground"}`} />
            <span className="font-semibold text-sm text-foreground">Managed</span>
            <span className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">Recommended</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Platform-managed ASR, LLM, and TTS. Just write the system prompt.
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-2 font-mono">Deepgram · Qwen 3 32B · Cartesia</p>
        </button>
        <button
          type="button"
          onClick={() => form.setValue("agentMode", "byop")}
          className={`text-left p-4 rounded-xl border-2 transition-all ${
            agentMode === "byop"
              ? "border-primary bg-primary/5"
              : "border-border bg-card hover:border-muted-foreground/40 hover:bg-muted/40"
          }`}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <Bot className={`h-4 w-4 ${agentMode === "byop" ? "text-primary" : "text-muted-foreground"}`} />
            <span className="font-semibold text-sm text-foreground">Bring Your Own Providers</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Full control — choose every provider and model for each stage.
          </p>
        </button>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* ── Insurance Company ── */}
            <Card>
              <CardHeader>
                <CardTitle>Insurance Company</CardTitle>
                <CardDescription>Select the insurance company this agent represents.</CardDescription>
              </CardHeader>
              <CardContent>
                <FormField control={form.control} name="insuranceCompanyId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select insurance company…" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="max-h-72">
                        {DEFAULT_COMPANIES.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            {/* ── General ── */}
            <Card>
              <CardHeader>
                <CardTitle>General Information</CardTitle>
                <CardDescription>Basic details about the agent.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Agent Name</FormLabel>
                    <FormControl><Input placeholder="e.g. ICICI Motor Renewal Agent" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                    <FormControl><Input placeholder="e.g. Handles outbound motor renewal calls" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            {/* ── AI Behavior ── */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>AI Behavior</CardTitle>
                <CardDescription>System prompt, language model settings, and timezone.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <FormField control={form.control} name="systemPrompt" render={({ field }) => (
                    <FormItem>
                      <FormLabel>System Prompt</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="You are a helpful insurance assistant..."
                          className="min-h-[180px] font-mono text-sm"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <div className="space-y-4">
                  <FormField control={form.control} name="temperature" render={({ field }) => (
                    <FormItem>
                      <div className="flex justify-between items-center mb-2">
                        <FormLabel>Temperature: {field.value}</FormLabel>
                      </div>
                      <FormControl>
                        <Slider min={0} max={2} step={0.1} defaultValue={[field.value ?? 0.7]}
                          onValueChange={(vals) => field.onChange(vals[0])} />
                      </FormControl>
                      <FormDescription>Higher = more creative. Lower = more deterministic.</FormDescription>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="timezone" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Timezone</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ""}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select timezone" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {AGENT_TIMEZONES.map(tz => (
                            <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Current date &amp; time is injected into every LLM call.</FormDescription>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="maxDuration" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Call Duration (seconds)</FormLabel>
                      <FormControl>
                        <Input type="number" min={10} max={3600} placeholder="600"
                          value={field.value ?? ""}
                          onChange={e => field.onChange(e.target.value === "" ? undefined : parseInt(e.target.value, 10))} />
                      </FormControl>
                      <FormDescription>Hard cap on call length. 600 = 10 min.</FormDescription>
                    </FormItem>
                  )} />
                </div>
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
                          <Textarea
                            placeholder="e.g. Namaste! Main ICICI Lombard se Priya bol rahi hun. Aapki kya madad kar sakti hun?"
                            className="min-h-[80px]"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>First thing the agent says. Leave blank to let the LLM generate it.</FormDescription>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="endCallPhrases" render={({ field }) => (
                      <FormItem>
                        <FormLabel>End-Call Phrases</FormLabel>
                        <FormControl>
                          <Input placeholder="goodbye, dhanyawad, alvida, bye" {...field} />
                        </FormControl>
                        <FormDescription>Comma-separated. Caller saying any of these ends the call automatically.</FormDescription>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="inactivityMessage" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Inactivity Message</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Aap sun rahe hain? Main call band kar rahi hun. Dhanyawad!" {...field} />
                        </FormControl>
                        <FormDescription>Spoken before silence-timeout hangup. Leave blank for silent hangup.</FormDescription>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="webhookUrl" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Post-Call Webhook URL</FormLabel>
                        <FormControl>
                          <Input placeholder="https://your-server.com/webhook/calls" {...field} />
                        </FormControl>
                        <FormDescription>Receives a JSON summary when each call ends.</FormDescription>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="webhookSecret" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Webhook Signing Secret</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="Optional — enables HMAC signature header" {...field} />
                        </FormControl>
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
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="silenceTimeoutSeconds" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Silence Timeout (s)</FormLabel>
                          <FormControl>
                            <Input type="number" min={5} max={300} placeholder="30" {...field}
                              onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                          </FormControl>
                          <FormDescription>Hang up after N seconds of silence.</FormDescription>
                        </FormItem>
                      )} />
                    </div>

                    <div className="space-y-3 p-4 border rounded-md bg-muted/20">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium leading-none">Noise Cancellation</p>
                          <p className="text-xs text-muted-foreground mt-1">Request noise reduction from ASR provider</p>
                        </div>
                        <FormField control={form.control} name="noiseCancellationEnabled" render={({ field }) => (
                          <FormItem>
                            <Select onValueChange={v => field.onChange(v === "true")} value={field.value ? "true" : "false"}>
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
                          <p className="text-xs text-muted-foreground mt-1">Agent says "I see", "Haan", "Got it" while thinking</p>
                        </div>
                        <FormField control={form.control} name="backchannelingEnabled" render={({ field }) => (
                          <FormItem>
                            <Select onValueChange={v => field.onChange(v === "true")} value={field.value ? "true" : "false"}>
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
                                  onValueChange={vals => field.onChange(vals[0])} />
                              </FormControl>
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="backchannelPhrases" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Backchannel Phrases</FormLabel>
                              <FormControl>
                                <Input placeholder="I see, Got it, Haan, Theek hai, Samajh gaya" {...field} />
                              </FormControl>
                              <FormDescription>Comma-separated. Leave blank for English defaults.</FormDescription>
                            </FormItem>
                          )} />
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ── Pipeline ── */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Pipeline Configuration</CardTitle>
                <CardDescription>Select providers and models for each stage of the voice pipeline.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">

                  {agentMode === "managed" ? (
                    <div className="md:col-span-3 flex items-center gap-3 p-4 rounded-xl border border-primary/20 bg-primary/5">
                      <Sparkles className="h-5 w-5 text-primary shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-foreground">Platform-managed pipeline</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Deepgram Nova-2 (ASR) · Qwen 3 32B (LLM) · Cartesia Sonic-3 (TTS) — powered by managed API keys.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Step 1 — ASR */}
                      <div className="space-y-4 p-4 border rounded-md bg-muted/20 relative">
                        <div className="absolute top-0 right-0 -mt-3 -mr-3 bg-card border border-border rounded-full px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Step 1</div>
                        <h4 className="font-medium border-b pb-2">Speech-to-Text</h4>
                        <FormField control={form.control} name="asrProvider" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Provider</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl><SelectTrigger><SelectValue placeholder="Select ASR" /></SelectTrigger></FormControl>
                              <SelectContent>
                                {ASR_PROVIDERS.map(p => <SelectItem key={`asr-${p.value}`} value={p.value}>{p.label}</SelectItem>)}
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
                      <div className="space-y-4 p-4 border rounded-md bg-muted/20 relative">
                        <div className="absolute top-0 right-0 -mt-3 -mr-3 bg-card border border-border rounded-full px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Step 2</div>
                        <h4 className="font-medium border-b pb-2">Language Model</h4>
                        <FormField control={form.control} name="llmProvider" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Provider</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl><SelectTrigger><SelectValue placeholder="Select LLM" /></SelectTrigger></FormControl>
                              <SelectContent>
                                {LLM_PROVIDERS.map(p => <SelectItem key={`llm-${p.value}`} value={p.value}>{p.label}</SelectItem>)}
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
                      <div className="space-y-4 p-4 border rounded-md bg-muted/20 relative">
                        <div className="absolute top-0 right-0 -mt-3 -mr-3 bg-card border border-border rounded-full px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Step 3</div>
                        <h4 className="font-medium border-b pb-2">Text-to-Speech</h4>
                        <FormField control={form.control} name="ttsProvider" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Provider</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl><SelectTrigger><SelectValue placeholder="Select TTS" /></SelectTrigger></FormControl>
                              <SelectContent>
                                {TTS_PROVIDERS.map(p => <SelectItem key={`tts-${p.value}`} value={p.value}>{p.label}</SelectItem>)}
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
                              {ttsProvider === "cartesia" && "Voice ID from your Cartesia account"}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                    </>
                  )}

                  {/* Step 4 — Telephony */}
                  <div className="space-y-4 p-4 border rounded-md bg-muted/20 relative">
                    <div className="absolute top-0 right-0 -mt-3 -mr-3 bg-card border border-border rounded-full px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Step 4</div>
                    <h4 className="font-medium border-b pb-2">Telephony</h4>
                    <FormField control={form.control} name="telephonyProvider" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Provider</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select Telephony" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {TELEPHONY_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                </div>
              </CardContent>
            </Card>

            {/* ── Advanced STT ── */}
            <Card className="md:col-span-2">
              <CardHeader
                className="cursor-pointer select-none"
                onClick={() => setShowAdvancedSTT(v => !v)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Advanced STT Settings</CardTitle>
                    <CardDescription>Fine-tune ASR confidence thresholds, endpointing, and denoising.</CardDescription>
                  </div>
                  {showAdvancedSTT ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </CardHeader>
              {showAdvancedSTT && (
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="asrLanguage" render={({ field }) => (
                      <FormItem>
                        <FormLabel>ASR Language Override</FormLabel>
                        <FormControl><Input placeholder="e.g. hi-IN (overrides language field)" {...field} /></FormControl>
                        <FormDescription className="text-[11px]">BCP-47 code passed directly to ASR provider.</FormDescription>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="asrKeyterms" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Keyword Boosting</FormLabel>
                        <FormControl><Input placeholder="IRDAI, NCB, OTP, IDV, cashless" {...field} /></FormControl>
                        <FormDescription className="text-[11px]">Comma-separated insurance/domain terms to boost.</FormDescription>
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="asrSmartEndpointing" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Smart Endpointing</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? "off"}>
                        <FormControl><SelectTrigger className="max-w-[200px]"><SelectValue /></SelectTrigger></FormControl>
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
                      <FormDescription className="text-[11px]">Silence window (ms) before ASR finalizes a turn.</FormDescription>
                    </FormItem>
                  )} />
                  <div className="space-y-3 p-3 border rounded-md bg-muted/20">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Background Denoising</p>
                        <p className="text-xs text-muted-foreground">Filter background noise during transcription</p>
                      </div>
                      <FormField control={form.control} name="asrBackgroundDenoising" render={({ field }) => (
                        <FormItem>
                          <Select onValueChange={v => field.onChange(v === "true")} value={field.value ? "true" : "false"}>
                            <FormControl><SelectTrigger className="w-[80px]"><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="false">Off</SelectItem>
                              <SelectItem value="true">On</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                    </div>
                  </div>
                  <div className="space-y-3 p-3 border rounded-md bg-muted/20">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Auto Fallback</p>
                        <p className="text-xs text-muted-foreground">Switch to batch STT if streaming fails</p>
                      </div>
                      <FormField control={form.control} name="asrAutoFallback" render={({ field }) => (
                        <FormItem>
                          <Select onValueChange={v => field.onChange(v === "true")} value={field.value ? "true" : "false"}>
                            <FormControl><SelectTrigger className="w-[80px]"><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="false">Off</SelectItem>
                              <SelectItem value="true">On</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>

            {/* ── Prompt Variables ── */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Prompt Variables</CardTitle>
                    <CardDescription>
                      Define <code>{"{{key}}"}</code> placeholders in your system prompt.
                    </CardDescription>
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
                </CardContent>
              )}
            </Card>

            {/* ── VAD & Barge-in ── */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Voice Activity Detection &amp; Barge-in</CardTitle>
                <CardDescription>Fine-tune how the agent detects speech and handles interruptions.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <FormField control={form.control} name="vadSilenceMs" render={({ field }) => (
                    <FormItem>
                      <FormLabel>VAD Silence Window (ms)</FormLabel>
                      <FormControl>
                        <Input type="number" min={50} max={2000} step={50}
                          value={field.value ?? 250}
                          onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                      </FormControl>
                      <FormDescription className="text-[11px]">Silence before STT flushes. Default: 250 ms</FormDescription>
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
                      <FormDescription className="text-[11px]">Consecutive frames to trigger barge-in. Default: 4 (~80 ms)</FormDescription>
                    </FormItem>
                  )} />
                </div>
              </CardContent>
            </Card>

            {/* ── Tools ── */}
            <Card className="md:col-span-2">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2"><PhoneForwarded className="h-4 w-4" /> Tools</CardTitle>
                    <CardDescription>Actions the LLM can trigger mid-call, like transferring to a human agent.</CardDescription>
                  </div>
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => appendTool({ type: "call_transfer", name: "transfer_to_human", description: "Transfer the call to a human agent when the caller requests it.", transferTo: "", warmHandoffMessage: "" })}>
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
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeTool(index)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <FormField control={form.control} name={`tools.${index}.name`} render={({ field: f }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Function Name</FormLabel>
                            <FormControl><Input placeholder="e.g. transfer_to_human" {...f} /></FormControl>
                            <FormDescription className="text-[10px]">snake_case — used by the LLM</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name={`tools.${index}.transferTo`} render={({ field: f }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Transfer To (phone number)</FormLabel>
                            <FormControl><Input placeholder="+919876543210" {...f} /></FormControl>
                            <FormDescription className="text-[10px]">E.164 format</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      <FormField control={form.control} name={`tools.${index}.description`} render={({ field: f }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Description (shown to LLM)</FormLabel>
                          <FormControl><Textarea className="min-h-[60px] text-sm" placeholder="Transfer to a human agent when the caller is frustrated or the issue is complex." {...f} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`tools.${index}.warmHandoffMessage`} render={({ field: f }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Hold Message <span className="text-muted-foreground font-normal">(optional — spoken to caller)</span></FormLabel>
                          <FormControl><Input placeholder="e.g. Main aapko ek specialist se connect kar rahi hun. Thoda intezaar karein." {...f} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`tools.${index}.transferMode`} render={({ field: f }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Transfer Mode</FormLabel>
                          <div className="flex gap-2 mt-1">
                            {([["cold", "Cold Transfer"], ["warm_summary", "Warm — Brief Operator"]] as const).map(([val, label]) => (
                              <button key={val} type="button"
                                onClick={() => f.onChange(val)}
                                className={
                                  "flex-1 text-xs font-medium py-2 rounded-lg border transition-colors " +
                                  ((f.value ?? "cold") === val
                                    ? "bg-foreground text-background border-foreground"
                                    : "bg-card text-muted-foreground border-border hover:border-foreground/40")
                                }>{label}</button>
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
            <Card className="md:col-span-2">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2"><ClipboardList className="h-4 w-4" /> Disposition Fields</CardTitle>
                    <CardDescription>Fields the AI automatically extracts from each call transcript after it ends.</CardDescription>
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
                        <Button type="button" variant="ghost" size="icon" className="absolute top-2 right-2 h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeDisposition(index)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <FormField control={form.control} name={`dispositionSchema.${index}.key`} render={({ field: f }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Key</FormLabel>
                              <FormControl><Input placeholder="e.g. call_outcome" {...f} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={form.control} name={`dispositionSchema.${index}.label`} render={({ field: f }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Label</FormLabel>
                              <FormControl><Input placeholder="e.g. Call Outcome" {...f} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={form.control} name={`dispositionSchema.${index}.type`} render={({ field: f }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Type</FormLabel>
                              <Select onValueChange={f.onChange} value={f.value}>
                                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent>
                                  <SelectItem value="text">Text</SelectItem>
                                  <SelectItem value="number">Number</SelectItem>
                                  <SelectItem value="boolean">Yes / No</SelectItem>
                                  <SelectItem value="choice">Choice</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>
                        {watchedType === "choice" && (
                          <FormField control={form.control} name={`dispositionSchema.${index}.options`} render={({ field: f }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Options</FormLabel>
                              <FormControl><Input placeholder="e.g. renewed, not_interested, callback, escalated" {...f} /></FormControl>
                              <FormDescription className="text-[10px]">Comma-separated list of allowed values</FormDescription>
                              <FormMessage />
                            </FormItem>
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
                      <FormControl>
                        <Input type="number" placeholder="No limit" min={1} max={100}
                          value={field.value ?? ""}
                          onChange={e => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
                      </FormControl>
                      <FormDescription className="text-[11px]">Leave blank for no limit.</FormDescription>
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
                            onChange={e => field.onChange(e.target.value === "" ? undefined : Math.round(Number(e.target.value) * 100))} />
                        </div>
                      </FormControl>
                      <FormDescription className="text-[11px]">Leave blank for no limit.</FormDescription>
                    </FormItem>
                  )} />
                </div>
              </CardContent>
            </Card>

          </div>

          {/* ── Sticky footer ── */}
          <div className="fixed bottom-0 left-0 md:left-64 right-0 p-4 bg-background/80 backdrop-blur-sm border-t border-border flex justify-end z-10">
            <div className="max-w-5xl mx-auto w-full flex justify-end gap-4">
              <Link href="/family-agents">
                <Button type="button" variant="outline">Cancel</Button>
              </Link>
              <Button type="submit" disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Creating…" : "Create Agent"}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
