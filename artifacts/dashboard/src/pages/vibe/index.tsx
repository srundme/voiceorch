import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { getVoiceAvatar } from "@/lib/voice-avatars";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Send, Phone, Settings2, Sparkles, Globe, Mic, Cpu, Ear, Speaker,
  Building2, CheckCircle2, Loader2, ChevronLeft, ChevronRight, Zap, UserCheck,
  PhoneForwarded, Voicemail, Calendar, ShieldCheck,
  Play, Volume2, FileText, BookOpen, ArrowUpRight, Paperclip,
  PlusCircle, History, PhoneIncoming, Info, PhoneOutgoing, Star, Rocket, X, LayoutDashboard,
  PanelRightOpen, PanelRightClose,
} from "lucide-react";
import { WebcallPanel } from "@/components/webcall-panel";
import { OutboundCallDialog } from "@/components/outbound-call-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { BrandMark } from "@/components/logo";
import { DottedSurface } from "@/components/ui/dotted-surface";
import { SilkAurora } from "@/components/ui/silk-aurora";
import { useQueryClient } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { AGENT_TIMEZONES } from "@/lib/agent-providers";
import { getListAgentsQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import VibeSchedulingWizard from "./SchedulingWizard";

/* ── types ─────────────────────────────────────────────────────────────────── */

interface VoiceOption  { voiceId: string; voiceName: string; gender: string; language: string; description: string; languageMatch?: boolean; }
interface PhoneNumberOption { id: number; number: string; region: string; assignedAgentId: number | null; }
interface NoticeCard   { message: string; }
interface AgentField   { key: string; label: string; value: string; icon: string; }
interface FeatureCard  { key: string; label: string; enabled: boolean; icon: string; detail: string; }
interface DispositionCard { category: string; outcomes: string[]; }
interface LangPill     { code: string; label: string; }
interface VibeTool { toolType: string; label: string; enabled: boolean; status: string; statusNote?: string; }
interface VibeToolSection { category: string; label: string; tools: VibeTool[]; }

interface ChatMsg {
  id: string;
  role: "user" | "ai";
  content: string;
  done?: boolean;
  voices?: VoiceOption[];        // inline voice picker
  voiceAgentLangs?: string[];    // agent's chosen language(s) for the picker's default filter
  voicePicked?: boolean;         // collapses picker after selection
  notices?: NoticeCard[];        // distinct info notices (multi-language heads-up, no-numbers)
  phoneNumbers?: PhoneNumberOption[]; // inline phone-number picker
  phoneNumbersPicked?: boolean;  // collapses phone-number picker after pick/skip
}

interface SessionSummary {
  id: number;
  title: string;
  agentId: number | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

type Phase = "idle" | "thinking" | "streaming" | "building" | "done";

/* ── icon maps ─────────────────────────────────────────────────────────────── */

const FIELD_ICONS: Record<string, React.ElementType> = {
  bot: () => <img src="/snapserve-icon.png" className="h-3.5 w-3.5" alt="" />,
  building: Building2, globe: Globe, mic: Mic,
  phone: Phone, cpu: Cpu, ear: Ear, speaker: Speaker,
  "phone-incoming": PhoneIncoming,
};
const FEATURE_ICONS: Record<string, React.ElementType> = {
  "user-check": UserCheck, "phone-forwarded": PhoneForwarded,
  "voicemail": Voicemail, "calendar": Calendar, "shield-check": ShieldCheck,
};

/* ── auth ──────────────────────────────────────────────────────────────────── */
function getToken(): string | null {
  try { return localStorage.getItem("voiceorch:session"); } catch { return null; }
}
function uid() { return Math.random().toString(36).slice(2); }

/* ── language display map ───────────────────────────────────────────────────── */
const LANG_DISPLAY: Record<string, string> = {
  "ta-IN": "Tamil", "hi-IN": "Hindi", "te-IN": "Telugu",
  "kn-IN": "Kannada", "ml-IN": "Malayalam", "en-IN": "English (India)",
  "en-US": "English (US)",
};

/** Base language code ("en-IN" → "en") used for voice-list filtering. */
function baseLang(code: string): string {
  return (code ?? "").trim().toLowerCase().split("-")[0] ?? "";
}

const BASE_LANG_DISPLAY: Record<string, string> = {
  en: "English", ta: "Tamil", hi: "Hindi", te: "Telugu",
  kn: "Kannada", ml: "Malayalam", mr: "Marathi", bn: "Bengali",
  gu: "Gujarati", pa: "Punjabi", or: "Odia", ur: "Urdu",
};

/** Human-readable name for a base language code, falling back to Intl then the raw code. */
function baseLangLabel(code: string): string {
  const b = baseLang(code);
  if (BASE_LANG_DISPLAY[b]) return BASE_LANG_DISPLAY[b];
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(b);
    if (name && name !== b) return name;
  } catch { /* fall through */ }
  return b.toUpperCase();
}

/* ── greeting ──────────────────────────────────────────────────────────────── */
const GREETING: ChatMsg = {
  id: "g", role: "ai", done: true,
  content: "Hey! I'll help you build your voice agent in a few minutes.\n\nTell me — what do you want this agent to do, and who will it be talking to?",
};

/* ── landing template recommendations ──────────────────────────────────────── */
interface VibeTemplate {
  title: string;
  desc: string;
  tag: string;
  message: string;
}
const VIBE_TEMPLATES: VibeTemplate[] = [
  {
    title: "Insurance Sales",
    desc: "Follow up on leads, qualify intent, handle objections",
    tag: "Outbound · Hindi / English",
    message: "Build an outbound insurance sales agent in Hindi and English. Her name is Priya, she works for PolicyFirst. She follows up on enquiry leads, qualifies interest level, handles price and trust objections naturally, and books a callback for hot leads. She must ask: what plan they enquired about, their age, and if they already have any insurance.",
  },
  {
    title: "Clinic Appointments",
    desc: "Book, reschedule & cancel patient slots",
    tag: "Inbound · English",
    message: "Build an inbound appointment booking agent for a dental clinic called Smile Care. Her name is Riya. She helps patients book, reschedule, or cancel appointments — collecting their name, preferred date and time, and reason for the visit — then reads back a confirmation summary before ending the call.",
  },
  {
    title: "Real Estate Leads",
    desc: "Qualify buyers on budget, location & timeline",
    tag: "Outbound · English / Hindi",
    message: "Build an outbound real estate lead qualification agent in English and Hindi. His name is Arjun, he works for PropConnect. He calls leads who enquired about properties and qualifies them on budget, preferred location and configuration (2BHK/3BHK), and purchase timeline. He tags them as Hot Lead, Warm Lead, or Not Interested and books a site-visit callback for hot leads.",
  },
  {
    title: "SaaS Support",
    desc: "Resolve account, billing & upgrade issues",
    tag: "Inbound · English",
    message: "Build an inbound customer support agent for a B2B SaaS product. Her name is Tara, she works for Snappy. She handles account issues, billing queries, and plan upgrade questions. She must always collect the caller's registered email first, then identify the issue type (account/billing/feature), and either resolve it on the call or escalate to the right team.",
  },
  {
    title: "Restaurant Bookings",
    desc: "Take table reservations & answer menu queries",
    tag: "Inbound · English / Tamil",
    message: "Build an inbound restaurant reservation agent in English and Tamil for a restaurant called Spice Garden. Her name is Meera. She takes table bookings by collecting the guest's name, date, time, number of guests, and any dietary needs, then confirms the reservation. She can also answer basic questions about the menu and location.",
  },
  {
    title: "Loan Pre-qualification",
    desc: "Check eligibility, collect income & EMI details",
    tag: "Outbound · Hindi",
    message: "Build an outbound Hindi loan eligibility agent for a fintech company called QuickCredit. His name is Rahul. He calls loan applicants to pre-qualify them by asking about monthly income, employment type (salaried/self-employed), existing EMIs, and rough credit history. He then tells them if they likely qualify and books a video call with a loan advisor for eligible leads.",
  },
  {
    title: "EdTech Enrolment",
    desc: "Convert trial users into paid course enrolments",
    tag: "Outbound · English / Hindi",
    message: "Build an outbound EdTech enrolment agent in English and Hindi. Her name is Shruti, she works for SkillPath. She calls free trial users who haven't converted yet, asks what they liked about the course, handles pricing objections (a 15% discount is available this week), and books a demo call with a counsellor for undecided leads.",
  },
  {
    title: "E-commerce Support",
    desc: "Handle order tracking, returns & refunds",
    tag: "Inbound · English",
    message: "Build an inbound customer support agent for an e-commerce store called QuickMart. His name is Dev. He handles order tracking enquiries, return requests, and refund status questions. He must always collect the order ID first, then pull up the order status and guide the caller through the next step — whether that's a refund, replacement, or pickup.",
  },
];

/* Kept for backward compat (refine page still references SUGGESTIONS via search) */
const SUGGESTIONS = VIBE_TEMPLATES.map(t => t.title);

/* ── quick suggestion chips (landing view) ─────────────────────────────────── */
interface QuickSuggestion { label: string; message: string; }
const QUICK_SUGGESTIONS: QuickSuggestion[] = [
  { label: "Customer Support", message: VIBE_TEMPLATES.find(t => t.title === "SaaS Support")!.message },
  { label: "Sales Agent", message: VIBE_TEMPLATES.find(t => t.title === "Insurance Sales")!.message },
  { label: "Appointment Booking", message: VIBE_TEMPLATES.find(t => t.title === "Clinic Appointments")!.message },
  { label: "Healthcare", message: "Build an inbound patient-support agent for a multi-speciality clinic called CareFirst Health. Her name is Anika. She answers common patient questions, collects symptoms at a high level, helps patients pick the right department, and books a slot with the right doctor — always advising that she is not a medical professional for anything beyond scheduling and general guidance." },
  { label: "Restaurant", message: VIBE_TEMPLATES.find(t => t.title === "Restaurant Bookings")!.message },
  { label: "E-commerce", message: VIBE_TEMPLATES.find(t => t.title === "E-commerce Support")!.message },
  { label: "Education", message: VIBE_TEMPLATES.find(t => t.title === "EdTech Enrolment")!.message },
  { label: "Multilingual", message: "Build an inbound multilingual customer support agent for a national retail brand called Bazaar. Her name is Neha. She detects the caller's language automatically and can switch fluently between English, Hindi, and Tamil mid-call, helping with order status, store locations, and product questions." },
];

/* ── voice preview ──────────────────────────────────────────────────────────── */
async function previewVoice(voiceId: string, setPlaying: (id: string | null) => void) {
  setPlaying(voiceId);
  try {
    const resp = await fetch("/api/voices/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice: voiceId, model: "sonic-3.5" }),
    });
    if (!resp.ok) throw new Error("preview failed");
    const blob  = await resp.blob();
    const url   = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => setPlaying(null);
    audio.onerror = () => setPlaying(null);
    audio.play().catch(() => setPlaying(null));
  } catch {
    setPlaying(null);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Ambient background (landing + chat)                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */
function VibeAmbientBg() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Dark mode: animated silk aurora (satin-dark WebGL background) */}
      <div className="absolute inset-0 hidden dark:block">
        <SilkAurora
          interactive={false}
          speed={0.6}
          intensity={0.6}
          grain={0.35}
          vignette={1}
          baseColor="#060609"
          midColor="#0f1017"
          sheenColor="#9aa1bd"
          accentColor="#6f63d6"
          className="absolute inset-0 h-full min-h-0 w-full items-stretch bg-[#060609]"
        />
        {/* Readability scrim: mute the aurora's bright ribbons so light UI text
            keeps contrast, with an extra darken behind the centered hero. */}
        <div className="absolute inset-0 bg-[#06060b]/45" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_65%_55%_at_50%_45%,rgba(6,6,11,0.55),transparent_72%)]" />
      </div>

      {/* Light mode: soft neutral silk wash */}
      <div className="absolute inset-0 block dark:hidden">
        <DottedSurface className="opacity-60" />
        <div
          aria-hidden
          className={cn(
            "absolute -top-10 left-1/2 size-full -translate-x-1/2 rounded-full",
            "bg-[radial-gradient(ellipse_at_center,hsl(var(--foreground)/0.06),transparent_55%)]",
            "blur-[40px]",
          )}
        />
        <div className="absolute top-[-25%] left-1/2 -translate-x-1/2 h-[60vh] w-[90vw] max-w-[1000px] rounded-full bg-[#7c6cf0]/[0.05] blur-[120px]" />
        <div className="absolute bottom-[-15%] right-[-8%] h-[45vh] w-[55vw] max-w-[700px] rounded-full bg-[#a9b4e0]/[0.05] blur-[100px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_45%_at_50%_0%,rgba(124,108,240,0.06),transparent_65%)]" />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Main component                                                             */
