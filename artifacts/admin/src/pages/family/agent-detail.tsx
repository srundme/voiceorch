import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  ArrowLeft, Save, Bot, Plus, Trash2, PhoneForwarded,
  ChevronDown, ChevronUp, Database, ClipboardList, Building2,
  Maximize2, Phone, PhoneOff, Mic, MicOff, Volume2,
} from "lucide-react";
import { z } from "zod";
import { useForm, useWatch, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useFamilyStore, InsuranceAgent, InsuranceCall, AgentStatus } from "@/lib/family-store";
import { AGENT_TIMEZONES, LANGUAGES as ALL_LANGUAGES } from "@/lib/agent-providers";
import { useAdminListedVoices, useManagedKeys, useAdminAmbientSounds, useProvisionFamilyAgent } from "@/hooks/use-admin-api";
import { adminFetch } from "@/lib/api";

/* ── Provider / model catalogues ─────────────────────────────────────────── */

const ASR_PROVIDERS = [
  { value: "deepgram",   label: "Deepgram Nova" }, { value: "azure",      label: "Azure Speech" },
  { value: "assemblyai", label: "AssemblyAI" },    { value: "sarvam",     label: "Sarvam (Saarika)" },
  { value: "cartesia",   label: "Cartesia" },
];
const LLM_PROVIDERS = [
  { value: "google",    label: "Google Gemini" },
  { value: "groq",      label: "Groq" },
];
const TTS_PROVIDERS = [
  { value: "elevenlabs",    label: "ElevenLabs" },    { value: "openai_tts",    label: "OpenAI TTS" },
  { value: "cartesia",      label: "Cartesia (Sonic)" }, { value: "deepgram_aura", label: "Deepgram Aura" },
  { value: "azure_tts",     label: "Azure TTS" },    { value: "sarvam",        label: "Sarvam (Bulbul)" },
];
const TELEPHONY_PROVIDERS = [
  { value: "twilio", label: "Twilio" }, { value: "plivo", label: "Plivo" }, { value: "vobiz", label: "Vobiz" },
];
const ASR_MANAGED_KEYS: Record<string, string[]> = {
  deepgram: ["managed_deepgram_key"], sarvam: ["managed_sarvam_key"],
  assemblyai: ["managed_assemblyai_key"], azure: ["managed_azure_speech_key"],
};
const LLM_MANAGED_KEYS: Record<string, string[]> = {
  openai: ["managed_openai_key"], anthropic: ["managed_anthropic_key"],
  google: ["managed_gemini_key"], deepseek: ["managed_deepseek_key"],
  mistral: ["managed_mistral_key"], cohere: ["managed_cohere_key"],
  qwen: ["managed_qwen_key", "managed_groq_key"], groq: ["managed_groq_key"],
  sarvam: ["managed_sarvam_key"],
};
const TTS_MANAGED_KEYS: Record<string, string[]> = {
  cartesia: ["managed_cartesia_key"], elevenlabs: ["managed_elevenlabs_key"],
  openai_tts: ["managed_openai_key"], deepgram_aura: ["managed_deepgram_key"],
  azure_tts: ["managed_azure_speech_key"], sarvam: ["managed_sarvam_key"],
};
const TELEPHONY_MANAGED_KEYS: Record<string, string[]> = { vobiz: ["managed_vobiz_auth_id"] };

const LANGUAGES = ALL_LANGUAGES;

const ASR_MODELS: Record<string, { value: string; label: string }[]> = {
  deepgram:   [{ value: "nova-2", label: "Nova-2 (recommended)" }, { value: "nova-2-phonecall", label: "Nova-2 Phone Call" }],
  azure:      [{ value: "en-US-standard", label: "en-US-standard" }, { value: "en-IN-standard", label: "en-IN-standard" }],
  assemblyai: [{ value: "best", label: "Best (default)" }, { value: "nano", label: "Nano (fast)" }],
  sarvam:     [{ value: "saaras:v4", label: "Saaras v4 (latest)" }, { value: "saaras:v3", label: "Saaras v3 (recommended)" }, { value: "saarika:v2.5", label: "Saarika v2.5" }],
  cartesia:   [{ value: "sonic-english", label: "Sonic English" }, { value: "sonic-multilingual", label: "Sonic Multilingual" }],
};
const LLM_MODELS: Record<string, { value: string; label: string }[]> = {
  openai:    [{ value: "gpt-4o-mini", label: "GPT-4o Mini" }, { value: "gpt-4o", label: "GPT-4o" }],
  anthropic: [{ value: "claude-opus-4-5", label: "Claude Opus 4" }, { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" }, { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" }],
  google:    [{ value: "gemini-3.6-flash", label: "Gemini 3.6 Flash (recommended)" }, { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite (fastest)" }, { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (previous gen)" }],
  deepseek:  [{ value: "deepseek-chat", label: "DeepSeek V3 (chat)" }, { value: "deepseek-reasoner", label: "DeepSeek R1" }],
  mistral:   [{ value: "mistral-large-latest", label: "Mistral Large" }, { value: "mistral-small-latest", label: "Mistral Small" }],
  cohere:    [{ value: "command-r-plus-08-2024", label: "Command R+" }, { value: "command-r-08-2024", label: "Command R" }],
  qwen:      [{ value: "qwen/qwen3-32b", label: "Qwen 3 32B (recommended)" }, { value: "qwen/qwen3-235b-a22b", label: "Qwen 3 235B" }],
  groq:      [{ value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" }, { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B" }],
  sarvam:    [{ value: "sarvam-30b", label: "Sarvam 30B (recommended)" }, { value: "sarvam-105b", label: "Sarvam 105B" }],
};
const TTS_MODELS: Record<string, { value: string; label: string }[]> = {
  cartesia: [
    { value: "sonic-3.5", label: "Sonic 3.5" }, { value: "sonic-3", label: "Sonic 3" },
    { value: "sonic-2", label: "Sonic 2 (stable)" },  { value: "sonic-turbo", label: "Sonic Turbo" },
  ],
};
const TTS_VOICES: Record<string, { value: string; label: string }[] | null> = {
  elevenlabs: null, cartesia: null, azure_tts: null,
  openai_tts: [
    { value: "alloy", label: "Alloy" }, { value: "ash", label: "Ash" }, { value: "coral", label: "Coral" },
    { value: "echo", label: "Echo" },  { value: "fable", label: "Fable" }, { value: "onyx", label: "Onyx" },
    { value: "nova", label: "Nova" },  { value: "sage", label: "Sage" },  { value: "shimmer", label: "Shimmer" },
  ],
  deepgram_aura: [
    { value: "aura-2-en", label: "Aura 2 (default)" }, { value: "aura-asteria-en", label: "Asteria" },
    { value: "aura-luna-en", label: "Luna" }, { value: "aura-zeus-en", label: "Zeus" },
  ],
  sarvam: [
    { value: "meera", label: "Meera (female)" }, { value: "pavithra", label: "Pavithra (female)" },
    { value: "arvind", label: "Arvind (male)" }, { value: "amol", label: "Amol (male)" },
    { value: "neel", label: "Neel (male)" },     { value: "maya", label: "Maya (female)" },
  ],
};

const STATUS_LIST: AgentStatus[] = ["draft", "training", "testing", "approved", "published"];

/* ── Form schema ──────────────────────────────────────────────────────────── */

