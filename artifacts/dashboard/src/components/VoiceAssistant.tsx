import { useState, useRef, useCallback, useEffect, KeyboardEvent } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Mic, MicOff, X, Volume2, Bot, Loader2, Send, Wrench, CheckCircle2, AlertTriangle, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Draggable launcher constants ──────────────────────────────────────────────
const BUTTON_SIZE = 56; // h-14 w-14
const EDGE_MARGIN = 24; // default 1.5rem inset (bottom-6 right-6)
const VIEWPORT_PADDING = 8; // min gap from viewport edges when clamping
const PANEL_W = 420;
const PANEL_H = 580;
const POS_STORAGE_KEY = "voiceorch:assistantPos";
const DRAG_THRESHOLD = 5; // px of movement before an interaction counts as a drag

type Phase = "idle" | "listening" | "thinking" | "speaking" | "applying" | "error";

interface ProposalChange {
  field: string;
  label: string;
  current_value?: unknown;
  proposed_value: unknown;
  reason: string;
}

interface Proposal {
  agentId: number;
  agentName: string;
  summary: string;
  changes: ProposalChange[];
}

interface Message {
  role: "user" | "assistant";
  content: string;
  proposal?: Proposal;
  applied?: boolean;
}

// ── Speech recognition type shim ──────────────────────────────────────────────
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}
interface ISpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
}
declare global {
  interface Window {
    SpeechRecognition?: new () => ISpeechRecognition;
    webkitSpeechRecognition?: new () => ISpeechRecognition;
  }
}

