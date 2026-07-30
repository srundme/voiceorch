import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowLeft, Save, Bot, Plus, Trash2, PhoneForwarded, Sparkles,
  ChevronDown, ChevronUp, Database, ClipboardList, Building2,
  Maximize2, Volume2, Brain, Phone,
} from "lucide-react";
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useFamilyStore, InsuranceAgent } from "@/lib/family-store";
import { AGENT_TIMEZONES, LANGUAGES as ALL_LANGUAGES } from "@/lib/agent-providers";
import { useAdminListedVoices, useManagedKeys, useAdminAmbientSounds } from "@/hooks/use-admin-api";

/* ── Provider / model catalogues ─────────────────────────────────────────── */

const ASR_PROVIDERS = [
  { value: "deepgram",   label: "Deepgram Nova" },
  { value: "azure",      label: "Azure Speech" },
  { value: "assemblyai", label: "AssemblyAI" },
  { value: "sarvam",     label: "Sarvam (Saarika)" },
  { value: "cartesia",   label: "Cartesia" },
];

const LLM_PROVIDERS = [
  { value: "google",    label: "Google Gemini" },
  { value: "groq",      label: "Groq" },
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

/* ── Managed-key → provider maps (filters pipeline dropdowns to admin-configured providers only) ── */
const ASR_MANAGED_KEYS: Record<string, string[]> = {
  deepgram:   ["managed_deepgram_key"],
  sarvam:     ["managed_sarvam_key"],
  assemblyai: ["managed_assemblyai_key"],
  azure:      ["managed_azure_speech_key"],
};
const LLM_MANAGED_KEYS: Record<string, string[]> = {
  openai:    ["managed_openai_key"],
  anthropic: ["managed_anthropic_key"],
  google:    ["managed_gemini_key"],
  deepseek:  ["managed_deepseek_key"],
  mistral:   ["managed_mistral_key"],
  cohere:    ["managed_cohere_key"],
  qwen:      ["managed_qwen_key", "managed_groq_key"],
  groq:      ["managed_groq_key"],
  sarvam:    ["managed_sarvam_key"],
};
const TTS_MANAGED_KEYS: Record<string, string[]> = {
  cartesia:      ["managed_cartesia_key"],
  elevenlabs:    ["managed_elevenlabs_key"],
  openai_tts:    ["managed_openai_key"],
  deepgram_aura: ["managed_deepgram_key"],
  azure_tts:     ["managed_azure_speech_key"],
  sarvam:        ["managed_sarvam_key"],
};
const TELEPHONY_MANAGED_KEYS: Record<string, string[]> = {
  vobiz: ["managed_vobiz_auth_id"],
};

const LANGUAGES = ALL_LANGUAGES;

const ASR_MODELS: Record<string, { value: string; label: string }[]> = {
  deepgram:   [{ value: "nova-2", label: "Nova-2 (recommended)" }, { value: "nova-2-phonecall", label: "Nova-2 Phone Call" }, { value: "nova-2-meeting", label: "Nova-2 Meeting" }],
  azure:      [{ value: "en-US-standard", label: "en-US-standard" }, { value: "en-US-enhanced", label: "en-US-enhanced" }, { value: "en-IN-standard", label: "en-IN-standard" }],
  assemblyai: [{ value: "best", label: "Best (default)" }, { value: "nano", label: "Nano (fast)" }],
  sarvam:     [
    { value: "saaras:v3",     label: "Saaras v3 — real-time streaming (recommended)" },
    { value: "saarika:v2.5",  label: "Saarika v2.5 — batch (accurate)" },
    { value: "saarika:flash", label: "Saarika Flash — batch (fast, deprecated)" },
  ],
  cartesia:   [{ value: "sonic-english", label: "Sonic English" }, { value: "sonic-multilingual", label: "Sonic Multilingual" }],
};

const LLM_MODELS: Record<string, { value: string; label: string }[]> = {
  openai:    [{ value: "gpt-4o-mini", label: "GPT-4o Mini" }, { value: "gpt-4o", label: "GPT-4o" }, { value: "gpt-4-turbo", label: "GPT-4 Turbo" }, { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" }],
  anthropic: [{ value: "claude-opus-4-5", label: "Claude Opus 4 (best)" }, { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" }, { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku (fast)" }],
  google:    [{ value: "gemini-3.6-flash", label: "Gemini 3.6 Flash (recommended)" }, { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite (fastest)" }, { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (previous gen)" }],
  deepseek:  [{ value: "deepseek-chat", label: "DeepSeek V3 (chat)" }, { value: "deepseek-reasoner", label: "DeepSeek R1 (reasoner)" }],
  mistral:   [{ value: "mistral-large-latest", label: "Mistral Large (best)" }, { value: "mistral-small-latest", label: "Mistral Small (fast)" }],
  cohere:    [{ value: "command-r-plus-08-2024", label: "Command R+ (best)" }, { value: "command-r-08-2024", label: "Command R" }],
  qwen:      [{ value: "qwen/qwen3-32b", label: "Qwen 3 32B (recommended)" }, { value: "qwen/qwen3-235b-a22b", label: "Qwen 3 235B" }],
  groq:      [{ value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (recommended)" }, { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B (fast)" }],
  sarvam:    [{ value: "sarvam-30b", label: "Sarvam 30B (recommended)" }, { value: "sarvam-105b", label: "Sarvam 105B" }],
};

const TTS_MODELS: Record<string, { value: string; label: string }[]> = {
  cartesia: [
    { value: "sonic-3.5",   label: "Sonic 3.5 — 42 languages, lowest latency" },
    { value: "sonic-3",     label: "Sonic 3" },
    { value: "sonic-2",     label: "Sonic 2 (stable)" },
    { value: "sonic-turbo", label: "Sonic Turbo (fast, low-latency)" },
  ],
};

const TTS_VOICES: Record<string, { value: string; label: string }[] | null> = {
  elevenlabs: null, cartesia: null, azure_tts: null,
  openai_tts: [
    { value: "alloy",   label: "Alloy (neutral)" }, { value: "ash",    label: "Ash (warm)" },
    { value: "coral",   label: "Coral (friendly)" }, { value: "echo",  label: "Echo (deep)" },
    { value: "fable",   label: "Fable (expressive)" }, { value: "onyx", label: "Onyx (authoritative)" },
    { value: "nova",    label: "Nova (energetic)" }, { value: "sage",  label: "Sage (calm)" },
    { value: "shimmer", label: "Shimmer (clear)" },
  ],
  deepgram_aura: [
    { value: "aura-2-en",       label: "Aura 2 (default)" }, { value: "aura-asteria-en", label: "Asteria (warm female)" },
    { value: "aura-luna-en",    label: "Luna (soft female)" }, { value: "aura-stella-en", label: "Stella (bright female)" },
    { value: "aura-zeus-en",    label: "Zeus (deep male)" },  { value: "aura-orion-en",  label: "Orion (male)" },
  ],
  sarvam: [
    { value: "meera",    label: "Meera (female)" }, { value: "pavithra", label: "Pavithra (female)" },
    { value: "maitreyi", label: "Maitreyi (female)" }, { value: "arvind", label: "Arvind (male)" },
    { value: "amol",     label: "Amol (male)" }, { value: "amartya", label: "Amartya (male)" },
    { value: "neel",     label: "Neel (male)" }, { value: "misha",   label: "Misha (female)" },
    { value: "arjun",    label: "Arjun (male)" }, { value: "maya",   label: "Maya (female)" },
  ],
};

const DEFAULT_ASR_MODEL = (p: string) => ASR_MODELS[p]?.[0]?.value ?? "";
const DEFAULT_LLM_MODEL = (p: string) => LLM_MODELS[p]?.[0]?.value ?? "";
const DEFAULT_TTS_VOICE = (p: string) => TTS_VOICES[p]?.[0]?.value ?? "";

/* ── Form schema ──────────────────────────────────────────────────────────── */

const agentFormSchema = z.object({
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
  ambientSoundId:           z.string().optional(),
});

type AgentFormValues = z.infer<typeof agentFormSchema>;

/* ── Insurance templates ──────────────────────────────────────────────────── */

const INSURANCE_TEMPLATES = [
  {
    id: 1, category: "support",
    name: "Motor Insurance Support",
    description: "Handles motor insurance queries, claims status, and renewal reminders.",
    asrProvider: "sarvam", llmProvider: "qwen", ttsProvider: "sarvam", telephonyProvider: "vobiz",
    systemPrompt: `You are a helpful motor insurance support agent for {{company_name}}.
Your role is to assist customers with:
- Policy details and coverage information
- Claims status and filing guidance
- Renewal reminders and premium calculations
- Roadside assistance queries

Always be professional, empathetic and clear. Ask for the customer's policy number or registered mobile number.`,
    greetingMessage: "Hello! I'm your motor insurance assistant from {{company_name}}. Could I have your policy number or registered mobile number to get started?",
    temperature: 0.3,
  },
  {
    id: 2, category: "sales",
    name: "Health Insurance Outbound Sales",
    description: "Outbound calls for health insurance policy sales and lead qualification.",
    asrProvider: "sarvam", llmProvider: "qwen", ttsProvider: "sarvam", telephonyProvider: "vobiz",
    systemPrompt: `You are an outbound health insurance sales agent for {{company_name}}.
Your goal is to:
- Introduce the health insurance plan to the prospect
- Understand their current health coverage and family situation
- Highlight key benefits relevant to their needs
- Schedule a follow-up or close the sale

Be friendly, not pushy. Respect if they are not interested.`,
    greetingMessage: "Hello, may I speak with {{customer_name}}? I'm calling from {{company_name}} about our health insurance plans.",
    temperature: 0.4,
  },
  {
    id: 3, category: "support",
    name: "Claims Processing Assistant",
    description: "Guide customers step-by-step through the insurance claims process.",
    asrProvider: "sarvam", llmProvider: "google", ttsProvider: "sarvam", telephonyProvider: "vobiz",
    systemPrompt: `You are a claims processing assistant for {{company_name}}.
Help customers:
- Understand what documents they need to submit
- Track the status of an existing claim
- Escalate urgent or complex cases to human agents
- Provide estimated processing timelines

Always collect the policy number and claim reference number at the start.`,
    greetingMessage: "Hello! I'm the claims assistant at {{company_name}}. Could you please share your policy number to get started?",
    temperature: 0.2,
  },
  {
    id: 4, category: "sales",
    name: "Policy Renewal Agent",
    description: "Follow up on expiring policies and facilitate renewals.",
    asrProvider: "sarvam", llmProvider: "qwen", ttsProvider: "sarvam", telephonyProvider: "vobiz",
    systemPrompt: `You are a policy renewal specialist for {{company_name}}.
Your tasks:
- Inform the customer about their upcoming policy renewal
- Confirm coverage details and any changes in premium
- Process renewal payment or send payment link
- Update nominee and contact information if needed`,
    greetingMessage: "Hello! This is {{company_name}} calling about your insurance policy which is due for renewal. Am I speaking with the policyholder?",
    temperature: 0.3,
  },
];

const CATEGORY_COLORS: Record<string, string> = {
  support: "bg-muted text-zinc-300 border-border",
  sales:   "bg-muted text-zinc-300 border-border",
  general: "bg-muted text-muted-foreground border-border",
};

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
  const { companies, agents, policies, saveAgents } = useFamilyStore();
  const { data: listedVoicesData } = useAdminListedVoices();
  const cartesiaListedVoices = listedVoicesData?.voices ?? [];
  const { data: mk } = useManagedKeys();
  const { data: ambientSoundsData } = useAdminAmbientSounds();
  const ambientSounds = ambientSoundsData ?? [];
  const [fullscreenPrompt, setFullscreenPrompt] = useState(false);
  const hasKey = (keys: string[]) => !mk || keys.some(k => k in mk);
  const availableAsrProviders = ASR_PROVIDERS.filter(p => hasKey(ASR_MANAGED_KEYS[p.value] ?? []));
  const availableLlmProviders = LLM_PROVIDERS.filter(p => hasKey(LLM_MANAGED_KEYS[p.value] ?? []));
  const availableTtsProviders = TTS_PROVIDERS.filter(p => hasKey(TTS_MANAGED_KEYS[p.value] ?? []));
  const availableTelephonyProviders = (() => {
    if (!mk) return TELEPHONY_PROVIDERS;
    const f = TELEPHONY_PROVIDERS.filter(p => (TELEPHONY_MANAGED_KEYS[p.value] ?? []).some(k => k in mk));
    return f.length > 0 ? f : TELEPHONY_PROVIDERS;
  })();
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [showAdvancedSTT, setShowAdvancedSTT] = useState(false);

  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: {
      companyId: "", policyId: "", agentType: "inbound_support",
      name: "", description: "",
      asrProvider: "sarvam", asrModel: "saaras:v3",
      llmProvider: "qwen", llmModel: "qwen/qwen3-32b",
      ttsProvider: "sarvam", ttsVoice: "priya", ttsModel: "bulbul:v3",
      telephonyProvider: "vobiz",
      systemPrompt: "You are a helpful AI voice assistant for insurance customers.",
      temperature: 0.7, maxDuration: 600,
      greetingMessage: "", endCallPhrases: "", silenceTimeoutSeconds: 30,
      language: "en-IN", backchannelingEnabled: true, backchannelingFrequency: 0.5,
      webhookUrl: "", noiseCancellationEnabled: true,
      inactivityMessage: "", asrLanguage: "",
      asrBackgroundDenoising: false, asrConfidenceThreshold: 0.40,
      asrEndOfTurnConfidence: 0.70, asrEndOfTurnTimeout: 5000,
      asrKeyterms: "", asrSmartEndpointing: "off" as const, asrAutoFallback: true,
      webhookSecret: "", ambientSoundId: "", promptVariables: [],
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
  const llmProvider = useWatch({ control: form.control, name: "llmProvider" });
  const ttsProvider = useWatch({ control: form.control, name: "ttsProvider" });
  const backchannelingEnabled = useWatch({ control: form.control, name: "backchannelingEnabled" });
  const backchannelingFrequency = useWatch({ control: form.control, name: "backchannelingFrequency" });
  const selectedCompanyId = useWatch({ control: form.control, name: "companyId" });
  const memoryEnabled = useWatch({ control: form.control, name: "memoryEnabled" });
  const autoCallbackEnabled = useWatch({ control: form.control, name: "autoCallbackEnabled" });
  const systemPromptWatch = useWatch({ control: form.control, name: "systemPrompt" });

  const isMounted = useRef(false);
  useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return; }
    form.setValue("asrModel", DEFAULT_ASR_MODEL(asrProvider));
  }, [asrProvider]);
  useEffect(() => { form.setValue("llmModel", DEFAULT_LLM_MODEL(llmProvider)); }, [llmProvider]);
  useEffect(() => { form.setValue("ttsVoice", DEFAULT_TTS_VOICE(ttsProvider)); }, [ttsProvider]);
  useEffect(() => { form.setValue("ttsModel", TTS_MODELS[ttsProvider]?.[0]?.value ?? ""); }, [ttsProvider]);


  const companiesForSelect = companies;
  const policiesForCompany = policies.filter(p => p.companyId === selectedCompanyId);

  const applyTemplate = (tpl: typeof INSURANCE_TEMPLATES[0]) => {
    form.setValue("name", tpl.name);
    form.setValue("description", tpl.description);
    if (tpl.asrProvider) form.setValue("asrProvider", tpl.asrProvider);
    if (tpl.llmProvider) form.setValue("llmProvider", tpl.llmProvider);
    if (tpl.ttsProvider) form.setValue("ttsProvider", tpl.ttsProvider);
    if (tpl.telephonyProvider) form.setValue("telephonyProvider", tpl.telephonyProvider);
    if (tpl.systemPrompt) form.setValue("systemPrompt", tpl.systemPrompt);
    if (tpl.greetingMessage) form.setValue("greetingMessage", tpl.greetingMessage);
    if (tpl.temperature != null) form.setValue("temperature", tpl.temperature);
    setTemplatesOpen(false);
    toast({ title: `Template applied: ${tpl.name}`, description: "Form prefilled — adjust any fields then save." });
  };

  const [isSaving, setIsSaving] = useState(false);

  const onSubmit = (data: AgentFormValues) => {
    setIsSaving(true);
    const company = companies.find(c => c.id === data.companyId);
    const policy = policies.find(p => p.id === data.policyId);
    const now = new Date().toISOString();
    const newAgent: InsuranceAgent = {
      id: Date.now().toString(),
      companyId: data.companyId,
      companyName: company?.name ?? data.companyId,
      policyId: data.policyId || undefined,
      policyName: policy?.name || undefined,
      name: data.name,
      description: data.description,
      status: "draft",
      systemPrompt: data.systemPrompt,
      voiceId: data.ttsVoice ?? "",
      kbEntries: 0, totalCalls: 0, successfulCalls: 0, conversionRate: 0, avgDurationSeconds: 0,
      lastUpdated: now,
      agentMode: "managed",
      agentType: data.agentType as any,
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
      tools: data.tools?.map(t => ({
        ...t,
        transferMode: t.transferMode ?? "cold",
      })),
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
      ambientSoundId: data.ambientSoundId || undefined,
    };
    saveAgents([...agents, newAgent]);
    toast({ title: "Agent Created", description: `"${newAgent.name}" has been created as a draft.` });
    setIsSaving(false);
    setLocation("/family/agents");
  };

  return (
    <div className="relative flex-1 overflow-y-auto">
      {/* ── Ambient background orbs ── */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-48 left-1/4 h-[640px] w-[640px] rounded-full bg-violet-600/10 blur-[160px]" />
        <div className="absolute top-1/3 -right-24 h-[500px] w-[500px] rounded-full bg-blue-600/10 blur-[140px]" />
        <div className="absolute bottom-0 left-8 h-[420px] w-[420px] rounded-full blur-[120px]" style={{background:"rgba(6,182,212,0.07)"}} />
        <div className="absolute top-2/3 left-1/2 h-[300px] w-[300px] rounded-full blur-[100px]" style={{background:"rgba(236,72,153,0.06)"}} />
      </div>

      <div className="glass-form max-w-5xl mx-auto space-y-5 p-6 md:p-8 pt-6 pb-28">

        {/* ── Page header ── */}
        <div className="flex items-center gap-4 mb-2">
          <Link href="/family/agents">
            <Button variant="ghost" size="icon"
              className="h-9 w-9 rounded-xl border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.09] text-white/60 hover:text-white transition-all">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex-1">
            <h2 className="text-2xl font-semibold tracking-tight text-white flex items-center gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                style={{background:"linear-gradient(135deg,#7c3aed,#2563eb)",boxShadow:"0 0 22px rgba(124,58,237,0.50)"}}>
                <Bot className="h-4 w-4 text-white" />
              </span>
              Create Agent
            </h2>
            <p className="text-sm text-white/38 mt-0.5 ml-[48px]">Configure a new insurance AI voice agent pipeline.</p>
          </div>
          <Button type="button" variant="ghost" onClick={() => setTemplatesOpen(true)}
            className="gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.09] text-white/60 hover:text-white transition-all px-4">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="text-sm">Use Template</span>
          </Button>
        </div>

        {/* ── Templates dialog ── */}
        <Dialog open={templatesOpen} onOpenChange={setTemplatesOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" /> Start from a template
              </DialogTitle>
              <DialogDescription>
                Pick a template to prefill the form. You can customise everything afterwards.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-3 mt-2">
              {INSURANCE_TEMPLATES.map(tpl => (
                <button
                  key={tpl.id}
                  onClick={() => applyTemplate(tpl)}
                  className="text-left p-4 rounded-lg bg-muted border border-border hover:border-muted-foreground/30 hover:bg-accent transition-colors"
                >
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <p className="text-sm font-semibold text-foreground">{tpl.name}</p>
                    <Badge className={`text-[10px] shrink-0 ${CATEGORY_COLORS[tpl.category] ?? CATEGORY_COLORS.general}`}>
                      {tpl.category}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{tpl.description}</p>
                  <p className="text-[11px] text-muted-foreground/60 mt-2 font-mono">
                    {tpl.asrProvider} · {tpl.llmProvider} · {tpl.ttsProvider}
                  </p>
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        <Form {...form}>
          <form id="agent-new-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">

            {/* ── Company & Policy ── */}
            <div className="glass-card">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent pointer-events-none" />
              <div className="flex items-center gap-3 mb-5">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                  style={{background:"linear-gradient(135deg,#7c3aed,#2563eb)",boxShadow:"0 0 16px rgba(124,58,237,0.40)"}}>
                  <Building2 className="h-3.5 w-3.5 text-white" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white/90">Company &amp; Policy</p>
                  <p className="text-[11px] text-white/38 mt-0.5">Associate this agent with an insurance company and optionally a specific product policy.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField control={form.control} name="companyId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company <span className="text-destructive">*</span></FormLabel>
                    <Select onValueChange={v => { field.onChange(v); form.setValue("policyId", undefined); }} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger></FormControl>
                      <SelectContent className="max-h-64">
                        {companiesForSelect.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="policyId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Policy <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                    <Select
                      onValueChange={v => field.onChange(v === "__none__" ? undefined : v)}
                      value={field.value ?? "__none__"}
                      disabled={!selectedCompanyId}
                    >
                      <FormControl><SelectTrigger><SelectValue placeholder="Select policy" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {policiesForCompany.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription className="text-[11px]">
                      {!selectedCompanyId ? "Select a company first." :
                        policiesForCompany.length === 0
                          ? "No policies for this company — add them on the Companies page."
                          : "Agent will use this policy's KB for RAG."}
                    </FormDescription>
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
              </div>
            </div>

            {/* ── General + AI Behavior (2-col) ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

              {/* General */}
              <div className="glass-card">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent pointer-events-none" />
                <div className="flex items-center gap-2.5 mb-5">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                    style={{background:"linear-gradient(135deg,#0ea5e9,#6366f1)",boxShadow:"0 0 14px rgba(14,165,233,0.38)"}}>
                    <Bot className="h-3.5 w-3.5 text-white" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white/90">General Information</p>
                    <p className="text-[11px] text-white/38 mt-0.5">Basic details about your agent.</p>
                  </div>
                </div>
                <div className="space-y-4">
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
                </div>
              </div>

              {/* AI Behavior */}
              <div className="glass-card">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent pointer-events-none" />
                <div className="flex items-center gap-2.5 mb-5">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                    style={{background:"linear-gradient(135deg,#a855f7,#6366f1)",boxShadow:"0 0 14px rgba(168,85,247,0.38)"}}>
                    <Sparkles className="h-3.5 w-3.5 text-white" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white/90">AI Behavior</p>
                    <p className="text-[11px] text-white/38 mt-0.5">Configure how the agent responds.</p>
                  </div>
                </div>
                <div className="space-y-4">
                <FormField control={form.control} name="systemPrompt" render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>System Prompt</FormLabel>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setFullscreenPrompt(true)} title="Expand">
                        <Maximize2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
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
                        {AGENT_TIMEZONES.map(tz => (
                          <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                        ))}
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
                </div>
              </div>
            </div>

            {/* ── Conversation Behavior ── */}
            <div className="glass-card">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent pointer-events-none" />
              <div className="flex items-center gap-2.5 mb-5">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  style={{background:"linear-gradient(135deg,#10b981,#0ea5e9)",boxShadow:"0 0 14px rgba(16,185,129,0.38)"}}>
                  <Volume2 className="h-3.5 w-3.5 text-white" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white/90">Conversation Behavior</p>
                  <p className="text-[11px] text-white/38 mt-0.5">Control how the agent opens, responds, and ends calls.</p>
                </div>
              </div>
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
                        <FormControl>
                          <Input placeholder="goodbye, bye, have a great day, thank you for calling" {...field} />
                        </FormControl>
                        <FormDescription>Comma-separated. Triggers automatic hangup when detected.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="inactivityMessage" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Inactivity Message</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Are you still there? How can I help you?" {...field} />
                        </FormControl>
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

                    <FormField control={form.control} name="ambientSoundId" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-1.5">
                          <Volume2 className="h-3.5 w-3.5 text-muted-foreground" /> Ambient Background Sound
                        </FormLabel>
                        <Select
                          onValueChange={(v) => field.onChange(v === "__none__" ? "" : v)}
                          value={field.value || "__none__"}
                        >
                          <FormControl><SelectTrigger><SelectValue placeholder="No ambient sound" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {ambientSounds.map(s => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription className="text-[11px]">Mixes background audio into TTS output (office noise, call centre, etc.)</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={form.control} name="asrLanguage" render={({ field }) => (
                      <FormItem>
                        <FormLabel>ASR Language Override</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. en-IN, hi, ta-IN (leave blank to use Language above)" {...field} />
                        </FormControl>
                        <FormDescription className="text-[11px]">Overrides the general language for ASR only.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <div className="glass-toggle-row space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium leading-none text-white/80">Noise Cancellation</p>
                          <p className="text-xs text-white/35 mt-1">Request noise reduction from the ASR provider</p>
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

                    <div className="glass-toggle-row space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium leading-none text-white/80">Backchanneling</p>
                          <p className="text-xs text-white/35 mt-1">Agent says "I see", "Got it" etc. while thinking</p>
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

                    <FormField control={form.control} name="webhookUrl" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Post-Call Webhook URL</FormLabel>
                        <FormControl>
                          <Input placeholder="https://your-server.com/webhook/calls" {...field} />
                        </FormControl>
                        <FormDescription>Receives a JSON summary when each call ends.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="webhookSecret" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Webhook Signing Secret</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="Optional — enables HMAC signature header" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>
            </div>

            {/* ── Pipeline ── */}
            <div className="glass-card">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent pointer-events-none" />
              <div className="flex items-center gap-2.5 mb-5">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  style={{background:"linear-gradient(135deg,#f59e0b,#ef4444)",boxShadow:"0 0 14px rgba(245,158,11,0.38)"}}>
                  <PhoneForwarded className="h-3.5 w-3.5 text-white" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white/90">Pipeline Configuration</p>
                  <p className="text-[11px] text-white/38 mt-0.5">Select providers and models for each stage of the voice pipeline.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

                {/* Step 1 — ASR */}
                <div className="glass-pipeline-step" style={{border:"1px solid rgba(6,182,212,0.22)",background:"rgba(6,182,212,0.05)"}}>
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/20 to-transparent pointer-events-none" />
                  <div className="flex items-center gap-2 mb-3">
                    <span className="flex items-center justify-center h-5 w-5 rounded-md text-[10px] font-bold shrink-0 text-white" style={{background:"linear-gradient(135deg,#06b6d4,#0284c7)"}}>1</span>
                    <p className="text-xs font-semibold text-white/80">ASR <span className="text-white/40 font-normal">— Speech-to-Text</span></p>
                  </div>
                    <FormField control={form.control} name="asrProvider" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Provider</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            {availableAsrProviders.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    {ASR_MODELS[asrProvider] && (
                      <FormField control={form.control} name="asrModel" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Model</FormLabel>
                          <FormControl>
                            <ModelSelect options={ASR_MODELS[asrProvider]} value={field.value} onChange={field.onChange} />
                          </FormControl>
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
                  <div className="glass-pipeline-step" style={{border:"1px solid rgba(139,92,246,0.22)",background:"rgba(139,92,246,0.05)"}}>
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-400/20 to-transparent pointer-events-none" />
                    <div className="flex items-center gap-2 mb-3">
                      <span className="flex items-center justify-center h-5 w-5 rounded-md text-[10px] font-bold shrink-0 text-white" style={{background:"linear-gradient(135deg,#7c3aed,#6366f1)"}}>2</span>
                      <p className="text-xs font-semibold text-white/80">LLM <span className="text-white/40 font-normal">— Language Model</span></p>
                    </div>
                    <FormField control={form.control} name="llmProvider" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Provider</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            {availableLlmProviders.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    {LLM_MODELS[llmProvider] && (
                      <FormField control={form.control} name="llmModel" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Model</FormLabel>
                          <FormControl>
                            <ModelSelect options={LLM_MODELS[llmProvider]} value={field.value} onChange={field.onChange} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}
                  </div>

                  {/* Step 3 — TTS */}
                  <div className="glass-pipeline-step" style={{border:"1px solid rgba(16,185,129,0.22)",background:"rgba(16,185,129,0.05)"}}>
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/20 to-transparent pointer-events-none" />
                    <div className="flex items-center gap-2 mb-3">
                      <span className="flex items-center justify-center h-5 w-5 rounded-md text-[10px] font-bold shrink-0 text-white" style={{background:"linear-gradient(135deg,#10b981,#059669)"}}>3</span>
                      <p className="text-xs font-semibold text-white/80">TTS <span className="text-white/40 font-normal">— Text-to-Speech</span></p>
                    </div>
                    <FormField control={form.control} name="ttsProvider" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Provider</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            {availableTtsProviders.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    {/* Cartesia: dropdown from admin-listed voices */}
                    {ttsProvider === "cartesia" && (
                      <FormField control={form.control} name="ttsVoice" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Voice</FormLabel>
                          {cartesiaListedVoices.length > 0 ? (
                            <Select value={field.value ?? ""} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger><SelectValue placeholder="Select voice" /></SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {cartesiaListedVoices.map(v => (
                                  <SelectItem key={v.id} value={v.id}>
                                    {v.name}{v.language ? ` · ${v.language}` : ""}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <FormControl>
                              <Input placeholder="Paste a Cartesia voice ID" {...field} />
                            </FormControl>
                          )}
                          {cartesiaListedVoices.length === 0 && (
                            <FormDescription className="text-[11px]">
                              No voices listed yet — visit the <strong>Voices</strong> panel to whitelist some, or paste a voice ID directly.
                            </FormDescription>
                          )}
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}
                    {/* Other providers with a predefined voice catalogue */}
                    {ttsProvider !== "cartesia" && TTS_VOICES[ttsProvider] !== undefined && TTS_VOICES[ttsProvider] !== null && (
                      <FormField control={form.control} name="ttsVoice" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Voice</FormLabel>
                          <FormControl>
                            <ModelSelect options={TTS_VOICES[ttsProvider]!} value={field.value} onChange={field.onChange} placeholder="Select voice" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}
                    {/* Other providers that require a free-text voice ID (ElevenLabs, Azure TTS) */}
                    {ttsProvider !== "cartesia" && TTS_VOICES[ttsProvider] === null && (
                      <FormField control={form.control} name="ttsVoice" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Voice ID</FormLabel>
                          <FormControl><Input placeholder="e.g. EXAVITQu4vr4xnSDxMaL" {...field} /></FormControl>
                          <FormDescription className="text-[11px]">Paste a voice ID from your provider account.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}
                    {TTS_MODELS[ttsProvider] && (
                      <FormField control={form.control} name="ttsModel" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Model</FormLabel>
                          <FormControl>
                            <ModelSelect options={TTS_MODELS[ttsProvider]} value={field.value} onChange={field.onChange} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}
                  </div>

                  {/* Step 4 — Telephony */}
                  <div className="glass-pipeline-step" style={{border:"1px solid rgba(249,115,22,0.22)",background:"rgba(249,115,22,0.05)"}}>
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-orange-400/20 to-transparent pointer-events-none" />
                    <div className="flex items-center gap-2 mb-3">
                      <span className="flex items-center justify-center h-5 w-5 rounded-md text-[10px] font-bold shrink-0 text-white" style={{background:"linear-gradient(135deg,#f97316,#dc2626)"}}>4</span>
                      <p className="text-xs font-semibold text-white/80">Telephony</p>
                    </div>
                    <FormField control={form.control} name="telephonyProvider" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Provider</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            {availableTelephonyProviders.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>
            </div>

            {/* ── Advanced STT ── */}
            <div className="glass-card">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent pointer-events-none" />
              <button type="button" className="flex items-center justify-between w-full" onClick={() => setShowAdvancedSTT(v => !v)}>
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                    style={{background:"linear-gradient(135deg,#06b6d4,#3b82f6)",boxShadow:"0 0 14px rgba(6,182,212,0.35)"}}>
                    <ChevronDown className="h-3.5 w-3.5 text-white" />
                  </span>
                  <div className="text-left">
                    <p className="text-sm font-semibold text-white/90">Advanced STT Settings</p>
                    <p className="text-[11px] text-white/38 mt-0.5">Fine-tune streaming STT behaviour, confidence thresholds, and end-of-turn detection.</p>
                  </div>
                </div>
                {showAdvancedSTT ? <ChevronUp className="h-4 w-4 text-white/40 shrink-0" /> : <ChevronDown className="h-4 w-4 text-white/40 shrink-0" />}
              </button>
              {showAdvancedSTT && (
                <div className="mt-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
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
                      <FormDescription className="text-[11px]">Use LLM-assisted end-of-turn detection instead of pure silence timeout.</FormDescription>
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

                  <div className="glass-toggle-row space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-white/80">Background Denoising</p>
                        <p className="text-xs text-white/35">Filter background noise during transcription</p>
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

                  <div className="glass-toggle-row space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-white/80">Auto Fallback</p>
                        <p className="text-xs text-white/35">Switch to batch STT if streaming fails</p>
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
                </div>
                </div>
              )}
            </div>

            {/* ── Knowledge Base ── */}
            <div className="glass-card">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent pointer-events-none" />
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  style={{background:"linear-gradient(135deg,#f59e0b,#d97706)",boxShadow:"0 0 14px rgba(245,158,11,0.35)"}}>
                  <Database className="h-3.5 w-3.5 text-white" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white/90">Knowledge Base <span className="text-white/38 font-normal text-xs">(policy-linked)</span></p>
                  <p className="text-[11px] text-white/38 mt-0.5">The agent's knowledge base is managed through the Company → Policy page. Select a policy above to link a KB — the agent will use it for RAG on every turn.</p>
                </div>
              </div>
            </div>

            {/* ── Prompt Variables ── */}
            <div className="glass-card">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent pointer-events-none" />
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                    style={{background:"linear-gradient(135deg,#ec4899,#a855f7)",boxShadow:"0 0 14px rgba(236,72,153,0.35)"}}>
                    <ClipboardList className="h-3.5 w-3.5 text-white" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white/90">Prompt Variables</p>
                    <p className="text-[11px] text-white/38 mt-0.5">Define <code>{"{{key}}"}</code> placeholders; overridden by inbound call parameters.</p>
                  </div>
                </div>
                <Button type="button" variant="ghost" size="sm"
                  className="gap-1 border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.09] text-white/60 hover:text-white rounded-lg text-xs"
                  onClick={() => appendPromptVar({ key: "", defaultValue: "", description: "" })}>
                  <Plus className="h-3 w-3" /> Add Variable
                </Button>
              </div>
              {promptVarFields.length > 0 && (
                <div className="space-y-2.5 max-h-96 overflow-y-auto">
                  {promptVarFields.map((field, index) => (
                    <div key={field.id} className="glass-array-item relative grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Button type="button" variant="ghost" size="icon"
                      className="absolute top-2 right-2 h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => removePromptVar(index)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <FormField control={form.control} name={`promptVariables.${index}.key`} render={({ field: f }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Key</FormLabel>
                        <FormControl><Input placeholder="e.g. company_name" className="h-8 text-sm" {...f} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name={`promptVariables.${index}.defaultValue`} render={({ field: f }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Default Value</FormLabel>
                        <FormControl><Input placeholder="e.g. ICICI Lombard" className="h-8 text-sm" {...f} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name={`promptVariables.${index}.description`} render={({ field: f }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Description <span className="text-muted-foreground">(optional)</span></FormLabel>
                        <FormControl><Input placeholder="e.g. The insurance company name" className="h-8 text-sm" {...f} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Voice Activity Detection ── */}
            <div className="glass-card">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent pointer-events-none" />
              <div className="flex items-center gap-2.5 mb-5">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  style={{background:"linear-gradient(135deg,#0ea5e9,#06b6d4)",boxShadow:"0 0 14px rgba(14,165,233,0.35)"}}>
                  <Volume2 className="h-3.5 w-3.5 text-white" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white/90">Voice Activity Detection &amp; Barge-in</p>
                  <p className="text-[11px] text-white/38 mt-0.5">Fine-tune how the agent detects speech and handles interruptions.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                <FormField control={form.control} name="vadSilenceMs" render={({ field }) => (
                  <FormItem>
                    <FormLabel>VAD Silence Window (ms)</FormLabel>
                    <FormControl>
                      <Input type="number" min={50} max={2000} step={50}
                        value={field.value ?? 250}
                        onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                    </FormControl>
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
            </div>

            {/* ── Tools ── */}
            <div className="glass-card">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent pointer-events-none" />
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                    style={{background:"linear-gradient(135deg,#f97316,#dc2626)",boxShadow:"0 0 14px rgba(249,115,22,0.35)"}}>
                    <PhoneForwarded className="h-3.5 w-3.5 text-white" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white/90">Tools</p>
                    <p className="text-[11px] text-white/38 mt-0.5">Actions the LLM can trigger mid-call based on the conversation.</p>
                  </div>
                </div>
                <Button type="button" variant="ghost" size="sm"
                  className="gap-1 border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.09] text-white/60 hover:text-white rounded-lg text-xs"
                  onClick={() => appendTool({ type: "call_transfer", name: "transfer_to_human", description: "Transfer the call to a human agent when the caller requests it or the issue cannot be resolved automatically.", transferTo: "", warmHandoffMessage: "" })}>
                  <Plus className="h-3 w-3" /> Add Tool
                </Button>
              </div>
              {toolFields.length > 0 && (
                <div className="space-y-3">
                  {toolFields.map((field, index) => (
                    <div key={field.id} className="glass-array-item space-y-3">
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
                          <FormDescription className="text-[10px]">snake_case, no spaces — used by the LLM to call this tool</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`tools.${index}.transferTo`} render={({ field: f }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Transfer To (phone number)</FormLabel>
                          <FormControl><Input placeholder="+911234567890" {...f} /></FormControl>
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
                        <FormLabel className="text-xs">Hold Message (optional)</FormLabel>
                        <FormControl><Input placeholder="e.g. I'm connecting you with a specialist now. Please hold for a moment." {...f} /></FormControl>
                        <FormDescription className="text-[10px]">Spoken to the caller before the transfer happens</FormDescription>
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
                    {(form.watch(`tools.${index}.transferMode`) ?? "cold") === "warm_summary" && (
                      <FormField control={form.control} name={`tools.${index}.summaryPrompt`} render={({ field: f }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Operator Briefing Prompt (optional)</FormLabel>
                          <FormControl><Textarea className="min-h-[60px] text-sm" placeholder="Default: summarise customer name, issue, priority, and key context for the operator." {...f} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Disposition Schema ── */}
            <div className="glass-card">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent pointer-events-none" />
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                    style={{background:"linear-gradient(135deg,#8b5cf6,#ec4899)",boxShadow:"0 0 14px rgba(139,92,246,0.35)"}}>
                    <ClipboardList className="h-3.5 w-3.5 text-white" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white/90">Disposition Fields</p>
                    <p className="text-[11px] text-white/38 mt-0.5">Fields the AI automatically extracts from each call transcript after the call ends.</p>
                  </div>
                </div>
                <Button type="button" variant="ghost" size="sm"
                  className="gap-1 border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.09] text-white/60 hover:text-white rounded-lg text-xs"
                  onClick={() => appendDisposition({ type: "text", key: "", label: "", required: false, options: "" })}>
                  <Plus className="h-3 w-3" /> Add Field
                </Button>
              </div>
              {dispositionFields.length > 0 && (
                <div className="space-y-2.5">
                  {dispositionFields.map((field, index) => {
                    const watchedType = form.watch(`dispositionSchema.${index}.type`);
                    return (
                      <div key={field.id} className="glass-array-item space-y-3">
                      <Button type="button" variant="ghost" size="icon"
                        className="absolute top-2 right-2 h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => removeDisposition(index)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <FormField control={form.control} name={`dispositionSchema.${index}.key`} render={({ field: f }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Key</FormLabel>
                            <FormControl><Input placeholder="e.g. call_outcome" {...f} /></FormControl>
                            <FormDescription className="text-[10px]">snake_case identifier</FormDescription>
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
                            <FormControl><Input placeholder="e.g. resolved, escalated, callback" {...f} /></FormControl>
                            <FormDescription className="text-[10px]">Comma-separated list of allowed values</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )} />
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Usage Limits ── */}
            <div className="glass-card">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent pointer-events-none" />
              <div className="flex items-center gap-2.5 mb-5">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  style={{background:"linear-gradient(135deg,#6366f1,#8b5cf6)",boxShadow:"0 0 14px rgba(99,102,241,0.35)"}}>
                  <ChevronDown className="h-3.5 w-3.5 text-white" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white/90">Usage Limits <span className="text-white/38 font-normal text-xs">(optional)</span></p>
                  <p className="text-[11px] text-white/38 mt-0.5">Cap concurrent calls and monthly spend for this agent.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="maxConcurrentCalls" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max concurrent calls</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="No limit" min={1} max={100}
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
                    </FormControl>
                    <FormDescription className="text-[11px]">Maximum simultaneous active calls. Leave blank for no limit.</FormDescription>
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
                    <FormDescription className="text-[11px]">Stop new calls when platform fees exceed this amount in a calendar month.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </div>

            {/* ── Memory ── */}
            <div className="glass-card">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent pointer-events-none" />
              <div className="flex items-center gap-2.5 mb-5">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  style={{background:"linear-gradient(135deg,#10b981,#059669)",boxShadow:"0 0 14px rgba(16,185,129,0.35)"}}>
                  <Brain className="h-3.5 w-3.5 text-white" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white/90">Memory &amp; Context</p>
                  <p className="text-[11px] text-white/38 mt-0.5">Configure in-call and cross-call memory for this agent.</p>
                </div>
              </div>
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
                      <FormControl>
                        <Input type="number" min={5} max={100} placeholder="20"
                          value={field.value ?? 20}
                          onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                      </FormControl>
                      <FormDescription className="text-[11px]">Number of previous messages to include in each LLM call.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
              </div>
            </div>

            {/* ── Auto Callback ── */}
            <div className="glass-card">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent pointer-events-none" />
              <div className="flex items-center gap-2.5 mb-5">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  style={{background:"linear-gradient(135deg,#f59e0b,#ef4444)",boxShadow:"0 0 14px rgba(245,158,11,0.35)"}}>
                  <Phone className="h-3.5 w-3.5 text-white" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white/90">Auto Callback</p>
                  <p className="text-[11px] text-white/38 mt-0.5">Automatically retry calls when the customer doesn't answer.</p>
                </div>
              </div>
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
                        <FormControl>
                          <Input type="number" min={1} max={10} placeholder="3"
                            value={field.value ?? 3}
                            onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                        </FormControl>
                        <FormDescription className="text-[11px]">Number of callback attempts before giving up.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="autoCallbackDelaySeconds" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Delay Between Retries (s)</FormLabel>
                        <FormControl>
                          <Input type="number" min={10} max={3600} placeholder="300"
                            value={field.value ?? 300}
                            onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                        </FormControl>
                        <FormDescription className="text-[11px]">Wait this many seconds before each retry.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </>
                )}
              </div>
            </div>

            {/* bottom spacer so content isn't hidden behind fixed bar */}
            <div className="h-24" />
          </form>
        </Form>
      </div>{/* end glass-form */}

      {/* ── Fixed bottom bar ── */}
      <div className="fixed bottom-0 left-0 md:left-64 right-0 z-20"
        style={{background:"rgba(10,10,18,0.82)",backdropFilter:"blur(18px)",borderTop:"1px solid rgba(255,255,255,0.07)"}}>
        <div className="max-w-5xl mx-auto px-6 py-3 flex justify-end gap-3">
          <Link href="/family/agents">
            <Button type="button" variant="ghost"
              className="border border-white/[0.09] bg-white/[0.04] hover:bg-white/[0.08] text-white/60 hover:text-white rounded-xl px-5">
              Cancel
            </Button>
          </Link>
          <Button
            type="submit" form="agent-new-form" disabled={isSaving}
            className="gap-2 rounded-xl px-6 text-sm font-semibold"
            style={{background:"linear-gradient(135deg,#6366f1,#8b5cf6)",boxShadow:"0 0 20px rgba(99,102,241,0.4)"}}>
            <Save className="h-3.5 w-3.5" />
            {isSaving ? "Creating…" : "Create Agent"}
          </Button>
        </div>
      </div>

      {/* ── Fullscreen system prompt dialog ── */}
      <Dialog open={fullscreenPrompt} onOpenChange={setFullscreenPrompt}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col"
          style={{background:"rgba(14,14,24,0.95)",backdropFilter:"blur(24px)",border:"1px solid rgba(255,255,255,0.1)"}}>
          <DialogHeader>
            <DialogTitle className="text-white/90">System Prompt</DialogTitle>
          </DialogHeader>
          <div className="flex-1 flex flex-col gap-3 min-h-0">
            <Textarea
              className="flex-1 font-mono text-sm resize-none bg-white/[0.04] border-white/[0.08] text-white/80 placeholder:text-white/25 focus-visible:ring-indigo-500/40"
              value={systemPromptWatch ?? ""}
              onChange={(e) => form.setValue("systemPrompt", e.target.value, { shouldDirty: true })}
              placeholder="You are a helpful insurance assistant..."
            />
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => setFullscreenPrompt(false)}
                className="border border-white/[0.09] bg-white/[0.04] hover:bg-white/[0.08] text-white/60 hover:text-white rounded-xl px-5">
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