const agentFormSchema = z.object({
  status:            z.enum(["draft", "training", "testing", "approved", "published"]),
  companyId:         z.string().min(1, "Company is required"),
  policyId:          z.string().optional(),
  agentType:         z.string().optional(),
  name:              z.string().min(1, "Name is required"),
  description:       z.string().optional(),
  asrProvider:       z.string().min(1, "ASR Provider is required"),
  asrModel:          z.string().optional(),
  llmProvider:       z.string().min(1, "LLM Provider is required"),
  llmModel:          z.string().optional(),
  ttsProvider:       z.string().min(1, "TTS Provider is required"),
  ttsVoice:          z.string().optional(),
  ttsModel:          z.string().optional(),
  telephonyProvider: z.string().min(1, "Telephony Provider is required"),
  systemPrompt:      z.string().min(1, "System prompt is required"),
  temperature:       z.number().min(0).max(2).optional(),
  maxDuration:       z.number().min(10).max(3600).optional(),
  greetingMessage:         z.string().optional(),
  endCallPhrases:          z.string().optional(),
  silenceTimeoutSeconds:   z.number().min(5).max(300).optional(),
  language:                z.string().optional(),
  backchannelingEnabled:   z.boolean().optional(),
  backchannelingFrequency: z.number().min(0).max(1).optional(),
  webhookUrl:              z.string().optional(),
  noiseCancellationEnabled: z.boolean().optional(),
  inactivityMessage:        z.string().optional(),
  asrLanguage:              z.string().optional(),
  asrBackgroundDenoising:   z.boolean().optional(),
  asrConfidenceThreshold:   z.number().min(0).max(1).optional(),
  asrEndOfTurnConfidence:   z.number().min(0.3).max(1).optional(),
  asrEndOfTurnTimeout:      z.number().min(100).max(30000).optional(),
  asrKeyterms:              z.string().optional(),
  asrSmartEndpointing:      z.enum(["off", "vapi", "livekit"]).optional(),
  asrAutoFallback:          z.boolean().optional(),
  webhookSecret:            z.string().optional(),
  ambientSoundId:           z.string().optional(),
  promptVariables: z.array(z.object({
    key: z.string().min(1, "Key required"), defaultValue: z.string(), description: z.string().optional(),
  })).optional(),
  vadSilenceMs:           z.number().min(50).max(2000).optional(),
  bargeInEnabled:         z.boolean().optional(),
  bargeInEnergyThreshold: z.number().min(100).max(5000).optional(),
  bargeInMinFrames:       z.number().min(1).max(20).optional(),
  timezone:               z.string().optional(),
  maxConcurrentCalls:     z.number().min(1).max(100).optional(),
  monthlySpendLimitCents: z.number().min(100).optional(),
  tools: z.array(z.object({
    type: z.literal("call_transfer"),
    name: z.string().min(1, "Function name required"),
    description: z.string().min(1, "Description required"),
    transferTo: z.string().min(1, "Phone number required"),
    warmHandoffMessage: z.string().optional(),
    transferMode: z.enum(["cold", "warm_summary"]).optional(),
    summaryPrompt: z.string().optional(),
  })).optional(),
  dispositionSchema: z.array(z.object({
    key: z.string().min(1, "Key required"), label: z.string().min(1, "Label required"),
    type: z.enum(["text", "number", "boolean", "choice"]),
    required: z.boolean().optional(), options: z.string().optional(),
  })).optional(),
  memoryEnabled:          z.boolean().optional(),
  crossCallMemoryEnabled: z.boolean().optional(),
  contextWindowMessages:  z.number().min(5).max(100).optional(),
  autoCallbackEnabled:      z.boolean().optional(),
  autoCallbackRetries:      z.number().min(1).max(10).optional(),
  autoCallbackDelaySeconds: z.number().min(10).max(3600).optional(),
});

type AgentFormValues = z.infer<typeof agentFormSchema>;

/* ── Smart model select ───────────────────────────────────────────────────── */

