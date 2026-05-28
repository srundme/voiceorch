import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@clerk/react";
import { useLocation } from "wouter";
import {
  Search, Plus, Phone, Mic, MicOff, PhoneOff, Volume2,
  Settings2, MoreHorizontal, Pencil, Trash2, PlayCircle,
  Check, Copy, Loader2, ChevronDown, Sparkles, PhoneOutgoing,
  BarChart2, Clock, CheckCircle2, XCircle, BookOpen,
  AlertTriangle, Target, AlignLeft, Zap, RefreshCw, ClipboardList, X,
  PhoneForwarded, Globe, CalendarPlus, CalendarClock, CalendarX, CalendarCheck, Wrench,
} from "lucide-react";
import { CreateAgentWizard } from "@/components/create-agent-wizard";
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
import { formatApiError } from "@/lib/format-api-error";
import { format } from "date-fns";
import { AgentMetricsBar } from "@/components/agent-metrics-bar";

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
  sarvam:     [{ value: "saarika:v2.5", label: "Saarika v2.5" }, { value: "saarika:flash", label: "Saarika Flash" }],
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
  if (status === "active")   return <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 shrink-0" />;
  if (status === "inactive") return <span className="h-1.5 w-1.5 rounded-full bg-muted shrink-0" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 shrink-0" />;
}

/* ── Web Call Panel ──────────────────────────────────────────────────────── */

type CallStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "ended";
interface Msg { speaker: "user" | "agent"; text: string }

