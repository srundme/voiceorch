import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@clerk/react";
import { useLocation } from "wouter";
import { CreateAgentDialog } from "@/components/create-agent-dialog";
import {
  Search, Plus, Phone, Mic, MicOff, PhoneOff, Volume2,
  Settings2, MoreHorizontal, Pencil, Trash2, PlayCircle,
  Check, Copy, Loader2, ChevronDown, Sparkles, PhoneOutgoing,
  BarChart2, Clock, CheckCircle2, XCircle, BookOpen,
  AlertTriangle, Target, AlignLeft, Zap, RefreshCw, ClipboardList, X,
  PhoneForwarded, Globe, CalendarPlus, CalendarClock, CalendarX, CalendarCheck, Wrench,
  ChevronRight, ChevronUp, GitBranch, MessageSquare, LayoutGrid, Workflow,
} from "lucide-react";
import {
  useListAgents,
  useGetAgent,
  useUpdateAgent,
  useDeleteAgent,
  useToggleAgent,
  useListCalls,
  useCreateAgent,
  useListKnowledgeBases,
  useInitiateOutboundCall,
  useListEventTypes,
  useListCalendars,
  getListAgentsQueryKey,
  getGetAgentQueryKey,
  getListCallsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { formatApiError, isKycError, isDestinationUnverifiedError } from "@/lib/format-api-error";
import { DestinationOtpDialog } from "@/components/destination-otp-dialog";
import { format } from "date-fns";
import { computePipelineCost } from "@/lib/provider-pricing";

/* ── Provider catalogues ─────────────────────────────────────────────────── */

const ASR_PROVIDERS = [
  { value: "deepgram",   label: "Deepgram" },
  { value: "azure",      label: "Azure Speech" },
  { value: "assemblyai", label: "AssemblyAI" },
  { value: "whisper",    label: "Whisper" },
  { value: "sarvam",     label: "Sarvam" },
  { value: "cartesia",   label: "Cartesia" },
];
const LLM_PROVIDERS = [
  { value: "openai",     label: "OpenAI" },
  { value: "anthropic",  label: "Anthropic" },
  { value: "google",     label: "Google Gemini" },
  { value: "groq",       label: "Groq" },
  { value: "deepseek",   label: "DeepSeek" },
  { value: "mistral",    label: "Mistral" },
  { value: "cohere",     label: "Cohere" },
  { value: "sarvam",     label: "Sarvam" },
];
const TTS_PROVIDERS = [
  { value: "elevenlabs", label: "ElevenLabs" },
  { value: "openai",     label: "OpenAI TTS" },
  { value: "azure",      label: "Azure TTS" },
  { value: "cartesia",   label: "Cartesia" },
  { value: "deepgram",   label: "Deepgram" },
  { value: "aws_polly",  label: "AWS Polly" },
  { value: "sarvam",     label: "Sarvam" },
];
const TELEPHONY_PROVIDERS = [
  { value: "twilio",  label: "Twilio" },
  { value: "plivo",   label: "Plivo" },
  { value: "vonage",  label: "Vonage" },
  { value: "vobiz",   label: "Vobiz" },
];

const TELEPHONY_AUDIO_DEFAULTS: Record<string, {
  encoding: string; samplingRate: number; format: string; stream: boolean; label: string; note: string;
}> = {
  twilio:  { encoding: "mulaw", samplingRate: 8000,  format: "wav",  stream: true,  label: "μ-law · 8 kHz · WAV", note: "PSTN standard for Twilio (North America & global)" },
  plivo:   { encoding: "mulaw", samplingRate: 8000,  format: "wav",  stream: true,  label: "μ-law · 8 kHz · WAV", note: "PSTN standard for Plivo" },
  vonage:  { encoding: "mulaw", samplingRate: 8000,  format: "wav",  stream: true,  label: "μ-law · 8 kHz · WAV", note: "PCMU (μ-law) used by Vonage WebSockets" },
  vobiz:   { encoding: "alaw",  samplingRate: 8000,  format: "wav",  stream: true,  label: "A-law · 8 kHz · WAV", note: "A-law standard for Vobiz (India/Asia telephony)" },
};
const LLM_MODELS: Record<string, { value: string; label: string }[]> = {
  openai:    [{ value: "gpt-4o-mini", label: "GPT-4o Mini" }, { value: "gpt-4o", label: "GPT-4o" }, { value: "gpt-4-turbo", label: "GPT-4 Turbo" }, { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" }],
  anthropic: [{ value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" }, { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" }, { value: "claude-3-opus-20240229", label: "Claude 3 Opus" }],
  google:    [{ value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (recommended)" }, { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" }, { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" }, { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" }],
  groq:      [{ value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" }, { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B (fast)" }, { value: "gemma2-9b-it", label: "Gemma 2 9B" }],
  deepseek:  [{ value: "deepseek-chat", label: "DeepSeek Chat" }, { value: "deepseek-reasoner", label: "DeepSeek Reasoner" }],
  mistral:   [{ value: "mistral-large-latest", label: "Mistral Large" }, { value: "mistral-small-latest", label: "Mistral Small" }],
  cohere:    [{ value: "command-r-plus", label: "Command R+" }, { value: "command-r", label: "Command R" }],
  sarvam: [
    { value: "sarvam-m",    label: "Sarvam M (recommended)" },
    { value: "sarvam-30b",  label: "Sarvam 30B" },
    { value: "sarvam-105b", label: "Sarvam 105B" },
  ],
};
const ASR_MODELS: Record<string, { value: string; label: string }[]> = {
  deepgram:   [
    { value: "nova-3",          label: "Nova 3 (latest)" },
    { value: "nova-3-medical",  label: "Nova 3 Medical" },
    { value: "nova-2",          label: "Nova 2" },
    { value: "nova-2-general",  label: "Nova 2 General" },
    { value: "nova-2-medical",  label: "Nova 2 Medical" },
    { value: "enhanced",        label: "Enhanced" },
    { value: "base",            label: "Base" },
    { value: "whisper-large",   label: "Whisper Large" },
    { value: "flux",            label: "Flux General English" },
  ],
  azure:      [{ value: "en-US-standard", label: "en-US-standard" }, { value: "en-US-enhanced", label: "en-US-enhanced" }, { value: "en-IN-standard", label: "en-IN-standard" }],
  assemblyai: [{ value: "best", label: "Best" }, { value: "nano", label: "Nano (fast)" }],
  sarvam:     [{ value: "saaras:v3", label: "Saaras v3 — real-time streaming (recommended)" }, { value: "saarika:v2.5", label: "Saarika v2.5 — batch (accurate)" }, { value: "saarika:flash", label: "Saarika Flash — batch (fast, deprecated)" }],
  cartesia:   [{ value: "sonic-english", label: "Sonic English" }],
};
const ASR_LANGUAGES: Record<string, { value: string; label: string }[]> = {
  deepgram: [
    { value: "en",    label: "English" },
    { value: "es",    label: "Spanish" },
    { value: "fr",    label: "French" },
    { value: "de",    label: "German" },
    { value: "hi",    label: "Hindi" },
    { value: "pt",    label: "Portuguese" },
    { value: "ja",    label: "Japanese" },
    { value: "ko",    label: "Korean" },
    { value: "nl",    label: "Dutch" },
    { value: "ru",    label: "Russian" },
    { value: "tr",    label: "Turkish" },
    { value: "zh",    label: "Chinese" },
    { value: "it",    label: "Italian" },
    { value: "sv",    label: "Swedish" },
    { value: "pl",    label: "Polish" },
    { value: "id",    label: "Indonesian" },
  ],
  assemblyai: [
    { value: "en",    label: "English" },
    { value: "es",    label: "Spanish" },
    { value: "fr",    label: "French" },
    { value: "de",    label: "German" },
    { value: "it",    label: "Italian" },
    { value: "pt",    label: "Portuguese" },
    { value: "nl",    label: "Dutch" },
    { value: "fi",    label: "Finnish" },
    { value: "uk",    label: "Ukrainian" },
  ],
  whisper: [
    { value: "auto",  label: "Auto-detect" },
    { value: "en",    label: "English" },
    { value: "es",    label: "Spanish" },
    { value: "fr",    label: "French" },
    { value: "de",    label: "German" },
    { value: "hi",    label: "Hindi" },
    { value: "zh",    label: "Chinese" },
    { value: "ja",    label: "Japanese" },
    { value: "ko",    label: "Korean" },
    { value: "ar",    label: "Arabic" },
    { value: "ru",    label: "Russian" },
    { value: "pt",    label: "Portuguese" },
    { value: "it",    label: "Italian" },
  ],
  azure: [
    { value: "en-US", label: "English (US)" },
    { value: "en-GB", label: "English (UK)" },
    { value: "en-IN", label: "English (India)" },
    { value: "es-ES", label: "Spanish (Spain)" },
    { value: "es-MX", label: "Spanish (Mexico)" },
    { value: "fr-FR", label: "French" },
    { value: "de-DE", label: "German" },
    { value: "hi-IN", label: "Hindi" },
    { value: "ja-JP", label: "Japanese" },
    { value: "ko-KR", label: "Korean" },
    { value: "zh-CN", label: "Chinese (Mandarin)" },
    { value: "pt-BR", label: "Portuguese (Brazil)" },
    { value: "it-IT", label: "Italian" },
  ],
  sarvam: [
    { value: "hi-IN", label: "Hindi" },
    { value: "bn-IN", label: "Bengali" },
    { value: "kn-IN", label: "Kannada" },
    { value: "ml-IN", label: "Malayalam" },
    { value: "mr-IN", label: "Marathi" },
    { value: "ta-IN", label: "Tamil" },
    { value: "te-IN", label: "Telugu" },
    { value: "gu-IN", label: "Gujarati" },
    { value: "pa-IN", label: "Punjabi" },
    { value: "en-IN", label: "English (India)" },
  ],
  cartesia: [
    { value: "en",    label: "English" },
    { value: "es",    label: "Spanish" },
    { value: "fr",    label: "French" },
    { value: "de",    label: "German" },
    { value: "ja",    label: "Japanese" },
    { value: "zh",    label: "Chinese" },
    { value: "pt",    label: "Portuguese" },
    { value: "hi",    label: "Hindi" },
    { value: "it",    label: "Italian" },
    { value: "ko",    label: "Korean" },
    { value: "nl",    label: "Dutch" },
    { value: "pl",    label: "Polish" },
    { value: "ru",    label: "Russian" },
    { value: "sv",    label: "Swedish" },
    { value: "tr",    label: "Turkish" },
  ],
};
const TTS_MODELS: Record<string, { value: string; label: string }[]> = {
  cartesia: [
    { value: "sonic-3",     label: "Sonic 3 (latest)" },
    { value: "sonic-2",     label: "Sonic 2 (stable)" },
    { value: "sonic-turbo", label: "Sonic Turbo (fast)" },
  ],
  openai: [
    { value: "tts-1",    label: "TTS-1 (fast)" },
    { value: "tts-1-hd", label: "TTS-1 HD (quality)" },
  ],
  deepgram: [
    { value: "aura-2",          label: "Aura 2 (latest)" },
    { value: "aura-asteria-en", label: "Aura Asteria" },
    { value: "aura-luna-en",    label: "Aura Luna" },
    { value: "aura-stella-en",  label: "Aura Stella" },
    { value: "aura-athena-en",  label: "Aura Athena" },
    { value: "aura-hera-en",    label: "Aura Hera" },
    { value: "aura-orion-en",   label: "Aura Orion (male)" },
    { value: "aura-arcas-en",   label: "Aura Arcas (male)" },
    { value: "aura-perseus-en", label: "Aura Perseus (male)" },
    { value: "aura-angus-en",   label: "Aura Angus (male)" },
  ],
  sarvam: [
    { value: "meera",    label: "Meera (female)" },
    { value: "pavithra", label: "Pavithra (female)" },
    { value: "maitreyi", label: "Maitreyi (female)" },
    { value: "arvind",   label: "Arvind (male)" },
    { value: "amol",     label: "Amol (male)" },
    { value: "amartya",  label: "Amartya (male)" },
  ],
  azure: [
    { value: "en-US-JennyNeural",    label: "Jenny (female, US)" },
    { value: "en-US-GuyNeural",      label: "Guy (male, US)" },
    { value: "en-US-AriaNeural",     label: "Aria (female, US)" },
    { value: "en-GB-SoniaNeural",    label: "Sonia (female, UK)" },
    { value: "en-IN-NeerjaNeural",   label: "Neerja (female, IN)" },
  ],
  aws_polly: [
    { value: "Joanna", label: "Joanna (female, US)" },
    { value: "Matthew", label: "Matthew (male, US)" },
    { value: "Ivy",    label: "Ivy (female, US, child)" },
    { value: "Amy",    label: "Amy (female, UK)" },
    { value: "Brian",  label: "Brian (male, UK)" },
    { value: "Emma",   label: "Emma (female, UK)" },
    { value: "Kajal",  label: "Kajal (female, IN)" },
  ],
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function providerTag(p: string) {
  return p.toLowerCase();
}

function statusDot(status: string) {
  if (status === "active")   return <span className="h-1.5 w-1.5 rounded-full bg-foreground/25 shrink-0" />;
  if (status === "inactive") return <span className="h-1.5 w-1.5 rounded-full bg-foreground/08 shrink-0" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-foreground/15 shrink-0" />;
}

/* ── Web Call Panel ──────────────────────────────────────────────────────── */

type CallStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "ended";
interface Msg { speaker: "user" | "agent"; text: string }

/* ── Oscilloscope wave canvas (Cartesia-style) ───────────────────────────── */
function WaveCanvas({
  active, color, glowColor, amplitude = 0.42, speed = 0.055,
}: {
  active: boolean; color: string; glowColor: string;
  amplitude?: number; speed?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number | null>(null);
  const phaseRef  = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr  = window.devicePixelRatio || 1;
    const W    = canvas.offsetWidth;
    const H    = canvas.offsetHeight;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);

      const amp = active ? H * amplitude : H * 0.03;
      const cy  = H / 2;

      ctx.beginPath();
      for (let px = 0; px <= W; px++) {
        const t = px / W;
        const y = cy + amp * (
          Math.sin(t * Math.PI * 5  + phaseRef.current)        * 0.55 +
          Math.sin(t * Math.PI * 9  + phaseRef.current * 1.35) * 0.28 +
          Math.sin(t * Math.PI * 15 + phaseRef.current * 0.72) * 0.17
        );
        if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
      }

      ctx.strokeStyle  = color;
      ctx.lineWidth    = 1.5;
      ctx.shadowColor  = active ? glowColor : "transparent";
      ctx.shadowBlur   = active ? 10 : 0;
      ctx.lineCap      = "round";
      ctx.lineJoin     = "round";
      ctx.stroke();

      if (active) {
        phaseRef.current += speed;
        rafRef.current = requestAnimationFrame(draw);
      }
    }

    draw();
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); };
  }, [active, color, glowColor, amplitude, speed]);

  return (
    <div className="relative flex-1 h-full">
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      {/* Edge fade */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-6"
        style={{ background: "linear-gradient(to right, #0a0a0a, transparent)" }} />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-6"
        style={{ background: "linear-gradient(to left, #0a0a0a, transparent)" }} />
    </div>
  );
}

