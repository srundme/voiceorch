import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Phone, Loader2, AlertCircle, X, SwitchCamera } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Webcall 2.0 — browser "Live Test" transport for an agent.
 *
 * Mirrors what the phone does, but in the browser: it captures mic audio as
 * PCM16 16 kHz and streams it to /api/ws/webcall/:agentId, and plays back the
 * agent's PCM16 8 kHz audio. ALL conversation logic (barge-in, endpointing,
 * flush, tail-drain) lives in the shared server pipeline — this component is a
 * pure transport + UI shell. Browser echo cancellation (getUserMedia
 * echoCancellation) keeps the agent's own voice out of the mic.
 */

type CallState = "idle" | "connecting" | "live" | "ending" | "error";
type Line = { id: number; speaker: "user" | "agent"; text: string };
type FacingMode = "user" | "environment";

// Inlined AudioWorklet processor: posts a COPY of each Float32 frame to the main
// thread (transferred, zero-copy). Resampling to 16 kHz + Int16 conversion is
// done on the main thread because the AudioContext may ignore the requested
// sampleRate (notably Safari), so the real rate is only known there. Loaded via
// a Blob URL so there is no separate asset path to resolve under the proxy base.
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

// Target wire rate for mic audio. The server downsamples this 2:1 to 8 kHz.
const TARGET_RATE = 16000;

