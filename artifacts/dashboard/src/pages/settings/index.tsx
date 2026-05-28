import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Phone, Copy, Check, ExternalLink, Zap, Key, BookOpen,
  ChevronDown, ChevronRight, AlertTriangle, CheckCircle2,
  RefreshCw, Plus, Eye, EyeOff, Users, Settings2, Calendar, Video, Timer
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useListAgents, useListProviders, useGetAccount, useRegenerateApiKey, useAddConcurrentSlot, getListAgentsQueryKey, getListProvidersQueryKey, getGetAccountQueryKey, setDefaultTimeoutMs } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import type { ProviderConfigProviderType } from "@workspace/api-client-react";
import CalendarsPage from "@/pages/scheduling/Calendars";
import ConferencingPage from "@/pages/settings/Conferencing";

const BASE_DOMAIN = window.location.hostname;
const BASE_URL = `https://${BASE_DOMAIN}`;
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const TIMEOUT_STORAGE_KEY = "voiceorch:requestTimeoutMs";

type TimeoutOption = { label: string; value: number | null; description: string };
const TIMEOUT_OPTIONS: TimeoutOption[] = [
  { label: "10 s", value: 10_000, description: "Fast — best on reliable connections" },
  { label: "30 s", value: 30_000, description: "Default — recommended for most users" },
  { label: "60 s", value: 60_000, description: "Slow — helpful for long-running queries" },
  { label: "None", value: null, description: "No limit — wait as long as needed" },
];

function getStoredTimeoutMs(): number | null {
  const raw = localStorage.getItem(TIMEOUT_STORAGE_KEY);
  if (raw === null) return 30_000;
  const parsed = Number(raw);
  return parsed === 0 ? null : parsed;
}

