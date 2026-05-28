import { useState, useEffect } from "react";
import {
  useSpikeThreshold, useSaveSpikeThreshold, useSpikeAlertEmail, useSaveSpikeAlertEmail,
  useAlertEmail, useSaveAlertEmail,
  useAlertSlackWebhook, useSaveAlertSlackWebhook,
  useAlertMinSeverity, useSaveAlertMinSeverity,
  useAlertNotificationCooldown, useSaveAlertNotificationCooldown,
} from "@/hooks/use-admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Settings, Bell, Mail, Check, AlertTriangle, Slack } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatAdminError } from "@/lib/api";

export default function PlatformSettings() {
  const { data: thresholdData, isLoading: loadingThreshold } = useSpikeThreshold();
  const { data: emailData, isLoading: loadingEmail } = useSpikeAlertEmail();
  const saveThreshold = useSaveSpikeThreshold();
  const saveEmail = useSaveSpikeAlertEmail();

  const { data: alertEmailData, isLoading: loadingAlertEmail } = useAlertEmail();
  const { data: alertSlackData, isLoading: loadingAlertSlack } = useAlertSlackWebhook();
  const { data: alertSeverityData, isLoading: loadingAlertSeverity } = useAlertMinSeverity();
  const { data: alertCooldownData, isLoading: loadingAlertCooldown } = useAlertNotificationCooldown();
  const saveAlertEmail = useSaveAlertEmail();
  const saveAlertSlack = useSaveAlertSlackWebhook();
  const saveAlertSeverity = useSaveAlertMinSeverity();
  const saveAlertCooldown = useSaveAlertNotificationCooldown();

  const { toast } = useToast();

  const [thresholdInput, setThresholdInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [alertEmailInput, setAlertEmailInput] = useState("");
  const [alertSlackInput, setAlertSlackInput] = useState("");
  const [alertSeverity, setAlertSeverity] = useState("warning");
  const [alertCooldownInput, setAlertCooldownInput] = useState("10");

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
        toast({ title: "Failed to clear threshold", description: formatAdminError(err), variant: "destructive" });
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
      toast({ title: "Failed to save threshold", description: formatAdminError(err), variant: "destructive" });
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
      toast({ title: "Failed to save email", description: formatAdminError(err), variant: "destructive" });
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
      toast({ title: "Failed to save alert email", description: formatAdminError(err), variant: "destructive" });
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
      toast({ title: "Failed to save Slack webhook", description: formatAdminError(err), variant: "destructive" });
    }
  }

  async function handleSaveAlertSeverity(val: string) {
    setAlertSeverity(val);
    try {
      await saveAlertSeverity.mutateAsync(val);
      toast({ title: "Minimum severity saved", description: `Will notify for ${val} and above.` });
    } catch (err) {
      toast({ title: "Failed to save severity setting", description: formatAdminError(err), variant: "destructive" });
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
    } catch {
      toast({ title: "Failed to save cooldown", variant: "destructive" });
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
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Alert Engine Notifications
          </CardTitle>
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
    </div>
  );
}