export function WebcallPanel({
  agentId,
  agentName,
  compact,
  onClose,
  shareToken,
  requireCamera,
  autoStart,
}: {
  agentId: number;
  agentName: string;
  compact?: boolean;
  onClose?: () => void;
  /** Guest join link token — connects via ?share= instead of session JWT. */
  shareToken?: string;
  /** Guest must enable camera before connecting. */
  requireCamera?: boolean;
  /** Start the call automatically after mount (join page). */
  autoStart?: boolean;
}) {
  const [state, setState]   = useState<CallState>("idle");
  const [error, setError]   = useState<string | null>(null);
  const [muted, setMuted]   = useState(false);
  const [lines, setLines]   = useState<Line[]>([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [facingMode, setFacingMode] = useState<FacingMode>("user");
  const [switchingCamera, setSwitchingCamera] = useState(false);

  const wsRef          = useRef<WebSocket | null>(null);
  const captureCtxRef  = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoElRef     = useRef<HTMLVideoElement | null>(null);
  const workletRef     = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef  = useRef<MediaStreamAudioSourceNode | null>(null);
  const activeSources  = useRef<AudioBufferSourceNode[]>([]);
  const nextStartRef   = useRef(0);
  const lineIdRef      = useRef(0);
  const mutedRef       = useRef(false);
  const callIdRef      = useRef<number | null>(null);
  // True once the call is intentionally finished or errored, so the ws.onclose
  // handler doesn't clobber the final UI state with an "idle" reset.
  const doneRef        = useRef(false);
  const cameraAutoTriedRef = useRef(false);
  const scrollEndRef   = useRef<HTMLDivElement | null>(null);

  const stopCamera = useCallback(() => {
    videoStreamRef.current?.getTracks().forEach((t) => t.stop());
    videoStreamRef.current = null;
    if (videoElRef.current) {
      videoElRef.current.srcObject = null;
    }
    setCameraOn(false);
  }, []);

  const teardown = useCallback(() => {
    stopCamera();
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
    cameraAutoTriedRef.current = false;
  }, [stopCamera]);

  // Schedule one incoming 8 kHz PCM16 buffer onto the playback timeline.
  const enqueueAudio = useCallback((buf: ArrayBuffer) => {
    const ctx = playbackCtxRef.current;
    if (!ctx) return;
    const pcm = new Int16Array(buf);
    if (pcm.length === 0) return;
    const audioBuf = ctx.createBuffer(1, pcm.length, 8000);
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

  // Barge-in: drop everything still queued so the agent goes silent instantly.
  const clearPlayback = useCallback(() => {
    for (const s of activeSources.current) { try { s.stop(); } catch { /* noop */ } }
    activeSources.current = [];
    nextStartRef.current = playbackCtxRef.current?.currentTime ?? 0;
  }, []);

  // Live camera chrome (preview / stream) — gated on requireCamera share links.
  const cameraAllowed = !!requireCamera;

  const openCameraStream = useCallback(async (facing: FacingMode) => {
    const vstream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    });
    videoStreamRef.current?.getTracks().forEach((t) => t.stop());
    videoStreamRef.current = vstream;
    if (videoElRef.current) {
      videoElRef.current.srcObject = vstream;
      void videoElRef.current.play().catch(() => {});
    }
    setFacingMode(facing);
    setCameraOn(true);
  }, []);

  const startCamera = useCallback(async () => {
    if (!cameraAllowed || cameraOn) return;
    setError(null);
    try {
      await openCameraStream(facingMode);
    } catch {
      // Fallback: try the other lens if the preferred one isn't available (common on desktops).
      const fallback: FacingMode = facingMode === "user" ? "environment" : "user";
      try {
        await openCameraStream(fallback);
      } catch (err2) {
        setError(err2 instanceof Error ? err2.message : "Camera permission denied");
      }
    }
  }, [cameraAllowed, cameraOn, facingMode, openCameraStream]);

  const switchCamera = useCallback(async () => {
    if (!cameraOn || switchingCamera) return;
    const next: FacingMode = facingMode === "user" ? "environment" : "user";
    setSwitchingCamera(true);
    setError(null);
    try {
      await openCameraStream(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not switch camera");
    } finally {
      setSwitchingCamera(false);
    }
  }, [cameraOn, switchingCamera, facingMode, openCameraStream]);

  const start = useCallback(async () => {
    setError(null);
    setLines([]);
    doneRef.current = false;
    mutedRef.current = false;
    setMuted(false);
    setState("connecting");
    try {
      const sessionToken = localStorage.getItem("voiceorch:session");
      if (!shareToken) {
        if (!sessionToken) throw new Error("You need to be signed in to start a test call.");
        // Preflight: check wallet balance before acquiring mic / opening the socket.
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

      // If camera is required, turn it on before connecting (don't leave users stuck).
      if (requireCamera && !cameraOn) {
        try {
          await openCameraStream(facingMode);
        } catch {
          try {
            await openCameraStream(facingMode === "user" ? "environment" : "user");
          } catch (camErr) {
            throw new Error(
              camErr instanceof Error
                ? `Camera required: ${camErr.message}`
                : "This link requires camera permission. Allow camera access and try again.",
            );
          }
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      streamRef.current = stream;

      // ── Capture graph @ 16 kHz ────────────────────────────────────────────
      const capture = new AudioContext({ sampleRate: 16000 });
      captureCtxRef.current = capture;
      await capture.resume();
      const blobUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
      try { await capture.audioWorklet.addModule(blobUrl); } finally { URL.revokeObjectURL(blobUrl); }

      const srcNode = capture.createMediaStreamSource(stream);
      sourceNodeRef.current = srcNode;
      const worklet = new AudioWorkletNode(capture, "pcm-capture");
      workletRef.current = worklet;

      // The browser may ignore the requested 16 kHz and run at the hardware rate
      // (e.g. 48 kHz on Safari). Linear-resample the actual rate → 16 kHz on the
      // main thread, carrying a fractional cursor + leftover tail across frames so
      // there are no clicks at frame boundaries. A no-op fast path when rates match.
      const captureRate = capture.sampleRate;
      const ratio = captureRate / TARGET_RATE; // input samples per output sample
      let resampleCursor = 0;
      let tail = new Float32Array(0);
      worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        // While muted, drop frames AND reset the resampler carry so unmuting
        // resumes cleanly instead of prepending a stale pre-mute tail.
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
          // Cursor advanced past the whole buffer (e.g. the integer 48k→16k
          // ratio lands here every frame): keep nothing, but carry the overshoot
          // so the next frame resumes at the correct sub-sample offset instead of
          // snapping back to 0 and dropping a sample every frame.
          tail = new Float32Array(0);
          resampleCursor = pos - buf.length;
        } else {
          // Keep buf[floorPos] — the next interpolation needs it as its left sample.
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

      // Anti-aliasing: if the browser ignored 16 kHz and runs higher (commonly
      // 44.1/48 kHz), band-limit to ~7 kHz BEFORE the decimation above, or loud
      // sibilant speech folds back into full-scale broadband buzz on the wire
      // (a documented prior webcall regression). 3 cascaded lowpass biquads
      // ≈ 36 dB/oct. Skipped entirely when the context is genuinely 16 kHz.
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
      // Worklet must reach the destination to be pulled — route it through a
      // muted gain so it processes without being audible.
      const sink = capture.createGain();
      sink.gain.value = 0;
      worklet.connect(sink);
      sink.connect(capture.destination);

      // ── Playback graph @ 8 kHz ────────────────────────────────────────────
      const playback = new AudioContext({ sampleRate: 8000 });
      playbackCtxRef.current = playback;
      await playback.resume();
      nextStartRef.current = playback.currentTime;

      // ── WebSocket (absolute /api path → routed by the shared proxy) ────────
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const authQs = shareToken
        ? `share=${encodeURIComponent(shareToken)}`
        : `token=${encodeURIComponent(sessionToken!)}`;
      const ws = new WebSocket(
        `${proto}://${location.host}/api/ws/webcall/${agentId}?${authQs}`,
      );
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onmessage = (ev: MessageEvent) => {
        if (typeof ev.data !== "string") { enqueueAudio(ev.data as ArrayBuffer); return; }
        let msg: { type?: string; speaker?: "user" | "agent"; text?: string; message?: string };
        try { msg = JSON.parse(ev.data); } catch { return; }
        switch (msg.type) {
          case "ready":
            if (typeof (msg as { callId?: number }).callId === "number") {
              callIdRef.current = (msg as { callId: number }).callId;
            }
            setState("live");
            break;
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
  }, [agentId, enqueueAudio, clearPlayback, teardown, shareToken, requireCamera, cameraOn, facingMode, openCameraStream]);

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

  // Auto-start camera once the call is live (so the preview shows without an extra tap).
  useEffect(() => {
    if (state !== "live" || !cameraAllowed || cameraOn || cameraAutoTriedRef.current) return;
    cameraAutoTriedRef.current = true;
    void startCamera();
  }, [state, cameraAllowed, cameraOn, startCamera]);

  // Guest join with requireCamera: prompt for camera while idle so preview appears before Start.
  useEffect(() => {
    if (!requireCamera || !cameraAllowed || cameraOn || (state !== "idle" && state !== "error")) return;
    if (cameraAutoTriedRef.current) return;
    cameraAutoTriedRef.current = true;
    void startCamera();
  }, [requireCamera, cameraAllowed, cameraOn, state, startCamera]);

  // Guest join page: optionally auto-start the call after mount.
  const autoStartTriedRef = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStartTriedRef.current || state !== "idle") return;
    if (requireCamera && !cameraOn) return; // wait for camera
    autoStartTriedRef.current = true;
    void start();
  }, [autoStart, state, requireCamera, cameraOn, start]);

  useEffect(() => () => { doneRef.current = true; teardown(); }, [teardown]);
  useEffect(() => { scrollEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [lines]);

  const active = state === "live" || state === "connecting" || state === "ending";

  return (
    <div className={compact ? "h-full flex flex-col" : "p-5 max-w-3xl"}>
      <div className={`bg-card border border-border rounded-2xl overflow-hidden flex flex-col${compact ? " flex-1" : ""}`} style={compact ? undefined : { height: "calc(100dvh - 9rem)" }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 h-12 shrink-0 border-b border-border">
          <span className={
            "h-2 w-2 rounded-full " +
            (state === "live" ? "bg-emerald-500 animate-pulse"
              : state === "connecting" || state === "ending" ? "bg-amber-500 animate-pulse"
              : state === "error" ? "bg-red-500"
              : "bg-muted-foreground/40")
          } />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-foreground truncate">
              {shareToken ? agentName : `Live Test — ${agentName}`}
            </p>
            <p className="text-[10.5px] text-muted-foreground/60">
              {state === "idle"       && (
                requireCamera && !cameraOn
                  ? "Turn on your camera, then start the call"
                  : "Talk to your agent right in the browser"
              )}
              {state === "connecting" && "Connecting…"}
              {state === "live"       && (
                cameraOn
                  ? "Connected — camera on"
                  : "Connected — start speaking"
              )}
              {state === "ending"     && "Ending call…"}
              {state === "error"      && "Call ended with an error"}
            </p>
          </div>
          {onClose && (
            <button onClick={onClose} className="ml-auto shrink-0 p-1 rounded hover:bg-muted/60 text-muted-foreground/60 hover:text-foreground transition-colors" title="Close">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {cameraAllowed && (
          <div className={cameraOn
            ? "relative shrink-0 border-b border-border bg-black"
            : "absolute w-px h-px overflow-hidden opacity-0 pointer-events-none"}
          >
            <video
              ref={videoElRef}
              muted
              playsInline
              autoPlay
              className="w-full max-h-44 object-cover"
            />
            {cameraOn && (
              <>
                <span className="absolute top-2 left-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-black/60 text-white">
                  Camera · {facingMode === "user" ? "Front" : "Rear"}
                </span>
                <button
                  type="button"
                  onClick={() => void switchCamera()}
                  disabled={switchingCamera}
                  className="absolute top-2 right-2 h-8 w-8 inline-flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 disabled:opacity-50"
                  title={facingMode === "user" ? "Switch to rear camera" : "Switch to front camera"}
                >
                  {switchingCamera ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SwitchCamera className="h-3.5 w-3.5" />}
                </button>
              </>
            )}
          </div>
        )}

        {/* Transcript */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2.5">
          {lines.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center gap-2 text-muted-foreground/50">
              <Phone className="h-7 w-7 opacity-40" />
              <p className="text-[12px]">
                {active
                  ? "Listening… say hello to your agent."
                  : requireCamera && !cameraOn
                    ? "Allow camera access, then press Start call."
                    : "Press Start call to begin a live voice test."}
              </p>
            </div>
          )}
          {lines.map((l) => (
            <div key={l.id} className={"flex " + (l.speaker === "user" ? "justify-end" : "justify-start")}>
              <div className={
                "max-w-[80%] rounded-2xl px-3.5 py-2 text-[12.5px] leading-relaxed " +
                (l.speaker === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-elevated border border-border text-foreground rounded-bl-sm")
              }>
                <span className="block text-[9px] uppercase tracking-wide opacity-50 mb-0.5">
                  {l.speaker === "user" ? "You" : agentName}
                </span>
                {l.text}
              </div>
            </div>
          ))}
          <div ref={scrollEndRef} />
        </div>

        {/* Error banner */}
        {error && (
          <div className="px-4 py-2 border-t border-border flex items-center gap-2 text-[11.5px] text-red-400 bg-red-500/5">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
          </div>
        )}

        {/* Controls */}
        <div className="shrink-0 border-t border-border p-3 flex items-center justify-center gap-2.5">
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
                className={"h-10 w-10 p-0 rounded-full border-border " + (muted ? "bg-amber-500/10 text-amber-400" : "text-muted-foreground")}
                title={muted ? "Unmute" : "Mute"}
              >
                {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
              <Button
                onClick={end}
                disabled={state === "ending"}
                className="h-10 px-5 gap-2 rounded-full text-[13px] bg-red-500 hover:bg-red-600 text-white"
              >
                {state === "ending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneOff className="h-4 w-4" />}
                {state === "connecting" ? "Connecting…" : "End call"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
