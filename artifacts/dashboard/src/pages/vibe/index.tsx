import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Bot, Send, ArrowRight, Phone, Settings2, Sparkles,
  Globe, Mic, Cpu, Ear, Speaker, Building2, PhoneIncoming,
  PhoneOutgoing, CheckCircle2, Loader2, ChevronLeft, Zap,
} from "lucide-react";
import { useListAgents, getListAgentsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

/* ── types ─────────────────────────────────────────────────────────────────── */

interface ChatMsg {
  id:      string;
  role:    "user" | "ai";
  content: string;
  done?:   boolean;
}

interface AgentField {
  key:   string;
  label: string;
  value: string;
  icon:  string;
}

type Phase = "idle" | "thinking" | "streaming" | "building" | "done";

const ICON_MAP: Record<string, React.ElementType> = {
  bot:      Bot,
  building: Building2,
  globe:    Globe,
  mic:      Mic,
  phone:    PhoneIncoming,
  cpu:      Cpu,
  ear:      Ear,
  speaker:  Speaker,
};

/* ── helpers ────────────────────────────────────────────────────────────────── */

function getToken(): string | null {
  try { return localStorage.getItem("voiceorch:session"); } catch { return null; }
}

function uid() { return Math.random().toString(36).slice(2); }

const GREETING: ChatMsg = {
  id:      "greeting",
  role:    "ai",
  content: "Hey! I'm your AI agent builder 👋\n\nJust tell me what kind of voice agent you want to create — what it does, what language it speaks, and who it'll be talking to. I'll handle all the technical setup automatically.",
  done:    true,
};

/* ── main component ─────────────────────────────────────────────────────────── */

export default function VibePage() {
  const [, navigate] = useLocation();
  const queryClient  = useQueryClient();

  const [messages,       setMessages]       = useState<ChatMsg[]>([GREETING]);
  const [input,          setInput]          = useState("");
  const [phase,          setPhase]          = useState<Phase>("idle");
  const [fields,         setFields]         = useState<AgentField[]>([]);
  const [promptPreview,  setPromptPreview]  = useState("");
  const [statusMsg,      setStatusMsg]      = useState("");
  const [createdId,      setCreatedId]      = useState<number | null>(null);
  const [createdName,    setCreatedName]    = useState("");

  const chatEndRef   = useRef<HTMLDivElement>(null);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const historyRef   = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const abortRef     = useRef<AbortController | null>(null);

  // Scroll chat to bottom whenever messages change
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

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || phase === "building" || phase === "thinking" || phase === "streaming") return;

    setInput("");

    // Add user message + placeholder AI message
    const userMsg: ChatMsg   = { id: uid(), role: "user", content: text, done: true };
    const aiMsg:   ChatMsg   = { id: uid(), role: "ai",   content: "",   done: false };
    setMessages(prev => [...prev, userMsg, aiMsg]);
    setPhase("thinking");

    // Build history for API
    const history = [
      ...historyRef.current,
      { role: "user" as const, content: text },
    ];

    const token = getToken();
    abortRef.current = new AbortController();

    try {
      const resp = await fetch("/api/agents/vibe-chat", {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${token ?? ""}`,
        },
        body:   JSON.stringify({ messages: history }),
        signal: abortRef.current.signal,
      });

      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`);
      }

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

            case "field":
              setPhase("building");
              setFields(prev => {
                const next = [...prev];
                const idx = next.findIndex(f => f.key === evt.key);
                const field: AgentField = {
                  key:   evt.key   as string,
                  label: evt.label as string,
                  value: evt.value as string,
                  icon:  evt.icon  as string,
                };
                if (idx >= 0) next[idx] = field;
                else next.push(field);
                return next;
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
              // Finalise the AI message
              setMessages(prev => prev.map(m =>
                (!m.done && m.role === "ai") ? { ...m, done: true } : m
              ));
              queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
              break;

            case "error":
              setMessages(prev => prev.map(m =>
                (!m.done && m.role === "ai")
                  ? { ...m, content: `❌ ${evt.message as string}`, done: true }
                  : m
              ));
              setPhase("idle");
              break;
          }
        }
      }

      // Finalise AI message + push to history
      setMessages(prev => prev.map(m =>
        (!m.done && m.role === "ai") ? { ...m, done: true } : m
      ));
      historyRef.current = [
        ...historyRef.current,
        { role: "user",      content: text    },
        { role: "assistant", content: aiReply },
      ];

      if (phase !== "done") setPhase("idle");
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") return;
      setMessages(prev => prev.map(m =>
        (!m.done && m.role === "ai")
          ? { ...m, content: "Something went wrong. Please try again.", done: true }
          : m
      ));
      setPhase("idle");
    }
  }, [input, phase, appendAiDelta, queryClient]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const canSend = input.trim().length > 0 && phase !== "building" && phase !== "thinking" && phase !== "streaming";

  return (
    <div className="fixed inset-0 flex bg-background overflow-hidden">

      {/* ── Left: Chat panel ──────────────────────────────────────────── */}
      <div className="flex flex-col w-[420px] min-w-[360px] border-r border-border bg-card">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <button
            onClick={() => navigate("/app/agents")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
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
          {messages.map(msg => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
          {(phase === "thinking") && <ThinkingIndicator />}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-border">
          <div className="flex gap-2 items-end">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={phase === "done" ? "Agent created! 🎉" : "Describe your voice agent…"}
              disabled={phase === "done" || phase === "building"}
              rows={2}
              className="resize-none text-sm flex-1"
            />
            <Button
              size="icon"
              onClick={send}
              disabled={!canSend}
              className="h-10 w-10 shrink-0"
            >
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

      {/* ── Right: Agent preview panel ────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-background">

        {/* Header */}
        <div className="flex items-center justify-between px-8 py-4 border-b border-border">
          <div>
            <p className="font-semibold text-sm">Agent Preview</p>
            <p className="text-xs text-muted-foreground">
              {phase === "idle"     && "Waiting for your description…"}
              {phase === "thinking" && "AI is thinking…"}
              {phase === "streaming"&& "Chatting with you…"}
              {phase === "building" && (statusMsg || "Configuring your agent…")}
              {phase === "done"     && "Agent created successfully!"}
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
          {phase === "idle" && fields.length === 0 && (
            <EmptyPreview />
          )}

          {fields.length > 0 && (
            <div className="space-y-6 max-w-xl">

              {/* Field cards */}
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                  Agent Configuration
                </p>
                <div className="space-y-2">
                  {fields.map((f, i) => (
                    <FieldRow key={f.key} field={f} delay={i * 50} />
                  ))}
                  {(phase === "building" || phase === "done") && fields.length < 8 && (
                    <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-4 py-2.5">
                      <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
                      <span className="text-xs text-muted-foreground">Configuring…</span>
                    </div>
                  )}
                </div>
              </div>

              {/* System prompt preview */}
              {promptPreview && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                    System Prompt Preview
                  </p>
                  <div className="rounded-xl border border-border bg-card p-4">
                    <p className="text-xs text-muted-foreground font-mono leading-relaxed whitespace-pre-wrap">
                      {promptPreview}
                      {phase === "building" && (
                        <span className="inline-block w-0.5 h-3 bg-primary ml-0.5 animate-pulse" />
                      )}
                    </p>
                  </div>
                </div>
              )}

              {/* Done card */}
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

function MessageBubble({ msg }: { msg: ChatMsg }) {
  const isAi = msg.role === "ai";
  return (
    <div className={cn("flex gap-2.5", isAi ? "items-start" : "items-end flex-row-reverse")}>
      {isAi && (
        <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="h-3.5 w-3.5 text-primary" />
        </div>
      )}
      <div
        className={cn(
          "rounded-2xl px-3.5 py-2.5 text-sm max-w-[85%] whitespace-pre-wrap leading-relaxed",
          isAi
            ? "bg-elevated border border-border rounded-tl-sm"
            : "bg-primary text-primary-foreground rounded-tr-sm",
          !msg.done && isAi && "relative",
        )}
      >
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

function FieldRow({ field, delay }: { field: AgentField; delay: number }) {
  const [visible, setVisible] = useState(false);
  const Icon = ICON_MAP[field.icon] ?? Bot;

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  if (!visible) return null;

  return (
    <div className={cn(
      "flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 transition-all duration-300",
      "animate-in fade-in slide-in-from-left-2",
    )}>
      <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{field.label}</p>
        <p className="text-sm font-medium truncate">{field.value}</p>
      </div>
      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
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
          Describe what you want in the chat — name, language, purpose — and watch it come to life in real time.
        </p>
      </div>
      <div className="flex flex-col gap-2 text-xs text-muted-foreground mt-2">
        <p className="flex items-center gap-2"><Sparkles className="h-3 w-3 text-primary" /> AI picks the best STT, LLM & TTS for your language</p>
        <p className="flex items-center gap-2"><Sparkles className="h-3 w-3 text-primary" /> System prompt generated from your description</p>
        <p className="flex items-center gap-2"><Sparkles className="h-3 w-3 text-primary" /> Recording, auto-redial configured automatically</p>
      </div>
    </div>
  );
}

function DoneCard({ agentName, agentId, navigate }: { agentName: string; agentId: number; navigate: (to: string) => void }) {
  return (
    <div className="rounded-2xl border border-green-500/30 bg-green-500/5 p-6 text-center space-y-4">
      <div className="flex justify-center">
        <div className="h-14 w-14 rounded-2xl bg-green-500/15 border border-green-500/20 flex items-center justify-center">
          <CheckCircle2 className="h-7 w-7 text-green-500" />
        </div>
      </div>
      <div>
        <p className="font-semibold text-base">
          <span className="text-green-400">{agentName}</span> is ready!
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          System prompt generated · All providers configured · Ready to call
        </p>
      </div>
      <div className="flex gap-2 justify-center">
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => navigate(`/app/agents/${agentId}?webcall=1`)}
        >
          <Phone className="h-3.5 w-3.5" /> Make a Demo Call
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => navigate(`/app/agents/${agentId}`)}
        >
          <Settings2 className="h-3.5 w-3.5" /> Edit Agent
          <ArrowRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
