import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import {
  Mic,
  MicOff,
  X,
  Volume2,
  Bot,
  Loader2,
  Send,
  Wrench,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const BUTTON_SIZE = 56;
const EDGE_MARGIN = 24;
const VIEWPORT_PADDING = 8;
const PANEL_W = 400;
const PANEL_H = 600;
const POS_STORAGE_KEY = "voiceorch:assistantPos";
const DRAG_THRESHOLD = 5;

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

interface Recommendation {
  id: string;
  title: string;
  reason: string;
  href: string;
  priority: "high" | "medium" | "low";
}

interface Job {
  type: "navigate" | "set_agent_status" | "create_campaign" | "assign_phone";
  label: string;
  href?: string;
  agentId?: number;
  status?: "draft" | "active";
  campaignName?: string;
  phoneNumberId?: number;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  proposal?: Proposal;
  recommendations?: Recommendation[];
  jobs?: Job[];
  applied?: boolean;
}

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
  onend: ((e: Event) => void) | null;
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
  r.lang = "en-IN";
  r.continuous = false;
  r.interimResults = false;
  return r;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

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
        "mt-2 overflow-hidden rounded-xl border",
        applied ? "border-emerald-500/40 bg-emerald-500/10" : "border-border bg-card",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 border-b px-3 py-2",
          applied ? "border-emerald-500/30 bg-emerald-500/15" : "border-border bg-muted/50",
        )}
      >
        <Wrench className={cn("h-3.5 w-3.5 shrink-0", applied ? "text-emerald-600" : "text-muted-foreground")} />
        <span className={cn("text-xs font-medium", applied ? "text-emerald-700 dark:text-emerald-300" : "text-foreground")}>
          {applied ? (
            <>
              <CheckCircle2 className="mr-1 inline h-3 w-3" />
              Changes applied
            </>
          ) : (
            `Update: ${proposal.agentName}`
          )}
        </span>
      </div>
      <div className="px-3 py-2">
        <p className="mb-2 text-[11px] text-muted-foreground">{proposal.summary}</p>
        <div className="space-y-1.5">
          {proposal.changes.map((c, i) => (
            <div key={i} className="rounded-lg bg-muted/60 px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-foreground">{c.label}</span>
                <span className="text-[10px] text-muted-foreground">
                  {c.current_value !== undefined && (
                    <>
                      {formatValue(c.current_value)}
                      <ChevronRight className="mx-0.5 inline h-2.5 w-2.5" />
                    </>
                  )}
                  <span className="text-primary">{formatValue(c.proposed_value)}</span>
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{c.reason}</p>
            </div>
          ))}
        </div>
        {!applied && (
          <button
            type="button"
            onClick={() => onApply(proposal)}
            disabled={loading}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {loading ? "Applying…" : "Apply changes"}
          </button>
        )}
      </div>
    </div>
  );
}

function RecsAndJobs({
  recommendations,
  jobs,
  busy,
  onHref,
  onJob,
}: {
  recommendations?: Recommendation[];
  jobs?: Job[];
  busy: boolean;
  onHref: (href: string) => void;
  onJob: (job: Job) => void;
}) {
  if ((!recommendations || recommendations.length === 0) && (!jobs || jobs.length === 0)) return null;
  return (
    <div className="mt-2 flex w-full flex-col gap-1.5">
      {recommendations?.map((rec) => (
        <button
          key={rec.id}
          type="button"
          onClick={() => onHref(rec.href)}
          className="rounded-xl border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/60"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-foreground">{rec.title}</span>
            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          </div>
          <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{rec.reason}</p>
        </button>
      ))}
      {jobs?.map((job, i) => (
        <button
          key={`${job.type}-${i}`}
          type="button"
          disabled={busy}
          onClick={() => onJob(job)}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-foreground px-3 py-2 text-xs font-semibold text-background disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {job.label}
        </button>
      ))}
    </div>
  );
}

