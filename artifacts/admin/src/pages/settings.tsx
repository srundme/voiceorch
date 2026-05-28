import { useState, useEffect } from "react";
import {
  useSpikeThreshold, useSaveSpikeThreshold, useSpikeAlertEmail, useSaveSpikeAlertEmail,
  useAlertEmail, useSaveAlertEmail,
  useAlertSlackWebhook, useSaveAlertSlackWebhook,
  useAlertMinSeverity, useSaveAlertMinSeverity,
  useAlertNotificationCooldown, useSaveAlertNotificationCooldown,
  useSendTestAlertNotification,
  useAlertNotificationLog,
  useAlertCooldownStatus,
  type AlertNotificationLogEntry,
  useAlertCooldownStats, useResetAlertSuppressedCount,
} from "@/hooks/use-admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Settings, Bell, Mail, Check, AlertTriangle, Slack, Send, CheckCircle2, XCircle, Clock, RotateCcw, ShieldCheck, ShieldOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

function CooldownStatusBadge({
  cooldownUntil,
  lastNotifiedAt,
  lastNotifiedSeverity,
}: {
  cooldownUntil: string | null;
  lastNotifiedAt: string | null;
  lastNotifiedSeverity: string | null;
}) {
  if (cooldownUntil) {
    const until = new Date(cooldownUntil);
    const timeStr = until.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 font-medium">
        <ShieldOff className="h-3.5 w-3.5" />
        Suppressed — next alert can fire at {timeStr}
        {lastNotifiedSeverity && (
          <span className="text-muted-foreground font-normal ml-0.5">
            (last: {lastNotifiedSeverity})
          </span>
        )}
      </span>
    );
  }

  if (lastNotifiedAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 font-medium">
        <ShieldCheck className="h-3.5 w-3.5" />
        Ready — cooldown has passed
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 font-medium">
      <ShieldCheck className="h-3.5 w-3.5" />
      Ready — no notifications sent yet
    </span>
  );
}

function DeliveryStatusBadge({ lastSentAt, lastFailedAt }: { lastSentAt: string | null; lastFailedAt: string | null }) {
  const hasSent = !!lastSentAt;
  const hasFailed = !!lastFailedAt;

  if (!hasSent && !hasFailed) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        No deliveries yet
      </span>
    );
  }

  const sentTime = lastSentAt ? new Date(lastSentAt).getTime() : 0;
  const failedTime = lastFailedAt ? new Date(lastFailedAt).getTime() : 0;
  const mostRecentIsFailed = failedTime > sentTime;

  if (mostRecentIsFailed) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-destructive font-medium">
        <XCircle className="h-3.5 w-3.5" />
        Last failed {formatRelative(lastFailedAt)}
        {hasSent && <span className="text-muted-foreground font-normal ml-1">· Last sent {formatRelative(lastSentAt)}</span>}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 font-medium">
      <CheckCircle2 className="h-3.5 w-3.5" />
      Last sent {formatRelative(lastSentAt)}
      {hasFailed && <span className="text-muted-foreground font-normal ml-1">· Last failed {formatRelative(lastFailedAt)}</span>}
    </span>
  );
}

