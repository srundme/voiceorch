import React, { useState, useRef } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useCreateAgent, getListAgentsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight, ChevronLeft, Loader2, Sparkles, Play, Pause,
  Check, X, PhoneForwarded, Users, Target, Rocket, ShoppingCart,
  Headphones, Bell, Megaphone, Building2, BarChart2, Package, Wand2,
  Globe, Languages, Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Types ──────────────────────────────────────────────────────────────── */

interface CartesiaVoice {
  id: string;
  name: string;
  gender: string;
  description: string;
}

type AgentDirection = "inbound" | "outbound" | "both";

interface WizardState {
  /* Step 0 */
  mode: "byop" | "managed" | null;
  /* Step 1 - use case */
  useCase: string;
  useCaseRole: string;
  useCaseService: string;
  /* Step 2 - language */
  isMultilingual: boolean;
  primaryLanguage: string;
  additionalLanguages: string[];
  /* Step 3 - requirements */
  agentName: string;
  companyName: string;
  agentDirection: AgentDirection;
  callFlowDescription: string;
  generatedPrompt: string;
  /* Step 4 - voice */
  voices: CartesiaVoice[];
  selectedVoiceId: string;
  /* Step 5 - skills */
  callTransferEnabled: boolean;
  callTransferNumber: string;
  /* BYOP */
  byopAsr: string;
  byopLlm: string;
  byopTts: string;
  byopTelephony: string;
  byopPrompt: string;
}

/* ── Use-case catalogue ─────────────────────────────────────────────────── */

const USE_CASES = [
  { id: "recruitment", label: "Recruitment Agent", desc: "Screen, interview, and onboard candidates at scale", role: "recruitment specialist", service: "candidate screening and recruitment", icon: Users },
  { id: "lead_qual", label: "Lead Qualification", desc: "Qualify leads and warmly introduce your business", role: "sales representative", service: "lead qualification and sales outreach", icon: Target },
  { id: "onboarding", label: "Onboarding Agent", desc: "Conduct personalized onboarding guidance calls", role: "onboarding specialist", service: "customer onboarding and guidance", icon: Rocket },
  { id: "cart_abandon", label: "Cart Abandonment", desc: "Recover abandoned carts by calling customers", role: "customer success representative", service: "cart recovery and sales", icon: ShoppingCart },
  { id: "customer_support", label: "Customer Support", desc: "24/7 inbound call answering for FAQs and triage", role: "customer support agent", service: "customer support and issue resolution", icon: Headphones },
  { id: "reminder", label: "Reminder Agent", desc: "Automate reminders for EMIs, collections, deadlines", role: "reminder and collections specialist", service: "payment reminders and collections follow-up", icon: Bell },
  { id: "announcement", label: "Announcement Agent", desc: "Keep users engaged with feature upgrades and launches", role: "product announcements specialist", service: "product updates and feature announcements", icon: Megaphone },
  { id: "front_desk", label: "Front Desk Agent", desc: "Answer calls for clinic, hotel, and office scheduling", role: "front desk receptionist", service: "scheduling and appointment management", icon: Building2 },
  { id: "survey", label: "Survey Agent", desc: "Automated NPS, feedback and product surveys", role: "survey and feedback specialist", service: "customer feedback and NPS surveys", icon: BarChart2 },
  { id: "cod_confirm", label: "COD Confirmation", desc: "Handle last-mile logistics and delivery confirmation", role: "logistics confirmation specialist", service: "COD order confirmation and last-mile logistics", icon: Package },
];

/* ── Language catalogue ─────────────────────────────────────────────────── */

const LANGUAGES = [
  { code: "english", label: "English", flag: "🇬🇧" },
  { code: "hindi", label: "Hindi", flag: "🇮🇳" },
  { code: "tamil", label: "Tamil", flag: "🇮🇳" },
  { code: "telugu", label: "Telugu", flag: "🇮🇳" },
  { code: "kannada", label: "Kannada", flag: "🇮🇳" },
  { code: "marathi", label: "Marathi", flag: "🇮🇳" },
  { code: "gujarati", label: "Gujarati", flag: "🇮🇳" },
  { code: "bengali", label: "Bengali", flag: "🇮🇳" },
  { code: "malayalam", label: "Malayalam", flag: "🇮🇳" },
];

