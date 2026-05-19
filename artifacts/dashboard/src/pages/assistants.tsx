import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import {
  Search, Plus, Phone, Mic, MicOff, PhoneOff, Volume2,
  Settings2, MoreHorizontal, Pencil, Trash2, PlayCircle,
  Check, Copy, Loader2, ChevronDown, Sparkles, PhoneOutgoing,
  BarChart2, Clock, CheckCircle2, XCircle, BookOpen,
  AlertTriangle, Target, AlignLeft, Zap, RefreshCw,
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

function AgentConfigPanel({ agentId, onDeleted }: { agentId: number; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("assistant");
  const [outboundDialogOpen, setOutboundDialogOpen] = useState(false);
  const [toNumber, setToNumber] = useState("");

  const { data: agent, isLoading } = useGetAgent(agentId, {
    query: { queryKey: getGetAgentQueryKey(agentId) },
  });

  const { data: calls, isLoading: callsLoading } = useListCalls(
    { agentId },
    { query: { enabled: activeTab === "logs", queryKey: getListCallsQueryKey({ agentId }) } }
  );

  const update = useUpdateAgent();
  const toggleAgent = useToggleAgent();
  const deleteAgent = useDeleteAgent();

  // Local editable state for inline editing
  const [systemPrompt, setSystemPrompt]                     = useState("");
  const [greetingMessage, setGreetingMessage]               = useState("");
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
  const [llmProvider, setLlmProvider]                       = useState("");
  const [llmModel, setLlmModel]                             = useState("");
  const [ttsProvider, setTtsProvider]                       = useState("");
  const [ttsModel, setTtsModel]                             = useState("");
  const [telephony, setTelephony]                           = useState("");
  const [knowledgeBaseId, setKnowledgeBaseId]               = useState<number | null>(null);
  const [dirty, setDirty]                                   = useState(false);

  const { data: kbs } = useListKnowledgeBases();

  useEffect(() => {
    if (!agent) return;
    setSystemPrompt(agent.systemPrompt ?? "");
    setGreetingMessage(agent.greetingMessage ?? "");
    setAsrProvider(agent.asrProvider ?? "");
    setAsrModel(agent.asrModel ?? "");
    setAsrLanguage(agent.asrLanguage ?? "en");
    setAsrBackgroundDenoising(agent.asrBackgroundDenoising ?? false);
    setAsrConfidenceThreshold(agent.asrConfidenceThreshold ?? 0.40);
    setAsrEndOfTurnConfidence(agent.asrEndOfTurnConfidence ?? 0.70);
    setAsrEndOfTurnTimeout(agent.asrEndOfTurnTimeout ?? 5000);
    setAsrKeyterms(agent.asrKeyterms ?? "");
    setAsrSmartEndpointing(agent.asrSmartEndpointing ?? "off");
    setAsrAutoFallback(agent.asrAutoFallback ?? false);
    setLlmProvider(agent.llmProvider ?? "");
    setLlmModel(agent.llmModel ?? "");
    setTtsProvider(agent.ttsProvider ?? "");
    setTtsModel(agent.ttsModel ?? "");
    setTelephony(agent.telephonyProvider ?? "");
    setKnowledgeBaseId(agent.knowledgeBaseId ?? null);
    setDirty(false);
  }, [agent?.id]);

  function mark<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setDirty(true); };
  }

  function handleSave() {
    update.mutate(
      {
        id: agentId,
        data: {
          systemPrompt,
          greetingMessage: greetingMessage || undefined,
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
          llmProvider, llmModel: llmModel || undefined,
          ttsProvider, ttsModel: ttsModel || undefined,
          telephonyProvider: telephony,
          knowledgeBaseId: knowledgeBaseId ?? undefined,
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

  const callStatusBadge = (s: string) => {
    if (s === "completed")   return <span className="text-emerald-400 text-xs">completed</span>;
    if (s === "failed")      return <span className="text-red-400 text-xs">failed</span>;
    if (s === "in_progress") return <span className="text-amber-400 text-xs">in progress</span>;
    return <span className="text-zinc-500 text-xs">{s}</span>;
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 h-12 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-sm text-white truncate">{agent.name}</span>
          <span className="text-[10px] text-zinc-600 font-mono hidden sm:block">
            #{String(agent.id).padStart(4, "0")}
          </span>
          {statusDot(agent.status)}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {dirty && (
            <Button
              size="sm"
              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5"
              onClick={handleSave}
              disabled={update.isPending}
            >
              {update.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Save
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-zinc-700 text-zinc-300 hover:bg-zinc-800 gap-1.5"
            onClick={() => setOutboundDialogOpen(true)}
          >
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
                <PlayCircle className="mr-2 h-3.5 w-3.5" />
                {agent.status === "active" ? "Deactivate" : "Activate"}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-zinc-800" />
              <DropdownMenuItem className="text-red-400 hover:bg-zinc-800 cursor-pointer text-xs" onClick={handleDelete}>
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 px-5 py-2.5 border-b border-zinc-800 bg-zinc-900/40 shrink-0">
        <div className="flex items-center gap-1.5 text-xs text-zinc-400">
          <Phone className="h-3 w-3 text-zinc-500" />
          <span className="font-semibold text-white">{agent.totalCalls ?? 0}</span>
          <span>calls</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-zinc-400">
          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          <span className="font-semibold text-white">{successRate}%</span>
          <span>success</span>
        </div>
        {agent.avgDurationSeconds != null && (
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Clock className="h-3 w-3 text-zinc-500" />
            <span className="font-semibold text-white">{agent.avgDurationSeconds}s</span>
            <span>avg duration</span>
          </div>
        )}
      </div>

      {/* VAPI-style cost + latency bar */}
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
        <TabsList className="w-full justify-start rounded-none border-b border-zinc-800 bg-transparent px-5 h-9 shrink-0 gap-0">
          {["assistant", "logs", "test"].map((t) => (
            <TabsTrigger
              key={t}
              value={t}
              className="capitalize h-9 rounded-none border-b-2 border-transparent bg-transparent px-4 text-xs text-zinc-500 data-[state=active]:border-emerald-500 data-[state=active]:text-white data-[state=active]:bg-transparent font-medium"
            >
              {t === "test" ? "Test Call" : t.charAt(0).toUpperCase() + t.slice(1)}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Assistant tab ── */}
        <TabsContent value="assistant" className="flex-1 overflow-y-auto m-0 px-5 py-4">
          <div className="max-w-2xl space-y-6">
            {/* Provider cards — 2×2 grid */}
            <div className="grid grid-cols-2 gap-3">
              {/* Transcriber */}
              <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-3.5 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Transcriber</p>
                <Select value={asrProvider} onValueChange={(v) => { mark(setAsrProvider)(v); setAsrModel(ASR_MODELS[v]?.[0]?.value ?? ""); setAsrLanguage(ASR_LANGUAGES[v]?.[0]?.value ?? "en"); }}>
                  <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-700">
                    {ASR_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-zinc-300 text-xs">{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {asrModelOptions.length > 0 && (
                  <Select value={asrModel || asrModelOptions[0]?.value} onValueChange={mark(setAsrModel)}>
                    <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-400">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-zinc-700">
                      {asrModelOptions.map(m => <SelectItem key={m.value} value={m.value} className="text-zinc-300 text-xs">{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Model */}
              <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-3.5 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Model</p>
                <Select value={llmProvider} onValueChange={(v) => { mark(setLlmProvider)(v); setLlmModel(LLM_MODELS[v]?.[0]?.value ?? ""); }}>
                  <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-700">
                    {LLM_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-zinc-300 text-xs">{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {llmModelOptions.length > 0 && (
                  <Select value={llmModel} onValueChange={mark(setLlmModel)}>
                    <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-400">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-zinc-700">
                      {llmModelOptions.map(m => <SelectItem key={m.value} value={m.value} className="text-zinc-300 text-xs">{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Voice */}
              <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-3.5 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Voice</p>
                <Select
                  value={ttsProvider}
                  onValueChange={(v) => {
                    mark(setTtsProvider)(v);
                    setTtsModel(TTS_MODELS[v]?.[0]?.value ?? "");
                  }}
                >
                  <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-700">
                    {TTS_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-zinc-300 text-xs">{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {TTS_MODELS[ttsProvider] && (
                  <Select value={ttsModel} onValueChange={mark(setTtsModel)}>
                    <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-400">
                      <SelectValue placeholder="Select model / voice" />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-zinc-700">
                      {TTS_MODELS[ttsProvider]!.map(m => (
                        <SelectItem key={m.value} value={m.value} className="text-zinc-300 text-xs">{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Telephony */}
              <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-3.5 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Telephony</p>
                <Select value={telephony} onValueChange={mark(setTelephony)}>
                  <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-700">
                    {TELEPHONY_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} className="text-zinc-300 text-xs">{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* ── Transcriber Settings ─────────────────────────────────────── */}
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl overflow-hidden">
              {/* Header */}
              <div className="flex items-start gap-2.5 px-4 py-3 border-b border-zinc-700/40">
                <Mic className="h-3.5 w-3.5 text-sky-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-zinc-300">Transcriber Settings</p>
                  <p className="text-[10px] text-zinc-600 mt-0.5">Configure the speech-to-text transcriber that converts caller speech into text for the LLM.</p>
                </div>
              </div>

              <div className="px-4 py-4 space-y-5">
                {/* Language */}
                {(ASR_LANGUAGES[asrProvider] ?? []).length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-zinc-400">Language</Label>
                    <Select value={asrLanguage} onValueChange={mark(setAsrLanguage)}>
                      <SelectTrigger className="h-8 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200">
                        <SelectValue placeholder="Select language" />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-900 border-zinc-700">
                        {(ASR_LANGUAGES[asrProvider] ?? []).map(l => (
                          <SelectItem key={l.value} value={l.value} className="text-zinc-300 text-xs">{l.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Flux model hint */}
                {asrProvider === "deepgram" && (asrModel || "") === "flux" && (
                  <div className="flex items-start gap-2 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-[11px] text-amber-400/90 leading-relaxed">
                      Make sure your Smart Endpointing Plan in Advanced &gt; Start Speaking Plan is disabled to leverage Flux end-of-turn detection.
                    </p>
                  </div>
                )}

                {/* Background Denoising */}
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
                    <Volume2 className="h-3.5 w-3.5 text-zinc-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-medium text-zinc-300">Background Denoising</p>
                    <p className="text-[10px] text-zinc-600">Filter background noise while the user is talking.</p>
                  </div>
                  <Switch
                    checked={asrBackgroundDenoising}
                    onCheckedChange={mark(setAsrBackgroundDenoising)}
                    className="data-[state=checked]:bg-emerald-500"
                  />
                </div>

                {/* Confidence Threshold */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0 mt-0.5">
                    <Target className="h-3.5 w-3.5 text-zinc-400" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-zinc-300">Confidence Threshold</p>
                        <p className="text-[10px] text-zinc-600">Transcripts below this confidence score will be filtered out.</p>
                      </div>
                      <span className="text-xs font-mono bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-300 min-w-[42px] text-center shrink-0">
                        {asrConfidenceThreshold.toFixed(2)}
                      </span>
                    </div>
                    <Slider
                      min={0} max={1} step={0.01}
                      value={[asrConfidenceThreshold]}
                      onValueChange={([v]) => { setAsrConfidenceThreshold(v); setDirty(true); }}
                    />
                    <div className="flex justify-between text-[10px] text-zinc-600">
                      <span>0</span><span>1.0</span>
                    </div>
                  </div>
                </div>

                {/* End of Turn Confidence — Deepgram only */}
                {asrProvider === "deepgram" && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0 mt-0.5">
                      <Target className="h-3.5 w-3.5 text-zinc-400" />
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-medium text-zinc-300">End of Turn Confidence</p>
                          <p className="text-[10px] text-zinc-600">Confidence threshold required to finish a turn.</p>
                        </div>
                        <span className="text-xs font-mono bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-300 min-w-[42px] text-center shrink-0">
                          {asrEndOfTurnConfidence.toFixed(2)}
                        </span>
                      </div>
                      <Slider
                        min={0.5} max={0.9} step={0.01}
                        value={[asrEndOfTurnConfidence]}
                        onValueChange={([v]) => { setAsrEndOfTurnConfidence(v); setDirty(true); }}
                      />
                      <div className="flex justify-between text-[10px] text-zinc-600">
                        <span>0.5</span><span>0.9</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* End of Turn Timeout */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0 mt-0.5">
                    <Clock className="h-3.5 w-3.5 text-zinc-400" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-zinc-300">End of Turn Timeout</p>
                        <p className="text-[10px] text-zinc-600">Maximum time to wait after speech before finishing a turn.</p>
                      </div>
                      <span className="text-xs font-mono bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-300 min-w-[48px] text-center shrink-0">
                        {asrEndOfTurnTimeout}
                      </span>
                    </div>
                    <Slider
                      min={500} max={10000} step={100}
                      value={[asrEndOfTurnTimeout]}
                      onValueChange={([v]) => { setAsrEndOfTurnTimeout(v); setDirty(true); }}
                    />
                    <div className="flex justify-between text-[10px] text-zinc-600">
                      <span>500ms</span><span>10s</span>
                    </div>
                  </div>
                </div>

                {/* Keyterms */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0 mt-0.5">
                    <AlignLeft className="h-3.5 w-3.5 text-zinc-400" />
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <p className="text-xs font-medium text-zinc-300">Keyterms</p>
                    <p className="text-[10px] text-zinc-600">Enter keywords separated by commas for transcription.</p>
                    <Textarea
                      value={asrKeyterms}
                      onChange={(e) => { setAsrKeyterms(e.target.value); setDirty(true); }}
                      placeholder="e.g. VoiceOrch, API, webhook"
                      className="bg-zinc-900/60 border-zinc-700 text-zinc-200 text-xs resize-none min-h-[68px] placeholder:text-zinc-600 focus:border-zinc-600"
                    />
                    <p className="text-[10px] text-zinc-600">
                      Currently ~{asrKeyterms.split(",").filter(t => t.trim()).length} tokens used.
                    </p>
                  </div>
                </div>

                {/* Smart Endpointing */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0 mt-0.5">
                    <Zap className="h-3.5 w-3.5 text-zinc-400" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <p className="text-xs font-medium text-zinc-300">Smart Endpointing</p>
                    <p className="text-[10px] text-zinc-600">Enable for more accurate speech endpoint detection.</p>
                    <div className="flex border border-zinc-700 rounded-lg p-0.5 bg-zinc-900/60 w-fit gap-0">
                      {(["off", "vapi", "livekit"] as const).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => { setAsrSmartEndpointing(opt); setDirty(true); }}
                          className={[
                            "text-xs h-7 px-4 rounded-md transition-colors",
                            asrSmartEndpointing === opt
                              ? "bg-zinc-700 text-white font-semibold shadow-sm"
                              : "text-zinc-500 hover:text-zinc-300 font-medium",
                          ].join(" ")}
                        >
                          {opt === "off" ? "Off" : opt === "vapi" ? "VAPI" : "LiveKit"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Transcriber Fallback */}
                <div className="space-y-3 pt-1 border-t border-zinc-700/40">
                  <div className="flex items-start gap-3 pt-3">
                    <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
                      <RefreshCw className="h-3.5 w-3.5 text-zinc-400" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-zinc-300">Transcriber Fallback</p>
                      <p className="text-[10px] text-zinc-600 mt-0.5 leading-relaxed">
                        Protect your calls from STT failures. Auto fallback is recommended for most users. If you also add manual fallbacks, those are tried first before auto fallback kicks in.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pl-11">
                    <div>
                      <p className="text-xs text-zinc-400 font-medium">Auto Fallback</p>
                      <p className="text-[10px] text-zinc-600">Let VoiceOrch automatically pick a backup STT provider.</p>
                    </div>
                    <Switch
                      checked={asrAutoFallback}
                      onCheckedChange={mark(setAsrAutoFallback)}
                      className="data-[state=checked]:bg-emerald-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* First message */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">First Message</p>
                <span className="text-[10px] text-zinc-600">Agent speaks first</span>
              </div>
              <Textarea
                value={greetingMessage}
                onChange={(e) => { setGreetingMessage(e.target.value); setDirty(true); }}
                placeholder="Hello! How can I help you today?"
                className="bg-zinc-800/60 border-zinc-700 text-zinc-200 text-sm resize-none min-h-[72px] placeholder:text-zinc-600 focus:border-zinc-600"
              />
            </div>

            {/* System prompt */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">System Prompt</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px] text-zinc-500 hover:text-zinc-300 gap-1 px-2"
                  onClick={() => {
                    setSystemPrompt("You are a helpful and professional AI voice assistant. Be concise, clear, and friendly in all responses.");
                    setDirty(true);
                  }}
                >
                  <Sparkles className="h-3 w-3" /> Generate
                </Button>
              </div>
              <Textarea
                value={systemPrompt}
                onChange={(e) => { setSystemPrompt(e.target.value); setDirty(true); }}
                placeholder="This is a blank template. You can change the model, temperature, and messages."
                className="bg-zinc-800/60 border-zinc-700 text-zinc-200 text-sm resize-none min-h-[160px] placeholder:text-zinc-600 focus:border-zinc-600"
              />
            </div>

            {/* Knowledge Base */}
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center gap-1.5 mb-0.5">
                <BookOpen className="w-3 h-3 text-emerald-400" />
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Knowledge Base</p>
              </div>
              <Select
                value={knowledgeBaseId?.toString() ?? "none"}
                onValueChange={(v) => { setKnowledgeBaseId(v === "none" ? null : parseInt(v)); setDirty(true); }}
              >
                <SelectTrigger className="h-7 text-xs bg-zinc-900/60 border-zinc-700 text-zinc-200">
                  <SelectValue placeholder="No knowledge base attached" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  <SelectItem value="none" className="text-zinc-400 text-xs">— None —</SelectItem>
                  {(kbs ?? []).map(kb => (
                    <SelectItem key={kb.id} value={kb.id.toString()} className="text-zinc-300 text-xs">
                      {kb.name} <span className="text-zinc-500 ml-1">({kb.chunkCount} chunks)</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-zinc-600">Relevant chunks are injected into the system prompt on every call.</p>
            </div>

            {/* Description */}
            {agent.description && (
              <div className="text-xs text-zinc-600 italic border-t border-zinc-800 pt-3">
                {agent.description}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Logs tab ── */}
        <TabsContent value="logs" className="flex-1 overflow-y-auto m-0">
          {callsLoading ? (
            <div className="p-5 space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full bg-zinc-800" />)}
            </div>
          ) : !calls?.length ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-zinc-600 gap-2 p-8">
              <Phone className="h-8 w-8 opacity-20" />
              <p className="text-sm">No calls yet for this assistant.</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {calls.map((call) => (
                <div key={call.id} className="flex items-center gap-4 px-5 py-3 hover:bg-zinc-800/30 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      {callStatusBadge(call.status)}
                      <span className="text-xs text-zinc-500">
                        {format(new Date(call.createdAt), "MMM d, HH:mm")}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 truncate">
                      {call.fromNumber || "—"} → {call.toNumber || "—"}
                    </p>
                  </div>
                  {call.durationSeconds != null && (
                    <span className="text-xs text-zinc-500 shrink-0">
                      {Math.floor(call.durationSeconds / 60)}m {call.durationSeconds % 60}s
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Test tab ── */}
        <TabsContent value="test" className="flex-1 overflow-y-auto m-0 px-5 py-4">
          <WebCallPanel agentId={agentId} agentName={agent.name} />
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
            <Input
              placeholder="+1234567890"
              value={toNumber}
              onChange={e => setToNumber(e.target.value)}
              className="bg-zinc-800 border-zinc-700 text-zinc-200"
            />
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
