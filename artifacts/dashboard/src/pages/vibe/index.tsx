import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Bot, Send, Phone, Settings2, Sparkles, Globe, Mic, Cpu, Ear, Speaker,
  Building2, CheckCircle2, Loader2, ChevronLeft, Zap, UserCheck, PhoneForwarded,
  Voicemail, Calendar, ShieldCheck, ArrowRight, Play, Volume2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListAgentsQueryKey } from "@workspace/api-client-react";

/* ── types ─────────────────────────────────────────────────────────────────── */

interface ChatMsg { id: string; role: "user" | "ai"; content: string; done?: boolean; }
interface AgentField { key: string; label: string; value: string; icon: string; }
interface VoiceOption { voiceId: string; voiceName: string; gender: string; language: string; description: string; }
interface FeatureCard { key: string; label: string; enabled: boolean; icon: string; detail: string; }
interface DispositionCard { category: string; outcomes: string[]; }
interface LangPill { code: string; label: string; }

type Phase = "idle" | "thinking" | "streaming" | "building" | "done";

/* ── icon maps ─────────────────────────────────────────────────────────────── */

const FIELD_ICONS: Record<string, React.ElementType> = {
  bot: Bot, building: Building2, globe: Globe, mic: Mic,
  phone: Phone, cpu: Cpu, ear: Ear, speaker: Speaker,
};

const FEATURE_ICONS: Record<string, React.ElementType> = {
  "user-check": UserCheck, "phone-forwarded": PhoneForwarded,
  "voicemail": Voicemail, "calendar": Calendar, "shield-check": ShieldCheck,
};

const OUTCOME_COLORS = [
  "bg-blue-500/15 text-blue-400 border-blue-500/20",
  "bg-violet-500/15 text-violet-400 border-violet-500/20",
  "bg-amber-500/15 text-amber-400 border-amber-500/20",
  "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  "bg-rose-500/15 text-rose-400 border-rose-500/20",
];

/* ── helpers ────────────────────────────────────────────────────────────────── */

function getToken(): string | null {
  try { return localStorage.getItem("voiceorch:session"); } catch { return null; }
}
function uid() { return Math.random().toString(36).slice(2); }

const GREETING: ChatMsg = {
  id: "g", role: "ai", done: true,
  content: "Hey! I'm your AI agent builder 👋\n\nTell me what kind of voice agent you want — what it does, who it talks to, and what language it speaks. I'll guide you through the full setup step by step.",
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
    const blob = await resp.blob();
    const url  = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => setPlaying(null);
    audio.onerror = () => setPlaying(null);
    audio.play().catch(() => setPlaying(null));
  } catch {
    setPlaying(null);
  }
}

/* ── main component ─────────────────────────────────────────────────────────── */

