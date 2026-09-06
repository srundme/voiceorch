import { Link } from "wouter";
import { SectionSubNav } from "@/components/section-subnav";
import { SETTINGS_TABS } from "@/lib/nav-config";
import {
  useAlertEmail, useSaveAlertEmail,
  useAlertSlackWebhook, useSaveAlertSlackWebhook,
  useAlertMinSeverity, useSaveAlertMinSeverity,
  useAlertNotificationCooldown, useSaveAlertNotificationCooldown,
  useSendTestAlertNotification,
} from "@/hooks/use-admin-api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { useEffect, useState } from "react";
import { Bell, Mail, Slack, Send } from "lucide-react";

export default function AdminSettingsPage() {
  const { toast } = useToast();
  const { data: emailData } = useAlertEmail();
  const { data: slackData } = useAlertSlackWebhook();
  const { data: severityData } = useAlertMinSeverity();
  const { data: cooldownData } = useAlertNotificationCooldown();
  const saveEmail = useSaveAlertEmail();
  const saveSlack = useSaveAlertSlackWebhook();
  const saveSeverity = useSaveAlertMinSeverity();
  const saveCooldown = useSaveAlertNotificationCooldown();
  const sendTest = useSendTestAlertNotification();

  const [email, setEmail] = useState("");
  const [slack, setSlack] = useState("");
  const [severity, setSeverity] = useState("warning");
  const [cooldown, setCooldown] = useState("60");

  useEffect(() => { if (emailData?.email != null) setEmail(emailData.email); }, [emailData]);
  useEffect(() => { if (slackData?.webhookUrl != null) setSlack(slackData.webhookUrl ?? ""); }, [slackData]);
  useEffect(() => { if (severityData?.minSeverity) setSeverity(severityData.minSeverity); }, [severityData]);
  useEffect(() => {
    if (cooldownData?.cooldownMinutes != null) setCooldown(String(cooldownData.cooldownMinutes));
  }, [cooldownData]);

  const onErr = (e: unknown) => toast({ title: "Failed", description: formatApiError(e), variant: "destructive" });

  return (
    <div className="space-y-6 max-w-3xl">
      <SectionSubNav tabs={SETTINGS_TABS} />
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Alert channels and admin notification preferences.{" "}
          <Link href="/settings" className="text-primary hover:underline">Platform settings →</Link>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Mail className="h-4 w-4" /> Alert email</CardTitle>
          <CardDescription>Where critical admin alerts are delivered</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ops@company.com" />
          </div>
          <Button
            className="self-end"
            disabled={saveEmail.isPending}
            onClick={() =>
              saveEmail.mutate(email || null, {
                onSuccess: () => toast({ title: "Alert email saved" }),
                onError: onErr,
              })
            }
          >
            Save
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Slack className="h-4 w-4" /> Slack webhook</CardTitle>
          <CardDescription>Incoming webhook URL for Slack notifications</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Webhook URL</Label>
            <Input value={slack} onChange={(e) => setSlack(e.target.value)} placeholder="https://hooks.slack.com/…" />
          </div>
          <Button
            className="self-end"
            disabled={saveSlack.isPending}
            onClick={() =>
              saveSlack.mutate(slack || null, {
                onSuccess: () => toast({ title: "Slack webhook saved" }),
                onError: onErr,
              })
            }
          >
            Save
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Bell className="h-4 w-4" /> Thresholds</CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Min severity</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="mt-2"
              disabled={saveSeverity.isPending}
              onClick={() =>
                saveSeverity.mutate(severity, {
                  onSuccess: () => toast({ title: "Severity saved" }),
                  onError: onErr,
                })
              }
            >
              Save severity
            </Button>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cooldown (minutes)</Label>
            <Input type="number" value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
            <Button
              size="sm"
              className="mt-2"
              disabled={saveCooldown.isPending}
              onClick={() =>
                saveCooldown.mutate(Number(cooldown), {
                  onSuccess: () => toast({ title: "Cooldown saved" }),
                  onError: onErr,
                })
              }
            >
              Save cooldown
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Test notification</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="gap-1.5"
            disabled={sendTest.isPending}
            onClick={() =>
              sendTest.mutate(undefined, {
                onSuccess: () => toast({ title: "Test sent" }),
                onError: onErr,
              })
            }
          >
            <Send className="h-3.5 w-3.5" /> Send test alert
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            Rule catalog and live feed: <Link href="/operations/alerts" className="text-primary hover:underline">Alerts</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
