import { useState, useEffect } from "react";
import { useSpikeThreshold, useSaveSpikeThreshold, useSpikeAlertEmail, useSaveSpikeAlertEmail } from "@/hooks/use-admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Bell, Mail, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function PlatformSettings() {
  const { data: thresholdData, isLoading: loadingThreshold } = useSpikeThreshold();
  const { data: emailData, isLoading: loadingEmail } = useSpikeAlertEmail();
  const saveThreshold = useSaveSpikeThreshold();
  const saveEmail = useSaveSpikeAlertEmail();
  const { toast } = useToast();

  const [thresholdInput, setThresholdInput] = useState("");
  const [emailInput, setEmailInput] = useState("");

  useEffect(() => {
    if (thresholdData?.threshold != null) {
      setThresholdInput(String(thresholdData.threshold));
    }
  }, [thresholdData]);

  useEffect(() => {
    if (emailData?.email != null) {
      setEmailInput(emailData.email);
    }
  }, [emailData]);

  async function handleSaveThreshold() {
    const raw = thresholdInput.trim();
    if (raw === "") {
      try {
        await saveThreshold.mutateAsync(null);
        toast({ title: "Threshold cleared", description: "Spike alerts are now disabled." });
      } catch {
        toast({ title: "Failed to clear threshold", variant: "destructive" });
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
    } catch {
      toast({ title: "Failed to save threshold", variant: "destructive" });
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
    } catch {
      toast({ title: "Failed to save email", variant: "destructive" });
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