/* ── Managed stack rules ────────────────────────────────────────────────── */

function getManagedStack(languages: string[]) {
  const hasTamil = languages.includes("tamil");
  return {
    asrProvider: hasTamil ? "sarvam" : "deepgram",
    llmProvider: "google",
    llmModel: "gemini-2.0-flash",
    ttsProvider: "cartesia",
    telephonyProvider: "vobiz",
  };
}

/* ── Step indicator ─────────────────────────────────────────────────────── */

const MANAGED_STEPS = ["Use Case", "Language", "Requirements", "Voice", "Skills"];

function StepBar({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5 mb-6">
      {Array.from({ length: total }).map((_, i) => (
        <React.Fragment key={i}>
          <div className={cn(
            "h-1.5 rounded-full transition-all duration-300",
            i < current ? "bg-black/85 flex-1" : i === current ? "bg-black/60 flex-1" : "bg-black/10 flex-1",
          )} />
        </React.Fragment>
      ))}
    </div>
  );
}

/* ── Voice preview hook ─────────────────────────────────────────────────── */

function useVoicePreview() {
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function preview(voiceId: string) {
    if (playing === voiceId) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }

    setPlaying(voiceId);

    try {
      const res = await fetch("/api/wizard/preview-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ voiceId, text: "Hello! I am your AI voice assistant and I am here to help you today." }),
      });

      if (!res.ok) {
        setPlaying(null);
        return;
      }

      const { audio, mimeType } = await res.json();
      const blob = new Blob([Uint8Array.from(atob(audio), c => c.charCodeAt(0))], { type: mimeType });
      const url = URL.createObjectURL(blob);

      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }

      const el = new Audio(url);
      audioRef.current = el;
      el.onended = () => setPlaying(null);
      el.onerror = () => setPlaying(null);
      void el.play();
    } catch {
      setPlaying(null);
    }
  }

  return { playing, preview };
}

/* ── Main wizard ─────────────────────────────────────────────────────────── */

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}

const INITIAL: WizardState = {
  mode: null,
  useCase: "",
  useCaseRole: "",
  useCaseService: "",
  isMultilingual: false,
  primaryLanguage: "english",
  additionalLanguages: [],
  agentName: "",
  companyName: "",
  agentDirection: "inbound",
  callFlowDescription: "",
  generatedPrompt: "",
  voices: [],
  selectedVoiceId: "",
  callTransferEnabled: false,
  callTransferNumber: "",
  byopAsr: "deepgram",
  byopLlm: "openai",
  byopTts: "elevenlabs",
  byopTelephony: "twilio",
  byopPrompt: "You are a helpful AI voice assistant. Be concise and professional.",
};

