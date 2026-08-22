import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Mic, X, Send, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const BUTTON_SIZE = 64;
const EDGE_MARGIN = 28;
const VIEWPORT_PADDING = 12;
const PANEL_W = 420;
const PANEL_H = 640;
const POS_STORAGE_KEY = "voiceorch:assistantPos";
const DRAG_THRESHOLD = 5;

type Phase = "idle" | "listening" | "thinking" | "speaking" | "error";

interface Recommendation {
  id: string;
  title: string;
  reason: string;
  href: string;
}

interface DoneItem {
  label: string;
  message: string;
  href?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  recommendations?: Recommendation[];
  done?: DoneItem[];
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
  r.interimResults = true;
  return r;
}

function JarvisOrb({ phase }: { phase: Phase }) {
  const listening = phase === "listening";
  const thinking = phase === "thinking";
  const speaking = phase === "speaking";
  return (
    <div className="relative mx-auto flex h-28 w-28 items-center justify-center">
      <span
        className={cn(
          "absolute inset-0 rounded-full border opacity-40 motion-reduce:animate-none",
          listening && "animate-ping border-cyan-300",
          speaking && "animate-pulse border-amber-300",
          thinking && "animate-pulse border-white/40",
          phase === "idle" && "border-white/20",
        )}
      />
      <span
        className={cn(
          "absolute inset-3 rounded-full border motion-reduce:animate-none",
          listening && "animate-pulse border-cyan-200/80",
          speaking && "border-amber-200/70",
          thinking && "border-white/30",
          phase === "idle" && "border-white/15",
        )}
      />
      <button
        type="button"
        tabIndex={-1}
        className={cn(
          "relative z-10 flex h-16 w-16 items-center justify-center rounded-full shadow-[0_0_40px_rgba(251,191,36,0.25)]",
          listening && "bg-cyan-300 text-slate-950",
          speaking && "bg-amber-300 text-slate-950",
          thinking && "bg-white/90 text-slate-950",
          phase === "idle" && "bg-gradient-to-b from-amber-200 to-amber-400 text-slate-950",
          phase === "error" && "bg-red-400 text-slate-950",
        )}
        aria-hidden
      >
        {thinking ? <Loader2 className="h-6 w-6 animate-spin" /> : <Mic className="h-6 w-6" />}
      </button>
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
  const [interim, setInterim] = useState("");
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
  }, [messages, interim]);

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
    } catch { /* TTS optional */ }
  }

  const startListening = useCallback(() => {
    const rec = newRecognition();
    if (!rec) {
      setError("Chrome or Edge la pesu da — ila type pannu.");
      setPhase("error");
      setTimeout(() => { setPhase("idle"); setError(""); }, 2800);
      return;
    }
    recognitionRef.current = rec;
    setPhase("listening");
    setInterim("");
    rec.onresult = (e: SpeechRecognitionEvent) => {
      const last = e.results[e.results.length - 1];
      const text = last?.[0]?.transcript ?? "";
      if (!last) return;
      if (last.isFinal) {
        rec.stop();
        setInterim("");
        if (text.trim()) void sendMessageRef.current(text.trim());
        else setPhase("idle");
      } else {
        setInterim(text);
      }
    };
    rec.onerror = () => { setPhase("idle"); setInterim(""); };
    rec.onend = () => { setPhase((p) => (p === "listening" ? "idle" : p)); };
    rec.start();
  }, []);

  const sendMessage = useCallback(
    async (userText: string, isFirst = false) => {
      const historyMsgs = isFirst ? [] : messages;
      if (!isFirst) setMessages((prev) => [...prev, { role: "user", content: userText }]);
      setPhase("thinking");
      setTextInput("");
      setInterim("");

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
          recommendations?: Recommendation[];
          done?: DoneItem[];
        };
        setMessages((prev) => (isFirst
          ? [{ role: "assistant", content: data.text, recommendations: data.recommendations, done: data.done }]
          : [...prev, { role: "assistant", content: data.text, recommendations: data.recommendations, done: data.done }]));

        if (data.navigate?.startsWith("/app/")) navigate(data.navigate);

        listenAfterSpeakRef.current = true;
        await speakText(data.text);
        setPhase("idle");
        if (listenAfterSpeakRef.current) {
          listenAfterSpeakRef.current = false;
          startListening();
        }
      } catch {
        setError("Jarvis reach aagala. Innoru thadava try pannu.");
        setPhase("error");
        setTimeout(() => { setPhase("idle"); setError(""); }, 3000);
      }
    },
    [messages, userName, pageUrl, getToken, navigate, startListening],
  );

  sendMessageRef.current = sendMessage;

  function goHref(href: string) {
    if (href.startsWith("/app/") || href.startsWith("/docs/")) navigate(href);
  }

  function handleSend() {
    const text = textInput.trim();
    if (!text || phase === "thinking" || phase === "speaking") return;
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
    setInterim("");
    if (phase === "listening") setPhase("idle");
  }

  async function handleOpen() {
    setOpen(true);
    if (!greeted) {
      setGreeted(true);
      await sendMessage("Vanakkam, enna setup pannanum?", true);
    } else if (phase === "idle") {
      startListening();
    }
  }

  function handleClose() {
    recognitionRef.current?.stop();
    listenAfterSpeakRef.current = false;
    setOpen(false);
    setPhase("idle");
    setInterim("");
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

  const isBusy = phase === "thinking" || phase === "speaking";

  const panelPos = (() => {
    const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - PANEL_W - VIEWPORT_PADDING);
    const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - PANEL_H - VIEWPORT_PADDING);
    return {
      left: Math.min(Math.max(VIEWPORT_PADDING, pos.x + BUTTON_SIZE - PANEL_W), maxLeft),
      top: Math.min(Math.max(VIEWPORT_PADDING, pos.y + BUTTON_SIZE - PANEL_H), maxTop),
    };
  })();

  const phaseCopy =
    phase === "listening" ? "Listening…"
      : phase === "thinking" ? "Setup pannitu irukken…"
        : phase === "speaking" ? "Jarvis pesitu irukku"
          : "Pesa start pannu";

  return (
    <>
      {!open && onBuilder && (
        <button
          type="button"
          onClick={() => void handleOpen()}
          className="fixed top-1/2 right-0 z-50 flex -translate-y-1/2 cursor-pointer items-center gap-1.5 rounded-l-xl border border-r-0 border-amber-300/30 bg-slate-950 px-2 py-3 text-amber-200 shadow-lg"
          title="Talk to Jarvis"
        >
          <span className="text-[10px] font-semibold tracking-[0.2em] [writing-mode:vertical-rl]">JARVIS</span>
        </button>
      )}

      {!open && !onBuilder && (
        <button
          type="button"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="fixed z-50 flex h-16 w-16 cursor-grab items-center justify-center rounded-full bg-slate-950 text-amber-200 shadow-[0_8px_40px_rgba(15,23,42,0.45)] transition-transform hover:scale-105 active:scale-95"
          style={{ left: pos.x, top: pos.y, touchAction: "none", cursor: dragging ? "grabbing" : "grab" }}
          title="Talk to Jarvis"
        >
          <span className="absolute inset-0 rounded-full bg-gradient-to-b from-amber-200/20 to-transparent" />
          <Mic className="relative h-6 w-6" />
          <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-300/70 motion-reduce:animate-none" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-300" />
          </span>
        </button>
      )}

      {open && (
        <div
          className="fixed z-50 flex flex-col overflow-hidden rounded-[28px] border border-white/10 text-white shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
          style={{
            left: panelPos.left,
            top: panelPos.top,
            width: PANEL_W,
            height: PANEL_H,
            background: "linear-gradient(180deg, #0b1220 0%, #111827 55%, #0a0f1a 100%)",
          }}
        >
          <div className="flex shrink-0 items-center justify-between px-5 pt-4">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.28em] text-amber-200/80">JARVIS</p>
              <p className="mt-0.5 text-[11px] text-white/50">{phaseCopy}</p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={phase === "listening" ? stopListening : startListening}
            disabled={isBusy}
            className="cursor-pointer disabled:opacity-70"
            title={phase === "listening" ? "Stop" : "Speak"}
          >
            <JarvisOrb phase={phase} />
          </button>
          <p className="mb-2 px-6 text-center text-[11px] text-white/45">
            Karthikeyan voice · Tanglish · just talk, I will create
          </p>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-2" style={{ scrollbarWidth: "none" }}>
            {messages.map((msg, i) => (
              <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[92%] space-y-2", msg.role === "user" ? "items-end" : "items-start")}>
                  <div
                    className={cn(
                      "whitespace-pre-wrap px-3.5 py-2.5 text-[13.5px] leading-relaxed",
                      msg.role === "user"
                        ? "rounded-2xl rounded-br-md bg-white/10 text-white"
                        : "rounded-2xl rounded-bl-md bg-white/[0.06] text-amber-50",
                    )}
                  >
                    {msg.content}
                  </div>
                  {msg.done && msg.done.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {msg.done.map((d, di) => (
                        <button
                          key={`${d.label}-${di}`}
                          type="button"
                          onClick={() => d.href && goHref(d.href)}
                          className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-medium text-emerald-200"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          {d.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {msg.recommendations && msg.recommendations.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      {msg.recommendations.map((rec) => (
                        <button
                          key={rec.id}
                          type="button"
                          onClick={() => goHref(rec.href)}
                          className="cursor-pointer rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left hover:bg-white/[0.08]"
                        >
                          <p className="text-[12px] font-medium text-white">{rec.title}</p>
                          <p className="mt-0.5 text-[10px] leading-4 text-white/45">{rec.reason}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {interim && (
              <p className="text-center text-[12px] italic text-cyan-200/80">“{interim}”</p>
            )}

            {error && (
              <div className="flex items-center gap-2 rounded-xl bg-red-500/15 px-3 py-2 text-xs text-red-200">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="shrink-0 border-t border-white/10 px-3 py-3">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={phase === "listening" ? "Listening…" : "Priya collection agent create pannu…"}
                disabled={isBusy}
                className="h-10 flex-1 rounded-full border border-white/10 bg-white/5 px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-200/40 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!textInput.trim() || isBusy}
                className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-amber-300 text-slate-950 disabled:bg-white/10 disabled:text-white/30"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
