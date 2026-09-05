import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Phone, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiriWave } from "@/components/ui/siri-wave";
import { cn } from "@/lib/utils";
import { stripTranscriptMarkup } from "@/lib/transcript-display";

/**
 * Webcall 2.0 — browser "Live Test" transport for an agent.
 *
 * Captures mic audio as PCM16 16 kHz, streams it to /api/ws/webcall/:agentId,
 * and plays back the agent's PCM16 8 kHz audio. ALL conversation logic lives
 * in the shared server pipeline — this component is a pure transport + UI shell.
 */

type CallState = "idle" | "connecting" | "live" | "ending" | "error";
type Line = { id: number; speaker: "user" | "agent"; text: string };

const INDIC_SCRIPT_RE =
  /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F]/;

const COT_CAPTION_RE =
  /^(The user |Let me |According to |Wait[, ]|Actually[, ]|Looking |Since (they|the caller) |So I should |I (need to|already|should) |Based on |IDENTITY|FACTS|Stage \d)/i;

/** Drop English chain-of-thought / prompt leaks from live captions. */
function isSpeakableCaption(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 2) return false;
  if (COT_CAPTION_RE.test(t)) return false;
  if (/\b(Let me analyze|According to the flow|constraints:)\b/i.test(t) && !INDIC_SCRIPT_RE.test(t)) {
    return false;
  }
  // Long English-only dumps that look like planning, not speech.
  if (t.length > 160 && !INDIC_SCRIPT_RE.test(t) && /\b(I should|flow|Stage)\b/i.test(t)) {
    return false;
  }
  return true;
}