function RequestTimeoutCard() {
  const [selected, setSelected] = useState<number | null>(getStoredTimeoutMs);
  const { toast } = useToast();

  function handleSelect(opt: TimeoutOption) {
    const ms = opt.value;
    setSelected(ms);
    if (ms === null) {
      localStorage.setItem(TIMEOUT_STORAGE_KEY, "0");
      setDefaultTimeoutMs(0);
    } else {
      localStorage.setItem(TIMEOUT_STORAGE_KEY, String(ms));
      setDefaultTimeoutMs(ms);
    }
    toast({ title: "Timeout updated", description: `Request timeout set to ${opt.label}.` });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Timer className="h-5 w-5 text-primary" />
          Request Timeout
        </CardTitle>
        <CardDescription>
          How long the app waits for a slow server response before giving up. The default is 30 s.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {TIMEOUT_OPTIONS.map((opt) => {
            const isActive = selected === opt.value;
            return (
              <button
                key={opt.label}
                onClick={() => handleSelect(opt)}
                className={`flex flex-col items-center gap-1.5 rounded-lg border px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                }`}
              >
                <span className="text-base font-semibold">{opt.label}</span>
                <span className="text-[11px] font-normal text-center leading-tight opacity-75">{opt.description}</span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

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
      {copied ? <Check className="h-3.5 w-3.5 text-gray-700" /> : <Copy className="h-3.5 w-3.5" />}
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

function MaskedKey({ value }: { value: string | null | undefined }) {
  const [show, setShow] = useState(false);
  if (!value) return <span className="text-gray-400 text-xs italic">Not generated yet</span>;
  const masked = value.slice(0, 8) + "•".repeat(20) + value.slice(-4);
  return (
    <div className="flex items-center gap-2 bg-muted/60 border border-border/60 rounded-md px-3 py-2 font-mono text-xs text-foreground/90 overflow-x-auto flex-1">
      <span className="flex-1 whitespace-nowrap">{show ? value : masked}</span>
      <button onClick={() => setShow(s => !s)} className="text-gray-400 hover:text-gray-700 transition-colors">
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
      <CopyButton text={value} />
    </div>
  );
}

function GeneralTab() {
  const [expandedProvider, setExpandedProvider] = useState<string | null>("twilio");
  const [selectedAgentId, setSelectedAgentId] = useState<number>(1);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: agents } = useListAgents({ query: { queryKey: getListAgentsQueryKey() } });
  const { data: providers } = useListProviders({ query: { queryKey: getListProvidersQueryKey() } });
  const { data: account, isLoading: accountLoading } = useGetAccount({ query: { queryKey: getGetAccountQueryKey() } });
  const regenerate = useRegenerateApiKey();
  const addSlot = useAddConcurrentSlot();

  const providerTypes: ProviderConfigProviderType[] = ["asr", "llm", "tts", "telephony"];
  const configuredTypes = new Set(providers?.map(p => p.providerType) ?? []);

  return (
    <div className="space-y-6">
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
                  <CheckCircle2 className="h-4 w-4 text-gray-700 shrink-0" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                )}
                <span className={`text-sm ${item.done ? "text-foreground" : "text-muted-foreground"}`}>{item.label}</span>
              </div>
              {!item.done && (
                <Link href={item.action.href}>
                  <Button variant="outline" size="sm" className="text-xs h-7">{item.action.label}</Button>
                </Link>
              )}
              {item.done && <Badge variant="outline" className="text-[10px] bg-gray-50 text-gray-700 border-gray-200">Done</Badge>}
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
            Point your telephony number to these webhook URLs and SnapServe will handle the rest — STT → LLM → TTS in real time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
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

      {/* API Keys & Account */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Key className="h-5 w-5 text-primary" />
            API Keys & Account
          </CardTitle>
          <CardDescription>
            Use these keys to call the SnapServe REST API from your own applications.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {accountLoading ? (
            <div className="h-24 bg-muted/30 rounded-lg animate-pulse" />
          ) : (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Secret API Key <span className="text-[10px] text-gray-400 font-mono ml-1">vok_…</span></p>
                  <Button
                    variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-gray-500 hover:text-gray-800"
                    disabled={regenerate.isPending}
                    onClick={() => regenerate.mutate(undefined, {
                      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetAccountQueryKey() }); toast({ title: "API key regenerated" }); },
                      onError: (err: unknown) => toast({ title: "Error", variant: "destructive", description: formatApiError(err) }),
                    })}
                  >
                    <RefreshCw className={`h-3 w-3 ${regenerate.isPending ? "animate-spin" : ""}`} /> Regenerate
                  </Button>
                </div>
                <MaskedKey value={account?.apiKey} />
                <p className="text-[11px] text-gray-400">Include as <code className="bg-gray-100 px-1 rounded text-gray-500">Authorization: Bearer &lt;key&gt;</code> header.</p>
              </div>

              <div className="space-y-1.5">
                <p className="text-sm font-medium">Organisation Key <span className="text-[10px] text-gray-400 font-mono ml-1">voo_…</span></p>
                <MaskedKey value={account?.orgKey} />
                <p className="text-[11px] text-gray-400">Use to verify webhook signatures sent from SnapServe to your server.</p>
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg border border-border/60 bg-muted/20">
                <div className="flex items-start gap-3">
                  <Users className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Concurrent Call Slots</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Max simultaneous active calls. Add more at $5.00 / slot (deducted from wallet).</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-2xl font-bold tabular-nums">{account?.concurrentLimit ?? "—"}</span>
                  <Button
                    size="sm" className="h-8 text-xs gap-1.5 bg-black/85 hover:bg-black/90 text-gray-900"
                    disabled={addSlot.isPending}
                    onClick={() => addSlot.mutate(undefined, {
                      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetAccountQueryKey() }); toast({ title: "Concurrent slot added", description: "Your limit has been increased by 1." }); },
                      onError: (err: unknown) => toast({ title: "Error", variant: "destructive", description: formatApiError(err) }),
                    })}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Slot ($5)
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-2 p-3 rounded-md border border-border/40 bg-muted/10">
                <p className="text-xs text-muted-foreground flex-1">Wallet ID (internal)</p>
                <code className="font-mono text-xs text-foreground/70">#{account?.walletId ?? "—"}</code>
                {account?.walletId && <CopyButton text={String(account.walletId)} />}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <RequestTimeoutCard />

      {/* API reference quick links */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-5 w-5 text-primary" />
            API Endpoints
          </CardTitle>
          <CardDescription>Key REST and WebSocket endpoints exposed by SnapServe.</CardDescription>
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
                    ? "bg-violet-50 text-violet-600 border-violet-500/20"
                    : ep.method === "GET"
                    ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                    : "bg-amber-500/10 text-amber-600 border-amber-500/20"
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

type SettingsTab = "general" | "calendar" | "conferencing";

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: "general",       label: "General",       icon: <Settings2 className="h-4 w-4" /> },
  { id: "calendar",      label: "Calendar",      icon: <Calendar  className="h-4 w-4" /> },
  { id: "conferencing",  label: "Conferencing",  icon: <Video     className="h-4 w-4" /> },
];

export default function SettingsPage() {
  const [location, navigate] = useLocation();

  const activeTab: SettingsTab =
    location.includes("/settings/calendar")     ? "calendar"
    : location.includes("/settings/conferencing") ? "conferencing"
    : "general";

  function goTab(tab: SettingsTab) {
    if (tab === "general")      navigate(`${BASE}/app/settings`);
    else if (tab === "calendar") navigate(`${BASE}/app/settings/calendar`);
    else                         navigate(`${BASE}/app/settings/conferencing`);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-6 p-6 md:p-8 pt-6 max-w-5xl mx-auto">
        {/* Page header */}
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
          <p className="text-muted-foreground">Configure your VoiceOrch integration and go live.</p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-border/60">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => goTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "general"      && <GeneralTab />}
        {activeTab === "calendar"     && <CalendarsPage embedded />}
        {activeTab === "conferencing" && <ConferencingPage embedded />}
      </div>
    </div>
  );
}