function NotificationLogTable({ entries }: { entries: AlertNotificationLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-3 text-center">No delivery attempts recorded yet.</p>
    );
  }

  return (
    <div className="overflow-auto max-h-48 rounded border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-muted-foreground">
            <th className="text-left px-3 py-2 font-medium w-36">Time</th>
            <th className="text-left px-3 py-2 font-medium w-16">Channel</th>
            <th className="text-left px-3 py-2 font-medium w-16">Status</th>
            <th className="text-left px-3 py-2 font-medium">Error</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b border-border last:border-0 hover:bg-muted/20">
              <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                {new Date(entry.createdAt).toLocaleString()}
              </td>
              <td className="px-3 py-1.5 capitalize">{entry.channel}</td>
              <td className="px-3 py-1.5">
                {entry.status === "sent" ? (
                  <span className="inline-flex items-center gap-1 text-zinc-600 dark:text-zinc-400 font-medium">
                    <CheckCircle2 className="h-3 w-3" />
                    Sent
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-destructive font-medium">
                    <XCircle className="h-3 w-3" />
                    Failed
                  </span>
                )}
              </td>
              <td className="px-3 py-1.5 text-muted-foreground truncate max-w-xs" title={entry.errorMessage ?? ""}>
                {entry.errorMessage ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PlatformSettings() {
  const { data: thresholdData, isLoading: loadingThreshold } = useSpikeThreshold();
  const { data: emailData, isLoading: loadingEmail } = useSpikeAlertEmail();
  const saveThreshold = useSaveSpikeThreshold();
  const saveEmail = useSaveSpikeAlertEmail();

  const { data: alertEmailData, isLoading: loadingAlertEmail } = useAlertEmail();
  const { data: alertSlackData, isLoading: loadingAlertSlack } = useAlertSlackWebhook();
  const { data: alertSeverityData, isLoading: loadingAlertSeverity } = useAlertMinSeverity();
  const { data: alertCooldownData, isLoading: loadingAlertCooldown } = useAlertNotificationCooldown();
  const { data: cooldownStats } = useAlertCooldownStats();
  const { data: cooldownStatus } = useAlertCooldownStatus();
  const saveAlertEmail = useSaveAlertEmail();
  const saveAlertSlack = useSaveAlertSlackWebhook();
  const saveAlertSeverity = useSaveAlertMinSeverity();
  const saveAlertCooldown = useSaveAlertNotificationCooldown();
  const sendTestNotification = useSendTestAlertNotification();
  const [testOnCooldown, setTestOnCooldown] = useState(false);
  const resetSuppressed = useResetAlertSuppressedCount();

  const { data: logData, isLoading: loadingLog } = useAlertNotificationLog(50);
  const [showLog, setShowLog] = useState(false);

  const { toast } = useToast();

  const [thresholdInput, setThresholdInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [alertEmailInput, setAlertEmailInput] = useState("");
  const [alertSlackInput, setAlertSlackInput] = useState("");
  const [alertSeverity, setAlertSeverity] = useState("warning");
  const [alertCooldownInput, setAlertCooldownInput] = useState("10");
  const [testDialogOpen, setTestDialogOpen] = useState(false);

  useEffect(() => {
    if (thresholdData?.threshold != null) setThresholdInput(String(thresholdData.threshold));
  }, [thresholdData]);

  useEffect(() => {
    if (emailData?.email != null) setEmailInput(emailData.email);
  }, [emailData]);

  useEffect(() => {
    if (alertEmailData?.email != null) setAlertEmailInput(alertEmailData.email);
  }, [alertEmailData]);

  useEffect(() => {
    if (alertSlackData?.webhookUrl != null) setAlertSlackInput(alertSlackData.webhookUrl);
  }, [alertSlackData]);

  useEffect(() => {
    if (alertSeverityData?.minSeverity) setAlertSeverity(alertSeverityData.minSeverity);
  }, [alertSeverityData]);

  useEffect(() => {
    if (alertCooldownData?.cooldownMinutes != null) setAlertCooldownInput(String(alertCooldownData.cooldownMinutes));
  }, [alertCooldownData]);

  async function handleSaveThreshold() {
    const raw = thresholdInput.trim();
    if (raw === "") {
      try {
        await saveThreshold.mutateAsync(null);
        toast({ title: "Threshold cleared", description: "Spike alerts are now disabled." });
      } catch (err) {
        toast({ title: "Failed to clear threshold", description: formatApiError(err), variant: "destructive" });
      }
      return;
    }
    const val = parseInt(raw, 10);
    if (!Number.isFinite(val) || val < 1) {
      toast({ title: "Invalid threshold", description: "Must be a positive whole number, or clear to disable.", variant: "destructive" });
      return;
    }
    try {
      await saveThreshold.mutateAsync(val);
      toast({ title: "Threshold saved", description: `Alert threshold set to ${val} calls/day.` });
    } catch (err) {
      toast({ title: "Failed to save threshold", description: formatApiError(err), variant: "destructive" });
    }
  }

  async function handleSaveEmail() {
    const val = emailInput.trim();
    if (val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      toast({ title: "Invalid email address", variant: "destructive" });
      return;
    }
    try {
      await saveEmail.mutateAsync(val || null);
      toast({ title: val ? "Notification email saved" : "Notification email cleared" });
    } catch (err) {
      toast({ title: "Failed to save email", description: formatApiError(err), variant: "destructive" });
    }
  }

  async function handleSaveAlertEmail() {
    const val = alertEmailInput.trim();
    if (val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      toast({ title: "Invalid email address", variant: "destructive" });
      return;
    }
    try {
      await saveAlertEmail.mutateAsync(val || null);
      toast({ title: val ? "Alert notification email saved" : "Alert notification email cleared" });
    } catch (err) {
      toast({ title: "Failed to save alert email", description: formatApiError(err), variant: "destructive" });
    }
  }

  async function handleSaveAlertSlack() {
    const val = alertSlackInput.trim();
    if (val && !val.startsWith("https://")) {
      toast({ title: "Invalid webhook URL", description: "Must be an https:// URL.", variant: "destructive" });
      return;
    }
    try {
      await saveAlertSlack.mutateAsync(val || null);
      toast({ title: val ? "Slack webhook saved" : "Slack webhook cleared" });
    } catch (err) {
      toast({ title: "Failed to save Slack webhook", description: formatApiError(err), variant: "destructive" });
    }
  }

  async function handleSaveAlertSeverity(val: string) {
    setAlertSeverity(val);
    try {
      await saveAlertSeverity.mutateAsync(val);
      toast({ title: "Minimum severity saved", description: `Will notify for ${val} and above.` });
    } catch (err) {
      toast({ title: "Failed to save severity setting", description: formatApiError(err), variant: "destructive" });
    }
  }

  async function handleSaveAlertCooldown() {
    const raw = alertCooldownInput.trim();
    const val = parseInt(raw, 10);
    if (raw === "" || !Number.isFinite(val) || val < 0) {
      toast({ title: "Invalid cooldown", description: "Must be a non-negative whole number of minutes.", variant: "destructive" });
      return;
    }
    try {
      await saveAlertCooldown.mutateAsync(val);
      toast({
        title: "Cooldown saved",
        description: val === 0 ? "Rate limiting disabled." : `At most one notification per ${val} minute${val === 1 ? "" : "s"}.`,
      });
    } catch (err) {
      toast({ title: "Failed to save cooldown", description: formatApiError(err), variant: "destructive" });
    }
  }

  async function handleSendTestNotification() {
    try {
      const result = await sendTestNotification.mutateAsync();
      const channels = result.sent.join(" and ");
      setTestOnCooldown(true);
      setTimeout(() => setTestOnCooldown(false), 30_000);
      toast({ title: "Test notification sent", description: `Dispatched via ${channels}.` });
    } catch (err) {
      toast({ title: "Test notification failed", description: formatApiError(err), variant: "destructive" });
    }
  }

  const emailSummary = logData?.summary.email;
  const slackSummary = logData?.summary.slack;
  const logEntries = logData?.entries ?? [];

  async function handleResetSuppressed() {
    try {
      await resetSuppressed.mutateAsync();
      toast({ title: "Counter reset", description: "Suppressed notification count cleared." });
    } catch {
      toast({ title: "Failed to reset counter", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-primary" />
        <h1 className="text-3xl font-bold tracking-tight">Platform Settings</h1>
      </div>

      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Alert Engine Notifications
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setTestDialogOpen(true)}
              disabled={sendTestNotification.isPending || testOnCooldown}
            >
              <Send className="h-3.5 w-3.5 mr-1.5" />
              {sendTestNotification.isPending ? "Sending…" : testOnCooldown ? "Sent — wait 30s" : "Send test"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          <p className="text-xs text-muted-foreground max-w-lg">
            Receive out-of-band notifications when the alert engine fires a new alert (low balance, budget thresholds,
            error spikes, usage spikes, provider down). Deduplicated — no repeat notifications for the same alert key.
            Requires <code className="text-xs bg-muted px-1 rounded">GMAIL_USER</code> and{" "}
            <code className="text-xs bg-muted px-1 rounded">GMAIL_APP_PASSWORD</code> to be set for email.
          </p>

          <div className="space-y-2 max-w-sm">
            <Label className="text-sm font-medium">Minimum severity to notify</Label>
            <p className="text-xs text-muted-foreground">
              Alerts at this severity or above will trigger a notification. Default: warning.
            </p>
            <Select
              value={loadingAlertSeverity ? "warning" : alertSeverity}
              onValueChange={handleSaveAlertSeverity}
              disabled={loadingAlertSeverity || saveAlertSeverity.isPending}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Info and above</SelectItem>
                <SelectItem value="warning">Warning and above</SelectItem>
                <SelectItem value="critical">Critical only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 max-w-sm border-t border-border pt-5">
            <Label htmlFor="alert-cooldown" className="text-sm font-medium">
              Notification cooldown (minutes)
            </Label>
            <p className="text-xs text-muted-foreground">
              At most one notification will be sent within this window, even if many alerts fire at once. Set to 0 to
              disable rate limiting. Default: 10.
            </p>
            <div className="flex items-center gap-2">
              <Input
                id="alert-cooldown"
                type="number"
                min={0}
                placeholder={loadingAlertCooldown ? "Loading…" : "10"}
                value={alertCooldownInput}
                onChange={(e) => setAlertCooldownInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveAlertCooldown()}
                className="w-32"
              />
              <Button size="sm" onClick={handleSaveAlertCooldown} disabled={saveAlertCooldown.isPending}>
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Save
              </Button>
            </div>
            {cooldownStatus && (
              <div className="mt-1">
                <CooldownStatusBadge
                  cooldownUntil={cooldownStatus.cooldownUntil}
                  lastNotifiedAt={cooldownStatus.lastNotifiedAt}
                  lastNotifiedSeverity={cooldownStatus.lastNotifiedSeverity}
                />
              </div>
            )}
            {cooldownStats != null && (
              <div className="mt-3 flex items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
                <div className="flex-1">
                  {cooldownStats.suppressedCount > 0 ? (
                    <p className="text-xs text-zinc-700 dark:text-zinc-400 font-medium">
                      {cooldownStats.suppressedCount} notification{cooldownStats.suppressedCount === 1 ? "" : "s"} silenced by rate limiter
                      {cooldownStats.cooldownExpiresAt != null && cooldownStats.cooldownExpiresAt > Date.now()
                        ? ` · cooldown resets ${new Date(cooldownStats.cooldownExpiresAt).toLocaleTimeString()}`
                        : ""}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">No notifications silenced since last reset.</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={handleResetSuppressed}
                  disabled={resetSuppressed.isPending || cooldownStats.suppressedCount === 0}
                  title="Reset counter"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-2 max-w-sm border-t border-border pt-5">
            <Label htmlFor="alert-email" className="text-sm font-medium flex items-center gap-2">
              <Mail className="h-3.5 w-3.5" />
              Admin notification email
            </Label>
            <p className="text-xs text-muted-foreground">
              Email sent to this address when a new alert fires. Clear to disable email notifications.
            </p>
            <div className="flex items-center gap-2">
              <Input
                id="alert-email"
                type="email"
                placeholder={loadingAlertEmail ? "Loading…" : "admin@example.com"}
                value={alertEmailInput}
                onChange={(e) => setAlertEmailInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveAlertEmail()}
                className="w-64"
              />
              <Button size="sm" onClick={handleSaveAlertEmail} disabled={saveAlertEmail.isPending}>
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Save
              </Button>
            </div>
            {!loadingLog && emailSummary && (
              <DeliveryStatusBadge
                lastSentAt={emailSummary.lastSentAt}
                lastFailedAt={emailSummary.lastFailedAt}
              />
            )}
          </div>

          <div className="space-y-2 max-w-sm border-t border-border pt-5">
            <Label htmlFor="alert-slack" className="text-sm font-medium flex items-center gap-2">
              <Slack className="h-3.5 w-3.5" />
              Slack webhook URL
              <span className="text-xs text-muted-foreground font-normal">(optional)</span>
            </Label>
            <p className="text-xs text-muted-foreground">
              Posts a message to your Slack channel when a new alert fires. Clear to disable.
            </p>
            <div className="flex items-center gap-2">
              <Input
                id="alert-slack"
                type="url"
                placeholder={loadingAlertSlack ? "Loading…" : "https://hooks.slack.com/services/…"}
                value={alertSlackInput}
                onChange={(e) => setAlertSlackInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveAlertSlack()}
                className="w-64"
              />
              <Button size="sm" onClick={handleSaveAlertSlack} disabled={saveAlertSlack.isPending}>
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Save
              </Button>
            </div>
            {!loadingLog && slackSummary && (
              <DeliveryStatusBadge
                lastSentAt={slackSummary.lastSentAt}
                lastFailedAt={slackSummary.lastFailedAt}
              />
            )}
          </div>

          <div className="border-t border-border pt-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Delivery Log</p>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-6 px-2"
                onClick={() => setShowLog((v) => !v)}
                disabled={loadingLog}
              >
                {showLog ? "Hide" : "Show"} recent deliveries
              </Button>
            </div>
            {showLog && <NotificationLogTable entries={logEntries} />}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Usage Spike Alerts
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          <div className="space-y-2 max-w-sm">
            <Label htmlFor="threshold" className="text-sm font-medium">
              Daily call threshold per user
            </Label>
            <p className="text-xs text-muted-foreground">
              Alert when any user makes this many or more calls in a single day. Clear the field and save to disable spike alerts.
            </p>
            <div className="flex items-center gap-2">
              <Input
                id="threshold"
                type="number"
                min={1}
                placeholder={loadingThreshold ? "Loading…" : "e.g. 100"}
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveThreshold()}
                className="w-32"
              />
              <Button
                size="sm"
                onClick={handleSaveThreshold}
                disabled={saveThreshold.isPending}
              >
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Save
              </Button>
            </div>
          </div>

          <div className="space-y-2 max-w-sm border-t border-border pt-5">
            <Label htmlFor="spike-email" className="text-sm font-medium flex items-center gap-2">
              <Mail className="h-3.5 w-3.5" />
              Admin notification email
            </Label>
            <p className="text-xs text-muted-foreground">
              When a spike is first detected, an email alert will be sent to this address. Requires{" "}
              <code className="text-xs bg-muted px-1 rounded">GMAIL_USER</code> and{" "}
              <code className="text-xs bg-muted px-1 rounded">GMAIL_APP_PASSWORD</code> to be configured.
            </p>
            <div className="flex items-center gap-2">
              <Input
                id="spike-email"
                type="email"
                placeholder={loadingEmail ? "Loading…" : "admin@example.com"}
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveEmail()}
                className="w-64"
              />
              <Button
                size="sm"
                onClick={handleSaveEmail}
                disabled={saveEmail.isPending}
              >
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Save
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send test notification?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately dispatch a test alert to all configured channels — email
              {alertEmailInput.trim() ? ` (${alertEmailInput.trim()})` : ""} and Slack
              {alertSlackInput.trim() ? " webhook" : ""}. Use this to verify your notification
              settings are working correctly.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setTestDialogOpen(false);
                handleSendTestNotification();
              }}
            >
              Send test
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