// Inlined AudioWorklet processor.
const CAPTURE_WORKLET = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length) {
      const out = new Float32Array(input[0]);
      this.port.postMessage(out.buffer, [out.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor);
`;

const TARGET_RATE = 16000;

export function WebcallPanel({
  agentId,
  agentName,
  compact,
  onClose,
  shareToken,
  autoStart,
}: {
  agentId: number;
  agentName: string;
  compact?: boolean;
  onClose?: () => void;
  /** Guest join link token — connects via ?share= instead of session JWT. */
  shareToken?: string;
  /** Start the call automatically after mount (join page). */
  autoStart?: boolean;
}) {
  const [state, setState] = useState<CallState>("idle");
  const [error, setError] = useState<string | null>(null);
  /** Non-fatal server notice (e.g. TTS failing while the call stays up). */
  const [notice, setNotice] = useState<string | null>(null);
  const [muted, setMuted]   = useState(false);
  const [lines, setLines]   = useState<Line[]>([]);

  const wsRef          = useRef<WebSocket | null>(null);
  const captureCtxRef  = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const workletRef     = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef  = useRef<MediaStreamAudioSourceNode | null>(null);
  const activeSources  = useRef<AudioBufferSourceNode[]>([]);
  const nextStartRef   = useRef(0);
  // Server-declared PCM rate from the "ready" message. We request 16k HD, but
  // fall back gracefully if the server answers with 8k (older deploy).
  const audioRateRef   = useRef(16000);
  const lineIdRef      = useRef(0);
  const mutedRef       = useRef(false);
  const callIdRef      = useRef<number | null>(null);
  const doneRef        = useRef(false);
  const ignoreAudioUntilRef = useRef(0);

  const teardown = useCallback(() => {
    try { wsRef.current?.close(); } catch { /* noop */ }
    wsRef.current = null;
    for (const s of activeSources.current) { try { s.stop(); } catch { /* noop */ } }
    activeSources.current = [];
    try { workletRef.current?.disconnect(); } catch { /* noop */ }
    workletRef.current = null;
    try { sourceNodeRef.current?.disconnect(); } catch { /* noop */ }
    sourceNodeRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try { void captureCtxRef.current?.close(); } catch { /* noop */ }
    captureCtxRef.current = null;
    try { void playbackCtxRef.current?.close(); } catch { /* noop */ }
    playbackCtxRef.current = null;
    nextStartRef.current = 0;
    callIdRef.current = null;
    ignoreAudioUntilRef.current = 0;
  }, []);

  const enqueueAudio = useCallback((buf: ArrayBuffer) => {
    if (Date.now() < ignoreAudioUntilRef.current) return;
    const ctx = playbackCtxRef.current;
    if (!ctx) return;
    const pcm = new Int16Array(buf);
    if (pcm.length === 0) return;
    const audioBuf = ctx.createBuffer(1, pcm.length, audioRateRef.current); // rate negotiated via "ready" (16k HD, 8k fallback)
    const ch = audioBuf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(ctx.destination);
    // Keepalive / TTS bursts used to schedule seconds ahead of currentTime, so
    // the next real sentence waited behind a growing silence queue.
    const lead = nextStartRef.current - ctx.currentTime;
    const start = lead > 0.12 ? ctx.currentTime : Math.max(ctx.currentTime, nextStartRef.current);
    src.start(start);
    nextStartRef.current = start + audioBuf.duration;
    activeSources.current.push(src);
    src.onended = () => {
      activeSources.current = activeSources.current.filter((s) => s !== src);
    };
  }, []);

  const clearPlayback = useCallback(() => {
    ignoreAudioUntilRef.current = Date.now() + 1000;
    for (const s of activeSources.current) { try { s.stop(); } catch { /* noop */ } }
    activeSources.current = [];
    nextStartRef.current = playbackCtxRef.current?.currentTime ?? 0;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setNotice(null);
    setLines([]);
    doneRef.current = false;
    mutedRef.current = false;
    setMuted(false);
    setState("connecting");
    try {
      if (!shareToken) {
        const walletResp = await fetch("/api/wallet", { credentials: "include" });
        if (!walletResp.ok && walletResp.status === 401) throw new Error("You need to be signed in to start a test call.");
        if (walletResp.ok) {
          const walletData = await walletResp.json() as { balanceCents?: number };
          if (typeof walletData.balanceCents === "number" && walletData.balanceCents <= 0) {
            throw new Error("Insufficient balance. Please top up your wallet to start calls.");
          }
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      streamRef.current = stream;

      const capture = new AudioContext({ sampleRate: 16000 });
      captureCtxRef.current = capture;
      await capture.resume();
      try {
        await capture.audioWorklet.addModule("/worklets/pcm-capture.js");
      } catch {
        const blobUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
        try {
          await capture.audioWorklet.addModule(blobUrl);
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      }

      const srcNode = capture.createMediaStreamSource(stream);
      sourceNodeRef.current = srcNode;
      const worklet = new AudioWorkletNode(capture, "pcm-capture");
      workletRef.current = worklet;

      const captureRate = capture.sampleRate;
      const ratio = captureRate / TARGET_RATE;
      let resampleCursor = 0;
      let tail = new Float32Array(0);
      worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (mutedRef.current) { tail = new Float32Array(0); resampleCursor = 0; return; }
        const input = new Float32Array(e.data);
        const buf = new Float32Array(tail.length + input.length);
        buf.set(tail, 0);
        buf.set(input, tail.length);
        let pos = resampleCursor;
        const out: number[] = [];
        while (Math.floor(pos) + 1 < buf.length) {
          const i = Math.floor(pos);
          const frac = pos - i;
          out.push(buf[i] * (1 - frac) + buf[i + 1] * frac);
          pos += ratio;
        }
        const floorPos = Math.floor(pos);
        if (floorPos >= buf.length) {
          tail = new Float32Array(0);
          resampleCursor = pos - buf.length;
        } else {
          tail = buf.slice(floorPos);
          resampleCursor = pos - floorPos;
        }
        if (out.length === 0) return;
        const pcm = new Int16Array(out.length);
        for (let k = 0; k < out.length; k++) {
          const s = Math.max(-1, Math.min(1, out[k]));
          pcm[k] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        ws.send(pcm.buffer);
      };

      // Anti-aliasing biquad filters when not at 16 kHz natively.
      let head: AudioNode = srcNode;
      if (captureRate !== TARGET_RATE) {
        for (let i = 0; i < 3; i++) {
          const lp = capture.createBiquadFilter();
          lp.type = "lowpass";
          lp.frequency.value = 7000;
          head.connect(lp);
          head = lp;
        }
      }
      head.connect(worklet);
      const sink = capture.createGain();
      sink.gain.value = 0;
      worklet.connect(sink);
      sink.connect(capture.destination);

      const playback = new AudioContext({ sampleRate: 16000 });
      playbackCtxRef.current = playback;
      await playback.resume();
      nextStartRef.current = playback.currentTime;

      const proto = location.protocol === "https:" ? "wss" : "ws";
      const authQs = shareToken ? `share=${encodeURIComponent(shareToken)}&` : "";
      const ws = new WebSocket(
        `${proto}://${location.host}/api/ws/webcall/${agentId}?${authQs}rate=16000`,
      );
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onmessage = (ev: MessageEvent) => {
        if (typeof ev.data !== "string") { enqueueAudio(ev.data as ArrayBuffer); return; }
        let msg: { type?: string; speaker?: "user" | "agent"; text?: string; message?: string };
        try { msg = JSON.parse(ev.data); } catch { return; }
        switch (msg.type) {
          case "ready": {
            if (typeof (msg as { callId?: number }).callId === "number") {
              callIdRef.current = (msg as { callId: number }).callId;
            }
            const rate = (msg as { audioSampleRate?: number }).audioSampleRate;
            audioRateRef.current = rate === 16000 || rate === 8000 ? rate : 8000;
            setState("live");
            break;
          }
          case "transcript":
            if (msg.speaker && msg.text) {
              const cleaned = stripTranscriptMarkup(msg.text);
              if (cleaned && isSpeakableCaption(cleaned)) {
                const line: Line = { id: lineIdRef.current++, speaker: msg.speaker, text: cleaned };
                setLines((prev) => [...prev.slice(-2), line]);
              }
            }
            break;
          case "clear":
            clearPlayback();
            break;
          case "call_end": {
            doneRef.current = true;
            setState("ending");
            const ctx = playbackCtxRef.current;
            const drainMs = ctx ? Math.max(0, (nextStartRef.current - ctx.currentTime) * 1000) + 300 : 300;
            window.setTimeout(() => { teardown(); setState("idle"); }, drainMs);
            break;
          }
          case "notice":
            // Non-fatal: the call is still live — show why audio may be missing.
            setNotice(msg.message ?? null);
            break;
          case "error":
            doneRef.current = true;
            setError(msg.message ?? "The call failed.");
            setState("error");
            teardown();
            break;
        }
      };
      ws.onerror = () => {
        if (doneRef.current) return;
        doneRef.current = true;
        setError("Connection error.");
        setState("error");
        teardown();
      };
      ws.onclose = () => {
        if (doneRef.current) return;
        teardown();
        setState("idle");
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start the call.";
      doneRef.current = true;
      setError(message);
      setState("error");
      teardown();
    }
  }, [agentId, enqueueAudio, clearPlayback, teardown, shareToken]);

  const end = useCallback(() => {
    doneRef.current = true;
    setState("ending");
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: "end" })); } catch { /* noop */ }
    }
    window.setTimeout(() => { teardown(); setState("idle"); }, 400);
  }, [teardown]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      mutedRef.current = next;
      streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
      return next;
    });
  }, []);

  // Auto-start for guest join page.
  const autoStartTriedRef = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStartTriedRef.current || state !== "idle") return;
    autoStartTriedRef.current = true;
    void start();
  }, [autoStart, state, start]);

  useEffect(() => () => { doneRef.current = true; teardown(); }, [teardown]);

  // Esc dismisses the floating shell (parent owns chrome — no X / agent title here).
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (state === "live" || state === "connecting" || state === "ending") {
        end();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, state, end]);

  const active = state === "live" || state === "connecting" || state === "ending";
  /** Wave while speaking / live; fluid dots while idle or connecting. */
  const waveVariant = state === "live" ? "wave" : "fluid-dots";
  const waveSize = compact ? 280 : 340;
  /** Single live caption — latest speakable line only (no chat stack). */
  const caption = [...lines].reverse().find((l) => isSpeakableCaption(l.text)) ?? null;

  const statusHint =
    state === "connecting" ? "Connecting…"
      : state === "ending" ? "Ending…"
        : state === "live" && !caption ? "Listening"
          : state === "idle" ? "Press Start to talk"
            : null;

  return (
    <div
      className={cn(
        "relative flex min-h-0 flex-col items-center justify-center bg-transparent",
        compact ? "h-auto w-auto" : "mx-auto h-full max-w-sm",
      )}
      style={!compact ? { height: "calc(100dvh - 6rem)" } : undefined}
      role="region"
      aria-label={agentName ? `Live test — ${agentName}` : "Live test"}
    >
      <div className="relative z-10 flex flex-col items-center justify-center gap-6 px-2">
        <div
          className={cn(
            "pointer-events-none transition-all duration-700 ease-out",
            active ? "scale-100 opacity-100" : "scale-95 opacity-80",
          )}
        >
          <SiriWave
            variant={waveVariant}
            size={waveSize}
            renderScale={compact ? 0.75 : 0.85}
            aria-hidden
          />
        </div>

        <div className="pointer-events-none flex min-h-[2.75rem] w-full max-w-[17rem] items-center justify-center px-1">
          {caption ? (
            <p
              key={caption.id}
              className="webcall-caption-in w-full text-center text-[14px] font-medium leading-snug tracking-tight text-foreground/90 text-pretty"
            >
              {caption.text}
            </p>
          ) : statusHint ? (
            <p
              className={cn(
                "text-center",
                state === "live"
                  ? "text-[10px] uppercase tracking-[0.2em] text-foreground/25"
                  : "text-[12px] text-muted-foreground/45",
              )}
            >
              {statusHint}
            </p>
          ) : null}
        </div>
      </div>

      {(notice || error) && (
        <div
          className={cn(
            "relative z-20 mt-3 flex max-w-[17rem] items-center gap-2 px-1 text-[11.5px]",
            error ? "text-red-400" : "text-amber-400",
          )}
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="text-pretty">{error ?? notice}</span>
        </div>
      )}

      <div className="relative z-20 mt-5 flex items-center justify-center gap-3">
        {state === "idle" || state === "error" ? (
          <Button
            onClick={() => void start()}
            className="h-11 gap-2 rounded-full px-6 text-[13px] shadow-lg"
          >
            <Phone className="h-4 w-4" /> Start call
          </Button>
        ) : (
          <>
            <Button
              onClick={toggleMute}
              variant="outline"
              disabled={state !== "live"}
              className={cn(
                "h-11 w-11 rounded-full border-border/40 bg-background/40 p-0 text-foreground/80 shadow-md backdrop-blur-md hover:bg-background/70",
                muted && "border-amber-400/40 bg-amber-500/15 text-amber-500",
              )}
              title={muted ? "Unmute" : "Mute"}
            >
              {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
            <Button
              onClick={end}
              disabled={state === "ending"}
              className="h-11 gap-2 rounded-full bg-red-500 px-5 text-[13px] text-white shadow-lg hover:bg-red-600"
            >
              {state === "ending" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PhoneOff className="h-4 w-4" />
              )}
              {state === "connecting" ? "Connecting…" : "End call"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
