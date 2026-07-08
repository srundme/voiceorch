import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Send, Phone, Settings2, Sparkles, Globe, Mic, Cpu, Ear, Speaker,
  Building2, CheckCircle2, Loader2, ChevronLeft, Zap, UserCheck,
  PhoneForwarded, Voicemail, Calendar, ShieldCheck,
  Play, Volume2, FileText, BookOpen, ArrowUpRight, Paperclip,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AGENT_TIMEZONES } from "@/lib/agent-providers";
import { getListAgentsQueryKey } from "@workspace/api-client-react";

const AVAILABILITY_PRESETS = [
  { id: "mf9to5",  label: "Mon – Fri,  9 AM – 5 PM", days: [1,2,3,4,5],     start: "09:00", end: "17:00" },
  { id: "ms9to6",  label: "Mon – Sat,  9 AM – 6 PM", days: [1,2,3,4,5,6],   start: "09:00", end: "18:00" },
  { id: "ms10to7", label: "Mon – Sat, 10 AM – 7 PM", days: [1,2,3,4,5,6],   start: "10:00", end: "19:00" },
  { id: "all247",  label: "All days,   24 × 7",       days: [0,1,2,3,4,5,6], start: "00:00", end: "23:59" },
  { id: "manual",  label: "I'll configure it myself", days: [1,2,3,4,5],     start: "09:00", end: "17:00" },
] as const;

/* ── types ─────────────────────────────────────────────────────────────────── */

interface VoiceOption  { voiceId: string; voiceName: string; gender: string; language: string; description: string; languageMatch?: boolean; }
interface AgentField   { key: string; label: string; value: string; icon: string; }
interface FeatureCard  { key: string; label: string; enabled: boolean; icon: string; detail: string; }
interface DispositionCard { category: string; outcomes: string[]; }
interface LangPill     { code: string; label: string; }

interface ChatMsg {
  id: string;
  role: "user" | "ai";
  content: string;
  done?: boolean;
  voices?: VoiceOption[];        // inline voice picker
  voiceAgentLangs?: string[];    // agent's chosen language(s) for the picker's default filter
  voicePicked?: boolean;         // collapses picker after selection
  timezonePicker?: boolean;      // inline timezone picker
  timezonePicked?: boolean;      // collapses timezone picker after selection
  availabilityPicker?: boolean;  // inline availability preset picker
  availabilityPicked?: boolean;  // collapses availability picker after selection
}

type Phase = "idle" | "thinking" | "streaming" | "building" | "done";

/* ── icon maps ─────────────────────────────────────────────────────────────── */