function WebCallPanel({ agentId, agentName }: { agentId: number; agentName: string }) {
  const [status, setStatus]     = useState<CallStatus>("idle");
  const [msgs, setMsgs]         = useState<Msg[]>([]);
  const [error, setError]       = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [copied, setCopied]     = useState(false);

  const wsRef          = useRef<WebSocket | null>(null);
  const audioCtxRef    = useRef<AudioContext | null>(null);
  const processorRef   = useRef<ScriptProcessorNode | null>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const nextPlayRef    = useRef(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
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
      const ws = new WebSocket(`${proto}://${location.host}/api/ws/webcall/${agentId}`);
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

  const embedCode = `<script src="${location.protocol}//${location.host}/api/widget.js"\n        data-agent-id="${agentId}"\n        data-name="${agentName}"\n        data-color="#a1a1aa">\n</script>`;

  const sc: Record<CallStatus, { label: string; color: string; pulse: boolean }> = {
    idle:       { label: "Ready to test",  color: "bg-muted",    pulse: false },
    connecting: { label: "Connecting…",    color: "bg-zinc-400",   pulse: true  },
    listening:  { label: "Listening…",     color: "bg-zinc-400", pulse: true  },
    thinking:   { label: "Thinking…",      color: "bg-zinc-400",   pulse: true  },
    speaking:   { label: "Speaking…",      color: "bg-zinc-400",     pulse: true  },
    ended:      { label: "Call ended",     color: "bg-muted",    pulse: false },
  };
  const s = sc[status];
  const isActive = status !== "idle" && status !== "ended";

  return (
    <div className="space-y-4">
      {/* Status */}
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-muted/50 border border-border">
        <span className={`w-2 h-2 rounded-full shrink-0 ${s.color} ${s.pulse ? "animate-pulse" : ""}`} />
        <span className="text-sm text-foreground">{s.label}</span>
        {status === "ended" && duration !== null && (
          <span className="text-xs text-muted-foreground ml-auto">
            {Math.floor(duration / 60)}m {duration % 60}s
          </span>
        )}
      </div>

      {error && (
        <div className="text-sm text-foreground bg-muted border border-border rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Transcript */}
      <div ref={transcriptRef} className="h-48 overflow-y-auto space-y-2 pr-1">
        {msgs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground gap-2">
            <Volume2 className="h-7 w-7 opacity-30" />
            <p className="text-xs">Transcript will appear here.</p>
          </div>
        ) : msgs.map((m, i) => (
          <div key={i} className={`flex ${m.speaker === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm ${
              m.speaker === "user"
                ? "bg-primary text-primary-foreground rounded-br-sm"
                : "bg-transparent text-foreground border border-border rounded-bl-sm"
            }`}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                {m.speaker === "user" ? "You" : agentName}
              </p>
              {m.text}
            </div>
          </div>
        ))}
      </div>

      {/* Controls */}
      {!isActive ? (
        <Button className="w-full gap-2 bg-primary hover:opacity-90 text-primary-foreground" onClick={() => void startCall()}>
          <Mic className="h-4 w-4" /> Start Test Call
        </Button>
      ) : (
        <Button variant="destructive" className="w-full gap-2" onClick={endCall}>
          <PhoneOff className="h-4 w-4" /> End Call
        </Button>
      )}

      {/* Embed snippet */}
      <div className="mt-2">
        <p className="text-xs text-muted-foreground mb-1.5">Embed on your website</p>
        <pre className="bg-muted border border-border rounded-lg px-3 py-2.5 text-[11px] font-mono text-muted-foreground overflow-x-auto whitespace-pre">
          {embedCode}
        </pre>
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 h-7 text-xs text-muted-foreground hover:text-foreground gap-1.5 px-2"
          onClick={() => { navigator.clipboard.writeText(embedCode); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        >
          {copied ? <><Check className="h-3 w-3 text-foreground" /> Copied</> : <><Copy className="h-3 w-3" /> Copy snippet</>}
        </Button>
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

const PREVIEW_TEXT = "Hello! I'm your AI voice assistant. How can I help you today?";

function AgentConfigPanel({ agentId, onDeleted }: { agentId: number; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("agent");
  const [outboundDialogOpen, setOutboundDialogOpen] = useState(false);
  const [toNumber, setToNumber] = useState("");

  const { data: agent, isLoading } = useGetAgent(agentId, {
    query: { queryKey: getGetAgentQueryKey(agentId) },
  });

  const { data: calls, isLoading: callsLoading } = useListCalls(
    { agentId },
    { query: { enabled: activeTab === "logs" || activeTab === "agent", queryKey: getListCallsQueryKey({ agentId }) } }
  );

  const update          = useUpdateAgent();
  const toggleAgent     = useToggleAgent();
  const deleteAgent     = useDeleteAgent();
  const initiateOutbound = useInitiateOutboundCall();
  const { data: kbs } = useListKnowledgeBases();
  const { data: eventTypes } = useListEventTypes();
  const { data: calendars } = useListCalendars();

  // ── Google calendars for the Book Appointment dropdown ────────────────
  type GoogleCalEntry = {
    connectionId: string;
    connectionEmail: string;
    googleCalendarId: string;
    summary: string;
    primary: boolean;
    schedulingCalendarId: number | null;
  };
  const [googleCals, setGoogleCals] = useState<GoogleCalEntry[] | null>(null);
  const [googleCalsLoading, setGoogleCalsLoading] = useState(false);

  // ── Booking-tool modal state (Tools tab) ───────────────────────────────
  const [bookingModal, setBookingModal] = useState<null | {
    editIdx: number | null;
    calendarId: number | null;        // scheduling_calendars.id (used for event types + saving)
    googleCalendarKey: string | null; // connectionId|googleCalendarId (what the dropdown selects)
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
  const [greetingMessage, setGreetingMessage]               = useState("");
  const [webhookUrl, setWebhookUrl]                         = useState("");
  const [knowledgeBaseId, setKnowledgeBaseId]               = useState<number | null>(null);

  // ── Tab 2 — LLM ─────────────────────────────────────────────────
  const [llmProvider, setLlmProvider]                       = useState("");
  const [llmModel, setLlmModel]                             = useState("");
  const [temperature, setTemperature]                       = useState(0.7);

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
  const [asrAutoFallback, setAsrAutoFallback]               = useState(false);
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
  const [backchannelingEnabled, setBackchannelingEnabled]   = useState(false);
  const [backchannelingFrequency, setBackchannelingFrequency] = useState(0.3);
  const [noiseCancellationEnabled, setNoiseCancellationEnabled] = useState(false);
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

  // ── Google sub-calendar loader (for Book Appointment dropdown) ───
  useEffect(() => {
    let cancelled = false;
    setGoogleCalsLoading(true);
    apiFetch("/api/scheduling/google/calendars")
      .then(r => r.ok ? r.json() as Promise<GoogleCalEntry[]> : null)
      .then(data => { if (!cancelled) setGoogleCals(data ?? []); })
      .catch(() => { if (!cancelled) setGoogleCals([]); })
      .finally(() => { if (!cancelled) setGoogleCalsLoading(false); });
    return () => { cancelled = true; };
  }, [apiFetch]);

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
        body: JSON.stringify({ voiceId, text: PREVIEW_TEXT, modelId: ttsModel || "sonic-3.5" }),
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
      const utt = new SpeechSynthesisUtterance(PREVIEW_TEXT);
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
  const [dispositionSchema, setDispositionSchema]           = useState<Array<{ key: string; label: string; type: string; required?: boolean; options?: string }>>([]);

  // ── Advanced (agentConfig JSONB) covers LLM/Audio/Engine/Call/Analytics/Inbound/WhatsApp advanced fields
  const [agentConfig, setAgentConfig]                       = useState<AgentCfg>({});

  const [dirty, setDirty]                                   = useState(false);

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
    setGreetingMessage(agent.greetingMessage ?? "");
    setWebhookUrl((agent.webhookUrl ?? "") as string);
    setKnowledgeBaseId(agent.knowledgeBaseId ?? null);
    setLlmProvider(agent.llmProvider ?? "");
    setLlmModel(agent.llmModel ?? "");
    setTemperature((agent.temperature ?? 0.7) as number);
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
    setAsrAutoFallback(agent.asrAutoFallback ?? false);
    setTtsProvider(agent.ttsProvider ?? "");
    setTtsModel(agent.ttsModel ?? (agent.ttsProvider === "cartesia" ? "sonic-2" : ""));
    setTtsVoice((agent as unknown as Record<string, unknown>).ttsVoice as string ?? "");
    setTelephony(agent.telephonyProvider ?? "");
    setBackchannelingEnabled(agent.backchannelingEnabled ?? false);
    setBackchannelingFrequency((agent.backchannelingFrequency ?? 0.3) as number);
    setNoiseCancellationEnabled(agent.noiseCancellationEnabled ?? false);
    setEndCallPhrases(agent.endCallPhrases ?? "");
    setInactivityMessage(agent.inactivityMessage ?? "");
    setMaxDuration((agent.maxDuration ?? 300) as number);
    setSilenceTimeout((agent.silenceTimeoutSeconds ?? 30) as number);
    setDispositionSchema(
      ((a.dispositionSchema as Array<{ key: string; label: string; type: string; required?: boolean; options?: string[] }> | undefined) ?? [])
        .map(f => ({ ...f, options: f.options?.join(", ") ?? "" }))
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

  const TABS = [
    { value: "agent",     label: "Agent" },
    { value: "llm",       label: "LLM" },
    { value: "audio",     label: "Audio" },
    { value: "engine",    label: "Engine" },
    { value: "call",      label: "Call" },
    { value: "tools",     label: "Tools" },
    { value: "analytics", label: "Analytics" },
    { value: "inbound",   label: "Inbound" },
    { value: "whatsapp",  label: "WhatsApp" },
    { value: "logs",      label: "Logs" },
    { value: "test",      label: "Test" },
  ];

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden animate-fade-in">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-6 h-14 shrink-0" style={{ borderBottom: "1px solid #E5E7EB" }}>
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-semibold text-[15px] truncate" style={{ color: "#111827" }}>{agentName || agent.name}</span>
          <span className="text-[10px] font-mono hidden sm:flex items-center px-1.5 py-0.5 rounded-md" style={{ background: "#F3F4F6", color: "#9CA3AF" }}>
            #{String(agent.id).padStart(4, "0")}
          </span>
          {statusDot(agent.status)}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {dirty && (
            <Button size="sm" className="h-8 text-xs gap-1.5 text-white border-0 transition-all" onClick={handleSave} disabled={update.isPending}
              style={{ background: "#374151", boxShadow: "0 0 16px #374151" }}>
              {update.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 transition-all" onClick={() => setOutboundDialogOpen(true)}
            style={{ borderColor: "#E5E7EB", color: "#4B5563", background: "#F9FAFB" }}>
            <PhoneOutgoing className="h-3 w-3" /> Call
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 transition-colors"
                style={{ color: "#6B7280" }}>
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

      {/* ── Stats row ── */}
      <div className="flex items-center gap-3 px-6 py-3 shrink-0" style={{ borderBottom: "1px solid #F3F4F6", background: "#FAFAFA" }}>
        {[
          { icon: Phone,         val: String(agent.totalCalls ?? 0),                                                label: "calls",   color: "#4B5563" },
          { icon: CheckCircle2,  val: `${successRate}%`,                                                             label: "success", color: "#a1a1aa" },
          ...(agent.avgDurationSeconds != null ? [{ icon: Clock, val: `~${agent.avgDurationSeconds}s`, label: "avg", color: "#a1a1aa" }] : []),
        ].map(({ icon: Icon, val, label, color }) => (
          <div key={label} className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: "#F9FAFB", border: "1px solid #F3F4F6" }}>
            <Icon className="h-3 w-3 shrink-0" style={{ color }} />
            <span className="text-[13px] font-bold tabular-nums" style={{ color: "#111827" }}>{val}</span>
            <span className="text-[11px]" style={{ color: "#9CA3AF" }}>{label}</span>
          </div>
        ))}
      </div>

      {/* ── Latency bar ── */}
      <AgentMetricsBar
        asrProvider={agent.asrProvider}
        llmProvider={agent.llmProvider}
        llmModel={agent.llmModel}
        ttsProvider={agent.ttsProvider}
        telephonyProvider={agent.telephonyProvider}
        avgSttLatencyMs={agent.avgSttLatencyMs}
        avgLlmLatencyMs={agent.avgLlmLatencyMs}
        avgTtsFirstChunkMs={agent.avgTtsFirstChunkMs}
      />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="shrink-0 overflow-x-auto" style={{ borderBottom: "1px solid #E5E7EB" }}>
          <TabsList className="w-max min-w-full justify-start rounded-none bg-transparent px-4 h-10 gap-0">
            {TABS.map(t => (
              <TabsTrigger key={t.value} value={t.value}
                className="h-10 rounded-none border-b-2 border-transparent bg-transparent px-3.5 text-[12.5px] font-medium shadow-none transition-colors whitespace-nowrap data-[state=active]:shadow-none"
                style={{
                  color: activeTab === t.value ? "#111827" : "#9CA3AF",
                  borderBottomColor: activeTab === t.value ? "#374151" : "transparent",
                }}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* ═══════════ TAB CONTENTS ═══════════ */}

        {/* ── Tab 1: Agent ── */}
        <TabsContent value="agent" className="flex-1 overflow-hidden m-0">
          <div className="flex h-full">
            {/* ── Left: form ── */}
            <div className="flex-1 overflow-y-auto px-8 py-6">
              <div className="max-w-[560px] space-y-5">

                {/* Agent Name */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] mb-2" style={{ color: "#9CA3AF" }}>
                    Agent Name
                  </label>
                  <Input value={agentName} onChange={e => { setAgentName(e.target.value); setDirty(true); }}
                    className="h-11 text-[14px] border transition-all focus-visible:ring-0"
                    style={{ background: "#F9FAFB", borderColor: "#E5E7EB", color: "#111827" }} />
                </div>

                {/* Agent Type */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] mb-2" style={{ color: "#9CA3AF" }}>
                    Agent Type
                  </label>
                  <Select value={agentType} onValueChange={mark(setAgentType)}>
                    <SelectTrigger className="h-11 text-[14px] border transition-all focus-visible:ring-0"
                      style={{ background: "#F9FAFB", borderColor: "#E5E7EB", color: "#374151" }}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      <SelectItem value="general" className="text-foreground">General Purpose</SelectItem>
                      <SelectItem value="lead_qualification" className="text-foreground">Lead Qualification</SelectItem>
                      <SelectItem value="customer_support" className="text-foreground">Customer Support</SelectItem>
                      <SelectItem value="appointment_booking" className="text-foreground">Appointment Booking</SelectItem>
                      <SelectItem value="survey" className="text-foreground">Survey</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Welcome Message */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] mb-2" style={{ color: "#9CA3AF" }}>
                    Welcome Message
                  </label>
                  <Textarea value={greetingMessage} onChange={e => { setGreetingMessage(e.target.value); setDirty(true); }}
                    placeholder="First thing the agent says when a call connects"
                    className="text-[14px] border resize-none min-h-[80px] leading-relaxed transition-all focus-visible:ring-0"
                    style={{ background: "#F9FAFB", borderColor: "#E5E7EB", color: "#1F2937", padding: "12px 14px" }} />
                </div>

                {/* Agent Prompt */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "#9CA3AF" }}>
                      Agent Prompt
                    </label>
                    <button type="button"
                      className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg transition-all"
                      style={{ color: "#374151", background: "#F9FAFB", border: "1px solid #E5E7EB" }}
                      onClick={() => { setSystemPrompt("You are a helpful and professional AI voice assistant. Be concise, clear, and friendly in all responses."); setDirty(true); }}>
                      <Sparkles className="h-3 w-3" /> Generate
                    </button>
                  </div>
                  <Textarea value={systemPrompt} onChange={e => { setSystemPrompt(e.target.value); setDirty(true); }}
                    placeholder="You are a helpful AI voice assistant…"
                    className="text-[14px] border resize-none min-h-[180px] leading-relaxed transition-all focus-visible:ring-0"
                    style={{ background: "#F9FAFB", borderColor: "#E5E7EB", color: "#1F2937", padding: "12px 14px" }} />
                  <div className="flex flex-wrap gap-2 mt-3">
                    <span className="text-[11px] self-center" style={{ color: "#9CA3AF" }}>Insert variable:</span>
                    {[
                      { var: "{caller_salutation}", tip: "sir / ma'am — requires Gender Detection in Engine tab", color: "zinc" },
                      { var: "{caller_number}",     tip: "Caller's phone number",                                color: "zinc"    },
                      { var: "{agent_name}",         tip: "This agent's name",                                   color: "zinc"},
                      { var: "{date}",               tip: "Current date",                                        color: "zinc"  },
                    ].map(chip => (
                      <button
                        key={chip.var}
                        type="button"
                        title={chip.tip}
                        onClick={() => { setSystemPrompt(p => p + " " + chip.var); setDirty(true); }}
                        className={`text-[11px] rounded-lg border px-2.5 py-1 font-mono transition-all ${
                          chip.color === "zinc" ? "bg-muted border-border text-muted-foreground hover:border-border" :
                          chip.color === "zinc"    ? "bg-zinc-950/50 border-zinc-700/40 text-zinc-300 hover:border-zinc-600/60" :
                          chip.color === "zinc"? "bg-zinc-950/50 border-zinc-700/40 text-zinc-300 hover:border-zinc-600/60" :
                                                    "bg-zinc-950/50 border-zinc-700/40 text-zinc-300 hover:border-zinc-600/60"
                        }`}
                      >
                        {chip.var}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Webhook URL */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] mb-2" style={{ color: "#9CA3AF" }}>
                    Webhook URL <span className="normal-case font-normal" style={{ color: "#D1D5DB" }}>(optional)</span>
                  </label>
                  <Input value={webhookUrl} onChange={e => { setWebhookUrl(e.target.value); setDirty(true); }}
                    placeholder="https://your-server.com/webhook"
                    className="h-11 text-[14px] border transition-all focus-visible:ring-0"
                    style={{ background: "#F9FAFB", borderColor: "#E5E7EB", color: "#374151" }} />
                  <p className="text-[11px] mt-1.5" style={{ color: "#9CA3AF" }}>Fires a POST with call summary JSON after each call ends.</p>
                </div>

                {/* Knowledge Base */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] mb-2" style={{ color: "#9CA3AF" }}>
                    Knowledge Base
                  </label>
                  <Select value={knowledgeBaseId?.toString() ?? "none"} onValueChange={v => { setKnowledgeBaseId(v === "none" ? null : parseInt(v)); setDirty(true); }}>
                    <SelectTrigger className="h-11 text-[14px] border transition-all focus-visible:ring-0"
                      style={{ background: "#F9FAFB", borderColor: "#E5E7EB", color: "#374151" }}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      <SelectItem value="none" className="text-muted-foreground">— None —</SelectItem>
                      {(kbs ?? []).map(kb => <SelectItem key={kb.id} value={kb.id.toString()} className="text-foreground">{kb.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] mt-1.5" style={{ color: "#9CA3AF" }}>Relevant chunks are injected into the system prompt on every call.</p>
                </div>
              </div>
            </div>

            {/* ── Right: analytics panel ── */}
            <div className="w-[280px] shrink-0 overflow-y-auto p-4 space-y-3"
              style={{ borderLeft: "1px solid #F3F4F6", background: "#FAFAFA" }}>

              {/* Agent Status card */}
              <div className="rounded-2xl p-4 space-y-3"
                style={{ background: "#F9FAFB", border: "1px solid #E5E7EB" }}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "#6B7280" }}>Agent Status</span>
                  <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${agent.status === "active" ? "text-foreground" : "text-muted-foreground"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${agent.status === "active" ? "bg-zinc-500" : "bg-muted"}`} />
                    {agent.status === "active" ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {[
                    { label: "Total calls",  value: String(agent.totalCalls ?? 0), accent: "#4B5563" },
                    { label: "Success rate", value: `${successRate}%`,              accent: "#a1a1aa" },
                    { label: "Avg duration", value: agent.avgDurationSeconds != null ? `~${agent.avgDurationSeconds}s` : "—", accent: "#a1a1aa" },
                  ].map(row => (
                    <div key={row.label}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px]" style={{ color: "#6B7280" }}>{row.label}</span>
                        <span className="text-[12px] font-bold tabular-nums" style={{ color: row.accent }}>{row.value}</span>
                      </div>
                      {row.label === "Success rate" && (
                        <div className="h-1 rounded-full overflow-hidden" style={{ background: "#F3F4F6" }}>
                          <div className="h-full rounded-full transition-all" style={{ width: `${successRate}%`, background: "linear-gradient(90deg, #a1a1aa, #d4d4d8)" }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Provider Stack card */}
              <div className="rounded-2xl p-4 space-y-3"
                style={{ background: "#FAFAFA", border: "1px solid #E5E7EB" }}>
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "#6B7280" }}>Provider Stack</span>
                <div className="space-y-2">
                  {[
                    { label: "ASR",       value: agent.asrProvider,       color: "#a1a1aa" },
                    { label: "LLM",       value: agent.llmProvider,       color: "#a1a1aa" },
                    { label: "TTS",       value: agent.ttsProvider,       color: "#d4d4d8" },
                    { label: "Telephony", value: agent.telephonyProvider, color: "#d4d4d8" },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between py-1.5 px-3 rounded-lg"
                      style={{ background: "#FAFAFA" }}>
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#9CA3AF" }}>{row.label}</span>
                      <span className="text-[12px] font-semibold capitalize" style={{ color: row.color }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Calls card */}
              <div className="rounded-2xl p-4 space-y-3"
                style={{ background: "#FAFAFA", border: "1px solid #E5E7EB" }}>
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "#6B7280" }}>Recent Calls</span>
                {callsLoading ? (
                  <div className="space-y-2">
                    {[1,2,3].map(i => <div key={i} className="h-8 rounded-lg animate-pulse" style={{ background: "#F9FAFB" }} />)}
                  </div>
                ) : !calls?.length ? (
                  <p className="text-[12px] italic" style={{ color: "#D1D5DB" }}>No calls yet</p>
                ) : (
                  <div className="space-y-1.5">
                    {calls.slice(0, 5).map(call => (
                      <div key={call.id} className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg"
                        style={{ background: "#FAFAFA" }}>
                        <span className="text-[11.5px] font-mono truncate flex-1" style={{ color: "#6B7280" }}>
                          {call.fromNumber ?? `#${call.id}`}
                        </span>
                        <span className={`text-[11px] font-bold shrink-0 px-1.5 py-0.5 rounded ${
                          call.status === "completed" ? "text-foreground bg-muted" :
                          call.status === "failed"    ? "text-foreground bg-muted" :
                                                        "text-muted-foreground bg-muted"
                        }`}>
                          {call.status === "completed" ? "OK" : call.status === "failed" ? "Fail" : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── Tab 2: LLM ── */}
        <TabsContent value="llm" className="flex-1 overflow-y-auto m-0 px-5 py-4">
          <div className="max-w-2xl space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted border border-border rounded-xl p-3.5 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Provider</p>
                <Select value={llmProvider} onValueChange={v => { mark(setLlmProvider)(v); setLlmModel(LLM_MODELS[v]?.[0]?.value ?? ""); }}>
                  <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {LLM_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-foreground text-xs">{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="bg-muted border border-border rounded-xl p-3.5 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Model</p>
                {llmModelOptions.length > 0
                  ? <Select value={llmModel} onValueChange={mark(setLlmModel)}>
                      <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        {llmModelOptions.map(m => <SelectItem key={m.value} value={m.value} className="text-foreground text-xs">{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  : <Input value={llmModel} onChange={e => { setLlmModel(e.target.value); setDirty(true); }} placeholder="Model name"
                      className="h-7 text-xs bg-card border-border text-foreground" />
                }
              </div>
            </div>
            <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Sampling Parameters</p>
              <SliderRow label="Temperature" desc="Randomness — higher = more creative" value={temperature} onChange={v => { setTemperature(v); setDirty(true); }} min={0} max={2} step={0.01} />
              <SliderRow label="Max Tokens" desc="Maximum tokens in the LLM response" value={cfg.maxTokens ?? 200} onChange={v => setCfg({ maxTokens: v })} min={50} max={2000} step={10} />
              <ToggleRow label="Request JSON Response" desc="Force model to output structured JSON" checked={cfg.requestJsonResponse ?? false} onChange={v => setCfg({ requestJsonResponse: v })} />
            </div>
            <div className="bg-muted border border-border/40 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Guardrail Routes</p>
                <button type="button" onClick={() => setCfg({ guardrailRoutes: [...(cfg.guardrailRoutes ?? []), { name: "", scoreThreshold: 0.8, utterances: "", response: "" }] })}
                  className="text-[11px] text-foreground hover:text-zinc-300 flex items-center gap-1">
                  <Plus className="h-3 w-3" /> Add Route
                </button>
              </div>
              {!(cfg.guardrailRoutes?.length) ? (
                <p className="text-[11px] text-muted-foreground px-4 py-3">No guardrail routes. Add routes to intercept specific user intents.</p>
              ) : (
                <div className="divide-y divide-border">
                  {cfg.guardrailRoutes!.map((route, i) => (
                    <div key={i} className="px-4 py-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <input value={route.name} onChange={e => { const r = [...cfg.guardrailRoutes!]; r[i] = { ...r[i]!, name: e.target.value }; setCfg({ guardrailRoutes: r }); }}
                          placeholder="Route name" className="flex-1 h-7 rounded-md bg-card border border-border text-foreground text-xs px-2.5 placeholder:text-muted-foreground focus:outline-none focus:border-[#ACADB1]" />
                        <button type="button" onClick={() => setCfg({ guardrailRoutes: cfg.guardrailRoutes!.filter((_, j) => j !== i) })} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                      </div>
                      <SliderRow label={`Score threshold: ${route.scoreThreshold.toFixed(2)}`} value={route.scoreThreshold}
                        onChange={v => { const r = [...cfg.guardrailRoutes!]; r[i] = { ...r[i]!, scoreThreshold: v }; setCfg({ guardrailRoutes: r }); }} min={0} max={1} step={0.01} />
                      <textarea value={route.utterances} onChange={e => { const r = [...cfg.guardrailRoutes!]; r[i] = { ...r[i]!, utterances: e.target.value }; setCfg({ guardrailRoutes: r }); }}
                        placeholder="Sample utterances (one per line)" rows={2}
                        className="w-full rounded-md bg-card border border-border text-foreground text-xs px-2.5 py-1.5 placeholder:text-muted-foreground focus:outline-none focus:border-[#ACADB1] resize-none" />
                      <input value={route.response} onChange={e => { const r = [...cfg.guardrailRoutes!]; r[i] = { ...r[i]!, response: e.target.value }; setCfg({ guardrailRoutes: r }); }}
                        placeholder="Response to send when triggered"
                        className="w-full h-7 rounded-md bg-card border border-border text-foreground text-xs px-2.5 placeholder:text-muted-foreground focus:outline-none focus:border-[#ACADB1]" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── Tab 3: Audio ── */}
        <TabsContent value="audio" className="flex-1 overflow-y-auto m-0 px-5 py-4">
          <div className="max-w-2xl space-y-5">
            {(() => {
              const effectiveSecondary: string[] = cfg.secondaryLanguages
                ?? (cfg.secondaryLanguage ? [cfg.secondaryLanguage] : []);
              const displaySecondary: string[] = effectiveSecondary.length >= 2
                ? effectiveSecondary.slice(0, 2)
                : effectiveSecondary.length === 1
                  ? [effectiveSecondary[0]]
                  : [""];
              const hasTwoSlots = displaySecondary.length === 2;
              const cols = hasTwoSlots ? "grid-cols-3" : "grid-cols-2";

              function updateSecondary(index: number, value: string) {
                const next = [...displaySecondary];
                next[index] = value === "none" ? "" : value;
                const filtered = next.filter(Boolean);
                setCfg({
                  secondaryLanguages: filtered,
                  secondaryLanguage: filtered[0] ?? undefined,
                });
              }

              return (
                <div className={`grid ${cols} gap-3`}>
                  <div className="bg-muted border border-border rounded-xl p-3.5 space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Primary Language</p>
                    <Select value={asrLanguage} onValueChange={mark(setAsrLanguage)}>
                      <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-card border-border max-h-60">
                        {LANGUAGES.map(l => <SelectItem key={l.value} value={l.value} className="text-foreground text-xs">{l.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {displaySecondary.map((lang, idx) => (
                    <div key={idx} className="bg-muted border border-border rounded-xl p-3.5 space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        {hasTwoSlots ? `Secondary Language ${idx + 1}` : "Secondary Language"}
                      </p>
                      <Select value={lang || "none"} onValueChange={v => updateSecondary(idx, v)}>
                        <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border max-h-60">
                          <SelectItem value="none" className="text-muted-foreground text-xs">— None —</SelectItem>
                          {LANGUAGES.map(l => <SelectItem key={l.value} value={l.value} className="text-foreground text-xs">{l.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              );
            })()}
            <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Transcriber</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Provider</p>
                  <Select value={asrProvider} onValueChange={v => { mark(setAsrProvider)(v); setAsrModel(ASR_MODELS[v]?.[0]?.value ?? ""); }}>
                    <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {ASR_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-foreground text-xs">{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Model</p>
                  {asrModelOptions.length > 0
                    ? <Select value={asrModel} onValueChange={mark(setAsrModel)}>
                        <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          {asrModelOptions.map(m => <SelectItem key={m.value} value={m.value} className="text-foreground text-xs">{m.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    : <Input value={asrModel} onChange={e => { setAsrModel(e.target.value); setDirty(true); }} placeholder="Model name"
                        className="h-7 text-xs bg-card border-border text-foreground" />
                  }
                </div>
              </div>
              <SliderRow label="Confidence Threshold" desc="Discard transcripts below this score" value={asrConfidenceThreshold}
                onChange={v => { setAsrConfidenceThreshold(v); setDirty(true); }} min={0} max={1} step={0.01} />
              <SliderRow label="End-of-Turn Timeout" desc="Max wait after speech before finishing a turn" value={asrEndOfTurnTimeout}
                onChange={v => { setAsrEndOfTurnTimeout(v); setDirty(true); }} min={500} max={10000} step={100} unit="ms" />
              <ToggleRow label="Background Denoising" desc="Filter background noise from the caller's audio" checked={asrBackgroundDenoising}
                onChange={v => { setAsrBackgroundDenoising(v); setDirty(true); }} />
              <ToggleRow label="Auto Fallback" desc="Automatically pick a backup STT provider if primary fails" checked={asrAutoFallback}
                onChange={v => { setAsrAutoFallback(v); setDirty(true); }} />
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
                <Textarea value={asrKeyterms} onChange={e => { setAsrKeyterms(e.target.value); setDirty(true); }}
                  placeholder="e.g. SnapServe, API, webhook" rows={2}
                  className="bg-card border-border text-foreground text-xs resize-none placeholder:text-muted-foreground" />
              </div>
            </div>
            <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Synthesizer</p>

              {ttsProvider === "cartesia" ? (
                <div className="space-y-3">
                  {/* Provider row */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Provider</p>
                      <Select value={ttsProvider} onValueChange={v => { mark(setTtsProvider)(v); setTtsModel(v === "cartesia" ? "sonic-2" : (TTS_MODELS[v]?.[0]?.value ?? "")); setTtsVoice(""); }}>
                        <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          {TTS_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-foreground text-xs">{p.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Model</p>
                      <Select value={ttsModel || "sonic-2"} onValueChange={v => { setTtsModel(v); setDirty(true); }}>
                        <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          {TTS_MODELS.cartesia.map(m => <SelectItem key={m.value} value={m.value} className="text-foreground text-xs">{m.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {/* Voice row with preview */}
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Voice</p>
                    <div className="flex gap-2">
                      <Select
                        value={ttsVoice || ARUSHI_VOICE.id}
                        onValueChange={v => { setTtsVoice(v); setDirty(true); }}
                      >
                        <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground flex-1">
                          <SelectValue placeholder={loadingCartesiaVoices ? "Loading voices…" : "Select voice"} />
                        </SelectTrigger>
                        <SelectContent className="bg-card border-border max-h-72">
                          {loadingCartesiaVoices
                            ? <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
                            : cartesiaVoices.map(v => (
                                <SelectItem key={v.id} value={v.id} className="text-foreground text-xs">
                                  <span className="flex items-center gap-1.5">
                                    {v.name}
                                    <span className="text-muted-foreground text-[10px]">· {langLabel(v.language)}</span>
                                  </span>
                                </SelectItem>
                              ))
                          }
                        </SelectContent>
                      </Select>
                      <button
                        type="button"
                        title="Preview voice"
                        onClick={() => void previewVoice(ttsVoice || ARUSHI_VOICE.id)}
                        className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md border border-border bg-card/70 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {voicePlaying === (ttsVoice || ARUSHI_VOICE.id)
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Volume2 className="h-3.5 w-3.5" />
                        }
                      </button>
                    </div>
                    {cartesiaVoiceSource === "fallback" && !loadingCartesiaVoices && (
                      <p className="text-[10px] text-foreground/70 mt-1">Configure Cartesia key in Admin → Managed Keys to see all Indian voices</p>
                    )}
                    {ttsVoice && cartesiaVoiceSource === "cartesia" && (
                      <p className="text-[10px] text-muted-foreground mt-1 font-mono truncate">{ttsVoice}</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Provider</p>
                    <Select value={ttsProvider} onValueChange={v => { mark(setTtsProvider)(v); setTtsModel(TTS_MODELS[v]?.[0]?.value ?? ""); setTtsVoice(""); }}>
                      <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        {TTS_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-foreground text-xs">{p.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Voice / Model</p>
                    {TTS_MODELS[ttsProvider]
                      ? <Select value={ttsModel} onValueChange={mark(setTtsModel)}>
                          <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue placeholder="Select voice" /></SelectTrigger>
                          <SelectContent className="bg-card border-border max-h-60">
                            {TTS_MODELS[ttsProvider]!.map(m => <SelectItem key={m.value} value={m.value} className="text-foreground text-xs">{m.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      : <Input value={ttsModel} onChange={e => { setTtsModel(e.target.value); setDirty(true); }} placeholder="Voice / model name"
                          className="h-7 text-xs bg-card border-border text-foreground" />
                    }
                  </div>
                </div>
              )}
              {/* ── Auto-config banner ── */}
              {telephony && TELEPHONY_AUDIO_DEFAULTS[telephony] ? (
                <div className="rounded-lg bg-zinc-950/40 border border-zinc-800/50 px-3 py-2.5 flex items-start gap-2.5">
                  <Check className="h-3.5 w-3.5 text-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-zinc-300 font-medium">
                      Auto-configured for {TELEPHONY_PROVIDERS.find(p => p.value === telephony)?.label}
                    </p>
                    <p className="text-[11px] text-foreground mt-0.5">
                      {TELEPHONY_AUDIO_DEFAULTS[telephony]!.label} · {TELEPHONY_AUDIO_DEFAULTS[telephony]!.note}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAudioAdvanced(v => !v)}
                    className="text-[11px] text-muted-foreground hover:text-foreground whitespace-nowrap shrink-0 mt-0.5"
                  >
                    {audioAdvanced ? "Hide advanced" : "Advanced"}
                  </button>
                </div>
              ) : (
                <div className="rounded-lg bg-card border border-border px-3 py-2.5 flex items-center justify-between">
                  <p className="text-[11px] text-muted-foreground">Select a telephony provider above to auto-configure audio.</p>
                  <button
                    type="button"
                    onClick={() => setAudioAdvanced(v => !v)}
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {audioAdvanced ? "Hide" : "Manual setup"}
                  </button>
                </div>
              )}

              {/* ── Advanced knobs (hidden by default) ── */}
              {audioAdvanced && (
                <div className="space-y-3 pt-1 border-t border-border/40">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Sampling Rate</p>
                      <Input type="number" value={cfg.ttsSamplingRate ?? ""} onChange={e => setCfg({ ttsSamplingRate: parseInt(e.target.value) || undefined })}
                        placeholder="e.g. 8000" className="h-7 text-xs bg-card border-border text-foreground placeholder:text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Encoding</p>
                      <Select value={cfg.ttsEncoding ?? "none"} onValueChange={v => setCfg({ ttsEncoding: v === "none" ? undefined : v })}>
                        <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue placeholder="Default" /></SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          <SelectItem value="none" className="text-muted-foreground text-xs">Default</SelectItem>
                          <SelectItem value="pcm_s16le" className="text-foreground text-xs">PCM 16-bit LE</SelectItem>
                          <SelectItem value="mulaw" className="text-foreground text-xs">μ-law</SelectItem>
                          <SelectItem value="alaw" className="text-foreground text-xs">A-law</SelectItem>
                          <SelectItem value="mp3" className="text-foreground text-xs">MP3</SelectItem>
                          <SelectItem value="opus" className="text-foreground text-xs">Opus</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Format</p>
                      <Select value={cfg.ttsAudioFormat ?? "none"} onValueChange={v => setCfg({ ttsAudioFormat: v === "none" ? undefined : v })}>
                        <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue placeholder="Default" /></SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          <SelectItem value="none" className="text-muted-foreground text-xs">Default</SelectItem>
                          <SelectItem value="wav" className="text-foreground text-xs">WAV</SelectItem>
                          <SelectItem value="mp3" className="text-foreground text-xs">MP3</SelectItem>
                          <SelectItem value="ogg" className="text-foreground text-xs">OGG</SelectItem>
                          <SelectItem value="flac" className="text-foreground text-xs">FLAC</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <ToggleRow label="Stream Audio" desc="Enable streaming output for lower latency" checked={cfg.ttsStream ?? false} onChange={v => setCfg({ ttsStream: v })} />
                </div>
              )}
            </div>
            <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Telephony</p>
              <Select
                value={telephony}
                onValueChange={v => {
                  mark(setTelephony)(v);
                  const d = TELEPHONY_AUDIO_DEFAULTS[v];
                  if (d) {
                    setCfg({ ttsEncoding: d.encoding, ttsSamplingRate: d.samplingRate, ttsAudioFormat: d.format, ttsStream: d.stream });
                    setAudioAdvanced(false);
                  }
                }}
              >
                <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {TELEPHONY_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-foreground text-xs">{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </TabsContent>

        {/* ── Tab 4: Engine ── */}
        <TabsContent value="engine" className="flex-1 overflow-y-auto m-0 px-5 py-4">
          <div className="max-w-2xl space-y-5">
            <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Interruption</p>
              <SliderRow label="Words for Interruption" desc="How many user words trigger an interruption" value={cfg.wordsForInterruption ?? 2}
                onChange={v => setCfg({ wordsForInterruption: v })} min={1} max={10} step={1} />
              <SliderRow label="Incremental Delay" desc="Delay between LLM streaming chunks" value={cfg.incrementalDelay ?? 100}
                onChange={v => setCfg({ incrementalDelay: v })} min={0} max={2000} step={10} unit="ms" />
            </div>
            <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Backchanneling</p>
              <ToggleRow label="Backchanneling" desc={'Short acknowledgements ("mm-hmm", "I see") while the LLM is thinking'}
                checked={backchannelingEnabled} onChange={v => { setBackchannelingEnabled(v); setDirty(true); }} />
              {backchannelingEnabled && (
                <>
                  <SliderRow label="Frequency" desc="Probability of backchanneling on each turn"
                    value={backchannelingFrequency} onChange={v => { setBackchannelingFrequency(v); setDirty(true); }} min={0} max={1} step={0.01} />
                  <SliderRow label="Start Delay" desc="Wait before injecting backchannel audio"
                    value={cfg.backchannelingStartDelay ?? 1.5} onChange={v => setCfg({ backchannelingStartDelay: v })} min={0} max={5} step={0.1} unit="s" />
                </>
              )}
            </div>
            <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Ambient &amp; Noise</p>
              <ToggleRow label="Ambient Noise" desc="Play background audio to make the call feel natural"
                checked={cfg.ambientNoiseEnabled ?? false} onChange={v => setCfg({ ambientNoiseEnabled: v })} />
              {cfg.ambientNoiseEnabled && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Track</p>
                  <Select value={cfg.ambientNoiseTrack ?? "office-ambience"} onValueChange={v => setCfg({ ambientNoiseTrack: v })}>
                    <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {["office-ambience","cafe","coffee-shop","convention-hall","home","outdoor","restaurant"].map(t => (
                        <SelectItem key={t} value={t} className="text-foreground text-xs capitalize">{t.replace(/-/g, " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <ToggleRow label="Noise Cancellation" desc="Filter background noise from caller audio"
                checked={noiseCancellationEnabled} onChange={v => { setNoiseCancellationEnabled(v); setDirty(true); }} />
            </div>
            {/* ── Gender Detection ── */}
            <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-zinc-950/60 border border-zinc-800/40 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-zinc-300">G</span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground">Caller Gender Detection</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                    Analyse the caller's voice within the first few seconds and inject <code className="bg-muted text-muted-foreground rounded px-1 py-px">{"{caller_salutation}"}</code> into your agent prompt — automatically addressing them as <em>sir</em> or <em>ma'am</em>.
                  </p>
                </div>
              </div>
              <ToggleRow
                label="Enable Gender Detection"
                desc="Detects vocal pitch/formants from the first speech turn and sets the salutation variable"
                checked={cfg.genderDetectionEnabled ?? false}
                onChange={v => setCfg({ genderDetectionEnabled: v })}
              />
              {cfg.genderDetectionEnabled && (
                <>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Detection Provider</p>
                    <Select value={cfg.genderDetectionProvider ?? "deepgram"} onValueChange={v => setCfg({ genderDetectionProvider: v })}>
                      <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        <SelectItem value="deepgram" className="text-foreground text-xs">Deepgram (voice type signal)</SelectItem>
                        <SelectItem value="assemblyai" className="text-foreground text-xs">AssemblyAI (speaker analysis)</SelectItem>
                        <SelectItem value="azure" className="text-foreground text-xs">Azure Speaker Recognition</SelectItem>
                        <SelectItem value="internal" className="text-foreground text-xs">SnapServe built-in (pitch analysis)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Male salutation</p>
                      <Input value={cfg.genderDetectionMaleSalutation ?? "sir"}
                        onChange={e => setCfg({ genderDetectionMaleSalutation: e.target.value })}
                        className="h-7 text-xs bg-card border-border text-foreground" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Female salutation</p>
                      <Input value={cfg.genderDetectionFemaleSalutation ?? "ma'am"}
                        onChange={e => setCfg({ genderDetectionFemaleSalutation: e.target.value })}
                        className="h-7 text-xs bg-card border-border text-foreground" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Neutral / unknown</p>
                      <Input value={cfg.genderDetectionNeutralSalutation ?? ""}
                        onChange={e => setCfg({ genderDetectionNeutralSalutation: e.target.value })}
                        placeholder="(skip)"
                        className="h-7 text-xs bg-card border-border text-foreground placeholder:text-muted-foreground" />
                    </div>
                  </div>
                  <div className="rounded-lg bg-zinc-950/30 border border-zinc-800/40 px-3 py-2.5 space-y-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">How to use in your prompt</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Add <code className="bg-muted text-muted-foreground rounded px-1">{"{caller_salutation}"}</code> anywhere in your Agent Prompt. At call start it will be replaced with the detected value.
                    </p>
                    <p className="text-[11px] text-muted-foreground italic mt-1">
                      Example: <span className="not-italic text-muted-foreground">"Good morning, {"{caller_salutation}"}! How can I help you today?"</span>
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">End Call Phrases</p>
              <Textarea value={endCallPhrases} onChange={e => { setEndCallPhrases(e.target.value); setDirty(true); }}
                placeholder="goodbye, bye, thanks for calling" rows={2}
                className="bg-card border-border text-foreground text-xs resize-none placeholder:text-muted-foreground" />
              <p className="text-[10px] text-muted-foreground">Comma-separated phrases that trigger hangup when detected.</p>
            </div>
          </div>
        </TabsContent>

        {/* ── Tab 5: Call ── */}
        <TabsContent value="call" className="flex-1 overflow-y-auto m-0 px-5 py-4">
          <div className="max-w-2xl space-y-5">
            <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Duration &amp; Silence</p>
              <SliderRow label="Max Call Duration" desc="Auto-terminate after this duration" value={maxDuration}
                onChange={v => { setMaxDuration(v); setDirty(true); }} min={30} max={3600} step={30} unit="s" />
              <SliderRow label="Hangup After Silence" desc="End call if caller is silent this long" value={silenceTimeout}
                onChange={v => { setSilenceTimeout(v); setDirty(true); }} min={5} max={120} step={5} unit="s" />
              <ToggleRow label="Hangup After LLM Call" desc="Hang up automatically when the LLM finishes its response"
                checked={cfg.hangupAfterLlmCall ?? false} onChange={v => setCfg({ hangupAfterLlmCall: v })} />
            </div>
            <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Messages</p>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Cancellation Prompt</p>
                <Textarea value={cfg.callCancellationPrompt ?? ""} onChange={e => setCfg({ callCancellationPrompt: e.target.value })}
                  placeholder="What to say when cancelling the call…" rows={2}
                  className="bg-card border-border text-foreground text-xs resize-none placeholder:text-muted-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Inactivity Message</p>
                <Input value={inactivityMessage} onChange={e => { setInactivityMessage(e.target.value); setDirty(true); }}
                  placeholder="Are you still there?" className="h-8 text-xs bg-card border-border text-foreground placeholder:text-muted-foreground" />
              </div>
            </div>
            <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Detection (P2-B)</p>
              <ToggleRow label="Voicemail / AMD Detection" desc="Detect answering machines on outbound calls and respond appropriately"
                checked={cfg.voicemailDetection ?? false} onChange={v => setCfg({ voicemailDetection: v })} />
              {cfg.voicemailDetection && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Detection mode</p>
                      <Select value={cfg.machineDetectionMode ?? "DetectMessageEnd"}
                        onValueChange={v => setCfg({ machineDetectionMode: v as "Enable" | "DetectMessageEnd" })}>
                        <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          <SelectItem value="DetectMessageEnd" className="text-foreground text-xs">Wait for beep (recommended)</SelectItem>
                          <SelectItem value="Enable" className="text-foreground text-xs">Immediate detect</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">When machine detected</p>
                      <Select value={cfg.voicemailAction ?? "hangup"}
                        onValueChange={v => setCfg({ voicemailAction: v as "hangup" | "leave_message" | "continue" })}>
                        <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          <SelectItem value="hangup"       className="text-foreground text-xs">Hang up</SelectItem>
                          <SelectItem value="leave_message" className="text-foreground text-xs">Leave a message</SelectItem>
                          <SelectItem value="continue"     className="text-foreground text-xs">Continue as human</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {cfg.voicemailAction === "leave_message" && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Voicemail message</p>
                      <Textarea value={cfg.voicemailMessage ?? ""}
                        onChange={e => setCfg({ voicemailMessage: e.target.value })}
                        placeholder="Hi, this is a message from [Company]. Please call us back at +1 555…"
                        rows={2}
                        className="bg-card border-border text-foreground text-xs resize-none placeholder:text-muted-foreground" />
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    AMD runs on outbound calls only. "Wait for beep" gives a natural pause before leaving messages.
                  </p>
                </>
              )}
            </div>
            {/* P2-C: Call Recording */}
            <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Recording (P2-C)</p>
              <ToggleRow label="Record Calls" desc="Save an audio recording of every call for review and compliance"
                checked={cfg.recordingEnabled ?? false} onChange={v => setCfg({ recordingEnabled: v })} />
              {cfg.recordingEnabled && (
                <div className="w-40">
                  <p className="text-xs text-muted-foreground mb-1">Audio format</p>
                  <Select value={cfg.recordingFormat ?? "mp3"} onValueChange={v => setCfg({ recordingFormat: v as "mp3" | "wav" })}>
                    <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      <SelectItem value="mp3" className="text-foreground text-xs">MP3 (smaller)</SelectItem>
                      <SelectItem value="wav" className="text-foreground text-xs">WAV (lossless)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* P2-D: IVR / DTMF pre-filter */}
            <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">IVR / DTMF Pre-filter (P2-D)</p>
              <ToggleRow label="Enable IVR Menu" desc="Play a key-press menu before connecting the caller to this AI agent"
                checked={cfg.ivrEnabled ?? false} onChange={v => setCfg({ ivrEnabled: v })} />
              {cfg.ivrEnabled && (
                <>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Opening greeting</p>
                    <Input value={cfg.ivrGreeting ?? ""}
                      onChange={e => setCfg({ ivrGreeting: e.target.value })}
                      placeholder="Welcome to SnapServe. Please choose from the following options."
                      className="h-7 text-xs bg-card border-border text-foreground placeholder:text-muted-foreground" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-muted-foreground">Menu options</p>
                      <button
                        type="button"
                        onClick={() => setCfg({ ivrOptions: [...(cfg.ivrOptions ?? []), { digit: "", label: "" }] })}
                        className="text-[10px] bg-muted hover:bg-muted text-muted-foreground px-2 py-1 rounded-md transition-colors">
                        + Add option
                      </button>
                    </div>
                    {(cfg.ivrOptions ?? []).map((opt, idx) => (
                      <div key={idx} className="flex gap-2 mb-1.5 items-center">
                        <Input value={opt.digit}
                          onChange={e => { const opts = [...(cfg.ivrOptions ?? [])]; opts[idx] = { ...opts[idx], digit: e.target.value }; setCfg({ ivrOptions: opts }); }}
                          placeholder="1" className="h-7 w-12 text-xs text-center bg-card border-border text-foreground shrink-0" maxLength={1} />
                        <Input value={opt.label}
                          onChange={e => { const opts = [...(cfg.ivrOptions ?? [])]; opts[idx] = { ...opts[idx], label: e.target.value }; setCfg({ ivrOptions: opts }); }}
                          placeholder="Sales" className="h-7 flex-1 text-xs bg-card border-border text-foreground placeholder:text-muted-foreground" />
                        <button type="button"
                          onClick={() => { const opts = (cfg.ivrOptions ?? []).filter((_, i) => i !== idx); setCfg({ ivrOptions: opts }); }}
                          className="text-muted-foreground hover:text-foreground transition-colors text-xs px-1">✕</button>
                      </div>
                    ))}
                    {(cfg.ivrOptions ?? []).length === 0 && (
                      <p className="text-[10px] text-muted-foreground">No menu options yet — add at least one digit/label pair.</p>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    The caller hears the greeting, presses a digit, and is routed to the agent assigned to that option.
                    Unmatched digits fall through to this agent.
                  </p>
                </>
              )}
            </div>

            {/* P2-E: Call Queue */}
            <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Call Queue (P2-E)</p>
              <ToggleRow label="Enable Call Queue" desc="Hold new callers when agent is busy instead of dropping them"
                checked={cfg.queueEnabled ?? false} onChange={v => setCfg({ queueEnabled: v })} />
              {cfg.queueEnabled && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Max concurrent calls</p>
                      <Input type="number" min={1} max={20} value={cfg.queueMaxConcurrent ?? 1}
                        onChange={e => setCfg({ queueMaxConcurrent: parseInt(e.target.value) || 1 })}
                        className="h-7 text-xs bg-card border-border text-foreground" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Hold loop length (sec)</p>
                      <Input type="number" min={10} max={120} value={cfg.queueWaitSeconds ?? 30}
                        onChange={e => setCfg({ queueWaitSeconds: parseInt(e.target.value) || 30 })}
                        className="h-7 text-xs bg-card border-border text-foreground" />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Hold music URL <span className="text-muted-foreground">(optional — MP3 stream)</span></p>
                    <Input value={cfg.queueHoldMusicUrl ?? ""}
                      onChange={e => setCfg({ queueHoldMusicUrl: e.target.value })}
                      placeholder="https://…/hold-music.mp3"
                      className="h-7 text-xs bg-card border-border text-foreground placeholder:text-muted-foreground" />
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    When all {cfg.queueMaxConcurrent ?? 1} slot{(cfg.queueMaxConcurrent ?? 1) > 1 ? "s are" : " is"} occupied,
                    inbound callers hear hold music and are retried every {cfg.queueWaitSeconds ?? 30}s.
                  </p>
                </>
              )}
            </div>

            <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Scheduling</p>
              <ToggleRow label="Scheduling Guardrails" desc="Restrict when this agent can make outbound calls"
                checked={cfg.schedulingGuardrails ?? false} onChange={v => setCfg({ schedulingGuardrails: v })} />
              {cfg.schedulingGuardrails && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Call Start (hour 0–23)</p>
                    <Select value={String(cfg.callStartHour ?? 8)} onValueChange={v => setCfg({ callStartHour: parseInt(v) })}>
                      <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-card border-border max-h-48">
                        {Array.from({ length: 24 }, (_, i) => <SelectItem key={i} value={String(i)} className="text-foreground text-xs">{String(i).padStart(2, "0")}:00</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Call End (hour 0–23)</p>
                    <Select value={String(cfg.callEndHour ?? 20)} onValueChange={v => setCfg({ callEndHour: parseInt(v) })}>
                      <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-card border-border max-h-48">
                        {Array.from({ length: 24 }, (_, i) => <SelectItem key={i} value={String(i)} className="text-foreground text-xs">{String(i).padStart(2, "0")}:00</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>

            {/* P2-A: Call Transfer */}
            <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Call Transfer (P2-A)</p>
              <ToggleRow label="Enable Call Transfer" desc="Allow this agent to transfer calls to a human or another number"
                checked={cfg.callTransferEnabled ?? false} onChange={v => setCfg({ callTransferEnabled: v })} />
              {cfg.callTransferEnabled && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Transfer type</p>
                      <Select value={cfg.callTransferType ?? "cold"} onValueChange={v => setCfg({ callTransferType: v as "warm" | "cold" })}>
                        <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          <SelectItem value="cold" className="text-foreground text-xs">Cold — immediate blind transfer</SelectItem>
                          <SelectItem value="warm" className="text-foreground text-xs">Warm — announce then transfer</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Default transfer number</p>
                      <Input value={cfg.callTransferNumber ?? ""}
                        onChange={e => setCfg({ callTransferNumber: e.target.value })}
                        placeholder="+15551234567"
                        className="h-7 text-xs bg-card border-border text-foreground placeholder:text-muted-foreground" />
                    </div>
                  </div>
                  {cfg.callTransferType === "warm" && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Warm handoff message</p>
                      <Input value={cfg.callTransferWarmMessage ?? ""}
                        onChange={e => setCfg({ callTransferWarmMessage: e.target.value })}
                        placeholder="Please hold while I connect you to an agent."
                        className="h-7 text-xs bg-card border-border text-foreground placeholder:text-muted-foreground" />
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    The agent will transfer the call when it detects an escalation intent or when triggered from Live Monitor.
                    The LLM tool call uses the default number above unless overridden.
                  </p>
                </>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── Tab 6: Tools ── */}
        <TabsContent value="tools" className="flex-1 overflow-y-auto m-0 px-5 py-4">
          <div className="max-w-2xl space-y-4">
            {/* Add buttons */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => { setAgentTools(prev => [...prev, { type: "call_transfer", name: "transfer_to_human", description: "Transfer the call to a human agent when the caller requests escalation or needs specialist help.", transferTo: "", warmHandoffMessage: "" }]); setDirty(true); }}
                className="flex items-center gap-1.5 text-xs bg-card border border-border text-foreground hover:border-border hover:bg-muted rounded-lg px-3 py-2 transition-colors"
              >
                <PhoneForwarded className="h-3.5 w-3.5 text-zinc-500" />
                Add Call Transfer
              </button>
              <button
                type="button"
                onClick={() => { setAgentTools(prev => [...prev, { type: "send_sms", name: "send_sms", description: "Send a text message to the caller with a confirmation, link, or summary.", messageTemplate: "" }]); setDirty(true); }}
                className="flex items-center gap-1.5 text-xs bg-card border border-border text-foreground hover:border-border hover:bg-muted rounded-lg px-3 py-2 transition-colors"
              >
                <Zap className="h-3.5 w-3.5 text-zinc-500" />
                Add Send SMS
              </button>
              <button
                type="button"
                onClick={() => { setAgentTools(prev => [...prev, { type: "end_call", name: "end_call", description: "End the call when the conversation is complete or the caller says goodbye.", goodbyeMessage: "" }]); setDirty(true); }}
                className="flex items-center gap-1.5 text-xs bg-card border border-border text-foreground hover:border-border hover:bg-muted rounded-lg px-3 py-2 transition-colors"
              >
                <PhoneOff className="h-3.5 w-3.5 text-muted-foreground" />
                Add End Call
              </button>
              <button
                type="button"
                onClick={() => { setAgentTools(prev => [...prev, { type: "cal_com", name: "book_appointment", description: "Book an appointment on Cal.com when the caller wants to schedule a meeting.", apiKey: "", eventTypeId: 0, timezone: "UTC" }]); setDirty(true); }}
                className="flex items-center gap-1.5 text-xs bg-card border border-border text-foreground hover:border-border hover:bg-muted rounded-lg px-3 py-2 transition-colors"
              >
                <Clock className="h-3.5 w-3.5 text-zinc-400" />
                Add Cal.com
              </button>
              <button
                type="button"
                onClick={() => setBookingModal({ editIdx: null, calendarId: null, googleCalendarKey: null, eventTypeId: null, timezone: "UTC", taskName: "book_appointment", description: "Book an appointment using the platform's scheduling engine when the caller wants to schedule a meeting.", preToolMessage: "" })}
                className="flex items-center gap-1.5 text-xs bg-card border border-border text-foreground hover:border-border hover:bg-muted rounded-lg px-3 py-2 transition-colors"
              >
                <CalendarPlus className="h-3.5 w-3.5 text-zinc-500" />
                Book Appointment
              </button>
              <button
                type="button"
                onClick={() => { setAgentTools(prev => [...prev, { type: "native_check_availability", name: "check_availability", description: "Check available appointment slots when the caller asks what times are open.", eventTypeId: 0 }]); setDirty(true); }}
                className="flex items-center gap-1.5 text-xs bg-card border border-border text-foreground hover:border-border hover:bg-muted rounded-lg px-3 py-2 transition-colors"
              >
                <CalendarCheck className="h-3.5 w-3.5 text-zinc-500" />
                Calendar Availability
              </button>
              <button
                type="button"
                onClick={() => { setAgentTools(prev => [...prev, { type: "native_reschedule", name: "reschedule_appointment", description: "Reschedule an existing booking when the caller provides their booking reference and wants a new time." }]); setDirty(true); }}
                className="flex items-center gap-1.5 text-xs bg-card border border-border text-foreground hover:border-border hover:bg-muted rounded-lg px-3 py-2 transition-colors"
              >
                <CalendarClock className="h-3.5 w-3.5 text-zinc-500" />
                Reschedule Appointment
              </button>
              <button
                type="button"
                onClick={() => { setAgentTools(prev => [...prev, { type: "native_cancel", name: "cancel_appointment", description: "Cancel an existing booking when the caller provides their booking reference and wants to cancel." }]); setDirty(true); }}
                className="flex items-center gap-1.5 text-xs bg-card border border-border text-foreground hover:border-border hover:bg-muted rounded-lg px-3 py-2 transition-colors"
              >
                <CalendarX className="h-3.5 w-3.5 text-zinc-500" />
                Cancel Appointment
              </button>
              <button
                type="button"
                onClick={() => { setAgentTools(prev => [...prev, { type: "webhook", name: "custom_action", description: "Invoke this when the caller requests a specific action.", url: "", method: "POST" }]); setDirty(true); }}
                className="flex items-center gap-1.5 text-xs bg-card border border-border text-foreground hover:border-border hover:bg-muted rounded-lg px-3 py-2 transition-colors"
              >
                <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                Add Custom Function
              </button>
            </div>

            {/* Empty state */}
            {agentTools.length === 0 && (
              <div className="bg-muted border border-border/40 rounded-xl p-8 flex flex-col items-center text-center gap-2">
                <Settings2 className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium text-muted-foreground">No tools configured</p>
                <p className="text-xs text-muted-foreground max-w-sm">Add a call transfer or webhook tool above. The AI decides when to invoke each tool based on the conversation context and the description you provide.</p>
              </div>
            )}

            {/* Tool cards */}
            {agentTools.map((tool, idx) => (
              <div key={idx} className="bg-muted border border-border/40 rounded-xl p-4 space-y-3">
                {/* Card header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {tool.type === "call_transfer"   && <PhoneForwarded className="h-4 w-4 text-zinc-500" />}
                    {tool.type === "send_sms"        && <Zap            className="h-4 w-4 text-zinc-500" />}
                    {tool.type === "end_call"         && <PhoneOff        className="h-4 w-4 text-muted-foreground" />}
                    {tool.type === "cal_com"          && <Clock           className="h-4 w-4 text-zinc-400" />}
                    {tool.type === "webhook"          && <Globe           className="h-4 w-4 text-muted-foreground" />}
                    {tool.type === "native_booking"   && <CalendarPlus    className="h-4 w-4 text-zinc-500" />}
                    {tool.type === "native_reschedule" && <CalendarClock  className="h-4 w-4 text-zinc-500" />}
                    {tool.type === "native_cancel"    && <CalendarX       className="h-4 w-4 text-zinc-500" />}
                    {tool.type === "native_check_availability" && <CalendarCheck className="h-4 w-4 text-zinc-500" />}
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {tool.type === "call_transfer"   ? "Call Transfer"
                        : tool.type === "send_sms"       ? "Send SMS"
                        : tool.type === "end_call"       ? "End Call"
                        : tool.type === "cal_com"        ? "Cal.com Booking"
                        : tool.type === "native_booking" ? "Book Appointment"
                        : tool.type === "native_reschedule" ? "Reschedule Appointment"
                        : tool.type === "native_cancel"  ? "Cancel Appointment"
                        : tool.type === "native_check_availability" ? "Calendar Availability"
                        : "Custom Function"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setAgentTools(prev => prev.filter((_, i) => i !== idx)); setDirty(true); }}
                    className="text-muted-foreground hover:text-muted-foreground transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Function name (all tools) */}
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Function Name</p>
                  <Input
                    value={tool.name}
                    onChange={e => { const next = [...agentTools]; next[idx] = { ...tool, name: e.target.value }; setAgentTools(next); setDirty(true); }}
                    placeholder="snake_case_name"
                    className="bg-card border-border text-foreground text-xs h-8"
                  />
                </div>

                {/* Description (all tools) */}
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Description <span className="text-muted-foreground">(tells the AI when to use this tool)</span>
                  </p>
                  <Textarea
                    value={tool.description}
                    onChange={e => { const next = [...agentTools]; next[idx] = { ...tool, description: e.target.value }; setAgentTools(next); setDirty(true); }}
                    rows={2}
                    className="bg-card border-border text-foreground text-xs resize-none"
                  />
                </div>

                {/* ── Call Transfer fields ── */}
                {tool.type === "call_transfer" && (
                  <>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Transfer To (E.164)</p>
                      <Input
                        value={tool.transferTo}
                        onChange={e => { const next = [...agentTools]; next[idx] = { ...tool, transferTo: e.target.value }; setAgentTools(next); setDirty(true); }}
                        placeholder="+12125551234"
                        className="bg-card border-border text-foreground text-xs h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Warm Handoff Message <span className="text-muted-foreground">(spoken before transferring, optional)</span>
                      </p>
                      <Textarea
                        value={tool.warmHandoffMessage ?? ""}
                        onChange={e => { const next = [...agentTools]; next[idx] = { ...tool, warmHandoffMessage: e.target.value }; setAgentTools(next); setDirty(true); }}
                        rows={2}
                        placeholder="Please hold while I connect you with a specialist…"
                        className="bg-card border-border text-foreground text-xs resize-none placeholder:text-muted-foreground"
                      />
                    </div>
                  </>
                )}

                {/* ── Send SMS fields ── */}
                {tool.type === "send_sms" && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Message Template</p>
                    <Textarea
                      value={tool.messageTemplate}
                      onChange={e => { const next = [...agentTools]; next[idx] = { ...tool, messageTemplate: e.target.value }; setAgentTools(next); setDirty(true); }}
                      rows={3}
                      placeholder="Hi! Here's your booking confirmation: https://…"
                      className="bg-card border-border text-foreground text-xs resize-none placeholder:text-muted-foreground"
                    />
                    <p className="text-[10px] text-muted-foreground">Sent to the caller's phone via your Twilio or Plivo account.</p>
                  </div>
                )}

                {/* ── End Call fields ── */}
                {tool.type === "end_call" && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Goodbye Message <span className="text-muted-foreground">(spoken before hanging up, optional)</span>
                    </p>
                    <Textarea
                      value={tool.goodbyeMessage ?? ""}
                      onChange={e => { const next = [...agentTools]; next[idx] = { ...tool, goodbyeMessage: e.target.value }; setAgentTools(next); setDirty(true); }}
                      rows={2}
                      placeholder="Thank you for calling! Have a great day."
                      className="bg-card border-border text-foreground text-xs resize-none placeholder:text-muted-foreground"
                    />
                  </div>
                )}

                {/* ── Cal.com fields ── */}
                {tool.type === "cal_com" && (
                  <>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Cal.com API Key</p>
                      <Input
                        value={tool.apiKey}
                        onChange={e => { const next = [...agentTools]; next[idx] = { ...tool, apiKey: e.target.value }; setAgentTools(next); setDirty(true); }}
                        placeholder="cal_live_xxxxxxxxxxxx"
                        type="password"
                        className="bg-card border-border text-foreground text-xs h-8"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Event Type ID</p>
                        <Input
                          value={tool.eventTypeId === 0 ? "" : String(tool.eventTypeId)}
                          onChange={e => { const next = [...agentTools]; next[idx] = { ...tool, eventTypeId: parseInt(e.target.value) || 0 }; setAgentTools(next); setDirty(true); }}
                          placeholder="123456"
                          className="bg-card border-border text-foreground text-xs h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Default Timezone</p>
                        <Input
                          value={tool.timezone ?? "UTC"}
                          onChange={e => { const next = [...agentTools]; next[idx] = { ...tool, timezone: e.target.value }; setAgentTools(next); setDirty(true); }}
                          placeholder="America/New_York"
                          className="bg-card border-border text-foreground text-xs h-8"
                        />
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground">The AI collects the caller's name, email, and preferred time, then books the first available slot.</p>
                  </>
                )}

                {/* ── Native Booking summary + Edit ── */}
                {tool.type === "native_booking" && (() => {
                  const cal = (calendars ?? []).find(c => c.id === tool.calendarId);
                  const et  = (eventTypes ?? []).find(e => e.id === tool.eventTypeId);
                  return (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <p className="text-muted-foreground mb-0.5">Calendar</p>
                          <p className="text-foreground truncate">{cal?.name ?? <span className="text-muted-foreground italic">Not selected</span>}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground mb-0.5">Event Type</p>
                          <p className="text-foreground truncate">
                            {et ? `${et.name} (${et.durationMinutes} min)` : <span className="text-muted-foreground italic">Not selected</span>}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground mb-0.5">Timezone</p>
                          <p className="text-foreground truncate">{tool.timezone || "UTC"}</p>
                        </div>
                        {tool.preToolMessage && (
                          <div>
                            <p className="text-muted-foreground mb-0.5">Pre-tool message</p>
                            <p className="text-foreground truncate">{tool.preToolMessage}</p>
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const schedCalId = tool.calendarId ?? null;
                          // Try to derive the Google calendar key from the linked scheduling calendar.
                          const match = schedCalId != null
                            ? (googleCals ?? []).find(g => g.schedulingCalendarId === schedCalId)
                            : undefined;
                          setBookingModal({
                            editIdx: idx,
                            calendarId: schedCalId,
                            googleCalendarKey: match ? `${match.connectionId}|${match.googleCalendarId}` : null,
                            eventTypeId: tool.eventTypeId || null,
                            timezone: tool.timezone ?? "UTC",
                            taskName: tool.taskName ?? tool.name,
                            description: tool.description,
                            preToolMessage: tool.preToolMessage ?? "",
                          });
                        }}
                        className="text-xs text-foreground underline underline-offset-2 hover:text-foreground"
                      >
                        Edit configuration
                      </button>
                      {!tool.eventTypeId && (
                        <p className="text-[10px] text-muted-foreground">⚠ Event type not selected — booking will fail at runtime.</p>
                      )}
                    </div>
                  );
                })()}

                {/* ── Native Reschedule fields ── */}
                {tool.type === "native_reschedule" && (
                  <p className="text-[10px] text-muted-foreground">The AI will ask the caller for their booking reference ID and reschedule them to the next available slot.</p>
                )}

                {/* ── Native Cancel fields ── */}
                {tool.type === "native_cancel" && (
                  <p className="text-[10px] text-muted-foreground">The AI will ask the caller for their booking reference ID and cancel the appointment.</p>
                )}

                {/* ── Calendar Availability fields ── */}
                {tool.type === "native_check_availability" && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Calendar</p>
                        <Select
                          value={tool.calendarId ? String(tool.calendarId) : ""}
                          onValueChange={v => { const next = [...agentTools]; next[idx] = { ...tool, calendarId: parseInt(v) || undefined, eventTypeId: 0 }; setAgentTools(next); setDirty(true); }}
                        >
                          <SelectTrigger className="bg-card border-border text-foreground text-xs h-8">
                            <SelectValue placeholder="Select calendar…" />
                          </SelectTrigger>
                          <SelectContent>
                            {(calendars ?? []).map(c => (
                              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                            ))}
                            {(calendars ?? []).length === 0 && (
                              <SelectItem value="0" disabled>No calendars — create one in Scheduling</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Event Type</p>
                        <Select
                          value={tool.eventTypeId ? String(tool.eventTypeId) : ""}
                          onValueChange={v => { const next = [...agentTools]; next[idx] = { ...tool, eventTypeId: parseInt(v) || 0 }; setAgentTools(next); setDirty(true); }}
                          disabled={!tool.calendarId}
                        >
                          <SelectTrigger className="bg-card border-border text-foreground text-xs h-8">
                            <SelectValue placeholder={tool.calendarId ? "Select event type…" : "Pick a calendar first"} />
                          </SelectTrigger>
                          <SelectContent>
                            {(eventTypes ?? []).filter(et => !tool.calendarId || et.calendarId === tool.calendarId).map(et => (
                              <SelectItem key={et.id} value={String(et.id)}>
                                {et.name} ({et.durationMinutes} min)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground">The AI returns up to 5 available slots so the caller can pick one before booking.</p>
                    {!tool.eventTypeId && (
                      <p className="text-[10px] text-muted-foreground">⚠ Event type not selected — availability checks will fail at runtime.</p>
                    )}
                  </>
                )}

                {/* ── Webhook fields ── */}
                {tool.type === "webhook" && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Endpoint URL</p>
                        <Input
                          value={tool.url}
                          onChange={e => { const next = [...agentTools]; next[idx] = { ...tool, url: e.target.value }; setAgentTools(next); setDirty(true); }}
                          placeholder="https://your-api.com/webhook"
                          className="bg-card border-border text-foreground text-xs h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">HTTP Method</p>
                        <Select value={tool.method} onValueChange={v => { const next = [...agentTools]; next[idx] = { ...tool, method: v as "GET" | "POST" }; setAgentTools(next); setDirty(true); }}>
                          <SelectTrigger className="bg-card border-border text-foreground text-xs h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="GET">GET</SelectItem>
                            <SelectItem value="POST">POST</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Secret <span className="text-muted-foreground">(sent as X-Webhook-Secret header, optional)</span>
                      </p>
                      <Input
                        value={tool.secret ?? ""}
                        onChange={e => { const next = [...agentTools]; next[idx] = { ...tool, secret: e.target.value }; setAgentTools(next); setDirty(true); }}
                        placeholder="optional-shared-secret"
                        type="password"
                        className="bg-card border-border text-foreground text-xs h-8"
                      />
                    </div>
                  </>
                )}
              </div>
            ))}

            {agentTools.length > 0 && (
              <p className="text-[11px] text-muted-foreground px-1">
                The AI automatically decides when to invoke each tool based on the conversation context and the description you provide.
              </p>
            )}
          </div>

          {/* ── Book Appointment configuration modal ── */}
          <Dialog open={bookingModal !== null} onOpenChange={(open) => { if (!open) setBookingModal(null); }}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CalendarPlus className="h-4 w-4 text-zinc-500" />
                  {bookingModal?.editIdx == null ? "Add Book Appointment Tool" : "Edit Book Appointment Tool"}
                </DialogTitle>
                <DialogDescription>
                  Configure how the AI books appointments using your inbuilt calendar.
                </DialogDescription>
              </DialogHeader>

              {bookingModal && (
                <div className="space-y-3 py-1">
                  {/* Calendar — lists Google sub-calendars across all connected Google accounts */}
                  <div className="space-y-1">
                    <Label className="text-xs">Calendar <span className="text-foreground">*</span></Label>
                    <Select
                      value={bookingModal.googleCalendarKey ?? ""}
                      onValueChange={(v) => {
                        const entry = (googleCals ?? []).find(g => `${g.connectionId}|${g.googleCalendarId}` === v);
                        setBookingModal({
                          ...bookingModal,
                          googleCalendarKey: v,
                          calendarId: entry?.schedulingCalendarId ?? null,
                          eventTypeId: null,
                        });
                      }}
                      disabled={googleCalsLoading}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder={googleCalsLoading ? "Loading Google calendars…" : "Select a Google calendar…"} />
                      </SelectTrigger>
                      <SelectContent>
                        {(() => {
                          const cals = googleCals ?? [];
                          if (!googleCalsLoading && cals.length === 0) {
                            return (
                              <SelectItem value="__none" disabled>
                                No Google calendars — connect a Google account in Scheduling → Calendar settings
                              </SelectItem>
                            );
                          }
                          // Group by connection email
                          const byEmail = new Map<string, GoogleCalEntry[]>();
                          for (const c of cals) {
                            const arr = byEmail.get(c.connectionEmail) ?? [];
                            arr.push(c);
                            byEmail.set(c.connectionEmail, arr);
                          }
                          return Array.from(byEmail.entries()).map(([email, items]) => (
                            <div key={email}>
                              <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">{email}</div>
                              {items.map(c => {
                                const key = `${c.connectionId}|${c.googleCalendarId}`;
                                return (
                                  <SelectItem key={key} value={key}>
                                    {c.summary}{c.primary ? " (Primary)" : ""}
                                    {c.schedulingCalendarId == null ? " — not linked" : ""}
                                  </SelectItem>
                                );
                              })}
                            </div>
                          ));
                        })()}
                      </SelectContent>
                    </Select>
                    {bookingModal.googleCalendarKey && bookingModal.calendarId == null && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400">
                        This Google calendar isn't linked to a scheduling calendar yet. Go to Scheduling → Calendars to link it before saving.
                      </p>
                    )}
                  </div>

                  {/* Event Type — cascades from calendar */}
                  <div className="space-y-1">
                    <Label className="text-xs">Event Type <span className="text-foreground">*</span></Label>
                    <Select
                      value={bookingModal.eventTypeId ? String(bookingModal.eventTypeId) : ""}
                      onValueChange={(v) => setBookingModal({ ...bookingModal, eventTypeId: parseInt(v) || null })}
                      disabled={!bookingModal.calendarId || modalEventTypesLoading}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder={
                          !bookingModal.calendarId ? "Pick a calendar first"
                          : modalEventTypesLoading ? "Loading event types…"
                          : "Select an event type…"
                        } />
                      </SelectTrigger>
                      <SelectContent>
                        {(modalEventTypes ?? []).map((et) => (
                          <SelectItem key={et.id} value={String(et.id)}>{et.name} ({et.durationMinutes} min)</SelectItem>
                        ))}
                        {bookingModal.calendarId && !modalEventTypesLoading && (modalEventTypes ?? []).length === 0 && (
                          <SelectItem value="__none" disabled>No event types for this calendar</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Timezone */}
                  <div className="space-y-1">
                    <Label className="text-xs">Timezone</Label>
                    <Select value={bookingModal.timezone} onValueChange={(v) => setBookingModal({ ...bookingModal, timezone: v })}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"].map((tz) => (
                          <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Task Name */}
                  <div className="space-y-1">
                    <Label className="text-xs">Task Name</Label>
                    <Input
                      value={bookingModal.taskName}
                      onChange={(e) => setBookingModal({ ...bookingModal, taskName: e.target.value })}
                      placeholder="book_appointment"
                      className="h-9 text-sm"
                    />
                    <p className="text-[10px] text-muted-foreground">Function name exposed to the AI (snake_case recommended).</p>
                  </div>

                  {/* Description */}
                  <div className="space-y-1">
                    <Label className="text-xs">Description</Label>
                    <Textarea
                      value={bookingModal.description}
                      onChange={(e) => setBookingModal({ ...bookingModal, description: e.target.value })}
                      rows={2}
                      placeholder="Tells the AI when to call this tool."
                      className="text-sm resize-none"
                    />
                  </div>

                  {/* Pre-tool message */}
                  <div className="space-y-1">
                    <Label className="text-xs">Pre-tool Message</Label>
                    <Input
                      value={bookingModal.preToolMessage}
                      onChange={(e) => setBookingModal({ ...bookingModal, preToolMessage: e.target.value })}
                      placeholder="e.g. Sure, let me book that for you…"
                      className="h-9 text-sm"
                    />
                    <p className="text-[10px] text-muted-foreground">Hint for the AI to say before completing the booking (optional).</p>
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setBookingModal(null)}>Cancel</Button>
                <Button
                  onClick={() => {
                    if (!bookingModal) return;
                    if (!bookingModal.calendarId) { toast({ title: "Calendar is required", variant: "destructive" }); return; }
                    if (!bookingModal.eventTypeId) { toast({ title: "Event type is required", variant: "destructive" }); return; }
                    const taskName = (bookingModal.taskName || "book_appointment").trim();
                    const next: AgentToolLocal = {
                      type: "native_booking",
                      name: taskName,
                      description: bookingModal.description || "Book an appointment when the caller wants to schedule a meeting.",
                      eventTypeId: bookingModal.eventTypeId,
                      calendarId: bookingModal.calendarId,
                      timezone: bookingModal.timezone,
                      taskName,
                      preToolMessage: bookingModal.preToolMessage || undefined,
                    };
                    setAgentTools(prev => {
                      if (bookingModal.editIdx == null) return [...prev, next];
                      const copy = [...prev];
                      copy[bookingModal.editIdx] = next;
                      return copy;
                    });
                    setDirty(true);
                    setBookingModal(null);
                    toast({ title: bookingModal.editIdx == null ? "Booking tool added" : "Booking tool updated" });
                  }}
                >
                  Save Configuration
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* ── Tab 7: Analytics ── */}
        <TabsContent value="analytics" className="flex-1 overflow-y-auto m-0 px-5 py-4">
          <div className="max-w-2xl space-y-5">
            <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Summarization</p>
              <ToggleRow label="Auto-Summarize Calls" desc="Generate a summary of each call transcript after the call ends"
                checked={cfg.summarizationEnabled ?? false} onChange={v => setCfg({ summarizationEnabled: v })} />
              {cfg.summarizationEnabled && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Summarization Prompt</p>
                  <Textarea value={cfg.summarizationPrompt ?? ""} onChange={e => setCfg({ summarizationPrompt: e.target.value })}
                    placeholder="Summarize the key points, next steps, and any issues raised…" rows={4}
                    className="bg-card border-border text-foreground text-xs resize-none placeholder:text-muted-foreground" />
                </div>
              )}
            </div>
            <div className="bg-muted border border-border/40 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-3.5 w-3.5 text-foreground" />
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Disposition Fields</p>
                </div>
                <button type="button" onClick={() => { setDispositionSchema(prev => [...prev, { key: "", label: "", type: "text", required: false, options: "" }]); setDirty(true); }}
                  className="text-[11px] text-foreground hover:text-zinc-300 flex items-center gap-1">
                  <Plus className="h-3 w-3" /> Add Field
                </button>
              </div>
              {dispositionSchema.length === 0 ? (
                <p className="text-[11px] text-muted-foreground px-4 py-3">No fields defined. Fields are extracted from call transcripts by the LLM after each call.</p>
              ) : (
                <div className="divide-y divide-border">
                  {dispositionSchema.map((field, i) => (
                    <div key={i} className="px-4 py-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <input value={field.key} onChange={e => { const n = [...dispositionSchema]; n[i] = { ...n[i]!, key: e.target.value }; setDispositionSchema(n); setDirty(true); }}
                          placeholder="key_name" className="flex-1 h-7 rounded-md bg-card border border-border text-foreground text-xs px-2.5 placeholder:text-muted-foreground focus:outline-none focus:border-[#ACADB1]" />
                        <input value={field.label} onChange={e => { const n = [...dispositionSchema]; n[i] = { ...n[i]!, label: e.target.value }; setDispositionSchema(n); setDirty(true); }}
                          placeholder="Display Label" className="flex-1 h-7 rounded-md bg-card border border-border text-foreground text-xs px-2.5 placeholder:text-muted-foreground focus:outline-none focus:border-[#ACADB1]" />
                        <Select value={field.type} onValueChange={v => { const n = [...dispositionSchema]; n[i] = { ...n[i]!, type: v }; setDispositionSchema(n); setDirty(true); }}>
                          <SelectTrigger className="h-7 w-24 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-card border-border">
                            <SelectItem value="text" className="text-foreground text-xs">Text</SelectItem>
                            <SelectItem value="number" className="text-foreground text-xs">Number</SelectItem>
                            <SelectItem value="boolean" className="text-foreground text-xs">Yes / No</SelectItem>
                            <SelectItem value="choice" className="text-foreground text-xs">Choice</SelectItem>
                          </SelectContent>
                        </Select>
                        <button type="button" onClick={() => { setDispositionSchema(prev => prev.filter((_, j) => j !== i)); setDirty(true); }} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                      </div>
                      {field.type === "choice" && (
                        <input value={field.options ?? ""} onChange={e => { const n = [...dispositionSchema]; n[i] = { ...n[i]!, options: e.target.value }; setDispositionSchema(n); setDirty(true); }}
                          placeholder="Options: resolved, escalated, callback"
                          className="w-full h-7 rounded-md bg-card border border-border text-foreground text-xs px-2.5 placeholder:text-muted-foreground focus:outline-none focus:border-[#ACADB1]" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── Tab 8: Inbound ── */}
        <TabsContent value="inbound" className="flex-1 overflow-y-auto m-0 px-5 py-4">
          <div className="max-w-2xl space-y-5">
            <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Call Limits</p>
              <SliderRow label="Inbound Limit" desc="Max concurrent inbound calls (−1 = unlimited)" value={cfg.inboundLimit ?? -1}
                onChange={v => setCfg({ inboundLimit: v })} min={-1} max={50} step={1} />
              <ToggleRow label="Disallow Unknown Numbers" desc="Reject calls from numbers not on the whitelist"
                checked={cfg.disallowUnknownNumbers ?? false} onChange={v => setCfg({ disallowUnknownNumbers: v })} />
              {cfg.disallowUnknownNumbers && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Whitelist Numbers</p>
                  <Textarea value={cfg.whitelistNumbers ?? ""} onChange={e => setCfg({ whitelistNumbers: e.target.value })}
                    placeholder="+1234567890, +0987654321" rows={2}
                    className="bg-card border-border text-foreground text-xs resize-none placeholder:text-muted-foreground" />
                  <p className="text-[10px] text-muted-foreground mt-1">Comma-separated E.164 numbers.</p>
                </div>
              )}
            </div>
            <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Call Memory / RAG</p>
              <ToggleRow label="Enable Call Memory" desc="Ingest call data into a RAG source for context-aware responses"
                checked={cfg.callMemoryEnabled ?? false} onChange={v => setCfg({ callMemoryEnabled: v })} />
              {cfg.callMemoryEnabled && (
                <>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Source Type</p>
                    <Select value={cfg.callMemorySourceType ?? "api"} onValueChange={v => setCfg({ callMemorySourceType: v })}>
                      <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        <SelectItem value="api" className="text-foreground text-xs">REST API</SelectItem>
                        <SelectItem value="s3" className="text-foreground text-xs">Amazon S3</SelectItem>
                        <SelectItem value="gcs" className="text-foreground text-xs">Google Cloud Storage</SelectItem>
                        <SelectItem value="database" className="text-foreground text-xs">Database</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Source URL</p>
                    <Input value={cfg.callMemorySourceUrl ?? ""} onChange={e => setCfg({ callMemorySourceUrl: e.target.value })}
                      placeholder="https://api.your-rag.com/ingest" className="h-7 text-xs bg-card border-border text-foreground placeholder:text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Auth Token</p>
                    <Input type="password" value={cfg.callMemoryAuthToken ?? ""} onChange={e => setCfg({ callMemoryAuthToken: e.target.value })}
                      placeholder="Bearer token or API key" className="h-7 text-xs bg-card border-border text-foreground placeholder:text-muted-foreground" />
                  </div>
                </>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── Tab 9: WhatsApp ── */}
        <TabsContent value="whatsapp" className="flex-1 overflow-y-auto m-0 px-5 py-4">
          <div className="max-w-2xl space-y-5">
            <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Provider</p>
              <Select value={cfg.whatsappProvider ?? "none"} onValueChange={v => setCfg({ whatsappProvider: v === "none" ? undefined : v })}>
                <SelectTrigger className="h-8 text-xs bg-card border-border text-foreground"><SelectValue placeholder="Select provider" /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="none" className="text-muted-foreground text-xs">— Not configured —</SelectItem>
                  <SelectItem value="aisensy" className="text-foreground text-xs">AiSensy</SelectItem>
                  <SelectItem value="meta" className="text-foreground text-xs">Meta (Business API)</SelectItem>
                  <SelectItem value="twilio" className="text-foreground text-xs">Twilio WhatsApp</SelectItem>
                  <SelectItem value="360dialog" className="text-foreground text-xs">360dialog</SelectItem>
                  <SelectItem value="wati" className="text-foreground text-xs">WATI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {cfg.whatsappProvider && cfg.whatsappProvider !== "none" && (
              <div className="bg-muted border border-border/40 rounded-xl p-4 space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Credentials</p>
                {(cfg.whatsappProvider === "aisensy") && (
                  <>
                    <div><p className="text-xs text-muted-foreground mb-1">API Key</p>
                      <Input type="password" value={cfg.whatsappCredentials?.["apiKey"] ?? ""} onChange={e => setCfg({ whatsappCredentials: { ...cfg.whatsappCredentials, apiKey: e.target.value } })}
                        placeholder="AiSensy API key" className="h-7 text-xs bg-card border-border text-foreground" />
                    </div>
                    <div><p className="text-xs text-muted-foreground mb-1">Campaign Name</p>
                      <Input value={cfg.whatsappCredentials?.["campaignName"] ?? ""} onChange={e => setCfg({ whatsappCredentials: { ...cfg.whatsappCredentials, campaignName: e.target.value } })}
                        placeholder="Campaign name" className="h-7 text-xs bg-card border-border text-foreground" />
                    </div>
                  </>
                )}
                {cfg.whatsappProvider === "meta" && (
                  <>
                    <div><p className="text-xs text-muted-foreground mb-1">Access Token</p>
                      <Input type="password" value={cfg.whatsappCredentials?.["accessToken"] ?? ""} onChange={e => setCfg({ whatsappCredentials: { ...cfg.whatsappCredentials, accessToken: e.target.value } })}
                        placeholder="Meta API access token" className="h-7 text-xs bg-card border-border text-foreground" />
                    </div>
                    <div><p className="text-xs text-muted-foreground mb-1">Phone Number ID</p>
                      <Input value={cfg.whatsappCredentials?.["phoneNumberId"] ?? ""} onChange={e => setCfg({ whatsappCredentials: { ...cfg.whatsappCredentials, phoneNumberId: e.target.value } })}
                        placeholder="e.g. 123456789012345" className="h-7 text-xs bg-card border-border text-foreground" />
                    </div>
                  </>
                )}
                {["twilio","360dialog","wati"].includes(cfg.whatsappProvider) && (
                  <>
                    <div><p className="text-xs text-muted-foreground mb-1">API Key / SID</p>
                      <Input type="password" value={cfg.whatsappCredentials?.["apiKey"] ?? ""} onChange={e => setCfg({ whatsappCredentials: { ...cfg.whatsappCredentials, apiKey: e.target.value } })}
                        placeholder="API key or account SID" className="h-7 text-xs bg-card border-border text-foreground" />
                    </div>
                    <div><p className="text-xs text-muted-foreground mb-1">API Secret / Auth Token</p>
                      <Input type="password" value={cfg.whatsappCredentials?.["apiSecret"] ?? ""} onChange={e => setCfg({ whatsappCredentials: { ...cfg.whatsappCredentials, apiSecret: e.target.value } })}
                        placeholder="API secret or auth token" className="h-7 text-xs bg-card border-border text-foreground" />
                    </div>
                  </>
                )}
              </div>
            )}
            {cfg.whatsappProvider && cfg.whatsappProvider !== "none" && (
              <div className="bg-muted border border-border/40 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Outcome Messages</p>
                  <button type="button" onClick={() => setCfg({ whatsappOutcomeMessages: [...(cfg.whatsappOutcomeMessages ?? []), { outcome: "interested", templateName: "", language: "en" }] })}
                    className="text-[11px] text-foreground hover:text-zinc-300 flex items-center gap-1"><Plus className="h-3 w-3" /> Add</button>
                </div>
                {!(cfg.whatsappOutcomeMessages?.length) ? (
                  <p className="text-[11px] text-muted-foreground px-4 py-3">No outcome messages configured.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {cfg.whatsappOutcomeMessages!.map((msg, i) => (
                      <div key={i} className="px-4 py-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Select value={msg.outcome} onValueChange={v => { const m = [...cfg.whatsappOutcomeMessages!]; m[i] = { ...m[i]!, outcome: v }; setCfg({ whatsappOutcomeMessages: m }); }}>
                            <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground w-36"><SelectValue /></SelectTrigger>
                            <SelectContent className="bg-card border-border">
                              <SelectItem value="interested" className="text-foreground text-xs">Interested</SelectItem>
                              <SelectItem value="callback" className="text-foreground text-xs">Callback</SelectItem>
                              <SelectItem value="no_answer" className="text-foreground text-xs">No Answer</SelectItem>
                              <SelectItem value="not_interested" className="text-foreground text-xs">Not Interested</SelectItem>
                            </SelectContent>
                          </Select>
                          <input value={msg.templateName} onChange={e => { const m = [...cfg.whatsappOutcomeMessages!]; m[i] = { ...m[i]!, templateName: e.target.value }; setCfg({ whatsappOutcomeMessages: m }); }}
                            placeholder="Template name" className="flex-1 h-7 rounded-md bg-card border border-border text-foreground text-xs px-2.5 placeholder:text-muted-foreground focus:outline-none focus:border-[#ACADB1]" />
                          <button type="button" onClick={() => setCfg({ whatsappOutcomeMessages: cfg.whatsappOutcomeMessages!.filter((_, j) => j !== i) })} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input value={msg.mediaUrl ?? ""} onChange={e => { const m = [...cfg.whatsappOutcomeMessages!]; m[i] = { ...m[i]!, mediaUrl: e.target.value }; setCfg({ whatsappOutcomeMessages: m }); }}
                            placeholder="Media URL (optional)" className="h-7 rounded-md bg-card border border-border text-foreground text-xs px-2.5 placeholder:text-muted-foreground focus:outline-none focus:border-[#ACADB1]" />
                          <input value={msg.mediaFilename ?? ""} onChange={e => { const m = [...cfg.whatsappOutcomeMessages!]; m[i] = { ...m[i]!, mediaFilename: e.target.value }; setCfg({ whatsappOutcomeMessages: m }); }}
                            placeholder="Filename (optional)" className="h-7 rounded-md bg-card border border-border text-foreground text-xs px-2.5 placeholder:text-muted-foreground focus:outline-none focus:border-[#ACADB1]" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Logs ── */}
        <TabsContent value="logs" className="flex-1 overflow-y-auto m-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-card sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Date</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">To / From</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {callsLoading ? (
                  [1,2,3].map(i => (
                    <tr key={i}>{[1,2,3,4].map(j => <td key={j} className="px-4 py-2.5"><Skeleton className="h-4 w-full bg-muted" /></td>)}</tr>
                  ))
                ) : (calls ?? []).length === 0 ? (
                  <tr><td colSpan={4} className="text-center text-muted-foreground py-10">No calls yet for this assistant.</td></tr>
                ) : (calls ?? []).map(call => (
                  <tr key={call.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{format(new Date(call.createdAt), "MMM d, HH:mm")}</td>
                    <td className="px-4 py-2.5">
                      {call.status === "completed"   && <span className="text-foreground">completed</span>}
                      {call.status === "failed"      && <span className="text-foreground">failed</span>}
                      {call.status === "in_progress" && <span className="text-foreground">in progress</span>}
                      {!["completed","failed","in_progress"].includes(call.status) && <span className="text-muted-foreground">{call.status}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground font-mono text-[11px]">{call.toNumber || "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{call.durationSeconds != null ? `${call.durationSeconds}s` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ── Test ── */}
        <TabsContent value="test" className="flex-1 overflow-y-auto m-0 px-5 py-4">
          <div className="max-w-lg">
            <WebCallPanel agentId={agent.id} agentName={agent.name} />
          </div>
        </TabsContent>
      </Tabs>

      {/* Outbound call dialog */}
      <Dialog open={outboundDialogOpen} onOpenChange={setOutboundDialogOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <PhoneOutgoing className="h-4 w-4 text-foreground" /> Make a Call
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              Dial a number using <span className="capitalize font-medium text-foreground">{agent.telephonyProvider}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label className="text-muted-foreground text-xs">Destination number (E.164)</Label>
            <Input placeholder="+1234567890" value={toNumber} onChange={e => setToNumber(e.target.value)} className="bg-muted border-border text-foreground" />
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border text-muted-foreground" onClick={() => setOutboundDialogOpen(false)}>Cancel</Button>
            <Button
              className="bg-primary hover:opacity-90 text-primary-foreground"
              disabled={!toNumber.trim() || initiateOutbound.isPending}
              onClick={() => {
                initiateOutbound.mutate(
                  { data: { agentId: agent.id, toNumber: toNumber.trim(), webhookBaseUrl: window.location.origin } },
                  {
                    onSuccess: () => {
                      toast({ title: "Call initiated", description: `Dialing ${toNumber} via ${agent.name}.` });
                      setOutboundDialogOpen(false);
                      setToNumber("");
                    },
                    onError: (err: unknown) => {
                      toast({ title: "Call failed", description: formatApiError(err), variant: "destructive" });
                    },
                  }
                );
              }}
            >
              {initiateOutbound.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Dialing…</>
                : <><PhoneOutgoing className="h-4 w-4 mr-2" /> Call Now</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── New Agent Quick-Create ───────────────────────────────────────────────── */

function NewAgentPanel({ onCreated }: { onCreated: (id: number) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName]       = useState("New Assistant");
  const [asr, setAsr]         = useState("assemblyai");
  const [llm, setLlm]         = useState("openai");
  const [llmModel, setLlmModel] = useState(LLM_MODELS["openai"]?.[0]?.value ?? "");
  const [tts, setTts]         = useState("elevenlabs");
  const [ttsModel, setTtsModel] = useState("");
  const [tel, setTel]         = useState("twilio");
  const [prompt, setPrompt]   = useState("You are a helpful AI voice assistant. Be concise and professional.");

  const create = useCreateAgent();

  function handleCreate() {
    create.mutate(
      {
        data: {
          name,
          asrProvider: asr,
          llmProvider: llm,
          llmModel: llmModel || LLM_MODELS[llm]?.[0]?.value || undefined,
          ttsProvider: tts,
          ttsModel: ttsModel || undefined,
          telephonyProvider: tel,
          systemPrompt: prompt,
          maxDuration: 300,
        } as Parameters<typeof create.mutate>[0]["data"],
      },
      {
        onSuccess: (created) => {
          queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
          toast({ title: "Assistant created" });
          onCreated(created.id);
        },
        onError: (err: unknown) => toast({ title: "Error", description: formatApiError(err), variant: "destructive" }),
      }
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <div className="flex items-center gap-3 px-5 h-12 border-b border-border shrink-0">
        <span className="font-semibold text-sm text-foreground">New Assistant</span>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="max-w-2xl space-y-5">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Name</p>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              className="bg-muted border-border text-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-muted border border-border rounded-xl p-3.5 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Transcriber</p>
              <Select value={asr} onValueChange={setAsr}>
                <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {ASR_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-foreground text-xs">{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="bg-muted border border-border rounded-xl p-3.5 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Model</p>
              <Select value={llm} onValueChange={(v) => { setLlm(v); setLlmModel(LLM_MODELS[v]?.[0]?.value ?? ""); }}>
                <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {LLM_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-foreground text-xs">{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {LLM_MODELS[llm] && (
                <Select value={llmModel} onValueChange={setLlmModel}>
                  <SelectTrigger className="h-7 text-xs bg-card border-border text-muted-foreground"><SelectValue placeholder="Select model" /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {LLM_MODELS[llm]!.map(m => (
                      <SelectItem key={m.value} value={m.value} className="text-foreground text-xs">{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="bg-muted border border-border rounded-xl p-3.5 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Voice</p>
              <Select
                value={tts}
                onValueChange={(v) => {
                  setTts(v);
                  setTtsModel(TTS_MODELS[v]?.[0]?.value ?? "");
                }}
              >
                <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {TTS_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-foreground text-xs">{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {TTS_MODELS[tts] && (
                <Select value={ttsModel} onValueChange={setTtsModel}>
                  <SelectTrigger className="h-7 text-xs bg-card border-border text-muted-foreground"><SelectValue placeholder="Select model / voice" /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {TTS_MODELS[tts]!.map(m => (
                      <SelectItem key={m.value} value={m.value} className="text-foreground text-xs">{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="bg-muted border border-border rounded-xl p-3.5 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Telephony</p>
              <Select value={tel} onValueChange={setTel}>
                <SelectTrigger className="h-7 text-xs bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {TELEPHONY_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-foreground text-xs">{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">System Prompt</p>
            <Textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              className="bg-muted border-border text-foreground text-sm min-h-[120px] resize-none placeholder:text-muted-foreground"
            />
          </div>

          <Button
            className="w-full bg-primary hover:opacity-90 text-primary-foreground gap-2"
            onClick={handleCreate}
            disabled={!name.trim() || create.isPending}
          >
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create Assistant
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────────────────────── */

export default function AssistantsPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch]         = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);

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
      <div className="w-[272px] shrink-0 flex flex-col"
        style={{ borderRight: "1px solid #E5E7EB", background: "#FAFAFA" }}>

        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 h-14 shrink-0"
          style={{ borderBottom: "1px solid #F3F4F6" }}>
          <span className="font-semibold text-[14px] flex-1" style={{ color: "#111827" }}>
            Assistants
          </span>
          {agents && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md tabular-nums"
              style={{ background: "#F3F4F6", color: "#4B5563", border: "1px solid #E5E7EB" }}>
              {agents.length}
            </span>
          )}
          <button
            onClick={() => setWizardOpen(true)}
            title="Create assistant"
            className="h-7 w-7 flex items-center justify-center rounded-lg transition-all"
            style={{ background: "#F3F4F6", color: "#374151", border: "1px solid #E5E7EB" }}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Create button */}
        <div className="px-3 pt-3 pb-2 shrink-0">
          <button
            onClick={() => setWizardOpen(true)}
            className="w-full flex items-center justify-center gap-2 h-9 rounded-xl text-[13px] font-medium transition-all"
            style={{
              background: "linear-gradient(135deg, #F3F4F6 0%, #F9FAFB 100%)",
              border: "1px solid #E5E7EB",
              color: "#374151",
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Create Assistant
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pb-3 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: "#9CA3AF" }} />
            <input
              placeholder="Search assistants…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 rounded-xl text-[13px] outline-none transition-all"
              style={{
                background: "#F3F4F6",
                border: "1px solid #F3F4F6",
                color: "#374151",
              }}
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
          {isLoading ? (
            <div className="space-y-2 p-1">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-[60px] rounded-xl animate-pulse" style={{ background: "#F9FAFB" }} />
              ))}
            </div>
          ) : filtered?.length === 0 ? (
            <div className="py-8 text-center text-[12px]" style={{ color: "#9CA3AF" }}>
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
                  className="w-full text-left px-3 py-2.5 rounded-xl transition-all card-hover"
                  style={{
                    background: isSelected
                      ? "linear-gradient(135deg, #F3F4F6 0%, #F9FAFB 100%)"
                      : "#FAFAFA",
                    border: `1px solid ${isSelected ? "#D1D5DB" : "#F3F4F6"}`,
                    boxShadow: isSelected ? "0 0 16px #F9FAFB" : undefined,
                  }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    {statusDot(agent.status)}
                    <span className="text-[13px] font-medium truncate"
                      style={{ color: isSelected ? "#111827" : "#374151" }}>
                      {agent.name}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 ml-4">
                    {tags.map(t => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-md"
                        style={{ background: "#E5E7EB", color: "#6B7280" }}>
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
      <div className="flex-1 flex flex-col min-w-0">
        {selectedId !== null ? (
          <AgentConfigPanel agentId={selectedId} onDeleted={() => setSelectedId(agents?.[0]?.id ?? null)} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
            <div className="h-16 w-16 rounded-2xl flex items-center justify-center"
              style={{ background: "#F9FAFB", border: "1px solid #E5E7EB" }}>
              <Mic className="h-8 w-8" style={{ color: "#6B7280" }} />
            </div>
            <div>
              <p className="text-[14px] font-semibold" style={{ color: "#6B7280" }}>No assistant selected</p>
              <p className="text-[12px] mt-1" style={{ color: "#9CA3AF" }}>Choose one from the list or create a new one.</p>
            </div>
            <button
              onClick={() => setWizardOpen(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-medium transition-all"
              style={{
                background: "#374151",
                color: "white",
                boxShadow: "0 0 20px #374151",
              }}
            >
              <Plus className="h-4 w-4" /> Create Assistant
            </button>
          </div>
        )}
      </div>

      <CreateAgentWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={(id) => { setWizardOpen(false); setSelectedId(id); }}
      />
    </div>
  );
}
