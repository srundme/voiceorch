import { useOverview, useSpikeAlerts, useDismissSpikeAlert } from "@/hooks/use-admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, PhoneCall, Activity, DollarSign, Clock, AlertCircle, Bell, X, Mail } from "lucide-react";
import { formatCentsToDollars } from "@/lib/api";
import { formatApiError } from "@/lib/format-api-error";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

function SpikeAlertsPanel() {
  const { data: alertsData, isLoading } = useSpikeAlerts();
  const dismissAlert = useDismissSpikeAlert();
  const { toast } = useToast();

  const threshold = alertsData?.threshold ?? null;
  const activeAlerts = alertsData?.alerts?.filter((a) => !a.dismissed) ?? [];
  const dismissedAlerts = alertsData?.alerts?.filter((a) => a.dismissed) ?? [];

  async function handleDismiss(clerkId: string | null) {
    if (!clerkId) return;
    try {
      await dismissAlert.mutateAsync(clerkId);
      toast({ title: "Alert dismissed", description: "This alert won't reappear today." });
    } catch (err) {
      toast({ title: "Failed to dismiss", description: formatApiError(err), variant: "destructive" });
    }
  }

  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-amber-500" />
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Usage Spike Alerts
            </CardTitle>
            {activeAlerts.length > 0 && (
              <span className="inline-flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-xs font-bold w-5 h-5">
                {activeAlerts.length}
              </span>
            )}
          </div>
          <Link
            href="/settings"
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            {threshold != null ? `Threshold: ${threshold} calls/day` : "Configure in Settings"}
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {threshold === null ? (
          <p className="text-xs text-muted-foreground py-2">
            No threshold configured.{" "}
            <Link href="/settings" className="underline underline-offset-2 hover:text-foreground">
              Go to Settings
            </Link>{" "}
            to set a daily call threshold and enable spike alerts.
          </p>
        ) : isLoading ? (
          <p className="text-xs text-muted-foreground animate-pulse py-2">Checking for spikes...</p>
        ) : activeAlerts.length === 0 && dismissedAlerts.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No users have exceeded the threshold today.</p>
        ) : (
          <div className="space-y-2">
            {activeAlerts.map((alert) => (
              <div
                key={alert.clerkId}
                className="flex items-center justify-between rounded-sm border border-destructive/30 bg-destructive/5 px-3 py-2 gap-3"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                  <span className="text-xs font-medium truncate">{alert.email ?? alert.clerkId ?? "Unknown user"}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {alert.callCount} calls today
                  </span>
                  {alert.notified && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                      <Mail className="h-3 w-3" />
                      notified
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => handleDismiss(alert.clerkId)}
                  disabled={dismissAlert.isPending}
                >
                  <X className="h-3 w-3 mr-1" />Dismiss
                </Button>
              </div>
            ))}
            {dismissedAlerts.length > 0 && (
              <p className="text-xs text-muted-foreground pt-1">
                {dismissedAlerts.length} alert{dismissedAlerts.length > 1 ? "s" : ""} dismissed today.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Overview() {
  const { data: overview, isLoading, isError, error } = useOverview();

  if (isLoading) {
    return <div className="p-8 text-muted-foreground animate-pulse">Loading platform metrics...</div>;
  }

  if (isError) {
    return <div className="p-8 text-destructive">Error loading overview: {formatApiError(error)}</div>;
  }

  const metrics = [
    {
      title: "Total Users",
      value: overview?.totalUsers?.toLocaleString() || "0",
      icon: Users,
      description: "Registered accounts",
    },
    {
      title: "Total Revenue",
      value: formatCentsToDollars(overview?.totalRevenueCents || 0),
      icon: DollarSign,
      description: "Lifetime",
    },
    {
      title: "Total Calls",
      value: overview?.totalCalls?.toLocaleString() || "0",
      icon: PhoneCall,
      description: "All time",
    },
    {
      title: "Active Calls",
      value: overview?.activeCalls?.toLocaleString() || "0",
      icon: Activity,
      description: "Right now",
    },
    {
      title: "Calls (24h)",
      value: overview?.recentCalls?.toLocaleString() || "0",
      icon: Clock,
      description: "Last 24 hours",
    },
    {
      title: "Pending Callbacks",
      value: overview?.pendingCallbacks?.toLocaleString() || "0",
      icon: AlertCircle,
      description: "Awaiting execution",
    },
  ];

  const totalCalls = overview?.totalCalls ?? 0;
  const successfulCalls = overview?.successfulCalls ?? 0;
  const successRate = totalCalls > 0 ? Math.round((successfulCalls / totalCalls) * 100) : 0;
  const activeCount = overview?.activeCalls ?? 0;
  const pendingCount = overview?.pendingCallbacks ?? 0;

  return (
    <div className="space-y-6">
      {/* Cartesia-style status strip */}
      <div className="flex items-center gap-5 flex-wrap text-[11px] uppercase tracking-[0.14em] text-muted-foreground border border-border rounded-md px-4 py-2 bg-card">
        <span className="font-semibold text-foreground">Call Center</span>
        <span className="text-border">|</span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
          <span>{activeCount} Live</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          <span>{pendingCount} Queue</span>
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-[10px] font-semibold text-foreground">
          {successRate}% Rate
        </span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Platform Overview</h1>
        <div className="text-xs text-muted-foreground">Auto-refreshing every 30s</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {metrics.map((metric, i) => (
          <Card key={i} className="border-border bg-card shadow-none hover:border-muted-foreground/30 transition-colors">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.14em]">
                {metric.title}
              </CardTitle>
              <metric.icon className="h-3.5 w-3.5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold font-mono tabular-nums">{metric.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{metric.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <SpikeAlertsPanel />
    </div>
  );
}
