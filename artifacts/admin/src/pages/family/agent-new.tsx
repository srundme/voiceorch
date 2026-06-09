import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Bot, Plus, Trash2, PhoneForwarded, Sparkles, ChevronDown, ChevronUp, Database, ClipboardList } from "lucide-react";
import { z } from "zod";
import { useForm, useWatch, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { useFamilyStore, InsuranceAgent } from "@/lib/family-store";

/* ── Provider / model catalogues (identical to dashboard new.tsx) ─────────── */

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
  { value: "hi",    label: "Hindi" },
  { value: "ta-IN", label: "Tamil" },
  { value: "te-IN", label: "Telugu" },
  { value: "kn-IN", label: "Kannada" },
  { value: "ml-IN", label: "Malayalam" },
  { value: "bn-IN", label: "Bengali (India)" },
  { value: "mr-IN", label: "Marathi" },
  { value: "es",    label: "Spanish" },
  { value: "fr",    label: "French" },
  { value: "de",    label: "German" },
  { value: "ar",    label: "Arabic" },
];
const ASR_MODELS: Record<string, { value: string; label: string }[]> = {
  deepgram:   [{ value: "nova-2", label: "Nova-2 (recommended)" }, { value: "nova-2-phonecall", label: "Nova-2 Phone Call" }, { value: "nova-2-meeting", label: "Nova-2 Meeting" }, { value: "whisper-large", label: "Whisper Large" }],
  azure:      [{ value: "en-US-standard", label: "en-US-standard" }, { value: "en-US-enhanced", label: "en-US-enhanced" }, { value: "en-IN-standard", label: "en-IN-standard" }],
  assemblyai: [{ value: "best", label: "Best (default)" }, { value: "nano", label: "Nano (fast)" }],
  sarvam:     [{ value: "saaras:v3", label: "Saaras v3 — real-time streaming (recommended)" }, { value: "saarika:v2.5", label: "Saarika v2.5 — batch (accurate)" }],
  cartesia:   [{ value: "sonic-english", label: "Sonic English" }, { value: "sonic-multilingual", label: "Sonic Multilingual" }],
};
const LLM_MODELS: Record<string, { value: string; label: string }[]> = {
  openai:    [{ value: "gpt-4o-mini", label: "GPT-4o Mini" }, { value: "gpt-4o", label: "GPT-4o" }, { value: "gpt-4-turbo", label: "GPT-4 Turbo" }, { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" }],
  anthropic: [{ value: "claude-opus-4-5", label: "Claude Opus 4 (best)" }, { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" }, { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku (fast)" }],
  google:    [{ value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }, { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" }, { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" }],
  deepseek:  [{ value: "deepseek-chat", label: "DeepSeek V3 (chat)" }, { value: "deepseek-reasoner", label: "DeepSeek R1 (reasoner)" }],
  mistral:   [{ value: "mistral-large-latest", label: "Mistral Large" }, { value: "mistral-small-latest", label: "Mistral Small (fast)" }],
  cohere:    [{ value: "command-r-plus-08-2024", label: "Command R+ (best)" }, { value: "command-r-08-2024", label: "Command R" }],
  qwen:      [{ value: "qwen/qwen3-32b", label: "Qwen 3 32B (recommended)" }, { value: "qwen/qwen3-235b-a22b", label: "Qwen 3 235B" }],
  groq:      [{ value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" }, { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B (fast)" }],
  sarvam:    [{ value: "sarvam-30b", label: "Sarvam 30B (recommended)" }, { value: "sarvam-105b", label: "Sarvam 105B" }],
};
const TTS_MODELS: Record<string, { value: string; label: string }[]> = {
  cartesia: [
    { value: "sonic-3.5",   label: "Sonic 3.5 ✦ New — 42 languages" },
    { value: "sonic-3",     label: "Sonic 3" },
    { value: "sonic-2",     label: "Sonic 2 (stable)" },
    { value: "sonic-turbo", label: "Sonic Turbo (fast)" },
  ],
};
const TTS_VOICES: Record<string, { value: string; label: string }[] | null> = {
  elevenlabs: null, cartesia: null, azure_tts: null,
  openai_tts: [
    { value: "alloy", label: "Alloy (neutral)" }, { value: "ash", label: "Ash (warm)" },
    { value: "coral", label: "Coral (friendly)" }, { value: "echo", label: "Echo (deep)" },
    { value: "nova", label: "Nova (energetic)" }, { value: "shimmer", label: "Shimmer (clear)" },
  ],
  deepgram_aura: [
    { value: "aura-2-en", label: "Aura 2 (default)" }, { value: "aura-asteria-en", label: "Asteria (warm female)" },
    { value: "aura-luna-en", label: "Luna (soft female)" }, { value: "aura-zeus-en", label: "Zeus (deep male)" },
  ],
  sarvam: [
    { value: "meera", label: "Meera (female)" }, { value: "pavithra", label: "Pavithra (female)" },
    { value: "arvind", label: "Arvind (male)" }, { value: "amol", label: "Amol (male)" },
    { value: "neel", label: "Neel (male)" }, { value: "arjun", label: "Arjun (male)" },
  ],
};
const AGENT_TIMEZONES = [
  { value: "UTC",           label: "UTC (UTC+00:00)" },
  { value: "Asia/Kolkata",  label: "Asia/Kolkata (UTC+05:30)" },
  { value: "Asia/Dubai",    label: "Asia/Dubai (UTC+04:00)" },
  { value: "Asia/Singapore",label: "Asia/Singapore (UTC+08:00)" },
  { value: "Europe/London", label: "Europe/London (UTC+00:00)" },
  { value: "America/New_York", label: "America/New_York (UTC-05:00)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (UTC-08:00)" },
];

const DEFAULT_ASR_MODEL = (p: string) => ASR_MODELS[p]?.[0]?.value ?? "";
const DEFAULT_LLM_MODEL = (p: string) => LLM_MODELS[p]?.[0]?.value ?? "";
const DEFAULT_TTS_VOICE = (p: string) => TTS_VOICES[p]?.[0]?.value ?? "";

/* ── Form schema ──────────────────────────────────────────────────────────── */

const agentFormSchema = z.object({
  name:              z.string().min(1, "Name is required"),
  description:       z.string().optional(),
  companyId:         z.string().min(1, "Company is required"),
  policyId:          z.string().optional(),
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
  noiseCancellationEnabled:z.boolean().optional(),
  inactivityMessage:       z.string().optional(),
  asrLanguage:             z.string().optional(),
  asrBackgroundDenoising:  z.boolean().optional(),
  asrConfidenceThreshold:  z.number().min(0).max(1).optional(),
  asrEndOfTurnConfidence:  z.number().min(0.3).max(1).optional(),
  asrEndOfTurnTimeout:     z.number().min(100).max(30000).optional(),
  asrKeyterms:             z.string().optional(),
  asrSmartEndpointing:     z.enum(["off", "vapi", "livekit"]).optional(),
  asrAutoFallback:         z.boolean().optional(),
  webhookSecret:           z.string().optional(),
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
});
type AgentFormValues = z.infer<typeof agentFormSchema>;

function ModelSelect({ options, value, onChange, placeholder }: {
  options: { value: string; label: string }[];
  value: string | undefined; onChange: (v: string) => void; placeholder?: string;
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

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function FamilyAgentNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { companies, policies, agents, saveAgents, isLoaded } = useFamilyStore();
  const [showAdvancedSTT, setShowAdvancedSTT] = useState(false);
  const [agentMode, setAgentMode] = useState<"managed" | "byop">("managed");

  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: {
      name: "", description: "", companyId: "", policyId: "",
      asrProvider: "deepgram", asrModel: "nova-2",
      llmProvider: "qwen", llmModel: "qwen/qwen3-32b",
      ttsProvider: "cartesia", ttsModel: "sonic-3",
      telephonyProvider: "twilio",
      systemPrompt: "You are a helpful AI voice assistant for insurance customers.",
      temperature: 0.7, maxDuration: 600,
      greetingMessage: "", endCallPhrases: "",
      silenceTimeoutSeconds: 30, language: "en-IN",
      backchannelingEnabled: true, backchannelingFrequency: 0.5, backchannelPhrases: "",
      webhookUrl: "", noiseCancellationEnabled: true, inactivityMessage: "",
      asrLanguage: "", asrBackgroundDenoising: false,
      asrConfidenceThreshold: 0.40, asrEndOfTurnConfidence: 0.70, asrEndOfTurnTimeout: 5000,
      asrKeyterms: "", asrSmartEndpointing: "off", asrAutoFallback: true,
      webhookSecret: "", promptVariables: [],
      vadSilenceMs: 250, bargeInEnabled: true, bargeInEnergyThreshold: 1200, bargeInMinFrames: 4,
      timezone: "Asia/Kolkata", tools: [], dispositionSchema: [],
    },
  });

  const { fields: toolFields,        append: appendTool,        remove: removeTool        } = useFieldArray({ control: form.control, name: "tools" });
  const { fields: dispositionFields, append: appendDisposition, remove: removeDisposition } = useFieldArray({ control: form.control, name: "dispositionSchema" });
  const { fields: promptVarFields,   append: appendPromptVar,   remove: removePromptVar   } = useFieldArray({ control: form.control, name: "promptVariables" });

  const asrProvider          = useWatch({ control: form.control, name: "asrProvider" });
  const llmProvider          = useWatch({ control: form.control, name: "llmProvider" });
  const ttsProvider          = useWatch({ control: form.control, name: "ttsProvider" });
  const selectedCompanyId    = useWatch({ control: form.control, name: "companyId" });
  const backchannelingEnabled    = useWatch({ control: form.control, name: "backchannelingEnabled" });
  const backchannelingFrequency  = useWatch({ control: form.control, name: "backchannelingFrequency" });

  const companyPolicies = policies.filter(p => p.companyId === selectedCompanyId);

  const isMounted = useRef(false);
  useEffect(() => { if (!isMounted.current) { isMounted.current = true; return; } form.setValue("asrModel", DEFAULT_ASR_MODEL(asrProvider)); }, [asrProvider]);
  useEffect(() => { form.setValue("llmModel", DEFAULT_LLM_MODEL(llmProvider)); }, [llmProvider]);
  useEffect(() => { form.setValue("ttsVoice", DEFAULT_TTS_VOICE(ttsProvider)); }, [ttsProvider]);
  useEffect(() => { form.setValue("ttsModel", TTS_MODELS[ttsProvider]?.[0]?.value ?? ""); }, [ttsProvider]);
  useEffect(() => {
    if (agentMode === "managed") {
      form.setValue("asrProvider", "deepgram"); form.setValue("asrModel", "nova-2");
      form.setValue("llmProvider", "qwen");     form.setValue("llmModel", "qwen/qwen3-32b");
      form.setValue("ttsProvider", "cartesia"); form.setValue("ttsModel", "sonic-3");
    }
  }, [agentMode]);
  useEffect(() => { form.setValue("policyId", ""); }, [selectedCompanyId]);

  const onSubmit = (data: AgentFormValues) => {
    const company = companies.find(c => c.id === data.companyId);
    const policy  = policies.find(p => p.id === data.policyId);
    const { companyId, policyId, webhookSecret, promptVariables, vadSilenceMs, bargeInEnabled, bargeInEnergyThreshold, bargeInMinFrames, timezone, ...rest } = data;
    const newAgent: InsuranceAgent = {
      id: `fa-${Date.now()}`,
      companyId,
      companyName: company?.name ?? "",
      policyId:   policyId || undefined,
      policyName: policy?.name,
      status: "draft",
      voiceId: data.ttsVoice ?? "",
      kbEntries: 0, totalCalls: 0, conversionRate: 0, avgDurationSeconds: 0,
      lastUpdated: new Date().toISOString(),
      agentMode,
      webhookSecret,
      promptVariables,
      vadSilenceMs,
      bargeInEnabled,
      bargeInEnergyThreshold,
      bargeInMinFrames,
      timezone,
      ...rest,
    };
    saveAgents([...agents, newAgent]);
    toast({ title: "Agent Created", description: "Draft agent saved. Move it through the pipeline to publish." });
    setLocation("/family/agents");
  };

  if (!isLoaded) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex-1 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-4">
        <Link href="/family/agents">
          <Button variant="outline" size="icon" className="h-8 w-8"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" /> Create Agent
          </h2>
          <p className="text-muted-foreground">Configure a new AI voice agent for an insurance policy.</p>
        </div>
      </div>

      {/* Mode Selector */}
      <div className="grid grid-cols-2 gap-4">
        <button type="button" onClick={() => setAgentMode("managed")}
          className={`text-left p-4 rounded-xl border-2 transition-all ${agentMode === "managed" ? "border-primary bg-primary/5" : "border-border bg-card hover:border-muted-foreground/40 hover:bg-muted/40"}`}>
          <div className="flex items-center gap-2 mb-1.5">
            <Sparkles className={`h-4 w-4 ${agentMode === "managed" ? "text-primary" : "text-muted-foreground"}`} />
            <span className="font-semibold text-sm">Managed</span>
            <span className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">Recommended</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">Platform handles ASR, LLM, and TTS using managed API keys. Just write your system prompt.</p>
          <p className="text-[10px] text-muted-foreground/60 mt-2 font-mono">Deepgram · Qwen 3 32B · Cartesia</p>
        </button>
        <button type="button" onClick={() => setAgentMode("byop")}
          className={`text-left p-4 rounded-xl border-2 transition-all ${agentMode === "byop" ? "border-primary bg-primary/5" : "border-border bg-card hover:border-muted-foreground/40 hover:bg-muted/40"}`}>
          <div className="flex items-center gap-2 mb-1.5">
            <Bot className={`h-4 w-4 ${agentMode === "byop" ? "text-primary" : "text-muted-foreground"}`} />
            <span className="font-semibold text-sm">Bring Your Own Providers</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">Use your own API keys for each pipeline stage. Full control over ASR, LLM, TTS, and telephony.</p>
        </button>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pb-20">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Company & Policy */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Database className="h-4 w-4 text-primary" /> Company &amp; Policy</CardTitle>
                <CardDescription>Connect this agent to an insurance company and its RAG knowledge base.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="companyId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Insurance Company <span className="text-destructive">*</span></FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
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
                    <FormLabel>Policy / RAG Knowledge Base</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""} disabled={!selectedCompanyId}>
                      <FormControl><SelectTrigger><SelectValue placeholder={selectedCompanyId ? (companyPolicies.length === 0 ? "No policies — create one first" : "Select policy") : "Select company first"} /></SelectTrigger></FormControl>
                      <SelectContent>
                        {companyPolicies.map(p => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} <span className="text-muted-foreground text-xs">· {p.productType}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>The agent will use this policy's knowledge base for RAG retrieval.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            {/* General */}
            <Card>
              <CardHeader>
                <CardTitle>General Information</CardTitle>
                <CardDescription>Basic details about your agent.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Agent Name <span className="text-destructive">*</span></FormLabel>
                    <FormControl><Input placeholder="e.g. ICICI Motor Renewal Agent" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (Optional)</FormLabel>
                    <FormControl><Input placeholder="e.g. Handles outbound motor renewal calls" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            {/* AI Behavior */}
            <Card>
              <CardHeader>
                <CardTitle>AI Behavior</CardTitle>
                <CardDescription>Configure how the agent responds.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="systemPrompt" render={({ field }) => (
                  <FormItem>
                    <FormLabel>System Prompt <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Textarea placeholder="You are a helpful assistant..." className="min-h-[120px] font-mono text-sm" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="timezone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Timezone</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select timezone" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
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
                      <Slider min={0} max={2} step={0.1} defaultValue={[field.value || 0.7]}
                        onValueChange={vals => field.onChange(vals[0])} />
                    </FormControl>
                    <FormDescription>Higher = more creative. Lower = more deterministic.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            {/* Conversation Behavior */}
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
                          <Textarea placeholder="e.g. Namaste! Main ICICI se bol raha hun. Aapki kya madad kar sakta hun?" className="min-h-[80px]" {...field} />
                        </FormControl>
                        <FormDescription>First thing the agent says when a call connects.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="endCallPhrases" render={({ field }) => (
                      <FormItem>
                        <FormLabel>End-Call Phrases</FormLabel>
                        <FormControl><Input placeholder="goodbye, bye, shukriya, alvida" {...field} /></FormControl>
                        <FormDescription>Comma-separated. If the caller says any of these, the call ends automatically.</FormDescription>
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
                            <SelectContent>{LANGUAGES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="silenceTimeoutSeconds" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Silence Timeout (s)</FormLabel>
                          <FormControl>
                            <Input type="number" min={5} max={300} placeholder="30" {...field}
                              onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className="space-y-3 p-4 border rounded-md bg-muted/20">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium leading-none">Noise Cancellation</p>
                          <p className="text-xs text-muted-foreground mt-1">Request noise reduction from the ASR provider</p>
                        </div>
                        <FormField control={form.control} name="noiseCancellationEnabled" render={({ field }) => (
                          <FormItem>
                            <Select onValueChange={v => field.onChange(v === "true")} value={field.value ? "true" : "false"}>
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
                            <Select onValueChange={v => field.onChange(v === "true")} value={field.value ? "true" : "false"}>
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
                                  onValueChange={vals => field.onChange(vals[0])} />
                              </FormControl>
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="backchannelPhrases" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Backchannel Phrases</FormLabel>
                              <FormControl><Input placeholder="I see, Got it, Okay, समझ गया, ठीक है" {...field} /></FormControl>
                              <FormDescription>Comma-separated. Leave blank for defaults.</FormDescription>
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
                    <FormField control={form.control} name="inactivityMessage" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Inactivity Message</FormLabel>
                        <FormControl><Input placeholder="e.g. I haven't heard from you — goodbye!" {...field} /></FormControl>
                        <FormDescription>Spoken right before silence-timeout hangup.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Pipeline */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Pipeline Configuration</CardTitle>
                <CardDescription>Select providers and models for each stage.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {agentMode === "managed" ? (
                    <div className="md:col-span-3 flex items-center gap-3 p-4 rounded-xl border border-primary/20 bg-primary/5">
                      <Sparkles className="h-5 w-5 text-primary shrink-0" />
                      <div>
                        <p className="text-sm font-medium">Platform-managed pipeline</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Deepgram Nova-2 (ASR) · Qwen 3 32B (LLM) · Cartesia Sonic-3 (TTS) — powered by managed API keys.</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-4 p-4 border rounded-md bg-muted/20 relative">
                        <div className="absolute top-0 right-0 -mt-3 -mr-3 bg-card border border-border rounded-full px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Step 1</div>
                        <h4 className="font-medium border-b pb-2">Speech-to-Text</h4>
                        <FormField control={form.control} name="asrProvider" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Provider</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl><SelectTrigger><SelectValue placeholder="Select ASR" /></SelectTrigger></FormControl>
                              <SelectContent>{ASR_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
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
                      </div>
                      <div className="space-y-4 p-4 border rounded-md bg-muted/20 relative">
                        <div className="absolute top-0 right-0 -mt-3 -mr-3 bg-card border border-border rounded-full px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Step 2</div>
                        <h4 className="font-medium border-b pb-2">Language Model</h4>
                        <FormField control={form.control} name="llmProvider" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Provider</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl><SelectTrigger><SelectValue placeholder="Select LLM" /></SelectTrigger></FormControl>
                              <SelectContent>{LLM_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
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
                      <div className="space-y-4 p-4 border rounded-md bg-muted/20 relative">
                        <div className="absolute top-0 right-0 -mt-3 -mr-3 bg-card border border-border rounded-full px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Step 3</div>
                        <h4 className="font-medium border-b pb-2">Text-to-Speech</h4>
                        <FormField control={form.control} name="ttsProvider" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Provider</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl><SelectTrigger><SelectValue placeholder="Select TTS" /></SelectTrigger></FormControl>
                              <SelectContent>{TTS_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
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
                                <Input placeholder={ttsProvider === "elevenlabs" ? "e.g. 21m00Tcm4TlvDq8ikWAM" : "e.g. 694f9389-aac1-45b6-b726-9d9369183238"} {...field} />
                              )}
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                    </>
                  )}
                  <div className="space-y-4 p-4 border rounded-md bg-muted/20 relative">
                    <div className="absolute top-0 right-0 -mt-3 -mr-3 bg-card border border-border rounded-full px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{agentMode === "managed" ? "Step 2" : "Step 4"}</div>
                    <h4 className="font-medium border-b pb-2">Telephony</h4>
                    <FormField control={form.control} name="telephonyProvider" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Provider</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select Telephony" /></SelectTrigger></FormControl>
                          <SelectContent>{TELEPHONY_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="maxDuration" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Max Duration (s)</FormLabel>
                        <FormControl>
                          <Input type="number" min={60} max={3600} {...field}
                            onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Advanced STT */}
            <Card className="md:col-span-2">
              <button type="button" className="w-full text-left"
                onClick={() => setShowAdvancedSTT(v => !v)}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">Advanced STT Settings</CardTitle>
                      <CardDescription className="text-xs mt-0.5">Fine-tune speech recognition behaviour</CardDescription>
                    </div>
                    {showAdvancedSTT ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </CardHeader>
              </button>
              {showAdvancedSTT && (
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField control={form.control} name="asrLanguage" render={({ field }) => (
                      <FormItem>
                        <FormLabel>ASR Language Override</FormLabel>
                        <FormControl><Input placeholder="e.g. hi-IN" {...field} /></FormControl>
                        <FormDescription>Override the main language for STT only.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="asrKeyterms" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Keyword Boosting</FormLabel>
                        <FormControl><Input placeholder="NCB, OD cover, cashless" {...field} /></FormControl>
                        <FormDescription>Comma-separated domain terms to boost recognition.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="asrSmartEndpointing" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Smart Endpointing</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value ?? "off"}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="off">Off</SelectItem>
                            <SelectItem value="vapi">Vapi-style</SelectItem>
                            <SelectItem value="livekit">LiveKit-style</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="asrConfidenceThreshold" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confidence Threshold: {field.value}</FormLabel>
                        <FormControl>
                          <Slider min={0} max={1} step={0.05} value={[field.value ?? 0.4]}
                            onValueChange={vals => field.onChange(vals[0])} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="asrEndOfTurnConfidence" render={({ field }) => (
                      <FormItem>
                        <FormLabel>End-of-Turn Confidence: {field.value}</FormLabel>
                        <FormControl>
                          <Slider min={0.3} max={1} step={0.05} value={[field.value ?? 0.7]}
                            onValueChange={vals => field.onChange(vals[0])} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="asrEndOfTurnTimeout" render={({ field }) => (
                      <FormItem>
                        <FormLabel>End-of-Turn Timeout (ms)</FormLabel>
                        <FormControl>
                          <Input type="number" min={100} max={30000} {...field}
                            onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </CardContent>
              )}
            </Card>

            {/* Prompt Variables */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Prompt Variables</CardTitle>
                <CardDescription className="text-xs">Dynamic {"{{key}}"} placeholders injected at call time.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {promptVarFields.map((f, i) => (
                  <div key={f.id} className="flex gap-2 items-start">
                    <div className="flex-1 space-y-1.5">
                      <FormField control={form.control} name={`promptVariables.${i}.key`} render={({ field }) => (
                        <FormItem><FormControl><Input placeholder="key" className="font-mono text-xs" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name={`promptVariables.${i}.defaultValue`} render={({ field }) => (
                        <FormItem><FormControl><Input placeholder="default value" className="text-xs" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                    </div>
                    <Button type="button" size="sm" variant="ghost" className="mt-1 h-7 w-7 p-0 text-destructive" onClick={() => removePromptVar(i)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button type="button" size="sm" variant="outline" className="gap-1 w-full"
                  onClick={() => appendPromptVar({ key: "", defaultValue: "", description: "" })}>
                  <Plus className="h-3.5 w-3.5" /> Add Variable
                </Button>
              </CardContent>
            </Card>

            {/* VAD & Barge-in */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">VAD &amp; Barge-in</CardTitle>
                <CardDescription className="text-xs">Voice activity detection and interruption settings.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="vadSilenceMs" render={({ field }) => (
                  <FormItem>
                    <FormLabel>VAD Silence Window (ms)</FormLabel>
                    <FormControl>
                      <Input type="number" min={50} max={2000} {...field} onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="bargeInEnabled" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Barge-in</FormLabel>
                    <Select onValueChange={v => field.onChange(v === "true")} value={field.value ? "true" : "false"}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent><SelectItem value="false">Disabled</SelectItem><SelectItem value="true">Enabled</SelectItem></SelectContent>
                    </Select>
                    <FormDescription>Allow caller to interrupt the agent mid-speech.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="bargeInEnergyThreshold" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Energy Threshold</FormLabel>
                    <FormControl>
                      <Input type="number" min={100} max={5000} {...field} onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            {/* Call Transfer Tools */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><PhoneForwarded className="h-4 w-4" /> Call Transfer Tools</CardTitle>
                <CardDescription className="text-xs">Let the agent transfer calls to a human agent or department.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {toolFields.map((f, i) => (
                  <div key={f.id} className="p-4 border rounded-md bg-muted/20 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">Transfer Tool #{i + 1}</p>
                      <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => removeTool(i)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={form.control} name={`tools.${i}.name`} render={({ field }) => (
                        <FormItem><FormLabel className="text-xs">Function Name</FormLabel><FormControl><Input placeholder="transfer_to_agent" className="font-mono text-xs" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name={`tools.${i}.transferTo`} render={({ field }) => (
                        <FormItem><FormLabel className="text-xs">Transfer To (number)</FormLabel><FormControl><Input placeholder="+91 99999 99999" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name={`tools.${i}.description`} render={({ field }) => (
                      <FormItem><FormLabel className="text-xs">Description</FormLabel><FormControl><Input placeholder="Transfer to a human agent when customer requests it" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name={`tools.${i}.transferMode`} render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Handoff Mode</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value ?? "cold"}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent><SelectItem value="cold">Cold (silent transfer)</SelectItem><SelectItem value="warm_summary">Warm (AI summary first)</SelectItem></SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                ))}
                <Button type="button" size="sm" variant="outline" className="gap-1"
                  onClick={() => appendTool({ type: "call_transfer", name: "", description: "", transferTo: "", transferMode: "cold" })}>
                  <Plus className="h-3.5 w-3.5" /> Add Transfer Tool
                </Button>
              </CardContent>
            </Card>

            {/* Disposition Schema */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><ClipboardList className="h-4 w-4" /> Disposition Schema</CardTitle>
                <CardDescription className="text-xs">Fields the AI will fill in after each call (outcome tracking).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {dispositionFields.map((f, i) => (
                  <div key={f.id} className="grid grid-cols-4 gap-3 items-end p-3 border rounded-md bg-muted/20">
                    <FormField control={form.control} name={`dispositionSchema.${i}.key`} render={({ field }) => (
                      <FormItem><FormLabel className="text-xs">Key</FormLabel><FormControl><Input placeholder="outcome" className="font-mono text-xs" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name={`dispositionSchema.${i}.label`} render={({ field }) => (
                      <FormItem><FormLabel className="text-xs">Label</FormLabel><FormControl><Input placeholder="Call Outcome" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name={`dispositionSchema.${i}.type`} render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="text">Text</SelectItem><SelectItem value="number">Number</SelectItem>
                            <SelectItem value="boolean">Boolean</SelectItem><SelectItem value="choice">Choice</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => removeDisposition(i)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button type="button" size="sm" variant="outline" className="gap-1"
                  onClick={() => appendDisposition({ key: "", label: "", type: "text", required: false })}>
                  <Plus className="h-3.5 w-3.5" /> Add Field
                </Button>
              </CardContent>
            </Card>

            {/* Usage Limits */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Usage Limits</CardTitle>
                <CardDescription className="text-xs">Optional guardrails on concurrency and spend.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="maxConcurrentCalls" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max Concurrent Calls</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} max={100} placeholder="Unlimited" value={field.value ?? ""}
                        onChange={e => field.onChange(e.target.value ? parseInt(e.target.value, 10) : undefined)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="monthlySpendLimitCents" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monthly Spend Cap (₹)</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} placeholder="Unlimited" value={field.value ? (field.value / 100) : ""}
                        onChange={e => field.onChange(e.target.value ? Math.round(parseFloat(e.target.value) * 100) : undefined)} />
                    </FormControl>
                    <FormDescription>Agent is paused when this limit is reached.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
            </Card>

          </div>

          {/* Sticky footer */}
          <div className="fixed bottom-0 left-64 right-0 bg-card border-t border-border px-8 py-4 flex items-center justify-between z-10">
            <p className="text-sm text-muted-foreground">Agent will be saved as <strong>Draft</strong> — move it through the pipeline to publish.</p>
            <div className="flex gap-3">
              <Link href="/family/agents">
                <Button type="button" variant="outline">Cancel</Button>
              </Link>
              <Button type="submit" className="gap-2">
                <Bot className="h-4 w-4" /> Create Agent
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