function WebCallPanel({ agentId, agentName }: { agentId: number; agentName: string }) {
  const [status, setStatus]     = useState<CallStatus>("idle");
  const [msgs, setMsgs]         = useState<Msg[]>([]);
  const [error, setError]       = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [copied, setCopied]     = useState(false);
  const [elapsed, setElapsed]   = useState(0);
  const { userId: callerUserId } = useAuth();

  const wsRef          = useRef<WebSocket | null>(null);
  const audioCtxRef    = useRef<AudioContext | null>(null);
  const processorRef   = useRef<ScriptProcessorNode | null>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const nextPlayRef    = useRef(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptRef  = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [msgs]);

  function float32ToInt16(f32: Float32Array): Int16Array {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) out[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));
    return out;
  }

  function stopAllAudio() {
    for (const src of activeSourcesRef.current) { try { src.stop(); } catch { /* ended */ } }
    activeSourcesRef.current = [];
    const ctx = audioCtxRef.current;
    if (ctx) nextPlayRef.current = ctx.currentTime;
  }

  function playPCM16(buf: ArrayBuffer) {
    const ctx = audioCtxRef.current; if (!ctx) return;
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
    processorRef.current?.disconnect(); processorRef.current = null;
    audioCtxRef.current?.close().catch(() => {}); audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null;
    if (wsRef.current && wsRef.current.readyState < 2) wsRef.current.close(); wsRef.current = null;
  }

  const startCall = useCallback(async () => {
    setError(null); setMsgs([]); setDuration(null); setStatus("connecting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, sampleRate: 16000 } });
      streamRef.current = stream;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const callerParam = callerUserId ? `?callerId=${encodeURIComponent(callerUserId)}` : "";
      const ws = new WebSocket(`${proto}://${location.host}/api/ws/webcall/${agentId}${callerParam}`);
      ws.binaryType = "arraybuffer"; wsRef.current = ws;
      ws.onopen = () => {
        const AudioCtx = (window as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext || (window as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx({ sampleRate: 16000 });
        audioCtxRef.current = ctx; nextPlayRef.current = 0;
        const src = ctx.createMediaStreamSource(stream);
        const proc = ctx.createScriptProcessor(2048, 1, 1);
        processorRef.current = proc; src.connect(proc); proc.connect(ctx.destination);
        proc.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(float32ToInt16(e.inputBuffer.getChannelData(0)).buffer);
        };
      };
      ws.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) { playPCM16(e.data); return; }
        try {
          const msg = JSON.parse(e.data as string) as { type: string; status?: CallStatus; speaker?: "user" | "agent"; text?: string; durationSeconds?: number; message?: string };
          if (msg.type === "ready")       setStatus("listening");
          else if (msg.type === "interrupted") { stopAllAudio(); setStatus("listening"); }
          else if (msg.type === "status" && msg.status) setStatus(msg.status);
          else if (msg.type === "transcript" && msg.speaker && msg.text) setMsgs(prev => [...prev, { speaker: msg.speaker!, text: msg.text! }]);
          else if (msg.type === "ended") { setDuration(msg.durationSeconds ?? null); setStatus("ended"); cleanup(); }
          else if (msg.type === "error")  { setError(msg.message ?? "Error"); setStatus("idle"); cleanup(); }
        } catch { /* ignore */ }
      };
      ws.onclose = () => { cleanup(); };
      ws.onerror = () => { setError("WebSocket connection failed. Check your API keys."); setStatus("idle"); cleanup(); };
    } catch { setError("Microphone access denied or unavailable."); setStatus("idle"); }
  }, [agentId]);

  const endCall = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "end" }));
    setStatus("idle"); cleanup();
  }, []);

  useEffect(() => () => { cleanup(); }, []);

  const isActive = status !== "idle" && status !== "ended";

  /* Elapsed call timer */
  useEffect(() => {
    if (isActive) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isActive]);

  const embedCode = [
    `<script src="${location.protocol}//${location.host}/api/widget.js"`,
    `        data-agent-id="${agentId}"`,
    `        data-name="${agentName}"`,
    `        data-color="#a1a1aa">`,
    `</script>`,
  ].join("\n");

  const fmtTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(1,"0")}:${(s % 60).toString().padStart(2,"0")}`;

  const agentLabel =
    status === "speaking"   ? "speaking"   :
    status === "thinking"   ? "thinking"   :
    status === "connecting" ? "connecting" : "listening";

  return (
    <div className="space-y-4">

      {/* ── Live call card ───────────────────────────────────────────── */}
      {isActive ? (
        <div className="rounded-2xl overflow-hidden" style={{ background: "#0a0a0a", border: "1px solid #1c1c1c" }}>

          {/* Header */}
          <div className="flex items-center gap-3 px-4 pt-4 pb-3">
            <div className="h-10 w-10 rounded-full bg-white flex items-center justify-center shrink-0 shadow-sm">
              <Mic className="h-5 w-5 text-black" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{agentName}</p>
              <p className="text-[11px]" style={{ color: "#555" }}>Live call</p>
            </div>
            <button
              onClick={endCall}
              className="h-10 w-10 rounded-full flex items-center justify-center transition-opacity hover:opacity-80 shrink-0"
              style={{ background: "#ef4444" }}
            >
              <PhoneOff className="h-4 w-4 text-white" />
            </button>
          </div>

          {/* Waveform area */}
          <div className="px-4 pb-4 space-y-1.5">
            {/* Agent row */}
            <div className="flex items-center gap-3">
              <span className="text-[9px] font-bold tracking-widest uppercase shrink-0 w-10 text-right"
                style={{ color: status === "speaking" ? "#22c55e" : "#333" }}>
                Agent
              </span>
              <div style={{ height: 44, flex: 1, position: "relative" }}>
                <WaveCanvas
                  active={status === "speaking"}
                  color={status === "speaking" ? "#22c55e" : "#1f3827"}
                  glowColor="#22c55e"
                  amplitude={0.44}
                  speed={0.06}
                />
              </div>
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: "#141414", marginLeft: 52 }} />

            {/* You row */}
            <div className="flex items-center gap-3">
              <span className="text-[9px] font-bold tracking-widest uppercase shrink-0 w-10 text-right"
                style={{ color: status === "listening" ? "#60a5fa" : "#333" }}>
                You
              </span>
              <div style={{ height: 44, flex: 1, position: "relative" }}>
                <WaveCanvas
                  active={status === "listening"}
                  color={status === "listening" ? "#60a5fa" : "#1a2535"}
                  glowColor="#60a5fa"
                  amplitude={0.36}
                  speed={0.045}
                />
              </div>
            </div>
          </div>

          {/* Status footer */}
          <div className="flex items-center justify-between px-4 py-2.5" style={{ borderTop: "1px solid #141414" }}>
            <div className="flex items-center gap-3 text-[11px]" style={{ color: "#444" }}>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full transition-colors"
                  style={{ background: status === "speaking" ? "#22c55e" : "#2a2a2a" }} />
                Agent {agentLabel}
              </span>
              <span style={{ color: "#222" }}>•</span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full transition-colors"
                  style={{ background: status === "listening" ? "#60a5fa" : "#2a2a2a" }} />
                Mic connected
              </span>
            </div>
            <span className="text-[11px] font-mono tabular-nums" style={{ color: "#444" }}>{fmtTime(elapsed)}</span>
          </div>
        </div>

      ) : (
        /* ── Idle / Ended ─────────────────────────────────────────────── */
        <div className="space-y-3">
          {status === "ended" && duration !== null && (
            <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-muted/40 border border-border">
              <span className="text-xs text-muted-foreground">Call ended</span>
              <span className="text-xs font-mono text-muted-foreground">{fmtTime(duration)}</span>
            </div>
          )}
          {error && (
            <div className="text-sm text-foreground bg-muted border border-border rounded-xl px-3 py-2">{error}</div>
          )}
          <Button className="w-full gap-2" onClick={() => void startCall()}>
            <Mic className="h-4 w-4" />
            {status === "ended" ? "Call again" : "Start Test Call"}
          </Button>
        </div>
      )}

      {/* ── Transcript (shown when messages exist) ────────────────────── */}
      {msgs.length > 0 && (
        <div ref={transcriptRef} className="h-44 overflow-y-auto space-y-2 pr-1">
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.speaker === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
                m.speaker === "user"
                  ? "bg-foreground/10 text-foreground rounded-br-sm"
                  : "bg-transparent text-foreground border border-border/60 rounded-bl-sm"
              }`}>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-0.5">
                  {m.speaker === "user" ? "You" : agentName}
                </p>
                {m.text}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Embed snippet ────────────────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-1.5">Embed on your website</p>
        <pre className="bg-elevated border border-border/50 rounded-xl px-3 py-2.5 text-[11px] font-mono text-muted-foreground/60 overflow-x-auto whitespace-pre leading-relaxed">
          {embedCode}
        </pre>
        <button
          className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-foreground transition-colors"
          onClick={() => { navigator.clipboard.writeText(embedCode); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        >
          {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy snippet</>}
        </button>
      </div>
    </div>
  );
}

/* ── Agent Config Panel ───────────────────────────────────────────────────── */

const LANGUAGES = [
  { value: "en",    label: "English" },
  { value: "es",    label: "Spanish" },
  { value: "fr",    label: "French" },
  { value: "de",    label: "German" },
  { value: "hi",    label: "Hindi" },
  { value: "pt",    label: "Portuguese" },
  { value: "ja",    label: "Japanese" },
  { value: "ko",    label: "Korean" },
  { value: "zh",    label: "Chinese (Mandarin)" },
  { value: "ru",    label: "Russian" },
  { value: "ar",    label: "Arabic" },
  { value: "it",    label: "Italian" },
  { value: "nl",    label: "Dutch" },
  { value: "pl",    label: "Polish" },
  { value: "sv",    label: "Swedish" },
  { value: "tr",    label: "Turkish" },
  { value: "id",    label: "Indonesian" },
  { value: "bn-IN", label: "Bengali (India)" },
  { value: "ta-IN", label: "Tamil" },
  { value: "te-IN", label: "Telugu" },
  { value: "mr-IN", label: "Marathi" },
  { value: "kn-IN", label: "Kannada" },
  { value: "gu-IN", label: "Gujarati" },
  { value: "pa-IN", label: "Punjabi" },
  { value: "uk",    label: "Ukrainian" },
  { value: "fi",    label: "Finnish" },
];

type AgentCfg = {
  maxTokens?: number; topP?: number; minP?: number; topK?: number;
  presencePenalty?: number; frequencyPenalty?: number;
  requestJsonResponse?: boolean;
  guardrailRoutes?: Array<{ name: string; scoreThreshold: number; utterances: string; response: string }>;
  secondaryLanguage?: string; secondaryLanguages?: string[]; ttsStream?: boolean; ttsSamplingRate?: number;
  ttsEncoding?: string; ttsAudioFormat?: string;
  wordsForInterruption?: number; incrementalDelay?: number;
  backchannelingStartDelay?: number; ambientNoiseEnabled?: boolean; ambientNoiseTrack?: string;
  hangupAfterLlmCall?: boolean; callCancellationPrompt?: string;
  voicemailDetection?: boolean;
  voicemailAction?: "hangup" | "leave_message" | "continue";
  voicemailMessage?: string;
  machineDetectionMode?: "Enable" | "DetectMessageEnd";
  // P2-C: Call Recording
  recordingEnabled?: boolean;
  recordingFormat?: "mp3" | "wav";
  // P2-D: IVR / DTMF pre-filter
  ivrEnabled?: boolean;
  ivrGreeting?: string;
  ivrOptions?: Array<{ digit: string; label: string; targetAgentId?: number }>;
  // P2-E: Call Queue
  queueEnabled?: boolean;
  queueMaxConcurrent?: number;
  queueWaitSeconds?: number;
  queueHoldMusicUrl?: string;
  schedulingGuardrails?: boolean;
  callStartHour?: number; callEndHour?: number;
  // P2-A: Call Transfer defaults
  callTransferEnabled?: boolean;
  callTransferType?: "warm" | "cold";
  callTransferNumber?: string;
  callTransferWarmMessage?: string;
  summarizationEnabled?: boolean; summarizationPrompt?: string;
  inboundLimit?: number; disallowUnknownNumbers?: boolean; whitelistNumbers?: string;
  callMemoryEnabled?: boolean; callMemorySourceType?: string;
  callMemorySourceUrl?: string; callMemoryAuthToken?: string;
  whatsappProvider?: string; whatsappCredentials?: Record<string, string>;
  whatsappOutcomeMessages?: Array<{
    outcome: string; templateName: string; language: string;
    parameters?: string[]; mediaUrl?: string; mediaFilename?: string; mediaType?: string;
  }>;
  genderDetectionEnabled?: boolean;
  genderDetectionProvider?: string;
  genderDetectionMaleSalutation?: string;
  genderDetectionFemaleSalutation?: string;
  genderDetectionNeutralSalutation?: string;
  // Agent timezone for date/time context injection
  timezone?: string;
};

type AgentToolLocal =
  | {
      type: "call_transfer";
      name: string;
      description: string;
      transferTo: string;
      warmHandoffMessage?: string;
    }
  | {
      type: "webhook";
      name: string;
      description: string;
      url: string;
      method: "GET" | "POST";
      headers?: Record<string, string>;
      secret?: string;
    }
  | {
      type: "send_sms";
      name: string;
      description: string;
      messageTemplate: string;
    }
  | {
      type: "end_call";
      name: string;
      description: string;
      goodbyeMessage?: string;
    }
  | {
      type: "cal_com";
      name: string;
      description: string;
      apiKey: string;
      eventTypeId: number;
      timezone?: string;
    }
  | {
      type: "native_booking";
      name: string;
      description: string;
      eventTypeId: number;
      calendarId?: number;
      timezone?: string;
      taskName?: string;
      preToolMessage?: string;
    }
  | {
      type: "native_reschedule";
      name: string;
      description: string;
    }
  | {
      type: "native_cancel";
      name: string;
      description: string;
      calendarId?: number;
      eventTypeId?: number;
    }
  | {
      type: "native_check_availability";
      name: string;
      description: string;
      eventTypeId: number;
      calendarId?: number;
      timezone?: string;
    };

function SliderRow({ label, desc, value, onChange, min, max, step, unit = "" }: {
  label: string; desc?: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; unit?: string;
}) {
  const display = step < 1 ? value.toFixed(2) : String(Math.round(value));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-foreground">{label}</p>
          {desc && <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>}
        </div>
        <span className="text-xs font-mono bg-muted border border-border rounded px-1.5 py-0.5 text-foreground min-w-[52px] text-center shrink-0 ml-3">
          {display}{unit}
        </span>
      </div>
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v!)} />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{min}{unit}</span><span>{max}{unit}</span>
      </div>
    </div>
  );
}

function ToggleRow({ label, desc, checked, onChange }: {
  label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">{label}</p>
        {desc && <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} className="shrink-0 data-[state=checked]:bg-primary" />
    </div>
  );
}

type CartesiaVoice = { id: string; name: string; description?: string; language?: string };

const LANG_LABEL: Record<string, string> = {
  hi: "Hindi", ta: "Tamil", te: "Telugu", kn: "Kannada",
  ml: "Malayalam", bn: "Bengali", mr: "Marathi", gu: "Gujarati",
  pa: "Punjabi", "en-IN": "English · IN", en: "English",
};
function langLabel(lang?: string) { return lang ? (LANG_LABEL[lang] ?? lang.toUpperCase()) : "English"; }

const ARUSHI_VOICE: CartesiaVoice = {
  id: "2ee87190-8f84-4925-97da-e52547f9462c",
  name: "Arushi",
  description: "Warm Indian English female",
  language: "en",
};

// Only Arushi is a confirmed real Cartesia Indian voice — used until API fetch succeeds
const CARTESIA_FALLBACK_VOICES: CartesiaVoice[] = [ARUSHI_VOICE];

const PREVIEW_TEXTS: Record<string, string> = {
  en:    "Hello! I'm your AI voice assistant. How can I help you today?",
  hi:    "नमस्ते! मैं आपकी कैसे मदद कर सकता हूं?",
  ta:    "வணக்கம்! நான் உங்களுக்கு எப்படி உதவலாம்?",
  te:    "నమస్కారం! నేను మీకు ఎలా సహాయం చేయగలను?",
  kn:    "ನಮಸ್ಕಾರ! ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?",
  mr:    "नमस्कार! मी तुमच्यासाठी काय करू शकतो?",
  gu:    "નમસ્તે! હું તમારી કેવી રીતે મદદ કરી શકું?",
  bn:    "নমস্কার! আমি আপনাকে কীভাবে সাহায্য করতে পারি?",
  ml:    "ഹലോ! ഞാൻ നിങ്ങളെ എങ്ങനെ സഹായിക്കട്ടെ?",
  es:    "¡Hola! Soy tu asistente de voz. ¿En qué puedo ayudarte?",
  fr:    "Bonjour! Je suis votre assistant vocal. Comment puis-je vous aider?",
  de:    "Hallo! Ich bin Ihr Sprachassistent. Wie kann ich Ihnen helfen?",
  ar:    "مرحباً! أنا مساعدك الصوتي. كيف يمكنني مساعدتك اليوم؟",
};
function getPreviewText(lang: string): string {
  const prefix = lang.split("-")[0] ?? "en";
  return PREVIEW_TEXTS[lang] ?? PREVIEW_TEXTS[prefix] ?? PREVIEW_TEXTS["en"]!;
}

