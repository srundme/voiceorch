import React, { useState, useEffect, useCallback, useRef } from "react";
import { Link, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { useFamilyStore, InsuranceAgent, AgentStatus, AgentType } from "@/lib/family-store";
import {
  Search, Plus, Bot, Phone, MoreHorizontal, ChevronDown, ChevronUp,
  Mic, Brain, Volume2, PhoneCall, Database, RefreshCw, Check, Trash2,
  CircleDot, Zap, Shield, MessageSquare,
} from "lucide-react";

/* ── Provider catalogues ────────────────────────────────────────────────── */

const ASR_PROVIDERS  = [
  { value: "deepgram",   label: "Deepgram" },
  { value: "sarvam",     label: "Sarvam" },
  { value: "azure",      label: "Azure" },
  { value: "assemblyai", label: "AssemblyAI" },
  { value: "cartesia",   label: "Cartesia" },
];
const LLM_PROVIDERS = [
  { value: "openai",    label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google",    label: "Google Gemini" },
  { value: "qwen",      label: "Qwen (Groq)" },
  { value: "groq",      label: "Groq" },
  { value: "deepseek",  label: "DeepSeek" },
  { value: "sarvam",    label: "Sarvam" },
  { value: "mistral",   label: "Mistral" },
];
const TTS_PROVIDERS = [
  { value: "cartesia",      label: "Cartesia" },
  { value: "elevenlabs",    label: "ElevenLabs" },
  { value: "openai_tts",    label: "OpenAI TTS" },
  { value: "deepgram_aura", label: "Deepgram Aura" },
  { value: "sarvam",        label: "Sarvam" },
  { value: "azure_tts",     label: "Azure TTS" },
];
const TELEPHONY_PROVIDERS = [
  { value: "twilio", label: "Twilio" },
  { value: "plivo",  label: "Plivo" },
  { value: "vobiz",  label: "Vobiz" },
];
const LANGUAGES = [
  { value: "en-IN", label: "English (India)" },
  { value: "hi",    label: "Hindi" },
  { value: "ta-IN", label: "Tamil" },
  { value: "te-IN", label: "Telugu" },
  { value: "kn-IN", label: "Kannada" },
  { value: "ml-IN", label: "Malayalam" },
  { value: "bn-IN", label: "Bengali" },
  { value: "mr-IN", label: "Marathi" },
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
];
const AGENT_TYPES: { value: AgentType; label: string }[] = [
  { value: "general_purpose",      label: "General Purpose" },
  { value: "outbound_sales",       label: "Outbound Sales" },
  { value: "inbound_support",      label: "Inbound Support" },
  { value: "appointment_booking",  label: "Appointment Booking" },
  { value: "lead_qualification",   label: "Lead Qualification" },
];
const ASR_MODELS: Record<string, { value: string; label: string }[]> = {
  deepgram:   [{ value: "nova-2", label: "Nova-2" }, { value: "nova-2-phonecall", label: "Nova-2 Phone Call" }],
  sarvam:     [{ value: "saaras:v3", label: "Saaras v3 (streaming)" }, { value: "saarika:v2.5", label: "Saarika v2.5" }],
  azure:      [{ value: "en-IN-standard", label: "en-IN-standard" }, { value: "en-US-enhanced", label: "en-US-enhanced" }],
  assemblyai: [{ value: "best", label: "Best" }, { value: "nano", label: "Nano (fast)" }],
};
const LLM_MODELS: Record<string, { value: string; label: string }[]> = {
  openai:    [{ value: "gpt-4o-mini", label: "GPT-4o Mini" }, { value: "gpt-4o", label: "GPT-4o" }],
  anthropic: [{ value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" }, { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" }],
  google:    [{ value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }, { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" }],
  qwen:      [{ value: "qwen/qwen3-32b", label: "Qwen 3 32B" }, { value: "qwen/qwen3-235b-a22b", label: "Qwen 3 235B" }],
  groq:      [{ value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" }, { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B" }],
  deepseek:  [{ value: "deepseek-chat", label: "DeepSeek V3" }, { value: "deepseek-reasoner", label: "DeepSeek R1" }],
  sarvam:    [{ value: "sarvam-30b", label: "Sarvam 30B" }],
  mistral:   [{ value: "mistral-large-latest", label: "Mistral Large" }, { value: "mistral-small-latest", label: "Mistral Small" }],
};
const TTS_MODELS: Record<string, { value: string; label: string }[]> = {
  cartesia: [{ value: "sonic-3.5", label: "Sonic 3.5" }, { value: "sonic-3", label: "Sonic 3" }, { value: "sonic-2", label: "Sonic 2" }],
};
const TTS_VOICES: Record<string, { value: string; label: string }[] | null> = {
  cartesia:      null,
  elevenlabs:    null,
  azure_tts:     null,
  openai_tts:    [{ value: "alloy", label: "Alloy" }, { value: "ash", label: "Ash" }, { value: "coral", label: "Coral" }, { value: "nova", label: "Nova" }, { value: "shimmer", label: "Shimmer" }],
  deepgram_aura: [{ value: "aura-2-en", label: "Aura 2" }, { value: "aura-asteria-en", label: "Asteria" }, { value: "aura-zeus-en", label: "Zeus" }],
  sarvam:        [{ value: "meera", label: "Meera (F)" }, { value: "pavithra", label: "Pavithra (F)" }, { value: "arvind", label: "Arvind (M)" }, { value: "amol", label: "Amol (M)" }, { value: "neel", label: "Neel (M)" }],
};

/* ── Cost estimation per minute ──────────────────────────────────────────── */

const STT_COST: Record<string, number>  = { deepgram: 0.004, sarvam: 0.002, azure: 0.005, assemblyai: 0.006, cartesia: 0.004 };
const LLM_COST: Record<string, number>  = { openai: 0.020, anthropic: 0.025, google: 0.006, qwen: 0.005, groq: 0.003, deepseek: 0.003, sarvam: 0.004, mistral: 0.005 };
const TTS_COST: Record<string, number>  = { elevenlabs: 0.012, cartesia: 0.006, openai_tts: 0.008, deepgram_aura: 0.004, sarvam: 0.003, azure_tts: 0.005 };
const TEL_COST: Record<string, number>  = { twilio: 0.008, plivo: 0.006, vobiz: 0.004 };
const PLATFORM_FEE = 0.005;

function calcCost(a: InsuranceAgent) {
  const asr = STT_COST[a.asrProvider ?? ""] ?? 0;
  const llm = LLM_COST[a.llmProvider ?? ""] ?? 0;
  const tts = TTS_COST[a.ttsProvider ?? ""] ?? 0;
  const tel = TEL_COST[a.telephonyProvider ?? ""] ?? 0;
  return { asr, llm, tts, tel, fee: PLATFORM_FEE, total: asr + llm + tts + tel + PLATFORM_FEE };
}

/* ── Status helpers ──────────────────────────────────────────────────────── */

const STATUS_DOT: Record<AgentStatus, string> = {
  draft: "bg-zinc-500", training: "bg-yellow-400", testing: "bg-blue-400",
  approved: "bg-green-400", published: "bg-emerald-500",
};
const STATUS_PIPELINE: AgentStatus[] = ["draft", "training", "testing", "approved", "published"];

function blankAgent(): InsuranceAgent {
  return {
    id: `fa-${Date.now()}`,
    companyId: "", companyName: "",
    name: "New Assistant",
    status: "draft",
    systemPrompt: "You are a helpful AI voice assistant for insurance customers in India. Be concise, warm, and professional.",
    voiceId: "",
    kbEntries: 0, totalCalls: 0, conversionRate: 0, avgDurationSeconds: 0,
    lastUpdated: new Date().toISOString(),
    agentType: "general_purpose",
    agentMode: "managed",
    asrProvider: "sarvam",  asrModel: "saaras:v3",
    llmProvider: "google",  llmModel: "gemini-2.5-flash",
    ttsProvider: "cartesia",
    telephonyProvider: "vobiz",
    language: "en-IN",
    temperature: 0.1,
    silenceTimeoutSeconds: 30,
    noiseCancellationEnabled: true,
    backchannelingEnabled: true,
    backchannelingFrequency: 0.5,
    bargeInEnabled: true,
    memoryEnabled: true,
    crossCallMemoryEnabled: true,
    contextWindowMessages: 12,
    autoCallbackEnabled: false,
    autoCallbackRetries: 2,
    autoCallbackDelaySeconds: 60,
  };
}

/* ── Tiny debounce hook ───────────────────────────────────────────────────── */

function useDebounced(fn: (a: InsuranceAgent) => void, ms: number) {
  const t = useRef<number>(0);
  return useCallback((a: InsuranceAgent) => {
    clearTimeout(t.current);
    t.current = window.setTimeout(() => fn(a), ms);
  }, [fn, ms]);
}

/* ── Inline Select helper ────────────────────────────────────────────────── */

function FieldSelect({ value, onChange, options, placeholder, disabled }: {
  value: string | undefined;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Select value={value ?? ""} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-9 bg-zinc-900 border-zinc-700 text-sm">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/* ── Section label ───────────────────────────────────────────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">{children}</span>
      <div className="flex-1 h-px bg-zinc-800" />
    </div>
  );
}

/* ── Pipeline Visualization ──────────────────────────────────────────────── */

function PipelineViz({ agent }: { agent: InsuranceAgent }) {
  const steps = [
    { icon: Phone,     label: "CALLER",    sub: "",                          color: "text-zinc-400" },
    { icon: Mic,       label: "STT",       sub: agent.asrProvider ?? "—",   color: "text-blue-400" },
    { icon: Brain,     label: "LLM",       sub: agent.llmProvider ?? "—",   color: "text-purple-400" },
    { icon: Volume2,   label: "TTS",       sub: agent.ttsProvider ?? "—",   color: "text-emerald-400" },
    { icon: PhoneCall, label: "TELEPHONY", sub: agent.telephonyProvider ?? "—", color: "text-orange-400" },
  ];
  return (
    <div className="flex items-center justify-between gap-1 py-2">
      {steps.map((step, i) => {
        const Icon = step.icon;
        return (
          <React.Fragment key={step.label}>
            <div className="flex flex-col items-center gap-1.5 flex-1">
              <div className={`h-10 w-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center ${step.color}`}>
                <Icon className="h-4.5 w-4.5" strokeWidth={1.5} />
              </div>
              <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">{step.label}</span>
              {step.sub && <span className="text-[10px] text-zinc-400 capitalize">{step.sub}</span>}
            </div>
            {i < steps.length - 1 && (
              <div className="w-6 flex items-center justify-center shrink-0 -mt-4">
                <div className="h-px w-full bg-zinc-700" />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ── Toggle row ──────────────────────────────────────────────────────────── */

function ToggleRow({ label, description, value, onChange }: {
  label: string; description?: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <div>
        <p className="text-sm font-medium text-zinc-200">{label}</p>
        {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative h-5 w-9 rounded-full transition-colors ${value ? "bg-primary" : "bg-zinc-700"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${value ? "left-4.5" : "left-0.5"}`} />
      </button>
    </div>
  );
}

/* ── Right Panel: the full agent config form ─────────────────────────────── */

function AgentPanel({ agentId, isNew, onCreated, onDeleted }: {
  agentId: string | null;
  isNew: boolean;
  onCreated: (a: InsuranceAgent) => void;
  onDeleted: (id: string) => void;
}) {
  const { companies, agents, policies, documents, saveAgents, isLoaded } = useFamilyStore();
  const { toast } = useToast();
  const [showPrompt, setShowPrompt] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const base = isNew
    ? blankAgent()
    : (agents.find(a => a.id === agentId) ?? blankAgent());

  const [form, setForm] = useState<InsuranceAgent>(base);

  useEffect(() => {
    if (!isNew && agentId) {
      const found = agents.find(a => a.id === agentId);
      if (found) setForm(found);
    }
  }, [agentId, isNew]);

  const debouncedSave = useDebounced((updated: InsuranceAgent) => {
    if (isNew) return;
    saveAgents(agents.map(a => a.id === updated.id ? updated : a));
  }, 600);

  const patch = useCallback((partial: Partial<InsuranceAgent>) => {
    const next = { ...form, ...partial, lastUpdated: new Date().toISOString() };
    setForm(next);
    debouncedSave(next);
  }, [form, debouncedSave]);

  const companyPolicies = policies.filter(p => p.companyId === form.companyId);
  const policyDocs = form.policyId ? documents.filter(d => d.policyId === form.policyId) : [];
  const cost = calcCost(form);

  const curIdx = STATUS_PIPELINE.indexOf(form.status);
  const nextStatus = STATUS_PIPELINE[curIdx + 1] as AgentStatus | undefined;

  function handleCreate() {
    const newAgent = { ...form, id: `fa-${Date.now()}`, lastUpdated: new Date().toISOString() };
    saveAgents([...agents, newAgent]);
    toast({ title: "Assistant created", description: `${newAgent.name} saved as draft.` });
    onCreated(newAgent);
  }
  function handleDelete() {
    if (!agentId) return;
    saveAgents(agents.filter(a => a.id !== agentId));
    toast({ title: "Assistant deleted" });
    onDeleted(agentId);
  }
  function advanceStatus() {
    if (!nextStatus) return;
    patch({ status: nextStatus });
    if (!isNew) {
      saveAgents(agents.map(a => a.id === form.id ? { ...a, status: nextStatus, lastUpdated: new Date().toISOString() } : a));
    }
    toast({ title: `Moved to ${nextStatus}` });
  }

  if (!isLoaded) return <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">Loading…</div>;

  const agentNum = isNew ? "NEW" : `#${form.id.slice(-4).toUpperCase()}`;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-zinc-950">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-zinc-800 shrink-0">
        <span className="font-semibold text-zinc-100 text-sm truncate max-w-[180px]">{form.name}</span>
        <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
          {agentNum}
        </span>
        <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT[form.status]}`} />
        <span className="text-xs text-zinc-500">{form.totalCalls} calls</span>
        <span className="text-xs text-zinc-500">·</span>
        <span className="text-xs text-zinc-500">{form.conversionRate > 0 ? `${form.conversionRate}% ok` : "0% ok"}</span>
        {form.avgDurationSeconds > 0 && (
          <>
            <span className="text-xs text-zinc-500">·</span>
            <span className="text-xs text-zinc-500">~{form.avgDurationSeconds}s</span>
          </>
        )}
        <div className="flex-1" />
        {!isNew && nextStatus && (
          <button
            onClick={advanceStatus}
            className="text-xs px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors"
          >
            → {nextStatus}
          </button>
        )}
        {!isNew && form.status === "published" && (
          <Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs gap-1">
            <Shield className="h-3 w-3" /> Live
          </Badge>
        )}
        <button className="h-8 w-8 rounded-md bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 border border-zinc-700 transition-colors">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

        {/* IDENTITY */}
        <div>
          <SectionLabel>Identity</SectionLabel>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">Name</label>
              <Input
                value={form.name}
                onChange={e => patch({ name: e.target.value })}
                className="bg-zinc-900 border-zinc-700 text-sm h-9"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">Type</label>
              <FieldSelect
                value={form.agentType}
                onChange={v => patch({ agentType: v as AgentType })}
                options={AGENT_TYPES}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">Language</label>
              <FieldSelect
                value={form.language}
                onChange={v => patch({ language: v })}
                options={LANGUAGES}
              />
            </div>
          </div>
        </div>

        {/* COMPANY & POLICY */}
        <div>
          <SectionLabel>Company &amp; Policy / RAG</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">Insurance Company</label>
              <FieldSelect
                value={form.companyId}
                onChange={v => {
                  const co = companies.find(c => c.id === v);
                  patch({ companyId: v, companyName: co?.name ?? "", policyId: undefined, policyName: undefined });
                }}
                options={companies.map(c => ({ value: c.id, label: c.name }))}
                placeholder="Select company…"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">
                Policy / Knowledge Base
                {policyDocs.length > 0 && (
                  <span className="ml-2 text-emerald-400">{policyDocs.reduce((s,d)=>s+d.chunkCount,0)} chunks indexed</span>
                )}
              </label>
              <FieldSelect
                value={form.policyId ?? ""}
                onChange={v => {
                  const pol = policies.find(p => p.id === v);
                  patch({ policyId: v || undefined, policyName: pol?.name });
                }}
                options={companyPolicies.map(p => ({ value: p.id, label: `${p.name} (${p.productType})` }))}
                placeholder={form.companyId ? (companyPolicies.length === 0 ? "No policies — add one first" : "Select policy…") : "Select company first"}
                disabled={!form.companyId}
              />
            </div>
          </div>
        </div>

        {/* BRAIN */}
        <div>
          <SectionLabel>Brain</SectionLabel>
          <div className="grid grid-cols-3 gap-3 items-end">
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">LLM Provider</label>
              <FieldSelect
                value={form.llmProvider}
                onChange={v => patch({ llmProvider: v, llmModel: LLM_MODELS[v]?.[0]?.value ?? "" })}
                options={LLM_PROVIDERS}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">Model</label>
              {LLM_MODELS[form.llmProvider ?? ""] ? (
                <FieldSelect
                  value={form.llmModel}
                  onChange={v => patch({ llmModel: v })}
                  options={LLM_MODELS[form.llmProvider!]!}
                />
              ) : (
                <Input
                  value={form.llmModel ?? ""}
                  onChange={e => patch({ llmModel: e.target.value })}
                  placeholder="Enter model name"
                  className="bg-zinc-900 border-zinc-700 text-sm h-9"
                />
              )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-zinc-400">Temperature</label>
                <span className="text-xs font-mono text-zinc-300">{(form.temperature ?? 0.7).toFixed(2)}</span>
              </div>
              <Slider
                min={0} max={2} step={0.01}
                value={[form.temperature ?? 0.7]}
                onValueChange={([v]) => patch({ temperature: v })}
                className="mt-3"
              />
              <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
                <span>Precise</span><span>Creative</span>
              </div>
            </div>
          </div>
        </div>

        {/* VOICE */}
        <div>
          <SectionLabel>Voice</SectionLabel>
          <div className="grid grid-cols-4 gap-3 items-end">
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">STT Provider</label>
              <FieldSelect
                value={form.asrProvider}
                onChange={v => patch({ asrProvider: v, asrModel: ASR_MODELS[v]?.[0]?.value ?? "" })}
                options={ASR_PROVIDERS}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">STT Model</label>
              {ASR_MODELS[form.asrProvider ?? ""] ? (
                <FieldSelect
                  value={form.asrModel}
                  onChange={v => patch({ asrModel: v })}
                  options={ASR_MODELS[form.asrProvider!]!}
                />
              ) : (
                <Input
                  value={form.asrModel ?? ""}
                  onChange={e => patch({ asrModel: e.target.value })}
                  placeholder="model"
                  className="bg-zinc-900 border-zinc-700 text-sm h-9"
                />
              )}
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">TTS Provider</label>
              <FieldSelect
                value={form.ttsProvider}
                onChange={v => {
                  const model = TTS_MODELS[v]?.[0]?.value ?? "";
                  const voice = TTS_VOICES[v]?.[0]?.value ?? "";
                  patch({ ttsProvider: v, ttsModel: model, ttsVoice: voice });
                }}
                options={TTS_PROVIDERS}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">
                {TTS_VOICES[form.ttsProvider ?? ""] ? "Voice" : "Voice ID"}
              </label>
              {TTS_VOICES[form.ttsProvider ?? ""] ? (
                <div className="flex gap-1.5">
                  <div className="flex-1">
                    <FieldSelect
                      value={form.ttsVoice}
                      onChange={v => patch({ ttsVoice: v, voiceId: v })}
                      options={TTS_VOICES[form.ttsProvider!]!}
                      placeholder="Select voice"
                    />
                  </div>
                </div>
              ) : (
                <Input
                  value={form.ttsVoice ?? ""}
                  onChange={e => patch({ ttsVoice: e.target.value, voiceId: e.target.value })}
                  placeholder={form.ttsProvider === "elevenlabs" ? "EL voice ID…" : "Cartesia voice ID…"}
                  className="bg-zinc-900 border-zinc-700 text-sm h-9 font-mono text-xs"
                />
              )}
            </div>
          </div>
          {/* TTS Model row (Cartesia / ElevenLabs) */}
          {TTS_MODELS[form.ttsProvider ?? ""] && (
            <div className="mt-3 grid grid-cols-4 gap-3">
              <div className="col-start-3">
                <label className="text-xs text-zinc-400 mb-1.5 block">TTS Model</label>
                <FieldSelect
                  value={form.ttsModel}
                  onChange={v => patch({ ttsModel: v })}
                  options={TTS_MODELS[form.ttsProvider!]!}
                />
              </div>
            </div>
          )}
        </div>

        {/* TELEPHONY */}
        <div>
          <SectionLabel>Telephony</SectionLabel>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">Provider</label>
              <FieldSelect
                value={form.telephonyProvider}
                onChange={v => patch({ telephonyProvider: v })}
                options={TELEPHONY_PROVIDERS}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">Max Duration (s)</label>
              <Input
                type="number" min={60} max={3600}
                value={form.maxDuration ?? 600}
                onChange={e => patch({ maxDuration: parseInt(e.target.value, 10) })}
                className="bg-zinc-900 border-zinc-700 text-sm h-9"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">Silence Timeout (s)</label>
              <Input
                type="number" min={5} max={120}
                value={form.silenceTimeoutSeconds ?? 30}
                onChange={e => patch({ silenceTimeoutSeconds: parseInt(e.target.value, 10) })}
                className="bg-zinc-900 border-zinc-700 text-sm h-9"
              />
            </div>
          </div>
        </div>

        {/* PIPELINE */}
        <div>
          <SectionLabel>Pipeline</SectionLabel>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
            <PipelineViz agent={form} />
          </div>
        </div>

        {/* MEMORY & CONTEXT */}
        <div>
          <SectionLabel>Memory &amp; Context</SectionLabel>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800">
            <div className="px-4 py-3">
              <ToggleRow
                label="Conversation Memory"
                description="Summarise and store each call — agent recalls context within a session."
                value={form.memoryEnabled ?? false}
                onChange={v => patch({ memoryEnabled: v })}
              />
            </div>
            <div className="px-4 py-3">
              <ToggleRow
                label="Cross-Call Memory"
                description="Remember previous conversations with the same phone number across all calls."
                value={form.crossCallMemoryEnabled ?? false}
                onChange={v => patch({ crossCallMemoryEnabled: v })}
              />
            </div>
            <div className="px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-zinc-200">Context Window</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Number of past messages sent to the LLM on each turn</p>
                </div>
                <Input
                  type="number" min={4} max={50}
                  value={form.contextWindowMessages ?? 12}
                  onChange={e => patch({ contextWindowMessages: parseInt(e.target.value, 10) })}
                  className="bg-zinc-800 border-zinc-700 text-sm h-8 w-20 text-right"
                />
              </div>
            </div>
          </div>
        </div>

        {/* AUTO CALLBACK */}
        <div>
          <SectionLabel>Automatic Callback</SectionLabel>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800">
            <div className="px-4 py-3">
              <ToggleRow
                label="Auto Callback"
                description="If the call drops unexpectedly, automatically call the customer back."
                value={form.autoCallbackEnabled ?? false}
                onChange={v => patch({ autoCallbackEnabled: v })}
              />
            </div>
            {form.autoCallbackEnabled && (
              <>
                <div className="px-4 py-3 grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-zinc-400 mb-1.5 block">Max Retries</label>
                    <Input
                      type="number" min={1} max={5}
                      value={form.autoCallbackRetries ?? 2}
                      onChange={e => patch({ autoCallbackRetries: parseInt(e.target.value, 10) })}
                      className="bg-zinc-800 border-zinc-700 text-sm h-8"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 mb-1.5 block">Delay (seconds)</label>
                    <Input
                      type="number" min={10} max={600}
                      value={form.autoCallbackDelaySeconds ?? 60}
                      onChange={e => patch({ autoCallbackDelaySeconds: parseInt(e.target.value, 10) })}
                      className="bg-zinc-800 border-zinc-700 text-sm h-8"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* CONVERSATION */}
        <div>
          <SectionLabel>Conversation</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">Greeting Message</label>
              <Textarea
                value={form.greetingMessage ?? ""}
                onChange={e => patch({ greetingMessage: e.target.value })}
                placeholder="Namaste! Main aapka insurance assistant hun. Kaise help kar sakta hun?"
                className="bg-zinc-900 border-zinc-700 text-sm resize-none"
                rows={3}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">End-Call Phrases <span className="text-zinc-600">(comma-separated)</span></label>
              <Input
                value={form.endCallPhrases ?? ""}
                onChange={e => patch({ endCallPhrases: e.target.value })}
                placeholder="goodbye, bye, shukriya, alvida"
                className="bg-zinc-900 border-zinc-700 text-sm h-9 mb-3"
              />
              <label className="text-xs text-zinc-400 mb-1.5 block">Inactivity Message</label>
              <Input
                value={form.inactivityMessage ?? ""}
                onChange={e => patch({ inactivityMessage: e.target.value })}
                placeholder="Koi sawaal? Warna main call disconnect karta hun…"
                className="bg-zinc-900 border-zinc-700 text-sm h-9"
              />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
              <ToggleRow
                label="Backchanneling"
                description={'Agent says "I see", "Okay" etc. while the caller speaks'}
                value={form.backchannelingEnabled ?? true}
                onChange={v => patch({ backchannelingEnabled: v })}
              />
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
              <ToggleRow
                label="Noise Cancellation"
                description="Request noise reduction from the STT provider"
                value={form.noiseCancellationEnabled ?? true}
                onChange={v => patch({ noiseCancellationEnabled: v })}
              />
            </div>
          </div>
        </div>

        {/* BARGE-IN (VAD) */}
        <div>
          <SectionLabel>Barge-in / VAD</SectionLabel>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
            <ToggleRow
              label="Allow Barge-in"
              description="Caller can interrupt the agent mid-speech"
              value={form.bargeInEnabled ?? true}
              onChange={v => patch({ bargeInEnabled: v })}
            />
          </div>
        </div>

        {/* SYSTEM PROMPT (collapsible) */}
        <div>
          <button
            type="button"
            className="flex items-center gap-2 mb-3 w-full"
            onClick={() => setShowPrompt(v => !v)}
          >
            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">System Prompt</span>
            <div className="flex-1 h-px bg-zinc-800" />
            {showPrompt ? <ChevronUp className="h-3.5 w-3.5 text-zinc-500" /> : <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />}
          </button>
          {showPrompt && (
            <Textarea
              value={form.systemPrompt}
              onChange={e => patch({ systemPrompt: e.target.value })}
              className="bg-zinc-900 border-zinc-700 text-sm font-mono resize-y min-h-[180px]"
              rows={8}
              placeholder="You are a helpful AI voice assistant…"
            />
          )}
        </div>

        {/* WEBHOOK */}
        <div>
          <button
            type="button"
            className="flex items-center gap-2 mb-3 w-full"
            onClick={() => setShowAdvanced(v => !v)}
          >
            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">Webhook &amp; Advanced</span>
            <div className="flex-1 h-px bg-zinc-800" />
            {showAdvanced ? <ChevronUp className="h-3.5 w-3.5 text-zinc-500" /> : <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />}
          </button>
          {showAdvanced && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400 mb-1.5 block">Post-Call Webhook URL</label>
                <Input
                  value={form.webhookUrl ?? ""}
                  onChange={e => patch({ webhookUrl: e.target.value })}
                  placeholder="https://your-server.com/webhook"
                  className="bg-zinc-900 border-zinc-700 text-sm h-9"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1.5 block">Webhook Secret</label>
                <Input
                  type="password"
                  value={form.webhookSecret ?? ""}
                  onChange={e => patch({ webhookSecret: e.target.value })}
                  placeholder="HMAC signing secret"
                  className="bg-zinc-900 border-zinc-700 text-sm h-9"
                />
              </div>
            </div>
          )}
        </div>

        {/* COST */}
        <div>
          <SectionLabel>Cost Estimate</SectionLabel>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 flex items-center gap-4 flex-wrap">
            <div>
              <span className="text-2xl font-bold text-zinc-100">~${cost.total.toFixed(3)}</span>
              <span className="text-zinc-500 text-sm">/min</span>
            </div>
            <div className="flex-1 flex items-center gap-3 flex-wrap text-xs text-zinc-500">
              {cost.asr > 0 && <span>+ ASR ${cost.asr.toFixed(3)}</span>}
              {cost.llm > 0 && <span>+ LLM ${cost.llm.toFixed(3)}</span>}
              {cost.tts > 0 && <span>+ TTS ${cost.tts.toFixed(3)}</span>}
              {cost.tel > 0 && <span>+ Tel ${cost.tel.toFixed(3)}</span>}
              <span>+ Fee ${cost.fee.toFixed(3)}</span>
            </div>
          </div>
        </div>

        {/* Danger Zone */}
        {!isNew && (
          <div className="pb-4">
            <SectionLabel>Danger Zone</SectionLabel>
            <button
              type="button"
              onClick={handleDelete}
              className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1.5 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete Assistant
            </button>
          </div>
        )}

      </div>{/* end scroll area */}

      {/* Bottom action bar */}
      {isNew && (
        <div className="shrink-0 border-t border-zinc-800 px-6 py-4 flex items-center justify-end gap-3">
          <p className="text-xs text-zinc-500 mr-auto">Saved as <strong>Draft</strong> — advance through the pipeline to publish.</p>
          <Button
            onClick={handleCreate}
            disabled={!form.name.trim()}
            className="gap-2"
          >
            <Check className="h-4 w-4" /> Create Assistant
          </Button>
        </div>
      )}
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────────────────── */

export default function FamilyAgentsPage({ params }: { params?: { id?: string } }) {
  const { agents, isLoaded } = useFamilyStore();
  const [, navigate] = useLocation();
  const [selectedId, setSelectedId] = useState<string | null>(params?.id ?? null);
  const [isCreating, setIsCreating] = useState(params?.id === "new" || (!params?.id && false));
  const [search, setSearch] = useState("");

  const filtered = agents.filter(a => {
    const q = search.toLowerCase();
    return a.name.toLowerCase().includes(q) || a.companyName.toLowerCase().includes(q) || (a.policyName ?? "").toLowerCase().includes(q);
  });

  function openNew() { setSelectedId(null); setIsCreating(true); }
  function selectAgent(id: string) { setSelectedId(id); setIsCreating(false); }
  function handleCreated(a: InsuranceAgent) { setIsCreating(false); setSelectedId(a.id); }
  function handleDeleted(_id: string) { setSelectedId(null); setIsCreating(false); }

  const showRight = isCreating || selectedId !== null;

  return (
    <div className="flex h-[calc(100vh-112px)] -mt-8 -mx-8 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      {/* ── Left Sidebar ─────────────────────────────── */}
      <div className="w-64 flex flex-col border-r border-zinc-800 bg-zinc-950 shrink-0">
        {/* sidebar header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-100">Assistants</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 min-w-[20px] text-center">
              {isLoaded ? agents.length : "…"}
            </span>
          </div>
          <button
            onClick={openNew}
            className="h-6 w-6 rounded-md bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 border border-zinc-700 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* create button */}
        <div className="px-3 py-2.5 border-b border-zinc-800/60">
          <button
            onClick={openNew}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900 text-zinc-500 hover:text-zinc-300 text-xs font-medium transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Create Assistant
          </button>
        </div>

        {/* search */}
        <div className="px-3 py-2.5 border-b border-zinc-800/60">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600" />
            <Input
              placeholder="Search assistants…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-7 bg-zinc-900 border-zinc-800 text-xs placeholder:text-zinc-600"
            />
          </div>
        </div>

        {/* list */}
        <div className="flex-1 overflow-y-auto py-1">
          {!isLoaded ? (
            <p className="text-xs text-zinc-600 px-4 py-3">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <Bot className="h-7 w-7 text-zinc-700 mx-auto mb-2" />
              <p className="text-xs text-zinc-600">
                {agents.length === 0 ? "No assistants yet." : "Nothing matches."}
              </p>
            </div>
          ) : (
            filtered.map(agent => {
              const isActive = selectedId === agent.id && !isCreating;
              const tags = [agent.asrProvider, agent.llmProvider, agent.ttsProvider].filter(Boolean).map(t => t!.split("_")[0]);
              return (
                <button
                  key={agent.id}
                  onClick={() => selectAgent(agent.id)}
                  className={`w-full text-left px-3 py-2.5 transition-colors ${
                    isActive ? "bg-zinc-800" : "hover:bg-zinc-900"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT[agent.status]}`} />
                    <span className="text-sm font-medium text-zinc-200 truncate">{agent.name}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 ml-3.5">
                    {tags.map(tag => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700">
                        {tag}
                      </span>
                    ))}
                    {agent.crossCallMemoryEnabled && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-400 border border-purple-800/30">
                        memory
                      </span>
                    )}
                    {agent.autoCallbackEnabled && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-400 border border-blue-800/30">
                        callback
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right Panel ──────────────────────────────── */}
      {showRight ? (
        <AgentPanel
          key={isCreating ? "new" : selectedId!}
          agentId={isCreating ? null : selectedId}
          isNew={isCreating}
          onCreated={handleCreated}
          onDeleted={handleDeleted}
        />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center bg-zinc-950">
          <div className="h-16 w-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
            <Bot className="h-7 w-7 text-zinc-600" />
          </div>
          <div>
            <p className="text-base font-semibold text-zinc-300">Select an assistant</p>
            <p className="text-sm text-zinc-600 mt-1">or create a new one</p>
          </div>
          <button
            onClick={openNew}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium border border-zinc-700 transition-colors"
          >
            <Plus className="h-4 w-4" /> Create Assistant
          </button>
        </div>
      )}
    </div>
  );
}