export function VoiceAssistant() {
  const [location, navigate] = useLocation();
  const { user, getToken } = useAuth();

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [textInput, setTextInput] = useState("");
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [jobBusy, setJobBusy] = useState(false);
  const [greeted, setGreeted] = useState(false);
  const [error, setError] = useState("");

  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try {
      const raw = localStorage.getItem(POS_STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
        if (typeof p.x === "number" && typeof p.y === "number") return { x: p.x, y: p.y };
      }
    } catch { /* ignore */ }
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

  useEffect(() => {
    try { localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
  }, [pos]);

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
  const listenAfterSpeakRef = useRef(false);
  const sendMessageRef = useRef<(userText: string, isFirst?: boolean) => Promise<void>>(async () => {});

  const userName = user?.name?.split(" ")[0] ?? "";
  const pageUrl = location;
  const onBuilder = /^\/app\/agents\/[^/]+/.test(location);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

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
    } catch { /* TTS is optional */ }
  }

  const startListening = useCallback(() => {
    const rec = newRecognition();
    if (!rec) {
      setError("Voice needs Chrome or Edge. Type instead.");
      setPhase("error");
      setTimeout(() => { setPhase("idle"); setError(""); }, 3000);
      return;
    }
    recognitionRef.current = rec;
    setPhase("listening");
    rec.onresult = (e: SpeechRecognitionEvent) => {
      const text = e.results[0]?.[0]?.transcript ?? "";
      rec.stop();
      if (text.trim()) void sendMessageRef.current(text.trim());
      else setPhase("idle");
    };
    rec.onerror = () => { setPhase("idle"); };
    rec.onend = () => { setPhase((p) => (p === "listening" ? "idle" : p)); };
    rec.start();
  }, []);

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

        const data = (await r.json()) as {
          text: string;
          navigate?: string | null;
          proposal?: Proposal | null;
          recommendations?: Recommendation[];
          jobs?: Job[];
        };
        const assistantMsg: Message = {
          role: "assistant",
          content: data.text,
          proposal: data.proposal ?? undefined,
          recommendations: data.recommendations,
          jobs: data.jobs,
        };
        setMessages((prev) => (isFirst ? [assistantMsg] : [...prev, assistantMsg]));

        if (data.navigate && data.navigate.startsWith("/app/")) {
          navigate(data.navigate);
        }

        listenAfterSpeakRef.current = isFirst;
        await speakText(data.text);
        setPhase("idle");
        if (listenAfterSpeakRef.current) {
          listenAfterSpeakRef.current = false;
          startListening();
        }
      } catch {
        setError("Jarvis could not reach the workspace. Try again.");
        setPhase("error");
        setTimeout(() => { setPhase("idle"); setError(""); }, 3000);
      }
    },
    [messages, userName, pageUrl, getToken, navigate, startListening],
  );

  sendMessageRef.current = sendMessage;

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
            m.proposal?.agentId === proposal.agentId && !m.applied ? { ...m, applied: true } : m,
          ),
        );
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Done. ${proposal.agentName} will use the new settings on the next call.`,
          },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "I could not apply those changes. Update them in the agent editor if you prefer." },
        ]);
      } finally {
        setApplyingId(null);
      }
    },
    [getToken],
  );

  const runJob = useCallback(
    async (job: Job) => {
      setJobBusy(true);
      try {
        const token = await getToken();
        const r = await fetch(`${BASE}/api/assistant/job`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(job),
        });
        const data = (await r.json()) as { success?: boolean; navigate?: string; message?: string; error?: string };
        if (!r.ok) throw new Error(data.error || "Job failed");
        if (data.navigate?.startsWith("/app/")) navigate(data.navigate);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.message || "Done." },
        ]);
        await speakText(data.message || "Done.");
        setPhase("idle");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "I could not finish that job.";
        setMessages((prev) => [...prev, { role: "assistant", content: msg }]);
      } finally {
        setJobBusy(false);
      }
    },
    [getToken, navigate],
  );

  function goHref(href: string) {
    if (href.startsWith("/app/") || href.startsWith("/docs/")) navigate(href);
  }

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

  function stopListening() {
    recognitionRef.current?.stop();
    if (phase === "listening") setPhase("idle");
  }

  async function handleOpen() {
    setOpen(true);
    if (!greeted) {
      setGreeted(true);
      await sendMessage("What should I do next?", true);
    }
  }

  function handleClose() {
    recognitionRef.current?.stop();
    listenAfterSpeakRef.current = false;
    setOpen(false);
    setPhase("idle");
  }

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
    if (d.moved) setPos(clampButtonPos(d.origX + dx, d.origY + dy));
  }

  function handlePointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (d.moved) setDragging(false);
    else void handleOpen();
  }

  const isBusy = phase === "thinking" || phase === "speaking" || phase === "applying" || jobBusy;

  const panelPos = (() => {
    const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - PANEL_W - VIEWPORT_PADDING);
    const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - PANEL_H - VIEWPORT_PADDING);
    return {
      left: Math.min(Math.max(VIEWPORT_PADDING, pos.x + BUTTON_SIZE - PANEL_W), maxLeft),
      top: Math.min(Math.max(VIEWPORT_PADDING, pos.y + BUTTON_SIZE - PANEL_H), maxTop),
    };
  })();

  const phaseLabel =
    phase === "listening" ? "Listening"
      : phase === "thinking" ? "Working"
        : phase === "speaking" ? "Speaking"
          : phase === "applying" ? "Applying"
            : "Ready";

  return (
    <>
      {!open && onBuilder && (
        <button
          type="button"
          onClick={() => void handleOpen()}
          className="fixed top-1/2 right-0 z-50 flex -translate-y-1/2 items-center gap-1.5 rounded-l-lg border border-r-0 border-border bg-foreground px-2 py-3 text-background shadow-md"
          title="Talk to Jarvis"
        >
          <Bot className="h-3.5 w-3.5" />
          <span className="text-[10px] font-semibold tracking-wide [writing-mode:vertical-rl]">Jarvis</span>
        </button>
      )}

      {!open && !onBuilder && (
        <button
          type="button"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="fixed z-50 flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-background shadow-lg transition-transform hover:scale-105 active:scale-95"
          style={{ left: pos.x, top: pos.y, touchAction: "none", cursor: dragging ? "grabbing" : "grab" }}
          title="Talk to Jarvis · drag to move"
        >
          <Bot className="h-6 w-6" />
          <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground/50 opacity-60" />
            <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-primary" />
          </span>
        </button>
      )}

      {open && (
        <div
          className="fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-2xl"
          style={{ left: panelPos.left, top: panelPos.top, width: PANEL_W, height: PANEL_H }}
        >
          <div className="flex shrink-0 items-center gap-2.5 border-b border-border bg-muted/40 px-4 py-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground">
              <Bot className="h-4 w-4 text-background" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-none">Jarvis</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {phaseLabel} · speaks and does jobs for you
              </p>
            </div>
            {phase === "speaking" && <Volume2 className="h-4 w-4 animate-pulse text-primary" />}
            {(phase === "thinking" || jobBusy) && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            <button
              type="button"
              onClick={handleClose}
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3" style={{ scrollbarWidth: "none" }}>
            {messages.length === 0 && phase === "thinking" && (
              <div className="flex items-start gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Bot className="h-3 w-3" />
                </div>
                <p className="pt-1 text-[11px] text-muted-foreground">Looking at your workspace…</p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={cn("flex gap-2", msg.role === "user" ? "justify-end" : "justify-start")}>
                {msg.role === "assistant" && (
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Bot className="h-3 w-3" />
                  </div>
                )}
                <div className={cn("flex flex-col gap-1", msg.role === "user" ? "max-w-[85%] items-end" : "max-w-[90%] items-start")}>
                  <div
                    className={cn(
                      "whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed",
                      msg.role === "user"
                        ? "rounded-br-sm bg-foreground text-background"
                        : "rounded-bl-sm bg-muted text-foreground",
                    )}
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
                  {msg.role === "assistant" && (
                    <RecsAndJobs
                      recommendations={msg.recommendations}
                      jobs={msg.jobs}
                      busy={isBusy}
                      onHref={goHref}
                      onJob={(job) => void runJob(job)}
                    />
                  )}
                </div>
              </div>
            ))}

            {messages.length > 0 && phase === "thinking" && (
              <div className="flex items-start gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Bot className="h-3 w-3" />
                </div>
                <div className="flex items-center gap-1 pt-1.5">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="shrink-0 border-t border-border px-3 py-3">
            <div className="mb-2 flex justify-center">
              <button
                type="button"
                onClick={phase === "listening" ? stopListening : startListening}
                disabled={isBusy && phase !== "listening"}
                className={cn(
                  "flex h-14 w-14 items-center justify-center rounded-full shadow-sm transition-transform disabled:opacity-50",
                  phase === "listening"
                    ? "bg-destructive text-destructive-foreground animate-pulse"
                    : "bg-foreground text-background hover:scale-105",
                )}
                title={phase === "listening" ? "Stop listening" : "Speak to Jarvis"}
              >
                {phase === "listening" ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={phase === "listening" ? "Listening…" : "Or type — publish agent, assign number…"}
                disabled={isBusy}
                className="h-9 flex-1 rounded-xl border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-ring disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!textInput.trim() || isBusy}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background disabled:bg-muted disabled:text-muted-foreground"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
              Jarvis recommends the next step, then does the job when you confirm
            </p>
          </div>
        </div>
      )}
    </>
  );
}