function ModelSelect({
  options, value, onChange, placeholder,
}: { options: { value: string; label: string }[]; value: string | undefined; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <Select value={value ?? ""} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder={placeholder ?? "Select model"} /></SelectTrigger>
      <SelectContent>
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

const STATUS_COLORS: Record<AgentStatus, string> = {
  draft: "bg-zinc-700 text-zinc-300", training: "bg-yellow-900/60 text-yellow-300",
  testing: "bg-blue-900/60 text-blue-300", approved: "bg-emerald-900/60 text-emerald-300",
  published: "bg-green-900/60 text-green-300",
};

/* ── Helpers for PCM16 WebSocket audio ─────────────────────────────────────── */

function floatToPcm16(float32: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

function playPcm16(ctx: AudioContext, data: ArrayBuffer | Blob, nextPlayTime: { t: number }) {
  const schedule = (ab: ArrayBuffer) => {
    const pcm16 = new Int16Array(ab);
    if (pcm16.length === 0) return;
    const f32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) f32[i] = pcm16[i] / 32768;
    const audioBuffer = ctx.createBuffer(1, f32.length, 16000);
    audioBuffer.getChannelData(0).set(f32);
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);
    const now = ctx.currentTime;
    const startAt = Math.max(now, nextPlayTime.t);
    src.start(startAt);
    nextPlayTime.t = startAt + audioBuffer.duration;
  };
  if (data instanceof ArrayBuffer) {
    schedule(data);
  } else {
    void data.arrayBuffer().then(schedule);
  }
}

/* ── WebCallPanel ─────────────────────────────────────────────────────────── */

type CallPhase = "idle" | "provisioning" | "connecting" | "active" | "ended";

interface TranscriptLine { role: "user" | "agent"; text: string }

function WebCallPanel({ agent, onCallSaved }: { agent: InsuranceAgent; onCallSaved: (c: InsuranceCall) => void }) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [backendAgentId, setBackendAgentId] = useState<number | null>(agent.backendAgentId ?? null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [callEndReason, setCallEndReason] = useState<string | null>(null);

  const wsRef    = useRef<WebSocket | null>(null);
  const ctxRef   = useRef<AudioContext | null>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const startTimeRef = useRef<Date | null>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const nextPlayRef  = useRef<{ t: number }>({ t: 0 });
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<CallPhase>("idle");
  // Gate mic transmission while the agent is speaking so the TTS echo from
  // the browser speaker cannot trigger false barge-in detection on the server.
  const agentSpeakingRef = useRef(false);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  const cleanup = useCallback(() => {
    timerRef.current && clearInterval(timerRef.current);
    timerRef.current = null;
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
  }, []);

  const REASON_LABELS: Record<string, string> = {
    normal: "Call ended normally.",
    silence_timeout: "Call ended: no response detected (silence timeout).",
    timeout: "Call ended: maximum duration reached.",
    disconnected: "Call ended: connection lost.",
    error: "Call ended due to an error.",
  };

  const doEndCall = useCallback((lines: TranscriptLine[], dur: number, reason?: string) => {
    if (phaseRef.current === "ended" || phaseRef.current === "idle") return;
    cleanup();
    setPhase("ended");
    setCallEndReason(reason ?? null);
    const now = new Date();
    const call: InsuranceCall = {
      id: `${Date.now()}`,
      agentId: agent.id,
      status: "completed",
      startedAt: (startTimeRef.current ?? now).toISOString(),
      endedAt: now.toISOString(),
      durationSeconds: dur,
      transcript: lines.map(l => `${l.role === "agent" ? "Agent" : "User"}: ${l.text}`).join("\n"),
    };
    onCallSaved(call);
    const label = reason ? (REASON_LABELS[reason] ?? `Call ended (${reason}).`) : "Call ended.";
    toast({ title: "Call ended", description: `${label} Duration: ${dur}s.` });
  }, [agent.id, cleanup, onCallSaved, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const startCall = async () => {
    setError(null);
    setTranscript([]);
    setDuration(0);
    setStatus("Provisioning agent…");
    setPhase("provisioning");

    let agentId = backendAgentId;
    try {
      const result = await adminFetch<{ agentId: number }>("/family/provision", {
        method: "POST",
        body: JSON.stringify({
          familyAgentId: agent.id,
          name: agent.name,
          systemPrompt: agent.systemPrompt,
          asrProvider: agent.asrProvider, asrModel: agent.asrModel,
          asrLanguage: agent.asrLanguage, asrSmartEndpointing: agent.asrSmartEndpointing,
          asrBackgroundDenoising: agent.asrBackgroundDenoising,
          asrConfidenceThreshold: agent.asrConfidenceThreshold,
          asrEndOfTurnConfidence: agent.asrEndOfTurnConfidence,
          asrEndOfTurnTimeout: agent.asrEndOfTurnTimeout,
          asrKeyterms: agent.asrKeyterms, asrAutoFallback: agent.asrAutoFallback,
          llmProvider: agent.llmProvider, llmModel: agent.llmModel,
          ttsProvider: agent.ttsProvider, ttsVoice: agent.ttsVoice, ttsModel: agent.ttsModel,
          telephonyProvider: agent.telephonyProvider,
          temperature: agent.temperature, maxDuration: agent.maxDuration,
          greetingMessage: agent.greetingMessage, endCallPhrases: agent.endCallPhrases,
          language: agent.language, backchannelingEnabled: agent.backchannelingEnabled,
          backchannelingFrequency: agent.backchannelingFrequency,
          noiseCancellationEnabled: agent.noiseCancellationEnabled,
          inactivityMessage: agent.inactivityMessage, webhookUrl: agent.webhookUrl,
          silenceTimeoutSeconds: agent.silenceTimeoutSeconds,
          ambientSoundId: agent.ambientSoundId,
          dispositionSchema: agent.dispositionSchema,
          memoryEnabled: agent.memoryEnabled, crossCallMemoryEnabled: agent.crossCallMemoryEnabled,
        }),
      });
      agentId = result.agentId;
      setBackendAgentId(agentId);
    } catch (e) {
      setError(`Provisioning failed: ${e instanceof Error ? e.message : String(e)}`);
      setPhase("idle");
      return;
    }

    setStatus("Requesting microphone…");
    setPhase("connecting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
    } catch (e) {
      setError("Microphone access denied. Please allow microphone access and try again.");
      setPhase("idle");
      return;
    }

    const audioCtx = new AudioContext({ sampleRate: 16000 });
    ctxRef.current = audioCtx;
    nextPlayRef.current = { t: 0 };

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${window.location.host}/api/ws/webcall/${agentId}?callerId=admin-test-${encodeURIComponent(agent.id)}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    const currentTranscript: TranscriptLine[] = [];
    let currentDuration = 0;

    ws.onopen = () => {
      setStatus("Connecting…");
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      source.connect(processor);
      processor.connect(audioCtx.destination);
      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        // Suppress mic while agent is speaking — prevents TTS echo from the
        // browser speaker triggering false barge-in detection on the server.
        if (agentSpeakingRef.current) return;
        const float32 = e.inputBuffer.getChannelData(0);
        ws.send(floatToPcm16(float32));
      };
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        playPcm16(audioCtx, event.data, nextPlayRef.current);
        return;
      }
      if (typeof event.data !== "string") return;
      try {
        const msg = JSON.parse(event.data) as Record<string, unknown>;
        if (msg["type"] === "ready") {
          setPhase("active");
          setStatus("Call active");
          startTimeRef.current = new Date();
          timerRef.current = setInterval(() => {
            currentDuration++;
            setDuration(d => d + 1);
          }, 1000);
        } else if (msg["type"] === "status") {
          const st = String(msg["status"] ?? "");
          setStatus(st);
          // Track agent speaking state so the mic gate can suppress echo
          agentSpeakingRef.current = st === "speaking";
        } else if (msg["type"] === "transcript") {
          const line: TranscriptLine = {
            role: msg["speaker"] === "user" ? "user" : "agent",
            text: String(msg["text"] ?? ""),
          };
          currentTranscript.push(line);
          setTranscript([...currentTranscript]);
        } else if (msg["type"] === "interrupted") {
          agentSpeakingRef.current = false;
          nextPlayRef.current.t = audioCtx.currentTime;
        } else if (msg["type"] === "ended") {
          currentDuration = typeof msg["durationSeconds"] === "number" ? msg["durationSeconds"] : currentDuration;
          setDuration(currentDuration);
          doEndCall(currentTranscript, currentDuration, typeof msg["reason"] === "string" ? msg["reason"] : undefined);
        } else if (msg["type"] === "error") {
          setError(String(msg["message"] ?? "Unknown error"));
          if (phaseRef.current !== "active") setPhase("idle");
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
      if (phaseRef.current === "active") {
        doEndCall(currentTranscript, currentDuration, "disconnected");
      }
    };

    ws.onerror = () => {
      setError("WebSocket connection error.");
      if (phaseRef.current !== "active") setPhase("idle");
    };
  };

  const endCall = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "end" }));
    }
    doEndCall(transcript, duration, "normal");
  };

  const toggleMic = () => {
    if (!streamRef.current) return;
    streamRef.current.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
    setMicOn(v => !v);
  };

  const reset = () => { setPhase("idle"); setTranscript([]); setError(null); setDuration(0); setCallEndReason(null); };

  const fmtDur = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-primary" /> Test Call — {agent.name}
              </CardTitle>
              <CardDescription>
                Connects your browser microphone directly to the VoiceOrch pipeline.
              </CardDescription>
            </div>
            {phase === "active" && (
              <div className="flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
                <span className="font-mono text-base font-bold tabular-nums">{fmtDur(duration)}</span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {status && phase !== "idle" && phase !== "ended" && (
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <span className="animate-spin h-3 w-3 border border-current border-t-transparent rounded-full" />
              {status}
            </div>
          )}

          {/* Transcript */}
          <div className="min-h-[300px] max-h-[420px] overflow-y-auto rounded-md border bg-muted/20 p-4 space-y-3">
            {transcript.length === 0 && phase !== "active" && (
              <p className="text-sm text-muted-foreground text-center pt-16">
                {phase === "ended"
                  ? (callEndReason && REASON_LABELS[callEndReason]) || "Call ended."
                  : "Start the call to see a live transcript here."}
              </p>
            )}
            {transcript.map((line, i) => (
              <div key={i} className={`flex gap-3 ${line.role === "agent" ? "justify-start" : "justify-end"}`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                  line.role === "agent"
                    ? "bg-card border border-border text-foreground"
                    : "bg-primary text-primary-foreground"
                }`}>
                  <p className={`text-[10px] font-semibold mb-0.5 opacity-70 ${line.role === "user" ? "text-right" : ""}`}>
                    {line.role === "agent" ? "AGENT" : "YOU"}
                  </p>
                  {line.text}
                </div>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>

          {/* End reason banner */}
          {phase === "ended" && callEndReason && (
            <div className={`rounded-md border px-3 py-2 text-sm flex items-center gap-2 ${
              callEndReason === "silence_timeout"
                ? "border-amber-400/40 bg-amber-50/60 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                : callEndReason === "error" || callEndReason === "disconnected"
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-border bg-muted/40 text-muted-foreground"
            }`}>
              <PhoneOff className="h-3.5 w-3.5 shrink-0" />
              {REASON_LABELS[callEndReason] ?? `Call ended (${callEndReason}).`}
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center justify-center gap-3">
            {phase === "idle" && (
              <Button onClick={startCall} className="gap-2 px-8">
                <Phone className="h-4 w-4" /> Start Test Call
              </Button>
            )}
            {(phase === "provisioning" || phase === "connecting") && (
              <Button disabled className="gap-2 px-8">
                <span className="animate-spin h-4 w-4 border border-current border-t-transparent rounded-full" />
                {phase === "provisioning" ? "Provisioning…" : "Connecting…"}
              </Button>
            )}
            {phase === "active" && (
              <>
                <Button variant="outline" size="icon" onClick={toggleMic} title={micOn ? "Mute" : "Unmute"}>
                  {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4 text-destructive" />}
                </Button>
                <Button variant="destructive" onClick={endCall} className="gap-2 px-8">
                  <PhoneOff className="h-4 w-4" /> End Call
                </Button>
              </>
            )}
            {phase === "ended" && (
              <Button variant="outline" onClick={reset} className="gap-2">
                <Phone className="h-4 w-4" /> New Test Call
              </Button>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground text-center">
            Uses managed provider keys. No wallet check — admin test calls only.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── CallLogPanel ─────────────────────────────────────────────────────────── */

function CallLogPanel({ calls }: { calls: InsuranceCall[] }) {
  const [selected, setSelected] = useState<InsuranceCall | null>(null);
  const fmtDur = (s?: number) => s == null ? "—" : `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  const fmtDate = (s: string) => {
    const d = new Date(s);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) + " " +
      d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  };

  if (calls.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
        <Phone className="h-10 w-10 opacity-30" />
        <p className="text-sm">No calls yet — start a Test Call to see records here.</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Started</th>
              <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Duration</th>
              <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Status</th>
              <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Caller</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {calls.map((call) => (
              <tr key={call.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 font-mono text-xs">{fmtDate(call.startedAt)}</td>
                <td className="px-4 py-3 font-mono text-xs">{fmtDur(call.durationSeconds)}</td>
                <td className="px-4 py-3">
                  <Badge className={
                    call.status === "completed" ? "bg-emerald-900/60 text-emerald-300" :
                    call.status === "failed"    ? "bg-red-900/60 text-red-300" :
                    call.status === "missed"    ? "bg-yellow-900/60 text-yellow-300" :
                    "bg-blue-900/60 text-blue-300"
                  }>{call.status}</Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{call.callerPhone ?? "Browser test"}</td>
                <td className="px-4 py-3 text-right">
                  <Button variant="ghost" size="sm" onClick={() => setSelected(call)}>View</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Call Details</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground mb-1">Started</p>
                  <p className="font-mono text-xs">{fmtDate(selected.startedAt)}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground mb-1">Duration</p>
                  <p className="font-mono text-xs">{fmtDur(selected.durationSeconds)}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground mb-1">Status</p>
                  <Badge className={
                    selected.status === "completed" ? "bg-emerald-900/60 text-emerald-300" :
                    selected.status === "failed"    ? "bg-red-900/60 text-red-300" :
                    "bg-yellow-900/60 text-yellow-300"
                  }>{selected.status}</Badge>
                </div>
                {selected.callerPhone && (
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground mb-1">Caller</p>
                    <p className="font-mono text-xs">{selected.callerPhone}</p>
                  </div>
                )}
              </div>
              {selected.summary && (
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground mb-1">Summary</p>
                  <p className="text-sm">{selected.summary}</p>
                </div>
              )}
              {selected.transcript && (
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground mb-2">Transcript</p>
                  <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed">{selected.transcript}</pre>
                </div>
              )}
              {selected.dispositionData && Object.keys(selected.dispositionData).length > 0 && (
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground mb-2">Disposition</p>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(selected.dispositionData).map(([k, v]) => (
                      <div key={k} className="text-xs">
                        <span className="text-muted-foreground">{k}: </span>
                        <span>{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {selected.recordingUrl && (
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground mb-2">Recording</p>
                  <audio controls src={selected.recordingUrl} className="w-full" />
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function FamilyAgentDetail() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { companies, agents, policies, calls, saveAgents, addCall, isLoaded } = useFamilyStore();
  const { data: listedVoicesData } = useAdminListedVoices();
  const cartesiaListedVoices = listedVoicesData?.voices ?? [];
  const { data: mk } = useManagedKeys();
  const { data: ambientSoundsData } = useAdminAmbientSounds();
  const ambientSounds = ambientSoundsData ?? [];

  const hasKey = (keys: string[]) => !mk || keys.some(k => k in mk);
  const availableAsrProviders = ASR_PROVIDERS.filter(p => hasKey(ASR_MANAGED_KEYS[p.value] ?? []));
  const availableLlmProviders = LLM_PROVIDERS.filter(p => hasKey(LLM_MANAGED_KEYS[p.value] ?? []));
  const availableTtsProviders = TTS_PROVIDERS.filter(p => hasKey(TTS_MANAGED_KEYS[p.value] ?? []));
  const availableTelephonyProviders = (() => {
    if (!mk) return TELEPHONY_PROVIDERS;
    const f = TELEPHONY_PROVIDERS.filter(p => (TELEPHONY_MANAGED_KEYS[p.value] ?? []).some(k => k in mk));
    return f.length > 0 ? f : TELEPHONY_PROVIDERS;
  })();

  const [showAdvancedSTT, setShowAdvancedSTT] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [fullscreenPrompt, setFullscreenPrompt] = useState(false);

  const agent = agents.find(a => a.id === params.id);
  const agentCalls = calls.filter(c => c.agentId === params.id).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
  // Track which agent ID the form has been initialised for.
  // Using agent.id (string) instead of a boolean prevents a race where the
  // effect fires before the store finishes loading (agent=undefined), sets the
  // flag, and then refuses to re-run once the agent is actually available.
  const formInitializedFor = useRef<string | null>(null);

  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: {
      status: "draft", companyId: "", policyId: "", agentType: "inbound_support",
      name: "", description: "",
      asrProvider: "azure", asrModel: "", llmProvider: "openai", llmModel: "",
      ttsProvider: "elevenlabs", ttsVoice: "", ttsModel: "", telephonyProvider: "twilio",
      systemPrompt: "", temperature: 0.7, maxDuration: 600,
      greetingMessage: "", endCallPhrases: "", silenceTimeoutSeconds: 30,
      language: "en-IN", backchannelingEnabled: true, backchannelingFrequency: 0.5,
      webhookUrl: "", noiseCancellationEnabled: true,
      inactivityMessage: "", asrLanguage: "",
      asrBackgroundDenoising: false, asrConfidenceThreshold: 0.40,
      asrEndOfTurnConfidence: 0.70, asrEndOfTurnTimeout: 5000,
      asrKeyterms: "", asrSmartEndpointing: "off" as const, asrAutoFallback: true,
      webhookSecret: "", ambientSoundId: "", promptVariables: [],
      vadSilenceMs: 250, bargeInEnabled: true, bargeInEnergyThreshold: 1200, bargeInMinFrames: 4,
      timezone: "", tools: [], dispositionSchema: [],
      memoryEnabled: false, crossCallMemoryEnabled: false, contextWindowMessages: 20,
      autoCallbackEnabled: false, autoCallbackRetries: 3, autoCallbackDelaySeconds: 300,
    },
  });

  const { fields: toolFields, append: appendTool, remove: removeTool } = useFieldArray({ control: form.control, name: "tools" });
  const { fields: dispositionFields, append: appendDisposition, remove: removeDisposition } = useFieldArray({ control: form.control, name: "dispositionSchema" });
  const { fields: promptVarFields, append: appendPromptVar, remove: removePromptVar } = useFieldArray({ control: form.control, name: "promptVariables" });

  const asrProvider = useWatch({ control: form.control, name: "asrProvider" });
  const ttsProvider = useWatch({ control: form.control, name: "ttsProvider" });
  const backchannelingEnabled = useWatch({ control: form.control, name: "backchannelingEnabled" });
  const backchannelingFrequency = useWatch({ control: form.control, name: "backchannelingFrequency" });
  const selectedCompanyId = useWatch({ control: form.control, name: "companyId" });
  const memoryEnabled = useWatch({ control: form.control, name: "memoryEnabled" });
  const autoCallbackEnabled = useWatch({ control: form.control, name: "autoCallbackEnabled" });
  const llmProvider = useWatch({ control: form.control, name: "llmProvider" });
  const systemPromptWatch = useWatch({ control: form.control, name: "systemPrompt" });

  useEffect(() => {
    if (!agent || !isLoaded) return;
    if (formInitializedFor.current === agent.id) return;
    formInitializedFor.current = agent.id;
    form.reset({
      status:            agent.status,
      companyId:         agent.companyId,
      policyId:          agent.policyId ?? "",
      agentType:         agent.agentType ?? "inbound_support",
      name:              agent.name,
      description:       agent.description ?? "",
      asrProvider:       agent.asrProvider ?? "azure",
      asrModel:          agent.asrModel ?? (ASR_MODELS[agent.asrProvider ?? "azure"]?.[0]?.value ?? ""),
      llmProvider:       agent.llmProvider ?? "openai",
      llmModel:          agent.llmModel ?? "",
      ttsProvider:       agent.ttsProvider ?? "elevenlabs",
      ttsVoice:          agent.ttsVoice ?? "",
      ttsModel:          agent.ttsModel ?? "",
      telephonyProvider: agent.telephonyProvider ?? "twilio",
      systemPrompt:      agent.systemPrompt,
      temperature:       agent.temperature ?? 0.7,
      maxDuration:       agent.maxDuration ?? 600,
      greetingMessage:         agent.greetingMessage ?? "",
      endCallPhrases:          agent.endCallPhrases ?? "",
      silenceTimeoutSeconds:   agent.silenceTimeoutSeconds ?? 30,
      language:                agent.language ?? "en-IN",
      backchannelingEnabled:   agent.backchannelingEnabled ?? true,
      backchannelingFrequency: agent.backchannelingFrequency ?? 0.5,
      webhookUrl:              agent.webhookUrl ?? "",
      webhookSecret:           agent.webhookSecret ?? "",
      noiseCancellationEnabled: agent.noiseCancellationEnabled ?? true,
      inactivityMessage:        agent.inactivityMessage ?? "",
      asrLanguage:              agent.asrLanguage ?? "",
      asrBackgroundDenoising:   agent.asrBackgroundDenoising ?? false,
      asrConfidenceThreshold:   agent.asrConfidenceThreshold ?? 0.40,
      asrEndOfTurnConfidence:   agent.asrEndOfTurnConfidence ?? 0.70,
      asrEndOfTurnTimeout:      agent.asrEndOfTurnTimeout ?? 5000,
      asrKeyterms:              agent.asrKeyterms ?? "",
      asrSmartEndpointing:      agent.asrSmartEndpointing ?? "off",
      asrAutoFallback:          agent.asrAutoFallback ?? true,
      timezone:                 agent.timezone ?? "",
      ambientSoundId:           agent.ambientSoundId ?? "",
      promptVariables: (agent.promptVariables ?? []) as AgentFormValues["promptVariables"],
      vadSilenceMs:             agent.vadSilenceMs ?? 250,
      bargeInEnabled:           agent.bargeInEnabled ?? true,
      bargeInEnergyThreshold:   agent.bargeInEnergyThreshold ?? 1200,
      bargeInMinFrames:         agent.bargeInMinFrames ?? 4,
      tools: (agent.tools ?? []) as AgentFormValues["tools"],
      dispositionSchema: (agent.dispositionSchema ?? []).map((f: any) => ({
        ...f,
        options: Array.isArray(f.options) ? f.options.join(", ") : (f.options ?? ""),
      })) as AgentFormValues["dispositionSchema"],
      maxConcurrentCalls:     agent.maxConcurrentCalls,
      monthlySpendLimitCents: agent.monthlySpendLimitCents,
      memoryEnabled:          agent.memoryEnabled ?? false,
      crossCallMemoryEnabled: agent.crossCallMemoryEnabled ?? false,
      contextWindowMessages:  agent.contextWindowMessages ?? 20,
      autoCallbackEnabled:      agent.autoCallbackEnabled ?? false,
      autoCallbackRetries:      agent.autoCallbackRetries ?? 3,
      autoCallbackDelaySeconds: agent.autoCallbackDelaySeconds ?? 300,
    });
  }, [agent?.id, isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const policiesForCompany = policies.filter(p => p.companyId === selectedCompanyId);

  const onSubmit = (data: AgentFormValues) => {
    if (!agent) return;
    setIsSaving(true);
    const company = companies.find(c => c.id === data.companyId);
    const policy = policies.find(p => p.id === data.policyId);
    const updated: InsuranceAgent = {
      ...agent,
      status:      data.status,
      companyId:   data.companyId,
      companyName: company?.name ?? agent.companyName,
      policyId:    data.policyId || undefined,
      policyName:  policy?.name || undefined,
      name:        data.name,
      description: data.description,
      agentMode:   agent.agentMode,
      agentType:   data.agentType as any,
      systemPrompt: data.systemPrompt,
      voiceId:     data.ttsVoice ?? "",
      lastUpdated: new Date().toISOString(),
      asrProvider: data.asrProvider, asrModel: data.asrModel,
      asrLanguage: data.asrLanguage || undefined,
      asrBackgroundDenoising: data.asrBackgroundDenoising,
      asrConfidenceThreshold: data.asrConfidenceThreshold,
      asrEndOfTurnConfidence: data.asrEndOfTurnConfidence,
      asrEndOfTurnTimeout: data.asrEndOfTurnTimeout,
      asrKeyterms: data.asrKeyterms || undefined,
      asrSmartEndpointing: data.asrSmartEndpointing,
      asrAutoFallback: data.asrAutoFallback,
      llmProvider: data.llmProvider, llmModel: data.llmModel,
      ttsProvider: data.ttsProvider, ttsVoice: data.ttsVoice, ttsModel: data.ttsModel,
      telephonyProvider: data.telephonyProvider,
      temperature: data.temperature, maxDuration: data.maxDuration,
      greetingMessage: data.greetingMessage || undefined,
      endCallPhrases: data.endCallPhrases || undefined,
      silenceTimeoutSeconds: data.silenceTimeoutSeconds,
      language: data.language,
      backchannelingEnabled: data.backchannelingEnabled,
      backchannelingFrequency: data.backchannelingFrequency,
      webhookUrl: data.webhookUrl || undefined,
      webhookSecret: data.webhookSecret || undefined,
      noiseCancellationEnabled: data.noiseCancellationEnabled,
      inactivityMessage: data.inactivityMessage || undefined,
      timezone: data.timezone || undefined,
      ambientSoundId: data.ambientSoundId || undefined,
      promptVariables: data.promptVariables,
      vadSilenceMs: data.vadSilenceMs,
      bargeInEnabled: data.bargeInEnabled,
      bargeInEnergyThreshold: data.bargeInEnergyThreshold,
      bargeInMinFrames: data.bargeInMinFrames,
      tools: data.tools?.map(t => ({ ...t, transferMode: t.transferMode ?? "cold" })),
      dispositionSchema: data.dispositionSchema?.map(f => ({
        ...f,
        options: f.options ? f.options.split(",").map(s => s.trim()).filter(Boolean).join(", ") : undefined,
      })),
      maxConcurrentCalls: data.maxConcurrentCalls,
      monthlySpendLimitCents: data.monthlySpendLimitCents,
      memoryEnabled: data.memoryEnabled,
      crossCallMemoryEnabled: data.crossCallMemoryEnabled,
      contextWindowMessages: data.contextWindowMessages,
      autoCallbackEnabled: data.autoCallbackEnabled,
      autoCallbackRetries: data.autoCallbackRetries,
      autoCallbackDelaySeconds: data.autoCallbackDelaySeconds,
    };
    saveAgents(agents.map(a => a.id === agent.id ? updated : a));
    toast({ title: "Saved", description: `Agent "${updated.name}" updated.` });
    setIsSaving(false);
  };

  if (!isLoaded) {
    return (
      <div className="p-6 md:p-8 space-y-4 max-w-5xl mx-auto">
        <Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!agent) {
    return (
      <div className="p-6 md:p-8 max-w-5xl mx-auto">
        <p className="text-muted-foreground">Agent not found.</p>
        <Link href="/family/agents"><Button className="mt-4" variant="outline">Back to Agents</Button></Link>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-6 md:p-8 pt-6 max-w-5xl mx-auto h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/family/agents">
          <Button variant="outline" size="icon" className="h-8 w-8"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Bot className="h-6 w-6 text-primary" /> {agent.name}
            </h2>
            <Badge className={STATUS_COLORS[agent.status]}>{agent.status}</Badge>
          </div>
          <p className="text-muted-foreground text-sm mt-1">{agent.companyName}{agent.policyName ? ` · ${agent.policyName}` : ""}</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="config" className="flex-1 flex flex-col">
        <TabsList className="w-full justify-start mb-2">
          <TabsTrigger value="config">Configuration</TabsTrigger>
          <TabsTrigger value="test-call" className="flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5" /> Test Call
          </TabsTrigger>
          <TabsTrigger value="call-log">
            Call Log {agentCalls.length > 0 && <Badge className="ml-1.5 bg-primary/20 text-primary text-[10px] px-1.5 py-0">{agentCalls.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* ── Configuration Tab ── */}
        <TabsContent value="config">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pb-24">

              {/* ── Identity ── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="md:col-span-2">
                  <CardHeader><CardTitle>Identity</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField control={form.control} name="status" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Status</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>{STATUS_LIST.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="agentType" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Agent Type</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value ?? ""}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="inbound_support">Inbound Support</SelectItem>
                              <SelectItem value="outbound_sales">Outbound Sales</SelectItem>
                              <SelectItem value="appointment_booking">Appointment Booking</SelectItem>
                              <SelectItem value="lead_qualification">Lead Qualification</SelectItem>
                              <SelectItem value="general_purpose">General Purpose</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField control={form.control} name="companyId" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Company</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger></FormControl>
                            <SelectContent className="max-h-64">
                              {companies.map(c => <SelectItem key={c.id} value={c.id}><span className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5" />{c.name}</span></SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="policyId" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Policy <span className="text-muted-foreground text-xs">(optional)</span></FormLabel>
                          <Select onValueChange={field.onChange} value={field.value ?? ""}>
                            <FormControl><SelectTrigger><SelectValue placeholder="No specific policy" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {policiesForCompany.length === 0
                                ? <SelectItem value="none" disabled>No policies for this company</SelectItem>
                                : policiesForCompany.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="name" render={({ field }) => (
                      <FormItem><FormLabel>Name</FormLabel><FormControl><Input placeholder="Agent name" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="description" render={({ field }) => (
                      <FormItem><FormLabel>Description <span className="text-muted-foreground text-xs">(optional)</span></FormLabel><FormControl><Input placeholder="Brief description of this agent's purpose" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                  </CardContent>
                </Card>

                {/* ── AI Behavior ── */}
                <Card>
                  <CardHeader><CardTitle>AI Behavior</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <FormField control={form.control} name="systemPrompt" render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between">
                          <FormLabel>System Prompt</FormLabel>
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setFullscreenPrompt(true)} title="Expand">
                            <Maximize2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <FormControl>
                          <Textarea placeholder="You are a helpful insurance assistant..." className="min-h-[140px] font-mono text-sm" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="timezone" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Timezone</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value ?? ""}>
                          <FormControl><SelectTrigger><SelectValue placeholder="No timezone (server UTC used)" /></SelectTrigger></FormControl>
                          <SelectContent className="max-h-64">
                            {AGENT_TIMEZONES.map(tz => <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormDescription>Current date &amp; time injected into LLM calls.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="temperature" render={({ field }) => (
                      <FormItem>
                        <div className="flex justify-between items-center mb-2">
                          <FormLabel>Temperature: {field.value}</FormLabel>
                        </div>
                        <FormControl>
                          <Slider min={0} max={2} step={0.1} value={[field.value ?? 0.7]} onValueChange={(vals) => field.onChange(vals[0])} />
                        </FormControl>
                        <FormDescription>Higher = more creative. Lower = more deterministic.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </CardContent>
                </Card>

                {/* ── Prompt Variables ── */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base flex items-center gap-2"><Database className="h-4 w-4" /> Prompt Variables</CardTitle>
                        <CardDescription>Named slots like {"{{company_name}}"} injected at runtime.</CardDescription>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={() => appendPromptVar({ key: "", defaultValue: "", description: "" })}>
                        <Plus className="h-4 w-4 mr-1" /> Add
                      </Button>
                    </div>
                  </CardHeader>
                  {promptVarFields.length > 0 && (
                    <CardContent className="space-y-3">
                      {promptVarFields.map((field, index) => (
                        <div key={field.id} className="border rounded-md p-3 bg-muted/20 space-y-2">
                          <div className="flex gap-2">
                            <FormField control={form.control} name={`promptVariables.${index}.key`} render={({ field: f }) => (
                              <FormItem className="flex-1"><FormControl><Input placeholder="company_name" {...f} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={form.control} name={`promptVariables.${index}.defaultValue`} render={({ field: f }) => (
                              <FormItem className="flex-1"><FormControl><Input placeholder="Default value" {...f} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removePromptVar(index)}><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  )}
                </Card>

                {/* ── Conversation Behavior ── */}
                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle>Conversation Behavior</CardTitle>
                    <CardDescription>Control how the agent opens, responds, and ends calls.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <FormField control={form.control} name="greetingMessage" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Greeting Message</FormLabel>
                            <FormControl><Textarea placeholder="e.g. Hello! How can I help you today?" className="min-h-[80px]" {...field} /></FormControl>
                            <FormDescription>First thing the agent says.</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="endCallPhrases" render={({ field }) => (
                          <FormItem>
                            <FormLabel>End-Call Phrases</FormLabel>
                            <FormControl><Input placeholder="goodbye, bye, have a great day" {...field} /></FormControl>
                            <FormDescription>Comma-separated. Triggers automatic hangup.</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="inactivityMessage" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Inactivity Message</FormLabel>
                            <FormControl><Input placeholder="Are you still there?" {...field} /></FormControl>
                            <FormDescription>Spoken when caller goes silent.</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <FormField control={form.control} name="language" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Language</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value ?? ""}>
                                <FormControl><SelectTrigger><SelectValue placeholder="Select language" /></SelectTrigger></FormControl>
                                <SelectContent className="max-h-64">
                                  {LANGUAGES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                                </SelectContent>
                              </Select>
                              <FormDescription>Passed to ASR + TTS.</FormDescription>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="silenceTimeoutSeconds" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Silence Timeout (s)</FormLabel>
                              <FormControl>
                                <Input type="number" min={5} max={300} placeholder="30" {...field}
                                  onChange={(e) => field.onChange(parseInt(e.target.value, 10))} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>
                        <FormField control={form.control} name="asrLanguage" render={({ field }) => (
                          <FormItem>
                            <FormLabel>ASR Language Override</FormLabel>
                            <Select
                              onValueChange={(v) => field.onChange(v === "__none__" ? "" : v)}
                              value={field.value || "__none__"}
                            >
                              <FormControl><SelectTrigger><SelectValue placeholder="Same as Language above" /></SelectTrigger></FormControl>
                              <SelectContent className="max-h-64">
                                <SelectItem value="__none__">Same as Language above</SelectItem>
                                {LANGUAGES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />

                        {/* Ambient Noise */}
                        <FormField control={form.control} name="ambientSoundId" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-1.5">
                              <Volume2 className="h-3.5 w-3.5 text-muted-foreground" /> Ambient Background Sound
                            </FormLabel>
                            <Select
                              onValueChange={(v) => field.onChange(v === "__none__" ? "" : v)}
                              value={field.value || "__none__"}
                            >
                              <FormControl><SelectTrigger><SelectValue placeholder="No ambient sound" /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="__none__">None</SelectItem>
                                {ambientSounds.map(s => (
                                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormDescription className="text-[11px]">Mixes background audio into the TTS output (office noise, call centre, etc.)</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )} />

                        <div className="space-y-3 p-4 border rounded-md bg-muted/20">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium leading-none">Noise Cancellation</p>
                              <p className="text-xs text-muted-foreground mt-1">Request noise reduction from the ASR provider</p>
                            </div>
                            <FormField control={form.control} name="noiseCancellationEnabled" render={({ field }) => (
                              <FormItem>
                                <Select onValueChange={(v) => field.onChange(v === "true")} value={field.value ? "true" : "false"}>
                                  <FormControl><SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger></FormControl>
                                  <SelectContent><SelectItem value="false">Off</SelectItem><SelectItem value="true">On</SelectItem></SelectContent>
                                </Select>
                              </FormItem>
                            )} />
                          </div>
                        </div>
                        <div className="space-y-3 p-4 border rounded-md bg-muted/20">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium leading-none">Backchanneling</p>
                              <p className="text-xs text-muted-foreground mt-1">Agent says "I see", "Got it" etc. while thinking</p>
                            </div>
                            <FormField control={form.control} name="backchannelingEnabled" render={({ field }) => (
                              <FormItem>
                                <Select onValueChange={(v) => field.onChange(v === "true")} value={field.value ? "true" : "false"}>
                                  <FormControl><SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger></FormControl>
                                  <SelectContent><SelectItem value="false">Off</SelectItem><SelectItem value="true">On</SelectItem></SelectContent>
                                </Select>
                              </FormItem>
                            )} />
                          </div>
                          {backchannelingEnabled && (
                            <>
                              <FormField control={form.control} name="backchannelingFrequency" render={({ field }) => (
                                <FormItem>
                                  <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>Frequency</span>
                                    <span>{Math.round((backchannelingFrequency ?? 0.5) * 100)}% of turns</span>
                                  </div>
                                  <FormControl>
                                    <Slider min={0} max={1} step={0.05} value={[field.value ?? 0.5]} onValueChange={(vals) => field.onChange(vals[0])} />
                                  </FormControl>
                                </FormItem>
                              )} />
                            </>
                          )}
                        </div>
                        <FormField control={form.control} name="webhookUrl" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Post-Call Webhook URL</FormLabel>
                            <FormControl><Input placeholder="https://your-server.com/webhook" {...field} /></FormControl>
                            <FormDescription>Receives a JSON summary when each call ends.</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="webhookSecret" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Webhook Signing Secret</FormLabel>
                            <FormControl><Input type="password" placeholder="Optional — enables HMAC signature header" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* ── Pipeline ── */}
                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle>Pipeline Configuration</CardTitle>
                    <CardDescription>Select providers and models for each stage.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold shrink-0">1</span>
                          <p className="text-sm font-semibold">ASR <span className="text-muted-foreground font-normal text-xs">— Speech-to-Text</span></p>
                        </div>
                        <FormField control={form.control} name="asrProvider" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Provider</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>{availableAsrProviders.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                        {ASR_MODELS[asrProvider] && (
                          <FormField control={form.control} name="asrModel" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Model</FormLabel>
                              <FormControl><ModelSelect options={ASR_MODELS[asrProvider]} value={field.value} onChange={field.onChange} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        )}
                        <FormField control={form.control} name="maxDuration" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Max Duration (s)</FormLabel>
                            <FormControl>
                              <Input type="number" min={10} max={3600} placeholder="600"
                                {...field} onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold shrink-0">2</span>
                          <p className="text-sm font-semibold">LLM <span className="text-muted-foreground font-normal text-xs">— Language Model</span></p>
                        </div>
                        <FormField control={form.control} name="llmProvider" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Provider</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>{availableLlmProviders.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                        {LLM_MODELS[llmProvider] && (
                          <FormField control={form.control} name="llmModel" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Model</FormLabel>
                              <FormControl><ModelSelect options={LLM_MODELS[llmProvider]} value={field.value} onChange={field.onChange} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        )}
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold shrink-0">3</span>
                          <p className="text-sm font-semibold">TTS <span className="text-muted-foreground font-normal text-xs">— Text-to-Speech</span></p>
                        </div>
                        <FormField control={form.control} name="ttsProvider" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Provider</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>{availableTtsProviders.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                        {ttsProvider === "cartesia" && (
                          <FormField control={form.control} name="ttsVoice" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Voice</FormLabel>
                              {cartesiaListedVoices.length > 0 ? (
                                <Select value={field.value ?? ""} onValueChange={field.onChange}>
                                  <FormControl><SelectTrigger><SelectValue placeholder="Select voice" /></SelectTrigger></FormControl>
                                  <SelectContent>{cartesiaListedVoices.map(v => <SelectItem key={v.id} value={v.id}>{v.name}{v.language ? ` · ${v.language}` : ""}</SelectItem>)}</SelectContent>
                                </Select>
                              ) : (
                                <FormControl><Input placeholder="Paste a Cartesia voice ID" {...field} /></FormControl>
                              )}
                              <FormMessage />
                            </FormItem>
                          )} />
                        )}
                        {ttsProvider !== "cartesia" && TTS_VOICES[ttsProvider] !== undefined && TTS_VOICES[ttsProvider] !== null && (
                          <FormField control={form.control} name="ttsVoice" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Voice</FormLabel>
                              <FormControl><ModelSelect options={TTS_VOICES[ttsProvider]!} value={field.value} onChange={field.onChange} placeholder="Select voice" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        )}
                        {ttsProvider !== "cartesia" && TTS_VOICES[ttsProvider] === null && (
                          <FormField control={form.control} name="ttsVoice" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Voice ID</FormLabel>
                              <FormControl><Input placeholder="Paste a voice ID from your provider" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        )}
                        {TTS_MODELS[ttsProvider] && (
                          <FormField control={form.control} name="ttsModel" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Model</FormLabel>
                              <FormControl><ModelSelect options={TTS_MODELS[ttsProvider]} value={field.value} onChange={field.onChange} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        )}
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold shrink-0">4</span>
                          <p className="text-sm font-semibold">Telephony</p>
                        </div>
                        <FormField control={form.control} name="telephonyProvider" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Provider</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>{availableTelephonyProviders.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* ── Advanced STT ── */}
              <Card>
                <CardHeader className="pb-3 cursor-pointer" onClick={() => setShowAdvancedSTT(v => !v)}>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">Advanced STT Settings</CardTitle>
                      <CardDescription>Fine-tune streaming STT behaviour, confidence thresholds, and end-of-turn detection.</CardDescription>
                    </div>
                    {showAdvancedSTT ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </CardHeader>
                {showAdvancedSTT && (
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                      <FormField control={form.control} name="asrKeyterms" render={({ field }) => (
                        <FormItem className="sm:col-span-2 lg:col-span-3">
                          <FormLabel>Key-terms / Boosted Words</FormLabel>
                          <FormControl><Input placeholder="e.g. ICICI, Lombard, policyholder, IRDA" {...field} /></FormControl>
                          <FormDescription className="text-[11px]">Comma-separated words the ASR should recognize with higher accuracy.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="asrSmartEndpointing" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Smart Endpointing</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value ?? "off"}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="off">Off (default)</SelectItem>
                              <SelectItem value="vapi">Vapi-style</SelectItem>
                              <SelectItem value="livekit">LiveKit-style</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="asrConfidenceThreshold" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Confidence Threshold: {field.value?.toFixed(2)}</FormLabel>
                          <FormControl>
                            <Slider min={0} max={1} step={0.05} value={[field.value ?? 0.40]} onValueChange={vals => field.onChange(vals[0])} />
                          </FormControl>
                          <FormDescription className="text-[11px]">Transcripts below this confidence are discarded.</FormDescription>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="asrEndOfTurnConfidence" render={({ field }) => (
                        <FormItem>
                          <FormLabel>End-of-Turn Confidence: {field.value?.toFixed(2)}</FormLabel>
                          <FormControl>
                            <Slider min={0.3} max={1} step={0.05} value={[field.value ?? 0.70]} onValueChange={vals => field.onChange(vals[0])} />
                          </FormControl>
                          <FormDescription className="text-[11px]">How sure ASR must be the user stopped speaking.</FormDescription>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="asrEndOfTurnTimeout" render={({ field }) => (
                        <FormItem>
                          <FormLabel>End-of-Turn Timeout (ms)</FormLabel>
                          <FormControl>
                            <Input type="number" min={100} max={30000} placeholder="5000" {...field}
                              onChange={e => field.onChange(parseInt(e.target.value, 10))} />
                          </FormControl>
                        </FormItem>
                      )} />
                      <div className="space-y-3 p-3 border rounded-md bg-muted/20">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">Background Denoising</p>
                          <FormField control={form.control} name="asrBackgroundDenoising" render={({ field }) => (
                            <FormItem>
                              <Select onValueChange={v => field.onChange(v === "true")} value={field.value ? "true" : "false"}>
                                <FormControl><SelectTrigger className="w-[80px]"><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent><SelectItem value="false">Off</SelectItem><SelectItem value="true">On</SelectItem></SelectContent>
                              </Select>
                            </FormItem>
                          )} />
                        </div>
                      </div>
                      <div className="space-y-3 p-3 border rounded-md bg-muted/20">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">Auto Fallback</p>
                          <FormField control={form.control} name="asrAutoFallback" render={({ field }) => (
                            <FormItem>
                              <Select onValueChange={v => field.onChange(v === "true")} value={field.value ? "true" : "false"}>
                                <FormControl><SelectTrigger className="w-[80px]"><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent><SelectItem value="false">Off</SelectItem><SelectItem value="true">On</SelectItem></SelectContent>
                              </Select>
                            </FormItem>
                          )} />
                        </div>
                      </div>
                    </div>

                    {/* VAD / Barge-In */}
                    <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      <FormField control={form.control} name="vadSilenceMs" render={({ field }) => (
                        <FormItem>
                          <FormLabel>VAD Silence (ms)</FormLabel>
                          <FormControl><Input type="number" min={50} max={2000} value={field.value ?? 250} onChange={e => field.onChange(parseInt(e.target.value, 10))} /></FormControl>
                          <FormDescription className="text-[11px]">Silence length to detect end-of-speech. Default: 250</FormDescription>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="bargeInEnabled" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Barge-in</FormLabel>
                          <Select onValueChange={v => field.onChange(v === "true")} value={field.value ? "true" : "false"}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent><SelectItem value="false">Off</SelectItem><SelectItem value="true">On</SelectItem></SelectContent>
                          </Select>
                          <FormDescription className="text-[11px]">Let the caller interrupt the agent mid-speech.</FormDescription>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="bargeInEnergyThreshold" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Barge-in Energy Threshold</FormLabel>
                          <FormControl><Input type="number" min={100} max={5000} step={100} value={field.value ?? 1200} onChange={e => field.onChange(parseInt(e.target.value, 10))} /></FormControl>
                          <FormDescription className="text-[11px]">Min RMS energy to count as speech. Default: 1200</FormDescription>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="bargeInMinFrames" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Barge-in Min Frames</FormLabel>
                          <FormControl><Input type="number" min={1} max={20} value={field.value ?? 4} onChange={e => field.onChange(parseInt(e.target.value, 10))} /></FormControl>
                          <FormDescription className="text-[11px]">Consecutive speech frames to trigger barge-in. Default: 4</FormDescription>
                        </FormItem>
                      )} />
                    </div>
                  </CardContent>
                )}
              </Card>

              {/* ── Tools ── */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2"><PhoneForwarded className="h-4 w-4" /> Tools</CardTitle>
                      <CardDescription>Actions the LLM can trigger mid-call.</CardDescription>
                    </div>
                    <Button type="button" variant="outline" size="sm"
                      onClick={() => appendTool({ type: "call_transfer", name: "transfer_to_human", description: "Transfer the call to a human agent when the caller requests it or the issue cannot be resolved automatically.", transferTo: "", warmHandoffMessage: "" })}>
                      <Plus className="h-4 w-4 mr-1" /> Add Tool
                    </Button>
                  </div>
                </CardHeader>
                {toolFields.length > 0 && (
                  <CardContent className="space-y-4">
                    {toolFields.map((field, index) => (
                      <div key={field.id} className="border rounded-md p-4 bg-muted/20 space-y-3 relative">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Call Transfer</span>
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeTool(index)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <FormField control={form.control} name={`tools.${index}.name`} render={({ field: f }) => (
                            <FormItem><FormLabel className="text-xs">Function Name</FormLabel><FormControl><Input placeholder="e.g. transfer_to_human" {...f} /></FormControl><FormMessage /></FormItem>
                          )} />
                          <FormField control={form.control} name={`tools.${index}.transferTo`} render={({ field: f }) => (
                            <FormItem><FormLabel className="text-xs">Transfer To (phone number)</FormLabel><FormControl><Input placeholder="+911234567890" {...f} /></FormControl><FormMessage /></FormItem>
                          )} />
                        </div>
                        <FormField control={form.control} name={`tools.${index}.description`} render={({ field: f }) => (
                          <FormItem><FormLabel className="text-xs">Description (shown to LLM)</FormLabel><FormControl><Textarea className="min-h-[60px] text-sm" {...f} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name={`tools.${index}.warmHandoffMessage`} render={({ field: f }) => (
                          <FormItem><FormLabel className="text-xs">Hold Message (optional)</FormLabel><FormControl><Input placeholder="Connecting you with a specialist now…" {...f} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name={`tools.${index}.transferMode`} render={({ field: f }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Transfer Mode</FormLabel>
                            <div className="flex gap-2 mt-1">
                              {([["cold", "Cold Transfer"], ["warm_summary", "Warm — Brief Operator"]] as const).map(([val, label]) => (
                                <button key={val} type="button" onClick={() => f.onChange(val)}
                                  className={"flex-1 text-xs font-medium py-2 rounded-lg border transition-colors " + ((f.value ?? "cold") === val ? "bg-foreground text-background border-foreground" : "bg-card text-muted-foreground border-border hover:border-foreground/40")}>
                                  {label}
                                </button>
                              ))}
                            </div>
                          </FormItem>
                        )} />
                      </div>
                    ))}
                  </CardContent>
                )}
              </Card>

              {/* ── Disposition Schema ── */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2"><ClipboardList className="h-4 w-4" /> Disposition Fields</CardTitle>
                      <CardDescription>Fields the AI extracts automatically from each call transcript.</CardDescription>
                    </div>
                    <Button type="button" variant="outline" size="sm"
                      onClick={() => appendDisposition({ type: "text", key: "", label: "", required: false, options: "" })}>
                      <Plus className="h-4 w-4 mr-1" /> Add Field
                    </Button>
                  </div>
                </CardHeader>
                {dispositionFields.length > 0 && (
                  <CardContent className="space-y-3">
                    {dispositionFields.map((field, index) => {
                      const watchedType = form.watch(`dispositionSchema.${index}.type`);
                      return (
                        <div key={field.id} className="border rounded-md p-4 bg-muted/20 space-y-3 relative">
                          <Button type="button" variant="ghost" size="icon" className="absolute top-2 right-2 h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeDisposition(index)}><Trash2 className="h-4 w-4" /></Button>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <FormField control={form.control} name={`dispositionSchema.${index}.key`} render={({ field: f }) => (
                              <FormItem><FormLabel className="text-xs">Key</FormLabel><FormControl><Input placeholder="e.g. call_outcome" {...f} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={form.control} name={`dispositionSchema.${index}.label`} render={({ field: f }) => (
                              <FormItem><FormLabel className="text-xs">Label</FormLabel><FormControl><Input placeholder="e.g. Call Outcome" {...f} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={form.control} name={`dispositionSchema.${index}.type`} render={({ field: f }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Type</FormLabel>
                                <Select onValueChange={f.onChange} value={f.value}>
                                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                  <SelectContent>
                                    <SelectItem value="text">Text</SelectItem><SelectItem value="number">Number</SelectItem>
                                    <SelectItem value="boolean">Yes / No</SelectItem><SelectItem value="choice">Choice</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )} />
                          </div>
                          {watchedType === "choice" && (
                            <FormField control={form.control} name={`dispositionSchema.${index}.options`} render={({ field: f }) => (
                              <FormItem><FormLabel className="text-xs">Options</FormLabel><FormControl><Input placeholder="e.g. resolved, escalated, callback" {...f} /></FormControl><FormMessage /></FormItem>
                            )} />
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                )}
              </Card>

              {/* ── Usage Limits ── */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Usage Limits <span className="text-muted-foreground font-normal text-sm ml-1">(optional)</span></CardTitle>
                  <CardDescription>Cap concurrent calls and monthly spend for this agent.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="maxConcurrentCalls" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Max concurrent calls</FormLabel>
                        <FormControl><Input type="number" placeholder="No limit" min={1} max={100} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="monthlySpendLimitCents" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Monthly spend limit (USD)</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <span className="absolute left-3 top-2.5 text-muted-foreground text-sm">$</span>
                            <Input type="number" placeholder="No limit" min={1} step={1} className="pl-6"
                              value={field.value != null ? (field.value / 100).toFixed(2) : ""}
                              onChange={(e) => field.onChange(e.target.value === "" ? undefined : Math.round(Number(e.target.value) * 100))} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </CardContent>
              </Card>

              {/* ── Memory ── */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Memory &amp; Context</CardTitle>
                  <CardDescription>Configure in-call and cross-call memory for this agent.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <FormField control={form.control} name="memoryEnabled" render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>In-Call Memory</FormLabel>
                        <div className="flex items-center gap-3 pt-2">
                          <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
                          <span className="text-sm text-muted-foreground">{(field.value ?? false) ? "Enabled" : "Disabled"}</span>
                        </div>
                        <FormDescription className="text-[11px]">Agent remembers context within the current call.</FormDescription>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="crossCallMemoryEnabled" render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Cross-Call Memory</FormLabel>
                        <div className="flex items-center gap-3 pt-2">
                          <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
                          <span className="text-sm text-muted-foreground">{(field.value ?? false) ? "Enabled" : "Disabled"}</span>
                        </div>
                        <FormDescription className="text-[11px]">Agent remembers past calls with the same customer.</FormDescription>
                      </FormItem>
                    )} />
                    {memoryEnabled && (
                      <FormField control={form.control} name="contextWindowMessages" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Context Window (messages)</FormLabel>
                          <FormControl><Input type="number" min={5} max={100} placeholder="20" value={field.value ?? 20} onChange={e => field.onChange(parseInt(e.target.value, 10))} /></FormControl>
                          <FormDescription className="text-[11px]">Previous messages to include in each LLM call.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* ── Auto Callback ── */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Auto Callback</CardTitle>
                  <CardDescription>Automatically retry calls when the customer doesn't answer.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <FormField control={form.control} name="autoCallbackEnabled" render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Enable Auto Callback</FormLabel>
                        <div className="flex items-center gap-3 pt-2">
                          <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
                          <span className="text-sm text-muted-foreground">{(field.value ?? false) ? "Enabled" : "Disabled"}</span>
                        </div>
                        <FormDescription className="text-[11px]">Retry the call if it goes unanswered.</FormDescription>
                      </FormItem>
                    )} />
                    {autoCallbackEnabled && (
                      <>
                        <FormField control={form.control} name="autoCallbackRetries" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Max Retries</FormLabel>
                            <FormControl><Input type="number" min={1} max={10} placeholder="3" value={field.value ?? 3} onChange={e => field.onChange(parseInt(e.target.value, 10))} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="autoCallbackDelaySeconds" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Delay Between Retries (s)</FormLabel>
                            <FormControl><Input type="number" min={10} max={3600} placeholder="300" value={field.value ?? 300} onChange={e => field.onChange(parseInt(e.target.value, 10))} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* ── Fixed save bar ── */}
              <div className="fixed bottom-0 left-0 md:left-64 right-0 p-4 bg-background/80 backdrop-blur-sm border-t border-border flex justify-end z-10">
                <div className="max-w-5xl mx-auto w-full flex justify-end gap-4">
                  <Link href="/family/agents">
                    <Button type="button" variant="outline">Cancel</Button>
                  </Link>
                  <Button type="submit" disabled={isSaving}>
                    <Save className="mr-2 h-4 w-4" />
                    {isSaving ? "Saving…" : "Save Changes"}
                  </Button>
                </div>
              </div>
            </form>
          </Form>
        </TabsContent>

        {/* ── Test Call Tab ── */}
        <TabsContent value="test-call" className="mt-0">
          <WebCallPanel agent={agent} onCallSaved={addCall} />
        </TabsContent>

        {/* ── Call Log Tab ── */}
        <TabsContent value="call-log" className="mt-0">
          <CallLogPanel calls={agentCalls} />
        </TabsContent>
      </Tabs>

      {/* ── Fullscreen system prompt dialog ── */}
      <Dialog open={fullscreenPrompt} onOpenChange={setFullscreenPrompt}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>System Prompt — {agent.name}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 flex flex-col gap-3">
            <Textarea
              className="flex-1 font-mono text-sm resize-none"
              value={systemPromptWatch ?? ""}
              onChange={(e) => form.setValue("systemPrompt", e.target.value, { shouldDirty: true })}
              placeholder="You are a helpful insurance assistant..."
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setFullscreenPrompt(false)}>Close</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
