import React, { useState } from "react";
import { Link } from "wouter";
import {
  Copy, Check, Key,
  Plus, Eye, EyeOff, Users, Timer,
  Sun, Moon, Monitor, Palette, Lock,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useGetAccount, useAddConcurrentSlot, useChangePassword, getGetAccountQueryKey, setDefaultTimeoutMs } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/theme-provider";
import { formatApiError } from "@/lib/format-api-error";
import { useAuth } from "@/lib/auth";

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

function GeneralTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: account, isLoading: accountLoading } = useGetAccount({ query: { queryKey: getGetAccountQueryKey() } });
  const addSlot = useAddConcurrentSlot();

  return (
    <div className="space-y-6">
      {/* Account & Billing */}
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
                  Looking to call the SnapServe REST API? Manage your API keys on the dedicated{" "}
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
          <p className="text-muted-foreground">Manage your account, appearance, and preferences.</p>
        </div>
        <GeneralTab />
      </div>
    </div>
  );
}
