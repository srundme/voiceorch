import React, { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, PhoneOff, Volume2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

type CallStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "ended";
interface Msg { speaker: "user" | "agent"; text: string }

export function useWebcallKeyStatus() {
  const [keys, setKeys]       = useState<Record<string, boolean> | null>(null);
  const [loading, setLoading] = useState(true);
  const { getToken } = useAuth();
  useEffect(() => {
    void (async () => {
      try {
        const token = await getToken();
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const r = await fetch("/api/billing/webcall-key-status", { headers });
        const d: Record<string, boolean> | null = r.ok ? await r.json() as Record<string, boolean> : null;
        setKeys(d);
      } catch { /* ignore */ } finally { setLoading(false); }
    })();
  }, [getToken]);
  return { keys, loading };
}

/** Render agent text with optional sentence highlight. */
function AgentText({ text, highlight }: { text: string; highlight: string }) {
  if (!highlight) return <>{text}</>;
  const idx = text.indexOf(highlight);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-primary/40 text-foreground rounded px-0.5 not-italic">{highlight}</mark>
      {text.slice(idx + highlight.length)}
    </>
  );
}

export function WebCallPanel({
  agentId, agentName, autostart, callbackId, compact,
}: {
  agentId: number;
  agentName: string;
  autostart?: boolean;
  callbackId?: number;
  compact?: boolean;
}) {
  const [status, setStatus]               = useState<CallStatus>("idle");
  const [msgs, setMsgs]                   = useState<Msg[]>([]);
  const [error, setError]                 = useState<string | null>(null);
  const [duration, setDuration]           = useState<number | null>(null);
  // token streaming: accumulate LLM tokens as a "typing" bubble
  const [streamingText, setStreamingText] = useState<string>("");
  // stale flag: when barge-in fires, freeze bubble instead of clearing
  const [streamingStale, setStreamingStale] = useState<boolean>(false);
  // sentence highlight: which sentence the agent is currently speaking
  const [speakingSentence, setSpeakingSentence] = useState<string>("");
  // full agent reply received from backend — committed to msgs after TTS finishes
  const pendingAgentTextRef = useRef<string | null>(null);
  const { keys: keyStatus, loading: keyLoading } = useWebcallKeyStatus();
  const { userId: callerUserId, getToken } = useAuth();
  const hasAutoStarted = useRef(false);

  const wsRef            = useRef<WebSocket | null>(null);
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const processorRef     = useRef<ScriptProcessorNode | null>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const nextPlayRef      = useRef(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const mutedRef         = useRef(false);
  const transcriptRef    = useRef<HTMLDivElement>(null);
  const statusRef        = useRef<CallStatus>("idle");
  // ref mirror for stale flag — safe to read inside WS message closure
  const streamingStaleRef = useRef(false);

  useEffect(() => { statusRef.current = status; }, [status]);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [msgs, streamingText]);

  function float32ToInt16(f32: Float32Array): Int16Array {
    const int16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      int16[i] = Math.max(-32768, Math.min(32767, f32[i]! * 32768));
    }
    return int16;
  }

  function downsampleFloat32(input: Float32Array, fromRate: number, toRate: number): Float32Array {
    if (fromRate === toRate) return input;
    const ratio = fromRate / toRate;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const a = input[idx] ?? 0;
      const b = input[idx + 1] ?? a;
      output[i] = a + frac * (b - a);
    }
    return output;
  }

  function stopAllAudio() {
    for (const src of activeSourcesRef.current) { try { src.stop(); } catch { /**/ } }
    activeSourcesRef.current = [];
    const ctx = audioCtxRef.current;
    if (ctx) nextPlayRef.current = ctx.currentTime;
  }

  function playPCM16(buf: ArrayBuffer) {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const int16 = new Int16Array(buf);
    const f32   = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;
    const abuf  = ctx.createBuffer(1, f32.length, 16000);
    abuf.getChannelData(0).set(f32);
    const src   = ctx.createBufferSource();
    src.buffer  = abuf;
    src.connect(ctx.destination);
    const now   = ctx.currentTime;
    nextPlayRef.current = Math.max(now + 0.02, nextPlayRef.current);
    src.start(nextPlayRef.current);
    nextPlayRef.current += abuf.duration;
    activeSourcesRef.current.push(src);
    src.onended = () => { activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== src); };
  }

  function cleanup() {
    processorRef.current?.disconnect();
    processorRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (wsRef.current && wsRef.current.readyState < 2) wsRef.current.close();
    wsRef.current = null;
    // finalize any pending agent turn before clearing
    if (pendingAgentTextRef.current) {
      const t = pendingAgentTextRef.current;
      pendingAgentTextRef.current = null;
      setMsgs(prev => [...prev, { speaker: "agent", text: t }]);
    }
    // clear streaming state
    setStreamingText("");
    setSpeakingSentence("");
    streamingStaleRef.current = false;
    setStreamingStale(false);
  }

  const startCall = useCallback(async () => {
    if (wsRef.current || (statusRef.current !== "idle" && statusRef.current !== "ended")) return;
    setError(null);
    setMsgs([]);
    setDuration(null);
    setStreamingText("");
    setSpeakingSentence("");
    pendingAgentTextRef.current = null;
    streamingStaleRef.current = false;
    setStreamingStale(false);
    setStatus("connecting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
      });
      streamRef.current = stream;
      const proto  = location.protocol === "https:" ? "wss" : "ws";
      // Exchange the session JWT for a short-lived single-use ticket so the
      // JWT never appears in the WebSocket URL (and therefore never in server
      // access logs).  The ticket is valid for 60 s and consumed on first use.
      const sessionToken = await getToken();
      const ticketHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (sessionToken) ticketHeaders["Authorization"] = `Bearer ${sessionToken}`;
      const ticketRes = await fetch("/api/webcall/ticket", {
        method: "POST",
        headers: ticketHeaders,
        body: JSON.stringify({ agentId }),
      });
      if (!ticketRes.ok) throw new Error("Failed to obtain webcall ticket — check your session.");
      const { ticket } = await ticketRes.json() as { ticket: string };
      const qsParts: string[] = [`ticket=${encodeURIComponent(ticket)}`];
      if (callerUserId) qsParts.push(`callerId=${encodeURIComponent(callerUserId)}`);
      if (callbackId)   qsParts.push(`callbackId=${callbackId}`);
      const qs = `?${qsParts.join("&")}`;
      const ws = new WebSocket(`${proto}://${location.host}/api/ws/webcall/${agentId}${qs}`);
      ws.binaryType  = "arraybuffer";
      wsRef.current  = ws;

      ws.onopen = () => {
        const AudioCtx  = (window as any).AudioContext || (window as any).webkitAudioContext;
        const ctx       = new AudioCtx({ sampleRate: 16000 }) as AudioContext;
        audioCtxRef.current  = ctx;
        nextPlayRef.current  = 0;
        const src       = ctx.createMediaStreamSource(stream);
        const processor = ctx.createScriptProcessor(2048, 1, 1);
        processorRef.current = processor;
        src.connect(processor);
        processor.connect(ctx.destination);
        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const raw = e.inputBuffer.getChannelData(0);
          const samples = ctx.sampleRate === 16000 ? raw : downsampleFloat32(raw, ctx.sampleRate, 16000);
          ws.send(float32ToInt16(samples).buffer);
        };
      };

      ws.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) {
          if (!mutedRef.current) playPCM16(e.data);
          return;
        }
        try {
          const msg = JSON.parse(e.data as string) as {
            type: string; status?: CallStatus; speaker?: "user" | "agent";
            text?: string; index?: number; durationSeconds?: number; message?: string;
          };
          if (msg.type === "ready") {
            setStatus("listening");
          } else if (msg.type === "token") {
            // Accumulate LLM tokens progressively into the streaming bubble.
            // Each event carries a raw token chunk to append (not the full text).
            const chunk = msg.text ?? "";
            if (streamingStaleRef.current) {
              // New turn after barge-in — wipe stale text and start fresh
              streamingStaleRef.current = false;
              setStreamingStale(false);
              setStreamingText(chunk);
            } else {
              setStreamingText(prev => prev + chunk);
            }
          } else if (msg.type === "interrupted") {
            // Barge-in: commit any pending agent turn, then clear state
            stopAllAudio();
            if (pendingAgentTextRef.current) {
              const t = pendingAgentTextRef.current;
              pendingAgentTextRef.current = null;
              setMsgs(prev => [...prev, { speaker: "agent", text: t }]);
            }
            setStreamingText("");
            mutedRef.current = true;
            streamingStaleRef.current = true;
            setStreamingStale(true);
            setSpeakingSentence("");
            setStatus("listening");
          } else if (msg.type === "sentence_start") {
            // TTS starting a sentence — keep streaming text visible, just update highlight
            streamingStaleRef.current = false;
            setStreamingStale(false);
            setSpeakingSentence(msg.text ?? "");
          } else if (msg.type === "status" && msg.status) {
            if (msg.status === "thinking" || msg.status === "speaking") mutedRef.current = false;
            if (msg.status === "listening") {
              // Agent finished speaking — commit the pending turn to msgs
              setSpeakingSentence("");
              if (pendingAgentTextRef.current) {
                const t = pendingAgentTextRef.current;
                pendingAgentTextRef.current = null;
                setStreamingText("");
                streamingStaleRef.current = false;
                setStreamingStale(false);
                setMsgs(prev => [...prev, { speaker: "agent", text: t }]);
              }
            }
            setStatus(msg.status);
          } else if (msg.type === "transcript" && msg.speaker && msg.text) {
            if (msg.speaker === "agent") {
              // Store full text; keep streaming bubble visible during TTS playback.
              // Will be committed to msgs when status → listening (agent done speaking).
              pendingAgentTextRef.current = msg.text;
              // Ensure bubble shows the complete text (tokens may still be trickling)
              setStreamingText(msg.text);
              streamingStaleRef.current = false;
              setStreamingStale(false);
            } else {
              // User transcript — add immediately
              setStreamingText("");
              streamingStaleRef.current = false;
              setStreamingStale(false);
              setMsgs(prev => [...prev, { speaker: "user", text: msg.text! }]);
            }
          } else if (msg.type === "ended") {
            setDuration(msg.durationSeconds ?? null);
            if (pendingAgentTextRef.current) {
              const t = pendingAgentTextRef.current;
              pendingAgentTextRef.current = null;
              setMsgs(prev => [...prev, { speaker: "agent", text: t }]);
            }
            setStreamingText("");
            setStatus("ended");
            cleanup();
          } else if (msg.type === "error") {
            setError(msg.message ?? "An error occurred");
            setStreamingText("");
            setStatus("idle");
            cleanup();
          }
        } catch { /**/ }
      };

      ws.onclose = () => { if (statusRef.current !== "ended" && statusRef.current !== "idle") setStatus("idle"); cleanup(); };
      ws.onerror = () => { setError("Connection failed. Check your API keys."); setStatus("idle"); cleanup(); };
    } catch {
      setError("Microphone access was denied or is unavailable.");
      setStatus("idle");
    }
  }, [agentId, callerUserId, callbackId]);

  const endCall = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "end" }));
    setStatus("idle");
    cleanup();
  }, []);

  useEffect(() => () => { cleanup(); }, []);

  const missingKeys: string[] = [];
  if (keyStatus !== null) {
    if (!keyStatus["sarvam"] && !keyStatus["deepgram"] && !keyStatus["openai"]) missingKeys.push("ASR");
    if (!keyStatus["cartesia"] && !keyStatus["openai"]) missingKeys.push("TTS");
    if (!keyStatus["qwen"] && !keyStatus["groq"] && !keyStatus["openai"]) missingKeys.push("LLM");
  }
  const keysReady = !keyLoading && keyStatus !== null && missingKeys.length === 0;

  useEffect(() => {
    if (autostart && keysReady && status === "idle" && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      void startCall();
    }
  }, [autostart, keysReady, status, startCall]);

  const statusConfig: Record<CallStatus, { label: string; dot: string; pulse: boolean }> = {
    idle:       { label: "Ready to test",  dot: "bg-muted-foreground/30", pulse: false },
    connecting: { label: "Connecting…",    dot: "bg-amber-400",           pulse: true  },
    listening:  { label: "Listening…",     dot: "bg-green-400",           pulse: true  },
    thinking:   { label: "Thinking…",      dot: "bg-blue-400",            pulse: true  },
    speaking:   { label: "Speaking…",      dot: "bg-primary",             pulse: true  },
    ended:      { label: "Call ended",     dot: "bg-muted-foreground/30", pulse: false },
  };
  const sc       = statusConfig[status];
  const isActive = status !== "idle" && status !== "ended";

  // The index of the last agent message — used to apply sentence highlighting only there
  const lastAgentMsgIdx = msgs.reduce<number>((acc, m, i) => m.speaker === "agent" ? i : acc, -1);

  // Renders a single message bubble
  function renderMsgBubble(m: Msg, i: number, sizeClass: "sm" | "xs") {
    const isLastAgent = i === lastAgentMsgIdx;
    const highlight   = isLastAgent && status === "speaking" ? speakingSentence : "";
    const base = sizeClass === "xs"
      ? "max-w-[90%] px-3 py-2 rounded-2xl text-xs leading-relaxed"
      : "max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed";
    const label = sizeClass === "xs"
      ? "text-[9px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5"
      : "text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1";
    return (
      <div key={i} className={`flex ${m.speaker === "user" ? "justify-end" : "justify-start"}`}>
        <div className={`${base} ${
          m.speaker === "user"
            ? "bg-muted text-foreground rounded-br-sm"
            : "bg-primary/15 text-foreground border border-primary/20 rounded-bl-sm"
        }`}>
          <p className={label}>{m.speaker === "user" ? "You" : agentName}</p>
          {m.speaker === "agent"
            ? <AgentText text={m.text} highlight={highlight} />
            : m.text}
        </div>
      </div>
    );
  }

  // Renders the streaming "typing" bubble — visible during LLM generation AND TTS playback
  function renderStreamingBubble(sizeClass: "sm" | "xs") {
    if (!streamingText) return null;
    const base = sizeClass === "xs"
      ? "max-w-[90%] px-3 py-2 rounded-2xl text-xs leading-relaxed"
      : "max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed";
    const label = sizeClass === "xs"
      ? "text-[9px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5"
      : "text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1";
    const isSpeaking = status === "speaking";
    return (
      <div className="flex justify-start">
        <div className={`${base} bg-primary/10 border border-primary/10 rounded-bl-sm transition-opacity duration-300 ${streamingStale ? "opacity-35" : "opacity-100"}`}>
          <p className={label}>{agentName}</p>
          <AgentText text={streamingText} highlight={speakingSentence} />
          {!streamingStale && (
            isSpeaking
              ? <span className="inline-block ml-1 w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse align-middle" />
              : <span className="ml-0.5 animate-pulse text-primary/70">▍</span>
          )}
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="flex flex-col h-full flex-1 min-h-0">
        {/* Status */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50 shrink-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${sc.dot} ${sc.pulse ? "animate-pulse" : ""}`} />
          <span className="text-xs font-medium text-foreground/80">{sc.label}</span>
          {status === "ended" && duration !== null && (
            <span className="text-[10px] text-muted-foreground ml-auto">
              {Math.floor(duration / 60)}m {duration % 60}s
            </span>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-3 mt-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 shrink-0">
            {error}
          </div>
        )}

        {/* Missing keys */}
        {!keyLoading && missingKeys.length > 0 && (
          <div className="mx-3 mt-2 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2 shrink-0">
            Missing API keys: {missingKeys.join(", ")}
          </div>
        )}

        {/* Transcript */}
        <div
          ref={transcriptRef}
          className="flex-1 overflow-y-auto p-3 space-y-2 scroll-smooth min-h-0"
        >
          {msgs.length === 0 && !streamingText ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground gap-2 py-6">
              <Volume2 className="h-6 w-6 opacity-20" />
              <p className="text-xs">Speak to test {agentName}</p>
            </div>
          ) : (
            <>
              {msgs.map((m, i) => renderMsgBubble(m, i, "xs"))}
              {renderStreamingBubble("xs")}
            </>
          )}
        </div>

        {/* Controls */}
        <div className="p-3 border-t border-border/50 shrink-0">
          {!isActive ? (
            <Button
              className="w-full h-9 gap-2 text-xs"
              onClick={() => void startCall()}
              disabled={keyLoading || !keysReady}
              title={!keysReady && !keyLoading ? `Missing: ${missingKeys.join(", ")}` : undefined}
            >
              {keyLoading
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking keys…</>
                : <><Mic className="h-3.5 w-3.5" /> Start Test Call</>
              }
            </Button>
          ) : (
            <Button variant="destructive" className="w-full h-9 gap-2 text-xs" onClick={endCall}>
              <PhoneOff className="h-3.5 w-3.5" /> End Call
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border/60 bg-card/50 overflow-hidden">
        <div className="border-b border-border/50 px-5 py-4">
          <div className="flex items-center gap-2 text-base font-semibold">
            <Mic className="h-4 w-4 text-primary" />
            Browser Test Call
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Talk to <strong>{agentName}</strong> directly from your browser — no phone needed.
          </p>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-muted/40 border border-border/50">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${sc.dot} ${sc.pulse ? "animate-pulse" : ""}`} />
            <span className="text-sm font-medium">{sc.label}</span>
            {status === "ended" && duration !== null && (
              <span className="text-xs text-muted-foreground ml-auto">
                Duration: {Math.floor(duration / 60)}m {duration % 60}s
              </span>
            )}
          </div>
          {!keyLoading && missingKeys.length > 0 && (
            <div className="text-sm text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-4 py-3">
              Missing API keys for: <strong>{missingKeys.join(", ")}</strong>. Contact the platform administrator.
            </div>
          )}
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
              {error}
            </div>
          )}
          <div ref={transcriptRef} className="h-64 overflow-y-auto space-y-3 pr-1 scroll-smooth">
            {msgs.length === 0 && !streamingText ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground gap-2">
                <Volume2 className="h-8 w-8 opacity-20" />
                <p className="text-sm">Transcript will appear here during the call.</p>
              </div>
            ) : (
              <>
                {msgs.map((m, i) => renderMsgBubble(m, i, "sm"))}
                {renderStreamingBubble("sm")}
              </>
            )}
          </div>
          <div className="flex gap-3">
            {!isActive ? (
              <Button
                className="flex-1 gap-2"
                onClick={() => void startCall()}
                disabled={keyLoading || !keysReady}
                title={!keysReady && !keyLoading ? `Missing keys: ${missingKeys.join(", ")}` : undefined}
              >
                {keyLoading
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Checking…</>
                  : <><Mic className="h-4 w-4" /> Start Test Call</>
                }
              </Button>
            ) : (
              <Button variant="destructive" className="flex-1 gap-2" onClick={endCall}>
                <PhoneOff className="h-4 w-4" /> End Call
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