/* ═══════════════════════════════════════════════════════════════════════════ */
export default function VibePage() {
  const [, navigate]     = useLocation();
  const queryClient      = useQueryClient();
  const { toast }        = useToast();
  const [welcomeName, setWelcomeName] = useState("");
  const refineId = useMemo(() => {
    try {
      const v = new URLSearchParams(window.location.search).get("refine");
      return v ? parseInt(v, 10) : null;
    } catch { return null; }
  }, []);

  const [messages,       setMessages]       = useState<ChatMsg[]>([GREETING]);
  const [input,          setInput]          = useState("");
  const [phase,          _setPhase]         = useState<Phase>("idle");
  const [fields,         setFields]         = useState<AgentField[]>([]);
  const [selectedVoice,  setSelectedVoice]  = useState<string>("");
  const [langPills,      setLangPills]      = useState<LangPill[]>([]);
  const [features,       setFeatures]       = useState<FeatureCard[]>([]);
  const [vibeTools,      setVibeTools]      = useState<VibeToolSection[]>([]);
  const [dispositions,   setDispositions]   = useState<DispositionCard[]>([]);
  const [callFlowNotes,  setCallFlowNotes]  = useState("");
  const [kbNotes,        setKbNotes]        = useState("");
  const [promptPreview,  setPromptPreview]  = useState("");
  const [statusMsg,      setStatusMsg]      = useState("");
  const [createdId,      setCreatedId]      = useState<number | null>(null);
  const [createdName,    setCreatedName]    = useState("");
  const [playingVoice,   setPlayingVoice]   = useState<string | null>(null);
  const [schedulingSetup, setSchedulingSetup] = useState<{ timezone: string } | null>(null);
  const [refineLoading,  setRefineLoading]  = useState(false);
  const [lastSavedAgentId, setLastSavedAgentId] = useState<number | null>(null);
  const [showTestCall,   setShowTestCall]   = useState(false);
  const [savedTelephonyProvider, setSavedTelephonyProvider] = useState<string>("");
  const [postBuildStep, setPostBuildStep] = useState<"hype" | "rating" | null>(null);
  const [vibeRating,   setVibeRating]   = useState(0);
  const [vibeComment,  setVibeComment]  = useState("");
  const [callDialogOpen, setCallDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [slowThink, setSlowThink] = useState(false);

  const phaseRef    = useRef<string>("idle");
  const chatEndRef  = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const historyRef  = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const voicesRef   = useRef<{ shown: boolean; list: VoiceOption[] }>({ shown: false, list: [] });
  const selectedVoiceIdRef = useRef<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refineBaseRef = useRef<Record<string, unknown> | null>(null);
  const activeSessionIdRef = useRef<number | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [sessions, setSessions]               = useState<SessionSummary[]>([]);
  const [sidebarOpen, setSidebarOpen]         = useState(true);
  const isMobile = useIsMobile();
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);
  const [viewMode, setViewMode]               = useState<"editing" | "history">("editing");
  // Dedupe for notice cards — once per language decision / notice signature.
  const noticeSigsRef = useRef<Set<string>>(new Set());
  const [selectedNumber, setSelectedNumber] = useState<string>("");
  const vibeKbSourceIdsRef = useRef<number[]>([]);
  const [vibeKbSources,   setVibeKbSources]   = useState<{ id: number; name: string; type: string; status: string }[]>([]);
  // Mirror refs so interval/recursive callbacks always see fresh state without stale closures
  const vibeKbSourcesRef  = useRef<{ id: number; name: string; type: string; status: string }[]>([]);
  const createdIdRef       = useRef<number | null>(null);
  const [urlInputOpen,    setUrlInputOpen]    = useState(false);
  const [urlInputValue,   setUrlInputValue]   = useState("");
  const [showKbPanel,     setShowKbPanel]     = useState(false);
  // Once the user clicks "Done — Continue" on the KB panel, prevent re-show from any late SSE event
  const kbDoneRef = useRef(false);
  // Show scheduling wizard as right-panel takeover after agent is created with scheduling enabled
  const [showCalPanel,    setShowCalPanel]    = useState(false);

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    _setPhase(p);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const prevPhaseRef = useRef<Phase>("idle");
  useEffect(() => {
    const wasActive = prevPhaseRef.current === "thinking"
      || prevPhaseRef.current === "streaming"
      || prevPhaseRef.current === "building";
    prevPhaseRef.current = phase;
    if (phase === "idle" && wasActive) {
      chatInputRef.current?.focus();
    }
  }, [phase]);

  useEffect(() => {
    chatInputRef.current?.focus();
  }, []);

  useEffect(() => {
    try {
      const name = sessionStorage.getItem("vibe:welcomeName");
      if (name) {
        setWelcomeName(name);
        sessionStorage.removeItem("vibe:welcomeName");
      }
    } catch { /* ignore */ }
  }, []);

  // Keep mirror refs in sync with state so callbacks see fresh data without stale closures
  useEffect(() => { vibeKbSourcesRef.current = vibeKbSources; }, [vibeKbSources]);
  useEffect(() => { createdIdRef.current = createdId; }, [createdId]);
  const schedulingSetupRef = useRef<{ timezone: string } | null>(null);
  useEffect(() => { schedulingSetupRef.current = schedulingSetup; }, [schedulingSetup]);

  // ── Poll non-terminal Vibe KB sources until each reaches a terminal status ──
  // Uses a recursive setTimeout (not a one-shot) so polling continues even when
  // the source's status doesn't change between ticks (no React state update → no
  // useEffect re-trigger). vibeKbSourcesRef/createdIdRef give the callback fresh
  // state on every tick without stale closures.
  //
  // When a source transitions to a terminal-success status AND the agent already
  // exists (createdId set), it is immediately attached via POST attach-agent.
  // Re-runs whenever new sources are added to vibeKbSources so newly-added
  // website sources start their own polling loop.
  useEffect(() => {
    const NON_TERMINAL    = new Set(["validating", "processing", "crawling"]);
    const TERMINAL_OK     = new Set(["active", "ready", "partial"]);

    // Check whether there is anything to poll before starting the loop
    if (!vibeKbSources.some(s => NON_TERMINAL.has(s.status))) return;

    const token = localStorage.getItem("voiceorch:session");
    const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    let active = true;
    let tid: ReturnType<typeof setTimeout>;

    async function pollOnce(): Promise<void> {
      if (!active) return;

      const currentSources = vibeKbSourcesRef.current;
      const pending = currentSources.filter(s => NON_TERMINAL.has(s.status));
      if (pending.length === 0) return; // all terminal — stop naturally

      try {
        const fetched = await Promise.all(
          pending.map(async s => {
            try {
              const r = await fetch(`/api/knowledge-sources/${s.id}`, { headers: authHeaders });
              if (r.ok) return (await r.json()) as { id: number; status: string };
            } catch { /* transient network error — retry next tick */ }
            return null;
          })
        );

        if (!active) return;

        // Apply status updates to state for any source whose status changed
        const updates = fetched.filter(
          (d): d is { id: number; status: string } =>
            d != null && d.status !== currentSources.find(s => s.id === d.id)?.status
        );
        if (updates.length > 0) {
          setVibeKbSources(prev => prev.map(s => {
            const u = updates.find(x => x.id === s.id);
            return u ? { ...s, status: u.status } : s;
          }));
          // Attach sources that just reached a terminal-success status
          const agentId = createdIdRef.current;
          if (agentId != null) {
            void Promise.all(
              updates
                .filter(u => TERMINAL_OK.has(u.status))
                .map(u => fetch(`/api/knowledge-sources/${u.id}/attach-agent/${agentId}`, {
                  method: "POST", headers: authHeaders,
                }).catch(() => {}))
            );
          }
        }
      } catch { /* non-fatal */ }

      // Always reschedule as long as there are still non-terminal sources
      if (active && vibeKbSourcesRef.current.some(s => NON_TERMINAL.has(s.status))) {
        tid = setTimeout(pollOnce, 4_000);
      }
    }

    tid = setTimeout(pollOnce, 4_000);
    return () => { active = false; clearTimeout(tid); };
  }, [vibeKbSources]); // re-run when new sources are added (starts fresh loop for new sources)

  // ── On agent creation: attach any already-terminal Vibe KB sources ─────────
  // Handles the case where a source finished crawling BEFORE the agent was saved.
  useEffect(() => {
    if (createdId == null) return;
    const TERMINAL_OK = new Set(["active", "ready", "partial"]);
    const terminal = vibeKbSourcesRef.current.filter(s => TERMINAL_OK.has(s.status));
    if (!terminal.length) return;
    const token = localStorage.getItem("voiceorch:session");
    const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    void Promise.all(
      terminal.map(s => fetch(`/api/knowledge-sources/${s.id}/attach-agent/${createdId}`, {
        method: "POST", headers: authHeaders,
      }).catch(() => {}))
    );
  }, [createdId]);

  // ── Refine mode: load existing agent on mount ────────────────────────────
  useEffect(() => {
    if (!refineId) return;
    setRefineLoading(true);
    const token = getToken();

    Promise.all([
      fetch(`/api/agents/${refineId}`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      }).then(r => r.ok ? r.json() : null),
      fetch(`/api/disposition/config/${refineId}`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/vibe/sessions?agentId=${refineId}`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      }).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(`/api/phone-numbers`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      }).then(r => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([agent, dispositionsData, sessionList, phoneNumbersData]: [Record<string, unknown> | null, unknown, SessionSummary[], unknown]) => {
        if (Array.isArray(sessionList) && sessionList.length > 0) {
          setSessions(sessionList);
        }
        if (!agent) return;
        const cfg = (agent.agentConfig ?? {}) as Record<string, unknown>;
        const lang = LANG_DISPLAY[agent.language as string ?? ""] ?? (agent.language as string) ?? "English";

        // Pre-populate right panel fields (including company + greeting)
        const panelFields: AgentField[] = [
          { key: "name",      label: "Agent Name",     value: (agent.name as string) || "—",              icon: "bot"      },
          { key: "company",   label: "Company",        value: (cfg.companyName as string) || "—",          icon: "building" },
          { key: "language",  label: "Language",       value: lang,                                        icon: "globe"    },
          { key: "direction", label: "Call Direction",
            value: cfg.direction === "both" ? "Inbound & Outbound"
              : cfg.direction === "outbound" ? "Outbound" : "Inbound",                                     icon: "phone"    },
          { key: "voice",     label: "Voice",
            value: (agent.ttsVoice as string)
              ? ((agent.ttsVoiceName as string) || `…${(agent.ttsVoice as string).slice(-8)}`)
              : "—",                                                                                         icon: "mic"      },
          { key: "llm",       label: "AI Brain",       value: (agent.llmModel as string) || "Managed",     icon: "cpu"      },
          { key: "stt",       label: "Speech-to-Text",
            value: `Sarvam Saaras v3 · ${cfg.sarvamSttMode === "verbatim" ? "Verbatim" : cfg.sarvamSttMode === "transcribe" ? "Transcribe" : "Codemix"}`,
                                                                                                              icon: "ear"      },
          { key: "tts",       label: "Voice Engine",   value: "Cartesia Sonic 3.5",                        icon: "speaker"  },
        ];
        if (agent.greetingMessage) {
          panelFields.splice(2, 0, {
            key: "greeting", label: "Greeting", value: (agent.greetingMessage as string).slice(0, 80) + ((agent.greetingMessage as string).length > 80 ? "…" : ""), icon: "message-circle",
          });
        }
        // Inbound number panel field (inbound / "both" agents)
        const numberRows = Array.isArray(phoneNumbersData) ? (phoneNumbersData as Record<string, unknown>[]) : [];
        const assignedRow = numberRows.find(n => n.agentId === refineId);
        if (cfg.direction === "inbound" || cfg.direction === "both" || assignedRow) {
          panelFields.push({
            key: "inbound_number", label: "Inbound Number",
            value: (assignedRow?.number as string) || "Not assigned", icon: "phone-incoming",
          });
        }
        if (assignedRow?.number) setSelectedNumber(assignedRow.number as string);
        setSavedTelephonyProvider(String(agent.telephonyProvider ?? ""));
        setFields(panelFields);

        // Seed the notice dedupe so an already-multilingual agent doesn't get the
        // multi-language heads-up again on the first refine turn.
        if (cfg.isMultilingual) {
          const langSet = [...new Set(
            [agent.language as string, ...((cfg.multilingualLanguages as string[]) ?? [])]
              .map(s => String(s ?? "").trim()).filter(Boolean)
          )].sort();
          noticeSigsRef.current.add(`multi:${langSet.join(",")}`);
        }

        // Pre-populate call flow + KB notes
        const cfNotes = (cfg.callFlowNotes as string) || (agent.description as string) || "";
        const kbN = (cfg.knowledgeBaseNotes as string) || "";
        if (cfNotes) setCallFlowNotes(cfNotes);
        if (kbN) setKbNotes(kbN);

        // Pre-populate dispositions
        const rawDisp = (dispositionsData as Record<string, unknown> | null)?.taxonomy;
        if (rawDisp && typeof rawDisp === "object") {
          const cards = Object.entries(rawDisp as Record<string, string[]>).map(([category, outcomes]) => ({
            category,
            outcomes: Array.isArray(outcomes) ? outcomes : [],
          }));
          if (cards.length) setDispositions(cards);
        }

        // Voicemail: normalize both stored shapes (legacy `voicemailDetection`
        // boolean OR the edit-page `machineDetectionMode` enum) — same as runtime.
        const mdm = String(cfg.machineDetectionMode ?? "").toLowerCase();
        const voicemailOn = cfg.voicemailDetection === true
          || mdm === "enable" || mdm === "detect_message_end" || mdm === "detectmessageend";
        // Call transfer: the edit page represents transfer as a `call_transfer`
        // tool in agent.tools — read that first, fall back to agentConfig fields.
        const agentToolsArr = Array.isArray(agent.tools) ? (agent.tools as Record<string, unknown>[]) : [];
        const existingTransferTool = agentToolsArr.find(t => t?.type === "call_transfer");
        const transferOn = !!existingTransferTool || !!cfg.callTransferEnabled;
        const transferNumber = (existingTransferTool?.transferTo as string) || (cfg.transferPhoneNumber as string) || "";
        const transferPersonName = (existingTransferTool?.transferName as string) || (cfg.transferName as string) || "";

        // Pre-populate features
        const schedulingOn = !!(cfg.schedulingEnabled);
        const complianceFlags = cfg.compliance as Record<string, boolean> | undefined;
        const panelFeatures: FeatureCard[] = [
          {
            key: "gender_detection", label: "Caller Gender Detection", icon: "user-check",
            enabled: !!(cfg.genderDetectionEnabled),
            detail: cfg.genderDetectionEnabled
              ? `${(cfg.genderDetectionMaleSalutation as string) || (cfg.maleSalutation as string) || "Sir"} / ${(cfg.genderDetectionFemaleSalutation as string) || (cfg.femaleSalutation as string) || "Ma'am"}`
              : "Disabled",
          },
          {
            key: "call_transfer", label: "Call Transfer to Human", icon: "phone-forwarded",
            enabled: transferOn,
            detail: transferOn
              ? `→ ${transferPersonName || "Human Agent"} · ${transferNumber}`
              : "Disabled",
          },
          {
            key: "voicemail", label: "Voicemail", icon: "voicemail",
            enabled: voicemailOn,
            detail: voicemailOn
              ? ((cfg.voicemailMessage as string) ? `"${(cfg.voicemailMessage as string).slice(0, 50)}${(cfg.voicemailMessage as string).length > 50 ? "…" : ""}"` : "Enabled")
              : "Disabled",
          },
          {
            key: "scheduling", label: "Booking & Scheduling", icon: "calendar",
            enabled: schedulingOn,
            detail: schedulingOn ? "Enabled" : "Disabled",
          },
          {
            key: "compliance", label: "Compliance", icon: "shield-check",
            enabled: !!(complianceFlags?.dpdp || complianceFlags?.trai || complianceFlags?.irdai),
            detail: [
              complianceFlags?.dpdp  && "DPDP",
              complianceFlags?.trai  && "TRAI",
              complianceFlags?.irdai && "IRDAI",
            ].filter(Boolean).join(" · ") || "None",
          },
        ];
        setFeatures(panelFeatures);

        // Pre-populate scheduling tools from existing agent tools
        if (schedulingOn) {
          const ALL_SCHEDULING_TYPES = ["native_booking","native_check_availability","native_list_bookings","native_reschedule","native_cancel"];
          const TOOL_LABELS: Record<string, string> = {
            native_booking:            "Book Appointment",
            native_check_availability: "Check Availability",
            native_list_bookings:      "List Bookings",
            native_reschedule:         "Reschedule Booking",
            native_cancel:             "Cancel Booking",
          };
          const enabledTypes = new Set(
            agentToolsArr.filter(t => ALL_SCHEDULING_TYPES.includes(t?.type as string)).map(t => t.type as string)
          );
          setVibeTools([{
            category: "scheduling",
            label:    "Appointment & Scheduling Tools",
            tools:    ALL_SCHEDULING_TYPES.map(toolType => ({
              toolType,
              label:      TOOL_LABELS[toolType] ?? toolType,
              enabled:    enabledTypes.has(toolType),
              status:     enabledTypes.has(toolType) ? "selected" : "disabled",
              statusNote: enabledTypes.has(toolType) ? "Calendar auto-configured" : undefined,
            })),
          }]);
        }

        if (agent.ttsVoice) {
          selectedVoiceIdRef.current = agent.ttsVoice as string;
          setSelectedVoice((agent.ttsVoiceName as string) || `…${(agent.ttsVoice as string).slice(-8)}`);
        }

        // Show system prompt from existing agent
        if (agent.systemPrompt) {
          setPromptPreview(agent.systemPrompt as string);
        }

        // Build the full VibeConfig-shaped object to send as refineBaseConfig on every turn.
        // This is what the backend embeds as context for Gemini so it knows the full current state.
        const baseConfig: Record<string, unknown> = {
          agentName:              agent.name,
          companyName:            cfg.companyName ?? "",
          language:               agent.language ?? "en-IN",
          languageChosen:         true,
          languageMode:           (cfg.isMultilingual ? "multi" : "single"),
          multilingualLanguages:  cfg.multilingualLanguages ?? [],
          hasTamil:               (agent.language as string ?? "").includes("ta"),
          gender:                 "female",
          direction:              cfg.direction ?? "inbound",
          description:            agent.description ?? "",
          voiceId:                agent.ttsVoice ?? "",
          voiceName:              agent.ttsVoiceName ?? "",
          callFlowNotes:          cfg.callFlowNotes ?? agent.description ?? "",
          knowledgeBaseNotes:     cfg.knowledgeBaseNotes ?? "",
          genderDetectionEnabled: !!cfg.genderDetectionEnabled,
          maleSalutation:         (cfg.genderDetectionMaleSalutation as string) || "Sir",
          femaleSalutation:       (cfg.genderDetectionFemaleSalutation as string) || "Ma'am",
          callTransferEnabled:    transferOn,
          transferPhoneNumber:    transferNumber,
          transferName:           transferPersonName,
          voicemailEnabled:       voicemailOn,
          voicemailMessage:       cfg.voicemailMessage ?? "",
          schedulingEnabled:      !!cfg.schedulingEnabled,
          timezone:               cfg.timezone ?? "Asia/Kolkata",
          timezoneSet:            !!cfg.timezone,
          hostEmail:              "",
          hostEmailSet:           false,
          availabilityDays:       [1,2,3,4,5],
          availabilityStart:      "09:00",
          availabilityEnd:        "17:00",
          availabilitySet:        false,
          compliance:             cfg.compliance ?? { dpdp: false, trai: false, irdai: false },
          systemPrompt:           (agent.systemPrompt as string ?? "").slice(0, 3000),
          greetingMessage:        agent.greetingMessage ?? "",
          dispositions:           rawDisp
            ? Object.entries(rawDisp as Record<string, string[]>).map(([category, outcomes]) => ({ category, outcomes }))
            : [],
        };
        refineBaseRef.current = baseConfig;

        // setPhase("idle") not "building" — "building" disables the chatbox
        setPhase("idle");

        // Initialize history as empty — the backend will prepend the refine context block
        historyRef.current = [];

        // Set refine greeting
        setMessages([{
          id: "refine-g",
          role: "ai",
          done: true,
          content: `I've loaded **${agent.name as string}** — you can see the current setup on the right. What would you like to change?`,
        }]);
      })
      .catch(() => {})
      .finally(() => setRefineLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refineId]);

  const appendAiDelta = useCallback((delta: string) => {
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.role === "ai" && !last.done) {
        return [...prev.slice(0, -1), { ...last, content: last.content + delta }];
      }
      return prev;
    });
  }, []);

  const attachVoicesToLastMsg = useCallback((voices: VoiceOption[], agentLangs: string[]) => {
    setMessages(prev => {
      // Strip any older, still-open pickers so re-shown voices live only on the latest message
      const cleared = prev.map(m => m.voices && !m.voicePicked ? { ...m, voices: undefined, voiceAgentLangs: undefined } : m);
      const last = cleared[cleared.length - 1];
      if (last?.role === "ai") {
        return [...cleared.slice(0, -1), { ...last, voices, voiceAgentLangs: agentLangs, voicePicked: false }];
      }
      return cleared;
    });
  }, []);

  // Collapse all voice pickers when a voice is selected
  const collapseVoicePickers = useCallback(() => {
    setMessages(prev => prev.map(m => m.voices ? { ...m, voicePicked: true } : m));
  }, []);

  // Attach a distinct notice card to the last AI message (deduped by signature)
  const attachNoticeToLastMsg = useCallback((message: string) => {
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.role === "ai") {
        return [...prev.slice(0, -1), { ...last, notices: [...(last.notices ?? []), { message }] }];
      }
      return prev;
    });
  }, []);

  // Attach the phone-number picker to the last AI message (strip older open pickers)
  const attachPhoneNumbersToLastMsg = useCallback((numbers: PhoneNumberOption[]) => {
    setMessages(prev => {
      const cleared = prev.map(m => m.phoneNumbers && !m.phoneNumbersPicked ? { ...m, phoneNumbers: undefined } : m);
      const last = cleared[cleared.length - 1];
      if (last?.role === "ai") {
        return [...cleared.slice(0, -1), { ...last, phoneNumbers: numbers, phoneNumbersPicked: false }];
      }
      return cleared;
    });
  }, []);

  // Collapse all phone-number pickers after pick/skip
  const collapsePhonePickers = useCallback(() => {
    setMessages(prev => prev.map(m => m.phoneNumbers ? { ...m, phoneNumbersPicked: true } : m));
  }, []);

  const send = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || phaseRef.current === "building" || phaseRef.current === "thinking"
        || phaseRef.current === "streaming" || phaseRef.current === "done"
        || viewMode === "history") return;

    if (!overrideText) setInput("");
    // Close the URL input overlay if it was left open
    setUrlInputOpen(false);
    setUrlInputValue("");
    if (refineId != null) setPromptPreview("");

    const userMsg: ChatMsg = { id: uid(), role: "user", content: text, done: true };
    const aiMsg:   ChatMsg = { id: uid(), role: "ai",   content: "",   done: false };
    setMessages(prev => [...prev, userMsg, aiMsg]);
    setPhase("thinking");

    const history = [...historyRef.current, { role: "user" as const, content: text }];
    const token   = getToken();

    // Create a new session on the first message of a new conversation
    if (activeSessionIdRef.current === null) {
      try {
        const sResp = await fetch("/api/vibe/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token ?? ""}` },
          body: JSON.stringify({ agentId: refineId ?? null, title: text.slice(0, 70) }),
        });
        if (sResp.ok) {
          const sData = await sResp.json() as { id: number; title: string; agentId: number | null; createdAt: string };
          activeSessionIdRef.current = sData.id;
          setActiveSessionId(sData.id);
          setSessions(prev => [{
            id: sData.id, title: sData.title, agentId: sData.agentId,
            createdAt: sData.createdAt, updatedAt: sData.createdAt, messageCount: 0,
          }, ...prev]);
        }
      } catch { /* fire and forget */ }
    }

    try {
      let aiReply   = "";
      let streamHadError = false;
      // Auto-retry transient "AI busy" (shared-key rate-limit / timeout) errors so
      // they surface as a brief "retrying…" pause instead of a dead error bubble.
      const MAX_BUSY_RETRIES = 3;
      let busyAttempt = 0;

      retryLoop: while (true) {
      aiReply = "";
      streamHadError = false;
      let wantRetry = false;

      const resp = await fetch("/api/agents/vibe-chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          messages:        history,
          voicesShown:     voicesRef.current.shown,
          availableVoices: voicesRef.current.list,
          selectedVoiceId: selectedVoiceIdRef.current,
          ...(refineId != null ? { refineAgentId: refineId } : {}),
          ...(refineId != null && refineBaseRef.current ? { refineBaseConfig: refineBaseRef.current } : {}),
          ...(vibeKbSourceIdsRef.current.length > 0 ? { knowledgeSourceIds: vibeKbSourceIdsRef.current } : {}),
        }),
      });

      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

      setPhase("streaming");
      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf       = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let evt: Record<string, unknown>;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }

          switch (evt.type) {
            case "text":
              aiReply += evt.delta as string;
              appendAiDelta(evt.delta as string);
              break;

            case "voice_options": {
              const voices = (evt.voices as VoiceOption[]) ?? [];
              const agentLangs = Array.isArray(evt.agentLanguages) ? (evt.agentLanguages as string[]) : [];
              if (voices.length > 0) {
                voicesRef.current = { shown: true, list: voices };
                attachVoicesToLastMsg(voices, agentLangs);
              }
              break;
            }

            case "voice_selected":
              collapseVoicePickers();
              selectedVoiceIdRef.current = String(evt.voiceId ?? "");
              setSelectedVoice(String(evt.voiceName ?? ""));
              break;

            case "notice": {
              const sig = String(evt.signature ?? "");
              if (sig && noticeSigsRef.current.has(sig)) break;
              if (sig) noticeSigsRef.current.add(sig);
              attachNoticeToLastMsg(String(evt.message ?? ""));
              break;
            }

            case "phone_number_options": {
              const nums = (evt.numbers as PhoneNumberOption[]) ?? [];
              if (nums.length > 0) attachPhoneNumbersToLastMsg(nums);
              break;
            }

            case "phone_number_selected":
              collapsePhonePickers();
              setSelectedNumber(String(evt.number ?? ""));
              break;

            case "field":
              setPhase("building");
              setFields(prev => {
                const next = [...prev];
                const idx  = next.findIndex(f => f.key === evt.key);
                const f: AgentField = { key: evt.key as string, label: evt.label as string, value: evt.value as string, icon: evt.icon as string };
                if (idx >= 0) next[idx] = f; else next.push(f);
                return next;
              });
              if (evt.key === "voice") {
                // Update the selected-voice display, but do NOT collapse open pickers here —
                // refine mode emits this field on every turn (pre-existing voiceId), which
                // used to instantly vanish freshly shown voice cards. Collapse happens only
                // on an explicit voice_selected event or a local Select click.
                const nm = (String(evt.value ?? "").split(" — ")[0] ?? "").trim();
                if (nm) setSelectedVoice(nm);
              }
              break;

            case "call_flow":
              setCallFlowNotes(String(evt.notes ?? ""));
              break;

            case "knowledge_base":
              setKbNotes(String(evt.notes ?? ""));
              if (!kbDoneRef.current) setShowKbPanel(true);
              // Track the text KB source created during this phase on the server
              if (typeof evt.kbSourceId === "number") {
                const sid = evt.kbSourceId as number;
                if (!vibeKbSourceIdsRef.current.includes(sid)) {
                  vibeKbSourceIdsRef.current = [...vibeKbSourceIdsRef.current, sid];
                  setVibeKbSources(prev => prev.find(s => s.id === sid)
                    ? prev
                    : [...prev, { id: sid, name: "Knowledge Base Notes", type: "text", status: "ready" }]);
                }
              }
              break;

            case "lang_pill":
              setLangPills(prev => {
                if (prev.find(p => p.code === evt.code)) return prev;
                return [...prev, { code: evt.code as string, label: evt.label as string }];
              });
              break;

            case "feature":
              setPhase("building");
              setFeatures(prev => {
                const next = [...prev];
                const idx  = next.findIndex(f => f.key === evt.key);
                const f: FeatureCard = { key: evt.key as string, label: evt.label as string, enabled: !!evt.enabled, icon: evt.icon as string, detail: evt.detail as string };
                if (idx >= 0) next[idx] = f; else next.push(f);
                return next;
              });
              break;

            case "tools":
              setVibeTools(prev => {
                const next = [...prev];
                const category = evt.category as string;
                const section: VibeToolSection = {
                  category,
                  label: evt.label as string,
                  tools: (evt.tools as VibeTool[]) ?? [],
                };
                const idx = next.findIndex(s => s.category === category);
                if (idx >= 0) next[idx] = section; else next.push(section);
                return next;
              });
              break;

            case "disposition_card":
              setDispositions(prev => {
                if (prev.find(d => d.category === evt.category)) return prev;
                return [...prev, { category: evt.category as string, outcomes: Array.isArray(evt.outcomes) ? evt.outcomes as string[] : [] }];
              });
              break;

            case "scheduling_setup": {
              const ss = { timezone: String(evt.timezone ?? "Asia/Kolkata") };
              schedulingSetupRef.current = ss; // sync — so `created` handler sees it in the same tick
              setSchedulingSetup(ss);
              break;
            }

            case "prompt_stream":
              setPromptPreview(prev => prev + (evt.delta as string));
              break;

            case "status":
              setStatusMsg(evt.message as string);
              break;

            case "created":
              setCreatedId(evt.agentId as number);
              setCreatedName(evt.agentName as string);
              setMessages(prev => prev.map(m => !m.done && m.role === "ai" ? { ...m, done: true } : m));
              queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
              // Link the active session to the newly created agent (covers both new-agent and refine)
              if (activeSessionIdRef.current !== null) {
                fetch(`/api/vibe/sessions/${activeSessionIdRef.current}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${getToken() ?? ""}` },
                  body: JSON.stringify({ agentId: evt.agentId }),
                }).catch(() => {});
              }
              if (refineId != null) {
                // Refine mode: fetch fresh state, sync preview + ref, then re-enable input.
                fetch(`/api/agents/${evt.agentId as number}`, {
                  headers: { Authorization: `Bearer ${getToken() ?? ""}` },
                })
                  .then(r => r.ok ? r.json() : null)
                  .then((fresh: Record<string, unknown> | null) => {
                    if (!fresh || !refineBaseRef.current) return;
                    const fcfg = (fresh.agentConfig ?? {}) as Record<string, unknown>;
                    refineBaseRef.current = {
                      ...refineBaseRef.current,
                      agentName:              fresh.name,
                      companyName:            fcfg.companyName ?? refineBaseRef.current.companyName,
                      language:               fresh.language ?? refineBaseRef.current.language,
                      voiceId:                fresh.ttsVoice ?? refineBaseRef.current.voiceId,
                      voiceName:              fresh.ttsVoiceName ?? refineBaseRef.current.voiceName,
                      callFlowNotes:          fcfg.callFlowNotes ?? refineBaseRef.current.callFlowNotes,
                      knowledgeBaseNotes:     fcfg.knowledgeBaseNotes ?? refineBaseRef.current.knowledgeBaseNotes,
                      genderDetectionEnabled: fcfg.genderDetectionEnabled ?? refineBaseRef.current.genderDetectionEnabled,
                      callTransferEnabled:    fcfg.callTransferEnabled ?? refineBaseRef.current.callTransferEnabled,
                      transferPhoneNumber:    fcfg.transferPhoneNumber ?? refineBaseRef.current.transferPhoneNumber,
                      transferName:           fcfg.transferName ?? refineBaseRef.current.transferName,
                      voicemailEnabled:       !!fcfg.voicemailDetection,
                      voicemailMessage:       fcfg.voicemailMessage ?? refineBaseRef.current.voicemailMessage,
                      compliance:             fcfg.compliance ?? refineBaseRef.current.compliance,
                      systemPrompt:           String(fresh.systemPrompt ?? "").slice(0, 3000),
                      greetingMessage:        fresh.greetingMessage ?? refineBaseRef.current.greetingMessage,
                    };
                    setSavedTelephonyProvider(String(fresh.telephonyProvider ?? ""));
                    // Sync the System Prompt preview to the freshly saved prompt.
                    setPromptPreview(String(fresh.systemPrompt ?? ""));
                    // Expose the test buttons now that a save has completed.
                    setLastSavedAgentId(evt.agentId as number);
                    // Re-enable the chat input so the user can make a second refinement.
                    setPhase("idle");
                  })
                  .catch(() => { setPhase("idle"); });
              } else {
                // New-agent creation: lock the composer as before.
                // Fetch telephony provider for the Make a Call button.
                fetch(`/api/agents/${evt.agentId as number}`, {
                  headers: { Authorization: `Bearer ${getToken() ?? ""}` },
                })
                  .then(r => r.ok ? r.json() : null)
                  .then((a: Record<string, unknown> | null) => {
                    if (a) setSavedTelephonyProvider(String(a.telephonyProvider ?? ""));
                  })
                  .catch(() => {});
                setLastSavedAgentId(evt.agentId as number);
                // If scheduling was enabled, surface the Google Calendar connect panel
                // as a full right-panel takeover so the user can connect Google right now
                if (schedulingSetupRef.current) {
                  setShowCalPanel(true);
                } else {
                  setPostBuildStep("hype");
                }
                setPhase("done");
              }
              break;

            case "error": {
              streamHadError = true;
              const retryable = evt.retryable === true;
              if (retryable && busyAttempt < MAX_BUSY_RETRIES) {
                // Keep the bubble open and let the retryLoop re-issue the turn.
                wantRetry = true;
                const shown = busyAttempt + 1;
                setMessages(prev => prev.map(m =>
                  !m.done && m.role === "ai"
                    ? { ...m, content: `Our AI is busy right now — lots of people are building at once. Retrying… (${shown}/${MAX_BUSY_RETRIES})`, done: false }
                    : m
                ));
              } else {
                setMessages(prev => prev.map(m =>
                  !m.done && m.role === "ai" ? { ...m, content: `${evt.message as string}`, done: true } : m
                ));
                setPhase("idle");
              }
              break;
            }
          }
        }
      }

      if (wantRetry) {
        busyAttempt++;
        // Exponential backoff with jitter, in step with the server-side retries.
        await new Promise(r => setTimeout(r, 1200 * busyAttempt + Math.random() * 600));
        continue retryLoop;
      }
      break retryLoop;
      } // end retryLoop

      setMessages(prev => prev.map(m => !m.done && m.role === "ai" ? { ...m, done: true } : m));
      if (!streamHadError && aiReply.trim()) {
        historyRef.current = [...history, { role: "assistant", content: aiReply }];
      }
      if (phaseRef.current !== "done" && !streamHadError) setPhase("idle");

      // Fire-and-forget: save the completed user+assistant turn to the session
      const sid = activeSessionIdRef.current;
      if (sid !== null && aiReply) {
        fetch(`/api/vibe/sessions/${sid}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token ?? ""}` },
          body: JSON.stringify({ messages: [
            { role: "user",      content: text },
            { role: "assistant", content: aiReply },
          ]}),
        }).catch(() => {});
        setSessions(prev => prev.map(s =>
          s.id === sid ? { ...s, messageCount: s.messageCount + 2, updatedAt: new Date().toISOString() } : s,
        ));
      }

    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") return;
      const msg = err instanceof Error && err.message.startsWith("HTTP")
        ? `Something went wrong (${err.message}). Please try again.`
        : "Something went wrong. Please try again.";
      setMessages(prev => prev.map(m =>
        !m.done && m.role === "ai" ? { ...m, content: msg, done: true } : m
      ));
      setPhase("idle");
    }
  }, [input, viewMode, setPhase, appendAiDelta, attachVoicesToLastMsg, collapseVoicePickers,
      attachNoticeToLastMsg,
      attachPhoneNumbersToLastMsg, collapsePhonePickers, queryClient]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const handleUrlSubmit = useCallback(async () => {
    const raw = urlInputValue.trim();
    if (!raw) return;
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setUrlInputOpen(false);
    setUrlInputValue("");
    const token = localStorage.getItem("voiceorch:session");
    const authHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    let sourceId: number | null = null;
    try {
      const r = await fetch("/api/knowledge-sources", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ type: "website", name: url, url }),
      });
      if (r.ok) {
        const data = await r.json() as { id: number; name: string; type: string; status: string };
        sourceId = data.id;
        if (!vibeKbSourceIdsRef.current.includes(data.id)) {
          vibeKbSourceIdsRef.current = [...vibeKbSourceIdsRef.current, data.id];
          setVibeKbSources(prev => prev.find(s => s.id === data.id) ? prev : [...prev, { id: data.id, name: url, type: "website", status: data.status ?? "processing" }]);
        }
      }
    } catch { /* non-fatal */ }
    // If a source was created, fire a chat message so the AI knows about it
    if (sourceId) {
      send(`[Website Knowledge Source — ${url}]\n\nI've connected this website. Please crawl and index it for the agent's knowledge base.`);
    }
  }, [urlInputValue, send]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const isBinary = /\.(pdf|docx)$/i.test(file.name) ||
      file.type === "application/pdf" ||
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    const isPlainText = ["text/plain","text/csv","text/markdown","application/json","text/html"].includes(file.type) ||
      /\.(txt|md|csv|json|html)$/i.test(file.name);

    if (!isBinary && !isPlainText) {
      alert("Please upload a .txt, .md, .csv, .json, .html, .pdf, or .docx file.");
      return;
    }

    const token = localStorage.getItem("voiceorch:session");
    const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    // Show a pending card immediately while uploading
    const tempId = Date.now(); // safe: DB IDs are small integers
    setVibeKbSources(prev => [...prev, { id: tempId, name: file.name, type: "file", status: "processing" }]);

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("name", file.name);
      const r = await fetch("/api/knowledge-sources/upload", {
        method: "POST",
        headers: authHeaders,
        body: form,
      });
      if (r.ok) {
        const data = await r.json() as { id: number; name: string; type: string; status?: string };
        // Replace pending card with real source
        setVibeKbSources(prev => [
          ...prev.filter(s => s.id !== tempId),
          { id: data.id, name: data.name ?? file.name, type: data.type ?? "file", status: data.status ?? "active" },
        ]);
        if (!vibeKbSourceIdsRef.current.includes(data.id)) {
          vibeKbSourceIdsRef.current = [...vibeKbSourceIdsRef.current, data.id];
        }
        // Only notify the AI after confirmed indexing — no raw content injected into
        // the prompt (avoids baking KB content into the generated system prompt).
        send(`I've attached "${file.name}" as a knowledge base document. It has been indexed and will be retrieved automatically during calls.`);
      } else {
        setVibeKbSources(prev => prev.map(s => s.id === tempId ? { ...s, status: "failed" } : s));
        send(`I tried to attach "${file.name}" but the upload failed. Please try again.`);
      }
    } catch {
      setVibeKbSources(prev => prev.map(s => s.id === tempId ? { ...s, status: "failed" } : s));
      send(`I tried to attach "${file.name}" but encountered an upload error. Please try again.`);
    }
  }, [send]);

  const loadHistorySession = useCallback(async (id: number) => {
    const token = getToken();
    try {
      const resp = await fetch(`/api/vibe/sessions/${id}/messages`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!resp.ok) return;
      const msgs = await resp.json() as { id: number; role: string; content: string; createdAt: string }[];
      const chatMsgs: ChatMsg[] = msgs.map(m => ({
        id: String(m.id),
        role: m.role === "user" ? "user" : "ai",
        content: m.content,
        done: true,
      }));
      setMessages(chatMsgs.length > 0 ? chatMsgs : [{
        id: "empty",
        role: "ai",
        content: "This session has no messages yet.",
        done: true,
      }]);
      historyRef.current = msgs.map(m => ({
        role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      }));
      activeSessionIdRef.current = id;
      setActiveSessionId(id);
      setViewMode("history");
    } catch { /* silently fail */ }
  }, []);

  const startNewChat = useCallback(() => {
    activeSessionIdRef.current = null;
    setActiveSessionId(null);
    setViewMode("editing");
    const agentName = (refineBaseRef.current?.agentName as string) ?? "your agent";
    setMessages([{
      id: uid(),
      role: "ai",
      done: true,
      content: `I've loaded **${agentName}** — you can see the current setup on the right. What would you like to change?`,
    }]);
    historyRef.current = [];
  }, []);

  const canSend = input.trim().length > 0
    && phase !== "building" && phase !== "thinking" && phase !== "streaming" && phase !== "done"
    && viewMode === "editing";

  const hasRightContent = fields.length > 0 || selectedVoice.length > 0 || features.length > 0
    || vibeTools.length > 0 || dispositions.length > 0 || promptPreview.length > 0 || createdId !== null
    || callFlowNotes.length > 0 || kbNotes.length > 0 || vibeKbSources.length > 0;

  const previewWorthy = hasRightContent || showTestCall || showKbPanel || showCalPanel
    || postBuildStep !== null || lastSavedAgentId !== null;

  useEffect(() => {
    if (previewWorthy) setPreviewOpen(true);
  }, [previewWorthy]);

  // Landing = no user message yet and not refine mode
  const chatStarted = messages.length > 1 || !!refineId || refineLoading;

  const isThinking = phase === "thinking" || phase === "streaming" || phase === "building";

  useEffect(() => {
    if (phase !== "thinking") {
      setSlowThink(false);
      return;
    }
    setSlowThink(false);
    const t = window.setTimeout(() => setSlowThink(true), 12000);
    return () => window.clearTimeout(t);
  }, [phase]);

  /* ── shared input block ───────────────────────────────────────────────────── */
  const inputBlock = (isLanding: boolean) => {
    const urlPopover = urlInputOpen && (
      <div className={cn(
        "absolute flex items-center gap-1.5 z-20",
        isLanding ? "left-4 bottom-14" : "right-20 bottom-2.5",
      )}>
        <Input
          autoFocus
          value={urlInputValue}
          onChange={e => setUrlInputValue(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleUrlSubmit(); } if (e.key === "Escape") { setUrlInputOpen(false); setUrlInputValue(""); } }}
          placeholder="https://example.com"
          className="h-8 w-48 text-xs border-border/60 bg-background"
        />
        <button
          onClick={() => void handleUrlSubmit()}
          className="h-8 px-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
        >Add</button>
        <button
          onClick={() => { setUrlInputOpen(false); setUrlInputValue(""); }}
          className="h-8 px-2 rounded-lg text-muted-foreground hover:bg-muted/60 text-xs transition-colors"
        ><X className="h-3.5 w-3.5" /></button>
      </div>
    );

    if (isLanding) {
      return (
        <div className="relative w-full group vibe-input-glow rounded-[26px]">
          <div className="relative rounded-[26px] border border-border/30 bg-card/60 dark:bg-card/50 backdrop-blur-2xl shadow-[0_8px_40px_rgba(0,0,0,0.2)] dark:shadow-[0_8px_48px_rgba(0,0,0,0.45)] transition-all group-focus-within:border-border/50">
            <Textarea
              ref={chatInputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={phase === "done" ? "Your agent is ready!" : "Describe the voice agent you want to build…"}
              disabled={phase === "done" || phase === "building"}
              rows={3}
              className="resize-none border-0 bg-transparent text-[15px] leading-relaxed rounded-[26px] rounded-b-none px-5 pt-5 pb-2 min-h-[88px] placeholder:text-muted-foreground/45 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none"
            />
            <div className="flex items-center justify-between gap-3 px-3 pb-3">
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => { setUrlInputOpen(v => !v); setUrlInputValue(""); }}
                  disabled={phase === "done" || phase === "building" || isThinking}
                  title="Add website URL for knowledge base"
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all disabled:opacity-30",
                    urlInputOpen && "text-foreground bg-muted/50",
                  )}
                >
                  <Globe className="h-4 w-4" />
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={phase === "done" || phase === "building" || isThinking}
                  title="Upload document for knowledge base"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all disabled:opacity-30"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
              </div>
              <Button
                size="icon"
                onClick={() => send()}
                disabled={!canSend}
                className={cn(
                  "h-9 w-9 rounded-full transition-all duration-200 shrink-0",
                  canSend
                    ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-md hover:scale-105"
                    : "bg-muted/60 text-muted-foreground",
                )}
              >
                {isThinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
              </Button>
            </div>
            {urlPopover}
          </div>
          <input ref={fileInputRef} type="file" accept=".txt,.md,.csv,.json,.html,.pdf,.docx" className="hidden" onChange={handleFileUpload} />
        </div>
      );
    }

    return (
      <div className="relative">
        <Textarea
          ref={chatInputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={phase === "done" ? "Your agent is ready!" : "Describe the AI voice agent you want to build…"}
          disabled={phase === "done" || phase === "building"}
          rows={3}
          className="resize-none pr-20 text-sm rounded-xl bg-muted/20 border-border/50 focus-visible:ring-1 focus-visible:ring-primary/50"
        />
        <input ref={fileInputRef} type="file" accept=".txt,.md,.csv,.json,.html,.pdf,.docx" className="hidden" onChange={handleFileUpload} />
        {urlPopover}
        <button
          onClick={() => { setUrlInputOpen(v => !v); setUrlInputValue(""); }}
          disabled={phase === "done" || phase === "building" || isThinking}
          title="Add website URL for knowledge base"
          className={cn(
            "absolute right-20 bottom-2.5 flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-lg transition-all disabled:opacity-30",
            urlInputOpen && "text-primary",
          )}
        >
          <Globe className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={phase === "done" || phase === "building" || isThinking}
          title="Upload document for knowledge base"
          className="absolute right-11 bottom-2.5 flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-lg transition-all disabled:opacity-30"
        >
          <Paperclip className="h-3.5 w-3.5" />
        </button>
        <Button
          size="icon"
          onClick={() => send()}
          disabled={!canSend}
          className={cn(
            "absolute right-2.5 bottom-2.5 h-8 w-8 rounded-lg transition-all duration-200",
            canSend ? "bg-primary hover:bg-primary/90 shadow-sm" : "bg-muted text-muted-foreground",
          )}
        >
          {isThinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </Button>
      </div>
    );
  };

  /* ─ render ──────────────────────────────────────────────────────────────── */
  return (
    <div className="fixed inset-0 bg-background overflow-hidden">

      {/* ══ Landing view — before first message ════════════════════════════ */}
      {!chatStarted && (
        <div className="relative flex flex-col h-full min-h-0 overflow-hidden bg-background">
          <VibeAmbientBg />

          {/* Floating top bar */}
          <header className="relative z-10 flex items-center justify-between px-5 sm:px-8 h-14 shrink-0">
            <BrandMark iconSize={22} wordmarkHeight={15} gapClass="gap-2" />
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-full border-border/60 bg-background/40 backdrop-blur-md text-foreground/80 hover:text-foreground hover:bg-card/60"
                onClick={() => navigate("/app/command-center")}
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
                Skip to dashboard
              </Button>
            </div>
          </header>

          {/* Centered hero */}
          <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-5 sm:px-8 pb-8 overflow-y-auto">
            <div className="w-full max-w-3xl mx-auto flex flex-col items-center text-center">
              <motion.div
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
                className="mb-8 vibe-orb relative"
              >
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-[#7c6cf0]/40 via-[#a9b4e0]/25 to-[#d8dcec]/30 blur-2xl scale-[2] opacity-55" />
                <div className="relative h-16 w-16 rounded-2xl border border-white/10 bg-card/40 backdrop-blur-xl flex items-center justify-center shadow-2xl">
                  <Sparkles className="h-7 w-7 text-foreground/90" />
                </div>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.08 }}
                className="font-display text-4xl sm:text-5xl md:text-[3.25rem] font-semibold tracking-tight leading-[1.08] text-foreground"
              >
                {isThinking ? (
                  <span className="text-muted-foreground">Configuring your agent…</span>
                ) : welcomeName ? (
                  <>
                    <span className="block text-muted-foreground/80 font-normal text-2xl sm:text-3xl mb-1">
                      Hi {welcomeName.split(" ")[0]}
                    </span>
                    <span className="bg-gradient-to-r from-[#7c6cf0] via-[#a9b4e0] to-[#d8dcec] bg-clip-text text-transparent">
                      what are we building?
                    </span>
                  </>
                ) : (
                  <>
                    <span className="bg-gradient-to-r from-[#7c6cf0] via-[#a9b4e0] to-[#d8dcec] bg-clip-text text-transparent">
                      Build a voice agent
                    </span>
                    <span className="block text-muted-foreground/70 dark:text-white/70 font-normal text-2xl sm:text-3xl mt-1">
                      in plain English
                    </span>
                  </>
                )}
              </motion.h1>

              {!isThinking && (
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: 0.16 }}
                  className="mt-4 text-[15px] sm:text-base text-muted-foreground/80 dark:text-white/75 leading-relaxed max-w-lg"
                >
                  Tell me the use case — I&apos;ll wire up speech, language, tools, and your system prompt.
                </motion.p>
              )}

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.22 }}
                className="mt-10 w-full max-w-2xl"
              >
                {inputBlock(true)}
              </motion.div>

              {!isThinking && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.45, delay: 0.32 }}
                  className="mt-6 w-full max-w-2xl"
                >
                  <div className="flex flex-wrap justify-center gap-2">
                    {QUICK_SUGGESTIONS.slice(0, 5).map((s, i) => (
                      <motion.button
                        key={s.label}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.35 + i * 0.04 }}
                        type="button"
                        onClick={() => send(s.message)}
                        className="px-4 py-2 rounded-full text-[13px] font-medium border border-border/40 bg-background/40 text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-card/50 backdrop-blur-md transition-all hover:scale-[1.03] active:scale-[0.97]"
                      >
                        {s.label}
                      </motion.button>
                    ))}
                  </div>
                </motion.div>
              )}

              {!isThinking && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.45, delay: 0.42 }}
                  className="mt-12 w-full"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/40 dark:text-white/45 mb-4">
                    Start from a template
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 max-w-3xl mx-auto">
                    {VIBE_TEMPLATES.slice(0, 4).map(t => (
                      <button
                        key={t.title}
                        type="button"
                        onClick={() => send(t.message)}
                        className="group relative text-left rounded-2xl border border-border/30 dark:border-white/10 bg-card/20 dark:bg-white/[0.06] backdrop-blur-xl p-4 overflow-hidden transition-all hover:border-border/60 hover:bg-card/40 dark:hover:bg-white/[0.1] hover:scale-[1.02] active:scale-[0.98]"
                      >
                        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#7c6cf0]/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        <p className="text-[13px] font-semibold text-foreground truncate">{t.title}</p>
                        <p className="mt-1.5 text-[11px] text-muted-foreground/70 dark:text-white/60 line-clamp-2 leading-snug">{t.desc}</p>
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => send(VIBE_TEMPLATES[4]!.message)}
                      className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    >
                      + Restaurant bookings
                    </button>
                  </div>

                  {/* Clear alternative paths so new users aren't stuck on this screen */}
                  <div className="mt-8 pt-6 border-t border-border/20 flex flex-col sm:flex-row items-center justify-center gap-3">
                    <span className="text-[12px] text-muted-foreground/60">Prefer to do it yourself?</span>
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => navigate("/app/agents?create=1")}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium border border-border/50 bg-background/40 text-foreground/80 hover:text-foreground hover:border-border/80 hover:bg-card/50 backdrop-blur-md transition-all"
                      >
                        <PlusCircle className="h-3.5 w-3.5" /> Build from scratch
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate("/app/command-center")}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium border border-border/50 bg-background/40 text-foreground/80 hover:text-foreground hover:border-border/80 hover:bg-card/50 backdrop-blur-md transition-all"
                      >
                        <LayoutDashboard className="h-3.5 w-3.5" /> Explore dashboard
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ Chat — Gemini-style centered conversation ════════════════════ */}
      {chatStarted && (
        <div className="relative flex flex-col h-full overflow-hidden animate-in fade-in duration-300">
          <VibeAmbientBg />

          {/* Floating header */}
          <header className="relative z-10 flex items-center justify-between px-4 sm:px-6 h-14 shrink-0 border-b border-border/20 bg-background/60 backdrop-blur-xl">
            <div className="flex items-center gap-2 min-w-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 rounded-full text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => navigate("/app/command-center")}
              >
                <LayoutDashboard className="h-4 w-4" />
              </Button>
              {refineId != null && sessions.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden h-10 w-10 rounded-full text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => setSidebarOpen(true)}
                  aria-label="Open history"
                >
                  <History className="h-4 w-4" />
                </Button>
              )}
              <div className="flex items-center gap-2 min-w-0">
                <div className={cn(
                  "h-7 w-7 rounded-lg border flex items-center justify-center overflow-hidden p-1 shrink-0 transition-all",
                  isThinking ? "border-primary/40 bg-primary/10" : "border-border/40 bg-card/40",
                )}>
                  <img src="/snapserve-icon.png" alt="" className="h-full w-full object-contain" />
                </div>
                <div className="min-w-0 hidden sm:block">
                  <p className="font-semibold text-sm leading-none truncate">Vibe Build</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                    {refineId ? "Refining agent" : "AI agent builder"}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {(refineLoading || isThinking) && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mr-1">
                  {refineLoading
                    ? <><Loader2 className="h-3 w-3 animate-spin" /> Loading…</>
                    : <><span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                      {phase === "thinking"
                        ? (slowThink ? "Still thinking — Gemini can take a bit…" : "Thinking…")
                        : phase === "streaming" ? "Responding…" : statusMsg || "Configuring…"}</>}
                </div>
              )}
              {previewWorthy && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 rounded-full text-muted-foreground hover:text-foreground"
                  onClick={() => setPreviewOpen(v => !v)}
                >
                  {previewOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline text-xs">{previewOpen ? "Hide" : "Preview"}</span>
                </Button>
              )}
              <ThemeToggle />
            </div>
          </header>

          <div className="relative z-10 flex flex-1 min-h-0">
            {refineId != null && sessions.length > 0 && (
              <VibeSidebar
                sessions={sessions}
                activeSessionId={activeSessionId}
                viewMode={viewMode}
                onSelectSession={(id) => {
                  loadHistorySession(id);
                  if (isMobile) setSidebarOpen(false);
                }}
                onNewChat={startNewChat}
                open={sidebarOpen}
                onToggle={() => setSidebarOpen(o => !o)}
              />
            )}

            {/* Centered chat column */}
            <div className={cn(
              "flex flex-col flex-1 min-w-0 transition-all duration-300 ease-out",
              previewOpen && previewWorthy && "lg:max-w-[calc(100%-min(520px,42vw))]",
            )}>
              <div className="flex-1 overflow-y-auto">
                <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-7">
                  {messages.map(msg => (
                    <MessageBubble
                      key={msg.id}
                      msg={msg}
                      selectedVoice={selectedVoice}
                      playingVoice={playingVoice}
                      onPreview={vid => previewVoice(vid, setPlayingVoice)}
                      onSelect={v => {
                        collapseVoicePickers();
                        setSelectedVoice(v.voiceName);
                        // Do NOT update selectedVoiceIdRef before the request — the server
                        // compares it to detect a new pick. Confirm via voice_selected SSE.
                        send(`I'll go with ${v.voiceName} (voiceId: ${v.voiceId})`);
                      }}
                      selectedNumber={selectedNumber}
                      onAssignNumber={n => {
                        collapsePhonePickers();
                        setSelectedNumber(n.number);
                        send(`Assign ${n.number} (number id ${n.id}) as the inbound number`);
                      }}
                      onSkipNumber={() => {
                        collapsePhonePickers();
                        send("Skip the phone number for now");
                      }}
                    />
                  ))}
                  {phase === "thinking" && <ThinkingLogo />}
                  <div ref={chatEndRef} className="h-4" />
                </div>
              </div>

              {/* Bottom input — same premium card as landing */}
              <div className="shrink-0 px-4 sm:px-6 pb-5 pt-2 pb-safe bg-gradient-to-t from-background via-background/95 to-transparent">
                <div className="max-w-2xl mx-auto">
                  {viewMode === "history" ? (
                    <div className="flex items-center justify-between rounded-2xl border border-border/40 bg-card/40 backdrop-blur-xl px-4 py-3 gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <History className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <p className="text-xs text-muted-foreground truncate">Historical conversation · read only</p>
                      </div>
                      <Button size="sm" variant="outline" className="h-10 min-h-10 gap-1.5 text-xs rounded-full shrink-0"
                        onClick={startNewChat}>
                        <PlusCircle className="h-3 w-3" /> New Chat
                      </Button>
                    </div>
                  ) : (
                    inputBlock(true)
                  )}
                </div>
              </div>
            </div>

          {/* ── Preview panel — slides in when agent config appears ─────── */}
          {previewOpen && previewWorthy && (
          <div className={cn(
            "flex flex-col vibe-glass border animate-in slide-in-from-right duration-300",
            "fixed inset-0 z-40 lg:relative lg:inset-auto lg:z-auto",
            "lg:w-[min(520px,42vw)] lg:shrink-0 lg:border-l lg:rounded-none",
          )}>

            {/* Header */}
            <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-white/10 dark:border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-lg bg-white/10 dark:bg-white/10 border border-white/10 flex items-center justify-center backdrop-blur-sm">
                  <Zap className="h-3.5 w-3.5 text-foreground/80" />
                </div>
                <div>
                  <p className="font-semibold text-sm leading-none">Agent Preview</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                    {showTestCall                    ? "Live test in progress" :
                     postBuildStep === "hype"        ? "Your agent is ready!" :
                     postBuildStep === "rating"      ? "Launch your agent" :
                     !hasRightContent               ? "Waiting for your description…" :
                     phase === "building"            ? (statusMsg || "Configuring…") :
                     phase === "done"               ? "Ready to deploy" :
                     (refineId && phase === "idle")  ? "Agent loaded — tell me what to change" :
                                                      "Building up as we chat"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-full lg:hidden text-muted-foreground shrink-0"
                  onClick={() => setPreviewOpen(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              {lastSavedAgentId !== null && (
                <>
                  <Button
                    size="sm"
                    variant={showTestCall ? "default" : "outline"}
                    className="h-7 gap-1.5 text-xs rounded-lg bg-white/5 border-white/15 backdrop-blur-sm"
                    disabled={isThinking && !showTestCall}
                    onClick={() => {
                      if (showTestCall) {
                        setShowTestCall(false);
                        // Closing the live test on a freshly built agent should land
                        // on the launch step, not loop back to the hype screen.
                        if (refineId == null) setPostBuildStep("rating");
                      } else {
                        setShowTestCall(true);
                      }
                    }}
                  >
                    <Phone className="h-3 w-3" />
                    {showTestCall ? "Close Test" : "Test Web Call"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-xs rounded-lg bg-white/5 border-white/15 backdrop-blur-sm"
                    disabled={isThinking}
                    onClick={() => setCallDialogOpen(true)}
                  >
                    <PhoneOutgoing className="h-3 w-3" /> Make a Call
                  </Button>
                  {phase === "done" && (
                    <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs rounded-lg bg-white/5 border-white/15"
                      onClick={() => navigate(`/app/agents/${lastSavedAgentId}`)}>
                      <Settings2 className="h-3 w-3" /> Edit
                    </Button>
                  )}
                </>
              )}
              </div>
            </div>

            <div className={cn("flex-1 min-h-0", showTestCall ? "flex flex-col overflow-hidden p-4" : "overflow-y-auto px-8 py-8")}>
              {showTestCall ? (
                <WebcallPanel
                  agentId={lastSavedAgentId!}
                  agentName={createdName || "Agent"}
                  compact
                  onClose={() => { setShowTestCall(false); setPostBuildStep("rating"); }}
                />
              ) : showKbPanel ? (
                <VibeKbPanel
                  sources={vibeKbSources}
                  urlInputOpen={urlInputOpen}
                  urlInputValue={urlInputValue}
                  onUrlChange={setUrlInputValue}
                  onUrlToggle={() => setUrlInputOpen(v => !v)}
                  onUrlSubmit={handleUrlSubmit}
                  onFileClick={() => fileInputRef.current?.click()}
                  onDone={() => {
                    kbDoneRef.current = true;
                    setShowKbPanel(false);
                    if (vibeKbSources.length > 0) {
                      send("I've added my knowledge base documents. Continue.");
                    } else {
                      send("Skip the knowledge base for now. Continue.");
                    }
                  }}
                />
              ) : showCalPanel && schedulingSetup && (lastSavedAgentId ?? createdId) != null ? (
                <VibeCalendarPanel
                  agentId={(lastSavedAgentId ?? createdId)!}
                  agentName={createdName || "Agent"}
                  timezone={schedulingSetup.timezone}
                  onDone={() => { setShowCalPanel(false); setPostBuildStep("hype"); }}
                />
              ) : postBuildStep === "hype" ? (
                <HypePanel
                  name={createdName}
                  agentId={(lastSavedAgentId ?? createdId)!}
                  fields={fields}
                  selectedVoice={selectedVoice}
                  onTest={() => setShowTestCall(true)}
                  onSkip={() => setPostBuildStep("rating")}
                  navigate={navigate}
                />
              ) : postBuildStep === "rating" ? (
                <RatingPanel
                  name={createdName}
                  agentId={(lastSavedAgentId ?? createdId)!}
                  rating={vibeRating}
                  onRate={setVibeRating}
                  comment={vibeComment}
                  onComment={setVibeComment}
                  onRefine={() => navigate(`/app/vibe?refine=${lastSavedAgentId ?? createdId}`)}
                  onTestAgain={() => setShowTestCall(true)}
                  onLaunch={() => navigate(`/app/agents/${lastSavedAgentId ?? createdId}`)}
                />
              ) : !hasRightContent ? (
                <EmptyState />
              ) : (
            <div className="max-w-2xl space-y-8">

              {/* Agent Config */}
              {fields.length > 0 && (
                <Section title="Configuration">
                  <div className="grid grid-cols-2 gap-2">
                    {fields.map(f => <FieldCard key={f.key} field={f} />)}
                  </div>
                </Section>
              )}

              {/* Voice — only the currently selected voice; the full list lives in the chat */}
              {selectedVoice && (
                <Section title="Voice">
                  <div className="flex items-center gap-2.5 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
                    <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-primary">{selectedVoice}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Voice selected · Cartesia Sonic 3.5</p>
                    </div>
                  </div>
                </Section>
              )}

              {/* Call Flow */}
              {callFlowNotes && (
                <Section title="Call Flow">
                  <NoteCard icon={<FileText className="h-3.5 w-3.5" />} text={callFlowNotes} />
                </Section>
              )}

              {/* Knowledge Base */}
              {(kbNotes || vibeKbSources.length > 0) && (
                <Section title="Knowledge Base">
                  {kbNotes && <NoteCard icon={<BookOpen className="h-3.5 w-3.5" />} text={kbNotes} />}
                  {vibeKbSources.length > 0 && (
                    <div className="space-y-1.5">
                      {vibeKbSources.map(s => {
                        const isNonTerminal = s.status === "validating" || s.status === "processing" || s.status === "crawling";
                        const isFailed = s.status === "failed";
                        const isWebsite = s.type === "website";
                        return (
                          <div key={s.id} className={cn(
                            "flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5",
                            isFailed ? "border-destructive/30 bg-destructive/5"
                              : isNonTerminal ? "border-amber-500/30 bg-amber-500/5"
                              : "border-emerald-500/30 bg-emerald-500/5",
                          )}>
                            {isWebsite
                              ? <Globe className={cn("h-3.5 w-3.5 shrink-0", isFailed ? "text-destructive" : isNonTerminal ? "text-amber-500" : "text-emerald-500")} />
                              : <FileText className={cn("h-3.5 w-3.5 shrink-0", isFailed ? "text-destructive" : isNonTerminal ? "text-amber-500" : "text-emerald-500")} />}
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">{s.name}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {isFailed ? "Failed to index" : isNonTerminal ? (s.status === "validating" ? "Validating URL…" : s.status === "crawling" ? "Crawling pages…" : "Processing…") : `Indexed · ${s.type}`}
                              </p>
                            </div>
                            {isNonTerminal
                              ? <Loader2 className="h-3.5 w-3.5 text-amber-500 animate-spin shrink-0" />
                              : isFailed
                              ? <X className="h-3.5 w-3.5 text-destructive shrink-0" />
                              : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Section>
              )}

              {/* Languages */}
              {langPills.length > 0 && (
                <Section title="Languages">
                  <div className="flex flex-wrap gap-2">
                    {langPills.map(p => (
                      <span key={p.code} className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/20 px-3 py-1 text-xs font-medium text-primary">
                        <Globe className="h-3 w-3" /> {p.label}
                      </span>
                    ))}
                  </div>
                </Section>
              )}

              {/* Features */}
              {features.length > 0 && (
                <Section title="Features">
                  <div className="grid grid-cols-2 gap-2">
                    {features.map(f => <FeatureChip key={f.key} feature={f} />)}
                  </div>
                </Section>
              )}

              {/* Tools — only rendered when scheduling is enabled (at least one tool selected) */}
              {vibeTools.some(s => s.tools.some(t => t.enabled)) && (
                <Section title="Tools">
                  {vibeTools.map(section => (
                    <div key={section.category} className="space-y-1.5">
                      <div className="grid grid-cols-1 gap-1.5">
                        {section.tools.map(tool => (
                          <div
                            key={tool.toolType}
                            className={cn(
                              "flex items-center gap-3 rounded-xl border px-3.5 py-2.5",
                              tool.enabled
                                ? "border-emerald-500/30 bg-emerald-500/5"
                                : "border-border/40 bg-muted/20 opacity-50",
                            )}
                          >
                            <div className={cn(
                              "flex h-6 w-6 items-center justify-center rounded-full shrink-0",
                              tool.enabled ? "bg-emerald-500/15" : "bg-muted",
                            )}>
                              {tool.enabled
                                ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                : <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={cn("text-xs font-medium", tool.enabled ? "text-foreground" : "text-muted-foreground")}>{tool.label}</p>
                              {tool.statusNote && <p className="text-[10px] text-muted-foreground">{tool.statusNote}</p>}
                            </div>
                            <span className={cn(
                              "text-[10px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0",
                              tool.enabled
                                ? "text-emerald-700 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                                : "text-muted-foreground border-border/40 bg-background",
                            )}>
                              {tool.enabled ? "Selected" : "Off"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </Section>
              )}

              {/* Scheduling Setup Wizard */}
              {schedulingSetup && (lastSavedAgentId ?? createdId) != null && (
                <Section title="Scheduling Setup">
                  <VibeSchedulingWizard
                    agentId={(lastSavedAgentId ?? createdId)!}
                    timezone={schedulingSetup.timezone}
                    agentName={createdName || undefined}
                  />
                </Section>
              )}

              {/* Call Outcomes */}
              {dispositions.length > 0 && (
                <Section title="Call Outcomes">
                  <div className="space-y-2">
                    {dispositions.map((d, i) => <DispositionRow key={d.category} d={d} i={i} />)}
                  </div>
                </Section>
              )}

              {/* System Prompt */}
              {promptPreview && (
                <Section title="System Prompt">
                  <div className="rounded-xl border vibe-glass-card p-4 max-h-[280px] overflow-y-auto">
                    <p className="text-[11px] text-muted-foreground font-mono leading-relaxed whitespace-pre-wrap">
                      {promptPreview}
                      {phase === "building" && (
                        <span className="inline-block w-0.5 h-3.5 bg-primary/70 ml-0.5 align-middle animate-pulse" />
                      )}
                    </p>
                  </div>
                </Section>
              )}

              {/* Done — only show in refine mode (new agents use hype/rating panels) */}
              {phase === "done" && createdId && postBuildStep === null && (
                <DoneCard name={createdName} id={createdId} navigate={navigate} isUpdate={refineId != null} onTestWebCall={() => setShowTestCall(true)} />
              )}
            </div>
          )}
            </div>
          </div>
          )}

          </div>{/* flex row: chat + preview */}

          {/* Outbound telephony call dialog */}
          {lastSavedAgentId !== null && (
            <OutboundCallDialog
              agentId={lastSavedAgentId}
              agentName={createdName || "Agent"}
              telephonyProvider={savedTelephonyProvider}
              open={callDialogOpen}
              onOpenChange={setCallDialogOpen}
            />
          )}
        </div>
      )}

  </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Chat components                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

function MessageBubble({ msg, selectedVoice, playingVoice, onPreview, onSelect, selectedNumber, onAssignNumber, onSkipNumber }: {
  msg: ChatMsg;
  selectedVoice: string;
  playingVoice: string | null;
  onPreview: (id: string) => void;
  onSelect: (v: VoiceOption) => void;
  selectedNumber: string;
  onAssignNumber: (n: PhoneNumberOption) => void;
  onSkipNumber: () => void;
}) {
  const isAi = msg.role === "ai";

  if (!isAi) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-3xl rounded-br-md bg-foreground/[0.06] dark:bg-foreground/[0.08] px-4 py-3">
          <p className="text-[15px] leading-relaxed text-foreground whitespace-pre-wrap">{msg.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-3 items-start">
        <div className="h-8 w-8 rounded-xl bg-card/60 border border-border/30 flex items-center justify-center shrink-0 overflow-hidden p-1.5">
          <img src="/snapserve-icon.png" alt="" className="h-full w-full object-contain" />
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-[15px] leading-[1.65] text-foreground/95 whitespace-pre-wrap">
            {msg.content}
            {!msg.done && msg.content.length > 0 && (
              <span className="inline-block w-0.5 h-[1.1em] bg-foreground/50 ml-0.5 align-middle animate-pulse rounded-sm" />
            )}
          </p>
        </div>
      </div>

      <div className="pl-11 space-y-3">
        {msg.voices && msg.voices.length > 0 && !msg.voicePicked && (
          <VoicePickerList
            voices={msg.voices}
            agentLangs={msg.voiceAgentLangs ?? []}
            selectedVoice={selectedVoice}
            playingVoice={playingVoice}
            onPreview={onPreview}
            onSelect={onSelect}
          />
        )}
        {/* Collapsed voice state */}
        {msg.voices && msg.voices.length > 0 && msg.voicePicked && (
          <div className="flex items-center gap-2 text-[11px] text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="font-medium">{selectedVoice ? `${selectedVoice} selected` : "Voice selected"}</span>
          </div>
        )}
        {/* Distinct notice cards (multi-language heads-up, phone-number info) */}
        {msg.notices?.map((n, i) => (
          <div key={i} className="flex items-start gap-2.5 rounded-xl border border-sky-500/25 bg-sky-500/8 px-3.5 py-3">
            <Info className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
            <p className="text-xs leading-relaxed text-foreground/90">{n.message}</p>
          </div>
        ))}

        {/* Phone-number picker — collapsed once picked/skipped */}
        {msg.phoneNumbers && msg.phoneNumbers.length > 0 && !msg.phoneNumbersPicked && (
          <div className="space-y-2 pt-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              Your phone numbers
            </p>
            <div className="rounded-xl border border-border/60 bg-muted/30 overflow-hidden">
              {msg.phoneNumbers.map(n => (
                <div
                  key={n.id}
                  className="flex items-center gap-3 px-3 py-2.5 border-b border-border/30 last:border-0"
                >
                  <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
                    <PhoneIncoming className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold">{n.number}</p>
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                      {[n.region, n.assignedAgentId != null ? "currently assigned to another agent" : "unassigned"]
                        .filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    className="h-7 rounded-full px-3 text-[11px] shrink-0"
                    onClick={() => onAssignNumber(n)}
                  >
                    Assign
                  </Button>
                </div>
              ))}
            </div>
            <button
              onClick={onSkipNumber}
              className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Skip for now
            </button>
          </div>
        )}
        {/* Collapsed phone-number state */}
        {msg.phoneNumbers && msg.phoneNumbers.length > 0 && msg.phoneNumbersPicked && (
          <div className="flex items-center gap-2 text-[11px] text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="font-medium">{selectedNumber ? `${selectedNumber} connected` : "Phone number step done"}</span>
          </div>
        )}

      </div>
    </div>
  );
}

function VoicePickerList({ voices, agentLangs, selectedVoice, playingVoice, onPreview, onSelect }: {
  voices: VoiceOption[];
  agentLangs: string[];
  selectedVoice: string;
  playingVoice: string | null;
  onPreview: (id: string) => void;
  onSelect: (v: VoiceOption) => void;
}) {
  // Distinct base languages that actually have at least one voice (catalog order preserved)
  const availableLangs = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of voices) {
      const b = baseLang(v.language);
      if (b && !seen.has(b)) { seen.add(b); out.push(b); }
    }
    return out;
  }, [voices]);

  // Default: agent's primary language → any agent language with voices → English → first available
  const defaultLang = useMemo(() => {
    for (const code of agentLangs) {
      const b = baseLang(code);
      if (b && availableLangs.includes(b)) return b;
    }
    if (availableLangs.includes("en")) return "en";
    return availableLangs[0] ?? "";
  }, [agentLangs, availableLangs]);

  const [selectedLang, setSelectedLang] = useState(defaultLang);

  // Re-emitted picker (e.g. agent language changed mid-conversation) → follow the new default
  useEffect(() => { setSelectedLang(defaultLang); }, [defaultLang]);

  const effectiveLang = availableLangs.includes(selectedLang) ? selectedLang : defaultLang;
  const filtered = effectiveLang ? voices.filter(v => baseLang(v.language) === effectiveLang) : voices;

  const renderPill = (v: VoiceOption) => (
    <VoicePill
      key={v.voiceId}
      voice={v}
      isSelected={selectedVoice.includes(v.voiceName)}
      isPlaying={playingVoice === v.voiceId}
      onPreview={() => onPreview(v.voiceId)}
      onSelect={() => onSelect(v)}
    />
  );

  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
          Available voices
        </p>
        {availableLangs.length > 0 && (
          <Select value={effectiveLang} onValueChange={setSelectedLang}>
            <SelectTrigger className="h-6 w-auto min-w-[90px] gap-1 rounded-full border-border/60 bg-background/60 px-2.5 text-[10px] font-medium [&>svg]:h-3 [&>svg]:w-3">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableLangs.map(lang => (
                <SelectItem key={lang} value={lang} className="text-xs">
                  {baseLangLabel(lang)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="max-h-64 overflow-y-auto pr-1 space-y-2">
        {filtered.map(renderPill)}
      </div>
    </div>
  );
}

function VoicePill({ voice, isSelected, isPlaying, onPreview, onSelect }: {
  voice: VoiceOption;
  isSelected: boolean;
  isPlaying: boolean;
  onPreview: () => void;
  onSelect: () => void;
}) {
  return (
    <div className={cn(
      "flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all",
      isSelected
        ? "border-primary/40 bg-primary/8 ring-1 ring-primary/20"
        : "border-border/70 bg-muted/20 hover:border-border",
    )}>
      {/* Headshot avatar */}
      <img
        src={getVoiceAvatar(voice.voiceId, voice.gender, voice.description)}
        alt=""
        className="h-7 w-7 rounded-full object-cover shrink-0 ring-1 ring-border/60"
      />

      {/* Name + desc */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold">{voice.voiceName}</p>
        {voice.description && (
          <p className="text-[10px] text-muted-foreground truncate mt-0.5">{voice.description}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onPreview}
          disabled={isPlaying}
          className={cn(
            "h-6 w-6 rounded-md flex items-center justify-center transition-all",
            isPlaying
              ? "bg-primary/10 text-primary"
              : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
          title="Preview"
        >
          {isPlaying
            ? <Volume2 className="h-3 w-3 animate-pulse" />
            : <Play className="h-3 w-3" />}
        </button>
        {isSelected ? (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-primary">
            <CheckCircle2 className="h-3 w-3" /> Picked
          </span>
        ) : (
          <button
            onClick={onSelect}
            className="rounded-lg bg-primary text-primary-foreground text-[10px] font-semibold px-2.5 py-1 hover:bg-primary/90 transition-colors"
          >
            Select
          </button>
        )}
      </div>
    </div>
  );
}

function ThinkingLogo() {
  return (
    <div className="flex gap-3 items-center">
      <div className="h-8 w-8 rounded-xl bg-card/60 border border-border/30 flex items-center justify-center overflow-hidden p-1.5 shrink-0">
        <img src="/snapserve-icon.png" alt="" className="h-full w-full object-contain opacity-80" />
      </div>
      <div className="flex gap-1 items-center py-2">
        {[0, 150, 300].map(d => (
          <span
            key={d}
            className="h-2 w-2 rounded-full bg-foreground/30 animate-bounce"
            style={{ animationDelay: `${d}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Right panel components                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

function Section({ title, badge, badgeVariant = "neutral", children }: {
  title: string;
  badge?: string;
  badgeVariant?: "neutral" | "success";
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-1 duration-400">
      <div className="flex items-center gap-2">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{title}</p>
        {badge && (
          <span className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold border",
            badgeVariant === "success"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-muted border-border/60 text-muted-foreground",
          )}>
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function FieldCard({ field }: { field: AgentField }) {
  const IconComp = FIELD_ICONS[field.icon] ?? Sparkles;
  return (
    <div className="flex items-center gap-2.5 rounded-xl border vibe-glass-card px-3 py-2.5 animate-in fade-in duration-300">
      <div className="h-6 w-6 rounded-md bg-white/10 dark:bg-white/10 flex items-center justify-center shrink-0">
        <IconComp className="h-3 w-3 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{field.label}</p>
        <p className="text-xs font-medium truncate mt-0.5">{field.value}</p>
      </div>
      <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
    </div>
  );
}

function NoteCard({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="rounded-xl border vibe-glass-card p-4 flex gap-3">
      <div className="text-muted-foreground mt-0.5 shrink-0">{icon}</div>
      <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{text}</p>
    </div>
  );
}

function FeatureChip({ feature }: { feature: FeatureCard }) {
  const Icon = FEATURE_ICONS[feature.icon] ?? Sparkles;
  return (
    <div className={cn(
      "rounded-xl border px-3 py-2.5 flex items-start gap-2.5 transition-all vibe-glass-card",
      !feature.enabled && "opacity-50",
    )}>
      <div className="h-6 w-6 rounded-md bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="h-3 w-3 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-[11px] font-medium truncate">{feature.label}</p>
          <span className={cn(
            "rounded-full px-1.5 py-px text-[9px] font-bold uppercase shrink-0",
            feature.enabled ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground",
          )}>
            {feature.enabled ? "On" : "Off"}
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{feature.detail}</p>
      </div>
    </div>
  );
}

const OUTCOME_COLORS = [
  { bg: "bg-sky-500/8 border-sky-500/20",    tag: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
  { bg: "bg-rose-500/8 border-rose-500/20",  tag: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  { bg: "bg-amber-500/8 border-amber-500/20",tag: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  { bg: "bg-violet-500/8 border-violet-500/20",tag: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
  { bg: "bg-emerald-500/8 border-emerald-500/20",tag: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
];

function DispositionRow({ d, i }: { d: DispositionCard; i: number }) {
  const c = OUTCOME_COLORS[i % OUTCOME_COLORS.length]!;
  const outcomes = d.outcomes ?? [];
  return (
    <div className={cn("rounded-xl border overflow-hidden animate-in fade-in duration-300", c.bg)}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/40">
        <p className="text-[11px] font-semibold">{d.category}</p>
        <span className="text-[10px] text-muted-foreground">{outcomes.length}</span>
      </div>
      <div className="px-4 py-2.5 flex flex-wrap gap-1.5">
        {outcomes.map(o => (
          <span key={o} className={cn("rounded-md border px-2 py-0.5 text-[10px] font-medium", c.tag)}>{o}</span>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  const items = [
    "Voice & language",
    "Call flow & script",
    "Knowledge base",
    "Tools & scheduling",
    "System prompt",
  ];
  return (
    <div className="flex flex-col items-center justify-center min-h-full py-16 text-center gap-8">
      <div className="relative">
        <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-[#7c6cf0]/20 via-[#a9b4e0]/12 to-transparent blur-2xl scale-150" />
        <div className="relative h-20 w-20 rounded-3xl border border-border/30 bg-card/30 backdrop-blur-xl flex items-center justify-center p-3">
          <Sparkles className="h-8 w-8 text-muted-foreground/60" />
        </div>
      </div>
      <div className="max-w-xs">
        <p className="font-display font-semibold text-lg">Live preview</p>
        <p className="text-sm text-muted-foreground/70 mt-2 leading-relaxed">
          Your agent config will appear here as we chat.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2 max-w-sm">
        {items.map(t => (
          <span key={t} className="px-3 py-1.5 rounded-full text-[11px] text-muted-foreground/60 border border-border/30 bg-card/20">
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function VibeKbPanel({
  sources,
  urlInputOpen,
  urlInputValue,
  onUrlChange,
  onUrlToggle,
  onUrlSubmit,
  onFileClick,
  onDone,
}: {
  sources: { id: number; name: string; type: string; status: string }[];
  urlInputOpen: boolean;
  urlInputValue: string;
  onUrlChange: (v: string) => void;
  onUrlToggle: () => void;
  onUrlSubmit: () => void;
  onFileClick: () => void;
  onDone: () => void;
}) {
  const statusIcon = (status: string) =>
    status === "ready"      ? <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 mt-0.5 shrink-0" /> :
    status === "failed"     ? <div className="h-1.5 w-1.5 rounded-full bg-destructive mt-0.5 shrink-0" /> :
                              <div className="h-1.5 w-1.5 rounded-full bg-amber-500 mt-0.5 shrink-0 animate-pulse" />;

  return (
    <div className="flex flex-col gap-6 max-w-2xl py-2">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/8 border border-primary/15 flex items-center justify-center shrink-0">
            <BookOpen className="h-5 w-5 text-primary/70" />
          </div>
          <div>
            <p className="font-semibold text-sm">Knowledge Base</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Upload documents or add website URLs your agent will use to answer questions.
              PDFs, Word docs, CSVs, and plain text are all supported.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant={sources.length > 0 ? "default" : "outline"}
          className="h-7 text-xs rounded-lg shrink-0 ml-4"
          onClick={onDone}
        >
          {sources.length > 0 ? "Done — Continue" : "Skip for now"}
        </Button>
      </div>

      {/* Upload actions */}
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-2 text-xs rounded-lg flex-1"
            onClick={onFileClick}
          >
            <Paperclip className="h-3.5 w-3.5" />
            Upload document
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-2 text-xs rounded-lg flex-1"
            onClick={onUrlToggle}
          >
            <Globe className="h-3.5 w-3.5" />
            Add website URL
          </Button>
        </div>

        {urlInputOpen && (
          <div className="flex items-center gap-2 animate-in slide-in-from-top-1 duration-150">
            <input
              type="url"
              value={urlInputValue}
              onChange={e => onUrlChange(e.target.value)}
              placeholder="https://your-website.com/docs"
              className="flex-1 h-8 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:ring-1 focus:ring-primary/40"
              autoFocus
              onKeyDown={e => {
                if (e.key === "Enter") { e.preventDefault(); onUrlSubmit(); }
                if (e.key === "Escape") { onUrlToggle(); }
              }}
            />
            <Button
              size="sm"
              variant="default"
              className="h-8 text-xs rounded-lg"
              disabled={!urlInputValue.trim()}
              onClick={onUrlSubmit}
            >
              Add
            </Button>
          </div>
        )}
      </div>

      {/* Sources list */}
      {sources.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            Added ({sources.length})
          </p>
          {sources.map(s => (
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-3"
            >
              {statusIcon(s.status)}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{s.name}</p>
                <p className="text-[10px] text-muted-foreground capitalize mt-0.5">
                  {s.type === "url" ? "Website" : s.type === "text" ? "Notes" : "Document"}
                  {" · "}
                  {s.status === "ready" ? "Ready" : s.status === "failed" ? "Failed" : "Processing…"}
                </p>
              </div>
              {s.type === "url"
                ? <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                : <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-6 py-10 flex flex-col items-center gap-3 text-center">
          <BookOpen className="h-7 w-7 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium text-muted-foreground">No documents yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Upload a file or add a URL above — or skip if your agent doesn't need a knowledge base.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function VibeCalendarPanel({
  agentId,
  agentName,
  timezone,
  onDone,
}: {
  agentId: number;
  agentName: string;
  timezone: string;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-6 max-w-2xl py-2">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/8 border border-primary/15 flex items-center justify-center shrink-0">
            <Calendar className="h-5 w-5 text-primary/70" />
          </div>
          <div>
            <p className="font-semibold text-sm">Set up scheduling</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Complete these steps to enable appointment booking for your agent.
              Start by creating a calendar, then connect Google for Meet links and auto-syncing.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs rounded-lg shrink-0 ml-4"
          onClick={onDone}
        >
          Done
        </Button>
      </div>

      {/* Scheduling wizard inline */}
      <VibeSchedulingWizard agentId={agentId} timezone={timezone} agentName={agentName} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  HypePanel — celebratory screen shown right after agent creation            */
/* ═══════════════════════════════════════════════════════════════════════════ */

function HypePanel({ name, fields, selectedVoice, onTest, onSkip, navigate, agentId }: {
  name: string;
  agentId: number;
  fields: { key: string; label: string; value: string }[];
  selectedVoice: string | null;
  onTest: () => void;
  onSkip: () => void;
  navigate: (to: string) => void;
}) {
  const direction = fields.find(f => f.key === "direction")?.value;
  const language  = fields.find(f => f.key === "language")?.value;
  const initial   = (name || "A").charAt(0).toUpperCase();

  const badges = [
    direction && { label: direction === "inbound" ? "Inbound" : "Outbound" },
    language  && { label: language },
    selectedVoice && { label: selectedVoice },
  ].filter(Boolean) as { label: string }[];

  return (
    <div className="flex flex-col items-center text-center gap-6 py-10 px-6 max-w-md mx-auto animate-in fade-in zoom-in-95 duration-500">
      {/* Pulse avatar */}
      <div className="relative flex items-center justify-center">
        <div className="absolute h-28 w-28 rounded-full bg-emerald-500/10 animate-ping" style={{ animationDuration: "2.5s" }} />
        <div className="absolute h-20 w-20 rounded-full bg-emerald-500/15 animate-ping" style={{ animationDuration: "2s" }} />
        <div className="relative h-16 w-16 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/30">
          <span className="text-2xl font-bold text-white">{initial}</span>
        </div>
      </div>

      {/* Headline */}
      <div>
        <p className="text-xs font-medium text-emerald-400 uppercase tracking-widest mb-1">Agent ready</p>
        <h2 className="text-xl font-bold">Meet <span className="text-emerald-400">{name || "your agent"}</span>!</h2>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          Your AI voice agent is live and configured. Hear it speak before you launch — this is the moment you've been building toward.
        </p>
      </div>

      {/* Badges */}
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5 justify-center">
          {badges.map(b => (
            <span key={b.label} className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-muted/40 border border-border/60 text-muted-foreground">
              {b.label}
            </span>
          ))}
        </div>
      )}

      {/* Capability checklist */}
      <div className="w-full rounded-xl border border-border/50 bg-muted/10 p-4 text-left space-y-2">
        {[
          "System prompt written and ready",
          "Voice selected and configured",
          "Call flow and dispositions set",
          "Agent is live — test calls work now",
        ].map(item => (
          <div key={item} className="flex items-center gap-2.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            <span className="text-xs text-muted-foreground">{item}</span>
          </div>
        ))}
      </div>

      {/* CTAs */}
      <div className="flex flex-col gap-2 w-full">
        <Button className="w-full gap-2 rounded-xl h-11 text-sm font-semibold" onClick={onTest}>
          <Phone className="h-4 w-4" /> Hear it speak — Test Web Call
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 gap-1.5 rounded-xl text-xs"
            onClick={() => navigate(`/app/vibe?refine=${agentId}`)}>
            <Sparkles className="h-3.5 w-3.5" /> Refine with AI
          </Button>
          <Button variant="ghost" size="sm" className="flex-1 gap-1.5 rounded-xl text-xs text-muted-foreground"
            onClick={onSkip}>
            Skip to launch →
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  RatingPanel — 5-star review + launch CTA                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

function RatingPanel({ name, agentId, rating, onRate, comment, onComment, onRefine, onTestAgain, onLaunch }: {
  name: string;
  agentId: number;
  rating: number;
  onRate: (r: number) => void;
  comment: string;
  onComment: (c: string) => void;
  onRefine: () => void;
  onTestAgain: () => void;
  onLaunch: () => void;
}) {
  const [hovered, setHovered] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  const handleLaunch = () => {
    setSubmitted(true);
    onLaunch();
  };

  const starLabel = ["", "Poor", "Fair", "Good", "Great", "Amazing!"][Math.max(rating, hovered)] ?? "";

  return (
    <div className="flex flex-col items-center text-center gap-6 py-10 px-6 max-w-md mx-auto animate-in fade-in zoom-in-95 duration-500">
      {/* Icon */}
      <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
        <Rocket className="h-7 w-7 text-primary" />
      </div>

      {/* Headline */}
      <div>
        <h2 className="text-lg font-bold">Ready to launch <span className="text-primary">{name || "your agent"}</span>?</h2>
        <p className="text-sm text-muted-foreground mt-1.5">
          Before you go — how was your Vibe Builder experience?
        </p>
      </div>

      {/* Stars */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              onMouseEnter={() => setHovered(n)}
              onMouseLeave={() => setHovered(0)}
              onClick={() => onRate(n)}
              className="transition-transform hover:scale-110"
            >
              <Star
                className={cn(
                  "h-8 w-8 transition-colors",
                  n <= (hovered || rating) ? "text-amber-400 fill-amber-400" : "text-muted-foreground/30",
                )}
              />
            </button>
          ))}
        </div>
        <p className={cn("text-xs font-medium transition-opacity h-4", starLabel ? "opacity-100 text-amber-400" : "opacity-0")}>
          {starLabel}
        </p>
      </div>

      {/* Optional comment */}
      <Textarea
        value={comment}
        onChange={e => onComment(e.target.value)}
        placeholder="Any feedback? (optional)"
        rows={2}
        className="text-sm rounded-xl resize-none w-full"
      />

      {/* CTAs */}
      <div className="flex flex-col gap-2 w-full">
        <Button
          className="w-full gap-2 rounded-xl h-11 text-sm font-semibold"
          onClick={handleLaunch}
          disabled={submitted}
        >
          <Rocket className="h-4 w-4" />
          {submitted ? "Launching…" : `Launch ${name || "Agent"}`}
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 gap-1.5 rounded-xl text-xs" onClick={onTestAgain}>
            <Phone className="h-3.5 w-3.5" /> Test again
          </Button>
          <Button variant="ghost" size="sm" className="flex-1 gap-1.5 rounded-xl text-xs text-muted-foreground" onClick={onRefine}>
            <Sparkles className="h-3.5 w-3.5" /> Make changes
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */

function DoneCard({ name, id, navigate, isUpdate, onTestWebCall }: {
  name: string;
  id: number;
  navigate: (to: string) => void;
  isUpdate?: boolean;
  onTestWebCall: () => void;
}) {
  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center space-y-4 animate-in fade-in zoom-in-95 duration-500">
      <div className="flex justify-center">
        <div className="h-12 w-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
          <CheckCircle2 className="h-6 w-6 text-emerald-500" />
        </div>
      </div>
      <div>
        <p className="font-semibold"><span className="text-emerald-400">{name}</span> {isUpdate ? "updated" : "is live"}</p>
        <p className="text-xs text-muted-foreground mt-1">Providers configured · System prompt ready · Dispositions set</p>
      </div>
      <div className="flex flex-wrap gap-2 justify-center">
        <Button size="sm" className="gap-1.5 rounded-xl" onClick={onTestWebCall}>
          <Phone className="h-3.5 w-3.5" /> Test Web Call
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5 rounded-xl"
          onClick={() => navigate(`/app/agents/${id}`)}>
          <Settings2 className="h-3.5 w-3.5" /> Edit agent <ArrowUpRight className="h-3 w-3" />
        </Button>
        <Button size="sm" variant="ghost" className="gap-1.5 rounded-xl"
          onClick={() => navigate(`/app/vibe?refine=${id}`)}>
          <Sparkles className="h-3.5 w-3.5" /> Refine with AI
        </Button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  VibeSidebar — chat history sidebar (refine mode only)                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

function getRelativeTime(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  } catch { return ""; }
}

function VibeSidebar({
  sessions, activeSessionId, viewMode, onSelectSession, onNewChat, open, onToggle,
}: {
  sessions: SessionSummary[];
  activeSessionId: number | null;
  viewMode: "editing" | "history";
  onSelectSession: (id: number) => void;
  onNewChat: () => void;
  open: boolean;
  onToggle: () => void;
}) {
  const isMobile = useIsMobile();

  const sessionList = (
    <div className="flex-1 overflow-y-auto py-1.5">
      {sessions.map(session => {
        const isActive = session.id === activeSessionId;
        const isViewing = isActive && viewMode === "history";
        return (
          <button
            key={session.id}
            onClick={() => onSelectSession(session.id)}
            className={cn(
              "w-full text-left px-3 py-3 md:py-2.5 hover:bg-muted/50 transition-colors border-l-2 min-h-[44px]",
              isViewing
                ? "bg-primary/8 border-primary"
                : isActive && viewMode === "editing"
                  ? "border-primary/40 bg-primary/5"
                  : "border-transparent",
            )}
          >
            <p className="text-xs font-medium truncate text-foreground leading-snug">{session.title}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{getRelativeTime(session.updatedAt)}</p>
          </button>
        );
      })}
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(o) => { if (o !== open) onToggle(); }}>
        <SheetContent side="left" className="p-0 w-[min(100vw,280px)] flex flex-col">
          <SheetTitle className="sr-only">Chat history</SheetTitle>
          <div className="flex items-center justify-between px-3 h-14 border-b border-border/60 shrink-0">
            <p className="text-xs font-semibold text-foreground">History</p>
            <button
              onClick={onNewChat}
              title="New Chat"
              className="h-10 w-10 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
            >
              <PlusCircle className="h-4 w-4" />
            </button>
          </div>
          {sessionList}
        </SheetContent>
      </Sheet>
    );
  }

  if (!open) {
    return (
      <div className="flex flex-col items-center border-r border-border/60 bg-background pt-3 gap-2 w-10 shrink-0">
        <button
          onClick={onToggle}
          title="Open chat history"
          className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-[210px] shrink-0 border-r border-border/60 bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-14 border-b border-border/60 shrink-0">
        <p className="text-xs font-semibold text-foreground">History</p>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onNewChat}
            title="New Chat"
            className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
          >
            <PlusCircle className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onToggle}
            title="Collapse"
            className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
      </div>
      {sessionList}
    </div>
  );
}
