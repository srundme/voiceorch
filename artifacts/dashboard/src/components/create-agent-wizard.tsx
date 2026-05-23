import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@clerk/react";
import { useCreateAgent, getListAgentsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Users, Target, Rocket, ShoppingCart, Headphones, Bell,
  Megaphone, Building2, BarChart2, Package, Wand2, Globe,
  ChevronLeft, ChevronRight, Check, X, Loader2, Sparkles,
  Play, Pause, Volume2, Upload, FileText, PhoneForwarded,
  Languages, SkipForward,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";

/* ── Use-case catalogue ─────────────────────────────────────────────────── */
const USE_CASES = [
  { id: "recruitment",      label: "Recruitment Agent",     desc: "Screen, interview, and onboard candidates",              role: "recruitment specialist",             service: "candidate screening and recruitment",                icon: Users },
  { id: "lead_qual",        label: "Lead Qualification",    desc: "Qualify leads and warm-introduce your business",          role: "sales representative",               service: "lead qualification and sales outreach",              icon: Target },
  { id: "onboarding",       label: "Onboarding Agent",      desc: "Conduct personalized onboarding calls",                   role: "onboarding specialist",              service: "customer onboarding and guidance",                   icon: Rocket },
  { id: "cart_abandon",     label: "Cart Abandonment",      desc: "Recover abandoned carts with outbound calls",             role: "customer success representative",     service: "cart recovery and sales",                            icon: ShoppingCart },
  { id: "customer_support", label: "Customer Support",      desc: "24/7 inbound call answering for FAQs",                    role: "customer support agent",             service: "customer support and issue resolution",              icon: Headphones },
  { id: "reminder",         label: "Reminder Agent",        desc: "Automate EMI, collection, and deadline reminders",        role: "reminder and collections specialist", service: "payment reminders and collections follow-up",        icon: Bell },
  { id: "announcement",     label: "Announcement Agent",    desc: "Engage users with product upgrades and launches",         role: "product announcements specialist",    service: "product updates and feature announcements",          icon: Megaphone },
  { id: "front_desk",       label: "Front Desk Agent",      desc: "Handle clinic, hotel, and office scheduling",             role: "front desk receptionist",            service: "scheduling and appointment management",              icon: Building2 },
  { id: "survey",           label: "Survey Agent",          desc: "Automated NPS, feedback and product surveys",             role: "survey and feedback specialist",      service: "customer feedback and NPS surveys",                  icon: BarChart2 },
  { id: "cod_confirm",      label: "COD Confirmation",      desc: "Handle last-mile logistics and delivery confirmation",     role: "logistics confirmation specialist",   service: "COD order confirmation and last-mile logistics",     icon: Package },
];

/* ── Language catalogue ─────────────────────────────────────────────────── */
const LANGUAGES = [
  { code: "english",   label: "English",   flag: "🇬🇧" },
  { code: "hindi",     label: "Hindi",     flag: "🇮🇳" },
  { code: "tamil",     label: "Tamil",     flag: "🇮🇳" },
  { code: "telugu",    label: "Telugu",    flag: "🇮🇳" },
  { code: "kannada",   label: "Kannada",   flag: "🇮🇳" },
  { code: "marathi",   label: "Marathi",   flag: "🇮🇳" },
  { code: "gujarati",  label: "Gujarati",  flag: "🇮🇳" },
  { code: "bengali",   label: "Bengali",   flag: "🇮🇳" },
  { code: "malayalam", label: "Malayalam", flag: "🇮🇳" },
];

/* ── Managed stack ──────────────────────────────────────────────────────── */
/* Maps wizard language codes → BCP-47 codes stored on the agent */
/* language → BCP-47 code sent to ASR/TTS engine */
const LANG_CODE_MAP: Record<string, string> = {
  english: "en-US", hindi: "hi", tamil: "ta", telugu: "te",
  kannada: "kn", marathi: "mr", gujarati: "gu", bengali: "bn", malayalam: "ml",
};
/* language → asrLanguage code matching the Audio-tab dropdown options */
const ASR_LANG_CODE_MAP: Record<string, string> = {
  english: "en", hindi: "hi", tamil: "ta-IN", telugu: "te-IN",
  kannada: "kn-IN", marathi: "mr-IN", gujarati: "gu-IN", bengali: "bn-IN", malayalam: "ml-IN",
};

function getManagedStack(languages: string[]) {
  const hasTamil = languages.includes("tamil");
  const hasIndic = languages.some(l => ["hindi","telugu","kannada","marathi","gujarati","bengali","malayalam"].includes(l));
  return {
    asrProvider:       (hasTamil || hasIndic) ? "sarvam" : "deepgram",
    asrModel:          (hasTamil || hasIndic) ? "saarika:v2.5" : "nova-2-general",
    llmProvider:       (hasTamil || hasIndic) ? "google" : "sarvam",
    llmModel:          (hasTamil || hasIndic) ? "gemini-2.5-flash" : "sarvam-m",
    ttsProvider:       (hasTamil || hasIndic) ? "sarvam" : "cartesia",
    ttsModel:          (hasTamil || hasIndic) ? "bulbul:v2" : "sonic-3",
    telephonyProvider: "vobiz",
  };
}

/* ── Default Arushi voice ───────────────────────────────────────────────── */
const ARUSHI_VOICE = {
  id: "2ee87190-8f84-4925-97da-e52547f9462c",
  name: "Arushi",
  gender: "Female",
  language: "en",
  description: "Warm Indian English female — Cartesia",
};

// Only Arushi is a confirmed real Cartesia Indian voice — all others load from the API
const FALLBACK_VOICES = [ARUSHI_VOICE];

const LANG_LABEL: Record<string, string> = {
  hi: "Hindi", ta: "Tamil", te: "Telugu", kn: "Kannada",
  ml: "Malayalam", bn: "Bengali", mr: "Marathi", gu: "Gujarati",
  pa: "Punjabi", "en-IN": "English · IN", en: "English",
};

/* ── Types ──────────────────────────────────────────────────────────────── */
interface CartesiaVoice { id: string; name: string; gender: string; description: string; language?: string }
type AgentDirection = "inbound" | "outbound" | "both";

interface WizardState {
  mode: "byop" | "managed" | null;
  useCase: string; useCaseRole: string; useCaseService: string;
  isMultilingual: boolean; primaryLanguage: string; additionalLanguages: string[];
  agentName: string; companyName: string; agentDirection: AgentDirection;
  callFlowDescription: string; generatedPrompt: string;
  kbContent: string; kbFileName: string;
  voices: CartesiaVoice[]; selectedVoiceId: string;
  callTransferEnabled: boolean; callTransferNumber: string;
  byopAsr: string; byopLlm: string; byopTts: string; byopTelephony: string; byopPrompt: string;
}

const INITIAL: WizardState = {
  mode: null, useCase: "", useCaseRole: "", useCaseService: "",
  isMultilingual: false, primaryLanguage: "english", additionalLanguages: [],
  agentName: "", companyName: "", agentDirection: "inbound",
  callFlowDescription: "", generatedPrompt: "",
  kbContent: "", kbFileName: "",
  voices: FALLBACK_VOICES, selectedVoiceId: ARUSHI_VOICE.id,
  callTransferEnabled: false, callTransferNumber: "",
  byopAsr: "deepgram", byopLlm: "openai", byopTts: "elevenlabs", byopTelephony: "twilio",
  byopPrompt: "You are a helpful AI voice assistant. Be concise and professional.",
};

/* ── Voice preview ──────────────────────────────────────────────────────── */
const PREVIEW_TEXT = "Hello! I am your AI voice assistant. I am here to help you today. How can I assist you?";

/** Browser speechSynthesis fallback — picks a voice that roughly matches gender */
function speakWithBrowser(voiceName: string, gender: string, onEnd: () => void) {
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(PREVIEW_TEXT);
  const voices = window.speechSynthesis.getVoices();
  const femaleKeywords = ["female", "woman", "girl", "zira", "samantha", "victoria", "moira", "fiona", "veena"];
  const maleKeywords   = ["male", "man", "daniel", "alex", "tom", "fred", "lee"];
  const isFemale = gender.toLowerCase() === "female";
  const match = voices.find(v => {
    const n = v.name.toLowerCase();
    return isFemale ? femaleKeywords.some(k => n.includes(k)) : maleKeywords.some(k => n.includes(k));
  }) ?? voices[0];
  if (match) utter.voice = match;
  utter.rate  = 0.95;
  utter.pitch = isFemale ? 1.1 : 0.9;
  utter.onend = onEnd;
  utter.onerror = onEnd;
  window.speechSynthesis.speak(utter);
}

function useVoicePreview(apiFetch: (path: string, init?: RequestInit) => Promise<Response>) {
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voicesRef = useRef<CartesiaVoice[]>([]);

  // keep a ref of current voices so the closure can access gender
  function setVoicesRef(voices: CartesiaVoice[]) { voicesRef.current = voices; }

  async function preview(voiceId: string) {
    // stop if already playing
    if (playing === voiceId) {
      audioRef.current?.pause();
      window.speechSynthesis.cancel();
      setPlaying(null);
      return;
    }
    setPlaying(voiceId);

    try {
      const res = await apiFetch("/api/wizard/preview-voice", {
        method: "POST",
        body: JSON.stringify({ voiceId, text: PREVIEW_TEXT }),
      });

      if (res.ok) {
        // Server sends raw audio/wav bytes — use blob() not json()
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (audioRef.current) { audioRef.current.pause(); URL.revokeObjectURL(audioRef.current.src); }
        const el = new Audio(url);
        audioRef.current = el;
        el.onended = () => { setPlaying(null); URL.revokeObjectURL(url); };
        el.onerror = () => { setPlaying(null); URL.revokeObjectURL(url); };
        void el.play();
        return;
      }

      if (res.status === 503) {
        // Cartesia key not configured — fall back to browser TTS with a clear indication
        setPlaying(null);
        const voice = voicesRef.current.find(v => v.id === voiceId);
        speakWithBrowser(voice?.name ?? "", voice?.gender ?? "Female", () => setPlaying(null));
        return;
      }

      setPlaying(null);
    } catch {
      setPlaying(null);
    }
  }

  return { playing, preview, setVoicesRef };
}

/* ── Step definitions ───────────────────────────────────────────────────── */
const MANAGED_STEPS = [
  "use-case", "language", "details", "requirements", "knowledge", "voice", "skills",
] as const;
type ManagedStep = typeof MANAGED_STEPS[number];

const STEP_LABELS: Record<ManagedStep, string> = {
  "use-case": "Use Case", language: "Language", details: "Agent Details",
  requirements: "Requirements", knowledge: "Knowledge Base", voice: "Voice", skills: "Skills & Finish",
};

/* ── Animated step wrapper ──────────────────────────────────────────────── */
function SlideStep({ children, direction }: { children: React.ReactNode; direction: "forward" | "back" }) {
  const cls = direction === "forward"
    ? "animate-[slideInRight_0.35s_cubic-bezier(.22,1,.36,1)]"
    : "animate-[slideInLeft_0.35s_cubic-bezier(.22,1,.36,1)]";
  return <div className={cn("w-full", cls)}>{children}</div>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN WIZARD
═══════════════════════════════════════════════════════════════════════════ */
interface Props { open: boolean; onClose: () => void; onCreated: (id: number) => void }

export function CreateAgentWizard({ open, onClose, onCreated }: Props) {
  const [state, setState]             = useState<WizardState>(INITIAL);
  const [stepIdx, setStepIdx]         = useState(0);
  const [direction, setDirection]     = useState<"forward" | "back">("forward");
  const [isGenerating, setGenerating] = useState(false);
  const [generateError, setGenError]  = useState("");
  const [loadingVoices, setLoadVoices]= useState(false);
  const [voiceSource, setVoiceSource] = useState<"cartesia" | "browser">("browser");
  const [renderKey, setRenderKey]     = useState(0);
  const fileInputRef                  = useRef<HTMLInputElement>(null);
  const { toast }                     = useToast();
  const qc                            = useQueryClient();
  const create                        = useCreateAgent();
  const { getToken }                  = useAuth();

  /* Authenticated fetch — mirrors the custom-fetch bearer token pattern */
  const apiFetch = useCallback(async (path: string, init?: RequestInit): Promise<Response> => {
    const token = await getToken();
    const headers = new Headers(init?.headers);
    headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(path, { ...init, headers, credentials: "include" });
  }, [getToken]);

  const { playing, preview, setVoicesRef } = useVoicePreview(apiFetch);

  const update = useCallback((patch: Partial<WizardState>) => setState(p => ({ ...p, ...patch })), []);

  /* keep voicesRef in sync so the preview hook can look up gender */
  useEffect(() => { setVoicesRef(state.voices); }, [state.voices]);

  /* close & reset */
  function handleClose() { setState(INITIAL); setStepIdx(0); create.reset(); onClose(); }

  /* keyboard: Esc */
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  /* fetch Cartesia voices once */
  async function loadVoices() {
    if (state.voices.length > FALLBACK_VOICES.length) return;
    setLoadVoices(true);
    try {
      const res = await apiFetch("/api/wizard/voices", { method: "GET" });
      if (res.ok) {
        const { voices, source } = await res.json() as { voices: CartesiaVoice[]; source: string };
        // put Arushi first if present, otherwise prepend fallback Arushi
        const arushi = voices.find(v => v.name.toLowerCase().includes("arushi")) ?? ARUSHI_VOICE;
        const rest   = voices.filter(v => v.id !== arushi.id);
        const merged = [arushi, ...rest];
        update({ voices: merged, selectedVoiceId: arushi.id });
        setVoiceSource(source === "cartesia" ? "cartesia" : "browser");
      }
    } finally { setLoadVoices(false); }
  }

  /* navigate */
  function go(delta: 1 | -1) {
    setDirection(delta === 1 ? "forward" : "back");
    setStepIdx(i => i + delta);
    setRenderKey(k => k + 1);
    if (delta === 1 && state.mode === "managed" && MANAGED_STEPS[stepIdx + 1] === "voice") {
      void loadVoices();
    }
  }

  /* AI prompt generation — auto-advances to next step on success */
  async function generatePrompt() {
    setGenerating(true);
    setGenError("");
    try {
      const langs = [state.primaryLanguage, ...state.additionalLanguages];
      const res = await apiFetch("/api/wizard/generate-prompt", {
        method: "POST",
        body: JSON.stringify({
          useCase: state.useCase, role: state.useCaseRole, companyName: state.companyName,
          agentName: state.agentName, serviceDescription: state.useCaseService,
          agentDirection: state.agentDirection, callFlowDescription: state.callFlowDescription,
          languages: langs,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? `HTTP ${res.status}`);
      }
      const { prompt } = await res.json();
      update({ generatedPrompt: prompt });
      // Auto-advance to Knowledge Base step
      setDirection("forward");
      setStepIdx(i => i + 1);
      setRenderKey(k => k + 1);
    } catch (err: any) {
      setGenError(err?.message ?? "Generation failed — you can still continue manually.");
    } finally { setGenerating(false); }
  }

  /* file read */
  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = e => update({ kbContent: e.target?.result as string, kbFileName: file.name });
    reader.readAsText(file);
  }

  /* create agent */
  async function handleCreate() {
    const isManaged = state.mode === "managed";
    const langs  = [state.primaryLanguage, ...state.additionalLanguages];
    const stack  = getManagedStack(langs);

    const payload = isManaged ? {
      name: state.agentName || `${STEP_LABELS["use-case"]} Agent`,
      language: LANG_CODE_MAP[state.primaryLanguage] ?? "en-US",
      asrLanguage: ASR_LANG_CODE_MAP[state.primaryLanguage] ?? "en",
      asrProvider: stack.asrProvider, asrModel: stack.asrModel,
      llmProvider: stack.llmProvider, llmModel: stack.llmModel,
      ttsProvider: stack.ttsProvider, ttsModel: stack.ttsModel,
      ttsVoice: state.selectedVoiceId || ARUSHI_VOICE.id,
      telephonyProvider: stack.telephonyProvider,
      systemPrompt: state.generatedPrompt || state.callFlowDescription || "You are a helpful AI voice assistant.",
      maxDuration: 600,
      agentConfig: {
        summarizationEnabled: true,
        summarizationPrompt: "Summarize this call in 3 bullet points: 1) caller intent, 2) key information exchanged, 3) outcome or next step.",
      } as any,
      tools: state.callTransferEnabled && state.callTransferNumber.trim()
        ? [{ type: "call_transfer", name: "transfer_to_human", description: "Transfer the call to a human agent when the caller requests it or when escalation is needed.", transferTo: state.callTransferNumber.trim() }]
        : [],
    } : {
      name: state.agentName || "New Assistant",
      asrProvider: state.byopAsr, llmProvider: state.byopLlm,
      ttsProvider: state.byopTts, telephonyProvider: state.byopTelephony,
      systemPrompt: state.byopPrompt, maxDuration: 300,
    };

    create.mutate({ data: payload as any }, {
      onSuccess: (created) => {
        qc.invalidateQueries({ queryKey: getListAgentsQueryKey() });
        toast({ title: `${created.name} is ready!` });
        setState(INITIAL); setStepIdx(0);
        onCreated(created.id);
      },
      onError: () => { toast({ title: "Create failed", variant: "destructive" }); },
    });
  }

  if (!open) return null;

  const currentStep: ManagedStep | null = state.mode === "managed" ? (MANAGED_STEPS[stepIdx] ?? null) : null;
  const totalManagedSteps = MANAGED_STEPS.length;
  const progress = state.mode === "managed"
    ? ((stepIdx + 1) / totalManagedSteps) * 100
    : state.mode === "byop" ? 100 : 0;

  /* ────────────────────────────────────────────────────────────────────── */
  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-white flex flex-col overflow-hidden">

      {/* CSS keyframes injection */}
      <style>{`
        @keyframes slideInRight { from { opacity:0; transform:translateX(48px); } to { opacity:1; transform:translateX(0); } }
        @keyframes slideInLeft  { from { opacity:0; transform:translateX(-48px); } to { opacity:1; transform:translateX(0); } }
        @keyframes fadeUp       { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      {/* Progress bar */}
      <div className="h-0.5 bg-gray-100 shrink-0">
        <div
          className="h-full bg-gradient-to-r from-violet-500 to-indigo-400 transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Top bar */}
      <div className="flex items-center justify-between px-8 pt-5 pb-3 shrink-0">
        <div className="flex items-center gap-3">
          {(state.mode !== null) && (
            <button
              onClick={() => {
                if (state.mode === "managed" && stepIdx > 0) go(-1);
                else { setState(INITIAL); setStepIdx(0); setRenderKey(k => k + 1); }
              }}
              className="flex items-center gap-1.5 text-gray-400 hover:text-gray-700 transition-colors text-sm"
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </button>
          )}
        </div>

        <div className="flex items-center gap-4">
          {state.mode === "managed" && currentStep && (
            <span className="text-gray-400 text-xs font-mono tracking-widest uppercase">
              {String(stepIdx + 1).padStart(2, "0")} / {String(totalManagedSteps).padStart(2, "0")} — {STEP_LABELS[currentStep]}
            </span>
          )}
          <button onClick={handleClose} className="h-8 w-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 hover:text-gray-700 transition-all">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="w-full max-w-2xl mx-auto min-h-full flex flex-col justify-center">
          <SlideStep key={`${state.mode}-${stepIdx}-${renderKey}`} direction={direction}>

            {/* ── Mode selection ── */}
            {state.mode === null && (
              <div className="animate-[fadeUp_0.4s_ease-out]">
                <p className="text-gray-400 text-xs uppercase tracking-[0.2em] mb-3">Get started</p>
                <h1 className="text-4xl font-bold text-gray-900 mb-2 leading-tight">How do you want to<br />build your agent?</h1>
                <p className="text-gray-400 text-base mb-10">Choose your setup mode — you can always change provider settings later.</p>

                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => { update({ mode: "managed" }); setDirection("forward"); setRenderKey(k => k + 1); }}
                    className="group relative text-left p-6 rounded-2xl border border-gray-200 bg-gray-50 hover:bg-gray-100 hover:border-violet-500/60 transition-all duration-200"
                  >
                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-100/60 to-indigo-50/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="relative">
                      <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center mb-4 shadow-lg shadow-violet-500/30">
                        <Wand2 className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="font-bold text-gray-900 text-lg">Managed</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-600 font-semibold border border-violet-300">Recommended</span>
                      </div>
                      <p className="text-gray-500 text-sm leading-relaxed">We handle the full AI stack. Just describe what your agent should do.</p>
                      <div className="mt-4 flex items-center gap-1.5 text-violet-600 text-sm font-medium group-hover:gap-2.5 transition-all">
                        Get started <ChevronRight className="h-4 w-4" />
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => { update({ mode: "byop" }); setDirection("forward"); setRenderKey(k => k + 1); }}
                    className="group relative text-left p-6 rounded-2xl border border-gray-200 bg-gray-50 hover:bg-gray-100 hover:border-gray-300 transition-all duration-200"
                  >
                    <div className="relative">
                      <div className="h-11 w-11 rounded-xl bg-gray-100 flex items-center justify-center mb-4">
                        <Globe className="h-5 w-5 text-gray-600" />
                      </div>
                      <div className="mb-1.5">
                        <span className="font-bold text-gray-900 text-lg">BYOP</span>
                        <span className="ml-2 text-gray-400 text-sm">Bring Your Own Providers</span>
                      </div>
                      <p className="text-gray-500 text-sm leading-relaxed">Choose your own ASR, LLM, TTS and telephony. Full control.</p>
                      <div className="mt-4 flex items-center gap-1.5 text-gray-400 text-sm font-medium group-hover:gap-2.5 transition-all">
                        Configure manually <ChevronRight className="h-4 w-4" />
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* ════════════════════════════════════════════
                MANAGED STEPS
            ════════════════════════════════════════════ */}

            {/* Step 1: Use Case */}
            {currentStep === "use-case" && (
              <div>
                <p className="text-gray-400 text-xs uppercase tracking-[0.2em] mb-3">Step 1</p>
                <h2 className="text-3xl font-bold text-gray-900 mb-2">What type of agent<br />do you need?</h2>
                <p className="text-gray-400 text-sm mb-8">Select the use case that best matches your goal.</p>

                <div className="grid grid-cols-2 gap-2.5">
                  {USE_CASES.map(uc => {
                    const Icon = uc.icon;
                    const sel  = state.useCase === uc.id;
                    return (
                      <button
                        key={uc.id}
                        onClick={() => { update({ useCase: uc.id, useCaseRole: uc.role, useCaseService: uc.service }); }}
                        className={cn(
                          "text-left p-4 rounded-xl border transition-all duration-200 flex items-center gap-3 group",
                          sel
                            ? "border-violet-400 bg-violet-50 shadow-[0_0_0_1px_rgba(99,102,241,0.3)]"
                            : "border-gray-200 bg-gray-50 hover:border-gray-200 hover:bg-gray-50",
                        )}
                      >
                        <div className={cn(
                          "h-9 w-9 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                          sel ? "bg-violet-500 text-white" : "bg-gray-100 text-gray-500",
                        )}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className={cn("font-semibold text-sm", sel ? "text-gray-900" : "text-gray-600")}>{uc.label}</div>
                          <div className="text-xs text-gray-400 mt-0.5 leading-tight truncate">{uc.desc}</div>
                        </div>
                        {sel && <Check className="h-4 w-4 text-violet-600 shrink-0 ml-auto" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 2: Language */}
            {currentStep === "language" && (
              <div>
                <p className="text-gray-400 text-xs uppercase tracking-[0.2em] mb-3">Step 2</p>
                <h2 className="text-3xl font-bold text-gray-900 mb-2">What language will<br />your agent speak?</h2>
                <p className="text-gray-400 text-sm mb-8">English is always available. Add regional languages for Indian markets.</p>

                <div className="flex gap-3 mb-6">
                  {[
                    { value: false, label: "Single language",  sub: "One language only" },
                    { value: true,  label: "Multilingual",     sub: "English + up to 2 regional" },
                  ].map(opt => {
                    const sel = state.isMultilingual === opt.value;
                    return (
                      <button
                        key={String(opt.value)}
                        onClick={() => update({ isMultilingual: opt.value, additionalLanguages: [] })}
                        className={cn(
                          "flex-1 p-4 rounded-xl border transition-all flex items-start gap-3",
                          sel ? "border-violet-400 bg-violet-50" : "border-gray-200 bg-gray-50 hover:border-gray-200",
                        )}
                      >
                        {opt.value ? <Languages className={cn("h-5 w-5 mt-0.5 shrink-0", sel ? "text-violet-600" : "text-gray-400")} /> : <Volume2 className={cn("h-5 w-5 mt-0.5 shrink-0", sel ? "text-violet-600" : "text-gray-400")} />}
                        <div className="text-left">
                          <div className={cn("font-semibold text-sm", sel ? "text-gray-900" : "text-gray-500")}>{opt.label}</div>
                          <div className="text-xs text-gray-400 mt-0.5">{opt.sub}</div>
                        </div>
                        {sel && <Check className="h-4 w-4 text-violet-600 ml-auto mt-0.5" />}
                      </button>
                    );
                  })}
                </div>

                <p className="text-gray-400 text-xs uppercase tracking-[0.15em] mb-3">{state.isMultilingual ? "Primary language" : "Select language"}</p>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {LANGUAGES.map(lang => {
                    const sel = state.primaryLanguage === lang.code;
                    return (
                      <button
                        key={lang.code}
                        onClick={() => update({ primaryLanguage: lang.code })}
                        className={cn(
                          "p-3 rounded-xl border flex items-center gap-2.5 transition-all",
                          sel ? "border-violet-400 bg-violet-50" : "border-gray-200 bg-gray-50 hover:border-gray-200",
                        )}
                      >
                        <span className="text-lg">{lang.flag}</span>
                        <span className={cn("font-medium text-sm", sel ? "text-gray-900" : "text-gray-500")}>{lang.label}</span>
                        {sel && <Check className="h-3.5 w-3.5 text-violet-600 ml-auto" />}
                      </button>
                    );
                  })}
                </div>

                {state.isMultilingual && (
                  <>
                    <p className="text-gray-400 text-xs uppercase tracking-[0.15em] mb-3">Additional regional languages <span className="text-gray-300 normal-case">(up to 2)</span></p>
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      {LANGUAGES.filter(l => l.code !== state.primaryLanguage && l.code !== "english").map(lang => {
                        const sel   = state.additionalLanguages.includes(lang.code);
                        const maxed = state.additionalLanguages.length >= 2 && !sel;
                        return (
                          <button
                            key={lang.code}
                            disabled={maxed}
                            onClick={() => {
                              const next = sel
                                ? state.additionalLanguages.filter(c => c !== lang.code)
                                : [...state.additionalLanguages, lang.code];
                              update({ additionalLanguages: next });
                            }}
                            className={cn(
                              "p-3 rounded-xl border flex items-center gap-2.5 transition-all",
                              sel    ? "border-violet-400 bg-violet-50"
                              : maxed ? "border-gray-100 opacity-30 cursor-not-allowed"
                              : "border-gray-200 bg-gray-50 hover:border-gray-200",
                            )}
                          >
                            <span className="text-lg">{lang.flag}</span>
                            <span className={cn("font-medium text-sm", sel ? "text-gray-900" : "text-gray-500")}>{lang.label}</span>
                            {sel && <Check className="h-3.5 w-3.5 text-violet-600 ml-auto" />}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* Stack info */}
                {(() => {
                  const langs = [state.primaryLanguage, ...state.additionalLanguages];
                  const stack = getManagedStack(langs);
                  const hasTamil = langs.includes("tamil");
                  const hasIndic = langs.some(l => ["hindi","telugu","kannada","marathi","gujarati","bengali","malayalam"].includes(l));
                  return (
                    <div className="p-4 rounded-xl border border-gray-200 bg-gray-50">
                      <p className="text-gray-400 text-xs uppercase tracking-[0.15em] mb-2">Auto-selected AI stack</p>
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { l: "STT",  v: stack.asrProvider,       note: hasTamil ? "Tamil optimised" : "" },
                          { l: "LLM",  v: (hasTamil || hasIndic) ? "Gemini 2.5 Flash" : "Sarvam M1", note: (hasTamil || hasIndic) ? "Multilingual & fast" : "Indian language optimised" },
                          { l: "TTS",  v: (hasTamil || hasIndic) ? "Sarvam Bulbul" : "Cartesia Sonic", note: (hasTamil || hasIndic) ? "Native Indic voices" : "" },
                          { l: "TEL",  v: stack.telephonyProvider,  note: "" },
                        ].map(item => (
                          <div key={item.l} className="text-center p-2.5 rounded-lg bg-gray-50 border border-gray-100">
                            <div className="text-gray-400 text-[9px] uppercase tracking-widest">{item.l}</div>
                            <div className="text-gray-700 text-xs font-semibold capitalize mt-0.5">{item.v}</div>
                            {item.note && <div className="text-violet-600/70 text-[9px] mt-0.5">{item.note}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Step 3: Agent Details */}
            {currentStep === "details" && (
              <div>
                <p className="text-gray-400 text-xs uppercase tracking-[0.2em] mb-3">Step 3</p>
                <h2 className="text-3xl font-bold text-gray-900 mb-2">Tell us about<br />your agent</h2>
                <p className="text-gray-400 text-sm mb-8">Basic details that personalise the agent's identity.</p>

                <div className="space-y-5">
                  <div>
                    <label className="text-gray-500 text-xs uppercase tracking-[0.15em] block mb-2">Agent's name</label>
                    <input
                      type="text"
                      placeholder="e.g. Arushi, Priya, Alex"
                      value={state.agentName}
                      onChange={e => update({ agentName: e.target.value })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3.5 text-gray-900 text-base placeholder:text-gray-300 focus:outline-none focus:border-violet-500/60 focus:bg-gray-100 transition-all"
                    />
                  </div>
                  <div>
                    <label className="text-gray-500 text-xs uppercase tracking-[0.15em] block mb-2">Company name</label>
                    <input
                      type="text"
                      placeholder="e.g. QuickPay, Acme Corp"
                      value={state.companyName}
                      onChange={e => update({ companyName: e.target.value })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3.5 text-gray-900 text-base placeholder:text-gray-300 focus:outline-none focus:border-violet-500/60 focus:bg-gray-100 transition-all"
                    />
                  </div>
                  <div>
                    <label className="text-gray-500 text-xs uppercase tracking-[0.15em] block mb-3">Call direction</label>
                    <div className="flex gap-3">
                      {(["inbound", "outbound", "both"] as AgentDirection[]).map(dir => (
                        <button
                          key={dir}
                          onClick={() => update({ agentDirection: dir })}
                          className={cn(
                            "flex-1 py-3 px-4 rounded-xl border font-medium text-sm capitalize transition-all",
                            state.agentDirection === dir
                              ? "border-violet-400 bg-violet-50 text-gray-900"
                              : "border-gray-200 bg-gray-50 text-gray-400 hover:border-gray-300",
                          )}
                        >
                          {dir}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: Requirements */}
            {currentStep === "requirements" && (
              <div>
                <p className="text-gray-400 text-xs uppercase tracking-[0.2em] mb-3">Step 4</p>
                <h2 className="text-3xl font-bold text-gray-900 mb-2">What should your<br />agent do?</h2>
                <p className="text-gray-400 text-sm mb-6">
                  Describe the call flow in your own words — no grammar needed. Our AI turns it into a professional prompt, or you can skip AI and continue directly.
                </p>

                <textarea
                  placeholder={"Just describe it naturally:\n\n\"Agent should call customers who have unpaid EMI. First remind them politely, ask when they will pay, note the date, if they say they already paid ask for reference number, if they refuse escalate to human.\"\n\nDon't worry about grammar — just explain what the agent should do."}
                  value={state.callFlowDescription}
                  onChange={e => { update({ callFlowDescription: e.target.value }); setGenError(""); }}
                  rows={6}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3.5 text-gray-900 text-sm placeholder:text-gray-300 focus:outline-none focus:border-violet-500/60 transition-all resize-none leading-relaxed mb-3"
                />

                {/* Generate button */}
                <button
                  onClick={generatePrompt}
                  disabled={!state.callFlowDescription.trim() || isGenerating}
                  className={cn(
                    "w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl font-semibold text-sm transition-all mb-3",
                    !state.callFlowDescription.trim() || isGenerating
                      ? "bg-gray-50 text-gray-400 cursor-not-allowed"
                      : "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-lg shadow-violet-500/20",
                  )}
                >
                  {isGenerating
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating your prompt — this takes a few seconds...</>
                    : <><Sparkles className="h-4 w-4" /> Generate AI Prompt &amp; Continue</>
                  }
                </button>

                {/* Inline error */}
                {generateError && (
                  <div className="flex items-start gap-2.5 p-3.5 rounded-xl border border-rose-300 bg-rose-50 mb-3">
                    <X className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-rose-500 text-xs font-semibold mb-0.5">Generation failed</p>
                      <p className="text-gray-400 text-xs">{generateError}</p>
                    </div>
                  </div>
                )}

                {/* Always-visible skip path */}
                <button
                  onClick={() => go(1)}
                  disabled={!state.callFlowDescription.trim()}
                  className={cn(
                    "w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm border transition-all",
                    !state.callFlowDescription.trim()
                      ? "border-gray-100 text-gray-300 cursor-not-allowed"
                      : "border-gray-200 text-gray-500 hover:text-gray-600 hover:border-gray-300",
                  )}
                >
                  <SkipForward className="h-3.5 w-3.5" /> Skip AI generation &amp; continue manually
                </button>

                <p className="text-gray-300 text-xs text-center mt-3">
                  You can edit or write the system prompt manually on the agent settings page.
                </p>
              </div>
            )}

            {/* Step 5: Knowledge Base */}
            {currentStep === "knowledge" && (
              <div>
                <p className="text-gray-400 text-xs uppercase tracking-[0.2em] mb-3">Step 5</p>
                <h2 className="text-3xl font-bold text-gray-900 mb-2">Add a knowledge<br />base <span className="text-gray-400">(optional)</span></h2>
                <p className="text-gray-400 text-sm mb-8">
                  Upload FAQs, product info, or any text your agent should know. The agent references this during calls. You can skip and add it later.
                </p>

                {!state.kbContent ? (
                  <div
                    className="border-2 border-dashed border-gray-200 rounded-2xl p-10 text-center hover:border-gray-300 transition-colors cursor-pointer group"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                  >
                    <div className="h-14 w-14 rounded-2xl bg-gray-50 group-hover:bg-gray-100 flex items-center justify-center mx-auto mb-4 transition-colors">
                      <Upload className="h-7 w-7 text-gray-400" />
                    </div>
                    <p className="text-gray-500 font-semibold mb-1">Drop a file or click to upload</p>
                    <p className="text-gray-400 text-sm">TXT, PDF, DOCX — max 5 MB</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.pdf,.docx,.md,.csv"
                      className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                    />
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border border-emerald-300 bg-emerald-50 flex items-center gap-3 mb-4">
                    <FileText className="h-5 w-5 text-emerald-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-700 text-sm font-semibold truncate">{state.kbFileName || "Pasted content"}</p>
                      <p className="text-gray-400 text-xs">{state.kbContent.length.toLocaleString()} characters</p>
                    </div>
                    <button onClick={() => update({ kbContent: "", kbFileName: "" })} className="text-gray-400 hover:text-gray-500 transition-colors">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

                <p className="text-gray-400 text-xs text-center my-4">— or —</p>

                <textarea
                  placeholder="Paste your FAQs, product description, pricing, or any knowledge here..."
                  value={state.kbContent && !state.kbFileName ? state.kbContent : ""}
                  onChange={e => update({ kbContent: e.target.value, kbFileName: "" })}
                  rows={5}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3.5 text-gray-900 text-sm placeholder:text-gray-300 focus:outline-none focus:border-violet-500/60 transition-all resize-none leading-relaxed"
                />

                <div className="mt-4 p-3.5 rounded-xl border border-gray-200 bg-gray-50 flex items-center gap-2.5">
                  <SkipForward className="h-4 w-4 text-gray-400 shrink-0" />
                  <p className="text-gray-400 text-xs">You can skip this step and add a knowledge base later from the agent settings.</p>
                </div>
              </div>
            )}

            {/* Step 6: Voice */}
            {currentStep === "voice" && (
              <div>
                <p className="text-gray-400 text-xs uppercase tracking-[0.2em] mb-3">Step 6</p>
                <h2 className="text-3xl font-bold text-gray-900 mb-2">Choose your<br />agent's voice</h2>
                <p className="text-gray-400 text-sm mb-8">
                  <span className="text-violet-600 font-medium">Arushi</span> is pre-selected — warm Indian English female.{" "}
                  {voiceSource === "cartesia"
                    ? "Press ▶ to hear any voice."
                    : <span className="text-amber-500">Preview plays your browser's built-in voice (Cartesia key not configured).</span>}
                </p>

                {loadingVoices ? (
                  <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" /> Loading voices...
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5">
                    {state.voices.map(voice => {
                      const sel      = state.selectedVoiceId === voice.id;
                      const isPlay   = playing === voice.id;
                      const isArushi = voice.name.toLowerCase().includes("arushi");
                      return (
                        <div
                          key={voice.id}
                          onClick={() => update({ selectedVoiceId: voice.id })}
                          className={cn(
                            "p-4 rounded-xl border cursor-pointer transition-all duration-200 flex items-center gap-3 group",
                            sel
                              ? "border-violet-400 bg-violet-50"
                              : "border-gray-200 bg-gray-50 hover:border-gray-200 hover:bg-gray-50",
                          )}
                        >
                          <div className={cn(
                            "h-11 w-11 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
                            voice.gender === "Female" ? "bg-rose-500/20 text-rose-500" : "bg-blue-100 text-blue-600",
                          )}>
                            {voice.name.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={cn("font-semibold text-sm", sel ? "text-gray-900" : "text-gray-600")}>{voice.name}</span>
                              {isArushi && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600 font-semibold">Default</span>}
                              {voice.language && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400 font-medium">
                                  {LANG_LABEL[voice.language] ?? voice.language.toUpperCase()}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5 truncate">{voice.gender}</div>
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); void preview(voice.id); }}
                            className={cn(
                              "h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition-all",
                              isPlay ? "bg-violet-500 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700",
                            )}
                          >
                            {isPlay ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                          </button>
                          {sel && <Check className="h-4 w-4 text-violet-600 shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Step 7: Skills & Finish */}
            {currentStep === "skills" && (
              <div>
                <p className="text-gray-400 text-xs uppercase tracking-[0.2em] mb-3">Step 7 — Final step</p>
                <h2 className="text-3xl font-bold text-gray-900 mb-2">Agent skills &<br />final setup</h2>
                <p className="text-gray-400 text-sm mb-8">Enable capabilities your agent needs. Auto-summarize is always on.</p>

                <div className="space-y-4">
                  {/* Call Transfer */}
                  <div className={cn(
                    "p-5 rounded-xl border transition-all",
                    state.callTransferEnabled ? "border-violet-200 bg-violet-50/60" : "border-gray-200 bg-white",
                  )}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2.5">
                        <PhoneForwarded className={cn("h-4 w-4", state.callTransferEnabled ? "text-violet-600" : "text-gray-400")} />
                        <span className="font-semibold text-gray-800 text-sm">Call Transfer</span>
                      </div>
                      <Switch
                        checked={state.callTransferEnabled}
                        onCheckedChange={v => update({ callTransferEnabled: v })}
                      />
                    </div>
                    <p className="text-gray-400 text-xs mb-3">Agent can transfer calls to a human agent when needed</p>
                    {state.callTransferEnabled && (
                      <input
                        type="tel"
                        placeholder="+91 9876543210"
                        value={state.callTransferNumber}
                        onChange={e => update({ callTransferNumber: e.target.value })}
                        className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:border-violet-400 transition-all"
                      />
                    )}
                  </div>

                  {/* Auto Summarize — always on */}
                  <div className="p-5 rounded-xl border border-emerald-200 bg-emerald-50 flex items-start gap-3">
                    <div className="h-8 w-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0 mt-0.5">
                      <Check className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-semibold text-gray-700 text-sm">Auto-Summarize Calls</span>
                        <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600 font-semibold border border-emerald-200">Always On</span>
                      </div>
                      <p className="text-gray-400 text-xs leading-relaxed">After each call, AI generates a 3-bullet summary — caller intent, key info exchanged, and outcome.</p>
                    </div>
                  </div>

                  {/* Coming soon */}
                  <div className="p-4 rounded-xl border border-gray-100 bg-gray-50">
                    <p className="text-gray-400 text-xs uppercase tracking-widest mb-2">Coming soon</p>
                    <div className="flex flex-wrap gap-2">
                      {["WhatsApp Integration", "SMS Service", "CRM Sync", "Zapier", "Salesforce"].map(item => (
                        <span key={item} className="px-2.5 py-1 rounded-full bg-gray-50 text-xs text-gray-400 border border-gray-100">{item}</span>
                      ))}
                    </div>
                  </div>

                  {/* Summary card */}
                  <div className="p-5 rounded-xl border border-gray-200 bg-gray-50 mt-2">
                    <p className="text-gray-400 text-xs uppercase tracking-widest mb-3">Your agent summary</p>
                    <div className="space-y-2">
                      {[
                        { k: "Name",      v: state.agentName || "—" },
                        { k: "Company",   v: state.companyName || "—" },
                        { k: "Use case",  v: USE_CASES.find(u => u.id === state.useCase)?.label || "—" },
                        { k: "Language",  v: [LANGUAGES.find(l => l.code === state.primaryLanguage)?.label, ...state.additionalLanguages.map(c => LANGUAGES.find(l => l.code === c)?.label)].filter(Boolean).join(", ") },
                        { k: "Voice",     v: state.voices.find(v => v.id === state.selectedVoiceId)?.name || "Arushi" },
                        { k: "Direction", v: state.agentDirection },
                      ].map(row => (
                        <div key={row.k} className="flex items-center justify-between text-sm">
                          <span className="text-gray-400">{row.k}</span>
                          <span className="text-gray-600 font-medium capitalize">{row.v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ════════════════════════════════════════════
                BYOP FLOW
            ════════════════════════════════════════════ */}
            {state.mode === "byop" && (
              <div>
                <p className="text-gray-400 text-xs uppercase tracking-[0.2em] mb-3">BYOP Configuration</p>
                <h2 className="text-3xl font-bold text-gray-900 mb-2">Configure your<br />provider stack</h2>
                <p className="text-gray-400 text-sm mb-8">Choose your own providers and write a system prompt.</p>

                <div className="space-y-5">
                  <div>
                    <label className="text-gray-500 text-xs uppercase tracking-widest block mb-2">Agent Name</label>
                    <input type="text" placeholder="My Assistant" value={state.agentName} onChange={e => update({ agentName: e.target.value })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-violet-500/60 transition-all" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Transcriber (ASR)", key: "byopAsr",       opts: ["deepgram","assemblyai","whisper","azure","sarvam"] },
                      { label: "Language Model",    key: "byopLlm",       opts: ["openai","anthropic","google","sarvam","groq","deepseek","mistral"] },
                      { label: "Voice (TTS)",       key: "byopTts",       opts: ["elevenlabs","openai","cartesia","azure","aws_polly","deepgram"] },
                      { label: "Telephony",         key: "byopTelephony", opts: ["twilio","plivo","vonage","vobiz"] },
                    ].map(field => (
                      <div key={field.key} className="bg-gray-50 border border-gray-200 rounded-xl p-3.5">
                        <p className="text-gray-400 text-[10px] font-semibold uppercase tracking-widest mb-2">{field.label}</p>
                        <select
                          value={(state as any)[field.key]}
                          onChange={e => update({ [field.key]: e.target.value } as any)}
                          className="w-full bg-gray-100 border border-gray-200 rounded-lg text-xs text-gray-600 py-2 px-2.5 focus:outline-none focus:border-violet-500/60"
                        >
                          {field.opts.map(o => <option key={`${field.key}-${o}`} value={o} className="bg-white">{o}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                  <div>
                    <label className="text-gray-500 text-xs uppercase tracking-widest block mb-2">System Prompt</label>
                    <textarea
                      value={state.byopPrompt} onChange={e => update({ byopPrompt: e.target.value })} rows={6}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-gray-700 text-sm focus:outline-none focus:border-violet-500/60 transition-all resize-none"
                    />
                  </div>
                </div>
              </div>
            )}

          </SlideStep>
        </div>
      </div>

      {/* Bottom navigation */}
      {state.mode !== null && (
        <div className="px-8 py-5 border-t border-gray-200 shrink-0 flex items-center justify-between">
          <div className="flex gap-1.5">
            {state.mode === "managed" && MANAGED_STEPS.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1 rounded-full transition-all duration-300",
                  i < stepIdx ? "w-5 bg-gray-300"
                  : i === stepIdx ? "w-5 bg-violet-400"
                  : "w-2 bg-gray-100",
                )}
              />
            ))}
          </div>

          <div className="flex items-center gap-3">
            {state.mode === "managed" && currentStep === "knowledge" && (
              <button
                onClick={() => go(1)}
                className="text-gray-400 hover:text-gray-500 text-sm flex items-center gap-1.5 transition-colors"
              >
                <SkipForward className="h-3.5 w-3.5" /> Skip for now
              </button>
            )}

            {state.mode === "byop" || currentStep === "skills" ? (
              <button
                onClick={handleCreate}
                disabled={create.isPending}
                className={cn(
                  "flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all",
                  create.isPending
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-lg shadow-violet-500/25",
                )}
              >
                {create.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</>
                  : <><Check className="h-4 w-4" /> Create Agent</>
                }
              </button>
            ) : currentStep === "requirements" ? (
              /* requirements step has its own inline Continue buttons — show nothing here */
              null
            ) : (
              <button
                onClick={() => go(1)}
                disabled={currentStep === "use-case" && !state.useCase}
                className={cn(
                  "flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all",
                  currentStep === "use-case" && !state.useCase
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-200",
                )}
              >
                Continue <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
