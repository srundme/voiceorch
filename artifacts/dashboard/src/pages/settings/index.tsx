import React, { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Copy, Check, Key, ChevronRight, ChevronLeft,
  Plus, Eye, EyeOff, Users, Timer,
  Sun, Moon, Monitor, Palette, Lock,
  User, KeyRound,
  Terminal, Webhook, Phone, Sparkles, Mic2,
  Wallet, BarChart3, Layers, CreditCard,
  Shield, ScrollText,
  Trash2, HelpCircle, BookOpen, LifeBuoy,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useGetAccount, useAddConcurrentSlot, useChangePassword, getGetAccountQueryKey, setDefaultTimeoutMs,
  useListPhoneNumbers, useListWebhookEndpoints, useGetWallet, customFetch,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/theme-provider";
import { formatApiError } from "@/lib/format-api-error";
import { useAuth } from "@/lib/auth";
import { usePartnerManagedWorkspace } from "@/hooks/use-partner";

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

function AccountBillingCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { isManagedWorkspace, partnerName } = usePartnerManagedWorkspace();
  const { data: account, isLoading: accountLoading } = useGetAccount({ query: { queryKey: getGetAccountQueryKey() } });
  const addSlot = useAddConcurrentSlot();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-5 w-5 text-primary" />
          Account & Billing
        </CardTitle>
        <CardDescription>
          Manage your concurrent call capacity and account identifiers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {accountLoading ? (
          <div className="h-24 bg-muted/30 rounded-lg animate-pulse" />
        ) : (
          <>
            <div className="flex items-center gap-2.5 p-3.5 rounded-lg border border-border/60 bg-muted/10">
              <Key className="h-4 w-4 text-muted-foreground shrink-0" />
              <p className="text-xs text-muted-foreground flex-1">
                Looking to call the REST API? Manage your API keys on the dedicated{" "}
                <Link href="/app/api-keys" className="text-primary hover:underline font-medium">API Keys page</Link>.
              </p>
              <Link href="/app/api-keys">
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 shrink-0">
                  <Key className="h-3 w-3" /> API Keys
                </Button>
              </Link>
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg border border-border/60 bg-muted/20">
              <div className="flex items-start gap-3">
                <Users className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Concurrent Call Slots</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {isManagedWorkspace
                      ? `Max simultaneous active calls. Ask ${partnerName} to increase capacity.`
                      : "Max simultaneous active calls. Add more at ₹1,000 / slot (deducted from wallet)."}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-2xl font-bold tabular-nums">{account?.concurrentLimit ?? "—"}</span>
                {!isManagedWorkspace && (
                  <Button
                    size="sm" className="h-8 text-xs gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
                    disabled={addSlot.isPending}
                    onClick={() => addSlot.mutate(undefined, {
                      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetAccountQueryKey() }); toast({ title: "Concurrent slot added", description: "Your limit has been increased by 1." }); },
                      onError: (err: unknown) => toast({ title: "Error", variant: "destructive", description: formatApiError(err) }),
                    })}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Slot (₹1,000)
                  </Button>
                )}
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
  );
}

function GeneralSettingsView({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-6">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-4 w-4" /> Back to Settings
      </button>
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Account Settings</h2>
        <p className="text-muted-foreground text-sm">Manage your account, appearance, and preferences.</p>
      </div>
      <AccountBillingCard />
      <ChangePasswordCard />
      <RequestTimeoutCard />
      <AppearanceCard />
    </div>
  );
}

/* ── Quick Overview stat strip ───────────────────────────────────────────── */

function StatCard({
  icon: Icon, label, value, valueClassName, href, iconClassName,
}: {
  icon: React.ElementType; label: string; value: React.ReactNode;
  valueClassName?: string; href: string; iconClassName?: string;
}) {
  return (
    <Link href={href}>
      <a className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 hover:border-primary/30 hover:bg-accent/40 transition-colors group">
        <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${iconClassName ?? "bg-muted text-muted-foreground"}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-muted-foreground">{label}</p>
          <p className={`text-sm font-semibold truncate ${valueClassName ?? "text-foreground"}`}>{value}</p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0" />
      </a>
    </Link>
  );
}

