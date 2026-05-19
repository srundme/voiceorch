import React, { useState } from "react";
import { Link } from "wouter";
import {
  Phone, Copy, Check, ExternalLink, Zap, Key, BookOpen,
  ChevronDown, ChevronRight, AlertTriangle, CheckCircle2
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useListAgents, useListProviders, getListAgentsQueryKey, getListProvidersQueryKey } from "@workspace/api-client-react";
import type { ProviderConfigProviderType } from "@workspace/api-client-react";

const BASE_DOMAIN = window.location.hostname;
const BASE_URL = `https://${BASE_DOMAIN}`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="flex items-center gap-2 bg-muted/60 border border-border/60 rounded-md px-3 py-2 font-mono text-xs text-foreground/90 overflow-x-auto">
      <span className="flex-1 whitespace-nowrap">{code}</span>
      <CopyButton text={code} />
    </div>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <div className="shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">
      {n}
    </div>
  );
}

interface TelephonyGuideProps {
  provider: "twilio" | "plivo" | "vobiz";
  agentId: number;
}

function TelephonyGuide({ provider, agentId }: TelephonyGuideProps) {
  const webhookUrl = `${BASE_URL}/api/webhooks/${provider}/voice?agentId=${agentId}`;
  const wsUrl = `wss://${BASE_DOMAIN}/api/ws/${provider}/${agentId}`;

  const guides: Record<string, { steps: { text: string; code?: string }[]; docsUrl: string; consoleName: string }> = {
    twilio: {
      consoleName: "Twilio Console",
      docsUrl: "https://console.twilio.com",
      steps: [
        { text: 'Go to Twilio Console → Phone Numbers → Manage → Active Numbers' },
        { text: 'Select your number, find "Voice & Fax" → "A Call Comes In"' },
        { text: 'Set to Webhook, HTTP POST, and paste this URL:', code: webhookUrl },
        { text: 'Twilio will open a Media Stream WebSocket to:', code: wsUrl },
        { text: 'Save the number. Call it to test your agent.' },
      ],
    },
    plivo: {
      consoleName: "Plivo Console",
      docsUrl: "https://console.plivo.com",
      steps: [
        { text: 'Go to Plivo Console → Phone Numbers → Your Numbers' },
        { text: 'Edit your number → set "Answer URL" to HTTP POST:', code: webhookUrl },
        { text: 'Plivo will open an AudioSocket WebSocket to:', code: wsUrl },
        { text: 'Save. Call the number to test your agent.' },
      ],
    },
    vobiz: {
      consoleName: "Vobiz Dashboard",
      docsUrl: "https://vobiz.in",
      steps: [
        { text: 'Go to Vobiz Dashboard → DID Numbers → Configure' },
        { text: 'Set the webhook/callback URL to:', code: webhookUrl },
        { text: 'Vobiz will open a WebSocket to:', code: wsUrl },
        { text: 'Save and place a test call.' },
      ],
    },
  };

  const guide = guides[provider]!;

  return (
    <div className="space-y-3">
      {guide.steps.map((step, i) => (
        <div key={i} className="flex gap-3 items-start">
          <StepNumber n={i + 1} />
          <div className="flex-1 space-y-1.5 pt-0.5">
            <p className="text-sm text-muted-foreground">{step.text}</p>
            {step.code && <CodeBlock code={step.code} />}
          </div>
        </div>
      ))}
      <a
        href={guide.docsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
      >
        Open {guide.consoleName} <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

export default function SettingsPage() {
  const [expandedProvider, setExpandedProvider] = useState<string | null>("twilio");
  const [selectedAgentId, setSelectedAgentId] = useState<number>(1);

  const { data: agents } = useListAgents({ query: { queryKey: getListAgentsQueryKey() } });
  const { data: providers } = useListProviders({ query: { queryKey: getListProvidersQueryKey() } });

  const providerTypes: ProviderConfigProviderType[] = ["asr", "llm", "tts", "telephony"];
  const configuredTypes = new Set(providers?.map(p => p.providerType) ?? []);
  const allConfigured = providerTypes.every(t => configuredTypes.has(t));

  return (
    <div className="flex-1 space-y-6 p-6 md:p-8 pt-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">Configure your VoiceOrch integration and go live.</p>
      </div>

      {/* Readiness checklist */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            Go-Live Checklist
          </CardTitle>
          <CardDescription>Complete these steps before taking real calls.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            {
              done: configuredTypes.has("asr"),
              label: "Speech-to-Text (ASR) key configured",
              action: { label: "Add ASR key", href: "/providers" },
            },
            {
              done: configuredTypes.has("llm"),
              label: "Language Model (LLM) key configured",
              action: { label: "Add LLM key", href: "/providers" },
            },
            {
              done: configuredTypes.has("tts"),
              label: "Text-to-Speech (TTS) key configured",
              action: { label: "Add TTS key", href: "/providers" },
            },
            {
              done: configuredTypes.has("telephony"),
              label: "Telephony provider key configured",
              action: { label: "Add telephony key", href: "/providers" },
            },
            {
              done: (agents?.length ?? 0) > 0,
              label: "At least one agent created",
              action: { label: "Create agent", href: "/agents/new" },
            },
          ].map((item, i) => (
            <div key={i} className="flex items-center justify-between gap-3 py-2 border-b border-border/40 last:border-0">
              <div className="flex items-center gap-2.5">
                {item.done ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                )}
                <span className={`text-sm ${item.done ? "text-foreground" : "text-muted-foreground"}`}>{item.label}</span>
              </div>
              {!item.done && (
                <Link href={item.action.href}>
                  <Button variant="outline" size="sm" className="text-xs h-7">{item.action.label}</Button>
                </Link>
              )}
              {item.done && <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Done</Badge>}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Webhook integration guide */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-5 w-5 text-primary" />
            Telephony Integration
          </CardTitle>
          <CardDescription>
            Point your telephony number to these webhook URLs and VoiceOrch will handle the rest — STT → LLM → TTS in real time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Agent selector */}
          <div className="flex items-center gap-3 p-3 rounded-md bg-muted/40 border border-border/50">
            <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm text-muted-foreground shrink-0">Generate URLs for agent:</span>
            <select
              className="flex-1 bg-transparent text-sm font-medium text-foreground outline-none cursor-pointer"
              value={selectedAgentId}
              onChange={e => setSelectedAgentId(Number(e.target.value))}
            >
              {agents?.map(a => (
                <option key={a.id} value={a.id}>{a.name} (ID: {a.id})</option>
              )) ?? <option value={1}>Agent #1</option>}
            </select>
          </div>

          {/* Provider guides */}
          {(["twilio", "plivo", "vobiz"] as const).map(provider => (
            <div key={provider} className="border border-border/60 rounded-lg overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-4 py-3 bg-muted/20 hover:bg-muted/40 transition-colors"
                onClick={() => setExpandedProvider(expandedProvider === provider ? null : provider)}
              >
                <div className="flex items-center gap-2.5">
                  <span className="font-medium text-sm capitalize">{provider}</span>
                  {provider === "twilio" && <Badge variant="outline" className="text-[10px]">Most common</Badge>}
                </div>
                {expandedProvider === provider
                  ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                }
              </button>
              {expandedProvider === provider && (
                <div className="px-4 py-4 border-t border-border/40">
                  <TelephonyGuide provider={provider} agentId={selectedAgentId} />
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* API reference quick links */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-5 w-5 text-primary" />
            API Endpoints
          </CardTitle>
          <CardDescription>Key REST and WebSocket endpoints exposed by VoiceOrch.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { method: "POST", path: "/api/webhooks/twilio/voice?agentId=1", desc: "Twilio inbound call webhook (returns TwiML)" },
            { method: "POST", path: "/api/webhooks/plivo/voice?agentId=1", desc: "Plivo inbound call webhook (returns XML)" },
            { method: "POST", path: "/api/webhooks/vobiz/voice?agentId=1", desc: "Vobiz inbound call webhook (returns JSON)" },
            { method: "WS", path: "/api/ws/twilio/:agentId", desc: "Twilio Media Streams WebSocket" },
            { method: "WS", path: "/api/ws/plivo/:agentId", desc: "Plivo AudioSocket WebSocket" },
            { method: "WS", path: "/api/ws/vobiz/:agentId", desc: "Vobiz WebSocket" },
            { method: "GET", path: "/api/agents", desc: "List all agents" },
            { method: "GET", path: "/api/calls", desc: "Call history with filters" },
            { method: "GET", path: "/api/analytics/dashboard", desc: "Dashboard overview stats" },
          ].map((ep, i) => (
            <div key={i} className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
              <Badge
                variant="outline"
                className={`text-[10px] font-mono shrink-0 w-12 justify-center ${
                  ep.method === "WS"
                    ? "bg-violet-500/10 text-violet-400 border-violet-500/20"
                    : ep.method === "GET"
                    ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                    : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                }`}
              >
                {ep.method}
              </Badge>
              <code className="text-xs font-mono text-foreground/80 flex-1">{ep.path}</code>
              <span className="text-xs text-muted-foreground hidden md:block">{ep.desc}</span>
              <CopyButton text={`${BASE_URL}${ep.path}`} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
