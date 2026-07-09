import React, { useState } from "react";
import { Link } from "wouter";
import {
  Phone, Copy, Check, ExternalLink, Zap, Key,
  ChevronDown, ChevronRight, AlertTriangle, CheckCircle2,
  RefreshCw, Plus, Eye, EyeOff, Users, Settings2, Timer,
  Sun, Moon, Monitor, Palette, Lock,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useListAgents, useListProviders, useGetAccount, useRegenerateApiKey, useAddConcurrentSlot, useChangePassword, getListAgentsQueryKey, getListProvidersQueryKey, getGetAccountQueryKey, setDefaultTimeoutMs } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/theme-provider";
import { formatApiError } from "@/lib/format-api-error";
import { useAuth } from "@/lib/auth";
import type { ProviderConfigProviderType } from "@workspace/api-client-react";

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

type ThemeOption = { label: string; value: "light" | "dark" | "system"; icon: React.ReactNode; description: string };
const THEME_OPTIONS: ThemeOption[] = [
  { label: "Light",  value: "light",  icon: <Sun className="h-5 w-5" />,     description: "Always use light mode" },
  { label: "Dark",   value: "dark",   icon: <Moon className="h-5 w-5" />,    description: "Always use dark mode" },
  { label: "System", value: "system", icon: <Monitor className="h-5 w-5" />, description: "Follow your OS setting" },
];

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();

  function handleSelect(opt: ThemeOption) {
    setTheme(opt.value);
    toast({ title: "Theme updated", description: `Appearance set to ${opt.label}.` });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="h-5 w-5 text-primary" />
          Appearance
        </CardTitle>
        <CardDescription>
          Choose how the dashboard looks. Your preference is synced to your account across devices.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3">
          {THEME_OPTIONS.map((opt) => {
            const isActive = theme === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => handleSelect(opt)}
                className={`flex flex-col items-center gap-2 rounded-lg border px-4 py-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                }`}
              >
                <span className={isActive ? "text-primary" : "text-muted-foreground"}>{opt.icon}</span>
                <span className="font-semibold">{opt.label}</span>
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
      {copied ? <Check className="h-3.5 w-3.5 text-foreground" /> : <Copy className="h-3.5 w-3.5" />}
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
  if (!value) return <span className="text-muted-foreground text-xs italic">Not generated yet</span>;
  const masked = value.slice(0, 8) + "•".repeat(20) + value.slice(-4);
  return (
    <div className="flex items-center gap-2 bg-muted/60 border border-border/60 rounded-md px-3 py-2 font-mono text-xs text-foreground/90 overflow-x-auto flex-1">
      <span className="flex-1 whitespace-nowrap">{show ? value : masked}</span>
      <button onClick={() => setShow(s => !s)} className="text-muted-foreground hover:text-foreground transition-colors">
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
      <CopyButton text={value} />
    </div>
  );
}

function ChangePasswordCard() {
  const { userId } = useAuth();
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const changePassword = useChangePassword();

  const isEmailUser = typeof userId === "string" && userId.startsWith("email:");

  if (!isEmailUser) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-5 w-5 text-primary" />
            Password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Your account uses Google sign-in. Password changes are managed through your Google account.
          </p>
        </CardContent>
      </Card>
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      toast({ title: "Passwords don't match", description: "New password and confirmation must match.", variant: "destructive" });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: "Password too short", description: "New password must be at least 8 characters.", variant: "destructive" });
      return;
    }
    changePassword.mutate(
      { data: { currentPassword, newPassword } },
      {
        onSuccess: () => {
          toast({ title: "Password updated", description: "Your password has been changed successfully." });
          setCurrentPassword("");
          setNewPassword("");
          setConfirm("");
        },
        onError: (err: unknown) => {
          toast({ title: "Error", variant: "destructive", description: formatApiError(err) });
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="h-5 w-5 text-primary" />
          Change Password
        </CardTitle>
        <CardDescription>Update your account password. You'll need your current password to confirm.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <div className="relative">
              <Input
                id="current-password"
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(s => !s)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <div className="relative">
              <Input
                id="new-password"
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowNew(s => !s)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">At least 8 characters.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          <Button type="submit" disabled={changePassword.isPending} className="w-full sm:w-auto">
            {changePassword.isPending ? "Updating…" : "Update password"}
          </Button>
        </form>
      </CardContent>
    </Card>
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
              action: { label: "Create agent", href: "/app/agents" },
            },
          ].map((item, i) => (
            <div key={i} className="flex items-center justify-between gap-3 py-2 border-b border-border/40 last:border-0">
              <div className="flex items-center gap-2.5">
                {item.done ? (
                  <CheckCircle2 className="h-4 w-4 text-foreground shrink-0" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-foreground shrink-0" />
                )}
                <span className={`text-sm ${item.done ? "text-foreground" : "text-muted-foreground"}`}>{item.label}</span>
              </div>
              {!item.done && (
                <Link href={item.action.href}>
                  <Button variant="outline" size="sm" className="text-xs h-7">{item.action.label}</Button>
                </Link>
              )}
              {item.done && <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground border-border">Done</Badge>}
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
                  <p className="text-sm font-medium">Secret API Key <span className="text-[10px] text-muted-foreground font-mono ml-1">vok_…</span></p>
                  <Button
                    variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
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
                <p className="text-[11px] text-muted-foreground">Include as <code className="bg-muted px-1 rounded text-muted-foreground">Authorization: Bearer &lt;key&gt;</code> header.</p>
              </div>

              <div className="space-y-1.5">
                <p className="text-sm font-medium">Organisation Key <span className="text-[10px] text-muted-foreground font-mono ml-1">voo_…</span></p>
                <MaskedKey value={account?.orgKey} />
                <p className="text-[11px] text-muted-foreground">Use to verify webhook signatures sent from SnapServe to your server.</p>
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
                    size="sm" className="h-8 text-xs gap-1.5 bg-black/85 hover:bg-black/90 text-foreground"
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

      <ChangePasswordCard />
      <RequestTimeoutCard />
      <AppearanceCard />
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-6 p-6 md:p-8 pt-6 max-w-5xl mx-auto">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
          <p className="text-muted-foreground">Configure your SnapServe integration and go live.</p>
        </div>
        <GeneralTab />
      </div>
    </div>
  );
}