function newRecognition(): ISpeechRecognition | null {
  const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = "en-US";
  r.continuous = false;
  r.interimResults = false;
  return r;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

// ── Proposal card ─────────────────────────────────────────────────────────────
function ProposalCard({
  proposal,
  applied,
  onApply,
  loading,
}: {
  proposal: Proposal;
  applied: boolean;
  onApply: (p: Proposal) => void;
  loading: boolean;
}) {
  return (
    <div
      className={cn(
        "mt-2 rounded-xl border overflow-hidden",
        applied
          ? "border-emerald-500/40 bg-emerald-500/10"
          : "border-border bg-card",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 border-b",
          applied ? "border-emerald-500/30 bg-emerald-500/15" : "border-border bg-muted/50",
        )}
      >
        <Wrench className={cn("w-3.5 h-3.5 shrink-0", applied ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")} />
        <span className={cn("text-xs font-medium", applied ? "text-emerald-700 dark:text-emerald-300" : "text-foreground")}>
          {applied ? <><CheckCircle2 className="h-3 w-3 inline mr-1" />Changes applied</> : `Update: ${proposal.agentName}`}
        </span>
      </div>

      <div className="px-3 py-2">
        <p className="text-[11px] mb-2 text-muted-foreground">{proposal.summary}</p>
        <div className="space-y-1.5">
          {proposal.changes.map((c, i) => (
            <div key={i} className="rounded-lg px-2.5 py-1.5 bg-muted/60">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-foreground">{c.label}</span>
                {c.current_value !== undefined && (
                  <span className="text-[10px] text-muted-foreground">
                    {formatValue(c.current_value)}
                    <ChevronRight className="inline w-2.5 h-2.5 mx-0.5 text-muted-foreground/70" />
                    <span className="text-primary">{formatValue(c.proposed_value)}</span>
                  </span>
                )}
                {c.current_value === undefined && (
                  <span className="text-[10px] text-primary">{formatValue(c.proposed_value)}</span>
                )}
              </div>
              <p className="text-[10px] mt-0.5 text-muted-foreground">{c.reason}</p>
            </div>
          ))}
        </div>

        {!applied && (
          <button
            onClick={() => onApply(proposal)}
            disabled={loading}
            className="mt-2.5 w-full rounded-lg py-1.5 text-xs font-semibold flex items-center justify-center gap-1.5 transition-opacity bg-primary text-primary-foreground disabled:opacity-60"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {loading ? "Applying…" : "Apply Changes"}
          </button>
        )}
      </div>
    </div>
  );
}

export function VoiceAssistant() {
  const [location] = useLocation();
  const { user, getToken } = useAuth();

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [textInput, setTextInput] = useState("");
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [greeted, setGreeted] = useState(false);
  const [error, setError] = useState("");

  // ── Draggable launcher position ─────────────────────────────────────────────
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try {
      const raw = localStorage.getItem(POS_STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
        if (typeof p.x === "number" && typeof p.y === "number") {
          return { x: p.x, y: p.y };
        }
      }
    } catch { /* ignore malformed storage */ }
    return {
      x: window.innerWidth - BUTTON_SIZE - EDGE_MARGIN,
      y: window.innerHeight - BUTTON_SIZE - EDGE_MARGIN,
    };
  });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);

  const clampButtonPos = useCallback((x: number, y: number) => {
    const maxX = Math.max(VIEWPORT_PADDING, window.innerWidth - BUTTON_SIZE - VIEWPORT_PADDING);
    const maxY = Math.max(VIEWPORT_PADDING, window.innerHeight - BUTTON_SIZE - VIEWPORT_PADDING);
    return {
      x: Math.min(Math.max(VIEWPORT_PADDING, x), maxX),
      y: Math.min(Math.max(VIEWPORT_PADDING, y), maxY),
    };
  }, []);

  // Persist position across reloads.
  useEffect(() => {
    try { localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
  }, [pos]);

  // Keep the button on-screen when the viewport is resized.
  useEffect(() => {
    function onResize() {
      setPos((p) => clampButtonPos(p.x, p.y));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampButtonPos]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const userName = user?.name?.split(" ")[0] ?? "";
  const pageUrl = location;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  // ── Audio playback ────────────────────────────────────────────────────────
  async function playAudio(arrayBuffer: ArrayBuffer): Promise<void> {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") await ctx.resume();
    return new Promise((resolve, reject) => {
      ctx.decodeAudioData(
        arrayBuffer,
        (decoded) => {
          const source = ctx.createBufferSource();
          source.buffer = decoded;
          source.connect(ctx.destination);
          source.onended = () => resolve();
          source.start(0);
        },
        reject,
      );
    });
  }

  async function speakText(text: string): Promise<void> {
    setPhase("speaking");
    try {
      const token = await getToken();
      const r = await fetch(`${BASE}/api/assistant/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) return;
      await playAudio(await r.arrayBuffer());
    } catch { /* TTS failures are non-fatal */ }
  }

  // ── Send message ─────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (userText: string, isFirst = false) => {
      const userMsg: Message = { role: "user", content: userText };
      const historyMsgs = isFirst ? [] : messages;

      if (!isFirst) setMessages((prev) => [...prev, userMsg]);
      setPhase("thinking");
      setTextInput("");

      try {
        const token = await getToken();
        const r = await fetch(`${BASE}/api/assistant/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            message: userText,
            history: historyMsgs.map((m) => ({ role: m.role, content: m.content })),
            userName,
            isFirst,
            pageUrl,
          }),
        });

        if (!r.ok) throw new Error(`Chat failed: ${r.status}`);

        const data = (await r.json()) as { text: string; navigate?: string | null; proposal?: Proposal | null };
        const assistantMsg: Message = {
          role: "assistant",
          content: data.text,
          proposal: data.proposal ?? undefined,
        };

        setMessages((prev) => (isFirst ? [assistantMsg] : [...prev, assistantMsg]));

        if (data.navigate) {
          // navigate happens via anchor in the message — or we can use wouter here
        }

        await speakText(data.text);
        setPhase("idle");
      } catch {
        setError("Something went wrong. Please try again.");
        setPhase("error");
        setTimeout(() => { setPhase("idle"); setError(""); }, 3000);
      }
    },
    [messages, userName, pageUrl, getToken],
  );

  // ── Apply proposal ────────────────────────────────────────────────────────
  const handleApplyProposal = useCallback(
    async (proposal: Proposal) => {
      setApplyingId(proposal.agentId);
      try {
        const token = await getToken();
        const r = await fetch(`${BASE}/api/assistant/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ agentId: proposal.agentId, changes: proposal.changes }),
        });
        if (!r.ok) throw new Error("Apply failed");

        setMessages((prev) =>
          prev.map((m) =>
            m.proposal?.agentId === proposal.agentId && !m.applied
              ? { ...m, applied: true }
              : m,
          ),
        );

        // Append a success message
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Done! I've applied ${proposal.changes.length} change${proposal.changes.length !== 1 ? "s" : ""} to ${proposal.agentName}. The agent will use the new settings on the next call. Want me to check anything else?`,
          },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Sorry, I couldn't apply those changes. Please try again or update the settings manually in the agent editor." },
        ]);
      } finally {
        setApplyingId(null);
      }
    },
    [getToken],
  );

  // ── Text send ─────────────────────────────────────────────────────────────
  function handleSend() {
    const text = textInput.trim();
    if (!text || phase !== "idle") return;
    void sendMessage(text);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ── Voice input ──────────────────────────────────────────────────────────
  function startListening() {
    if (phase !== "idle") return;
    const rec = newRecognition();
    if (!rec) {
      setError("Speech recognition not supported. Try Chrome.");
      setPhase("error");
      setTimeout(() => { setPhase("idle"); setError(""); }, 3000);
      return;
    }
    recognitionRef.current = rec;
    setPhase("listening");

    rec.onresult = (e: SpeechRecognitionEvent) => {
      const text = e.results[0]?.[0]?.transcript ?? "";
      rec.stop();
      if (text.trim()) void sendMessage(text.trim());
      else setPhase("idle");
    };
    rec.onerror = () => { setPhase("idle"); };
    rec.onend = () => { setPhase((p) => (p === "listening" ? "idle" : p)); };
    rec.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
    if (phase === "listening") setPhase("idle");
  }

  async function handleOpen() {
    setOpen(true);
    if (!greeted) {
      setGreeted(true);
      await sendMessage("Hello", true);
    }
  }

  function handleClose() {
    recognitionRef.current?.stop();
    setOpen(false);
  }

  // ── Drag handlers for the floating launcher ─────────────────────────────────
  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      d.moved = true;
      setDragging(true);
    }
    if (d.moved) {
      setPos(clampButtonPos(d.origX + dx, d.origY + dy));
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (d.moved) {
      setDragging(false);
    } else {
      // A tap/click without meaningful movement opens the panel.
      void handleOpen();
    }
  }

  const isBusy = phase === "thinking" || phase === "speaking" || phase === "applying";

  // Anchor the open panel to the button's bottom-right corner, clamped on-screen.
  const panelPos = (() => {
    const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - PANEL_W - VIEWPORT_PADDING);
    const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - PANEL_H - VIEWPORT_PADDING);
    return {
      left: Math.min(Math.max(VIEWPORT_PADDING, pos.x + BUTTON_SIZE - PANEL_W), maxLeft),
      top: Math.min(Math.max(VIEWPORT_PADDING, pos.y + BUTTON_SIZE - PANEL_H), maxTop),
    };
  })();

  // ── Suggested prompts ─────────────────────────────────────────────────────
  const suggestions = [
    "Show my agents",
    "Why are my calls slow?",
    "Write a system prompt for NBFC loan collection in Hindi",
    "Diagnose my agent",
  ];

  // The agent builder is a dense editing surface — a draggable launcher parked
  // over it covers form controls, so only surface the assistant once it's open.
  const hideLauncher = /^\/app\/agents\/[^/]+/.test(location);

  return (
    <>
      {/* ── Floating button ──────────────────────────────────────────────────── */}
      {!open && !hideLauncher && (
        <button
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="fixed z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95 bg-primary text-primary-foreground"
          style={{
            left: pos.x,
            top: pos.y,
            touchAction: "none",
            cursor: dragging ? "grabbing" : "grab",
          }}
          title="Open Orcha AI assistant · drag to move"
        >
          <Bot className="h-6 w-6" />
          <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/60 opacity-60" />
            <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-primary" />
          </span>
        </button>
      )}

      {/* ── Assistant panel ───────────────────────────────────────────────────── */}
      {open && (
        <div
          className="fixed z-50 flex flex-col rounded-2xl shadow-2xl overflow-hidden bg-card border border-border text-foreground"
          style={{ left: panelPos.left, top: panelPos.top, width: PANEL_W, height: PANEL_H }}
        >
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border shrink-0 bg-muted/40">
            <div className="flex h-8 w-8 items-center justify-center rounded-full shrink-0 bg-primary">
              <Bot className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground leading-none">Orcha</p>
              <p className="text-[10px] mt-0.5 text-muted-foreground">
                AI Platform Assistant · {pageUrl.replace("/app/", "").split("/")[0] || "home"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {phase === "speaking" && <Volume2 className="h-4 w-4 animate-pulse" style={{ color: "#818cf8" }} />}
              {phase === "thinking" && <Loader2 className="h-4 w-4 animate-spin" style={{ color: "#818cf8" }} />}
              {phase === "applying" && <Loader2 className="h-4 w-4 animate-spin" style={{ color: "#4ade80" }} />}
            </div>
            <button
              onClick={handleClose}
              className="flex h-7 w-7 items-center justify-center rounded-full transition-colors"
              style={{ color: "#475569" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#475569")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3" style={{ scrollbarWidth: "none" }}>
            {/* Loading state before first message */}
            {messages.length === 0 && phase === "thinking" && (
              <div className="flex gap-2 items-start">
                <div className="flex h-6 w-6 items-center justify-center rounded-full shrink-0" style={{ background: "#1e293b" }}>
                  <Bot className="h-3 w-3" style={{ color: "#818cf8" }} />
                </div>
                <div className="flex gap-1 items-center pt-1">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-1.5 w-1.5 rounded-full animate-bounce" style={{ background: "#475569", animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
              </div>
            )}

            {/* Suggestion chips when no messages yet */}
            {messages.length === 0 && phase === "idle" && (
              <div className="flex flex-col gap-2 mt-4">
                <p className="text-xs text-center" style={{ color: "#475569" }}>Try asking…</p>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => void sendMessage(s)}
                      className="text-[11px] px-2.5 py-1 rounded-full border transition-colors"
                      style={{ borderColor: "#1e293b", color: "#94a3b8", background: "#1e293b" }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#6366f1"; e.currentTarget.style.color = "#e2e8f0"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1e293b"; e.currentTarget.style.color = "#94a3b8"; }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Render messages */}
            {messages.map((msg, i) => (
              <div key={i} className={cn("flex gap-2", msg.role === "user" ? "justify-end" : "justify-start")}>
                {msg.role === "assistant" && (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full shrink-0 mt-0.5" style={{ background: "#1e293b" }}>
                    <Bot className="h-3 w-3" style={{ color: "#818cf8" }} />
                  </div>
                )}
                <div className={cn("flex flex-col gap-1", msg.role === "user" ? "items-end max-w-[85%]" : "items-start max-w-[90%]")}>
                  <div
                    className="px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap"
                    style={
                      msg.role === "user"
                        ? { background: "#6366f1", color: "#fff", borderBottomRightRadius: 4 }
                        : { background: "#1e293b", color: "#e2e8f0", borderBottomLeftRadius: 4 }
                    }
                  >
                    {msg.content}
                  </div>
                  {msg.proposal && (
                    <ProposalCard
                      proposal={msg.proposal}
                      applied={msg.applied ?? false}
                      loading={applyingId === msg.proposal.agentId}
                      onApply={handleApplyProposal}
                    />
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full shrink-0 mt-0.5 text-[10px] font-bold"
                    style={{ background: "#334155", color: "#94a3b8" }}>
                    {userName?.[0]?.toUpperCase() ?? "U"}
                  </div>
                )}
              </div>
            ))}

            {/* Thinking indicator after user sends */}
            {messages.length > 0 && phase === "thinking" && (
              <div className="flex gap-2 items-start">
                <div className="flex h-6 w-6 items-center justify-center rounded-full shrink-0" style={{ background: "#1e293b" }}>
                  <Bot className="h-3 w-3" style={{ color: "#818cf8" }} />
                </div>
                <div className="flex gap-1 items-center pt-1.5">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-1.5 w-1.5 rounded-full animate-bounce" style={{ background: "#475569", animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg" style={{ background: "#450a0a", color: "#fca5a5" }}>
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input bar */}
          <div className="shrink-0 border-t px-3 py-3" style={{ borderColor: "#1e293b" }}>
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={phase === "listening" ? "Listening…" : "Ask about your agents, calls, settings…"}
                disabled={isBusy}
                className="flex-1 text-sm rounded-xl px-3 py-2 outline-none transition-colors"
                style={{
                  background: "#1e293b",
                  color: "#e2e8f0",
                  border: "1px solid #334155",
                  opacity: isBusy ? 0.6 : 1,
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "#6366f1")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#334155")}
              />

              {/* Send button */}
              <button
                onClick={handleSend}
                disabled={!textInput.trim() || isBusy}
                className="flex h-9 w-9 items-center justify-center rounded-xl transition-all shrink-0"
                style={{
                  background: textInput.trim() && !isBusy ? "#6366f1" : "#1e293b",
                  color: textInput.trim() && !isBusy ? "#fff" : "#475569",
                }}
              >
                <Send className="h-4 w-4" />
              </button>

              {/* Mic button */}
              <button
                onClick={phase === "listening" ? stopListening : startListening}
                disabled={isBusy}
                className="flex h-9 w-9 items-center justify-center rounded-xl transition-all shrink-0"
                style={{
                  background: phase === "listening" ? "#7f1d1d" : "#1e293b",
                  color: phase === "listening" ? "#fca5a5" : "#475569",
                }}
                title={phase === "listening" ? "Stop listening" : "Voice input"}
              >
                {phase === "listening" ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            </div>

            <p className="text-[10px] text-center mt-1.5" style={{ color: "#334155" }}>
              Orcha can read your agents, diagnose issues, and apply fixes
            </p>
          </div>
        </div>
      )}
    </>
  );
}
