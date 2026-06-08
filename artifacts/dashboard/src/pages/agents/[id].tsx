import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { Link, useParams, useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import {
  ArrowLeft, Settings2, Activity, Phone, BarChart2, Clock,
  Mic, MicOff, PhoneOff, Copy, Check, Loader2, Volume2, PhoneOutgoing, Pencil
} from "lucide-react";
import {
  useGetAgent,
  getGetAgentQueryKey,
  useListCalls,
  getListCallsQueryKey,
  useInitiateOutboundCall,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { formatApiError, isKycError, isDestinationUnverifiedError } from "@/lib/format-api-error";
import { DestinationOtpDialog } from "@/components/destination-otp-dialog";

/* ── Web Call Panel ───────────────────────────────────────────────────────── */

type CallStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "ended";

interface Msg { speaker: "user" | "agent"; text: string }

function useWebcallKeyStatus() {
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

function WebCallPanel({ agentId, agentName, autostart, callbackId }: { agentId: number; agentName: string; autostart?: boolean; callbackId?: number }) {
  const [status, setStatus]     = useState<CallStatus>("idle");
  const [msgs, setMsgs]         = useState<Msg[]>([]);
  const [error, setError]       = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [copied, setCopied]     = useState(false);
  const { keys: keyStatus, loading: keyLoading } = useWebcallKeyStatus();
  const { userId: callerUserId } = useAuth();
  const hasAutoStarted          = useRef(false);

  const wsRef          = useRef<WebSocket | null>(null);
  const audioCtxRef    = useRef<AudioContext | null>(null);
  const processorRef   = useRef<ScriptProcessorNode | null>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const nextPlayRef    = useRef(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const scrollRef      = useRef<HTMLDivElement>(null);
  // Barge-in mute gate: set true on "interrupted", cleared when the agent
  // starts its next turn ("thinking"/"speaking" status). Any binary PCM
  // chunks that were already in-flight in the TCP buffer when the server
  // sent "interrupted" are silently dropped instead of playing a blip.
  const mutedRef       = useRef(false);

  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [msgs]);

  // ── Audio helpers ──────────────────────────────────────────────────────────
  function float32ToInt16(f32: Float32Array): Int16Array {
    const int16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      int16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));
    }
    return int16;
  }

  /** Stop all queued/playing agent audio immediately (barge-in). */
  function stopAllAudio() {
    for (const src of activeSourcesRef.current) {
      try { src.stop(); } catch { /* already ended */ }
    }
    activeSourcesRef.current = [];
    // Reset playback clock so next audio plays immediately
    const ctx = audioCtxRef.current;
    if (ctx) nextPlayRef.current = ctx.currentTime;
  }

  function playPCM16(buf: ArrayBuffer) {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const int16  = new Int16Array(buf);
    const f32    = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;
    const abuf   = ctx.createBuffer(1, f32.length, 16000);
    abuf.getChannelData(0).set(f32);
    const src    = ctx.createBufferSource();
    src.buffer   = abuf;
    src.connect(ctx.destination);
    const now    = ctx.currentTime;
    nextPlayRef.current = Math.max(now + 0.02, nextPlayRef.current);
    src.start(nextPlayRef.current);
    nextPlayRef.current += abuf.duration;
    // Track so we can stop on barge-in
    activeSourcesRef.current.push(src);
    src.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== src);
    };
  }

  // ── Start call ─────────────────────────────────────────────────────────────
  const startCall = useCallback(async () => {
    setError(null);
    setMsgs([]);
    setDuration(null);
    setStatus("connecting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
      });
      streamRef.current = stream;

      const proto = location.protocol === "https:" ? "wss" : "ws";
      const qsParts: string[] = [];
      if (callerUserId) qsParts.push(`callerId=${encodeURIComponent(callerUserId)}`);
      if (callbackId)  qsParts.push(`callbackId=${callbackId}`);
      const qs = qsParts.length ? `?${qsParts.join("&")}` : "";
      const ws = new WebSocket(`${proto}://${location.host}/api/ws/webcall/${agentId}${qs}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx({ sampleRate: 16000 }) as AudioContext;
        audioCtxRef.current = ctx;
        nextPlayRef.current = 0;

        const src       = ctx.createMediaStreamSource(stream);
        const processor = ctx.createScriptProcessor(2048, 1, 1);
        processorRef.current = processor;
        src.connect(processor);
        processor.connect(ctx.destination);

        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const int16 = float32ToInt16(e.inputBuffer.getChannelData(0));
          ws.send(int16.buffer);
        };
      };

      ws.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) {
          // Drop in-flight PCM chunks that arrived after a barge-in "interrupted"
          // message but before the agent's next turn begins.
          if (!mutedRef.current) playPCM16(e.data);
          return;
        }
        try {
          const msg = JSON.parse(e.data as string) as {
            type: string; status?: CallStatus; speaker?: "user" | "agent";
            text?: string; durationSeconds?: number; message?: string;
          };
          if (msg.type === "ready") {
            setStatus("listening");
          } else if (msg.type === "interrupted") {
            // Barge-in: user spoke while agent was talking — stop audio immediately
            // and mute any in-flight binary chunks still in the TCP buffer.
            stopAllAudio();
            mutedRef.current = true;
            setStatus("listening");
          } else if (msg.type === "status" && msg.status) {
            // Unmute when the agent starts its next turn so its audio plays normally.
            if (msg.status === "thinking" || msg.status === "speaking") mutedRef.current = false;
            setStatus(msg.status);
          } else if (msg.type === "transcript" && msg.speaker && msg.text) {
            setMsgs(prev => [...prev, { speaker: msg.speaker!, text: msg.text! }]);
          } else if (msg.type === "ended") {
            setDuration(msg.durationSeconds ?? null);
            setStatus("ended");
            cleanup();
          } else if (msg.type === "error") {
            setError(msg.message ?? "An error occurred");
            setStatus("idle");
            cleanup();
          }
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        if (status !== "ended" && status !== "idle") setStatus("idle");
        cleanup();
      };

      ws.onerror = () => {
        setError("WebSocket connection failed. Make sure your API keys are configured.");
        setStatus("idle");
        cleanup();
      };

    } catch {
      setError("Microphone access was denied or is unavailable.");
      setStatus("idle");
    }
  }, [agentId]);

  // ── End call ───────────────────────────────────────────────────────────────
  const endCall = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "end" }));
    }
    setStatus("idle");
    cleanup();
  }, []);

  function cleanup() {
    processorRef.current?.disconnect();
    processorRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (wsRef.current && wsRef.current.readyState < 2) wsRef.current.close();
    wsRef.current = null;
  }

  useEffect(() => () => { cleanup(); }, []);

  // ── Widget embed code ──────────────────────────────────────────────────────
  const embedCode = `<script src="${location.protocol}//${location.host}/api/widget.js"\n        data-agent-id="${agentId}"\n        data-name="${agentName}"\n        data-color="#a1a1aa">\n</script>`;

  const copyEmbed = () => {
    navigator.clipboard.writeText(embedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Status display ─────────────────────────────────────────────────────────
  const statusConfig: Record<CallStatus, { label: string; color: string; pulse: boolean }> = {
    idle:       { label: "Ready to test",    color: "bg-black/25",   pulse: false },
    connecting: { label: "Connecting…",      color: "bg-zinc-400",  pulse: true  },
    listening:  { label: "Listening…",       color: "bg-zinc-400",pulse: true  },
    thinking:   { label: "Thinking…",        color: "bg-zinc-400",  pulse: true  },
    speaking:   { label: "Speaking…",        color: "bg-zinc-400",    pulse: true  },
    ended:      { label: "Call ended",       color: "bg-black/25",   pulse: false },
  };
  const sc = statusConfig[status];
  const isActive = status !== "idle" && status !== "ended";

  // Pre-flight: determine which managed keys are missing based on the agent's providers
  const missingKeys: string[] = [];
  if (keyStatus !== null) {
    // These are the two platform-managed providers always required for webcall
    if (!keyStatus["sarvam"] && !keyStatus["deepgram"] && !keyStatus["openai"]) missingKeys.push("ASR (sarvam/deepgram)");
    if (!keyStatus["cartesia"] && !keyStatus["openai"]) missingKeys.push("TTS (cartesia)");
    if (!keyStatus["qwen"] && !keyStatus["openai"]) missingKeys.push("LLM (qwen)");
  }
  const keysReady = !keyLoading && keyStatus !== null && missingKeys.length === 0;

  // Auto-start when arriving from an incoming callback notification
  // Must be after keysReady is declared so the dependency is available.
  useEffect(() => {
    if (autostart && keysReady && status === "idle" && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      void startCall();
    }
  }, [autostart, keysReady, status, startCall]);

  return (
    <div className="space-y-5">
      {/* Call interface */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/50 pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Phone className="h-4 w-4 text-primary" />
            Browser Test Call
          </CardTitle>
          <CardDescription>
            Talk to <strong>{agentName}</strong> directly from your browser — no phone needed.
            Your microphone audio is streamed live through the full STT → LLM → TTS pipeline.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5 space-y-5">
          {/* Status bar */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-muted/40 border border-border/50">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${sc.color} ${sc.pulse ? "animate-pulse" : ""}`} />
            <span className="text-sm font-medium">{sc.label}</span>
            {status === "ended" && duration !== null && (
              <span className="text-xs text-muted-foreground ml-auto">Duration: {Math.floor(duration / 60)}m {duration % 60}s</span>
            )}
          </div>

          {/* Missing keys warning */}
          {!keyLoading && missingKeys.length > 0 && (
            <div className="text-sm text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-4 py-3">
              Missing API keys for: <strong>{missingKeys.join(", ")}</strong>. Contact the platform administrator to configure them.
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {/* Transcript */}
          <div
            ref={transcriptRef}
            className="h-64 overflow-y-auto space-y-3 pr-1 scroll-smooth"
          >
            {msgs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground gap-2">
                <Volume2 className="h-8 w-8 opacity-20" />
                <p className="text-sm">Transcript will appear here during the call.</p>
              </div>
            ) : (
              msgs.map((m, i) => (
                <div key={i} className={`flex ${m.speaker === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                    m.speaker === "user"
                      ? "bg-muted text-foreground rounded-br-sm"
                      : "bg-primary/15 text-foreground border border-primary/20 rounded-bl-sm"
                  }`}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      {m.speaker === "user" ? "You" : agentName}
                    </p>
                    {m.text}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Call controls */}
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
              <Button
                variant="destructive"
                className="flex-1 gap-2"
                onClick={endCall}
              >
                <PhoneOff className="h-4 w-4" /> End Call
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Widget embed */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            Embed on Your Website
          </CardTitle>
          <CardDescription>
            Drop this snippet into any webpage. A floating call button will appear — visitors can talk to this agent without installing anything.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <pre className="bg-muted/60 border border-border/60 rounded-lg px-4 py-3 text-xs font-mono overflow-x-auto text-foreground/80 whitespace-pre">
            {embedCode}
          </pre>
          <Button variant="outline" size="sm" className="gap-2" onClick={copyEmbed}>
            {copied ? <><Check className="h-3.5 w-3.5 text-foreground" /> Copied!</> : <><Copy className="h-3.5 w-3.5" /> Copy Embed Code</>}
          </Button>
          <p className="text-xs text-muted-foreground">
            You can customize <code className="font-mono bg-muted px-1 rounded">data-color</code>, <code className="font-mono bg-muted px-1 rounded">data-name</code>, and <code className="font-mono bg-muted px-1 rounded">data-position</code> (bottom-right, bottom-left, top-right, top-left).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Agent Detail Page ────────────────────────────────────────────────────── */

export default function AgentDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  // Support ?tab=test&autostart=1&callbackId=X URL params so the incoming-call notification
  // can deep-link straight to the Test Call tab and instantly start a callback call.
  const searchParams = new URLSearchParams(window.location.search);
  const initialTab    = searchParams.get("tab") === "test" ? "test" : "overview";
  const isAutostart   = searchParams.get("autostart") === "1";
  const urlCallbackId = searchParams.get("callbackId") ? parseInt(searchParams.get("callbackId")!, 10) : undefined;
  const [activeTab, setActiveTab] = useState(initialTab);
  const [callDialogOpen, setCallDialogOpen] = useState(false);
  const [toNumber, setToNumber] = useState("");
  const { toast } = useToast();

  const { data: agent, isLoading: agentLoading } = useGetAgent(id, {
    query: { enabled: !!id, queryKey: getGetAgentQueryKey(id) }
  });

  const { data: calls, isLoading: callsLoading } = useListCalls({ agentId: id }, {
    query: { enabled: !!id && activeTab === "calls", queryKey: getListCallsQueryKey({ agentId: id }) }
  });

  const outboundCall = useInitiateOutboundCall();
  const [, navigate] = useLocation();
  const [otpDialogOpen, setOtpDialogOpen]       = useState(false);
  const [pendingCallNumber, setPendingCallNumber] = useState("");

  function handleMakeCall(overrideNumber?: string) {
    const dest = (overrideNumber ?? toNumber).trim();
    if (!dest) return;
    outboundCall.mutate(
      { data: { agentId: id, toNumber: dest, webhookBaseUrl: window.location.origin } },
      {
        onSuccess: () => {
          toast({ title: "Call initiated", description: `Dialing ${dest} — the agent will connect momentarily.` });
          setCallDialogOpen(false);
          setToNumber("");
        },
        onError: (err: unknown) => {
          if (isKycError(err)) {
            toast({ title: "Verification required", description: "Complete identity verification before making telephony calls.", variant: "destructive" });
            navigate("/app/kyc");
          } else if (isDestinationUnverifiedError(err)) {
            setPendingCallNumber(dest);
            setOtpDialogOpen(true);
          } else {
            toast({ title: "Call failed", description: formatApiError(err), variant: "destructive" });
          }
        },
      }
    );
  }

  const formatDuration = (seconds?: number | null) => {
    if (!seconds) return "0s";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":  return <Badge className="bg-primary/20 text-primary border-transparent">Completed</Badge>;
      case "failed":     return <Badge className="bg-destructive/20 text-destructive border-transparent">Failed</Badge>;
      case "in_progress":return <Badge className="bg-muted text-zinc-400 border-transparent">In Progress</Badge>;
      case "pending":    return <Badge variant="outline" className="text-muted-foreground">Pending</Badge>;
      default:           return <Badge variant="outline">{status}</Badge>;
    }
  };

  const tabClass = "relative h-10 rounded-none border-b-2 border-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none transition-none data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none";

  if (agentLoading) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-10 w-[200px]" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    );
  }

  if (!agent) {
    return <div className="p-8 text-center text-muted-foreground">Agent not found.</div>;
  }

  return (
    <div className="flex-1 space-y-6 p-6 md:p-8 pt-6 h-full flex flex-col">
      {/* Make a Call Dialog */}
      <Dialog open={callDialogOpen} onOpenChange={setCallDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PhoneOutgoing className="h-5 w-5 text-primary" />
              Make a Phone Call
            </DialogTitle>
            <DialogDescription>
              This will dial the number using your <span className="font-medium capitalize">{agent.telephonyProvider}</span> account.
              The agent <span className="font-medium">{agent.name}</span> will handle the conversation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="toNumber">Destination number (E.164 format)</Label>
              <Input
                id="toNumber"
                placeholder="+1234567890"
                value={toNumber}
                onChange={e => setToNumber(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleMakeCall(); }}
              />
              <p className="text-xs text-muted-foreground">
                Include country code, e.g. <code className="font-mono bg-muted px-1 rounded">+14155552671</code>
              </p>
            </div>
            <div className="rounded-md bg-muted/50 border p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Before making a call, ensure:</p>
              <p>• Your <span className="font-medium capitalize">{agent.telephonyProvider}</span> provider key is configured on the <Link href="/providers" className="underline">Providers page</Link></p>
              {agent.telephonyProvider === "twilio" && <p>• Extra Config includes <code className="font-mono bg-muted px-1">accountSid</code> and <code className="font-mono bg-muted px-1">fromNumber</code></p>}
              {agent.telephonyProvider === "plivo"  && <p>• Extra Config includes <code className="font-mono bg-muted px-1">authId</code> and <code className="font-mono bg-muted px-1">fromNumber</code></p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCallDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => handleMakeCall()}
              disabled={!toNumber.trim() || outboundCall.isPending}
              className="gap-2"
            >
              {outboundCall.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneOutgoing className="h-4 w-4" />}
              {outboundCall.isPending ? "Dialing…" : "Call Now"}
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
          handleMakeCall(pendingCallNumber);
        }}
      />

      <div className="flex items-center gap-4">
        <Link href="/agents">
          <Button variant="outline" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-3 flex-1">
          <h2 className="text-3xl font-bold tracking-tight">{agent.name}</h2>
          {agent.status === "active"   && <Badge className="bg-zinc-500 hover:bg-zinc-600">Active</Badge>}
          {agent.status === "inactive" && <Badge variant="secondary">Inactive</Badge>}
          {agent.status === "draft"    && <Badge variant="outline" className="text-zinc-500 border-zinc-500">Draft</Badge>}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Link href={`/app/agents/${id}/edit`}>
            <Button variant="outline" className="gap-2">
              <Pencil className="h-4 w-4" />
              Edit Agent
            </Button>
          </Link>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setCallDialogOpen(true)}
          >
            <PhoneOutgoing className="h-4 w-4" />
            Make a Call
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0">
          <TabsTrigger value="overview"      className={tabClass}>Overview</TabsTrigger>
          <TabsTrigger value="test"          className={tabClass}>
            <Mic className="h-3.5 w-3.5 mr-1.5" />Test Call
          </TabsTrigger>
          <TabsTrigger value="configuration" className={tabClass}>Configuration</TabsTrigger>
          <TabsTrigger value="calls"         className={tabClass}>Call History</TabsTrigger>
        </TabsList>

        <div className="mt-6 flex-1 overflow-auto">
          {/* ── Overview ── */}
          <TabsContent value="overview" className="m-0 h-full">
            <div className="grid gap-4 md:grid-cols-3 mb-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Calls</CardTitle>
                  <Phone className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{agent.totalCalls || 0}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
                  <BarChart2 className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {agent.totalCalls ? Math.round(((agent.successfulCalls || 0) / agent.totalCalls) * 100) : 0}%
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatDuration(agent.avgDurationSeconds)}</div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Pipeline Map</CardTitle>
                <CardDescription>Current orchestration configuration for this agent</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col md:flex-row items-center justify-between gap-4 py-8">
                  {[
                    { label: "Telephony In", value: agent.telephonyProvider, sub: null, highlight: false },
                    { label: "ASR",          value: agent.asrProvider,       sub: agent.asrModel || "default", highlight: false },
                    { label: "LLM Core",     value: agent.llmProvider,       sub: agent.llmModel || "default", highlight: true  },
                    { label: "TTS",          value: agent.ttsProvider,       sub: agent.ttsVoice || "default", highlight: false },
                  ].map((stage, i) => (
                    <React.Fragment key={stage.label}>
                      <div className={`flex flex-col items-center gap-2 p-4 border rounded-lg w-full text-center ${
                        stage.highlight ? "bg-primary/10 border-primary/30" : "bg-card"
                      }`}>
                        <span className={`text-xs uppercase tracking-wider font-semibold ${stage.highlight ? "text-primary" : "text-muted-foreground"}`}>
                          {stage.label}
                        </span>
                        <span className="font-medium capitalize">{stage.value}</span>
                        {stage.sub && <span className="text-xs text-muted-foreground">{stage.sub}</span>}
                      </div>
                      {i < 3 && <ArrowLeft className="rotate-90 md:rotate-180 text-muted-foreground shrink-0" />}
                    </React.Fragment>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Test Call ── */}
          <TabsContent value="test" className="m-0">
            <WebCallPanel agentId={agent.id} agentName={agent.name} autostart={isAutostart} callbackId={urlCallbackId} />
          </TabsContent>

          {/* ── Configuration ── */}
          <TabsContent value="configuration" className="m-0">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings2 className="h-5 w-5 text-primary" />
                  System Prompt
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-muted/50 p-4 rounded-md border border-border/50 font-mono text-sm whitespace-pre-wrap">
                  {agent.systemPrompt}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Call History ── */}
          <TabsContent value="calls" className="m-0 h-full flex flex-col">
            <Card className="flex-1 flex flex-col overflow-hidden">
              <CardContent className="p-0 flex-1 overflow-auto">
                <Table>
                  <TableHeader className="bg-muted/50 sticky top-0 z-10">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>To / From</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {callsLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 5 }).map((_, j) => (
                            <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : calls && calls.length > 0 ? (
                      calls.map((call) => (
                        <TableRow key={call.id} className="hover:bg-muted/50 transition-colors">
                          <TableCell className="whitespace-nowrap">
                            {format(parseISO(call.createdAt), "MMM d, HH:mm")}
                          </TableCell>
                          <TableCell>{getStatusBadge(call.status)}</TableCell>
                          <TableCell>
                            <div className="text-sm font-medium">{call.toNumber}</div>
                            <div className="text-xs text-muted-foreground">{call.fromNumber}</div>
                          </TableCell>
                          <TableCell className="font-mono text-sm">{formatDuration(call.durationSeconds)}</TableCell>
                          <TableCell className="text-right">
                            <Link href={`/app/calls/${call.id}`}>
                              <Button variant="ghost" size="sm" className="h-8 text-xs">Details</Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="h-48 text-center text-muted-foreground">
                          No calls found for this agent.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