const FIELD_ICONS: Record<string, React.ElementType> = {
  bot: () => <img src="/snapserve-icon.png" className="h-3.5 w-3.5" alt="" />,
  building: Building2, globe: Globe, mic: Mic,
  phone: Phone, cpu: Cpu, ear: Ear, speaker: Speaker,
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

/* ── landing suggestions ────────────────────────────────────────────────────── */
const SUGGESTIONS = [
  "Sales follow-up agent in Tamil",
  "Customer support for a SaaS product",
  "Appointment booking for a clinic",
  "Lead qualification for real estate",
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
/*  Main component                                                             */
/* ═══════════════════════════════════════════════════════════════════════════ */
export default function VibePage() {
  const [, navigate]     = useLocation();
  const queryClient      = useQueryClient();
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

  const phaseRef    = useRef<string>("idle");
  const chatEndRef  = useRef<HTMLDivElement>(null);
  const historyRef  = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const voicesRef   = useRef<{ shown: boolean; list: VoiceOption[] }>({ shown: false, list: [] });
  const selectedVoiceIdRef = useRef<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    _setPhase(p);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Refine mode: load existing agent on mount ────────────────────────────
  useEffect(() => {
    if (!refineId) return;
    setRefineLoading(true);
    const token = getToken();
    fetch(`/api/agents/${refineId}`, {
      headers: { Authorization: `Bearer ${token ?? ""}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then((agent: Record<string, unknown> | null) => {
        if (!agent) return;
        const cfg = (agent.agentConfig ?? {}) as Record<string, unknown>;
        const lang = LANG_DISPLAY[agent.language as string ?? ""] ?? (agent.language as string) ?? "English";

        // Pre-populate right panel fields
        const panelFields: AgentField[] = [
          { key: "name",      label: "Agent Name",     value: (agent.name as string) || "—",              icon: "bot"      },
          { key: "language",  label: "Language",       value: lang,                                        icon: "globe"    },
          { key: "direction", label: "Call Direction",
            value: cfg.direction === "outbound" ? "Outbound" : "Inbound",                                  icon: "phone"    },
          { key: "voice",     label: "Voice",
            value: (agent.ttsVoice as string)
              ? ((agent.ttsVoiceName as string) || `…${(agent.ttsVoice as string).slice(-8)}`)
              : "—",                                                                                         icon: "mic"      },
          { key: "llm",       label: "AI Brain",       value: (agent.llmModel as string) || "Managed",     icon: "cpu"      },
          { key: "stt",       label: "Speech-to-Text", value: "Sarvam Saaras v3",                          icon: "ear"      },
          { key: "tts",       label: "Voice Engine",   value: "Cartesia Sonic 3.5",                        icon: "speaker"  },
        ];
        setFields(panelFields);

        // Pre-populate features
        const schedulingOn = !!(cfg.schedulingEnabled);
        const panelFeatures: FeatureCard[] = [
          {
            key: "gender_detection", label: "Caller Gender Detection", icon: "user-check",
            enabled: !!(cfg.genderDetectionEnabled),
            detail: cfg.genderDetectionEnabled
              ? `${(cfg.maleSalutation as string) || "Sir"} / ${(cfg.femaleSalutation as string) || "Ma'am"}`
              : "Disabled",
          },
          {
            key: "call_transfer", label: "Call Transfer to Human", icon: "phone-forwarded",
            enabled: !!(cfg.callTransferEnabled),
            detail: cfg.callTransferEnabled
              ? `→ ${(cfg.transferName as string) || "Human Agent"} · ${(cfg.transferPhoneNumber as string) || ""}`
              : "Disabled",
          },
          {
            key: "voicemail", label: "Voicemail", icon: "voicemail",
            enabled: !!(cfg.voicemailEnabled),
            detail: cfg.voicemailEnabled ? "Enabled" : "Disabled",
          },
          {
            key: "scheduling", label: "Booking & Scheduling", icon: "calendar",
            enabled: schedulingOn,
            detail: schedulingOn ? "Enabled" : "Disabled",
          },
          {
            key: "compliance", label: "Compliance", icon: "shield-check",
            enabled: !!((cfg.compliance as Record<string, boolean>)?.dpdp
                     || (cfg.compliance as Record<string, boolean>)?.trai
                     || (cfg.compliance as Record<string, boolean>)?.irdai),
            detail: [
              (cfg.compliance as Record<string, boolean>)?.dpdp  && "DPDP",
              (cfg.compliance as Record<string, boolean>)?.trai  && "TRAI",
              (cfg.compliance as Record<string, boolean>)?.irdai && "IRDAI",
            ].filter(Boolean).join(" · ") || "None",
          },
        ];
        setFeatures(panelFeatures);

        if (agent.ttsVoice) {
          selectedVoiceIdRef.current = agent.ttsVoice as string;
          setSelectedVoice((agent.ttsVoiceName as string) || `…${(agent.ttsVoice as string).slice(-8)}`);
        }

        // Show system prompt from existing agent
        if (agent.systemPrompt) {
          setPromptPreview(agent.systemPrompt as string);
        }

        // setPhase("idle") not "building" — "building" disables the chatbox
        setPhase("idle");

        // Inject existing config as context so Gemini knows what it's refining
        const contextSummary = [
          `[EXISTING AGENT CONFIG — user wants to refine this agent]`,
          `Name: ${agent.name as string}`,
          `Language: ${lang}`,
          `Direction: ${cfg.direction ?? "inbound"}`,
          `Voice: ${agent.ttsVoice as string || "not set"}`,
          `Gender detection: ${cfg.genderDetectionEnabled ? "on" : "off"}`,
          `Call transfer: ${cfg.callTransferEnabled ? `on → ${cfg.transferPhoneNumber}` : "off"}`,
          `Voicemail: ${cfg.voicemailEnabled ? "on" : "off"}`,
          `Scheduling: ${cfg.schedulingEnabled ? "on" : "off"}`,
          `Timezone: ${(cfg.timezone as string) || "Asia/Kolkata"}`,
          `[When the user describes changes, update only the relevant fields and keep everything else the same.]`,
        ].join("\n");
        historyRef.current = [{ role: "assistant", content: contextSummary }];

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

  // Attach timezone picker to last AI message
  const attachTimezonePickerToLastMsg = useCallback(() => {
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.role === "ai") {
        return [...prev.slice(0, -1), { ...last, timezonePicker: true, timezonePicked: false }];
      }
      return prev;
    });
  }, []);

  // Collapse all timezone pickers after selection
  const collapseTimezonePickers = useCallback(() => {
    setMessages(prev => prev.map(m => m.timezonePicker ? { ...m, timezonePicked: true } : m));
  }, []);

  // Attach availability picker to last AI message
  const attachAvailabilityPickerToLastMsg = useCallback(() => {
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.role === "ai") {
        return [...prev.slice(0, -1), { ...last, availabilityPicker: true, availabilityPicked: false }];
      }
      return prev;
    });
  }, []);

  // Collapse all availability pickers after selection
  const collapseAvailabilityPickers = useCallback(() => {
    setMessages(prev => prev.map(m => m.availabilityPicker ? { ...m, availabilityPicked: true } : m));
  }, []);

  const send = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || phaseRef.current === "building" || phaseRef.current === "thinking"
        || phaseRef.current === "streaming" || phaseRef.current === "done") return;

    if (!overrideText) setInput("");

    const userMsg: ChatMsg = { id: uid(), role: "user", content: text, done: true };
    const aiMsg:   ChatMsg = { id: uid(), role: "ai",   content: "",   done: false };
    setMessages(prev => [...prev, userMsg, aiMsg]);
    setPhase("thinking");

    const history = [...historyRef.current, { role: "user" as const, content: text }];
    const token   = getToken();

    try {
      const resp = await fetch("/api/agents/vibe-chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          messages:        history,
          voicesShown:     voicesRef.current.shown,
          availableVoices: voicesRef.current.list,
          selectedVoiceId: selectedVoiceIdRef.current,
          ...(refineId != null ? { refineAgentId: refineId } : {}),
        }),
      });

      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

      setPhase("streaming");
      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf       = "";
      let aiReply   = "";

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

            case "disposition_card":
              setDispositions(prev => {
                if (prev.find(d => d.category === evt.category)) return prev;
                return [...prev, { category: evt.category as string, outcomes: evt.outcomes as string[] }];
              });
              break;

            case "scheduling_setup":
              setSchedulingSetup({ timezone: String(evt.timezone ?? "Asia/Kolkata") });
              break;

            case "timezone_picker":
              attachTimezonePickerToLastMsg();
              break;

            case "availability_picker":
              attachAvailabilityPickerToLastMsg();
              break;

            case "prompt_stream":
              setPromptPreview(prev => prev + (evt.delta as string));
              break;

            case "status":
              setStatusMsg(evt.message as string);
              break;

            case "created":
              setCreatedId(evt.agentId as number);
              setCreatedName(evt.agentName as string);
              setPhase("done");
              setMessages(prev => prev.map(m => !m.done && m.role === "ai" ? { ...m, done: true } : m));
              queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
              break;

            case "error":
              setMessages(prev => prev.map(m =>
                !m.done && m.role === "ai" ? { ...m, content: `Sorry, something went wrong — ${evt.message as string}`, done: true } : m
              ));
              setPhase("idle");
              break;
          }
        }
      }

      setMessages(prev => prev.map(m => !m.done && m.role === "ai" ? { ...m, done: true } : m));
      historyRef.current = [...history, { role: "assistant", content: aiReply }];
      if (phaseRef.current !== "done") setPhase("idle");

    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") return;
      setMessages(prev => prev.map(m =>
        !m.done && m.role === "ai" ? { ...m, content: "Something went wrong. Please try again.", done: true } : m
      ));
      setPhase("idle");
    }
  }, [input, setPhase, appendAiDelta, attachVoicesToLastMsg, collapseVoicePickers,
      attachAvailabilityPickerToLastMsg, queryClient]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const allowed = ["text/plain","text/csv","text/markdown","application/json","text/html"];
    if (!allowed.includes(file.type) && !file.name.match(/\.(txt|md|csv|json|html)$/i)) {
      alert("Please upload a .txt, .md, .csv, or .json file. PDF support coming soon.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = (ev.target?.result as string ?? "").slice(0, 12000);
      const msg = `[Knowledge Base Upload — "${file.name}"]\n\n${content}`;
      send(msg);
    };
    reader.readAsText(file);
  }, [send]);

  const canSend = input.trim().length > 0
    && phase !== "building" && phase !== "thinking" && phase !== "streaming" && phase !== "done";

  const hasRightContent = fields.length > 0 || selectedVoice.length > 0 || features.length > 0
    || dispositions.length > 0 || promptPreview.length > 0 || createdId !== null
    || callFlowNotes.length > 0 || kbNotes.length > 0;

  // Landing = no user message yet and not refine mode
  const chatStarted = messages.length > 1 || !!refineId || refineLoading;

  const isThinking = phase === "thinking" || phase === "streaming" || phase === "building";

  /* ── shared input block ───────────────────────────────────────────────────── */
  const inputBlock = (isLanding: boolean) => (
    <div className={cn("relative", isLanding ? "w-full" : "")}>
      <Textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKey}
        placeholder={phase === "done" ? "Your agent is ready! ✓" : "Describe your agent or ask anything…"}
        disabled={phase === "done" || phase === "building"}
        rows={isLanding ? 4 : 3}
        className={cn(
          "resize-none pr-20 bg-muted/20 border-border/50 placeholder:text-muted-foreground/40 transition-all",
          isLanding
            ? "text-base rounded-2xl px-5 pt-5 pb-14 shadow-lg focus-visible:ring-1 focus-visible:ring-primary/40 border-border/60"
            : "text-sm pr-20 rounded-xl focus-visible:ring-1 focus-visible:ring-primary/50",
        )}
      />
      <input ref={fileInputRef} type="file" accept=".txt,.md,.csv,.json,.html" className="hidden" onChange={handleFileUpload} />
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={phase === "done" || phase === "building" || isThinking}
        title="Upload document for knowledge base"
        className={cn(
          "absolute flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-lg transition-all disabled:opacity-30",
          isLanding ? "right-14 bottom-4 h-9 w-9" : "right-11 bottom-2.5 h-8 w-8",
        )}
      >
        <Paperclip className={isLanding ? "h-4 w-4" : "h-3.5 w-3.5"} />
      </button>
      <Button
        size="icon"
        onClick={() => send()}
        disabled={!canSend}
        className={cn(
          "absolute transition-all",
          isLanding ? "right-4 bottom-4 h-9 w-9 rounded-xl" : "right-2.5 bottom-2.5 h-8 w-8 rounded-lg",
          canSend ? "bg-primary hover:bg-primary/90 shadow-sm" : "bg-muted text-muted-foreground",
        )}
      >
        {isThinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className={isLanding ? "h-4 w-4" : "h-3.5 w-3.5"} />}
      </Button>
    </div>
  );

  /* ─ render ──────────────────────────────────────────────────────────────── */
  return (
    <div className="fixed inset-0 bg-background overflow-hidden">

      {/* ══ Landing view — before first message ════════════════════════════ */}
      {!chatStarted && (
        <div className="relative flex flex-col h-full overflow-hidden">
          {/* Ambient background — glow + grid texture, so the page reads as designed, not empty */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.05)_1px,transparent_0)] [background-size:28px_28px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_35%,black_10%,transparent_75%)]" />
            <div className={cn(
              "absolute left-1/2 top-[30%] h-[520px] w-[820px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[110px] transition-opacity duration-700",
              isThinking ? "bg-primary/20 opacity-100" : "bg-primary/10 opacity-80",
            )} />
            <div className="absolute left-1/2 top-[30%] h-[280px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-[80px]" />
          </div>

          {/* Back button */}
          <div className="relative z-10 flex items-center px-6 h-14 shrink-0">
            <button
              onClick={() => navigate("/app/agents")}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-4 w-4" /> Agents
            </button>
          </div>

          {/* Centered content */}
          <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 pb-16">
            {/* Animated logo */}
            <div className="relative mb-8">
              <div className={cn(
                "h-[72px] w-[72px] rounded-[22px] border flex items-center justify-center overflow-hidden p-3.5 transition-all duration-500 bg-gradient-to-b from-muted/60 to-muted/10 backdrop-blur-sm",
                isThinking
                  ? "border-primary/50 shadow-[0_0_48px_rgba(var(--primary)/0.35)]"
                  : "border-border/60 shadow-[0_8px_30px_rgba(0,0,0,0.35)]",
              )}>
                <img src="/snapserve-icon.png" alt="SnapServe" className={cn("h-full w-full object-contain transition-opacity", isThinking ? "opacity-100" : "opacity-90")} />
              </div>
              {isThinking && (
                <div className="absolute inset-0 rounded-[22px] border-2 border-primary/40 animate-ping" />
              )}
            </div>

            {/* Title */}
            <h1 className="text-4xl font-semibold tracking-tight mb-3 text-center bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-transparent">
              {isThinking ? (
                <span className="text-muted-foreground bg-none">Building your agent…</span>
              ) : (
                "Build your voice agent"
              )}
            </h1>
            <p className="text-muted-foreground text-center mb-10 max-w-md leading-relaxed">
              Describe what you want — I'll configure everything and have it ready in minutes.
            </p>

            {/* Input */}
            <div className="w-full max-w-2xl">
              <div className="rounded-2xl bg-gradient-to-b from-border/40 to-border/10 p-px shadow-2xl shadow-black/30">
                {inputBlock(true)}
              </div>
            </div>

            {/* Suggestion chips */}
            {!isThinking && (
              <div className="flex flex-wrap gap-2 justify-center mt-5 max-w-2xl">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => setInput(s)}
                    className="rounded-full border border-border/60 bg-muted/20 backdrop-blur-sm px-4 py-1.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-muted/50 hover:shadow-[0_0_16px_rgba(var(--primary)/0.15)] transition-all"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ Chat + Preview split — after first message ══════════════════════ */}
      {chatStarted && (
        <div className="flex h-full animate-in fade-in duration-300">

          {/* ── Left: Chat panel ─────────────────────────────────────────── */}
          <div className="flex flex-col w-[430px] min-w-[380px] border-r border-border/60 bg-background">

            {/* Header */}
            <div className="flex items-center gap-3 px-4 h-14 border-b border-border/60 shrink-0">
              <button
                onClick={() => navigate("/app/agents")}
                className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {/* Animated logo in header */}
              <div className="relative flex-shrink-0">
                <div className={cn(
                  "h-7 w-7 rounded-lg border flex items-center justify-center overflow-hidden p-1 transition-all",
                  isThinking ? "border-primary/40 bg-primary/10" : "border-border/50 bg-muted/20",
                )}>
                  <img src="/snapserve-icon.png" alt="SnapServe" className="h-full w-full object-contain" />
                </div>
                {isThinking && (
                  <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary animate-pulse" />
                )}
              </div>
              <div>
                <p className="font-semibold text-sm leading-none tracking-tight">Vibe Build</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {refineId ? "Refining existing agent" : "AI agent builder"}
                </p>
              </div>
              {refineLoading && (
                <div className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </div>
              )}
              {!refineLoading && isThinking && (
                <div className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  {phase === "thinking" ? "Thinking…" : phase === "streaming" ? "Responding…" : statusMsg || "Configuring…"}
                </div>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto">
              <div className="px-4 py-6 space-y-5">
                {messages.map(msg => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    selectedVoice={selectedVoice}
                    playingVoice={playingVoice}
                    onPreview={vid => previewVoice(vid, setPlayingVoice)}
                    onSelect={v => {
                      // Optimistic collapse: reflect the pick immediately, even if the
                      // server can't confirm (e.g. re-picking the agent's current voice)
                      collapseVoicePickers();
                      selectedVoiceIdRef.current = v.voiceId;
                      setSelectedVoice(v.voiceName);
                      send(`I'll go with ${v.voiceName}`);
                    }}
                    onSelectTimezone={tz => { collapseTimezonePickers(); send(`Use ${tz.label} (${tz.value})`); }}
                    onSelectAvailability={preset => {
                      collapseAvailabilityPickers();
                      send(`Set availability: ${preset.label} — days: [${preset.days.join(",")}], hours: ${preset.start}–${preset.end}`);
                    }}
                  />
                ))}
                {phase === "thinking" && <ThinkingLogo />}
                <div ref={chatEndRef} />
              </div>
            </div>

            {/* Input */}
            <div className="border-t border-border/60 px-4 py-3 shrink-0">
              {inputBlock(false)}
              <p className="text-[10px] text-muted-foreground/40 mt-2 text-center">
                Enter to send · Shift+Enter for newline · 📎 to upload KB docs
              </p>
            </div>
          </div>

          {/* ── Right: Live preview ───────────────────────────────────────── */}
          <div className="flex-1 flex flex-col min-w-0 bg-muted/10">

            {/* Header */}
            <div className="flex items-center justify-between px-8 h-14 border-b border-border/60 shrink-0 bg-background">
              <div className="flex items-center gap-3">
                <Zap className="h-4 w-4 text-primary" />
                <div>
                  <p className="font-semibold text-sm leading-none">Agent Preview</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {!hasRightContent              ? "Waiting for your description…" :
                     phase === "building"          ? (statusMsg || "Configuring…") :
                     phase === "done"              ? "Ready to deploy" :
                     (refineId && phase === "idle") ? "Agent loaded — tell me what to change" :
                                                    "Building up as we chat"}
                  </p>
                </div>
              </div>
              {phase === "done" && createdId && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs rounded-lg"
                    onClick={() => navigate(`/app/agents/${createdId}`)}>
                    <Settings2 className="h-3 w-3" /> Edit
                  </Button>
                  <Button size="sm" className="h-7 gap-1.5 text-xs rounded-lg"
                    onClick={() => navigate(`/app/agents/${createdId}?webcall=1`)}>
                    <Phone className="h-3 w-3" /> Try Call
                  </Button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-8 py-8">
              {!hasRightContent ? (
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
              {kbNotes && (
                <Section title="Knowledge Base">
                  <NoteCard icon={<BookOpen className="h-3.5 w-3.5" />} text={kbNotes} />
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

              {/* Scheduling Setup Guidance */}
              {schedulingSetup && (
                <Section title="Scheduling Setup">
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-amber-500 shrink-0" />
                      <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                        2 steps to activate booking
                      </p>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Timezone: <span className="font-medium text-foreground">{schedulingSetup.timezone}</span>
                    </p>
                    <div className="space-y-2">
                      <a
                        href="/app/scheduling"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-background px-3 py-2.5 hover:bg-muted/50 transition-colors"
                      >
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/10 text-amber-500 text-[10px] font-bold shrink-0">1</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium">Connect Google Calendar</p>
                          <p className="text-[10px] text-muted-foreground truncate">app/scheduling → Calendars tab</p>
                        </div>
                      </a>
                      <a
                        href="/app/scheduling/event-types"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-background px-3 py-2.5 hover:bg-muted/50 transition-colors"
                      >
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/10 text-amber-500 text-[10px] font-bold shrink-0">2</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium">Create an event type</p>
                          <p className="text-[10px] text-muted-foreground truncate">app/scheduling/event-types →</p>
                        </div>
                      </a>
                    </div>
                  </div>
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
                  <div className="rounded-xl border border-border/60 bg-background p-4 max-h-[280px] overflow-y-auto">
                    <p className="text-[11px] text-muted-foreground font-mono leading-relaxed whitespace-pre-wrap">
                      {promptPreview}
                      {phase === "building" && (
                        <span className="inline-block w-0.5 h-3.5 bg-primary/70 ml-0.5 align-middle animate-pulse" />
                      )}
                    </p>
                  </div>
                </Section>
              )}

              {/* Done */}
              {phase === "done" && createdId && (
                <DoneCard name={createdName} id={createdId} navigate={navigate} isUpdate={refineId != null} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )}

  </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Chat components                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

function MessageBubble({ msg, selectedVoice, playingVoice, onPreview, onSelect, onSelectTimezone, onSelectAvailability }: {
  msg: ChatMsg;
  selectedVoice: string;
  playingVoice: string | null;
  onPreview: (id: string) => void;
  onSelect: (v: VoiceOption) => void;
  onSelectTimezone: (tz: { value: string; label: string }) => void;
  onSelectAvailability: (preset: typeof AVAILABILITY_PRESETS[number]) => void;
}) {
  const isAi = msg.role === "ai";

  if (!isAi) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary/10 border border-primary/15 px-4 py-2.5">
          <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{msg.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 items-start">
      {/* Logo avatar */}
      <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5 overflow-hidden p-1">
        <img src="/snapserve-icon.png" alt="SnapServe" className="h-full w-full object-contain" />
      </div>

      <div className="flex-1 min-w-0 space-y-3">
        {/* Text */}
        <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
          {msg.content}
          {!msg.done && msg.content.length > 0 && (
            <span className="inline-block w-0.5 h-4 bg-foreground/40 ml-0.5 align-middle animate-pulse rounded-sm" />
          )}
        </p>

        {/* Voice picker — collapsed once picked */}
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
        {/* Timezone picker — shown when scheduling is enabled */}
        {msg.timezonePicker && !msg.timezonePicked && (
          <div className="space-y-2 pt-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              Select timezone
            </p>
            <div className="rounded-xl border border-border/60 bg-muted/30 overflow-hidden max-h-52 overflow-y-auto">
              {AGENT_TIMEZONES.map(tz => (
                <button
                  key={tz.value}
                  onClick={() => onSelectTimezone(tz)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-primary/10 hover:text-primary transition-colors border-b border-border/30 last:border-0"
                >
                  {tz.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {/* Collapsed timezone state */}
        {msg.timezonePicker && msg.timezonePicked && (
          <div className="flex items-center gap-2 text-[11px] text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="font-medium">Timezone selected</span>
          </div>
        )}

        {/* Availability picker — shown when scheduling is being set up */}
        {msg.availabilityPicker && !msg.availabilityPicked && (
          <div className="space-y-2 pt-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              Select availability
            </p>
            <div className="rounded-xl border border-border/60 bg-muted/30 overflow-hidden">
              {AVAILABILITY_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  onClick={() => onSelectAvailability(preset)}
                  className="w-full text-left px-3 py-2.5 text-xs hover:bg-primary/10 hover:text-primary transition-colors border-b border-border/30 last:border-0 flex items-center justify-between"
                >
                  <span className="font-medium">{preset.label}</span>
                  {preset.id === "mf9to5" && (
                    <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">recommended</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
        {/* Collapsed availability state */}
        {msg.availabilityPicker && msg.availabilityPicked && (
          <div className="flex items-center gap-2 text-[11px] text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="font-medium">Availability set</span>
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
      {/* Gender indicator */}
      <div className={cn(
        "h-7 w-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0",
        voice.gender === "female"
          ? "bg-rose-500/10 text-rose-400 border border-rose-500/15"
          : "bg-sky-500/10 text-sky-400 border border-sky-500/15",
      )}>
        {voice.gender === "female" ? "F" : "M"}
      </div>

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
    <div className="flex gap-3 items-center pl-0.5">
      <div className="relative shrink-0">
        <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center overflow-hidden p-1 shadow-[0_0_12px_rgba(var(--primary)/0.2)]">
          <img src="/snapserve-icon.png" alt="Thinking" className="h-full w-full object-contain" />
        </div>
        <span className="absolute inset-0 rounded-lg border-2 border-primary/30 animate-ping" />
      </div>
      <div className="flex gap-1.5 items-center">
        {[0, 160, 320].map(d => (
          <span
            key={d}
            className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-bounce"
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
    <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-background px-3 py-2.5 animate-in fade-in duration-300">
      <div className="h-6 w-6 rounded-md bg-muted/80 flex items-center justify-center shrink-0">
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
    <div className="rounded-xl border border-border/60 bg-background p-4 flex gap-3">
      <div className="text-muted-foreground mt-0.5 shrink-0">{icon}</div>
      <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{text}</p>
    </div>
  );
}

function FeatureChip({ feature }: { feature: FeatureCard }) {
  const Icon = FEATURE_ICONS[feature.icon] ?? Sparkles;
  return (
    <div className={cn(
      "rounded-xl border px-3 py-2.5 flex items-start gap-2.5 transition-all",
      feature.enabled ? "border-border/60 bg-background" : "border-border/40 bg-background/50 opacity-50",
    )}>
      <div className="h-6 w-6 rounded-md bg-muted/80 flex items-center justify-center shrink-0 mt-0.5">
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
  return (
    <div className={cn("rounded-xl border overflow-hidden animate-in fade-in duration-300", c.bg)}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/40">
        <p className="text-[11px] font-semibold">{d.category}</p>
        <span className="text-[10px] text-muted-foreground">{d.outcomes.length}</span>
      </div>
      <div className="px-4 py-2.5 flex flex-wrap gap-1.5">
        {d.outcomes.map(o => (
          <span key={o} className={cn("rounded-md border px-2 py-0.5 text-[10px] font-medium", c.tag)}>{o}</span>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  const items = [
    "Voice selection with live audio preview",
    "Call flow & script generation",
    "Knowledge base integration",
    "Gender detection · transfer · voicemail",
    "Scheduling & compliance setup",
    "Call outcome dispositions",
    "System prompt auto-generated",
  ];
  return (
    <div className="flex flex-col items-center justify-center min-h-full py-24 text-center gap-6">
      <div className="relative">
        <div className="h-16 w-16 rounded-2xl bg-primary/8 border border-primary/15 flex items-center justify-center overflow-hidden p-2.5">
          <img src="/snapserve-icon.png" alt="SnapServe" className="h-full w-full object-contain opacity-60" />
        </div>
        <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-primary/80 ring-2 ring-background" />
      </div>
      <div className="max-w-sm">
        <p className="font-semibold text-base">Your agent preview</p>
        <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
          Start the conversation and watch everything take shape here in real time.
        </p>
      </div>
      <div className="flex flex-col gap-2 text-[11px] text-muted-foreground text-left max-w-xs">
        {items.map(t => (
          <div key={t} className="flex items-start gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-primary/50 mt-1.5 shrink-0" />
            <span>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DoneCard({ name, id, navigate, isUpdate }: { name: string; id: number; navigate: (to: string) => void; isUpdate?: boolean }) {
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
        <Button size="sm" className="gap-1.5 rounded-xl"
          onClick={() => navigate(`/app/agents/${id}?webcall=1`)}>
          <Phone className="h-3.5 w-3.5" /> Make a call
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