export default function VibePage() {
  const [, navigate]   = useLocation();
  const queryClient    = useQueryClient();

  const [messages,      setMessages]      = useState<ChatMsg[]>([GREETING]);
  const [input,         setInput]         = useState("");
  const [phase,         setPhase]         = useState<Phase>("idle");
  const [fields,        setFields]        = useState<AgentField[]>([]);
  const [voiceOptions,  setVoiceOptions]  = useState<VoiceOption[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>("");
  const [langPills,     setLangPills]     = useState<LangPill[]>([]);
  const [features,      setFeatures]      = useState<FeatureCard[]>([]);
  const [dispositions,  setDispositions]  = useState<DispositionCard[]>([]);
  const [promptPreview, setPromptPreview] = useState("");
  const [statusMsg,     setStatusMsg]     = useState("");
  const [createdId,     setCreatedId]     = useState<number | null>(null);
  const [createdName,   setCreatedName]   = useState("");
  const [playingVoice,  setPlayingVoice]  = useState<string | null>(null);

  const chatEndRef    = useRef<HTMLDivElement>(null);
  const historyRef    = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const voicesRef     = useRef<{ shown: boolean; list: VoiceOption[] }>({ shown: false, list: [] });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, phase]);

  const appendAiDelta = useCallback((delta: string) => {
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.role === "ai" && !last.done) {
        return [...prev.slice(0, -1), { ...last, content: last.content + delta }];
      }
      return prev;
    });
  }, []);

  const send = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || phase === "building" || phase === "thinking" || phase === "streaming") return;

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
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({
          messages:        history,
          voicesShown:     voicesRef.current.shown,
          availableVoices: voicesRef.current.list,
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
              const voices = evt.voices as VoiceOption[];
              setVoiceOptions(voices);
              voicesRef.current = { shown: true, list: voices };
              break;
            }

            case "field":
              setPhase("building");
              setFields(prev => {
                const next = [...prev];
                const idx  = next.findIndex(f => f.key === evt.key);
                const f: AgentField = { key: evt.key as string, label: evt.label as string, value: evt.value as string, icon: evt.icon as string };
                if (idx >= 0) next[idx] = f; else next.push(f);
                return next;
              });
              if (evt.key === "voice") setSelectedVoice(String(evt.value ?? ""));
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
              setMessages(prev => prev.map(m => (!m.done && m.role === "ai") ? { ...m, done: true } : m));
              queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
              break;

            case "error":
              setMessages(prev => prev.map(m =>
                (!m.done && m.role === "ai") ? { ...m, content: `❌ ${evt.message as string}`, done: true } : m
              ));
              setPhase("idle");
              break;
          }
        }
      }

      setMessages(prev => prev.map(m => (!m.done && m.role === "ai") ? { ...m, done: true } : m));
      historyRef.current = [...history, { role: "assistant", content: aiReply }];
      if (phase !== "done") setPhase("idle");

    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") return;
      setMessages(prev => prev.map(m =>
        (!m.done && m.role === "ai") ? { ...m, content: "Something went wrong. Please try again.", done: true } : m
      ));
      setPhase("idle");
    }
  }, [input, phase, appendAiDelta, queryClient]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const canSend = input.trim().length > 0
    && phase !== "building" && phase !== "thinking" && phase !== "streaming" && phase !== "done";

  const hasRightContent = fields.length > 0 || voiceOptions.length > 0 || features.length > 0
    || dispositions.length > 0 || promptPreview || createdId;

  return (
    <div className="fixed inset-0 flex bg-background overflow-hidden">

      {/* ── Left: Chat ─────────────────────────────────────────────────── */}
      <div className="flex flex-col w-[400px] min-w-[340px] border-r border-border bg-card">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <button onClick={() => navigate("/app/agents")} className="text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center">
            <Zap className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-sm leading-none">Vibe Build</p>
            <p className="text-xs text-muted-foreground mt-0.5">Describe your agent, I'll build it</p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
          {phase === "thinking" && <ThinkingIndicator />}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-border shrink-0">
          <div className="flex gap-2 items-end">
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={phase === "done" ? "Agent created! 🎉" : "Describe your voice agent…"}
              disabled={phase === "done" || phase === "building"}
              rows={2}
              className="resize-none text-sm flex-1"
            />
            <Button size="icon" onClick={() => send()} disabled={!canSend} className="h-10 w-10 shrink-0">
              {phase === "thinking" || phase === "streaming"
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
            Press Enter to send · Shift+Enter for newline
          </p>
        </div>
      </div>

      {/* ── Right: Preview ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-background">

        {/* Header */}
        <div className="flex items-center justify-between px-8 py-4 border-b border-border shrink-0">
          <div>
            <p className="font-semibold text-sm">Agent Preview</p>
            <p className="text-xs text-muted-foreground">
              {phase === "idle"      && "Waiting for your description…"}
              {phase === "thinking"  && "AI is thinking…"}
              {phase === "streaming" && "Chatting with you…"}
              {phase === "building"  && (statusMsg || "Configuring your agent…")}
              {phase === "done"      && "Agent created successfully! 🎉"}
            </p>
          </div>
          {phase === "done" && createdId && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7"
                onClick={() => navigate(`/app/agents/${createdId}`)}>
                <Settings2 className="h-3 w-3" /> Edit Agent
              </Button>
              <Button size="sm" className="gap-1.5 text-xs h-7"
                onClick={() => navigate(`/app/agents/${createdId}?webcall=1`)}>
                <Phone className="h-3 w-3" /> Try Web Call
              </Button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          {!hasRightContent ? (
            <EmptyPreview />
          ) : (
            <div className="space-y-8 max-w-2xl">

              {/* ── Agent Configuration ── */}
              {fields.length > 0 && (
                <Section title="Agent Configuration">
                  <div className="grid grid-cols-2 gap-2">
                    {fields.map((f, i) => <FieldCard key={f.key} field={f} delay={i * 60} />)}
                  </div>
                </Section>
              )}

              {/* ── Voice Selection ── */}
              {voiceOptions.length > 0 && (
                <Section title="Voice Selection" badge={selectedVoice ? "Selected" : "Choose a voice"}>
                  <div className="grid grid-cols-2 gap-3">
                    {voiceOptions.map(v => (
                      <VoiceCard
                        key={v.voiceId}
                        voice={v}
                        isSelected={selectedVoice.startsWith(v.voiceName)}
                        isPlaying={playingVoice === v.voiceId}
                        onPreview={() => previewVoice(v.voiceId, setPlayingVoice)}
                        onSelect={() => send(`I'll go with ${v.voiceName}`)}
                      />
                    ))}
                  </div>
                  {!selectedVoice && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Click Preview to hear a sample, then tell me which one you'd like in the chat.
                    </p>
                  )}
                </Section>
              )}

              {/* ── Languages ── */}
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

              {/* ── Features ── */}
              {features.length > 0 && (
                <Section title="Features">
                  <div className="grid grid-cols-2 gap-2">
                    {features.map(f => <FeatureCard key={f.key} feature={f} />)}
                  </div>
                </Section>
              )}

              {/* ── Call Outcomes (Dispositions) ── */}
              {dispositions.length > 0 && (
                <Section title="Call Outcomes">
                  <div className="space-y-3">
                    {dispositions.map((d, i) => (
                      <DispositionCardView key={d.category} disposition={d} colorIndex={i} />
                    ))}
                  </div>
                </Section>
              )}

              {/* ── System Prompt ── */}
              {promptPreview && (
                <Section title="System Prompt Preview">
                  <div className="rounded-xl border border-border bg-card/60 p-4">
                    <p className="text-xs text-muted-foreground font-mono leading-relaxed whitespace-pre-wrap">
                      {promptPreview}
                      {phase === "building" && (
                        <span className="inline-block w-0.5 h-3 bg-primary ml-0.5 animate-pulse" />
                      )}
                    </p>
                  </div>
                </Section>
              )}

              {/* ── Done ── */}
              {phase === "done" && createdId && (
                <DoneCard agentName={createdName} agentId={createdId} navigate={navigate} />
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── sub-components ─────────────────────────────────────────────────────────── */

function Section({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className="animate-in fade-in duration-300">
      <div className="flex items-center gap-2 mb-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</p>
        {badge && (
          <span className="rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary">
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMsg }) {
  const isAi = msg.role === "ai";
  return (
    <div className={cn("flex gap-2.5", isAi ? "items-start" : "items-end flex-row-reverse")}>
      {isAi && (
        <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="h-3.5 w-3.5 text-primary" />
        </div>
      )}
      <div className={cn(
        "rounded-2xl px-3.5 py-2.5 text-sm max-w-[85%] whitespace-pre-wrap leading-relaxed",
        isAi ? "bg-elevated border border-border rounded-tl-sm" : "bg-primary text-primary-foreground rounded-tr-sm",
        !msg.done && isAi && "relative",
      )}>
        {msg.content}
        {!msg.done && isAi && msg.content && (
          <span className="inline-block w-0.5 h-3.5 bg-foreground/60 ml-0.5 align-middle animate-pulse" />
        )}
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex gap-2.5 items-start">
      <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
        <Bot className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="bg-elevated border border-border rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1 items-center">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  );
}

function FieldCard({ field, delay }: { field: AgentField; delay: number }) {
  const [visible, setVisible] = useState(false);
  const Icon = FIELD_ICONS[field.icon] ?? Bot;
  useEffect(() => { const t = setTimeout(() => setVisible(true), delay); return () => clearTimeout(t); }, [delay]);
  if (!visible) return null;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 animate-in fade-in slide-in-from-left-2 duration-300">
      <div className="h-6 w-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="h-3 w-3 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{field.label}</p>
        <p className="text-xs font-medium truncate">{field.value}</p>
      </div>
      <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
    </div>
  );
}

function VoiceCard({
  voice, isSelected, isPlaying, onPreview, onSelect,
}: {
  voice: VoiceOption;
  isSelected: boolean;
  isPlaying: boolean;
  onPreview: () => void;
  onSelect: () => void;
}) {
  return (
    <div className={cn(
      "rounded-xl border p-4 flex flex-col gap-3 transition-all duration-200",
      isSelected
        ? "border-primary/50 bg-primary/5 ring-1 ring-primary/30"
        : "border-border bg-card hover:border-border/80",
    )}>
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold text-sm">{voice.voiceName}</p>
          <p className="text-xs text-muted-foreground mt-0.5 capitalize">{voice.gender}</p>
        </div>
        {isSelected && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
      </div>
      {voice.description && (
        <p className="text-[11px] text-muted-foreground leading-snug">{voice.description}</p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 gap-1.5 h-7 text-xs"
          onClick={onPreview}
          disabled={isPlaying}
        >
          {isPlaying ? <Volume2 className="h-3 w-3 animate-pulse text-primary" /> : <Play className="h-3 w-3" />}
          {isPlaying ? "Playing…" : "Preview"}
        </Button>
        {!isSelected && (
          <Button size="sm" className="flex-1 gap-1 h-7 text-xs" onClick={onSelect}>
            Select
          </Button>
        )}
        {isSelected && (
          <span className="flex-1 flex items-center justify-center text-xs font-medium text-primary gap-1">
            <CheckCircle2 className="h-3 w-3" /> Chosen
          </span>
        )}
      </div>
    </div>
  );
}

function FeatureCard({ feature }: { feature: FeatureCard }) {
  const Icon = FEATURE_ICONS[feature.icon] ?? Sparkles;
  return (
    <div className={cn(
      "flex items-start gap-3 rounded-lg border px-3 py-3 animate-in fade-in duration-300",
      feature.enabled
        ? "border-primary/30 bg-primary/5"
        : "border-border bg-card/60 opacity-60",
    )}>
      <div className={cn(
        "h-6 w-6 rounded-md flex items-center justify-center shrink-0 mt-0.5",
        feature.enabled ? "bg-primary/15" : "bg-muted/30",
      )}>
        <Icon className={cn("h-3 w-3", feature.enabled ? "text-primary" : "text-muted-foreground")} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium">{feature.label}</p>
          <span className={cn(
            "rounded-full px-1.5 py-px text-[9px] font-semibold",
            feature.enabled ? "bg-green-500/15 text-green-500" : "bg-muted text-muted-foreground",
          )}>
            {feature.enabled ? "ON" : "OFF"}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{feature.detail}</p>
      </div>
    </div>
  );
}

function DispositionCardView({ disposition, colorIndex }: { disposition: DispositionCard; colorIndex: number }) {
  const colors = [
    { header: "bg-blue-500/10 border-blue-500/20 text-blue-400",    badge: "bg-blue-500/15 border-blue-500/25 text-blue-300" },
    { header: "bg-rose-500/10 border-rose-500/20 text-rose-400",    badge: "bg-rose-500/15 border-rose-500/25 text-rose-300" },
    { header: "bg-amber-500/10 border-amber-500/20 text-amber-400", badge: "bg-amber-500/15 border-amber-500/25 text-amber-300" },
    { header: "bg-violet-500/10 border-violet-500/20 text-violet-400", badge: "bg-violet-500/15 border-violet-500/25 text-violet-300" },
    { header: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400", badge: "bg-emerald-500/15 border-emerald-500/25 text-emerald-300" },
  ];
  const c = colors[colorIndex % colors.length]!;
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className={cn("flex items-center gap-2 px-4 py-2.5 border-b border-border", c.header)}>
        <div className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
        <p className="text-xs font-semibold">{disposition.category}</p>
        <span className="ml-auto text-[10px] opacity-60">{disposition.outcomes.length} outcomes</span>
      </div>
      <div className="px-4 py-3 flex flex-wrap gap-1.5">
        {disposition.outcomes.map(o => (
          <span key={o} className={cn("inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium", c.badge)}>
            {o}
          </span>
        ))}
      </div>
    </div>
  );
}

function EmptyPreview() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-24">
      <div className="relative">
        <div className="h-20 w-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Sparkles className="h-10 w-10 text-primary/60" />
        </div>
        <div className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary animate-ping opacity-40" />
        <div className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary" />
      </div>
      <div className="max-w-xs">
        <p className="font-semibold text-base">Your agent will appear here</p>
        <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
          Describe what you want in the chat and watch every detail build up in real time.
        </p>
      </div>
      <div className="flex flex-col gap-2 text-xs text-muted-foreground mt-2 text-left">
        {[
          "Voice selection with live preview",
          "Gender detection, call transfer, voicemail",
          "Booking & scheduling setup",
          "Compliance (DPDP / TRAI / IRDAI)",
          "Call outcome dispositions",
          "System prompt auto-generated",
        ].map(t => (
          <p key={t} className="flex items-center gap-2">
            <Sparkles className="h-3 w-3 text-primary shrink-0" /> {t}
          </p>
        ))}
      </div>
    </div>
  );
}

function DoneCard({ agentName, agentId, navigate }: { agentName: string; agentId: number; navigate: (to: string) => void }) {
  return (
    <div className="rounded-2xl border border-green-500/30 bg-green-500/5 p-6 text-center space-y-4 animate-in fade-in zoom-in-95 duration-500">
      <div className="flex justify-center">
        <div className="h-14 w-14 rounded-2xl bg-green-500/15 border border-green-500/20 flex items-center justify-center">
          <CheckCircle2 className="h-7 w-7 text-green-500" />
        </div>
      </div>
      <div>
        <p className="font-semibold text-base"><span className="text-green-400">{agentName}</span> is ready!</p>
        <p className="text-xs text-muted-foreground mt-1">All providers configured · System prompt generated · Ready to call</p>
      </div>
      <div className="flex gap-2 justify-center">
        <Button size="sm" className="gap-1.5" onClick={() => navigate(`/app/agents/${agentId}?webcall=1`)}>
          <Phone className="h-3.5 w-3.5" /> Make a Demo Call
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate(`/app/agents/${agentId}`)}>
          <Settings2 className="h-3.5 w-3.5" /> Edit Agent <ArrowRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
