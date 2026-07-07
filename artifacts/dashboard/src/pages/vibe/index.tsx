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
import { getListAgentsQueryKey } from "@workspace/api-client-react";

/* ── types ─────────────────────────────────────────────────────────────────── */

interface VoiceOption  { voiceId: string; voiceName: string; gender: string; language: string; description: string; }
interface AgentField   { key: string; label: string; value: string; icon: string; }
interface FeatureCard  { key: string; label: string; enabled: boolean; icon: string; detail: string; }
interface DispositionCard { category: string; outcomes: string[]; }
interface LangPill     { code: string; label: string; }

interface ChatMsg {
  id: string;
  role: "user" | "ai";
  content: string;
  done?: boolean;
  voices?: VoiceOption[];      // inline voice picker
  voicePicked?: boolean;       // collapses picker after selection
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

/* ── greeting ──────────────────────────────────────────────────────────────── */
const GREETING: ChatMsg = {
  id: "g", role: "ai", done: true,
  content: "Hey! I'll help you build your voice agent in a few minutes.\n\nTell me — what do you want this agent to do, and who will it be talking to?",
};

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
  const [voiceOptions,   setVoiceOptions]   = useState<VoiceOption[]>([]);
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

  const phaseRef    = useRef<string>("idle");
  const chatEndRef  = useRef<HTMLDivElement>(null);
  const historyRef  = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const voicesRef   = useRef<{ shown: boolean; list: VoiceOption[] }>({ shown: false, list: [] });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    _setPhase(p);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const appendAiDelta = useCallback((delta: string) => {
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.role === "ai" && !last.done) {
        return [...prev.slice(0, -1), { ...last, content: last.content + delta }];
      }
      return prev;
    });
  }, []);

  const attachVoicesToLastMsg = useCallback((voices: VoiceOption[]) => {
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.role === "ai") {
        return [...prev.slice(0, -1), { ...last, voices, voicePicked: false }];
      }
      return prev;
    });
  }, []);

  // Collapse all voice pickers when a voice is selected
  const collapseVoicePickers = useCallback(() => {
    setMessages(prev => prev.map(m => m.voices ? { ...m, voicePicked: true } : m));
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
              if (voices.length > 0) {
                setVoiceOptions(voices);
                voicesRef.current = { shown: true, list: voices };
                attachVoicesToLastMsg(voices);
              }
              break;
            }

            case "voice_selected":
              collapseVoicePickers();
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
                setSelectedVoice(String(evt.value ?? "").split(" — ")[0] ?? "");
                collapseVoicePickers();
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
  }, [input, setPhase, appendAiDelta, attachVoicesToLastMsg, collapseVoicePickers, queryClient]);

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

  const hasRightContent = fields.length > 0 || voiceOptions.length > 0 || features.length > 0
    || dispositions.length > 0 || promptPreview.length > 0 || createdId !== null
    || callFlowNotes.length > 0 || kbNotes.length > 0;

  /* ─ render ──────────────────────────────────────────────────────────────── */
  return (
    <div className="fixed inset-0 flex bg-background overflow-hidden">

      {/* ══ Left: Chat panel ══════════════════════════════════════════════════ */}
      <div className="flex flex-col w-[440px] min-w-[380px] border-r border-border/60 bg-background">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 h-14 border-b border-border/60 shrink-0">
          <button
            onClick={() => navigate("/app/agents")}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg overflow-hidden shrink-0">
              <img src="/snapserve-icon.png" alt="SnapServe" className="h-full w-full object-contain" />
            </div>
            <div>
              <p className="font-semibold text-sm leading-none tracking-tight">Vibe Build</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">AI agent builder</p>
            </div>
          </div>
          {phase !== "idle" && phase !== "done" && (
            <div className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {phase === "thinking"  ? "Thinking…" :
               phase === "streaming" ? "Responding…" :
               statusMsg || "Configuring…"}
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-6 space-y-6">
            {messages.map(msg => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                selectedVoice={selectedVoice}
                playingVoice={playingVoice}
                onPreview={vid => previewVoice(vid, setPlayingVoice)}
                onSelect={v => send(`I'll go with ${v.voiceName}`)}
              />
            ))}
            {phase === "thinking" && <ThinkingDots />}
            <div ref={chatEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-border/60 px-4 py-4 shrink-0">
          <div className="relative">
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={
                phase === "done"
                  ? "Your agent is ready! ✓"
                  : "Message or drop a file for knowledge base…"
              }
              disabled={phase === "done" || phase === "building"}
              rows={3}
              className="resize-none text-sm pr-20 bg-muted/30 border-border/60 rounded-xl focus-visible:ring-1 focus-visible:ring-primary/50 placeholder:text-muted-foreground/50"
            />
            {/* File upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.csv,.json,.html"
              className="hidden"
              onChange={handleFileUpload}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={phase === "done" || phase === "building" || phase === "thinking" || phase === "streaming"}
              title="Upload document for knowledge base (.txt, .md, .csv, .json)"
              className="absolute right-11 bottom-2.5 h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all disabled:opacity-30"
            >
              <Paperclip className="h-3.5 w-3.5" />
            </button>
            <Button
              size="icon"
              onClick={() => send()}
              disabled={!canSend}
              className={cn(
                "absolute right-2.5 bottom-2.5 h-8 w-8 rounded-lg transition-all",
                canSend ? "bg-primary hover:bg-primary/90 shadow-sm" : "bg-muted text-muted-foreground",
              )}
            >
              {(phase === "thinking" || phase === "streaming")
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Send className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground/50 mt-2 text-center tracking-wide">
            Enter to send · Shift+Enter for newline · 📎 to upload KB docs
          </p>
        </div>
      </div>

      {/* ══ Right: Live preview ════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col min-w-0 bg-muted/20">

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

              {/* Voice — collapses to chip once picked */}
              {voiceOptions.length > 0 && (
                <Section title="Voice">
                  {selectedVoice ? (
                    <div className="flex items-center gap-2.5 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-primary">{selectedVoice}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Voice selected · Cartesia Sonic 3.5</p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {voiceOptions.map(v => (
                        <RightVoiceChip
                          key={v.voiceId}
                          voice={v}
                          isSelected={false}
                          isPlaying={playingVoice === v.voiceId}
                          onPreview={() => previewVoice(v.voiceId, setPlayingVoice)}
                        />
                      ))}
                    </div>
                  )}
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
                  <div className="rounded-xl border border-border/60 bg-background p-4">
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
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Chat components                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

function MessageBubble({ msg, selectedVoice, playingVoice, onPreview, onSelect }: {
  msg: ChatMsg;
  selectedVoice: string;
  playingVoice: string | null;
  onPreview: (id: string) => void;
  onSelect: (v: VoiceOption) => void;
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
          <div className="space-y-2 pt-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              Available voices
            </p>
            {msg.voices.map(v => (
              <VoicePill
                key={v.voiceId}
                voice={v}
                isSelected={selectedVoice.includes(v.voiceName)}
                isPlaying={playingVoice === v.voiceId}
                onPreview={() => onPreview(v.voiceId)}
                onSelect={() => onSelect(v)}
              />
            ))}
          </div>
        )}
        {/* Collapsed state */}
        {msg.voices && msg.voices.length > 0 && msg.voicePicked && selectedVoice && (
          <div className="flex items-center gap-2 text-[11px] text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="font-medium">{selectedVoice} selected</span>
          </div>
        )}
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

function ThinkingDots() {
  return (
    <div className="flex gap-3 items-center">
      <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 overflow-hidden p-1">
        <img src="/snapserve-icon.png" alt="" className="h-full w-full object-contain opacity-50" />
      </div>
      <div className="flex gap-1.5 items-center py-2">
        {[0, 150, 300].map(d => (
          <span
            key={d}
            className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce"
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

function RightVoiceChip({ voice, isSelected, isPlaying, onPreview }: {
  voice: VoiceOption;
  isSelected: boolean;
  isPlaying: boolean;
  onPreview: () => void;
}) {
  return (
    <div className={cn(
      "rounded-xl border p-3 flex flex-col gap-2 transition-all",
      isSelected
        ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
        : "border-border/60 bg-background",
    )}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold">{voice.voiceName}</p>
          <p className="text-[10px] text-muted-foreground capitalize mt-0.5">{voice.gender}</p>
        </div>
        {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />}
      </div>
      <button
        onClick={onPreview}
        disabled={isPlaying}
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        {isPlaying ? <Volume2 className="h-3 w-3 text-primary animate-pulse" /> : <Play className="h-3 w-3" />}
        {isPlaying ? "Playing…" : "Preview"}
      </button>
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