export function CreateAgentWizard({ open, onClose, onCreated }: Props) {
  const [state, setState] = useState<WizardState>(INITIAL);
  const [managedStep, setManagedStep] = useState(0); // 0-4 within managed flow
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const { playing, preview } = useVoicePreview();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useCreateAgent();

  function update(patch: Partial<WizardState>) {
    setState(prev => ({ ...prev, ...patch }));
  }

  function reset() {
    setState(INITIAL);
    setManagedStep(0);
  }

  function handleClose() {
    reset();
    onClose();
  }

  /* ── Fetch Cartesia voices when entering step 3 (index 3) ── */
  async function loadVoices() {
    if (state.voices.length > 0) return;
    setIsLoadingVoices(true);
    try {
      const res = await fetch("/api/wizard/voices", { credentials: "include" });
      if (res.ok) {
        const { voices } = await res.json();
        update({ voices, selectedVoiceId: voices[0]?.id ?? "" });
      }
    } catch {
      // use fallback silently
    } finally {
      setIsLoadingVoices(false);
    }
  }

  /* ── AI prompt generation ── */
  async function generatePrompt() {
    setIsGenerating(true);
    try {
      const langs = [state.primaryLanguage, ...state.additionalLanguages];
      const res = await fetch("/api/wizard/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          useCase: state.useCase,
          role: state.useCaseRole,
          companyName: state.companyName,
          agentName: state.agentName,
          serviceDescription: state.useCaseService,
          agentDirection: state.agentDirection,
          callFlowDescription: state.callFlowDescription,
          languages: langs,
        }),
      });

      if (!res.ok) throw new Error("Generation failed");
      const { prompt } = await res.json();
      update({ generatedPrompt: prompt });
      toast({ title: "Prompt generated", description: "Review and edit it below if needed." });
    } catch {
      toast({ title: "Generation failed", description: "Please check your requirements and try again.", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  }

  /* ── Final create ── */
  async function handleCreate() {
    setIsCreating(true);
    const isManaged = state.mode === "managed";
    const langs = [state.primaryLanguage, ...state.additionalLanguages];
    const stack = getManagedStack(langs);

    const payload = isManaged
      ? {
          name: state.agentName || `${state.useCase} Agent`,
          asrProvider: stack.asrProvider,
          llmProvider: stack.llmProvider,
          llmModel: stack.llmModel,
          ttsProvider: stack.ttsProvider,
          ttsVoice: state.selectedVoiceId || undefined,
          telephonyProvider: stack.telephonyProvider,
          systemPrompt: state.generatedPrompt || state.callFlowDescription,
          maxDuration: 600,
          agentConfig: {
            summarizationEnabled: true,
            summarizationPrompt: "Summarize this call in 3 bullet points covering: 1) caller intent, 2) key information exchanged, 3) outcome or next step.",
            ...(state.callTransferEnabled && state.callTransferNumber
              ? { hangupAfterLlmCall: false }
              : {}),
          } as any,
        }
      : {
          name: state.agentName || "New Assistant",
          asrProvider: state.byopAsr,
          llmProvider: state.byopLlm,
          ttsProvider: state.byopTts,
          telephonyProvider: state.byopTelephony,
          systemPrompt: state.byopPrompt,
          maxDuration: 300,
        };

    create.mutate(
      { data: payload as any },
      {
        onSuccess: (created) => {
          queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
          toast({ title: "Agent created!", description: `${created.name} is ready.` });
          reset();
          onCreated(created.id);
        },
        onError: () => {
          toast({ title: "Create failed", variant: "destructive" });
          setIsCreating(false);
        },
      },
    );
  }

  /* ────────────────────────────────────────────────────────────────────── */
  /*  RENDER                                                                */
  /* ────────────────────────────────────────────────────────────────────── */

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-3xl w-full p-0 overflow-hidden bg-white/95 backdrop-blur-xl border-black/[0.08] rounded-2xl shadow-2xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Create Agent</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col max-h-[85vh]">
          {/* Top bar */}
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-black/[0.06] shrink-0">
            <div className="flex items-center gap-2">
              {state.mode && (
                <button
                  onClick={() => {
                    if (state.mode === "managed" && managedStep > 0) setManagedStep(s => s - 1);
                    else { update({ mode: null }); setManagedStep(0); }
                  }}
                  className="p-1 rounded-md hover:bg-black/[0.06] text-black/40 hover:text-black/70 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
              <span className="font-semibold text-sm text-black/85">
                {state.mode === null ? "Create Agent" :
                  state.mode === "byop" ? "BYOP — Bring Your Own Providers" :
                  `Managed Agent — ${MANAGED_STEPS[managedStep]}`}
              </span>
            </div>
            <button onClick={handleClose} className="p-1 rounded-md hover:bg-black/[0.06] text-black/40 hover:text-black/70">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">

            {/* ── Step 0: Mode selection ── */}
            {state.mode === null && (
              <div>
                <p className="text-sm text-black/50 mb-6">How would you like to build your agent?</p>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => update({ mode: "managed" })}
                    className="group text-left p-5 rounded-2xl border-2 border-black/[0.07] hover:border-black/40 bg-gradient-to-br from-violet-50 to-indigo-50 hover:from-violet-100 hover:to-indigo-100 transition-all"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-9 w-9 rounded-xl bg-violet-500 flex items-center justify-center">
                        <Wand2 className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <div className="font-semibold text-sm text-black/85">Managed</div>
                        <Badge className="text-[9px] bg-violet-100 text-violet-700 border-0 px-1.5 py-0 font-medium">Recommended</Badge>
                      </div>
                    </div>
                    <p className="text-xs text-black/55 leading-relaxed">
                      We handle the AI stack — STT, LLM, TTS, telephony. You just describe what the agent should do and we build it.
                    </p>
                    <div className="mt-3 text-xs text-violet-600 font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                      Get started <ChevronRight className="h-3.5 w-3.5" />
                    </div>
                  </button>

                  <button
                    onClick={() => update({ mode: "byop" })}
                    className="group text-left p-5 rounded-2xl border-2 border-black/[0.07] hover:border-black/40 bg-gradient-to-br from-slate-50 to-zinc-50 hover:from-slate-100 hover:to-zinc-100 transition-all"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-9 w-9 rounded-xl bg-zinc-700 flex items-center justify-center">
                        <Globe className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <div className="font-semibold text-sm text-black/85">BYOP</div>
                        <span className="text-[9px] text-black/40 font-medium">Bring Your Own Providers</span>
                      </div>
                    </div>
                    <p className="text-xs text-black/55 leading-relaxed">
                      Choose your own ASR, LLM, TTS and telephony providers. Full control over the AI stack.
                    </p>
                    <div className="mt-3 text-xs text-zinc-600 font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                      Configure manually <ChevronRight className="h-3.5 w-3.5" />
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* ════════════════════════════════════════════════════════════ */}
            {/* MANAGED FLOW                                                 */}
            {/* ════════════════════════════════════════════════════════════ */}

            {state.mode === "managed" && (
              <>
                <StepBar current={managedStep} total={MANAGED_STEPS.length} />

                {/* Step 1: Use case */}
                {managedStep === 0 && (
                  <div>
                    <p className="text-xs text-black/40 uppercase tracking-widest font-semibold mb-4">Select your agent type</p>
                    <div className="grid grid-cols-2 gap-2.5">
                      {USE_CASES.map(uc => {
                        const Icon = uc.icon;
                        const selected = state.useCase === uc.id;
                        return (
                          <button
                            key={uc.id}
                            onClick={() => update({ useCase: uc.id, useCaseRole: uc.role, useCaseService: uc.service })}
                            className={cn(
                              "text-left p-4 rounded-xl border-2 transition-all flex items-start gap-3",
                              selected
                                ? "border-black/70 bg-black/[0.04]"
                                : "border-black/[0.07] hover:border-black/25 hover:bg-black/[0.02]",
                            )}
                          >
                            <div className={cn(
                              "h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                              selected ? "bg-black/85 text-white" : "bg-black/[0.07] text-black/50",
                            )}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className={cn("font-semibold text-sm", selected ? "text-black/85" : "text-black/70")}>{uc.label}</div>
                              <div className="text-xs text-black/40 mt-0.5 leading-tight">{uc.desc}</div>
                            </div>
                            {selected && <Check className="h-4 w-4 text-black/70 shrink-0 ml-auto mt-0.5" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Step 2: Language */}
                {managedStep === 1 && (
                  <div className="space-y-5">
                    <div>
                      <p className="text-xs text-black/40 uppercase tracking-widest font-semibold mb-3">Language mode</p>
                      <div className="flex gap-3">
                        {[
                          { value: false, label: "Single language", icon: Volume2 },
                          { value: true, label: "Multilingual", icon: Languages },
                        ].map(opt => {
                          const Icon = opt.icon;
                          const sel = state.isMultilingual === opt.value;
                          return (
                            <button
                              key={String(opt.value)}
                              onClick={() => update({ isMultilingual: opt.value, additionalLanguages: [] })}
                              className={cn(
                                "flex-1 p-4 rounded-xl border-2 flex items-center gap-3 transition-all",
                                sel ? "border-black/70 bg-black/[0.04]" : "border-black/[0.07] hover:border-black/25",
                              )}
                            >
                              <Icon className={cn("h-5 w-5", sel ? "text-black/85" : "text-black/40")} />
                              <div className="text-left">
                                <div className={cn("text-sm font-semibold", sel ? "text-black/85" : "text-black/60")}>{opt.label}</div>
                                {opt.value && <div className="text-xs text-black/35">English + up to 2 regional</div>}
                              </div>
                              {sel && <Check className="h-4 w-4 text-black/70 ml-auto" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-black/40 uppercase tracking-widest font-semibold mb-3">
                        {state.isMultilingual ? "Primary language" : "Select language"}
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {LANGUAGES.map(lang => {
                          const sel = state.primaryLanguage === lang.code;
                          return (
                            <button
                              key={lang.code}
                              onClick={() => update({ primaryLanguage: lang.code })}
                              className={cn(
                                "p-3 rounded-xl border-2 flex items-center gap-2 transition-all text-sm",
                                sel ? "border-black/70 bg-black/[0.04]" : "border-black/[0.07] hover:border-black/25",
                              )}
                            >
                              <span className="text-base">{lang.flag}</span>
                              <span className={cn("font-medium", sel ? "text-black/85" : "text-black/55")}>{lang.label}</span>
                              {sel && <Check className="h-3.5 w-3.5 text-black/70 ml-auto" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {state.isMultilingual && (
                      <div>
                        <p className="text-xs text-black/40 uppercase tracking-widest font-semibold mb-1">
                          Additional regional languages <span className="text-black/25">(up to 2)</span>
                        </p>
                        <p className="text-xs text-black/35 mb-3">English is always included. Select 1–2 more regional languages.</p>
                        <div className="grid grid-cols-3 gap-2">
                          {LANGUAGES.filter(l => l.code !== state.primaryLanguage && l.code !== "english").map(lang => {
                            const sel = state.additionalLanguages.includes(lang.code);
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
                                  "p-3 rounded-xl border-2 flex items-center gap-2 transition-all text-sm",
                                  sel ? "border-black/70 bg-black/[0.04]" : maxed ? "border-black/[0.04] opacity-40 cursor-not-allowed" : "border-black/[0.07] hover:border-black/25",
                                )}
                              >
                                <span className="text-base">{lang.flag}</span>
                                <span className={cn("font-medium", sel ? "text-black/85" : "text-black/55")}>{lang.label}</span>
                                {sel && <Check className="h-3.5 w-3.5 text-black/70 ml-auto" />}
                              </button>
                            );
                          })}
                        </div>

                        {/* Managed stack info for Tamil */}
                        {([state.primaryLanguage, ...state.additionalLanguages].includes("tamil")) && (
                          <div className="mt-3 p-3 rounded-xl bg-violet-50 border border-violet-100 text-xs text-violet-700">
                            <strong>Tamil detected</strong> — AI stack auto-set: Sarvam STT · Gemini 2.5 Flash LLM · Cartesia TTS · VoBiz Telephony
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Step 3: Requirements */}
                {managedStep === 2 && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-black/40 uppercase tracking-widest font-semibold mb-1.5">Agent Name</p>
                        <Input
                          placeholder="e.g. Priya, Alex, Sarah"
                          value={state.agentName}
                          onChange={e => update({ agentName: e.target.value })}
                          className="bg-black/[0.04] border-black/[0.07] text-black/75 text-sm"
                        />
                      </div>
                      <div>
                        <p className="text-xs text-black/40 uppercase tracking-widest font-semibold mb-1.5">Company Name</p>
                        <Input
                          placeholder="e.g. Acme Corp, QuickPay"
                          value={state.companyName}
                          onChange={e => update({ companyName: e.target.value })}
                          className="bg-black/[0.04] border-black/[0.07] text-black/75 text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-black/40 uppercase tracking-widest font-semibold mb-2">Call Direction</p>
                      <div className="flex gap-2">
                        {(["inbound", "outbound", "both"] as AgentDirection[]).map(dir => (
                          <button
                            key={dir}
                            onClick={() => update({ agentDirection: dir })}
                            className={cn(
                              "flex-1 py-2 px-3 rounded-lg border-2 text-sm font-medium capitalize transition-all",
                              state.agentDirection === dir
                                ? "border-black/70 bg-black/[0.06] text-black/85"
                                : "border-black/[0.07] text-black/45 hover:border-black/25",
                            )}
                          >
                            {dir}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-xs text-black/40 uppercase tracking-widest font-semibold">What should the agent do?</p>
                        <p className="text-xs text-black/30">Write in simple English — no grammar needed</p>
                      </div>
                      <Textarea
                        placeholder={`Describe what the agent should say and do. For example:\n\n"Agent should call customers who missed EMI payment. First ask if they remember, then remind the due amount, ask when they will pay, if they say date note it down, if they refuse escalate."\n\nDon't worry about grammar — just explain clearly.`}
                        value={state.callFlowDescription}
                        onChange={e => update({ callFlowDescription: e.target.value })}
                        className="bg-black/[0.04] border-black/[0.07] text-black/75 text-sm min-h-[140px] resize-none placeholder:text-black/25 leading-relaxed"
                      />
                    </div>

                    <Button
                      onClick={generatePrompt}
                      disabled={!state.callFlowDescription.trim() || isGenerating}
                      className="w-full gap-2 bg-violet-600 hover:bg-violet-700 text-white"
                    >
                      {isGenerating ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Generating prompt...</>
                      ) : (
                        <><Sparkles className="h-4 w-4" /> Generate AI Prompt</>
                      )}
                    </Button>

                    {state.generatedPrompt && (
                      <div>
                        <p className="text-xs text-black/40 uppercase tracking-widest font-semibold mb-1.5">Generated Prompt <span className="text-black/25 normal-case tracking-normal">(you can edit this)</span></p>
                        <Textarea
                          value={state.generatedPrompt}
                          onChange={e => update({ generatedPrompt: e.target.value })}
                          className="bg-black/[0.04] border-black/[0.07] text-black/70 text-xs font-mono min-h-[200px] resize-none leading-relaxed"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Step 4: Voice */}
                {managedStep === 3 && (
                  <div>
                    <p className="text-xs text-black/40 uppercase tracking-widest font-semibold mb-4">
                      Choose a voice for your agent <span className="normal-case tracking-normal text-black/25">— powered by Cartesia</span>
                    </p>

                    {isLoadingVoices ? (
                      <div className="flex items-center gap-2 py-12 justify-center text-black/40">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span className="text-sm">Loading voices...</span>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2.5">
                        {state.voices.map(voice => {
                          const sel = state.selectedVoiceId === voice.id;
                          const isPlaying = playing === voice.id;
                          return (
                            <div
                              key={voice.id}
                              onClick={() => update({ selectedVoiceId: voice.id })}
                              className={cn(
                                "p-4 rounded-xl border-2 cursor-pointer transition-all flex items-center gap-3",
                                sel ? "border-black/70 bg-black/[0.04]" : "border-black/[0.07] hover:border-black/25",
                              )}
                            >
                              <div className={cn(
                                "h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
                                voice.gender === "Female" ? "bg-rose-100 text-rose-600" : "bg-blue-100 text-blue-600",
                              )}>
                                {voice.name.charAt(0)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className={cn("font-semibold text-sm", sel ? "text-black/85" : "text-black/70")}>{voice.name}</div>
                                <div className="text-xs text-black/35 truncate">{voice.description || voice.gender}</div>
                              </div>
                              <button
                                onClick={e => { e.stopPropagation(); void preview(voice.id); }}
                                className={cn(
                                  "h-7 w-7 rounded-full flex items-center justify-center shrink-0 transition-colors",
                                  isPlaying
                                    ? "bg-black/85 text-white"
                                    : "bg-black/[0.07] text-black/50 hover:bg-black/15",
                                )}
                                title="Preview voice"
                              >
                                {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                              </button>
                              {sel && <Check className="h-4 w-4 text-black/70 shrink-0" />}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {state.voices.length === 0 && !isLoadingVoices && (
                      <div className="text-center py-12 text-black/35 text-sm">
                        <Volume2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                        No voices available — Cartesia key not configured in admin
                      </div>
                    )}
                  </div>
                )}

                {/* Step 5: Skills */}
                {managedStep === 4 && (
                  <div className="space-y-5">
                    <div>
                      <p className="text-xs text-black/40 uppercase tracking-widest font-semibold mb-3">Agent Skills</p>
                      <div
                        className={cn(
                          "p-4 rounded-xl border-2 transition-all",
                          state.callTransferEnabled ? "border-black/40 bg-black/[0.03]" : "border-black/[0.07]",
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <PhoneForwarded className="h-4 w-4 text-black/50" />
                            <span className="font-semibold text-sm text-black/75">Call Transfer</span>
                          </div>
                          <button
                            onClick={() => update({ callTransferEnabled: !state.callTransferEnabled })}
                            className={cn(
                              "w-10 h-5.5 rounded-full transition-colors relative",
                              state.callTransferEnabled ? "bg-black/85" : "bg-black/15",
                            )}
                          >
                            <span className={cn(
                              "absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform",
                              state.callTransferEnabled ? "translate-x-5" : "translate-x-0.5",
                            )} />
                          </button>
                        </div>
                        <p className="text-xs text-black/40 mb-3">Agent can transfer calls to a human agent when needed</p>
                        {state.callTransferEnabled && (
                          <div>
                            <p className="text-xs text-black/40 mb-1.5">Transfer to number</p>
                            <Input
                              placeholder="+91 9876543210"
                              value={state.callTransferNumber}
                              onChange={e => update({ callTransferNumber: e.target.value })}
                              className="bg-white border-black/[0.12] text-black/75 text-sm"
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="p-4 rounded-xl border-2 border-black/[0.07] bg-emerald-50/60">
                      <div className="flex items-center gap-2 mb-1">
                        <Check className="h-4 w-4 text-emerald-600" />
                        <span className="font-semibold text-sm text-black/75">Auto Summarize Calls</span>
                        <Badge className="text-[9px] bg-emerald-100 text-emerald-700 border-0 px-1.5">Always On</Badge>
                      </div>
                      <p className="text-xs text-black/40">After each call, AI automatically generates a 3-bullet summary covering caller intent, key info, and outcome.</p>
                    </div>

                    <div className="p-4 rounded-xl border-2 border-black/[0.07] bg-black/[0.02]">
                      <p className="text-xs text-black/35 uppercase tracking-widest font-semibold mb-2">AI Stack (auto-configured)</p>
                      {(() => {
                        const langs = [state.primaryLanguage, ...state.additionalLanguages];
                        const stack = getManagedStack(langs);
                        return (
                          <div className="grid grid-cols-4 gap-2">
                            {[
                              { label: "STT", value: stack.asrProvider },
                              { label: "LLM", value: `${stack.llmProvider} / ${stack.llmModel}` },
                              { label: "TTS", value: stack.ttsProvider },
                              { label: "TEL", value: stack.telephonyProvider },
                            ].map(item => (
                              <div key={item.label} className="text-center p-2 rounded-lg bg-white border border-black/[0.06]">
                                <div className="text-[9px] text-black/30 uppercase tracking-widest">{item.label}</div>
                                <div className="text-xs font-semibold text-black/65 capitalize mt-0.5">{item.value}</div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>

                    <div className="p-4 rounded-xl border-2 border-black/[0.07]">
                      <p className="text-xs text-black/35 uppercase tracking-widest font-semibold mb-2">Connecting soon</p>
                      <div className="flex flex-wrap gap-2">
                        {["WhatsApp", "SMS", "CRM Integration", "Zapier", "Salesforce"].map(item => (
                          <span key={item} className="px-2.5 py-1 rounded-full bg-black/[0.04] text-xs text-black/35 border border-black/[0.06]">
                            {item} — coming soon
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ════════════════════════════════════════════════════════════ */}
            {/* BYOP FLOW                                                    */}
            {/* ════════════════════════════════════════════════════════════ */}

            {state.mode === "byop" && (
              <div className="space-y-5">
                <div>
                  <p className="text-xs text-black/40 uppercase tracking-widest font-semibold mb-1.5">Agent Name</p>
                  <Input
                    placeholder="New Assistant"
                    value={state.agentName}
                    onChange={e => update({ agentName: e.target.value })}
                    className="bg-black/[0.04] border-black/[0.07] text-black/75"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Transcriber (ASR)", key: "byopAsr", opts: ["deepgram", "assemblyai", "whisper", "azure", "sarvam"] },
                    { label: "Language Model", key: "byopLlm", opts: ["openai", "anthropic", "google", "groq", "deepseek", "mistral"] },
                    { label: "Voice (TTS)", key: "byopTts", opts: ["elevenlabs", "openai", "cartesia", "azure", "aws_polly", "deepgram"] },
                    { label: "Telephony", key: "byopTelephony", opts: ["twilio", "plivo", "vonage", "vobiz"] },
                  ].map(field => (
                    <div key={field.key} className="bg-black/[0.04] border border-black/[0.04] rounded-xl p-3.5 space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-black/35">{field.label}</p>
                      <select
                        value={(state as any)[field.key]}
                        onChange={e => update({ [field.key]: e.target.value } as any)}
                        className="w-full bg-white/70 border border-black/[0.07] rounded-md text-xs text-black/70 py-1.5 px-2"
                      >
                        {field.opts.map(o => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                <div>
                  <p className="text-xs text-black/40 uppercase tracking-widest font-semibold mb-1.5">System Prompt</p>
                  <Textarea
                    value={state.byopPrompt}
                    onChange={e => update({ byopPrompt: e.target.value })}
                    className="bg-black/[0.04] border-black/[0.07] text-black/75 text-sm min-h-[120px] resize-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Footer actions */}
          {state.mode !== null && (
            <div className="px-6 py-4 border-t border-black/[0.06] shrink-0 flex items-center justify-between bg-black/[0.015]">
              <span className="text-xs text-black/35">
                {state.mode === "managed"
                  ? `Step ${managedStep + 1} of ${MANAGED_STEPS.length}`
                  : "BYOP configuration"}
              </span>

              {state.mode === "byop" ? (
                <Button
                  onClick={handleCreate}
                  disabled={isCreating || create.isPending || !state.agentName.trim()}
                  className="gap-2 bg-black/85 hover:bg-black/90 text-white"
                >
                  {(isCreating || create.isPending) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Create Agent
                </Button>
              ) : managedStep < MANAGED_STEPS.length - 1 ? (
                <Button
                  onClick={async () => {
                    if (managedStep === 3) await loadVoices();
                    setManagedStep(s => s + 1);
                    if (managedStep === 2) await loadVoices();
                  }}
                  disabled={
                    (managedStep === 0 && !state.useCase) ||
                    (managedStep === 2 && !state.callFlowDescription.trim())
                  }
                  className="gap-2 bg-black/85 hover:bg-black/90 text-white"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={handleCreate}
                  disabled={isCreating || create.isPending}
                  className="gap-2 bg-black/85 hover:bg-black/90 text-white"
                >
                  {(isCreating || create.isPending) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Create Agent
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
