import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Mic, MicOff, X, Volume2, Bot, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Phase = "idle" | "listening" | "thinking" | "speaking" | "error";

interface Message {
  role: "user" | "assistant";
  content: string;
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

export function VoiceAssistant() {
  const [, navigate] = useLocation();
  const { user, getToken } = useAuth();

  const [open, setOpen]         = useState(false);
  const [phase, setPhase]       = useState<Phase>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [transcript, setTranscript] = useState("");
  const [error, setError]       = useState("");
  const [greeted, setGreeted]   = useState(false);

  const audioCtxRef   = useRef<AudioContext | null>(null);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const userName = user?.name?.split(" ")[0] ?? "";

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Play WAV buffer via Web Audio API ────────────────────────────────────────
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
        (err) => reject(err),
      );
    });
  }

  // ── Call /api/assistant/tts and play result ───────────────────────────────
  async function speakText(text: string): Promise<void> {
    setPhase("speaking");
    try {
      const token = await getToken();
      const res = await fetch(`${BASE}/api/assistant/tts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return; // silently skip TTS if not configured
      const buf = await res.arrayBuffer();
      await playAudio(buf);
    } catch {
      // TTS failures are non-fatal — message is already shown in chat
    }
  }

  // ── Send message to /api/assistant/chat ──────────────────────────────────
  const sendMessage = useCallback(async (userText: string, isFirst = false) => {
    const userMsg: Message = { role: "user", content: userText };
    const nextHistory = isFirst ? [] : messages;

    if (!isFirst) {
      setMessages(prev => [...prev, userMsg]);
    }

    setPhase("thinking");
    setTranscript("");

    try {
      const token = await getToken();
      const res = await fetch(`${BASE}/api/assistant/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: userText,
          history: nextHistory.map(m => ({ role: m.role, content: m.content })),
          userName,
          isFirst,
        }),
      });

      if (!res.ok) throw new Error(`Chat failed: ${res.status}`);

      const data = await res.json() as { text: string; navigate: string | null };
      const assistantMsg: Message = { role: "assistant", content: data.text };

      setMessages(prev => isFirst ? [assistantMsg] : [...prev, assistantMsg]);

      // Navigate if requested
      if (data.navigate) {
        navigate(`${data.navigate}`);
      }

      // Speak the response
      await speakText(data.text);
      setPhase("idle");
    } catch (err: any) {
      setError("Something went wrong. Please try again.");
      setPhase("error");
      setTimeout(() => { setPhase("idle"); setError(""); }, 3000);
    }
  }, [messages, navigate, userName]);

  // ── Open assistant & trigger welcome ────────────────────────────────────────
  async function handleOpen() {
    setOpen(true);
    if (!greeted) {
      setGreeted(true);
      await sendMessage("Hello", true);
    }
  }

  // ── Push-to-talk ─────────────────────────────────────────────────────────────
  function startListening() {
    if (phase !== "idle") return;
    const rec = newRecognition();
    if (!rec) {
      setError("Speech recognition not supported in this browser. Try Chrome.");
      setPhase("error");
      setTimeout(() => { setPhase("idle"); setError(""); }, 4000);
      return;
    }

    recognitionRef.current = rec;
    setPhase("listening");
    setTranscript("");

    rec.onresult = (e: SpeechRecognitionEvent) => {
      const text = e.results[0]?.[0]?.transcript ?? "";
      setTranscript(text);
      rec.stop();
      if (text.trim()) void sendMessage(text.trim());
      else setPhase("idle");
    };

    rec.onerror = () => {
      setPhase("idle");
      setTranscript("");
    };

    rec.onend = () => {
      setPhase(prev => prev === "listening" ? "idle" : prev);
    };

    rec.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
    if (phase === "listening") setPhase("idle");
  }

  function handleClose() {
    recognitionRef.current?.stop();
    setOpen(false);
  }

  const isBusy = phase === "thinking" || phase === "speaking";

  return (
    <>
      {/* ── Floating button ──────────────────────────────────────────────────── */}
      {!open && (
        <button
          onClick={() => void handleOpen()}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all hover:scale-105 active:scale-95"
          style={{ background: "linear-gradient(135deg, #1e293b 0%, #334155 100%)" }}
          title="Open AI assistant"
        >
          <Bot className="h-6 w-6 text-white" />
          {/* Live indicator */}
          <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-zinc-400 opacity-75" />
            <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-zinc-500" />
          </span>
        </button>
      )}

      {/* ── Assistant panel ───────────────────────────────────────────────────── */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col rounded-2xl shadow-2xl overflow-hidden"
          style={{ width: 340, height: 480, background: "#0f172a" }}>

          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0"
            style={{ borderColor: "#1e293b" }}>
            <div className="flex h-8 w-8 items-center justify-center rounded-full shrink-0"
              style={{ background: "linear-gradient(135deg, #a1a1aa, #a1a1aa)" }}>
              <Bot className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white leading-none">Orcha</p>
              <p className="text-[10px] mt-0.5" style={{ color: "#64748b" }}>AI Voice Assistant</p>
            </div>
            <div className="flex items-center gap-1.5">
              {phase === "speaking" && (
                <Volume2 className="h-4 w-4 animate-pulse" style={{ color: "#a1a1aa" }} />
              )}
              {phase === "thinking" && (
                <Loader2 className="h-4 w-4 animate-spin" style={{ color: "#a1a1aa" }} />
              )}
            </div>
            <button onClick={handleClose}
              className="flex h-7 w-7 items-center justify-center rounded-full transition-colors"
              style={{ color: "#64748b" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
              onMouseLeave={e => (e.currentTarget.style.color = "#64748b")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2.5"
            style={{ scrollbarWidth: "none" }}>
            {messages.length === 0 && phase === "thinking" && (
              <div className="flex gap-2 items-start">
                <div className="flex h-6 w-6 items-center justify-center rounded-full shrink-0"
                  style={{ background: "#1e293b" }}>
                  <Bot className="h-3.5 w-3.5" style={{ color: "#a1a1aa" }} />
                </div>
                <div className="rounded-2xl rounded-tl-sm px-3 py-2" style={{ background: "#1e293b" }}>
                  <div className="flex gap-1 items-center h-4">
                    {[0, 1, 2].map(i => (
                      <span key={i} className="h-1.5 w-1.5 rounded-full animate-bounce"
                        style={{ background: "#a1a1aa", animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={cn("flex gap-2 items-start", m.role === "user" && "flex-row-reverse")}>
                {m.role === "assistant" && (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full shrink-0"
                    style={{ background: "#1e293b" }}>
                    <Bot className="h-3.5 w-3.5" style={{ color: "#a1a1aa" }} />
                  </div>
                )}
                <div className={cn(
                  "rounded-2xl px-3 py-2 text-sm max-w-[85%] leading-relaxed",
                  m.role === "assistant"
                    ? "rounded-tl-sm text-white"
                    : "rounded-tr-sm text-white",
                )}
                  style={{ background: m.role === "assistant" ? "#1e293b" : "#52525b" }}>
                  {m.content}
                </div>
              </div>
            ))}

            {/* Thinking indicator after messages */}
            {messages.length > 0 && phase === "thinking" && (
              <div className="flex gap-2 items-start">
                <div className="flex h-6 w-6 items-center justify-center rounded-full shrink-0"
                  style={{ background: "#1e293b" }}>
                  <Bot className="h-3.5 w-3.5" style={{ color: "#a1a1aa" }} />
                </div>
                <div className="rounded-2xl rounded-tl-sm px-3 py-2" style={{ background: "#1e293b" }}>
                  <div className="flex gap-1 items-center h-4">
                    {[0, 1, 2].map(i => (
                      <span key={i} className="h-1.5 w-1.5 rounded-full animate-bounce"
                        style={{ background: "#a1a1aa", animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Status / transcript bar */}
          <div className="px-4 py-2 min-h-[28px] shrink-0" style={{ borderTop: "1px solid #1e293b" }}>
            {phase === "listening" && (
              <p className="text-xs animate-pulse text-foreground font-semibold">
                🎙 Listening{transcript ? `: "${transcript}"` : "…"}
              </p>
            )}
            {phase === "speaking" && (
              <p className="text-xs text-muted-foreground">🔊 Speaking…</p>
            )}
            {phase === "thinking" && (
              <p className="text-xs text-muted-foreground">Thinking…</p>
            )}
            {phase === "error" && (
              <p className="text-xs text-foreground font-semibold underline">{error}</p>
            )}
          </div>

          {/* Mic controls */}
          <div className="flex items-center justify-center gap-4 px-4 py-4 shrink-0"
            style={{ borderTop: "1px solid #1e293b" }}>
            <p className="text-[11px] flex-1 text-left" style={{ color: "#475569" }}>
              {phase === "idle" ? "Press mic to speak" : ""}
            </p>
            <button
              onMouseDown={startListening}
              onMouseUp={() => { if (phase === "listening") stopListening(); }}
              onTouchStart={e => { e.preventDefault(); startListening(); }}
              onTouchEnd={e => { e.preventDefault(); if (phase === "listening") stopListening(); }}
              disabled={isBusy}
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-full transition-all",
                phase === "listening"
                  ? "scale-110"
                  : isBusy
                    ? "opacity-40 cursor-not-allowed"
                    : "hover:scale-105 active:scale-95",
              )}
              style={{
                background: phase === "listening"
                  ? "hsl(var(--foreground))"
                  : isBusy
                    ? "hsl(var(--muted))"
                    : "hsl(var(--foreground) / 0.85)",
                boxShadow: phase === "listening" ? "0 0 0 8px hsl(var(--foreground) / 0.2)" : undefined,
              }}
              title={phase === "listening" ? "Release to send" : "Hold to speak"}
            >
              {phase === "listening"
                ? <MicOff className="h-5 w-5 text-white" />
                : <Mic className="h-5 w-5 text-white" />}
            </button>
            <div className="flex-1" />
          </div>
        </div>
      )}
    </>
  );
}
