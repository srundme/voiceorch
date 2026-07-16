import { useState } from "react";
import { useOverview, useSpikeAlerts, useDismissSpikeAlert, usePromptTemplates, useVobizWalletStatus, type UserSegment } from "@/hooks/use-admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Users, PhoneCall, Activity, DollarSign, Clock, AlertCircle, Bell, X, Mail, Wallet, RefreshCw, TrendingDown, ChevronDown, ChevronUp, CheckCircle2, Timer } from "lucide-react";
import { formatCentsToDollars } from "@/lib/api";
import { formatApiError } from "@/lib/format-api-error";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { NoActiveTemplateBanner } from "@/components/no-active-template-banner";
import { CallVolumeChart } from "@/components/call-volume-chart";

function SpikeAlertsPanel() {
  const { data: alertsData, isLoading } = useSpikeAlerts();
  const dismissAlert = useDismissSpikeAlert();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);

  const COLLAPSE_LIMIT = 3;

  const threshold = alertsData?.threshold ?? null;
  const activeAlerts = alertsData?.alerts?.filter((a) => !a.dismissed) ?? [];
  const dismissedAlerts = alertsData?.alerts?.filter((a) => a.dismissed) ?? [];

  const visibleAlerts = expanded ? activeAlerts : activeAlerts.slice(0, COLLAPSE_LIMIT);
  const hiddenCount = activeAlerts.length - COLLAPSE_LIMIT;

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
    <Card className="border-border shadow-none">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-zinc-500" />
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
      <CardContent className="px-4 pb-3 space-y-3">
        {threshold === null ? (
          <div className="flex items-center justify-between py-1">
            <p className="text-xs text-muted-foreground">No threshold configured.</p>
            <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
              <Link href="/settings">Configure threshold →</Link>
            </Button>
          </div>
        ) : isLoading ? (
          <p className="text-xs text-muted-foreground animate-pulse py-1">Checking for spikes...</p>
        ) : activeAlerts.length === 0 && dismissedAlerts.length === 0 ? (
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-1.5 text-xs text-emerald-500">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>No users exceeded the threshold today.</span>
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" asChild>
              <Link href="/users">View all users →</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleAlerts.map((alert) => (
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

            {activeAlerts.length > COLLAPSE_LIMIT && (
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground pt-0.5"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? (
                  <><ChevronUp className="h-3 w-3" /> Collapse</>
                ) : (
                  <><ChevronDown className="h-3 w-3" /> +{hiddenCount} more</>
                )}
              </button>
            )}

            {dismissedAlerts.length > 0 && (
              <p className="text-xs text-muted-foreground pt-0.5">
                {dismissedAlerts.length} alert{dismissedAlerts.length > 1 ? "s" : ""} dismissed today.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VobizWalletCard() {
  const { data, isLoading, isError, refetch, isFetching } = useVobizWalletStatus();
  const queryClient = useQueryClient();

  const status = data?.status ?? "unknown";
  const vobizInr   = data?.vobizBalanceInr ?? null;
  const requiredInr = data?.requiredMinInr ?? 0;
  const shortfallInr = data?.shortfallInr ?? 0;
  const totalUserUsd = data?.totalUserWalletUsd ?? 0;
  const thresholdPct = data?.thresholdPct ?? 20;

  const pct = vobizInr !== null && requiredInr > 0
    ? Math.min(100, Math.round((vobizInr / requiredInr) * 100))
    : 0;

  const statusConfig = {
    ok:       { color: "text-emerald-400", bar: "bg-emerald-500", ring: "border-emerald-500/30", label: "Healthy", bg: "" },
    warning:  { color: "text-amber-400",   bar: "bg-amber-500",   ring: "border-amber-500/40",   label: "Low",     bg: "bg-amber-500/5" },
    critical: { color: "text-red-400",     bar: "bg-red-500",     ring: "border-red-500/40",     label: "Critical",bg: "bg-red-500/5" },
    unknown:  { color: "text-muted-foreground", bar: "bg-muted", ring: "border-border",           label: "Unknown", bg: "" },
  }[status];

  return (
    <Card className={`border shadow-none ${statusConfig.ring} ${statusConfig.bg}`}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wallet className={`h-4 w-4 ${statusConfig.color}`} />
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              VoBiz Master Wallet
            </CardTitle>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${statusConfig.ring} ${statusConfig.color}`}>
              {statusConfig.label}
            </span>
          </div>
          <Button
            size="sm" variant="ghost"
            className="h-6 w-6 p-0 text-muted-foreground"
            onClick={() => { void queryClient.invalidateQueries({ queryKey: ["admin", "vobiz-wallet-status"] }); void refetch(); }}
            disabled={isFetching}
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-3 space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            <div className="h-4 w-32 rounded animate-pulse bg-muted" />
            <div className="h-2 w-full rounded animate-pulse bg-muted" />
          </div>
        ) : isError ? (
          <p className="text-xs text-destructive">Failed to load VoBiz balance. Check VOBIZ_AUTH_ID / VOBIZ_AUTH_TOKEN.</p>
        ) : (
          <>
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className={`text-2xl font-bold font-mono tabular-nums ${statusConfig.color}`}>
                  {vobizInr !== null ? `₹${vobizInr.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—"}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Available · min required ₹{requiredInr.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </p>
              </div>
              <div className="text-right text-xs text-muted-foreground shrink-0">
                <div>User wallets</div>
                <div className="font-mono font-semibold text-foreground">${totalUserUsd.toFixed(2)}</div>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{pct}% of required</span>
                <span>{thresholdPct}% threshold</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-border/50 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${statusConfig.bar}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {(status === "warning" || status === "critical") && (
              <div className={`flex items-start gap-2 rounded-md border px-3 py-2 ${statusConfig.ring} ${status === "critical" ? "bg-red-500/10" : "bg-amber-500/10"}`}>
                <TrendingDown className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${statusConfig.color}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-xs ${statusConfig.color}`}>
                    {status === "critical"
                      ? `Critically low — top up at least ₹${shortfallInr.toLocaleString("en-IN", { maximumFractionDigits: 0 })} immediately to prevent call failures.`
                      : `Top up ₹${shortfallInr.toLocaleString("en-IN", { maximumFractionDigits: 0 })} to restore the ${thresholdPct}% safety buffer.`}
                  </p>
                  <a
                    href="https://www.vobiz.in/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-xs underline underline-offset-2 mt-1 inline-block ${statusConfig.color} hover:opacity-80`}
                  >
                    Top up VoBiz →
                  </a>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

const SEGMENTS: { id: UserSegment; label: string }[] = [
  { id: "real", label: "Real" },
  { id: "test", label: "Test" },
  { id: "all", label: "All" },
];

export default function Overview() {
  const [segment, setSegment] = useState<UserSegment>("real");
  const { data: overview, isLoading, isError, error } = useOverview(segment);
  const { data: templates } = usePromptTemplates();
  const hasActiveTemplate = templates === undefined || templates.some((t) => t.isActive);

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
      title: "Total Minutes",
      value: overview?.totalMinutes?.toLocaleString() || "0",
      icon: Timer,
      description: "Consumed by users",
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
  const recentCallsCount = overview?.recentCalls ?? 0;

  return (
    <div className="space-y-4">
      {!hasActiveTemplate && <NoActiveTemplateBanner />}

      {/* Status strip — h-9 pill row */}
      <div className="flex items-center h-9 gap-5 flex-wrap text-[11px] uppercase tracking-[0.14em] text-muted-foreground ring-1 ring-border rounded-md px-4 bg-card">
        <span className="font-semibold text-foreground">Call Center</span>
        <span className="text-border">|</span>
        <span className="flex items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
          </span>
          <span>{activeCount} Live</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
          <span>{pendingCount} Queue</span>
        </span>
        <span className="ml-auto text-[10px] font-semibold text-foreground">
          {successRate}% success
        </span>
      </div>

      {/* Page header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-3xl font-bold tracking-tight">Platform Overview</h1>
        <div className="flex items-center gap-3">
          {/* Real / Test / All segment toggle */}
          <div className="inline-flex items-center rounded-md border border-border bg-card p-0.5">
            {SEGMENTS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSegment(s.id)}
                className={`px-2.5 h-6 text-[11px] font-medium rounded-[5px] transition-colors ${
                  segment === s.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
            </span>
            <RefreshCw className="h-3 w-3" />
            <span>Live</span>
          </div>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {metrics.map((metric, i) => (
          <Card key={i} className="border-border bg-card shadow-none hover:border-muted-foreground/30 transition-colors">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.14em]">
                {metric.title}
              </CardTitle>
              <metric.icon className="h-3.5 w-3.5 text-muted-foreground" />
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-2xl font-bold font-mono tabular-nums">{metric.value}</div>
              <p className="text-xs text-muted-foreground mt-0.5">{metric.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <CallVolumeChart compact defaultPreset="month" showViewAll segment={segment} />

      {/* Recent Calls summary */}
      <Card className="border-border shadow-none">
        <CardHeader className="pb-2 pt-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PhoneCall className="h-4 w-4 text-zinc-500" />
              <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Recent Calls
              </CardTitle>
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" asChild>
              <Link href="/usage/history">View all →</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="flex items-center gap-3 py-1 text-sm">
            <span className="font-mono font-bold text-2xl tabular-nums">{recentCallsCount.toLocaleString()}</span>
            <div className="text-xs text-muted-foreground">
              <div>calls in last 24 hours</div>
              <div className="text-emerald-500 font-medium">{successRate}% success rate</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <VobizWalletCard />
      <SpikeAlertsPanel />
    </div>
  );
}
