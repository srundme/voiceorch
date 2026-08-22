import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getListAgentsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { looksLikeVibeBuild, shouldAutoOpenJarvis } from "@/lib/jarvis-vibe";
import { Mic, X, Send, CheckCircle2, AlertTriangle, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

interface VoicePick {
  voiceId: string;
  voiceName: string;
  gender: string;
  language: string;
  description: string;
}

interface PhonePick {
  id: number;
  number: string;
  region: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  recommendations?: Recommendation[];
  done?: DoneItem[];
  voices?: VoicePick[];
  phones?: PhonePick[];
}

type VibeTurn = { role: "user" | "assistant"; content: string };

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
  r.lang = "ta-IN";
  r.continuous = false;
  r.interimResults = true;
  return r;
}

export function VoiceAssistant() {
  const [location, navigate] = useLocation();
  const { user, getToken } = useAuth();
  const queryClient = useQueryClient();

  const [expanded, setExpanded] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [textInput, setTextInput] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const [vibeStatus, setVibeStatus] = useState("");

  const audioCtxRef = useRef<AudioContext | null>(null);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sendMessageRef = useRef<(userText: string, isFirst?: boolean) => Promise<void>>(async () => {});
  const vibeActiveRef = useRef(false);
  const vibeHistoryRef = useRef<VibeTurn[]>([]);
  const voicesRef = useRef<{ shown: boolean; list: VoicePick[] }>({ shown: false, list: [] });
  const selectedVoiceIdRef = useRef("");
  const greetedRef = useRef(false);
  const autoOpenedRef = useRef(false);

  const userName = user?.name?.split(" ")[0] ?? "";
  const pageUrl = location;

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

  function speakInBackground(text: string) {
    void (async () => {
      setPhase("speaking");
      try {
        const token = await getToken();
        const r = await fetch(`${BASE}/api/assistant/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ text }),
        });
        if (r.ok) await playAudio(await r.arrayBuffer());
      } catch { /* TTS optional */ }
      setPhase((p) => (p === "speaking" ? "idle" : p));
    })();
  }

  const startListening = useCallback(() => {
    const rec = newRecognition();
    if (!rec) {
      setError("Chrome / Edge-ல பேசு — இல்ல டைப் பண்ணு.");
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

  const sendVibe = useCallback(
    async (userText: string) => {
      setMessages((prev) => [...prev, { role: "user", content: userText }]);
      setPhase("thinking");
      setTextInput("");
      setInterim("");
      setVibeStatus("");
      vibeActiveRef.current = true;

      const history: VibeTurn[] = [...vibeHistoryRef.current, { role: "user", content: userText }];
      const token = await getToken();
      const resp = await fetch(`${BASE}/api/agents/vibe-chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          persona: "jarvis",
          messages: history,
          voicesShown: voicesRef.current.shown,
          availableVoices: voicesRef.current.list,
          selectedVoiceId: selectedVoiceIdRef.current,
        }),
      });
      if (!resp.ok || !resp.body) throw new Error(`Vibe failed: ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let aiReply = "";
      let voices: VoicePick[] = [];
      let phones: PhonePick[] = [];
      let created: { agentId: number; agentName: string } | null = null;
      let streamError = "";

      const flushAssistant = (partial: string) => {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && last.content.startsWith(partial.slice(0, 12))) {
            next[next.length - 1] = { ...last, content: partial, voices: voices.length ? voices : last.voices, phones: phones.length ? phones : last.phones };
            return next;
          }
          return [...next, { role: "assistant", content: partial, voices, phones }];
        });
      };

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
              aiReply += String(evt.delta ?? "");
              flushAssistant(aiReply);
              break;
            case "voice_options": {
              voices = (evt.voices as VoicePick[]) ?? [];
              if (voices.length) voicesRef.current = { shown: true, list: voices };
              if (aiReply) flushAssistant(aiReply);
              break;
            }
            case "voice_selected":
              selectedVoiceIdRef.current = String(evt.voiceId ?? "");
              voices = [];
              break;
            case "phone_number_options":
              phones = (evt.numbers as PhonePick[]) ?? [];
              if (aiReply) flushAssistant(aiReply);
              break;
            case "phone_number_selected":
              phones = [];
              break;
            case "status":
              setVibeStatus(String(evt.message ?? ""));
              break;
            case "created":
              created = { agentId: Number(evt.agentId), agentName: String(evt.agentName ?? "Agent") };
              vibeActiveRef.current = false;
              break;
            case "error":
              streamError = String(evt.message ?? "Vibe failed");
              break;
            default:
              break;
          }
        }
      }

      if (streamError && !aiReply) throw new Error(streamError);
      vibeHistoryRef.current = [...history, { role: "assistant", content: aiReply || streamError }];

      const doneItems: DoneItem[] = created
        ? [{ label: created.agentName, message: "Agent ready", href: `/app/agents/${created.agentId}` }]
        : [];
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") {
          next[next.length - 1] = {
            ...last,
            content: aiReply || last.content,
            voices: voices.length ? voices : undefined,
            phones: phones.length ? phones : undefined,
            done: doneItems.length ? doneItems : last.done,
          };
          return next;
        }
        return [...next, { role: "assistant", content: aiReply || streamError, voices, phones, done: doneItems }];
      });

      if (created) {
        setVibeStatus("");
        void queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
        navigate(`/app/agents/${created.agentId}`);
      }

      const spoken = aiReply || (created ? `${created.agentName} ready.` : "");
      setPhase("idle");
      if (spoken) speakInBackground(spoken);
    },
    [getToken, navigate, queryClient],
  );

  const sendAssistant = useCallback(
    async (userText: string, isFirst: boolean) => {
      const historyMsgs = isFirst ? [] : messages;
      if (!isFirst) setMessages((prev) => [...prev, { role: "user", content: userText }]);
      setPhase("thinking");
      setTextInput("");
      setInterim("");

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
      setPhase("idle");
      if (data.text) speakInBackground(data.text);
    },
    [messages, userName, pageUrl, getToken, navigate],
  );

  const sendMessage = useCallback(
    async (userText: string, isFirst = false) => {
      try {
        const startVibe = !isFirst && (vibeActiveRef.current || looksLikeVibeBuild(userText));
        if (startVibe) {
          await sendVibe(userText);
          return;
        }
        await sendAssistant(userText, isFirst);
      } catch {
        setError("ஜார்விஸ் ரீச் ஆகல. இன்னொரு தடவை ட்ரை பண்ணு.");
        setPhase("error");
        setTimeout(() => { setPhase("idle"); setError(""); }, 3000);
      }
    },
    [sendVibe, sendAssistant],
  );

  sendMessageRef.current = sendMessage;

  function goHref(href: string) {
    if (href.startsWith("/app/") || href.startsWith("/docs/")) navigate(href);
  }

  function handleSend() {
    const text = textInput.trim();
    if (!text || phase === "thinking") return;
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

  function greetIfNeeded() {
    if (greetedRef.current) return;
    greetedRef.current = true;
    void sendMessageRef.current("வணக்கம்", true);
  }

  useEffect(() => {
    if (autoOpenedRef.current) return;
    let sessionFlag: string | null = null;
    try { sessionFlag = sessionStorage.getItem("jarvis:open"); } catch { /* ignore */ }
    const auto = shouldAutoOpenJarvis(window.location.search, sessionFlag);
    autoOpenedRef.current = true;
    try { sessionStorage.removeItem("jarvis:open"); } catch { /* ignore */ }
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("jarvis")) {
        url.searchParams.delete("jarvis");
        window.history.replaceState({}, "", url.pathname + url.search + url.hash);
      }
    } catch { /* ignore */ }
    if (auto) {
      setExpanded(true);
      greetIfNeeded();
    }
  }, []);

  const isBusy = phase === "thinking";
  const phaseCopy =
    phase === "listening" ? "கேட்டுக்கிட்டு இருக்கேன்"
      : phase === "thinking" ? "யோசிக்கிறேன்…"
        : phase === "speaking" ? "பேசுறேன்"
          : vibeStatus || "பேச்சுத் தமிழ்";

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-border bg-background",
        "border-t md:border-l md:border-t-0",
        expanded
          ? "h-[min(42vh,380px)] md:h-auto md:w-[300px]"
          : "h-12 md:h-auto md:w-11",
      )}
    >
      {!expanded ? (
        <button
          type="button"
          onClick={() => { setExpanded(true); greetIfNeeded(); }}
          className="flex h-full w-full cursor-pointer items-center justify-between gap-2 px-3 text-left md:flex-col md:justify-center md:px-0 md:py-4"
        >
          <span className="text-[12px] font-semibold tracking-wide md:[writing-mode:vertical-rl]">Jarvis</span>
          <span className="hidden text-[10px] text-muted-foreground md:inline md:[writing-mode:vertical-rl]">பேசு</span>
          <ChevronLeft className="hidden size-3.5 text-muted-foreground md:block" />
          <ChevronRight className="size-3.5 text-muted-foreground md:hidden" />
        </button>
      ) : (
        <>
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold leading-none">Jarvis</p>
              <p className="mt-1 truncate text-[11px] text-muted-foreground">{phaseCopy}</p>
            </div>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Hide Jarvis"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
            {messages.length === 0 && (
              <p className="text-[12px] leading-5 text-muted-foreground">
                வணக்கம் — பேசலாம், இல்ல ஏஜென்ட் கிரியேட் பண்ண சொல்லு.
              </p>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                <div className="max-w-[95%] space-y-1.5">
                  <div
                    className={cn(
                      "whitespace-pre-wrap rounded-lg px-2.5 py-2 text-[13px] leading-relaxed",
                      msg.role === "user"
                        ? "bg-muted text-foreground"
                        : "border border-border bg-card text-foreground",
                    )}
                  >
                    {msg.content}
                  </div>
                  {msg.done && msg.done.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {msg.done.map((d, di) => (
                        <button
                          key={`${d.label}-${di}`}
                          type="button"
                          onClick={() => d.href && goHref(d.href)}
                          className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px]"
                        >
                          <CheckCircle2 className="size-3 text-emerald-600" />
                          {d.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {msg.voices && msg.voices.length > 0 && (
                    <div className="flex flex-col gap-1">
                      {msg.voices.slice(0, 5).map((v) => (
                        <button
                          key={v.voiceId}
                          type="button"
                          onClick={() => void sendMessage(`I'll go with ${v.voiceName} (voiceId: ${v.voiceId})`)}
                          className="cursor-pointer rounded-md border border-border px-2 py-1.5 text-left hover:bg-muted"
                        >
                          <p className="text-[12px] font-medium">{v.voiceName}</p>
                          <p className="text-[10px] text-muted-foreground">{v.language} · {v.gender}</p>
                        </button>
                      ))}
                    </div>
                  )}
                  {msg.phones && msg.phones.length > 0 && (
                    <div className="flex flex-col gap-1">
                      {msg.phones.slice(0, 5).map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => void sendMessage(`Assign ${n.number} (number id ${n.id}) as the inbound number`)}
                          className="cursor-pointer rounded-md border border-border px-2 py-1.5 text-left hover:bg-muted"
                        >
                          <p className="text-[12px] font-medium">{n.number}</p>
                          <p className="text-[10px] text-muted-foreground">{n.region || "Voice number"}</p>
                        </button>
                      ))}
                    </div>
                  )}
                  {msg.recommendations && msg.recommendations.length > 0 && (
                    <div className="flex flex-col gap-1">
                      {msg.recommendations.map((rec) => (
                        <button
                          key={rec.id}
                          type="button"
                          onClick={() => goHref(rec.href)}
                          className="cursor-pointer rounded-md border border-border px-2 py-1.5 text-left hover:bg-muted"
                        >
                          <p className="text-[12px] font-medium">{rec.title}</p>
                          <p className="text-[10px] leading-4 text-muted-foreground">{rec.reason}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {interim && <p className="text-[12px] italic text-muted-foreground">“{interim}”</p>}
            {error && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[12px] text-destructive">
                <AlertTriangle className="size-3.5 shrink-0" />
                {error}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="shrink-0 border-t border-border p-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={phase === "listening" ? stopListening : startListening}
                disabled={isBusy}
                className={cn(
                  "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border",
                  phase === "listening" && "bg-foreground text-background",
                  phase !== "listening" && "hover:bg-muted",
                )}
                title={phase === "listening" ? "Stop" : "Speak"}
              >
                {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Mic className="size-3.5" />}
              </button>
              <input
                ref={inputRef}
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={phase === "listening" ? "கேட்கிறேன்…" : "சொல்லு…"}
                disabled={isBusy}
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-[13px] outline-none placeholder:text-muted-foreground focus:border-foreground disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!textInput.trim() || isBusy}
                className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md bg-foreground text-background disabled:bg-muted disabled:text-muted-foreground"
              >
                <Send className="size-3.5" />
              </button>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