function useApiKeysOverview() {
  return useQuery<{ keys: { revokedAt: string | null }[] }>({
    queryKey: ["user-api-keys"],
    queryFn: () => customFetch<{ keys: { revokedAt: string | null }[] }>("/api/user-api-keys"),
  });
}

function QuickOverview() {
  const { data: phoneNumbers } = useListPhoneNumbers();
  const { data: webhooks } = useListWebhookEndpoints();
  const { data: wallet } = useGetWallet();
  const { data: apiKeysData } = useApiKeysOverview();

  const activePhoneNumbers = phoneNumbers?.filter(n => !!n.agentId).length ?? 0;
  const activeApiKeys = apiKeysData?.keys.filter(k => !k.revokedAt).length ?? 0;
  const configuredWebhooks = webhooks?.filter(w => w.enabled).length ?? 0;
  const balance = wallet ? `₹${(wallet.balanceCents / 100).toFixed(2)}` : "—";

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 mb-3">Quick Overview</h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={Phone}
          label="Phone Numbers"
          value={`${activePhoneNumbers} Active`}
          href="/app/phone-numbers"
          iconClassName="bg-muted text-muted-foreground"
        />
        <StatCard
          icon={KeyRound}
          label="API Keys"
          value={`${activeApiKeys} Active`}
          href="/app/api-keys"
          iconClassName="bg-muted text-muted-foreground"
        />
        <StatCard
          icon={Webhook}
          label="Event subscriptions"
          value={`${configuredWebhooks} Configured`}
          href="/app/webhooks"
          iconClassName="bg-muted text-muted-foreground"
        />
        <StatCard
          icon={Wallet}
          label="Wallet Balance"
          value={balance}
          href="/app/wallet"
          iconClassName="bg-muted text-muted-foreground"
        />
      </div>
    </div>
  );
}

/* ── Category card grid ──────────────────────────────────────────────────── */

type SubLink = {
  icon: React.ElementType;
  label: string;
  href?: string;
  onClick?: () => void;
  badge?: string;
  disabled?: boolean;
};

