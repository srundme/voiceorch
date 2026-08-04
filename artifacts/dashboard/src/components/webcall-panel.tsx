import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Phone, Loader2, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiriWave } from "@/components/ui/siri-wave";
import { cn } from "@/lib/utils";

/**
 * Webcall 2.0 — browser "Live Test" transport for an agent.
 *
 * Captures mic audio as PCM16 16 kHz, streams it to /api/ws/webcall/:agentId,
 * and plays back the agent's PCM16 8 kHz audio. ALL conversation logic lives
 * in the shared server pipeline — this component is a pure transport + UI shell.
 */

type CallState = "idle" | "connecting" | "live" | "ending" | "error";
type Line = { id: number; speaker: "user" | "agent"; text: string };

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
  const scrollEndRef   = useRef<HTMLDivElement | null>(null);
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
    const start = Math.max(ctx.currentTime, nextStartRef.current);
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
      const sessionToken = localStorage.getItem("voiceorch:session");
      if (!shareToken) {
        if (!sessionToken) throw new Error("You need to be signed in to start a test call.");
        const walletResp = await fetch("/api/wallet/me", {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
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
      const blobUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
      try { await capture.audioWorklet.addModule(blobUrl); } finally { URL.revokeObjectURL(blobUrl); }

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
      const authQs = shareToken
        ? `share=${encodeURIComponent(shareToken)}`
        : `token=${encodeURIComponent(sessionToken!)}`;
      const ws = new WebSocket(
        `${proto}://${location.host}/api/ws/webcall/${agentId}?${authQs}&rate=16000`,
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
              const line: Line = { id: lineIdRef.current++, speaker: msg.speaker, text: msg.text };
              setLines((prev) => [...prev, line]);
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
  useEffect(() => { scrollEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [lines]);

  const active = state === "live" || state === "connecting" || state === "ending";
  /** Wave while speaking / live; fluid dots while idle or connecting. */
  const waveVariant = state === "live" ? "wave" : "fluid-dots";
  const waveSize = compact ? 280 : 360;

  return (
    <div className={compact ? "h-full flex flex-col" : "p-5 max-w-3xl"}>
      <div
        className={cn(
          "relative overflow-hidden flex flex-col rounded-2xl border border-border",
          "bg-[#050508]",
          compact ? "flex-1" : "",
        )}
        style={compact ? undefined : { height: "calc(100dvh - 9rem)" }}
      >
        {/* Soft vignette so the WebGL stage reads as one composition */}
        <div
          className="pointer-events-none absolute inset-0 z-0"
          aria-hidden
          style={{
            background:
              "radial-gradient(ellipse 70% 55% at 50% 42%, rgba(30,40,70,0.45) 0%, transparent 70%), linear-gradient(180deg, #07070c 0%, #050508 55%, #030306 100%)",
          }}
        />

        {/* Header — glass strip */}
        <div className="relative z-20 flex items-center gap-3 px-4 h-12 shrink-0 border-b border-white/5 bg-black/30 backdrop-blur-md">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              state === "live"
                ? "bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.7)]"
                : state === "connecting" || state === "ending"
                  ? "bg-amber-400 animate-pulse"
                  : state === "error"
                    ? "bg-red-400"
                    : "bg-white/25",
            )}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-white/95 truncate">
              {shareToken ? agentName : `Live Test — ${agentName}`}
            </p>
            <p className="text-[10.5px] text-white/45">
              {state === "idle" && "Talk to your agent right in the browser"}
              {state === "connecting" && "Connecting…"}
              {state === "live" && "Connected — start speaking"}
              {state === "ending" && "Ending call…"}
              {state === "error" && "Call ended with an error"}
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="ml-auto shrink-0 p-1 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors"
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Stage: Siri effect + transparent transcript overlay */}
        <div className="relative z-10 flex-1 min-h-0">
          {/* Centered WebGL orb */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              className={cn(
                "transition-all duration-700 ease-out",
                active ? "scale-100 opacity-100" : "scale-95 opacity-80",
                state === "live" && "drop-shadow-[0_0_40px_rgba(100,140,255,0.25)]",
              )}
            >
              <SiriWave
                variant={waveVariant}
                size={waveSize}
                renderScale={compact ? 0.65 : 0.75}
                className="rounded-full bg-transparent shadow-[0_20px_80px_rgba(0,0,0,0.55)]"
                aria-hidden
              />
            </div>
          </div>

          {/* Transparent transcript layer over the effect */}
          <div className="absolute inset-0 overflow-y-auto px-4 py-5 space-y-2.5 [mask-image:linear-gradient(to_bottom,transparent_0%,black_8%,black_88%,transparent_100%)]">
            {lines.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center gap-3 text-white/40">
                {!active && (
                  <>
                    <Phone className="h-6 w-6 opacity-50" />
                    <p className="text-[12px] max-w-[16rem] leading-relaxed">
                      Press Start call to begin a live voice test.
                    </p>
                  </>
                )}
                {active && state !== "live" && (
                  <p className="text-[12px] tracking-wide text-white/50 animate-pulse">
                    Connecting…
                  </p>
                )}
                {state === "live" && (
                  <p className="text-[11px] tracking-[0.18em] uppercase text-white/35">
                    Listening
                  </p>
                )}
              </div>
            )}
            {lines.map((l) => (
              <div
                key={l.id}
                className={cn(
                  "flex",
                  l.speaker === "user" ? "justify-end" : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2 text-[12.5px] leading-relaxed backdrop-blur-xl border shadow-[0_8px_32px_rgba(0,0,0,0.35)]",
                    l.speaker === "user"
                      ? "bg-white/15 border-white/20 text-white rounded-br-sm"
                      : "bg-black/35 border-white/10 text-white/90 rounded-bl-sm",
                  )}
                >
                  <span className="block text-[9px] uppercase tracking-wide text-white/40 mb-0.5">
                    {l.speaker === "user" ? "You" : agentName}
                  </span>
                  {l.text}
                </div>
              </div>
            ))}
            <div ref={scrollEndRef} />
          </div>
        </div>

        {notice && !error && (
          <div className="relative z-20 px-4 py-2 border-t border-white/5 flex items-center gap-2 text-[11.5px] text-amber-300 bg-amber-500/10 backdrop-blur-md">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {notice}
          </div>
        )}

        {error && (
          <div className="relative z-20 px-4 py-2 border-t border-white/5 flex items-center gap-2 text-[11.5px] text-red-300 bg-red-500/10 backdrop-blur-md">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
          </div>
        )}

        {/* Controls — floating glass bar */}
        <div className="relative z-20 shrink-0 border-t border-white/5 p-3 flex items-center justify-center gap-2.5 bg-black/40 backdrop-blur-md">
          {state === "idle" || state === "error" ? (
            <Button onClick={() => void start()} className="h-10 px-5 gap-2 rounded-full text-[13px]">
              <Phone className="h-4 w-4" /> Start call
            </Button>
          ) : (
            <>
              <Button
                onClick={toggleMute}
                variant="outline"
                disabled={state !== "live"}
                className={cn(
                  "h-10 w-10 p-0 rounded-full border-white/15 bg-white/5 text-white/80 hover:bg-white/10",
                  muted && "bg-amber-500/15 text-amber-300 border-amber-400/30",
                )}
                title={muted ? "Unmute" : "Mute"}
              >
                {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
              <Button
                onClick={end}
                disabled={state === "ending"}
                className="h-10 px-5 gap-2 rounded-full text-[13px] bg-red-500 hover:bg-red-600 text-white"
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
    </div>
  );
}
