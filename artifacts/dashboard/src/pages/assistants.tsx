import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import {
  Search, Plus, Phone, Mic, MicOff, PhoneOff, Volume2,
  Settings2, MoreHorizontal, Pencil, Trash2, PlayCircle,
  Check, Copy, Loader2, ChevronDown, Sparkles, PhoneOutgoing,
  BarChart2, Clock, CheckCircle2, XCircle, BookOpen,
  AlertTriangle, Target, AlignLeft, Zap, RefreshCw, ClipboardList, X,
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
const LLM_MODELS: Record<string, { value: string; label: string }[]> = {
  openai:    [{ value: "gpt-4o-mini", label: "GPT-4o Mini" }, { value: "gpt-4o", label: "GPT-4o" }, { value: "gpt-4-turbo", label: "GPT-4 Turbo" }, { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" }],
  anthropic: [{ value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" }, { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" }, { value: "claude-3-opus-20240229", label: "Claude 3 Opus" }],
  google:    [{ value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" }, { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" }, { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" }],
  groq:      [{ value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" }, { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B (fast)" }, { value: "gemma2-9b-it", label: "Gemma 2 9B" }],
  deepseek:  [{ value: "deepseek-chat", label: "DeepSeek Chat" }, { value: "deepseek-reasoner", label: "DeepSeek Reasoner" }],
  mistral:   [{ value: "mistral-large-latest", label: "Mistral Large" }, { value: "mistral-small-latest", label: "Mistral Small" }],
  cohere:    [{ value: "command-r-plus", label: "Command R+" }, { value: "command-r", label: "Command R" }],
  sarvam:    [{ value: "sarvam-2b-v0.5", label: "Sarvam 2B" }],
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
  if (status === "active")   return <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />;
  if (status === "inactive") return <span className="h-1.5 w-1.5 rounded-full bg-zinc-500 shrink-0" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 shrink-0" />;
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

  const embedCode = `<script src="${location.protocol}//${location.host}/api/widget.js"\n        data-agent-id="${agentId}"\n        data-name="${agentName}"\n        data-color="#10b981">\n</script>`;

  const sc: Record<CallStatus, { label: string; color: string; pulse: boolean }> = {
    idle:       { label: "Ready to test",  color: "bg-zinc-500",    pulse: false },
    connecting: { label: "Connecting…",    color: "bg-amber-400",   pulse: true  },
    listening:  { label: "Listening…",     color: "bg-emerald-400", pulse: true  },
    thinking:   { label: "Thinking…",      color: "bg-amber-400",   pulse: true  },
    speaking:   { label: "Speaking…",      color: "bg-sky-400",     pulse: true  },
    ended:      { label: "Call ended",     color: "bg-zinc-500",    pulse: false },
  };
  const s = sc[status];
  const isActive = status !== "idle" && status !== "ended";

  return (
    <div className="space-y-4">
      {/* Status */}
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
        <span className={`w-2 h-2 rounded-full shrink-0 ${s.color} ${s.pulse ? "animate-pulse" : ""}`} />
        <span className="text-sm text-zinc-300">{s.label}</span>
        {status === "ended" && duration !== null && (
          <span className="text-xs text-zinc-500 ml-auto">
            {Math.floor(duration / 60)}m {duration % 60}s
          </span>
        )}
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Transcript */}
      <div ref={transcriptRef} className="h-48 overflow-y-auto space-y-2 pr-1">
        {msgs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-zinc-600 gap-2">
            <Volume2 className="h-7 w-7 opacity-30" />
            <p className="text-xs">Transcript will appear here.</p>
          </div>
        ) : msgs.map((m, i) => (
          <div key={i} className={`flex ${m.speaker === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm ${
              m.speaker === "user"
                ? "bg-zinc-700 text-zinc-100 rounded-br-sm"
                : "bg-emerald-500/10 text-zinc-100 border border-emerald-500/20 rounded-bl-sm"
            }`}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 mb-0.5">
                {m.speaker === "user" ? "You" : agentName}
              </p>
              {m.text}
            </div>
          </div>
        ))}
      </div>

      {/* Controls */}
      {!isActive ? (
        <Button className="w-full gap-2 bg-emerald-600 hover:bg-emerald-500 text-white" onClick={() => void startCall()}>
          <Mic className="h-4 w-4" /> Start Test Call
        </Button>
      ) : (
        <Button variant="destructive" className="w-full gap-2" onClick={endCall}>
          <PhoneOff className="h-4 w-4" /> End Call
        </Button>
      )}

      {/* Embed snippet */}
      <div className="mt-2">
        <p className="text-xs text-zinc-500 mb-1.5">Embed on your website</p>
        <pre className="bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-3 py-2.5 text-[11px] font-mono text-zinc-400 overflow-x-auto whitespace-pre">
          {embedCode}
        </pre>
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 h-7 text-xs text-zinc-500 hover:text-zinc-300 gap-1.5 px-2"
          onClick={() => { navigator.clipboard.writeText(embedCode); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        >
          {copied ? <><Check className="h-3 w-3 text-emerald-400" /> Copied</> : <><Copy className="h-3 w-3" /> Copy snippet</>}
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
  secondaryLanguage?: string; ttsStream?: boolean; ttsSamplingRate?: number;
  ttsEncoding?: string; ttsAudioFormat?: string;
  wordsForInterruption?: number; incrementalDelay?: number;
  backchannelingStartDelay?: number; ambientNoiseEnabled?: boolean; ambientNoiseTrack?: string;
  hangupAfterLlmCall?: boolean; callCancellationPrompt?: string;
  voicemailDetection?: boolean; schedulingGuardrails?: boolean;
  callStartHour?: number; callEndHour?: number;
  summarizationEnabled?: boolean; summarizationPrompt?: string;
  inboundLimit?: number; disallowUnknownNumbers?: boolean; whitelistNumbers?: string;
  callMemoryEnabled?: boolean; callMemorySourceType?: string;
  callMemorySourceUrl?: string; callMemoryAuthToken?: string;
  whatsappProvider?: string; whatsappCredentials?: Record<string, string>;
  whatsappOutcomeMessages?: Array<{
    outcome: string; templateName: string; language: string;
    parameters?: string[]; mediaUrl?: string; mediaFilename?: string; mediaType?: string;
  }>;
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
          <p className="text-xs font-medium text-zinc-300">{label}</p>
          {desc && <p className="text-[10px] text-zinc-600 mt-0.5">{desc}</p>}
        </div>
        <span className="text-xs font-mono bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-300 min-w-[52px] text-center shrink-0 ml-3">
          {display}{unit}
        </span>
      </div>
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v!)} />
      <div className="flex justify-between text-[10px] text-zinc-600">
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
        <p className="text-xs font-medium text-zinc-300">{label}</p>
        {desc && <p className="text-[10px] text-zinc-600 mt-0.5">{desc}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} className="shrink-0 data-[state=checked]:bg-emerald-500" />
    </div>
  );
}

function AgentConfigPanel({ agentId, onDeleted }: { agentId: number; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("agent");
  const [outboundDialogOpen, setOutboundDialogOpen] = useState(false);
  const [toNumber, setToNumber] = useState("");

  const { data: agent, isLoading } = useGetAgent(agentId, {
    query: { queryKey: getGetAgentQueryKey(agentId) },
  });

  const { data: calls, isLoading: callsLoading } = useListCalls(
    { agentId },
    { query: { enabled: activeTab === "logs", queryKey: getListCallsQueryKey({ agentId }) } }
  );

  const update       = useUpdateAgent();
  const toggleAgent  = useToggleAgent();
  const deleteAgent  = useDeleteAgent();
  const { data: kbs } = useListKnowledgeBases();

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
  const [telephony, setTelephony]                           = useState("");

  // ── Tab 4 — Engine ──────────────────────────────────────────────
  const [backchannelingEnabled, setBackchannelingEnabled]   = useState(false);
  const [backchannelingFrequency, setBackchannelingFrequency] = useState(0.3);
  const [noiseCancellationEnabled, setNoiseCancellationEnabled] = useState(false);
  const [endCallPhrases, setEndCallPhrases]                 = useState("");
  const [inactivityMessage, setInactivityMessage]           = useState("");

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
    setAsrLanguage(agent.asrLanguage ?? "en");
    setAsrBackgroundDenoising(agent.asrBackgroundDenoising ?? false);
    setAsrConfidenceThreshold((agent.asrConfidenceThreshold ?? 0.40) as number);
    setAsrEndOfTurnConfidence((agent.asrEndOfTurnConfidence ?? 0.70) as number);
    setAsrEndOfTurnTimeout((agent.asrEndOfTurnTimeout ?? 5000) as number);
    setAsrKeyterms(agent.asrKeyterms ?? "");
    setAsrSmartEndpointing(agent.asrSmartEndpointing ?? "off");
    setAsrAutoFallback(agent.asrAutoFallback ?? false);
    setTtsProvider(agent.ttsProvider ?? "");
    setTtsModel(agent.ttsModel ?? "");
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
    setAgentConfig(((a.agentConfig as AgentCfg) ?? {}) as AgentCfg);
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
          agentConfig,
        } as Parameters<typeof update.mutate>[0]["data"],
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) });
          queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
          setDirty(false);
          toast({ title: "Saved", description: "Assistant updated." });
        },
        onError: () => toast({ title: "Error", description: "Failed to save.", variant: "destructive" }),
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
        <Skeleton className="h-8 w-48 bg-zinc-800" />
        <Skeleton className="h-4 w-72 bg-zinc-800" />
        <Skeleton className="h-32 w-full bg-zinc-800" />
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
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-5 h-12 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-sm text-white truncate">{agentName || agent.name}</span>
          <span className="text-[10px] text-zinc-600 font-mono hidden sm:block">#{String(agent.id).padStart(4, "0")}</span>
          {statusDot(agent.status)}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {dirty && (
            <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5" onClick={handleSave} disabled={update.isPending}>
              {update.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs border-zinc-700 text-zinc-300 hover:bg-zinc-800 gap-1.5" onClick={() => setOutboundDialogOpen(true)}>
            <PhoneOutgoing className="h-3 w-3" /> Call
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-700 w-44">
              <DropdownMenuItem className="text-zinc-300 hover:bg-zinc-800 cursor-pointer text-xs" onClick={handleToggle}>
                <PlayCircle className="mr-2 h-3.5 w-3.5" /> {agent.status === "active" ? "Deactivate" : "Activate"}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-zinc-800" />
              <DropdownMenuItem className="text-red-400 hover:bg-zinc-800 cursor-pointer text-xs" onClick={handleDelete}>
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className="flex items-center gap-4 px-5 py-2 border-b border-zinc-800 bg-zinc-900/40 shrink-0">
        <div className="flex items-center gap-1.5 text-xs text-zinc-400">
          <Phone className="h-3 w-3 text-zinc-500" />
          <span className="font-semibold text-white">{agent.totalCalls ?? 0}</span> calls
        </div>
        <div className="flex items-center gap-1.5 text-xs text-zinc-400">
          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          <span className="font-semibold text-white">{successRate}%</span> success
        </div>
        {agent.avgDurationSeconds != null && (
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Clock className="h-3 w-3 text-zinc-500" />
            <span className="font-semibold text-white">~{agent.avgDurationSeconds}s</span> avg
          </div>
        )}
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
        <div className="border-b border-zinc-800 shrink-0 overflow-x-auto">
          <TabsList className="w-max min-w-full justify-start rounded-none bg-transparent px-3 h-9 gap-0">
            {TABS.map(t => (
              <TabsTrigger key={t.value} value={t.value}
                className="h-9 rounded-none border-b-2 border-transparent bg-transparent px-3 text-[11px] font-medium text-zinc-500 shadow-none transition-none data-[state=active]:border-emerald-500 data-[state=active]:text-white data-[state=active]:shadow-none whitespace-nowrap">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* ═══════════ TAB CONTENTS ═══════════ */}

        {/* ── Tab 1: Agent ── */}
        <TabsContent value="agent" className="flex-1 overflow-y-auto m-0 px-5 py-4">
          <div className="max-w-2xl space-y-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">Agent Name</p>
              <Input value={agentName} onChange={e => { setAgentName(e.target.value); setDirty(true); }}
                className="bg-zinc-800/60 border-zinc-700 text-zinc-200" />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">Agent Type</p>
              <Select value={agentType} onValueChange={mark(setAgentType)}>
                <SelectTrigger className="h-9 text-sm bg-zinc-800/60 border-zinc-700 text-zinc-200"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  <SelectItem value="general" className="text-zinc-300">General Purpose</SelectItem>
                  <SelectItem value="lead_qualification" className="text-zinc-300">Lead Qualification</SelectItem>
                  <SelectItem value="customer_support" className="text-zinc-300">Customer Support</SelectItem>
                  <SelectItem value="appointment_booking" className="text-zinc-300">Appointment Booking</SelectItem>
                  <SelectItem value="survey" className="text-zinc-300">Survey</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">Welcome Message</p>
              <Textarea value={greetingMessage} onChange={e => { setGreetingMessage(e.target.value); setDirty(true); }}
                placeholder="First thing the agent says when a call connects"
                className="bg-zinc-800/60 border-zinc-700 text-zinc-200 text-sm resize-none min-h-[72px] placeholder:text-zinc-600" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Agent Prompt</p>
                <button type="button" className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300"
                  onClick={() => { setSystemPrompt("You are a helpful and professional AI voice assistant. Be concise, clear, and friendly in all responses."); setDirty(true); }}>
                  <Sparkles className="h-3 w-3" /> Generate
                </button>
              </div>
              <Textarea value={systemPrompt} onChange={e => { setSystemPrompt(e.target.value); setDirty(true); }}
                placeholder="You are a helpful AI voice assistant…"
                className="bg-zinc-800/60 border-zinc-700 text-zinc-200 text-sm resize-none min-h-[200px] placeholder:text-zinc-600" />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">Webhook URL <span className="normal-case text-zinc-600 font-normal">(optional)</span></p>
              <Input value={webhookUrl} onChange={e => { setWebhookUrl(e.target.value); setDirty(true); }}
                placeholder="https://your-server.com/webhook"
                className="bg-zinc-800/60 border-zinc-700 text-zinc-200 text-sm placeholder:text-zinc-600" />
              <p className="text-[10px] text-zinc-600 mt-1">Fires a POST with call summary JSON after each call ends.</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">Knowledge Base</p>
              <Select value={knowledgeBaseId?.toString() ?? "none"} onValueChange={v => { setKnowledgeBaseId(v === "none" ? null : parseInt(v)); setDirty(true); }}>
                <SelectTrigger className="h-8 text-xs bg-zinc-800/60 border-zinc-700 text-zinc-200"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  <SelectItem value="none" className="text-zinc-400 text-xs">— None —</SelectItem>
                  {(kbs ?? []).map(kb => <SelectItem key={kb.id} value={kb.id.toString()} className="text-zinc-300 text-xs">{kb.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-zinc-600 mt-1">Relevant chunks are injected into the system prompt on every call.</p>
            </div>
          </div>
        </TabsContent>

        {/* ── Tab 2: LLM ── */}
        <TabsContent value="llm" className="flex-1 overflow-y-auto m-0 px-5 py-4">
          <div className="max-w-2xl space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-3.5 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Provider</p>
                <Select value={llmProvider} onValueChange={v => { mark(setLlmProvider)(v); setLlmModel(LLM_MODELS[v]?.[0]?.value ?? ""); }}>
                  <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-700">
                    {LLM_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-zinc-300 text-xs">{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-3.5 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Model</p>
                {llmModelOptions.length > 0
                  ? <Select value={llmModel} onValueChange={mark(setLlmModel)}>
                      <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-zinc-900 border-zinc-700">
                        {llmModelOptions.map(m => <SelectItem key={m.value} value={m.value} className="text-zinc-300 text-xs">{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  : <Input value={llmModel} onChange={e => { setLlmModel(e.target.value); setDirty(true); }} placeholder="Model name"
                      className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200" />
                }
              </div>
            </div>
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4 space-y-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Sampling Parameters</p>
              <SliderRow label="Temperature" desc="Randomness — higher = more creative" value={temperature} onChange={v => { setTemperature(v); setDirty(true); }} min={0} max={2} step={0.01} />
              <SliderRow label="Max Tokens" desc="Maximum tokens in the LLM response" value={cfg.maxTokens ?? 200} onChange={v => setCfg({ maxTokens: v })} min={50} max={2000} step={10} />
              <SliderRow label="Top P" desc="Nucleus sampling — lower = more focused" value={cfg.topP ?? 1} onChange={v => setCfg({ topP: v })} min={0} max={1} step={0.01} />
              <SliderRow label="Min P" desc="Minimum token probability" value={cfg.minP ?? 0} onChange={v => setCfg({ minP: v })} min={0} max={1} step={0.01} />
              <SliderRow label="Top K" desc="Only sample from top K tokens (0 = disabled)" value={cfg.topK ?? 0} onChange={v => setCfg({ topK: v })} min={0} max={200} step={1} />
              <SliderRow label="Presence Penalty" desc="Penalises repeated topics" value={cfg.presencePenalty ?? 0} onChange={v => setCfg({ presencePenalty: v })} min={-2} max={2} step={0.01} />
              <SliderRow label="Frequency Penalty" desc="Penalises repeated words" value={cfg.frequencyPenalty ?? 0} onChange={v => setCfg({ frequencyPenalty: v })} min={-2} max={2} step={0.01} />
              <ToggleRow label="Request JSON Response" desc="Force model to output structured JSON" checked={cfg.requestJsonResponse ?? false} onChange={v => setCfg({ requestJsonResponse: v })} />
            </div>
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700/40">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Guardrail Routes</p>
                <button type="button" onClick={() => setCfg({ guardrailRoutes: [...(cfg.guardrailRoutes ?? []), { name: "", scoreThreshold: 0.8, utterances: "", response: "" }] })}
                  className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1">
                  <Plus className="h-3 w-3" /> Add Route
                </button>
              </div>
              {!(cfg.guardrailRoutes?.length) ? (
                <p className="text-[11px] text-zinc-600 px-4 py-3">No guardrail routes. Add routes to intercept specific user intents.</p>
              ) : (
                <div className="divide-y divide-zinc-700/40">
                  {cfg.guardrailRoutes!.map((route, i) => (
                    <div key={i} className="px-4 py-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <input value={route.name} onChange={e => { const r = [...cfg.guardrailRoutes!]; r[i] = { ...r[i]!, name: e.target.value }; setCfg({ guardrailRoutes: r }); }}
                          placeholder="Route name" className="flex-1 h-7 rounded-md bg-zinc-900/60 border border-zinc-700 text-zinc-200 text-xs px-2.5 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500" />
                        <button type="button" onClick={() => setCfg({ guardrailRoutes: cfg.guardrailRoutes!.filter((_, j) => j !== i) })} className="text-zinc-600 hover:text-red-400"><X className="h-3.5 w-3.5" /></button>
                      </div>
                      <SliderRow label={`Score threshold: ${route.scoreThreshold.toFixed(2)}`} value={route.scoreThreshold}
                        onChange={v => { const r = [...cfg.guardrailRoutes!]; r[i] = { ...r[i]!, scoreThreshold: v }; setCfg({ guardrailRoutes: r }); }} min={0} max={1} step={0.01} />
                      <textarea value={route.utterances} onChange={e => { const r = [...cfg.guardrailRoutes!]; r[i] = { ...r[i]!, utterances: e.target.value }; setCfg({ guardrailRoutes: r }); }}
                        placeholder="Sample utterances (one per line)" rows={2}
                        className="w-full rounded-md bg-zinc-900/60 border border-zinc-700 text-zinc-200 text-xs px-2.5 py-1.5 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 resize-none" />
                      <input value={route.response} onChange={e => { const r = [...cfg.guardrailRoutes!]; r[i] = { ...r[i]!, response: e.target.value }; setCfg({ guardrailRoutes: r }); }}
                        placeholder="Response to send when triggered"
                        className="w-full h-7 rounded-md bg-zinc-900/60 border border-zinc-700 text-zinc-200 text-xs px-2.5 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500" />
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
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-3.5 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Primary Language</p>
                <Select value={asrLanguage} onValueChange={mark(setAsrLanguage)}>
                  <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-700 max-h-60">
                    {LANGUAGES.map(l => <SelectItem key={l.value} value={l.value} className="text-zinc-300 text-xs">{l.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-3.5 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Secondary Language</p>
                <Select value={cfg.secondaryLanguage ?? "none"} onValueChange={v => setCfg({ secondaryLanguage: v === "none" ? undefined : v })}>
                  <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-700 max-h-60">
                    <SelectItem value="none" className="text-zinc-400 text-xs">— None —</SelectItem>
                    {LANGUAGES.map(l => <SelectItem key={l.value} value={l.value} className="text-zinc-300 text-xs">{l.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Transcriber</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-zinc-400 mb-1">Provider</p>
                  <Select value={asrProvider} onValueChange={v => { mark(setAsrProvider)(v); setAsrModel(ASR_MODELS[v]?.[0]?.value ?? ""); }}>
                    <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-zinc-700">
                      {ASR_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-zinc-300 text-xs">{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <p className="text-xs text-zinc-400 mb-1">Model</p>
                  {asrModelOptions.length > 0
                    ? <Select value={asrModel} onValueChange={mark(setAsrModel)}>
                        <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-zinc-900 border-zinc-700">
                          {asrModelOptions.map(m => <SelectItem key={m.value} value={m.value} className="text-zinc-300 text-xs">{m.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    : <Input value={asrModel} onChange={e => { setAsrModel(e.target.value); setDirty(true); }} placeholder="Model name"
                        className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200" />
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
                <p className="text-xs text-zinc-400 mb-1.5">Smart Endpointing</p>
                <div className="flex border border-zinc-700 rounded-lg p-0.5 bg-zinc-900/60 w-fit">
                  {(["off", "vapi", "livekit"] as const).map(opt => (
                    <button key={opt} type="button" onClick={() => { setAsrSmartEndpointing(opt); setDirty(true); }}
                      className={`text-xs h-7 px-4 rounded-md transition-colors ${asrSmartEndpointing === opt ? "bg-zinc-700 text-white font-semibold" : "text-zinc-500 hover:text-zinc-300"}`}>
                      {opt === "off" ? "Off" : opt === "vapi" ? "VAPI" : "LiveKit"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-zinc-400 mb-1">Keyterms</p>
                <Textarea value={asrKeyterms} onChange={e => { setAsrKeyterms(e.target.value); setDirty(true); }}
                  placeholder="e.g. VoiceOrch, API, webhook" rows={2}
                  className="bg-zinc-900/60 border-zinc-700 text-zinc-200 text-xs resize-none placeholder:text-zinc-600" />
              </div>
            </div>
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Synthesizer</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-zinc-400 mb-1">Provider</p>
                  <Select value={ttsProvider} onValueChange={v => { mark(setTtsProvider)(v); setTtsModel(TTS_MODELS[v]?.[0]?.value ?? ""); }}>
                    <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-zinc-700">
                      {TTS_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-zinc-300 text-xs">{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <p className="text-xs text-zinc-400 mb-1">Voice</p>
                  {TTS_MODELS[ttsProvider]
                    ? <Select value={ttsModel} onValueChange={mark(setTtsModel)}>
                        <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200"><SelectValue placeholder="Select voice" /></SelectTrigger>
                        <SelectContent className="bg-zinc-900 border-zinc-700 max-h-60">
                          {TTS_MODELS[ttsProvider]!.map(m => <SelectItem key={m.value} value={m.value} className="text-zinc-300 text-xs">{m.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    : <Input value={ttsModel} onChange={e => { setTtsModel(e.target.value); setDirty(true); }} placeholder="Voice / model name"
                        className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200" />
                  }
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xs text-zinc-400 mb-1">Sampling Rate</p>
                  <Input type="number" value={cfg.ttsSamplingRate ?? ""} onChange={e => setCfg({ ttsSamplingRate: parseInt(e.target.value) || undefined })}
                    placeholder="e.g. 24000" className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200 placeholder:text-zinc-600" />
                </div>
                <div>
                  <p className="text-xs text-zinc-400 mb-1">Encoding</p>
                  <Select value={cfg.ttsEncoding ?? "none"} onValueChange={v => setCfg({ ttsEncoding: v === "none" ? undefined : v })}>
                    <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200"><SelectValue placeholder="Default" /></SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-zinc-700">
                      <SelectItem value="none" className="text-zinc-400 text-xs">Default</SelectItem>
                      <SelectItem value="pcm_s16le" className="text-zinc-300 text-xs">PCM 16-bit LE</SelectItem>
                      <SelectItem value="mulaw" className="text-zinc-300 text-xs">μ-law</SelectItem>
                      <SelectItem value="alaw" className="text-zinc-300 text-xs">A-law</SelectItem>
                      <SelectItem value="mp3" className="text-zinc-300 text-xs">MP3</SelectItem>
                      <SelectItem value="opus" className="text-zinc-300 text-xs">Opus</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <p className="text-xs text-zinc-400 mb-1">Format</p>
                  <Select value={cfg.ttsAudioFormat ?? "none"} onValueChange={v => setCfg({ ttsAudioFormat: v === "none" ? undefined : v })}>
                    <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200"><SelectValue placeholder="Default" /></SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-zinc-700">
                      <SelectItem value="none" className="text-zinc-400 text-xs">Default</SelectItem>
                      <SelectItem value="wav" className="text-zinc-300 text-xs">WAV</SelectItem>
                      <SelectItem value="mp3" className="text-zinc-300 text-xs">MP3</SelectItem>
                      <SelectItem value="ogg" className="text-zinc-300 text-xs">OGG</SelectItem>
                      <SelectItem value="flac" className="text-zinc-300 text-xs">FLAC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <ToggleRow label="Stream Audio" desc="Enable streaming output for lower latency" checked={cfg.ttsStream ?? false} onChange={v => setCfg({ ttsStream: v })} />
            </div>
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4 space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Telephony</p>
              <Select value={telephony} onValueChange={mark(setTelephony)}>
                <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  {TELEPHONY_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-zinc-300 text-xs">{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </TabsContent>

        {/* ── Tab 4: Engine ── */}
        <TabsContent value="engine" className="flex-1 overflow-y-auto m-0 px-5 py-4">
          <div className="max-w-2xl space-y-5">
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4 space-y-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Interruption</p>
              <SliderRow label="Words for Interruption" desc="How many user words trigger an interruption" value={cfg.wordsForInterruption ?? 2}
                onChange={v => setCfg({ wordsForInterruption: v })} min={1} max={10} step={1} />
              <SliderRow label="Incremental Delay" desc="Delay between LLM streaming chunks" value={cfg.incrementalDelay ?? 100}
                onChange={v => setCfg({ incrementalDelay: v })} min={0} max={2000} step={10} unit="ms" />
            </div>
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4 space-y-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Backchanneling</p>
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
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Ambient &amp; Noise</p>
              <ToggleRow label="Ambient Noise" desc="Play background audio to make the call feel natural"
                checked={cfg.ambientNoiseEnabled ?? false} onChange={v => setCfg({ ambientNoiseEnabled: v })} />
              {cfg.ambientNoiseEnabled && (
                <div>
                  <p className="text-xs text-zinc-400 mb-1">Track</p>
                  <Select value={cfg.ambientNoiseTrack ?? "office-ambience"} onValueChange={v => setCfg({ ambientNoiseTrack: v })}>
                    <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-zinc-700">
                      {["office-ambience","cafe","coffee-shop","convention-hall","home","outdoor","restaurant"].map(t => (
                        <SelectItem key={t} value={t} className="text-zinc-300 text-xs capitalize">{t.replace(/-/g, " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <ToggleRow label="Noise Cancellation" desc="Filter background noise from caller audio"
                checked={noiseCancellationEnabled} onChange={v => { setNoiseCancellationEnabled(v); setDirty(true); }} />
            </div>
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4 space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">End Call Phrases</p>
              <Textarea value={endCallPhrases} onChange={e => { setEndCallPhrases(e.target.value); setDirty(true); }}
                placeholder="goodbye, bye, thanks for calling" rows={2}
                className="bg-zinc-900/60 border-zinc-700 text-zinc-200 text-xs resize-none placeholder:text-zinc-600" />
              <p className="text-[10px] text-zinc-600">Comma-separated phrases that trigger hangup when detected.</p>
            </div>
          </div>
        </TabsContent>

        {/* ── Tab 5: Call ── */}
        <TabsContent value="call" className="flex-1 overflow-y-auto m-0 px-5 py-4">
          <div className="max-w-2xl space-y-5">
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4 space-y-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Duration &amp; Silence</p>
              <SliderRow label="Max Call Duration" desc="Auto-terminate after this duration" value={maxDuration}
                onChange={v => { setMaxDuration(v); setDirty(true); }} min={30} max={3600} step={30} unit="s" />
              <SliderRow label="Hangup After Silence" desc="End call if caller is silent this long" value={silenceTimeout}
                onChange={v => { setSilenceTimeout(v); setDirty(true); }} min={5} max={120} step={5} unit="s" />
              <ToggleRow label="Hangup After LLM Call" desc="Hang up automatically when the LLM finishes its response"
                checked={cfg.hangupAfterLlmCall ?? false} onChange={v => setCfg({ hangupAfterLlmCall: v })} />
            </div>
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Messages</p>
              <div>
                <p className="text-xs text-zinc-400 mb-1">Cancellation Prompt</p>
                <Textarea value={cfg.callCancellationPrompt ?? ""} onChange={e => setCfg({ callCancellationPrompt: e.target.value })}
                  placeholder="What to say when cancelling the call…" rows={2}
                  className="bg-zinc-900/60 border-zinc-700 text-zinc-200 text-xs resize-none placeholder:text-zinc-600" />
              </div>
              <div>
                <p className="text-xs text-zinc-400 mb-1">Inactivity Message</p>
                <Input value={inactivityMessage} onChange={e => { setInactivityMessage(e.target.value); setDirty(true); }}
                  placeholder="Are you still there?" className="h-8 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200 placeholder:text-zinc-600" />
              </div>
            </div>
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Detection</p>
              <ToggleRow label="Voicemail Detection" desc="Detect voicemail and respond accordingly"
                checked={cfg.voicemailDetection ?? false} onChange={v => setCfg({ voicemailDetection: v })} />
            </div>
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Scheduling</p>
              <ToggleRow label="Scheduling Guardrails" desc="Restrict when this agent can make outbound calls"
                checked={cfg.schedulingGuardrails ?? false} onChange={v => setCfg({ schedulingGuardrails: v })} />
              {cfg.schedulingGuardrails && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <p className="text-xs text-zinc-400 mb-1">Call Start (hour 0–23)</p>
                    <Select value={String(cfg.callStartHour ?? 8)} onValueChange={v => setCfg({ callStartHour: parseInt(v) })}>
                      <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-zinc-900 border-zinc-700 max-h-48">
                        {Array.from({ length: 24 }, (_, i) => <SelectItem key={i} value={String(i)} className="text-zinc-300 text-xs">{String(i).padStart(2, "0")}:00</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-400 mb-1">Call End (hour 0–23)</p>
                    <Select value={String(cfg.callEndHour ?? 20)} onValueChange={v => setCfg({ callEndHour: parseInt(v) })}>
                      <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-zinc-900 border-zinc-700 max-h-48">
                        {Array.from({ length: 24 }, (_, i) => <SelectItem key={i} value={String(i)} className="text-zinc-300 text-xs">{String(i).padStart(2, "0")}:00</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── Tab 6: Tools ── */}
        <TabsContent value="tools" className="flex-1 overflow-y-auto m-0 px-5 py-4">
          <div className="max-w-2xl">
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-8 flex flex-col items-center text-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center">
                <Settings2 className="h-5 w-5 text-zinc-500" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-300">Tools — Coming Soon</p>
                <p className="text-xs text-zinc-600 mt-1 max-w-sm">Connect calendar booking, CRM integrations, and custom function calls. Tools let your agent take actions during a call.</p>
              </div>
              <div className="flex flex-wrap gap-2 mt-2 justify-center">
                {["Google Calendar","HubSpot CRM","Salesforce","Custom Webhook"].map(t => (
                  <span key={t} className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-500 rounded-md px-2.5 py-1">{t}</span>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── Tab 7: Analytics ── */}
        <TabsContent value="analytics" className="flex-1 overflow-y-auto m-0 px-5 py-4">
          <div className="max-w-2xl space-y-5">
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Summarization</p>
              <ToggleRow label="Auto-Summarize Calls" desc="Generate a summary of each call transcript after the call ends"
                checked={cfg.summarizationEnabled ?? false} onChange={v => setCfg({ summarizationEnabled: v })} />
              {cfg.summarizationEnabled && (
                <div>
                  <p className="text-xs text-zinc-400 mb-1">Summarization Prompt</p>
                  <Textarea value={cfg.summarizationPrompt ?? ""} onChange={e => setCfg({ summarizationPrompt: e.target.value })}
                    placeholder="Summarize the key points, next steps, and any issues raised…" rows={4}
                    className="bg-zinc-900/60 border-zinc-700 text-zinc-200 text-xs resize-none placeholder:text-zinc-600" />
                </div>
              )}
            </div>
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700/40">
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-3.5 w-3.5 text-emerald-400" />
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Disposition Fields</p>
                </div>
                <button type="button" onClick={() => { setDispositionSchema(prev => [...prev, { key: "", label: "", type: "text", required: false, options: "" }]); setDirty(true); }}
                  className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1">
                  <Plus className="h-3 w-3" /> Add Field
                </button>
              </div>
              {dispositionSchema.length === 0 ? (
                <p className="text-[11px] text-zinc-600 px-4 py-3">No fields defined. Fields are extracted from call transcripts by the LLM after each call.</p>
              ) : (
                <div className="divide-y divide-zinc-700/40">
                  {dispositionSchema.map((field, i) => (
                    <div key={i} className="px-4 py-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <input value={field.key} onChange={e => { const n = [...dispositionSchema]; n[i] = { ...n[i]!, key: e.target.value }; setDispositionSchema(n); setDirty(true); }}
                          placeholder="key_name" className="flex-1 h-7 rounded-md bg-zinc-900/60 border border-zinc-700 text-zinc-200 text-xs px-2.5 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500" />
                        <input value={field.label} onChange={e => { const n = [...dispositionSchema]; n[i] = { ...n[i]!, label: e.target.value }; setDispositionSchema(n); setDirty(true); }}
                          placeholder="Display Label" className="flex-1 h-7 rounded-md bg-zinc-900/60 border border-zinc-700 text-zinc-200 text-xs px-2.5 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500" />
                        <Select value={field.type} onValueChange={v => { const n = [...dispositionSchema]; n[i] = { ...n[i]!, type: v }; setDispositionSchema(n); setDirty(true); }}>
                          <SelectTrigger className="h-7 w-24 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-zinc-900 border-zinc-700">
                            <SelectItem value="text" className="text-zinc-300 text-xs">Text</SelectItem>
                            <SelectItem value="number" className="text-zinc-300 text-xs">Number</SelectItem>
                            <SelectItem value="boolean" className="text-zinc-300 text-xs">Yes / No</SelectItem>
                            <SelectItem value="choice" className="text-zinc-300 text-xs">Choice</SelectItem>
                          </SelectContent>
                        </Select>
                        <button type="button" onClick={() => { setDispositionSchema(prev => prev.filter((_, j) => j !== i)); setDirty(true); }} className="text-zinc-600 hover:text-red-400"><X className="h-3.5 w-3.5" /></button>
                      </div>
                      {field.type === "choice" && (
                        <input value={field.options ?? ""} onChange={e => { const n = [...dispositionSchema]; n[i] = { ...n[i]!, options: e.target.value }; setDispositionSchema(n); setDirty(true); }}
                          placeholder="Options: resolved, escalated, callback"
                          className="w-full h-7 rounded-md bg-zinc-900/60 border border-zinc-700 text-zinc-200 text-xs px-2.5 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500" />
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
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4 space-y-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Call Limits</p>
              <SliderRow label="Inbound Limit" desc="Max concurrent inbound calls (−1 = unlimited)" value={cfg.inboundLimit ?? -1}
                onChange={v => setCfg({ inboundLimit: v })} min={-1} max={50} step={1} />
              <ToggleRow label="Disallow Unknown Numbers" desc="Reject calls from numbers not on the whitelist"
                checked={cfg.disallowUnknownNumbers ?? false} onChange={v => setCfg({ disallowUnknownNumbers: v })} />
              {cfg.disallowUnknownNumbers && (
                <div>
                  <p className="text-xs text-zinc-400 mb-1">Whitelist Numbers</p>
                  <Textarea value={cfg.whitelistNumbers ?? ""} onChange={e => setCfg({ whitelistNumbers: e.target.value })}
                    placeholder="+1234567890, +0987654321" rows={2}
                    className="bg-zinc-900/60 border-zinc-700 text-zinc-200 text-xs resize-none placeholder:text-zinc-600" />
                  <p className="text-[10px] text-zinc-600 mt-1">Comma-separated E.164 numbers.</p>
                </div>
              )}
            </div>
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Call Memory / RAG</p>
              <ToggleRow label="Enable Call Memory" desc="Ingest call data into a RAG source for context-aware responses"
                checked={cfg.callMemoryEnabled ?? false} onChange={v => setCfg({ callMemoryEnabled: v })} />
              {cfg.callMemoryEnabled && (
                <>
                  <div>
                    <p className="text-xs text-zinc-400 mb-1">Source Type</p>
                    <Select value={cfg.callMemorySourceType ?? "api"} onValueChange={v => setCfg({ callMemorySourceType: v })}>
                      <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-zinc-900 border-zinc-700">
                        <SelectItem value="api" className="text-zinc-300 text-xs">REST API</SelectItem>
                        <SelectItem value="s3" className="text-zinc-300 text-xs">Amazon S3</SelectItem>
                        <SelectItem value="gcs" className="text-zinc-300 text-xs">Google Cloud Storage</SelectItem>
                        <SelectItem value="database" className="text-zinc-300 text-xs">Database</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-400 mb-1">Source URL</p>
                    <Input value={cfg.callMemorySourceUrl ?? ""} onChange={e => setCfg({ callMemorySourceUrl: e.target.value })}
                      placeholder="https://api.your-rag.com/ingest" className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200 placeholder:text-zinc-600" />
                  </div>
                  <div>
                    <p className="text-xs text-zinc-400 mb-1">Auth Token</p>
                    <Input type="password" value={cfg.callMemoryAuthToken ?? ""} onChange={e => setCfg({ callMemoryAuthToken: e.target.value })}
                      placeholder="Bearer token or API key" className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200 placeholder:text-zinc-600" />
                  </div>
                </>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── Tab 9: WhatsApp ── */}
        <TabsContent value="whatsapp" className="flex-1 overflow-y-auto m-0 px-5 py-4">
          <div className="max-w-2xl space-y-5">
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Provider</p>
              <Select value={cfg.whatsappProvider ?? "none"} onValueChange={v => setCfg({ whatsappProvider: v === "none" ? undefined : v })}>
                <SelectTrigger className="h-8 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200"><SelectValue placeholder="Select provider" /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  <SelectItem value="none" className="text-zinc-400 text-xs">— Not configured —</SelectItem>
                  <SelectItem value="aisensy" className="text-zinc-300 text-xs">AiSensy</SelectItem>
                  <SelectItem value="meta" className="text-zinc-300 text-xs">Meta (Business API)</SelectItem>
                  <SelectItem value="twilio" className="text-zinc-300 text-xs">Twilio WhatsApp</SelectItem>
                  <SelectItem value="360dialog" className="text-zinc-300 text-xs">360dialog</SelectItem>
                  <SelectItem value="wati" className="text-zinc-300 text-xs">WATI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {cfg.whatsappProvider && cfg.whatsappProvider !== "none" && (
              <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4 space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Credentials</p>
                {(cfg.whatsappProvider === "aisensy") && (
                  <>
                    <div><p className="text-xs text-zinc-400 mb-1">API Key</p>
                      <Input type="password" value={cfg.whatsappCredentials?.["apiKey"] ?? ""} onChange={e => setCfg({ whatsappCredentials: { ...cfg.whatsappCredentials, apiKey: e.target.value } })}
                        placeholder="AiSensy API key" className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200" />
                    </div>
                    <div><p className="text-xs text-zinc-400 mb-1">Campaign Name</p>
                      <Input value={cfg.whatsappCredentials?.["campaignName"] ?? ""} onChange={e => setCfg({ whatsappCredentials: { ...cfg.whatsappCredentials, campaignName: e.target.value } })}
                        placeholder="Campaign name" className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200" />
                    </div>
                  </>
                )}
                {cfg.whatsappProvider === "meta" && (
                  <>
                    <div><p className="text-xs text-zinc-400 mb-1">Access Token</p>
                      <Input type="password" value={cfg.whatsappCredentials?.["accessToken"] ?? ""} onChange={e => setCfg({ whatsappCredentials: { ...cfg.whatsappCredentials, accessToken: e.target.value } })}
                        placeholder="Meta API access token" className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200" />
                    </div>
                    <div><p className="text-xs text-zinc-400 mb-1">Phone Number ID</p>
                      <Input value={cfg.whatsappCredentials?.["phoneNumberId"] ?? ""} onChange={e => setCfg({ whatsappCredentials: { ...cfg.whatsappCredentials, phoneNumberId: e.target.value } })}
                        placeholder="e.g. 123456789012345" className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200" />
                    </div>
                  </>
                )}
                {["twilio","360dialog","wati"].includes(cfg.whatsappProvider) && (
                  <>
                    <div><p className="text-xs text-zinc-400 mb-1">API Key / SID</p>
                      <Input type="password" value={cfg.whatsappCredentials?.["apiKey"] ?? ""} onChange={e => setCfg({ whatsappCredentials: { ...cfg.whatsappCredentials, apiKey: e.target.value } })}
                        placeholder="API key or account SID" className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200" />
                    </div>
                    <div><p className="text-xs text-zinc-400 mb-1">API Secret / Auth Token</p>
                      <Input type="password" value={cfg.whatsappCredentials?.["apiSecret"] ?? ""} onChange={e => setCfg({ whatsappCredentials: { ...cfg.whatsappCredentials, apiSecret: e.target.value } })}
                        placeholder="API secret or auth token" className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200" />
                    </div>
                  </>
                )}
              </div>
            )}
            {cfg.whatsappProvider && cfg.whatsappProvider !== "none" && (
              <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700/40">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Outcome Messages</p>
                  <button type="button" onClick={() => setCfg({ whatsappOutcomeMessages: [...(cfg.whatsappOutcomeMessages ?? []), { outcome: "interested", templateName: "", language: "en" }] })}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1"><Plus className="h-3 w-3" /> Add</button>
                </div>
                {!(cfg.whatsappOutcomeMessages?.length) ? (
                  <p className="text-[11px] text-zinc-600 px-4 py-3">No outcome messages configured.</p>
                ) : (
                  <div className="divide-y divide-zinc-700/40">
                    {cfg.whatsappOutcomeMessages!.map((msg, i) => (
                      <div key={i} className="px-4 py-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Select value={msg.outcome} onValueChange={v => { const m = [...cfg.whatsappOutcomeMessages!]; m[i] = { ...m[i]!, outcome: v }; setCfg({ whatsappOutcomeMessages: m }); }}>
                            <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200 w-36"><SelectValue /></SelectTrigger>
                            <SelectContent className="bg-zinc-900 border-zinc-700">
                              <SelectItem value="interested" className="text-zinc-300 text-xs">Interested</SelectItem>
                              <SelectItem value="callback" className="text-zinc-300 text-xs">Callback</SelectItem>
                              <SelectItem value="no_answer" className="text-zinc-300 text-xs">No Answer</SelectItem>
                              <SelectItem value="not_interested" className="text-zinc-300 text-xs">Not Interested</SelectItem>
                            </SelectContent>
                          </Select>
                          <input value={msg.templateName} onChange={e => { const m = [...cfg.whatsappOutcomeMessages!]; m[i] = { ...m[i]!, templateName: e.target.value }; setCfg({ whatsappOutcomeMessages: m }); }}
                            placeholder="Template name" className="flex-1 h-7 rounded-md bg-zinc-900/60 border border-zinc-700 text-zinc-200 text-xs px-2.5 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500" />
                          <button type="button" onClick={() => setCfg({ whatsappOutcomeMessages: cfg.whatsappOutcomeMessages!.filter((_, j) => j !== i) })} className="text-zinc-600 hover:text-red-400"><X className="h-3.5 w-3.5" /></button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input value={msg.mediaUrl ?? ""} onChange={e => { const m = [...cfg.whatsappOutcomeMessages!]; m[i] = { ...m[i]!, mediaUrl: e.target.value }; setCfg({ whatsappOutcomeMessages: m }); }}
                            placeholder="Media URL (optional)" className="h-7 rounded-md bg-zinc-900/60 border border-zinc-700 text-zinc-200 text-xs px-2.5 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500" />
                          <input value={msg.mediaFilename ?? ""} onChange={e => { const m = [...cfg.whatsappOutcomeMessages!]; m[i] = { ...m[i]!, mediaFilename: e.target.value }; setCfg({ whatsappOutcomeMessages: m }); }}
                            placeholder="Filename (optional)" className="h-7 rounded-md bg-zinc-900/60 border border-zinc-700 text-zinc-200 text-xs px-2.5 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500" />
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
              <thead className="bg-zinc-900/60 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2.5 text-zinc-500 font-medium">Date</th>
                  <th className="text-left px-4 py-2.5 text-zinc-500 font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 text-zinc-500 font-medium">To / From</th>
                  <th className="text-left px-4 py-2.5 text-zinc-500 font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {callsLoading ? (
                  [1,2,3].map(i => (
                    <tr key={i}>{[1,2,3,4].map(j => <td key={j} className="px-4 py-2.5"><Skeleton className="h-4 w-full bg-zinc-800" /></td>)}</tr>
                  ))
                ) : (calls ?? []).length === 0 ? (
                  <tr><td colSpan={4} className="text-center text-zinc-600 py-10">No calls yet for this assistant.</td></tr>
                ) : (calls ?? []).map(call => (
                  <tr key={call.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-2.5 text-zinc-400 whitespace-nowrap">{format(new Date(call.createdAt), "MMM d, HH:mm")}</td>
                    <td className="px-4 py-2.5">
                      {call.status === "completed"   && <span className="text-emerald-400">completed</span>}
                      {call.status === "failed"      && <span className="text-red-400">failed</span>}
                      {call.status === "in_progress" && <span className="text-amber-400">in progress</span>}
                      {!["completed","failed","in_progress"].includes(call.status) && <span className="text-zinc-500">{call.status}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-400 font-mono text-[11px]">{call.toNumber || "—"}</td>
                    <td className="px-4 py-2.5 text-zinc-400">{call.durationSeconds != null ? `${call.durationSeconds}s` : "—"}</td>
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
        <DialogContent className="bg-zinc-900 border-zinc-700 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <PhoneOutgoing className="h-4 w-4 text-emerald-400" /> Make a Call
            </DialogTitle>
            <DialogDescription className="text-zinc-400 text-sm">
              Dial a number using <span className="capitalize font-medium text-zinc-300">{agent.telephonyProvider}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label className="text-zinc-400 text-xs">Destination number (E.164)</Label>
            <Input placeholder="+1234567890" value={toNumber} onChange={e => setToNumber(e.target.value)} className="bg-zinc-800 border-zinc-700 text-zinc-200" />
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-zinc-700 text-zinc-400" onClick={() => setOutboundDialogOpen(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-500 text-white" disabled={!toNumber.trim()}>
              <PhoneOutgoing className="h-4 w-4 mr-2" /> Call Now
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
        onError: () => toast({ title: "Error", description: "Failed to create assistant.", variant: "destructive" }),
      }
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <div className="flex items-center gap-3 px-5 h-12 border-b border-zinc-800 shrink-0">
        <span className="font-semibold text-sm text-white">New Assistant</span>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="max-w-2xl space-y-5">
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Name</p>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              className="bg-zinc-800/60 border-zinc-700 text-zinc-200"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-3.5 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Transcriber</p>
              <Select value={asr} onValueChange={setAsr}>
                <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  {ASR_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-zinc-300 text-xs">{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-3.5 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Model</p>
              <Select value={llm} onValueChange={(v) => { setLlm(v); setLlmModel(LLM_MODELS[v]?.[0]?.value ?? ""); }}>
                <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  {LLM_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-zinc-300 text-xs">{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {LLM_MODELS[llm] && (
                <Select value={llmModel} onValueChange={setLlmModel}>
                  <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-400"><SelectValue placeholder="Select model" /></SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-700">
                    {LLM_MODELS[llm]!.map(m => (
                      <SelectItem key={m.value} value={m.value} className="text-zinc-300 text-xs">{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-3.5 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Voice</p>
              <Select
                value={tts}
                onValueChange={(v) => {
                  setTts(v);
                  setTtsModel(TTS_MODELS[v]?.[0]?.value ?? "");
                }}
              >
                <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  {TTS_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-zinc-300 text-xs">{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {TTS_MODELS[tts] && (
                <Select value={ttsModel} onValueChange={setTtsModel}>
                  <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-400"><SelectValue placeholder="Select model / voice" /></SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-700">
                    {TTS_MODELS[tts]!.map(m => (
                      <SelectItem key={m.value} value={m.value} className="text-zinc-300 text-xs">{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-3.5 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Telephony</p>
              <Select value={tel} onValueChange={setTel}>
                <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  {TELEPHONY_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-zinc-300 text-xs">{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">System Prompt</p>
            <Textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              className="bg-zinc-800/60 border-zinc-700 text-zinc-200 text-sm min-h-[120px] resize-none placeholder:text-zinc-600"
            />
          </div>

          <Button
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white gap-2"
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
  const [selectedId, setSelectedId] = useState<number | "new" | null>(null);
  const [search, setSearch]         = useState("");

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
      <div className="w-64 shrink-0 flex flex-col border-r border-zinc-800 bg-[#0f0f0f]">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 h-12 border-b border-zinc-800 shrink-0">
          <span className="font-semibold text-sm text-white flex-1">Assistants</span>
          {agents && (
            <span className="text-[10px] bg-zinc-800 text-zinc-400 rounded px-1.5 py-0.5 font-mono">
              {agents.length}
            </span>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-zinc-400 hover:text-white hover:bg-zinc-800"
            onClick={() => setSelectedId("new")}
            title="Create assistant"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Create button */}
        <div className="px-3 pt-3 pb-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="w-full h-7 text-xs border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 gap-1.5 justify-start"
            onClick={() => setSelectedId("new")}
          >
            <Plus className="h-3 w-3" /> Create Assistant
          </Button>
        </div>

        {/* Search */}
        <div className="px-3 pb-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1.5 h-3.5 w-3.5 text-zinc-600" />
            <Input
              placeholder="Search assistants…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-7 pl-7 text-xs bg-zinc-800/60 border-zinc-700 text-zinc-300 placeholder:text-zinc-600 focus:border-zinc-600"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="px-3 space-y-2 py-2">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-14 rounded-lg bg-zinc-800/50 animate-pulse" />
              ))}
            </div>
          ) : filtered?.length === 0 ? (
            <div className="px-3 py-8 text-center text-zinc-600 text-xs">No assistants found.</div>
          ) : (
            filtered?.map(agent => {
              const isSelected = selectedId === agent.id;
              const tags = [agent.asrProvider, agent.llmProvider, agent.ttsProvider].map(providerTag);
              return (
                <button
                  key={agent.id}
                  onClick={() => setSelectedId(agent.id)}
                  className={`w-full text-left px-3 py-2.5 transition-colors border-b border-zinc-800/50 ${
                    isSelected
                      ? "bg-zinc-800/80 border-l-2 border-l-emerald-500"
                      : "hover:bg-zinc-800/40 border-l-2 border-l-transparent"
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {statusDot(agent.status)}
                    <span className={`text-xs font-medium truncate ${isSelected ? "text-white" : "text-zinc-300"}`}>
                      {agent.name}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 ml-3">
                    {tags.map(t => (
                      <span key={t} className="text-[10px] text-zinc-600 bg-zinc-800/60 rounded px-1">
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
      <div className="flex-1 flex flex-col min-w-0 bg-[#111111]">
        {selectedId === "new" ? (
          <NewAgentPanel onCreated={(id) => setSelectedId(id)} />
        ) : selectedId !== null ? (
          <AgentConfigPanel agentId={selectedId} onDeleted={() => setSelectedId(agents?.[0]?.id ?? null)} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-zinc-600 gap-3">
            <Mic className="h-10 w-10 opacity-20" />
            <div>
              <p className="text-sm font-medium text-zinc-500">No assistant selected</p>
              <p className="text-xs mt-1">Choose one from the list or create a new one.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-zinc-700 text-zinc-400 hover:bg-zinc-800 gap-1.5 mt-2"
              onClick={() => setSelectedId("new")}
            >
              <Plus className="h-3.5 w-3.5" /> Create Assistant
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