function AgentConfigPanel({ agentId, onDeleted, initialTab }: { agentId: number; onDeleted: () => void; initialTab?: string }) {
  const queryClient = useQueryClient();
  const { getToken, userId: callerUserId } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState(initialTab ?? "overview");
  const [outboundDialogOpen, setOutboundDialogOpen] = useState(false);
  const [toNumber, setToNumber] = useState("");
  const [otpDialogOpen, setOtpDialogOpen]       = useState(false);
  const [pendingCallNumber, setPendingCallNumber] = useState("");

  const { data: agent, isLoading } = useGetAgent(agentId, {
    query: { queryKey: getGetAgentQueryKey(agentId) },
  });

  const { data: calls, isLoading: callsLoading } = useListCalls(
    { agentId },
    { query: { enabled: activeTab === "logs" || activeTab === "overview", queryKey: getListCallsQueryKey({ agentId }) } }
  );

  const update          = useUpdateAgent();
  const toggleAgent     = useToggleAgent();
  const deleteAgent     = useDeleteAgent();
  const initiateOutbound = useInitiateOutboundCall();
  const { data: kbs } = useListKnowledgeBases();
  const { data: eventTypes } = useListEventTypes();
  const { data: calendars } = useListCalendars();

  // ── Booking-tool modal state (Tools tab) ───────────────────────────────
  const [bookingModal, setBookingModal] = useState<null | {
    editIdx: number | null;
    calendarId: number | null;
    eventTypeId: number | null;
    timezone: string;
    taskName: string;
    description: string;
    preToolMessage: string;
  }>(null);
  const modalParams = bookingModal?.calendarId ? { calendarId: bookingModal.calendarId } : undefined;
  const { data: modalEventTypes, isLoading: modalEventTypesLoading } = useListEventTypes(
    modalParams,
    {
      query: {
        enabled: bookingModal !== null && bookingModal.calendarId !== null,
        queryKey: ["modal-event-types", modalParams?.calendarId ?? null],
      },
    },
  );

  // ── Tab 1 — Agent ───────────────────────────────────────────────
  const [agentName, setAgentName]                           = useState("");
  const [agentType, setAgentType]                           = useState("general");
  const [systemPrompt, setSystemPrompt]                     = useState("");
  const [greetingMessage, setGreetingMessage]               = useState("Hello");
  const [webhookUrl, setWebhookUrl]                         = useState("");
  const [knowledgeBaseId, setKnowledgeBaseId]               = useState<number | null>(null);

  // ── Tab 2 — LLM ─────────────────────────────────────────────────
  const [llmProvider, setLlmProvider]                       = useState("");
  const [llmModel, setLlmModel]                             = useState("");
  const [temperature, setTemperature]                       = useState(0.10);

  // ── Tab 3 — Audio ───────────────────────────────────────────────
  const [agentTools, setAgentTools]                         = useState<AgentToolLocal[]>([]);
  const [asrProvider, setAsrProvider]                       = useState("");
  const [asrModel, setAsrModel]                             = useState("");
  const [asrLanguage, setAsrLanguage]                       = useState("en");
  const [asrBackgroundDenoising, setAsrBackgroundDenoising] = useState(false);
  const [asrConfidenceThreshold, setAsrConfidenceThreshold] = useState(0.40);
  const [asrEndOfTurnConfidence, setAsrEndOfTurnConfidence] = useState(0.70);
  const [asrEndOfTurnTimeout, setAsrEndOfTurnTimeout]       = useState(5000);
  const [asrKeyterms, setAsrKeyterms]                       = useState("");
  const [asrSmartEndpointing, setAsrSmartEndpointing]       = useState("off");
  const [asrAutoFallback, setAsrAutoFallback]               = useState(true);
  const [ttsProvider, setTtsProvider]                       = useState("");
  const [ttsModel, setTtsModel]                             = useState("");
  const [ttsVoice, setTtsVoice]                             = useState("");
  const [cartesiaVoices, setCartesiaVoices]                 = useState<CartesiaVoice[]>(CARTESIA_FALLBACK_VOICES);
  const [loadingCartesiaVoices, setLoadingCartesiaVoices]   = useState(false);
  const [cartesiaVoiceSource, setCartesiaVoiceSource]       = useState<"cartesia" | "whitelist" | "fallback">("fallback");
  const [voicePlaying, setVoicePlaying]                     = useState<string | null>(null);
  const voiceAudioRef                                       = useRef<HTMLAudioElement | null>(null);
  const [telephony, setTelephony]                           = useState("");

  // ── Tab 4 — Engine ──────────────────────────────────────────────
  const [backchannelingEnabled, setBackchannelingEnabled]   = useState(true);
  const [backchannelingFrequency, setBackchannelingFrequency] = useState(0.3);
  const [noiseCancellationEnabled, setNoiseCancellationEnabled] = useState(true);
  const [endCallPhrases, setEndCallPhrases]                 = useState("");
  const [inactivityMessage, setInactivityMessage]           = useState("");

  const [audioAdvanced, setAudioAdvanced]                   = useState(false);

  // ── Auth fetch helper ────────────────────────────────────────────
  const apiFetch = useCallback(async (path: string, init?: RequestInit): Promise<Response> => {
    const token = await getToken();
    return fetch(path, {
      ...init,
      headers: { ...(init?.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  }, [getToken]);

  // ── Cartesia voice loader ────────────────────────────────────────
  useEffect(() => {
    if (ttsProvider !== "cartesia") return;
    if (cartesiaVoiceSource === "cartesia" || cartesiaVoiceSource === "whitelist") return; // already loaded
    setLoadingCartesiaVoices(true);
    apiFetch("/api/wizard/voices")
      .then(r => r.ok ? r.json() as Promise<{ voices: CartesiaVoice[]; source: string }> : null)
      .then(data => {
        if (!data?.voices?.length) return; // keep local fallback
        // Use server list as-is — never inject a local ARUSHI_VOICE so the admin whitelist is respected
        setCartesiaVoices(data.voices);
        setCartesiaVoiceSource(data.source === "whitelist" ? "whitelist" : data.source === "cartesia" ? "cartesia" : "fallback");
      })
      .catch(() => {})
      .finally(() => setLoadingCartesiaVoices(false));
  }, [ttsProvider]);

  // ── Voice preview ────────────────────────────────────────────────
  async function previewVoice(voiceId: string) {
    if (voicePlaying === voiceId) {
      voiceAudioRef.current?.pause();
      setVoicePlaying(null);
      return;
    }
    setVoicePlaying(voiceId);
    try {
      const res = await apiFetch("/api/wizard/preview-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId, text: getPreviewText(asrLanguage), modelId: ttsModel || "sonic-3.5" }),
      });
      if (!res.ok) throw new Error("preview failed");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const audio = new Audio(url);
      voiceAudioRef.current = audio;
      audio.onended = () => { setVoicePlaying(null); URL.revokeObjectURL(url); };
      audio.onerror = () => { setVoicePlaying(null); URL.revokeObjectURL(url); };
      await audio.play();
    } catch {
      // Fallback to browser TTS
      const voice = cartesiaVoices.find(v => v.id === voiceId);
      const utt = new SpeechSynthesisUtterance(getPreviewText(asrLanguage));
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utt);
      utt.onend = () => setVoicePlaying(null);
      setVoicePlaying(voiceId);
    }
  }

  // ── Tab 5 — Call ────────────────────────────────────────────────
  const [maxDuration, setMaxDuration]                       = useState(300);
  const [silenceTimeout, setSilenceTimeout]                 = useState(30);

  // ── Tab 7 — Analytics ───────────────────────────────────────────
  const [dispositionSchema, setDispositionSchema]           = useState<Array<{ key: string; label: string; type: string; required?: boolean; options?: string; description?: string }>>([]);

  // ── Advanced (agentConfig JSONB) covers LLM/Audio/Engine/Call/Analytics/Inbound/WhatsApp advanced fields
  const [agentConfig, setAgentConfig]                       = useState<AgentCfg>({});

  const [dirty, setDirty]                                   = useState(false);
  const [activeDrawer, setActiveDrawer]                     = useState<string | null>(null);

  function mark<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setDirty(true); };
  }

  function setCfg(updates: Partial<AgentCfg>) {
    setAgentConfig(prev => ({ ...prev, ...updates }));
    setDirty(true);
  }

  useEffect(() => {
    if (!agent) return;
    const a = agent as unknown as Record<string, unknown>;
    setAgentName(agent.name ?? "");
    setAgentType((a.agentType as string) ?? "general");
    setSystemPrompt(agent.systemPrompt ?? "");
    setGreetingMessage(agent.greetingMessage ?? "Hello");
    setWebhookUrl((agent.webhookUrl ?? "") as string);
    setKnowledgeBaseId(agent.knowledgeBaseId ?? null);
    setLlmProvider(agent.llmProvider ?? "");
    setLlmModel(agent.llmModel ?? "");
    setTemperature((agent.temperature ?? 0.10) as number);
    setAsrProvider(agent.asrProvider ?? "");
    setAsrModel(agent.asrModel ?? "");
    const LANG_NORM: Record<string, string> = {
      ta: "ta-IN", te: "te-IN", kn: "kn-IN", mr: "mr-IN",
      gu: "gu-IN", bn: "bn-IN", ml: "ml-IN",
      "en-US": "en", "en-GB": "en", "en-IN": "en",
    };
    const rawLang = agent.asrLanguage || (agent as unknown as Record<string,unknown>).language as string || "en";
    setAsrLanguage(LANG_NORM[rawLang] ?? rawLang);
    setAsrBackgroundDenoising(agent.asrBackgroundDenoising ?? false);
    setAsrConfidenceThreshold((agent.asrConfidenceThreshold ?? 0.40) as number);
    setAsrEndOfTurnConfidence((agent.asrEndOfTurnConfidence ?? 0.70) as number);
    setAsrEndOfTurnTimeout((agent.asrEndOfTurnTimeout ?? 5000) as number);
    setAsrKeyterms(agent.asrKeyterms ?? "");
    setAsrSmartEndpointing(agent.asrSmartEndpointing ?? "off");
    setAsrAutoFallback(agent.asrAutoFallback ?? true);
    setTtsProvider(agent.ttsProvider ?? "");
    setTtsModel(agent.ttsModel ?? (agent.ttsProvider === "cartesia" ? "sonic-2" : ""));
    setTtsVoice((agent as unknown as Record<string, unknown>).ttsVoice as string ?? "");
    setTelephony(agent.telephonyProvider ?? "");
    setBackchannelingEnabled(agent.backchannelingEnabled ?? true);
    setBackchannelingFrequency((agent.backchannelingFrequency ?? 0.3) as number);
    setNoiseCancellationEnabled(agent.noiseCancellationEnabled ?? true);
    setEndCallPhrases(agent.endCallPhrases ?? "");
    setInactivityMessage(agent.inactivityMessage ?? "");
    setMaxDuration((agent.maxDuration ?? 300) as number);
    setSilenceTimeout((agent.silenceTimeoutSeconds ?? 30) as number);
    setDispositionSchema(
      ((a.dispositionSchema as Array<{ key: string; label: string; type: string; required?: boolean; options?: string[]; description?: string }> | undefined) ?? [])
        .map(f => ({ ...f, options: f.options?.join(", ") ?? "", description: f.description ?? "" }))
    );
    const existingCfg = ((a.agentConfig as AgentCfg) ?? {}) as AgentCfg;
    const rawTools = (a.tools as AgentToolLocal[] | undefined) ?? [];
    setAgentTools(rawTools);
    const ctTool = rawTools.find(t => t.type === "call_transfer") as { transferTo?: string } | undefined;
    setAgentConfig({
      ...existingCfg,
      callTransferEnabled:  existingCfg.callTransferEnabled  ?? (ctTool !== undefined),
      callTransferNumber:   existingCfg.callTransferNumber   ?? ctTool?.transferTo ?? "",
    });
    setDirty(false);
  }, [agent?.id]);

  function handleSave() {
    update.mutate(
      {
        id: agentId,
        data: {
          name: agentName,
          agentType: agentType || undefined,
          systemPrompt,
          greetingMessage: greetingMessage || undefined,
          webhookUrl: webhookUrl || undefined,
          knowledgeBaseId: knowledgeBaseId ?? undefined,
          llmProvider, llmModel: llmModel || undefined,
          temperature,
          asrProvider,
          asrModel: asrModel || undefined,
          asrLanguage: asrLanguage || undefined,
          asrBackgroundDenoising,
          asrConfidenceThreshold,
          asrEndOfTurnConfidence,
          asrEndOfTurnTimeout,
          asrKeyterms: asrKeyterms || undefined,
          asrSmartEndpointing,
          asrAutoFallback,
          ttsProvider, ttsModel: ttsModel || undefined,
          ttsVoice: ttsVoice || undefined,
          telephonyProvider: telephony,
          backchannelingEnabled, backchannelingFrequency,
          noiseCancellationEnabled,
          endCallPhrases: endCallPhrases || undefined,
          inactivityMessage: inactivityMessage || undefined,
          maxDuration, silenceTimeoutSeconds: silenceTimeout,
          dispositionSchema: dispositionSchema
            .filter(f => f.key.trim() && f.label.trim())
            .map(f => ({
              key: f.key.trim(), label: f.label.trim(), type: f.type as "text" | "number" | "boolean" | "choice",
              required: f.required,
              description: f.description?.trim() || undefined,
              options: f.type === "choice" && f.options ? f.options.split(",").map(s => s.trim()).filter(Boolean) : undefined,
            })),
          agentConfig: (() => {
            const secondaryLanguages = cfg.secondaryLanguages ?? (cfg.secondaryLanguage ? [cfg.secondaryLanguage] : []);
            return { ...cfg, secondaryLanguages, secondaryLanguage: secondaryLanguages[0] ?? undefined };
          })(),
          tools: agentTools,
        } as Parameters<typeof update.mutate>[0]["data"],
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) });
          queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
          setDirty(false);
          toast({ title: "Saved", description: "Assistant updated." });
        },
        onError: (err: unknown) => toast({ title: "Error", description: formatApiError(err), variant: "destructive" }),
      }
    );
  }

  function handleToggle() {
    toggleAgent.mutate({ id: agentId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) });
        queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
      },
    });
  }

  function handleDelete() {
    if (!confirm(`Delete "${agent?.name}"? This cannot be undone.`)) return;
    deleteAgent.mutate({ id: agentId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
        toast({ title: "Deleted", description: "Assistant removed." });
        onDeleted();
      },
    });
  }

  const llmModelOptions = LLM_MODELS[llmProvider] ?? [];
  const asrModelOptions = ASR_MODELS[asrProvider] ?? [];
  const cfg = agentConfig;

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col p-5 gap-4">
        <Skeleton className="h-8 w-48 bg-muted" />
        <Skeleton className="h-4 w-72 bg-muted" />
        <Skeleton className="h-32 w-full bg-muted" />
      </div>
    );
  }

  if (!agent) return null;

  const successRate = agent.totalCalls
    ? Math.round(((agent.successfulCalls ?? 0) / agent.totalCalls) * 100)
    : 0;

  type NavItem = { value: string; label: string; icon: React.ComponentType<{ className?: string }> };
  const NAV_ITEMS: NavItem[] = [
    { value: "overview",  label: "Overview",  icon: LayoutGrid },
    { value: "prompt",    label: "Prompt",    icon: MessageSquare },
    { value: "voice",     label: "Voice",     icon: Mic },
    { value: "knowledge", label: "Knowledge", icon: BookOpen },
    { value: "tools",     label: "Tools",     icon: Wrench },
    { value: "pipeline",  label: "Pipeline",  icon: GitBranch },
    { value: "test",      label: "Test",      icon: PlayCircle },
    { value: "logs",      label: "Logs",      icon: AlignLeft },
  ];

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden animate-fade-in">
      {/* ── Compact top bar ── */}
      <div className="flex items-center gap-3 px-5 h-12 shrink-0 border-b border-border bg-background">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-semibold text-[14.5px] truncate text-foreground">{agentName || agent.name}</span>
          <span className="text-[10px] font-mono hidden sm:flex items-center px-1.5 py-0.5 rounded-md bg-elevated border border-border text-muted-foreground/60">
            #{String(agent.id).padStart(4, "0")}
          </span>
          {statusDot(agent.status)}
        </div>
        <div className="hidden sm:flex items-center gap-1.5 ml-2">
          <span className="text-[11px] text-muted-foreground/40 tabular-nums">{agent.totalCalls ?? 0} calls</span>
          <span className="text-[11px] text-muted-foreground/25">·</span>
          <span className="text-[11px] text-muted-foreground/40 tabular-nums">{successRate}% ok</span>
          {agent.avgDurationSeconds != null && <>
            <span className="text-[11px] text-muted-foreground/25">·</span>
            <span className="text-[11px] text-muted-foreground/40">~{agent.avgDurationSeconds}s</span>
          </>}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {dirty && (
            <Button size="sm" className="h-7 text-[11px] gap-1.5 border border-border bg-elevated text-foreground hover:bg-accent transition-colors" onClick={handleSave} disabled={update.isPending}>
              {update.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 border-border text-muted-foreground hover:text-foreground" onClick={() => setOutboundDialogOpen(true)}>
            <PhoneOutgoing className="h-3 w-3" /> Call
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover border-border w-44">
              <DropdownMenuItem className="text-muted-foreground hover:bg-muted cursor-pointer text-xs" onClick={handleToggle}>
                <PlayCircle className="mr-2 h-3.5 w-3.5" /> {agent.status === "active" ? "Deactivate" : "Activate"}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-muted" />
              <DropdownMenuItem className="text-foreground hover:bg-muted cursor-pointer text-xs" onClick={handleDelete}>
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── Secondary sidebar + workspace ── */}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Secondary nav ── */}
        <nav className="w-[148px] shrink-0 border-r border-border bg-sidebar flex flex-col py-2 px-2 gap-px overflow-y-auto">
          {NAV_ITEMS.map(item => (
            <button key={item.value} onClick={() => setActiveTab(item.value)}
              className={
                "flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[12px] font-medium transition-colors w-full text-left " +
                (activeTab === item.value ? "bg-accent text-foreground" : "text-muted-foreground/60 hover:text-foreground hover:bg-accent/40")
              }>
              <item.icon className="h-3.5 w-3.5 shrink-0" />
              {item.label}
            </button>
          ))}
        </nav>

        {/* ── Main workspace ── */}
        <div className="flex-1 min-h-0 overflow-y-auto bg-background">

          {/* ═══ OVERVIEW ════════════════════════════════════════════════ */}
          {activeTab === "overview" && (
            <div className="p-5 space-y-4 max-w-3xl">
              <div className="grid grid-cols-2 gap-3">
                {/* Card 1 — Identity */}
                <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">Identity</p>
                  <div>
                    <p className="text-[10px] text-muted-foreground/60 mb-1">Name</p>
                    <Input value={agentName} onChange={e => { setAgentName(e.target.value); setDirty(true); }} className="h-8 text-[13px] border focus-visible:ring-0" />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground/60 mb-1">Type</p>
                    <Select value={agentType} onValueChange={mark(setAgentType)}>
                      <SelectTrigger className="h-8 text-xs border"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        {[
                          ["general", "General Purpose"],
                          ["lead_qualification", "Lead Qualification"],
                          ["customer_support", "Customer Support"],
                          ["appointment_booking", "Appointment Booking"],
                          ["survey", "Survey"],
                        ].map(([v, l]) => (
                          <SelectItem key={v} value={v} className="text-foreground text-xs">{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground/60 mb-1">Language</p>
                    <Select value={asrLanguage} onValueChange={mark(setAsrLanguage)}>
                      <SelectTrigger className="h-8 text-xs border"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-card border-border max-h-60">
                        {LANGUAGES.map(l => <SelectItem key={l.value} value={l.value} className="text-foreground text-xs">{l.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {(() => {
                      const secLangs: string[] = cfg.secondaryLanguages ?? (cfg.secondaryLanguage ? [cfg.secondaryLanguage as string] : []);
                      if (!secLangs.length) return null;
                      return (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {secLangs.map((lang: string) => (
                            <span key={lang} className="text-[10px] px-1.5 py-0.5 rounded bg-muted border border-border/60 text-muted-foreground">
                              {LANG_LABEL[lang] ?? lang}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                {/* Card 2 — Brain */}
                <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">Brain</p>
                  <div>
                    <p className="text-[10px] text-muted-foreground/60 mb-1">LLM Provider</p>
                    <Select value={llmProvider} onValueChange={v => { mark(setLlmProvider)(v); setLlmModel(LLM_MODELS[v]?.[0]?.value ?? ""); }}>
                      <SelectTrigger className="h-8 text-xs border"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        {LLM_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-foreground text-xs">{p.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {llmModelOptions.length > 0 && (
                    <div>
                      <p className="text-[10px] text-muted-foreground/60 mb-1">Model</p>
                      <Select value={llmModel} onValueChange={mark(setLlmModel)}>
                        <SelectTrigger className="h-8 text-xs border"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          {llmModelOptions.map(m => <SelectItem key={m.value} value={m.value} className="text-foreground text-xs">{m.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <SliderRow label="Temperature" desc="Creativity" value={temperature} onChange={v => { setTemperature(v); setDirty(true); }} min={0} max={2} step={0.01} />
                </div>
                {/* Card 3 — Voice */}
                <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">Voice</p>
                  <div>
                    <p className="text-[10px] text-muted-foreground/60 mb-1">TTS Provider</p>
                    <Select value={ttsProvider} onValueChange={v => { mark(setTtsProvider)(v); setTtsModel(v === "cartesia" ? "sonic-2" : (TTS_MODELS[v]?.[0]?.value ?? "")); setTtsVoice(""); }}>
                      <SelectTrigger className="h-8 text-xs border"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        {TTS_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-foreground text-xs">{p.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {ttsProvider === "cartesia" && (
                    <div>
                      <p className="text-[10px] text-muted-foreground/60 mb-1">Voice</p>
                      <div className="flex gap-1.5">
                        <Select value={ttsVoice || ARUSHI_VOICE.id} onValueChange={v => { setTtsVoice(v); setDirty(true); }}>
                          <SelectTrigger className="h-8 text-xs border flex-1"><SelectValue placeholder="Select voice" /></SelectTrigger>
                          <SelectContent className="bg-card border-border max-h-60">
                            {cartesiaVoices.map(v => <SelectItem key={v.id} value={v.id} className="text-foreground text-xs">{v.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <button type="button" onClick={() => void previewVoice(ttsVoice || ARUSHI_VOICE.id)}
                          className="h-8 w-8 shrink-0 flex items-center justify-center rounded-md border border-border bg-elevated hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                          {voicePlaying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Volume2 className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                  )}
                  {ttsProvider && ttsProvider !== "cartesia" && TTS_MODELS[ttsProvider] && (
                    <div>
                      <p className="text-[10px] text-muted-foreground/60 mb-1">Voice / Model</p>
                      <Select value={ttsModel} onValueChange={mark(setTtsModel)}>
                        <SelectTrigger className="h-8 text-xs border"><SelectValue placeholder="Select voice" /></SelectTrigger>
                        <SelectContent className="bg-card border-border max-h-60">
                          {TTS_MODELS[ttsProvider]!.map(m => <SelectItem key={m.value} value={m.value} className="text-foreground text-xs">{m.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                {/* Card 4 — Pipeline */}
                <div className="bg-card border border-border rounded-2xl p-4">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50 mb-3">Pipeline</p>
                  <div className="flex items-center gap-2 overflow-x-auto">
                    {([
                      { label: "Caller",    sub: "",                  icon: Phone },
                      { label: "STT",       sub: asrProvider || "—",  icon: Mic },
                      { label: "LLM",       sub: llmProvider || "—",  icon: Sparkles },
                      { label: "TTS",       sub: ttsProvider || "—",  icon: Volume2 },
                      { label: "Telephony", sub: telephony || "—",    icon: PhoneOutgoing },
                    ] as { label: string; sub: string; icon: React.ComponentType<{ className?: string }> }[]).map((node, i, arr) => (
                      <React.Fragment key={node.label}>
                        <div className="flex flex-col items-center gap-1 shrink-0">
                          <div className="h-9 w-9 rounded-xl bg-elevated border border-border flex items-center justify-center">
                            <node.icon className="h-4 w-4 text-muted-foreground/40" />
                          </div>
                          <p className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-wide">{node.label}</p>
                          {node.sub && <p className="text-[9px] text-muted-foreground/40 capitalize">{node.sub}</p>}
                        </div>
                        {i < arr.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/15 shrink-0" />}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ PROMPT ════════════════════════════════════════════════ */}
          {activeTab === "prompt" && (
            <div className="p-6 max-w-2xl space-y-5">
              <div>
                <label className="block text-[10.5px] font-semibold uppercase tracking-[0.12em] mb-2 text-muted-foreground/60">Welcome Message</label>
                <Textarea value={greetingMessage} onChange={e => { setGreetingMessage(e.target.value); setDirty(true); }}
                  placeholder="First thing the agent says when a call connects"
                  className="text-[14px] border resize-none min-h-[72px] leading-relaxed focus-visible:ring-0" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">Agent Prompt</label>
                  <button type="button"
                    className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors border border-border bg-elevated text-muted-foreground hover:text-foreground hover:bg-accent"
                    onClick={() => { setSystemPrompt("You are a helpful and professional AI voice assistant. Be concise, clear, and friendly in all responses."); setDirty(true); }}>
                    <Sparkles className="h-3 w-3" /> Generate
                  </button>
                </div>
                <Textarea value={systemPrompt} onChange={e => { setSystemPrompt(e.target.value); setDirty(true); }}
                  placeholder="You are a helpful AI voice assistant…"
                  className="text-[14px] border resize-none min-h-[280px] leading-relaxed focus-visible:ring-0" />
                <div className="flex flex-wrap gap-2 mt-3">
                  <span className="text-[11px] self-center text-muted-foreground/50">Variables:</span>
                  {[
                    { var: "{caller_salutation}", tip: "sir / ma'am — requires Gender Detection in Pipeline" },
                    { var: "{caller_number}",     tip: "Caller's phone number" },
                    { var: "{agent_name}",        tip: "This agent's name" },
                    { var: "{date}",              tip: "Current date" },
                  ].map(chip => (
                    <button key={chip.var} type="button" title={chip.tip}
                      onClick={() => { setSystemPrompt(p => p + " " + chip.var); setDirty(true); }}
                      className="text-[11px] rounded-lg border border-border px-2.5 py-1 font-mono transition-colors bg-muted text-muted-foreground hover:text-foreground hover:border-muted-foreground/40">
                      {chip.var}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ═══ VOICE ══════════════════════════════════════════════════ */}
          {activeTab === "voice" && (
            <div className="px-5 py-4 max-w-2xl space-y-5">
              {/* ASR */}
              <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Transcriber (ASR)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Provider</p>
                    <Select value={asrProvider} onValueChange={v => { mark(setAsrProvider)(v); setAsrModel(ASR_MODELS[v]?.[0]?.value ?? ""); }}>
                      <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-card border-border">{ASR_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-foreground text-xs">{p.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Model</p>
                    {asrModelOptions.length > 0
                      ? <Select value={asrModel} onValueChange={mark(setAsrModel)}><SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger><SelectContent className="bg-card border-border">{asrModelOptions.map(m => <SelectItem key={m.value} value={m.value} className="text-foreground text-xs">{m.label}</SelectItem>)}</SelectContent></Select>
                      : <Input value={asrModel} onChange={e => { setAsrModel(e.target.value); setDirty(true); }} placeholder="Model name" className="h-7 text-xs bg-card border-border text-foreground" />}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Language</p>
                  <Select value={asrLanguage} onValueChange={mark(setAsrLanguage)}>
                    <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-card border-border max-h-60">{LANGUAGES.map(l => <SelectItem key={l.value} value={l.value} className="text-foreground text-xs">{l.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <SliderRow label="Confidence Threshold" desc="Discard transcripts below this score" value={asrConfidenceThreshold} onChange={v => { setAsrConfidenceThreshold(v); setDirty(true); }} min={0} max={1} step={0.01} />
                <SliderRow label="End-of-Turn Timeout" desc="Max wait after speech ends" value={asrEndOfTurnTimeout} onChange={v => { setAsrEndOfTurnTimeout(v); setDirty(true); }} min={500} max={10000} step={100} unit="ms" />
                <ToggleRow label="Auto Fallback" desc="Switch to backup STT if primary fails" checked={asrAutoFallback} onChange={v => { setAsrAutoFallback(v); setDirty(true); }} />
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Smart Endpointing</p>
                  <div className="flex border border-border rounded-lg p-0.5 bg-card w-fit">
                    {(["off", "vapi", "livekit"] as const).map(opt => (
                      <button key={opt} type="button" onClick={() => { setAsrSmartEndpointing(opt); setDirty(true); }}
                        className={`text-xs h-7 px-4 rounded-md transition-colors ${asrSmartEndpointing === opt ? "bg-muted text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"}`}>
                        {opt === "off" ? "Off" : opt === "vapi" ? "VAPI" : "LiveKit"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Keyterms</p>
                  <Textarea value={asrKeyterms} onChange={e => { setAsrKeyterms(e.target.value); setDirty(true); }} placeholder="e.g. SnapServe, API, webhook" rows={2} className="bg-card border-border text-foreground text-xs resize-none placeholder:text-muted-foreground" />
                </div>
              </div>
              {/* TTS */}
              <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Synthesizer (TTS)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Provider</p>
                    <Select value={ttsProvider} onValueChange={v => { mark(setTtsProvider)(v); setTtsModel(v === "cartesia" ? "sonic-2" : (TTS_MODELS[v]?.[0]?.value ?? "")); setTtsVoice(""); }}>
                      <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-card border-border">{TTS_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-foreground text-xs">{p.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">{ttsProvider === "cartesia" ? "Model" : "Voice / Model"}</p>
                    {ttsProvider === "cartesia"
                      ? <Select value={ttsModel || "sonic-2"} onValueChange={v => { setTtsModel(v); setDirty(true); }}><SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger><SelectContent className="bg-card border-border">{TTS_MODELS.cartesia.map(m => <SelectItem key={m.value} value={m.value} className="text-foreground text-xs">{m.label}</SelectItem>)}</SelectContent></Select>
                      : TTS_MODELS[ttsProvider]
                        ? <Select value={ttsModel} onValueChange={mark(setTtsModel)}><SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue placeholder="Select voice" /></SelectTrigger><SelectContent className="bg-card border-border max-h-60">{TTS_MODELS[ttsProvider]!.map(m => <SelectItem key={m.value} value={m.value} className="text-foreground text-xs">{m.label}</SelectItem>)}</SelectContent></Select>
                        : <Input value={ttsModel} onChange={e => { setTtsModel(e.target.value); setDirty(true); }} placeholder="Voice / model name" className="h-7 text-xs bg-card border-border text-foreground" />}
                  </div>
                </div>
                {ttsProvider === "cartesia" && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Voice</p>
                    <div className="flex gap-2">
                      {(() => {
                        const langPrefix = (asrLanguage || "en").split("-")[0]!;
                        const filtered = cartesiaVoices.filter(v => !v.language || v.language.split("-")[0] === langPrefix);
                        const displayVoices = filtered.length > 0 ? filtered : cartesiaVoices;
                        return (
                          <Select value={ttsVoice || ARUSHI_VOICE.id} onValueChange={v => { setTtsVoice(v); setDirty(true); }}>
                            <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground flex-1"><SelectValue placeholder={loadingCartesiaVoices ? "Loading voices…" : "Select voice"} /></SelectTrigger>
                            <SelectContent className="bg-card border-border max-h-72">
                              {loadingCartesiaVoices ? <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
                                : displayVoices.map(v => <SelectItem key={v.id} value={v.id} className="text-foreground text-xs">{v.name} · {langLabel(v.language)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        );
                      })()}
                      <button type="button" onClick={() => void previewVoice(ttsVoice || ARUSHI_VOICE.id)}
                        className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md border border-border bg-card/70 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                        {voicePlaying === (ttsVoice || ARUSHI_VOICE.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Volume2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                )}
                {(() => {
                  const d = TELEPHONY_AUDIO_DEFAULTS[telephony];
                  if (!d) return null;
                  return (
                    <div className="rounded-lg bg-zinc-950/40 border border-zinc-800/50 px-3 py-2.5 flex items-start gap-2.5">
                      <Check className="h-3.5 w-3.5 text-foreground mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-zinc-300 font-medium">Auto-configured for {TELEPHONY_PROVIDERS.find(p => p.value === telephony)?.label}</p>
                        <p className="text-[11px] text-foreground/70 mt-0.5">{d.label} · {d.note}</p>
                      </div>
                      <button type="button" onClick={() => setAudioAdvanced(v => !v)} className="text-[11px] text-muted-foreground hover:text-foreground whitespace-nowrap shrink-0 mt-0.5">
                        {audioAdvanced ? "Hide" : "Advanced"}
                      </button>
                    </div>
                  );
                })()}
                {audioAdvanced && (
                  <div className="space-y-3 pt-1 border-t border-border/40">
                    <div className="grid grid-cols-3 gap-3">
                      <div><p className="text-xs text-muted-foreground mb-1">Sampling Rate</p><Input type="number" value={cfg.ttsSamplingRate ?? ""} onChange={e => setCfg({ ttsSamplingRate: parseInt(e.target.value) || undefined })} placeholder="e.g. 8000" className="h-7 text-xs bg-card border-border text-foreground placeholder:text-muted-foreground" /></div>
                      <div><p className="text-xs text-muted-foreground mb-1">Encoding</p>
                        <Select value={cfg.ttsEncoding ?? "none"} onValueChange={v => setCfg({ ttsEncoding: v === "none" ? undefined : v })}>
                          <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue placeholder="Default" /></SelectTrigger>
                          <SelectContent className="bg-card border-border">
                            {[["none","Default"],["pcm_s16le","PCM 16-bit"],["mulaw","μ-law"],["alaw","A-law"],["mp3","MP3"],["opus","Opus"]].map(([v,l]) => <SelectItem key={v} value={v} className="text-foreground text-xs">{l}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div><p className="text-xs text-muted-foreground mb-1">Format</p>
                        <Select value={cfg.ttsAudioFormat ?? "none"} onValueChange={v => setCfg({ ttsAudioFormat: v === "none" ? undefined : v })}>
                          <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue placeholder="Default" /></SelectTrigger>
                          <SelectContent className="bg-card border-border">
                            {[["none","Default"],["wav","WAV"],["mp3","MP3"],["ogg","OGG"],["flac","FLAC"]].map(([v,l]) => <SelectItem key={v} value={v} className="text-foreground text-xs">{l}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <ToggleRow label="Stream Audio" desc="Enable streaming output for lower latency" checked={cfg.ttsStream ?? false} onChange={v => setCfg({ ttsStream: v })} />
                  </div>
                )}
              </div>
              {/* Telephony */}
              <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Telephony</p>
                <Select value={telephony} onValueChange={v => {
                  mark(setTelephony)(v);
                  const d = TELEPHONY_AUDIO_DEFAULTS[v];
                  if (d) setCfg({ ttsSamplingRate: d.samplingRate, ttsEncoding: d.encoding, ttsAudioFormat: d.format });
                }}>
                  <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue placeholder="Select provider" /></SelectTrigger>
                  <SelectContent className="bg-card border-border">{TELEPHONY_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-foreground text-xs">{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* ═══ KNOWLEDGE ══════════════════════════════════════════════ */}
          {activeTab === "knowledge" && (
            <div className="p-6 max-w-xl space-y-5">
              <div>
                <label className="block text-[10.5px] font-semibold uppercase tracking-[0.12em] mb-2 text-muted-foreground/60">Knowledge Base</label>
                <Select value={knowledgeBaseId?.toString() ?? "none"} onValueChange={v => { setKnowledgeBaseId(v === "none" ? null : parseInt(v)); setDirty(true); }}>
                  <SelectTrigger className="h-11 text-[14px] border"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="none" className="text-muted-foreground">— None —</SelectItem>
                    {(kbs ?? []).map(kb => <SelectItem key={kb.id} value={kb.id.toString()} className="text-foreground">{kb.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[11px] mt-1.5 text-muted-foreground/50">Relevant chunks are injected into the system prompt on every call.</p>
              </div>
              <div>
                <label className="block text-[10.5px] font-semibold uppercase tracking-[0.12em] mb-2 text-muted-foreground/60">Webhook URL <span className="normal-case font-normal text-muted-foreground/30">(optional)</span></label>
                <Input value={webhookUrl} onChange={e => { setWebhookUrl(e.target.value); setDirty(true); }} placeholder="https://your-server.com/webhook" className="h-11 text-[14px] border focus-visible:ring-0" />
                <p className="text-[11px] mt-1.5 text-muted-foreground/50">Fires a POST with call summary JSON after each call ends.</p>
              </div>
            </div>
          )}

          {/* ═══ TOOLS ══════════════════════════════════════════════════ */}
          {activeTab === "tools" && (
            <div className="px-5 py-4 max-w-2xl space-y-4">
              <div className="flex flex-wrap gap-2">
                {([
                  { label: "Call Transfer",    icon: PhoneForwarded, onClick: () => { setAgentTools(prev => [...prev, { type: "call_transfer" as const, name: "transfer_to_human", description: "Transfer the call to a human agent when the caller requests escalation.", transferTo: "", warmHandoffMessage: "" }]); setDirty(true); } },
                  { label: "End Call",         icon: PhoneOff,       onClick: () => { setAgentTools(prev => [...prev, { type: "end_call" as const, name: "end_call", description: "End the call when the conversation is complete.", goodbyeMessage: "" }]); setDirty(true); } },
                  { label: "Cal.com",          icon: Clock,          onClick: () => { setAgentTools(prev => [...prev, { type: "cal_com" as const, name: "book_appointment", description: "Book an appointment on Cal.com when the caller wants to schedule.", apiKey: "", eventTypeId: 0, timezone: "UTC" }]); setDirty(true); } },
                  { label: "Book Appointment", icon: CalendarPlus,   onClick: () => setBookingModal({ editIdx: null, calendarId: null, eventTypeId: null, timezone: "UTC", taskName: "book_appointment", description: "Book an appointment when the caller wants to schedule a meeting.", preToolMessage: "" }) },
                  { label: "Availability",     icon: CalendarCheck,  onClick: () => { setAgentTools(prev => [...prev, { type: "native_check_availability" as const, name: "check_availability", description: "Check available slots when the caller asks what times are open.", eventTypeId: 0 }]); setDirty(true); } },
                  { label: "Reschedule",       icon: CalendarClock,  onClick: () => { setAgentTools(prev => [...prev, { type: "native_reschedule" as const, name: "reschedule_appointment", description: "Reschedule an existing booking when the caller provides their booking reference." }]); setDirty(true); } },
                  { label: "Cancel Booking",   icon: CalendarX,      onClick: () => { setAgentTools(prev => [...prev, { type: "native_cancel" as const, name: "cancel_appointment", description: "Cancel an existing booking when the caller provides their booking reference." }]); setDirty(true); } },
                  { label: "Custom Function",  icon: Wrench,         onClick: () => { setAgentTools(prev => [...prev, { type: "webhook" as const, name: "custom_action", description: "Invoke this when the caller requests a specific action.", url: "", method: "POST" as const }]); setDirty(true); } },
                ] as { label: string; icon: React.ComponentType<{ className?: string }>; onClick: () => void }[]).map(btn => (
                  <button key={btn.label} type="button" onClick={btn.onClick}
                    className="flex items-center gap-1.5 text-xs bg-card border border-border text-foreground hover:bg-muted rounded-lg px-3 py-2 transition-colors">
                    <btn.icon className="h-3.5 w-3.5 text-muted-foreground/60" /> {btn.label}
                  </button>
                ))}
              </div>
              {agentTools.length === 0 && (
                <div className="bg-muted border border-border/40 rounded-xl p-8 flex flex-col items-center text-center gap-2">
                  <Settings2 className="h-8 w-8 text-muted-foreground/30" />
                  <p className="text-sm font-medium text-muted-foreground">No tools configured</p>
                  <p className="text-xs text-muted-foreground/60 max-w-sm">Add tools above — the AI decides when to invoke each based on the conversation context and description you provide.</p>
                </div>
              )}
              {agentTools.map((tool, idx) => (
                <div key={idx} className="bg-muted border border-border/40 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {tool.type === "call_transfer"            && <PhoneForwarded className="h-4 w-4 text-zinc-500" />}

                      {tool.type === "end_call"                 && <PhoneOff       className="h-4 w-4 text-muted-foreground" />}
                      {tool.type === "cal_com"                  && <Clock          className="h-4 w-4 text-zinc-400" />}
                      {tool.type === "webhook"                  && <Globe          className="h-4 w-4 text-muted-foreground" />}
                      {tool.type === "native_booking"           && <CalendarPlus   className="h-4 w-4 text-zinc-500" />}
                      {tool.type === "native_reschedule"        && <CalendarClock  className="h-4 w-4 text-zinc-500" />}
                      {tool.type === "native_cancel"            && <CalendarX      className="h-4 w-4 text-zinc-500" />}
                      {tool.type === "native_check_availability" && <CalendarCheck className="h-4 w-4 text-zinc-500" />}
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {tool.type === "call_transfer" ? "Call Transfer" : tool.type === "end_call" ? "End Call"
                          : tool.type === "cal_com" ? "Cal.com" : tool.type === "native_booking" ? "Book Appointment"
                          : tool.type === "native_reschedule" ? "Reschedule" : tool.type === "native_cancel" ? "Cancel Booking"
                          : tool.type === "native_check_availability" ? "Availability" : "Custom Function"}
                      </span>
                    </div>
                    <button type="button" onClick={() => { setAgentTools(prev => prev.filter((_, i) => i !== idx)); setDirty(true); }} className="text-muted-foreground hover:text-foreground transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Function Name</p>
                    <Input value={tool.name} onChange={e => { const n = [...agentTools]; n[idx] = { ...tool, name: e.target.value }; setAgentTools(n); setDirty(true); }} placeholder="snake_case_name" className="bg-card border-border text-foreground text-xs h-8" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Description</p>
                    <Textarea value={tool.description} onChange={e => { const n = [...agentTools]; n[idx] = { ...tool, description: e.target.value }; setAgentTools(n); setDirty(true); }} rows={2} className="bg-card border-border text-foreground text-xs resize-none" />
                  </div>
                  {tool.type === "call_transfer" && <>
                    <div className="space-y-1"><p className="text-xs text-muted-foreground">Transfer To (E.164)</p><Input value={tool.transferTo} onChange={e => { const n = [...agentTools]; n[idx] = { ...tool, transferTo: e.target.value }; setAgentTools(n); setDirty(true); }} placeholder="+12125551234" className="bg-card border-border text-foreground text-xs h-8" /></div>
                    <div className="space-y-1"><p className="text-xs text-muted-foreground">Warm Handoff Message</p><Textarea value={tool.warmHandoffMessage ?? ""} onChange={e => { const n = [...agentTools]; n[idx] = { ...tool, warmHandoffMessage: e.target.value }; setAgentTools(n); setDirty(true); }} rows={2} placeholder="Please hold while I connect you…" className="bg-card border-border text-foreground text-xs resize-none placeholder:text-muted-foreground" /></div>
                  </>}
                  {tool.type === "send_sms" && <div className="space-y-1"><p className="text-xs text-muted-foreground">Message Template</p><Textarea value={tool.messageTemplate} onChange={e => { const n = [...agentTools]; n[idx] = { ...tool, messageTemplate: e.target.value }; setAgentTools(n); setDirty(true); }} rows={3} placeholder="Hi! Here's your booking confirmation…" className="bg-card border-border text-foreground text-xs resize-none placeholder:text-muted-foreground" /></div>}
                  {tool.type === "end_call" && <div className="space-y-1"><p className="text-xs text-muted-foreground">Goodbye Message</p><Textarea value={tool.goodbyeMessage ?? ""} onChange={e => { const n = [...agentTools]; n[idx] = { ...tool, goodbyeMessage: e.target.value }; setAgentTools(n); setDirty(true); }} rows={2} placeholder="Thank you for calling! Have a great day." className="bg-card border-border text-foreground text-xs resize-none placeholder:text-muted-foreground" /></div>}
                  {tool.type === "cal_com" && <>
                    <div className="space-y-1"><p className="text-xs text-muted-foreground">Cal.com API Key</p><Input value={tool.apiKey} onChange={e => { const n = [...agentTools]; n[idx] = { ...tool, apiKey: e.target.value }; setAgentTools(n); setDirty(true); }} placeholder="cal_live_xxxxxxxxxxxx" type="password" className="bg-card border-border text-foreground text-xs h-8" /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1"><p className="text-xs text-muted-foreground">Event Type ID</p><Input value={tool.eventTypeId === 0 ? "" : String(tool.eventTypeId)} onChange={e => { const n = [...agentTools]; n[idx] = { ...tool, eventTypeId: parseInt(e.target.value) || 0 }; setAgentTools(n); setDirty(true); }} placeholder="123456" className="bg-card border-border text-foreground text-xs h-8" /></div>
                      <div className="space-y-1"><p className="text-xs text-muted-foreground">Default Timezone</p><Input value={tool.timezone ?? "UTC"} onChange={e => { const n = [...agentTools]; n[idx] = { ...tool, timezone: e.target.value }; setAgentTools(n); setDirty(true); }} placeholder="America/New_York" className="bg-card border-border text-foreground text-xs h-8" /></div>
                    </div>
                  </>}
                  {tool.type === "native_booking" && (() => {
                    const et = (eventTypes ?? []).find(e => e.id === tool.eventTypeId);
                    return <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div><p className="text-muted-foreground mb-0.5">Event Type</p><p className="text-foreground truncate">{et ? `${et.name} (${et.durationMinutes} min)` : <span className="italic text-muted-foreground">Not selected</span>}</p></div>
                        <div><p className="text-muted-foreground mb-0.5">Timezone</p><p className="text-foreground">{tool.timezone || "UTC"}</p></div>
                      </div>
                      <button type="button" onClick={() => {
                        setBookingModal({ editIdx: idx, calendarId: tool.calendarId ?? null, eventTypeId: tool.eventTypeId || null, timezone: tool.timezone ?? "UTC", taskName: tool.taskName ?? tool.name, description: tool.description, preToolMessage: tool.preToolMessage ?? "" });
                      }} className="text-xs text-foreground underline underline-offset-2 hover:text-foreground">Edit configuration</button>
                      {!tool.eventTypeId && <p className="text-[10px] text-muted-foreground">⚠ Event type not selected — booking will fail at runtime.</p>}
                    </div>;
                  })()}
                  {tool.type === "native_check_availability" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1"><p className="text-xs text-muted-foreground">Calendar</p>
                        <Select value={tool.calendarId ? String(tool.calendarId) : ""} onValueChange={v => { const n = [...agentTools]; n[idx] = { ...tool, calendarId: parseInt(v) || undefined, eventTypeId: 0 }; setAgentTools(n); setDirty(true); }}>
                          <SelectTrigger className="bg-card border-border text-foreground text-xs h-8"><SelectValue placeholder="Select calendar…" /></SelectTrigger>
                          <SelectContent>{(calendars ?? []).map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}{(calendars ?? []).length === 0 && <SelectItem value="0" disabled>No calendars — create one in Scheduling</SelectItem>}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1"><p className="text-xs text-muted-foreground">Event Type</p>
                        <Select value={tool.eventTypeId ? String(tool.eventTypeId) : ""} onValueChange={v => { const n = [...agentTools]; n[idx] = { ...tool, eventTypeId: parseInt(v) || 0 }; setAgentTools(n); setDirty(true); }} disabled={!tool.calendarId}>
                          <SelectTrigger className="bg-card border-border text-foreground text-xs h-8"><SelectValue placeholder={tool.calendarId ? "Select event type…" : "Pick a calendar first"} /></SelectTrigger>
                          <SelectContent>{(eventTypes ?? []).filter(et => !tool.calendarId || et.calendarId === tool.calendarId).map(et => <SelectItem key={et.id} value={String(et.id)}>{et.name} ({et.durationMinutes} min)</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                  {tool.type === "native_cancel" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1"><p className="text-xs text-muted-foreground">Calendar</p>
                        <Select value={tool.calendarId ? String(tool.calendarId) : ""} onValueChange={v => { const n = [...agentTools]; n[idx] = { ...tool, calendarId: parseInt(v) || undefined, eventTypeId: 0 }; setAgentTools(n); setDirty(true); }}>
                          <SelectTrigger className="bg-card border-border text-foreground text-xs h-8"><SelectValue placeholder="Select calendar…" /></SelectTrigger>
                          <SelectContent>{(calendars ?? []).map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}{(calendars ?? []).length === 0 && <SelectItem value="0" disabled>No calendars — create one in Scheduling</SelectItem>}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1"><p className="text-xs text-muted-foreground">Event Type (optional)</p>
                        <Select value={tool.eventTypeId ? String(tool.eventTypeId) : ""} onValueChange={v => { const n = [...agentTools]; n[idx] = { ...tool, eventTypeId: parseInt(v) || undefined }; setAgentTools(n); setDirty(true); }} disabled={!tool.calendarId}>
                          <SelectTrigger className="bg-card border-border text-foreground text-xs h-8"><SelectValue placeholder={tool.calendarId ? "Select event type…" : "Pick a calendar first"} /></SelectTrigger>
                          <SelectContent>{(eventTypes ?? []).filter(et => !tool.calendarId || et.calendarId === tool.calendarId).map(et => <SelectItem key={et.id} value={String(et.id)}>{et.name} ({et.durationMinutes} min)</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                  {tool.type === "webhook" && <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1"><p className="text-xs text-muted-foreground">Endpoint URL</p><Input value={tool.url} onChange={e => { const n = [...agentTools]; n[idx] = { ...tool, url: e.target.value }; setAgentTools(n); setDirty(true); }} placeholder="https://your-api.com/webhook" className="bg-card border-border text-foreground text-xs h-8" /></div>
                      <div className="space-y-1"><p className="text-xs text-muted-foreground">HTTP Method</p>
                        <Select value={tool.method} onValueChange={v => { const n = [...agentTools]; n[idx] = { ...tool, method: v as "GET" | "POST" }; setAgentTools(n); setDirty(true); }}>
                          <SelectTrigger className="bg-card border-border text-foreground text-xs h-8"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="GET">GET</SelectItem><SelectItem value="POST">POST</SelectItem></SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1"><p className="text-xs text-muted-foreground">Secret (X-Webhook-Secret, optional)</p><Input value={tool.secret ?? ""} onChange={e => { const n = [...agentTools]; n[idx] = { ...tool, secret: e.target.value }; setAgentTools(n); setDirty(true); }} placeholder="optional-shared-secret" type="password" className="bg-card border-border text-foreground text-xs h-8" /></div>
                  </>}
                </div>
              ))}
            </div>
          )}

          {/* ═══ PIPELINE ═══════════════════════════════════════════════ */}
          {activeTab === "pipeline" && (
            <div className="p-6 space-y-6 max-w-3xl">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50 mb-4">Voice Pipeline — click a node to configure</p>
                <div className="flex items-stretch gap-0">
                  {([
                    { id: "asr",       label: "Transcribe", note: "Speech → Text", sub: asrProvider || "not set",  icon: Mic },
                    { id: "llm",       label: "Think",      note: "LLM Reasoning", sub: llmProvider ? `${llmProvider}${llmModel ? ` · ${llmModel}` : ""}` : "not set", icon: Sparkles },
                    { id: "tts",       label: "Speak",      note: "Text → Speech", sub: ttsProvider || "not set",  icon: Volume2 },
                    { id: "telephony", label: "Deliver",    note: "Carrier",        sub: telephony || "not set",    icon: PhoneOutgoing },
                  ] as { id: string; label: string; note: string; sub: string; icon: React.ComponentType<{ className?: string }> }[]).map((node, i, arr) => (
                    <React.Fragment key={node.id}>
                      <button onClick={() => setActiveDrawer(activeDrawer === node.id ? null : node.id)}
                        className={"flex flex-col gap-2.5 px-5 py-4 rounded-2xl border transition-all text-left min-w-[150px] " +
                          (activeDrawer === node.id ? "bg-accent border-border shadow-sm" : "bg-card border-border hover:bg-accent/40")}>
                        <div className="flex items-center justify-between">
                          <div className="h-8 w-8 rounded-lg bg-elevated border border-border flex items-center justify-center">
                            <node.icon className="h-4 w-4 text-muted-foreground/50" />
                          </div>
                          {activeDrawer === node.id && <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/40" />}
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold text-foreground/80">{node.label}</p>
                          <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wide">{node.note}</p>
                        </div>
                        <p className="text-[10px] text-muted-foreground/60 capitalize font-mono truncate max-w-[130px]">{node.sub}</p>
                      </button>
                      {i < arr.length - 1 && <div className="flex items-center px-2 shrink-0"><ChevronRight className="h-4 w-4 text-muted-foreground/15" /></div>}
                    </React.Fragment>
                  ))}
                </div>
              </div>
              {/* Inline node drawer */}
              {activeDrawer && (
                <div className="bg-card border border-border rounded-2xl p-5 space-y-4 animate-fade-in">
                  {activeDrawer === "asr" && <>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">ASR / Transcriber</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div><p className="text-xs text-muted-foreground mb-1">Provider</p>
                        <Select value={asrProvider} onValueChange={v => { mark(setAsrProvider)(v); setAsrModel(ASR_MODELS[v]?.[0]?.value ?? ""); }}>
                          <SelectTrigger className="h-7 text-xs bg-muted border-border text-foreground"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-card border-border">{ASR_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-foreground text-xs">{p.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div><p className="text-xs text-muted-foreground mb-1">Model</p>
                        {asrModelOptions.length > 0
                          ? <Select value={asrModel} onValueChange={mark(setAsrModel)}><SelectTrigger className="h-7 text-xs bg-muted border-border text-foreground"><SelectValue /></SelectTrigger><SelectContent className="bg-card border-border">{asrModelOptions.map(m => <SelectItem key={m.value} value={m.value} className="text-foreground text-xs">{m.label}</SelectItem>)}</SelectContent></Select>
                          : <Input value={asrModel} onChange={e => { setAsrModel(e.target.value); setDirty(true); }} placeholder="Model name" className="h-7 text-xs" />}
                      </div>
                    </div>
                    <SliderRow label="Confidence Threshold" desc="Discard transcripts below this score" value={asrConfidenceThreshold} onChange={v => { setAsrConfidenceThreshold(v); setDirty(true); }} min={0} max={1} step={0.01} />
                    <SliderRow label="End-of-Turn Timeout" desc="Max wait after speech ends" value={asrEndOfTurnTimeout} onChange={v => { setAsrEndOfTurnTimeout(v); setDirty(true); }} min={500} max={10000} step={100} unit="ms" />
                    <ToggleRow label="Auto Fallback" desc="Switch to backup STT if primary fails" checked={asrAutoFallback} onChange={v => { setAsrAutoFallback(v); setDirty(true); }} />
                  </>}
                  {activeDrawer === "llm" && <>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">LLM / Brain</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div><p className="text-xs text-muted-foreground mb-1">Provider</p>
                        <Select value={llmProvider} onValueChange={v => { mark(setLlmProvider)(v); setLlmModel(LLM_MODELS[v]?.[0]?.value ?? ""); }}>
                          <SelectTrigger className="h-7 text-xs bg-muted border-border text-foreground"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-card border-border">{LLM_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-foreground text-xs">{p.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div><p className="text-xs text-muted-foreground mb-1">Model</p>
                        {llmModelOptions.length > 0
                          ? <Select value={llmModel} onValueChange={mark(setLlmModel)}><SelectTrigger className="h-7 text-xs bg-muted border-border text-foreground"><SelectValue /></SelectTrigger><SelectContent className="bg-card border-border">{llmModelOptions.map(m => <SelectItem key={m.value} value={m.value} className="text-foreground text-xs">{m.label}</SelectItem>)}</SelectContent></Select>
                          : <Input value={llmModel} onChange={e => { setLlmModel(e.target.value); setDirty(true); }} placeholder="Model name" className="h-7 text-xs" />}
                      </div>
                    </div>
                    <SliderRow label="Temperature" desc="Randomness — higher = more creative" value={temperature} onChange={v => { setTemperature(v); setDirty(true); }} min={0} max={2} step={0.01} />
                    <SliderRow label="Max Tokens" desc="Max tokens per LLM response" value={cfg.maxTokens ?? 200} onChange={v => setCfg({ maxTokens: v })} min={50} max={2000} step={10} />
                    <ToggleRow label="Request JSON Response" desc="Force model to output structured JSON" checked={cfg.requestJsonResponse ?? false} onChange={v => setCfg({ requestJsonResponse: v })} />
                  </>}
                  {activeDrawer === "tts" && <>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">TTS / Synthesizer</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div><p className="text-xs text-muted-foreground mb-1">Provider</p>
                        <Select value={ttsProvider} onValueChange={v => { mark(setTtsProvider)(v); setTtsModel(v === "cartesia" ? "sonic-2" : (TTS_MODELS[v]?.[0]?.value ?? "")); setTtsVoice(""); }}>
                          <SelectTrigger className="h-7 text-xs bg-muted border-border text-foreground"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-card border-border">{TTS_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-foreground text-xs">{p.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div><p className="text-xs text-muted-foreground mb-1">{ttsProvider === "cartesia" ? "Model" : "Voice / Model"}</p>
                        {ttsProvider === "cartesia"
                          ? <Select value={ttsModel || "sonic-2"} onValueChange={v => { setTtsModel(v); setDirty(true); }}><SelectTrigger className="h-7 text-xs bg-muted border-border text-foreground"><SelectValue /></SelectTrigger><SelectContent className="bg-card border-border">{TTS_MODELS.cartesia.map(m => <SelectItem key={m.value} value={m.value} className="text-foreground text-xs">{m.label}</SelectItem>)}</SelectContent></Select>
                          : TTS_MODELS[ttsProvider]
                            ? <Select value={ttsModel} onValueChange={mark(setTtsModel)}><SelectTrigger className="h-7 text-xs bg-muted border-border text-foreground"><SelectValue placeholder="Select voice" /></SelectTrigger><SelectContent className="bg-card border-border max-h-60">{TTS_MODELS[ttsProvider]!.map(m => <SelectItem key={m.value} value={m.value} className="text-foreground text-xs">{m.label}</SelectItem>)}</SelectContent></Select>
                            : <Input value={ttsModel} onChange={e => { setTtsModel(e.target.value); setDirty(true); }} placeholder="Voice / model" className="h-7 text-xs bg-muted border-border text-foreground" />}
                      </div>
                    </div>
                    {ttsProvider === "cartesia" && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Voice</p>
                        <div className="flex gap-2">
                          <Select value={ttsVoice || ARUSHI_VOICE.id} onValueChange={v => { setTtsVoice(v); setDirty(true); }}>
                            <SelectTrigger className="h-7 text-xs bg-muted border-border text-foreground flex-1"><SelectValue placeholder="Select voice" /></SelectTrigger>
                            <SelectContent className="bg-card border-border max-h-72">
                              {loadingCartesiaVoices ? <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
                                : cartesiaVoices.map(v => <SelectItem key={v.id} value={v.id} className="text-foreground text-xs">{v.name} · {langLabel(v.language)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <button type="button" onClick={() => void previewVoice(ttsVoice || ARUSHI_VOICE.id)}
                            className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md border border-border bg-card/70 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                            {voicePlaying === (ttsVoice || ARUSHI_VOICE.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Volume2 className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>
                    )}
                    <ToggleRow label="Stream Audio" desc="Enable streaming output for lower latency" checked={cfg.ttsStream ?? false} onChange={v => setCfg({ ttsStream: v })} />
                  </>}
                  {activeDrawer === "telephony" && <>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">Telephony / Carrier</p>
                    <div><p className="text-xs text-muted-foreground mb-1">Provider</p>
                      <Select value={telephony} onValueChange={v => {
                        mark(setTelephony)(v);
                        const d = TELEPHONY_AUDIO_DEFAULTS[v];
                        if (d) setCfg({ ttsSamplingRate: d.samplingRate, ttsEncoding: d.encoding, ttsAudioFormat: d.format });
                      }}>
                        <SelectTrigger className="h-7 text-xs bg-muted border-border text-foreground"><SelectValue placeholder="Select provider" /></SelectTrigger>
                        <SelectContent className="bg-card border-border">{TELEPHONY_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-foreground text-xs">{p.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    {telephony && TELEPHONY_AUDIO_DEFAULTS[telephony] && (
                      <div className="rounded-lg bg-zinc-950/40 border border-zinc-800/50 px-3 py-2.5">
                        <p className="text-xs text-zinc-300 font-medium">Audio auto-configured: {TELEPHONY_AUDIO_DEFAULTS[telephony]!.label}</p>
                        <p className="text-[11px] text-foreground/70 mt-0.5">{TELEPHONY_AUDIO_DEFAULTS[telephony]!.note}</p>
                      </div>
                    )}
                  </>}
                </div>
              )}
              {/* Advanced Settings accordion */}
              <div className="space-y-2">
                <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50 mb-1">Advanced Settings</p>
                {[
                  { id: "engine",    label: "Engine & Interruption",    desc: "Backchanneling, ambient noise, gender detection, end-call phrases" },
                  { id: "call",      label: "Call Behaviour",           desc: "Duration, recording, IVR, queue, scheduling, transfer" },
                  { id: "analytics", label: "Analytics & Summarization",desc: "Auto-summarize calls, disposition fields" },
                ].map(section => (
                  <button key={section.id} type="button" onClick={() => setActiveTab(section.id)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-card border border-border rounded-xl text-left hover:bg-accent/40 transition-colors">
                    <div>
                      <p className="text-[12px] font-medium text-foreground/70">{section.label}</p>
                      <p className="text-[10px] text-muted-foreground/40 mt-0.5">{section.desc}</p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ═══ ENGINE ═════════════════════════════════════════════════ */}
          {activeTab === "engine" && (
            <div className="px-5 py-4 max-w-2xl space-y-5">
              <button onClick={() => setActiveTab("pipeline")} className="text-[11px] text-muted-foreground/50 hover:text-foreground flex items-center gap-1 transition-colors"><ChevronRight className="h-3 w-3 rotate-180" /> Back to Pipeline</button>
              <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Interruption</p>
                <SliderRow label="Words for Interruption" desc="User words that trigger an agent interruption" value={cfg.wordsForInterruption ?? 2} onChange={v => setCfg({ wordsForInterruption: v })} min={1} max={10} step={1} />
                <SliderRow label="Incremental Delay" desc="Delay between LLM streaming chunks" value={cfg.incrementalDelay ?? 100} onChange={v => setCfg({ incrementalDelay: v })} min={0} max={2000} step={10} unit="ms" />
              </div>
              <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Backchanneling</p>
                <ToggleRow label="Backchanneling" desc={'Short acknowledgements while the LLM is thinking'} checked={backchannelingEnabled} onChange={v => { setBackchannelingEnabled(v); setDirty(true); }} />
                {backchannelingEnabled && <>
                  <SliderRow label="Frequency" desc="Probability of backchanneling per turn" value={backchannelingFrequency} onChange={v => { setBackchannelingFrequency(v); setDirty(true); }} min={0} max={1} step={0.01} />
                  <SliderRow label="Start Delay" desc="Wait before injecting backchannel audio" value={cfg.backchannelingStartDelay ?? 1.5} onChange={v => setCfg({ backchannelingStartDelay: v })} min={0} max={5} step={0.1} unit="s" />
                </>}
              </div>
              <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Ambient & Noise</p>
                <ToggleRow label="Ambient Noise" desc="Play background audio to make the call feel natural" checked={cfg.ambientNoiseEnabled ?? false} onChange={v => setCfg({ ambientNoiseEnabled: v })} />
                {cfg.ambientNoiseEnabled && <div><p className="text-xs text-muted-foreground mb-1">Track</p>
                  <Select value={cfg.ambientNoiseTrack ?? "office-ambience"} onValueChange={v => setCfg({ ambientNoiseTrack: v })}>
                    <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-card border-border">{["office-ambience","cafe","coffee-shop","convention-hall","home","outdoor","restaurant"].map(t => <SelectItem key={t} value={t} className="text-foreground text-xs capitalize">{t.replace(/-/g, " ")}</SelectItem>)}</SelectContent>
                  </Select>
                </div>}
                <ToggleRow label="Noise Cancellation" desc="Filter background noise from caller audio" checked={noiseCancellationEnabled} onChange={v => { setNoiseCancellationEnabled(v); setDirty(true); }} />
              </div>
              <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Caller Gender Detection</p>
                <ToggleRow label="Enable Gender Detection" desc="Detects vocal pitch and sets the {caller_salutation} variable" checked={cfg.genderDetectionEnabled ?? false} onChange={v => setCfg({ genderDetectionEnabled: v })} />
                {cfg.genderDetectionEnabled && <>
                  <div><p className="text-xs text-muted-foreground mb-1">Detection Provider</p>
                    <Select value={cfg.genderDetectionProvider ?? "deepgram"} onValueChange={v => setCfg({ genderDetectionProvider: v })}>
                      <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        {[["deepgram","Deepgram"],["assemblyai","AssemblyAI"],["azure","Azure Speaker Recognition"],["internal","SnapServe built-in (pitch analysis)"]].map(([v,l]) => <SelectItem key={v} value={v} className="text-foreground text-xs">{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div><p className="text-xs text-muted-foreground mb-1">Male</p><Input value={cfg.genderDetectionMaleSalutation ?? "sir"} onChange={e => setCfg({ genderDetectionMaleSalutation: e.target.value })} className="h-7 text-xs bg-card border-border text-foreground" /></div>
                    <div><p className="text-xs text-muted-foreground mb-1">Female</p><Input value={cfg.genderDetectionFemaleSalutation ?? "ma'am"} onChange={e => setCfg({ genderDetectionFemaleSalutation: e.target.value })} className="h-7 text-xs bg-card border-border text-foreground" /></div>
                    <div><p className="text-xs text-muted-foreground mb-1">Neutral</p><Input value={cfg.genderDetectionNeutralSalutation ?? ""} onChange={e => setCfg({ genderDetectionNeutralSalutation: e.target.value })} placeholder="(skip)" className="h-7 text-xs bg-card border-border text-foreground placeholder:text-muted-foreground" /></div>
                  </div>
                </>}
              </div>
              <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">End Call Phrases</p>
                <Textarea value={endCallPhrases} onChange={e => { setEndCallPhrases(e.target.value); setDirty(true); }} placeholder="goodbye, bye, thanks for calling" rows={2} className="bg-card border-border text-foreground text-xs resize-none placeholder:text-muted-foreground" />
                <p className="text-[10px] text-muted-foreground">Comma-separated phrases that trigger hangup when detected.</p>
              </div>
            </div>
          )}

          {/* ═══ CALL ═══════════════════════════════════════════════════ */}
          {activeTab === "call" && (
            <div className="px-5 py-4 max-w-2xl space-y-5">
              <button onClick={() => setActiveTab("pipeline")} className="text-[11px] text-muted-foreground/50 hover:text-foreground flex items-center gap-1 transition-colors"><ChevronRight className="h-3 w-3 rotate-180" /> Back to Pipeline</button>
              <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Duration & Silence</p>
                <SliderRow label="Max Call Duration" desc="Auto-terminate after this duration" value={maxDuration} onChange={v => { setMaxDuration(v); setDirty(true); }} min={30} max={3600} step={30} unit="s" />
                <SliderRow label="Hangup After Silence" desc="End call if caller is silent this long" value={silenceTimeout} onChange={v => { setSilenceTimeout(v); setDirty(true); }} min={5} max={120} step={5} unit="s" />
                <ToggleRow label="Hangup After LLM Call" desc="Hang up automatically when the LLM finishes responding" checked={cfg.hangupAfterLlmCall ?? false} onChange={v => setCfg({ hangupAfterLlmCall: v })} />
              </div>
              <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Timezone & Date</p>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Agent Timezone</p>
                  <p className="text-[10px] text-muted-foreground/60 mb-2">The current date and time are injected into the system prompt using this timezone, so the agent knows what day/time it is when speaking with callers.</p>
                  <Select value={cfg.timezone ?? "Asia/Kolkata"} onValueChange={v => { setCfg({ timezone: v }); setDirty(true); }}>
                    <SelectTrigger className="h-8 text-xs border bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-card border-border max-h-60">
                      {[
                        { label: "Asia/Kolkata (IST)", value: "Asia/Kolkata" },
                        { label: "Asia/Dubai (GST)", value: "Asia/Dubai" },
                        { label: "Asia/Singapore (SGT)", value: "Asia/Singapore" },
                        { label: "Asia/Tokyo (JST)", value: "Asia/Tokyo" },
                        { label: "Asia/Shanghai (CST)", value: "Asia/Shanghai" },
                        { label: "Asia/Seoul (KST)", value: "Asia/Seoul" },
                        { label: "Asia/Riyadh (AST)", value: "Asia/Riyadh" },
                        { label: "UTC", value: "UTC" },
                        { label: "Europe/London (GMT/BST)", value: "Europe/London" },
                        { label: "Europe/Paris (CET)", value: "Europe/Paris" },
                        { label: "Europe/Berlin (CET)", value: "Europe/Berlin" },
                        { label: "America/New_York (ET)", value: "America/New_York" },
                        { label: "America/Chicago (CT)", value: "America/Chicago" },
                        { label: "America/Denver (MT)", value: "America/Denver" },
                        { label: "America/Los_Angeles (PT)", value: "America/Los_Angeles" },
                        { label: "America/Sao_Paulo (BRT)", value: "America/Sao_Paulo" },
                        { label: "Australia/Sydney (AEST)", value: "Australia/Sydney" },
                        { label: "Pacific/Auckland (NZST)", value: "Pacific/Auckland" },
                      ].map(tz => (
                        <SelectItem key={tz.value} value={tz.value} className="text-foreground text-xs">{tz.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Messages</p>
                <div><p className="text-xs text-muted-foreground mb-1">Inactivity Message</p><Input value={inactivityMessage} onChange={e => { setInactivityMessage(e.target.value); setDirty(true); }} placeholder="Are you still there?" className="h-8 text-xs bg-card border-border text-foreground placeholder:text-muted-foreground" /></div>
              </div>
              <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Voicemail / AMD</p>
                <ToggleRow label="Voicemail Detection" desc="Detect answering machines on outbound calls" checked={cfg.voicemailDetection ?? false} onChange={v => setCfg({ voicemailDetection: v })} />
                {cfg.voicemailDetection && <>
                  <div className="grid grid-cols-2 gap-3">
                    <div><p className="text-xs text-muted-foreground mb-1">Detection mode</p>
                      <Select value={cfg.machineDetectionMode ?? "DetectMessageEnd"} onValueChange={v => setCfg({ machineDetectionMode: v as "Enable" | "DetectMessageEnd" })}>
                        <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border"><SelectItem value="DetectMessageEnd" className="text-foreground text-xs">Wait for beep</SelectItem><SelectItem value="Enable" className="text-foreground text-xs">Immediate detect</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div><p className="text-xs text-muted-foreground mb-1">When machine detected</p>
                      <Select value={cfg.voicemailAction ?? "hangup"} onValueChange={v => setCfg({ voicemailAction: v as "hangup" | "leave_message" | "continue" })}>
                        <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border"><SelectItem value="hangup" className="text-foreground text-xs">Hang up</SelectItem><SelectItem value="leave_message" className="text-foreground text-xs">Leave a message</SelectItem><SelectItem value="continue" className="text-foreground text-xs">Continue as human</SelectItem></SelectContent>
                      </Select>
                    </div>
                  </div>
                  {cfg.voicemailAction === "leave_message" && <div><p className="text-xs text-muted-foreground mb-1">Voicemail message</p><Textarea value={cfg.voicemailMessage ?? ""} onChange={e => setCfg({ voicemailMessage: e.target.value })} placeholder="Hi, this is a message from…" rows={2} className="bg-card border-border text-foreground text-xs resize-none placeholder:text-muted-foreground" /></div>}
                </>}
              </div>
              <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Call Recording</p>
                <ToggleRow label="Record Calls" desc="Save an audio recording of every call" checked={cfg.recordingEnabled ?? false} onChange={v => setCfg({ recordingEnabled: v })} />
                {cfg.recordingEnabled && <div className="w-40"><p className="text-xs text-muted-foreground mb-1">Format</p>
                  <Select value={cfg.recordingFormat ?? "mp3"} onValueChange={v => setCfg({ recordingFormat: v as "mp3" | "wav" })}>
                    <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-card border-border"><SelectItem value="mp3" className="text-foreground text-xs">MP3 (smaller)</SelectItem><SelectItem value="wav" className="text-foreground text-xs">WAV (lossless)</SelectItem></SelectContent>
                  </Select>
                </div>}
              </div>
              <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">IVR / DTMF</p>
                <ToggleRow label="Enable IVR Menu" desc="Play a key-press menu before connecting to this agent" checked={cfg.ivrEnabled ?? false} onChange={v => setCfg({ ivrEnabled: v })} />
                {cfg.ivrEnabled && <>
                  <div><p className="text-xs text-muted-foreground mb-1">Opening greeting</p><Input value={cfg.ivrGreeting ?? ""} onChange={e => setCfg({ ivrGreeting: e.target.value })} placeholder="Welcome! Please choose from the following options." className="h-7 text-xs bg-card border-border text-foreground placeholder:text-muted-foreground" /></div>
                  <div>
                    <div className="flex items-center justify-between mb-2"><p className="text-xs text-muted-foreground">Menu options</p><button type="button" onClick={() => setCfg({ ivrOptions: [...(cfg.ivrOptions ?? []), { digit: "", label: "" }] })} className="text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md border border-border">+ Add</button></div>
                    {(cfg.ivrOptions ?? []).map((opt, idx) => (
                      <div key={idx} className="flex gap-2 mb-1.5 items-center">
                        <Input value={opt.digit} onChange={e => { const opts = [...(cfg.ivrOptions ?? [])]; opts[idx] = { ...opts[idx], digit: e.target.value }; setCfg({ ivrOptions: opts }); }} placeholder="1" className="h-7 w-12 text-xs text-center bg-card border-border text-foreground shrink-0" maxLength={1} />
                        <Input value={opt.label} onChange={e => { const opts = [...(cfg.ivrOptions ?? [])]; opts[idx] = { ...opts[idx], label: e.target.value }; setCfg({ ivrOptions: opts }); }} placeholder="Sales" className="h-7 flex-1 text-xs bg-card border-border text-foreground placeholder:text-muted-foreground" />
                        <button type="button" onClick={() => setCfg({ ivrOptions: (cfg.ivrOptions ?? []).filter((_, i) => i !== idx) })} className="text-muted-foreground hover:text-foreground text-xs px-1">✕</button>
                      </div>
                    ))}
                  </div>
                </>}
              </div>
              <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Call Transfer</p>
                <ToggleRow label="Enable Call Transfer" desc="Allow this agent to transfer calls to another number" checked={cfg.callTransferEnabled ?? false} onChange={v => setCfg({ callTransferEnabled: v })} />
                {cfg.callTransferEnabled && <>
                  <div className="grid grid-cols-2 gap-3">
                    <div><p className="text-xs text-muted-foreground mb-1">Transfer type</p>
                      <Select value={cfg.callTransferType ?? "cold"} onValueChange={v => setCfg({ callTransferType: v as "warm" | "cold" })}>
                        <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border"><SelectItem value="cold" className="text-foreground text-xs">Cold — immediate blind</SelectItem><SelectItem value="warm" className="text-foreground text-xs">Warm — announce then transfer</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div><p className="text-xs text-muted-foreground mb-1">Default transfer number</p><Input value={cfg.callTransferNumber ?? ""} onChange={e => setCfg({ callTransferNumber: e.target.value })} placeholder="+12125551234" className="h-7 text-xs bg-card border-border text-foreground" /></div>
                  </div>
                  {cfg.callTransferType === "warm" && <div><p className="text-xs text-muted-foreground mb-1">Warm handoff message</p><Textarea value={cfg.callTransferWarmMessage ?? ""} onChange={e => setCfg({ callTransferWarmMessage: e.target.value })} placeholder="Please hold while I connect you with a specialist…" rows={2} className="bg-card border-border text-foreground text-xs resize-none placeholder:text-muted-foreground" /></div>}
                </>}
              </div>
            </div>
          )}

          {/* ═══ ANALYTICS ══════════════════════════════════════════════ */}
          {activeTab === "analytics" && (
            <div className="px-5 py-4 max-w-2xl space-y-5">
              <button onClick={() => setActiveTab("pipeline")} className="text-[11px] text-muted-foreground/50 hover:text-foreground flex items-center gap-1 transition-colors"><ChevronRight className="h-3 w-3 rotate-180" /> Back to Pipeline</button>
              <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Summarization</p>
                <ToggleRow label="Auto-Summarize Calls" desc="Generate a summary of each call transcript after the call ends" checked={cfg.summarizationEnabled ?? false} onChange={v => setCfg({ summarizationEnabled: v })} />
                {cfg.summarizationEnabled && <div><p className="text-xs text-muted-foreground mb-1">Summarization Prompt</p><Textarea value={cfg.summarizationPrompt ?? ""} onChange={e => setCfg({ summarizationPrompt: e.target.value })} placeholder="Summarize the key points, next steps, and any issues raised…" rows={4} className="bg-card border-border text-foreground text-xs resize-none placeholder:text-muted-foreground" /></div>}
              </div>
              <div className="bg-muted border border-border/40 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="h-3.5 w-3.5 text-foreground" />
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Disposition Fields</p>
                  </div>
                  <button type="button" onClick={() => { setDispositionSchema(prev => [...prev, { key: "", label: "", type: "text", required: false, options: "", description: "" }]); setDirty(true); }} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"><Plus className="h-3 w-3" /> Add Field</button>
                </div>
                {dispositionSchema.length === 0 ? (
                  <div className="px-4 py-4 space-y-1.5">
                    <p className="text-[11px] text-muted-foreground">No fields defined yet.</p>
                    <p className="text-[10px] text-muted-foreground/60">Disposition fields are automatically extracted from call transcripts by the AI after each call ends. For example: "Call Outcome" (choice: resolved / escalated / callback), "Customer Sentiment" (text), or "Appointment Booked" (yes/no).</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {dispositionSchema.map((field, i) => (
                      <div key={i} className="px-4 py-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <input value={field.key} onChange={e => { const n = [...dispositionSchema]; n[i] = { ...n[i]!, key: e.target.value }; setDispositionSchema(n); setDirty(true); }} placeholder="key_name" className="flex-1 h-7 rounded-md bg-card border border-border text-foreground text-xs px-2.5 placeholder:text-muted-foreground focus:outline-none" />
                          <input value={field.label} onChange={e => { const n = [...dispositionSchema]; n[i] = { ...n[i]!, label: e.target.value }; setDispositionSchema(n); setDirty(true); }} placeholder="Display Label" className="flex-1 h-7 rounded-md bg-card border border-border text-foreground text-xs px-2.5 placeholder:text-muted-foreground focus:outline-none" />
                          <Select value={field.type} onValueChange={v => { const n = [...dispositionSchema]; n[i] = { ...n[i]!, type: v }; setDispositionSchema(n); setDirty(true); }}>
                            <SelectTrigger className="h-7 w-24 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                            <SelectContent className="bg-card border-border"><SelectItem value="text" className="text-foreground text-xs">Text</SelectItem><SelectItem value="number" className="text-foreground text-xs">Number</SelectItem><SelectItem value="boolean" className="text-foreground text-xs">Yes / No</SelectItem><SelectItem value="choice" className="text-foreground text-xs">Choice</SelectItem></SelectContent>
                          </Select>
                          <button type="button" onClick={() => { setDispositionSchema(prev => prev.filter((_, j) => j !== i)); setDirty(true); }} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                        </div>
                        <input value={field.description ?? ""} onChange={e => { const n = [...dispositionSchema]; n[i] = { ...n[i]!, description: e.target.value }; setDispositionSchema(n); setDirty(true); }} placeholder="Instruction for AI — e.g. Identify whether the customer's issue was resolved, escalated, or requires a callback" className="w-full h-7 rounded-md bg-card border border-border text-foreground text-xs px-2.5 placeholder:text-muted-foreground focus:outline-none" />
                        {field.type === "choice" && <input value={field.options ?? ""} onChange={e => { const n = [...dispositionSchema]; n[i] = { ...n[i]!, options: e.target.value }; setDispositionSchema(n); setDirty(true); }} placeholder="Options: resolved, escalated, callback" className="w-full h-7 rounded-md bg-card border border-border text-foreground text-xs px-2.5 placeholder:text-muted-foreground focus:outline-none" />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══ TEST ═══════════════════════════════════════════════════ */}
          {activeTab === "test" && (
            <div className="p-5 max-w-lg">
              <WebCallPanel agentId={agentId} agentName={agentName || agent.name} />
            </div>
          )}

          {/* ═══ LOGS ═══════════════════════════════════════════════════ */}
          {activeTab === "logs" && (
            <div className="px-5 py-4 max-w-2xl space-y-2">
              {/* Summary metrics bar */}
              {(() => {
                const completed = (calls ?? []).filter(c => c.status === "completed" && c.durationSeconds);
                const totalMin = completed.reduce((s, c) => s + (c.durationSeconds ?? 0), 0) / 60;
                const cost = computePipelineCost(agent.asrProvider, agent.llmProvider, agent.llmModel, agent.ttsProvider, agent.telephonyProvider);
                const avgCost = totalMin > 0 ? cost.totalPerMin : 0;
                const avgStt = completed.filter(c => c.sttLatencyMs).reduce((s, c, _, arr) => s + (c.sttLatencyMs ?? 0) / arr.length, 0);
                const avgLlm = completed.filter(c => c.llmLatencyMs).reduce((s, c, _, arr) => s + (c.llmLatencyMs ?? 0) / arr.length, 0);
                const avgTts = completed.filter(c => c.ttsFirstChunkMs).reduce((s, c, _, arr) => s + (c.ttsFirstChunkMs ?? 0) / arr.length, 0);
                const hasAny = completed.length > 0 && (avgStt || avgLlm || avgTts);
                return (
                  <div className="flex gap-3 mb-4">
                    <div className="flex-1 bg-muted border border-border rounded-xl px-4 py-3 space-y-1.5">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[9px] font-bold tracking-[0.15em] uppercase text-muted-foreground">Avg Cost</span>
                        <span className="text-xs font-bold text-foreground tabular-nums ml-auto">~${avgCost.toFixed(2)}<span className="text-[10px] font-normal text-muted-foreground ml-0.5">/min</span></span>
                      </div>
                      <div className="flex items-center gap-2">
                        {([
                          { key: "asr", label: "ASR", val: cost.asr.costPerMin },
                          { key: "llm", label: "LLM", val: cost.llm.costPerMin },
                          { key: "tts", label: "TTS", val: cost.tts.costPerMin },
                          { key: "tel", label: "Tel", val: cost.telephony.costPerMin },
                          { key: "fee", label: "Fee", val: cost.platform.costPerMin },
                        ]).map(s => (
                          <span key={s.key} className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 inline-block opacity-80" />
                            {s.label}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex-1 bg-muted border border-border rounded-xl px-4 py-3 space-y-1.5">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[9px] font-bold tracking-[0.15em] uppercase text-muted-foreground">Avg Latency</span>
                        {hasAny ? (
                          <span className="text-xs font-bold text-foreground tabular-nums ml-auto">
                            {(() => {
                              const e2e = (avgStt || 0) + (avgLlm || 0) + (avgTts || 0);
                              return e2e >= 1000 ? `~${(e2e / 1000).toFixed(1)}s` : `~${Math.round(e2e)}ms`;
                            })()}
                            <span className="text-[10px] font-normal text-muted-foreground ml-0.5">e2e</span>
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground italic ml-auto">no data yet</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {([
                          { key: "stt", label: "STT", val: avgStt },
                          { key: "llm", label: "LLM", val: avgLlm },
                          { key: "tts", label: "TTS", val: avgTts },
                        ]).map(s => (
                          <span key={s.key} className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 inline-block opacity-80" />
                            {s.label} {s.val ? `${Math.round(s.val)}ms` : "\u2014"}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}
              {callsLoading ? (
                <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 w-full rounded-xl bg-muted animate-pulse" />)}</div>
              ) : (calls ?? []).length === 0 ? (
                <div className="py-12 text-center"><p className="text-sm text-muted-foreground/50">No calls yet</p></div>
              ) : (calls ?? []).map(call => (
                <div key={call.id} className="bg-card border border-border rounded-xl px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-mono text-muted-foreground/60">{call.fromNumber ?? `#${call.id}`}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                      call.status === "completed" ? "text-foreground/60 bg-foreground/[0.05] border-foreground/[0.07]" :
                      call.status === "failed"    ? "text-muted-foreground/60 bg-transparent border-border" :
                                                    "text-muted-foreground/40 bg-transparent border-border/50"
                    }`}>{call.status}</span>
                  </div>
                  {call.createdAt && <p className="text-[10px] text-muted-foreground/40 mt-0.5">{new Date(call.createdAt).toLocaleString()}</p>}
                </div>
              ))}
            </div>
          )}

        </div>
      </div>

      {/* ── Outbound call dialog ── */}
      <Dialog open={outboundDialogOpen} onOpenChange={setOutboundDialogOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2"><PhoneOutgoing className="h-4 w-4" /> Make a Call</DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              Dial a number using <span className="capitalize font-medium text-foreground">{agent.telephonyProvider || "your telephony provider"}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label className="text-muted-foreground text-xs">Destination number (E.164)</Label>
            <Input placeholder="+1234567890" value={toNumber} onChange={e => setToNumber(e.target.value)} className="bg-muted border-border text-foreground" />
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border text-muted-foreground" onClick={() => setOutboundDialogOpen(false)}>Cancel</Button>
            <Button className="bg-primary hover:opacity-90 text-primary-foreground" disabled={!toNumber.trim() || initiateOutbound.isPending}
              onClick={() => initiateOutbound.mutate(
                { data: { agentId: agent.id, toNumber: toNumber.trim(), webhookBaseUrl: window.location.origin } },
                {
                  onSuccess: () => { toast({ title: "Call initiated", description: `Dialing ${toNumber} via ${agent.name}.` }); setOutboundDialogOpen(false); setToNumber(""); },
                  onError: (err: unknown) => {
                    if (isKycError(err)) {
                      toast({ title: "Verification required", description: "Complete identity verification before making telephony calls.", variant: "destructive" });
                      navigate("/app/kyc");
                    } else if (isDestinationUnverifiedError(err)) {
                      setPendingCallNumber(toNumber.trim());
                      setOtpDialogOpen(true);
                    } else {
                      toast({ title: "Call failed", description: formatApiError(err), variant: "destructive" });
                    }
                  },
                }
              )}>
              {initiateOutbound.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Dialing…</> : <><PhoneOutgoing className="h-4 w-4 mr-2" /> Call Now</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DestinationOtpDialog
        open={otpDialogOpen}
        phoneNumber={pendingCallNumber}
        onClose={() => setOtpDialogOpen(false)}
        onVerified={() => {
          setOtpDialogOpen(false);
          initiateOutbound.mutate(
            { data: { agentId: agent?.id ?? 0, toNumber: pendingCallNumber, webhookBaseUrl: window.location.origin } },
            {
              onSuccess: () => { toast({ title: "Call initiated", description: `Dialing ${pendingCallNumber} via ${agent?.name}.` }); setOutboundDialogOpen(false); setToNumber(""); },
              onError: (err) => toast({ title: "Call failed", description: formatApiError(err), variant: "destructive" }),
            },
          );
        }}
      />

      {/* ── Book Appointment modal ── */}
      <Dialog open={bookingModal !== null} onOpenChange={open => { if (!open) setBookingModal(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CalendarPlus className="h-4 w-4 text-zinc-500" />{bookingModal?.editIdx == null ? "Add Book Appointment Tool" : "Edit Book Appointment Tool"}</DialogTitle>
            <DialogDescription>Configure how the AI books appointments using your inbuilt calendar.</DialogDescription>
          </DialogHeader>
          {bookingModal && (
            <div className="space-y-3 py-1">
              <div className="space-y-1">
                <Label className="text-xs">Calendar <span className="text-foreground">*</span></Label>
                <Select value={bookingModal.calendarId ? String(bookingModal.calendarId) : ""} onValueChange={v => {
                  setBookingModal({ ...bookingModal, calendarId: parseInt(v) || null, eventTypeId: null });
                }}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select a calendar…" /></SelectTrigger>
                  <SelectContent>
                    {(calendars ?? []).length === 0
                      ? <SelectItem value="__none" disabled>No calendars — create one in Scheduling</SelectItem>
                      : (calendars ?? []).map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)
                    }
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Event Type <span className="text-foreground">*</span></Label>
                <Select value={bookingModal.eventTypeId ? String(bookingModal.eventTypeId) : ""} onValueChange={v => setBookingModal({ ...bookingModal, eventTypeId: parseInt(v) || null })} disabled={!bookingModal.calendarId || modalEventTypesLoading}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder={!bookingModal.calendarId ? "Pick a calendar first" : modalEventTypesLoading ? "Loading…" : "Select an event type…"} /></SelectTrigger>
                  <SelectContent>
                    {(modalEventTypes ?? []).map(et => <SelectItem key={et.id} value={String(et.id)}>{et.name} ({et.durationMinutes} min)</SelectItem>)}
                    {bookingModal.calendarId && !modalEventTypesLoading && (modalEventTypes ?? []).length === 0 && <SelectItem value="__none" disabled>No event types for this calendar</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Timezone</Label>
                <Select value={bookingModal.timezone} onValueChange={v => setBookingModal({ ...bookingModal, timezone: v })}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{["UTC","America/New_York","America/Chicago","America/Denver","America/Los_Angeles","Europe/London","Europe/Paris","Asia/Kolkata","Asia/Singapore","Asia/Tokyo","Australia/Sydney"].map(tz => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label className="text-xs">Task Name</Label><Input value={bookingModal.taskName} onChange={e => setBookingModal({ ...bookingModal, taskName: e.target.value })} placeholder="book_appointment" className="h-9 text-sm" /></div>
              <div className="space-y-1"><Label className="text-xs">Description</Label><Textarea value={bookingModal.description} onChange={e => setBookingModal({ ...bookingModal, description: e.target.value })} rows={2} placeholder="Tells the AI when to call this tool." className="text-sm resize-none" /></div>
              <div className="space-y-1"><Label className="text-xs">Pre-tool Message</Label><Input value={bookingModal.preToolMessage} onChange={e => setBookingModal({ ...bookingModal, preToolMessage: e.target.value })} placeholder="e.g. Sure, let me book that for you…" className="h-9 text-sm" /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBookingModal(null)}>Cancel</Button>
            <Button onClick={() => {
              if (!bookingModal) return;
              if (!bookingModal.calendarId) { toast({ title: "Calendar is required", variant: "destructive" }); return; }
              if (!bookingModal.eventTypeId) { toast({ title: "Event type is required", variant: "destructive" }); return; }
              const taskName = (bookingModal.taskName || "book_appointment").trim();
              const next: AgentToolLocal = { type: "native_booking", name: taskName, description: bookingModal.description || "Book an appointment when the caller wants to schedule a meeting.", eventTypeId: bookingModal.eventTypeId, calendarId: bookingModal.calendarId, timezone: bookingModal.timezone, taskName, preToolMessage: bookingModal.preToolMessage || undefined };
              setAgentTools(prev => { if (bookingModal.editIdx == null) return [...prev, next]; const copy = [...prev]; copy[bookingModal.editIdx] = next; return copy; });
              setDirty(true); setBookingModal(null);
              toast({ title: bookingModal.editIdx == null ? "Booking tool added" : "Booking tool updated" });
            }}>Save Configuration</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────────────────────── */

export default function AssistantsPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pendingTab, setPendingTab] = useState<string | undefined>(undefined);
  const [search, setSearch]         = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: agents, isLoading } = useListAgents({
    query: { queryKey: getListAgentsQueryKey() },
  });

  // Select first agent automatically
  useEffect(() => {
    if (agents?.length && selectedId === null) {
      setSelectedId(agents[0]!.id);
    }
  }, [agents]);

  const filtered = agents?.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.asrProvider.toLowerCase().includes(search.toLowerCase()) ||
    a.llmProvider.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Agents List Panel ─────────────────────────────────────── */}
      <div className="w-[272px] shrink-0 flex flex-col border-r border-border bg-sidebar">

        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 h-14 shrink-0 border-b border-border">
          <span className="font-semibold text-[13.5px] flex-1 text-foreground">
            Assistants
          </span>
          {agents && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md tabular-nums border border-border bg-elevated text-muted-foreground/60">
              {agents.length}
            </span>
          )}
          <button
            onClick={() => setDialogOpen(true)}
            title="Create assistant"
            className="h-7 w-7 flex items-center justify-center rounded-lg transition-colors border border-border bg-elevated text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Create button */}
        <div className="px-3 pt-3 pb-2 shrink-0">
          <button
            onClick={() => setDialogOpen(true)}
            className="w-full flex items-center justify-center gap-2 h-9 rounded-xl text-[12.5px] font-medium transition-colors border border-dashed border-border/60 bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50 hover:border-border"
          >
            <Plus className="h-3.5 w-3.5" /> Create Assistant
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pb-3 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
            <input
              placeholder="Search assistants…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 rounded-xl text-[12.5px] outline-none transition-colors border border-border bg-card text-foreground placeholder:text-muted-foreground/40 focus:border-muted-foreground/40"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-px">
          {isLoading ? (
            <div className="space-y-1.5 p-1">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-[60px] rounded-xl animate-pulse bg-elevated" />
              ))}
            </div>
          ) : filtered?.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-muted-foreground/50">
              No assistants found.
            </div>
          ) : (
            filtered?.map(agent => {
              const isSelected = selectedId === agent.id;
              const tags = [agent.asrProvider, agent.llmProvider, agent.ttsProvider].map(providerTag);
              return (
                <button
                  key={agent.id}
                  onClick={() => setSelectedId(agent.id)}
                  className={
                    "w-full text-left px-3 py-2.5 rounded-xl transition-colors border " +
                    (isSelected
                      ? "bg-accent border-border/80"
                      : "bg-transparent border-transparent hover:bg-accent/40 hover:border-border/40")
                  }
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    {statusDot(agent.status)}
                    <span className={
                      "text-[12.5px] font-medium truncate " +
                      (isSelected ? "text-foreground" : "text-foreground/70")
                    }>
                      {agent.name}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 ml-3.5">
                    {tags.map(t => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-md bg-elevated border border-border/60 text-muted-foreground/60">
                        {t}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Config / Editor Panel ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {selectedId !== null ? (
          <AgentConfigPanel key={selectedId} agentId={selectedId} initialTab={pendingTab} onDeleted={() => { setPendingTab(undefined); setSelectedId(agents?.[0]?.id ?? null); }} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
            <div className="h-16 w-16 rounded-2xl flex items-center justify-center bg-elevated border border-border">
              <Mic className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <div>
              <p className="text-[14px] font-semibold text-muted-foreground/60">No assistant selected</p>
              <p className="text-[12px] mt-1 text-muted-foreground/40">Choose one from the list or create a new one.</p>
            </div>
            <button
              onClick={() => setDialogOpen(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-medium border border-border bg-elevated text-foreground/80 hover:text-foreground hover:bg-accent transition-colors"
            >
              <Plus className="h-4 w-4" /> Create Assistant
            </button>
          </div>
        )}
      </div>

      <CreateAgentDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={(id) => { setPendingTab("prompt"); setSelectedId(id); }}
      />
    </div>
  );
}