function CategoryCard({
  icon: Icon, title, description, links, iconClassName,
}: {
  icon: React.ElementType; title: string; description: string;
  links: SubLink[]; iconClassName: string;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center mb-2 ${iconClassName}`}>
          <Icon className="h-5 w-5" />
        </div>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 flex-1">
        <div className="flex flex-col divide-y divide-border/50 border-t border-border/50">
          {links.map((link) => {
            const content = (
              <div className={`flex items-center gap-2.5 py-2.5 text-sm ${link.disabled ? "text-muted-foreground/40 cursor-not-allowed" : "text-foreground/80 hover:text-foreground"} transition-colors`}>
                <link.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                <span className="flex-1">{link.label}</span>
                {link.badge && (
                  <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border border-border text-muted-foreground/60">
                    {link.badge}
                  </span>
                )}
                {!link.disabled && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />}
              </div>
            );
            if (link.disabled || (!link.href && !link.onClick)) {
              return <div key={link.label}>{content}</div>;
            }
            if (link.onClick) {
              return (
                <button key={link.label} onClick={link.onClick} className="text-left w-full">
                  {content}
                </button>
              );
            }
            return (
              <Link key={link.label} href={link.href!}>
                <a className="block">{content}</a>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function CategoryGrid({ onOpenGeneral }: { onOpenGeneral: () => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <CategoryCard
        icon={User}
        title="Account"
        description="Manage your profile and password."
        iconClassName="bg-muted text-muted-foreground"
        links={[
          { icon: User, label: "Profile", href: "/app/settings/profile" },
          { icon: Lock, label: "Change Password", onClick: onOpenGeneral },
        ]}
      />
      <CategoryCard
        icon={Terminal}
        title="API & Developers"
        description="Manage API keys and developer integrations."
        iconClassName="bg-muted text-muted-foreground"
        links={[
          { icon: KeyRound, label: "API Keys", href: "/app/api-keys" },
          { icon: Webhook, label: "Event subscriptions", href: "/app/webhooks" },
        ]}
      />
      <CategoryCard
        icon={Phone}
        title="Telephony"
        description="Configure providers and manage phone numbers."
        iconClassName="bg-muted text-muted-foreground"
        links={[
          { icon: Layers, label: "Providers", href: "/app/providers" },
          { icon: Phone, label: "Phone Numbers", href: "/app/phone-numbers" },
        ]}
      />
      <CategoryCard
        icon={Sparkles}
        title="AI Configuration"
        description="Configure AI providers and voices for your agents."
        iconClassName="bg-muted text-muted-foreground"
        links={[
          { icon: Mic2, label: "Voices", href: "/app/voices" },
          { icon: Layers, label: "AI Providers (BYOP)", href: "/app/providers" },
        ]}
      />
      <CategoryCard
        icon={CreditCard}
        title="Billing & Usage"
        description="Manage wallet, usage and your subscription."
        iconClassName="bg-muted text-muted-foreground"
        links={[
          { icon: Wallet, label: "Wallet", href: "/app/wallet" },
          { icon: BarChart3, label: "Usage", href: "/app/usage" },
          { icon: Users, label: "Concurrent Call Slots", onClick: onOpenGeneral },
        ]}
      />
      <CategoryCard
        icon={Shield}
        title="Security"
        description="Secure your account and manage sessions."
        iconClassName="bg-muted text-muted-foreground"
        links={[
          { icon: ScrollText, label: "Audit Logs", href: "/app/activity" },
        ]}
      />
    </div>
  );
}

function DangerZoneCard() {
  return (
    <Card className="border-destructive/20">
      <CardContent className="p-5 flex items-start gap-4">
        <div className="h-10 w-10 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
          <Trash2 className="h-5 w-5 text-destructive" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">Danger Zone</p>
          <p className="text-xs text-muted-foreground mt-0.5 mb-3">Irreversible and destructive actions.</p>
          <div className="flex flex-col divide-y divide-border/50 border-t border-border/50">
            <div className="flex items-center justify-between py-2.5">
              <span className="text-sm text-destructive/70">Delete Workspace</span>
              <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border border-border text-muted-foreground/60">Coming soon</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function NeedHelpCard() {
  const { partnerCtx, isManagedWorkspace, partnerName } = usePartnerManagedWorkspace();
  const docsHref = isManagedWorkspace
    ? (partnerCtx?.branding?.docsUrl ?? null)
    : "/docs";
  const docsExternal = isManagedWorkspace && !!partnerCtx?.branding?.docsUrl;
  const supportHref = isManagedWorkspace
    ? (partnerCtx?.branding?.supportUrl
      || (partnerCtx?.branding?.supportEmail ? `mailto:${partnerCtx.branding.supportEmail}` : null))
    : "mailto:support@snapserve.ai";

  if (isManagedWorkspace && !docsHref && !supportHref) return null;

  return (
    <Card>
      <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <HelpCircle className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">Need help?</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isManagedWorkspace
              ? `Reach out to ${partnerName} if you need a hand.`
              : "Check our documentation or contact support."}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {docsHref && (
            <a href={docsHref} target={docsExternal ? "_blank" : undefined} rel={docsExternal ? "noopener noreferrer" : undefined}>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                <BookOpen className="h-3.5 w-3.5" /> View Documentation
              </Button>
            </a>
          )}
          {supportHref && (
            <a href={supportHref} target={supportHref.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">
              <Button size="sm" className="h-8 text-xs gap-1.5">
                <LifeBuoy className="h-3.5 w-3.5" /> Contact Support
              </Button>
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const [view, setView] = useState<"overview" | "general">("overview");

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-6 p-4 sm:p-6 md:p-8 pt-6 max-w-6xl mx-auto">
        {view === "general" ? (
          <GeneralSettingsView onBack={() => setView("overview")} />
        ) : (
          <>
            {/* Parent StripeTabPage owns the Workspace title */}
            <QuickOverview />
            <CategoryGrid onOpenGeneral={() => setView("general")} />
            <DangerZoneCard />
            <NeedHelpCard />
          </>
        )}
      </div>
    </div>
  );
}
