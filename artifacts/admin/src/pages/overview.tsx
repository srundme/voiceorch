import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  useOverview,
  useSpikeAlerts,
  useDismissSpikeAlert,
  usePromptTemplates,
  useVobizWalletStatus,
  usePlatformActive,
  usePlatformFailedCalls,
  usePlatformFailedCallsByReason,
  type UserSegment,
} from "@/hooks/use-admin-api";
import { adminFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Users,
  PhoneCall,
  Activity,
  Clock,
  AlertCircle,
  Bell,
  X,
  Mail,
  Wallet,
  RefreshCw,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Timer,
  Handshake,
  Trophy,
} from "lucide-react";
import { formatApiError } from "@/lib/format-api-error";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { NoActiveTemplateBanner } from "@/components/no-active-template-banner";
import { CallVolumeChart } from "@/components/call-volume-chart";
import { PageHeader } from "@/components/page-header";
import { SectionSubNav } from "@/components/section-subnav";
import { OPS_TABS } from "@/lib/nav-config";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
  const totalUserInr = data?.totalUserWalletInr ?? 0;
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
                <div className="font-mono font-semibold text-foreground">₹{totalUserInr.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</div>
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

function HealthLights() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "health"],
    queryFn: () => adminFetch<{ status: string; checks: Record<string, { status: string }> }>("/health"),
    refetchInterval: 15_000,
  });

  const entries = Object.entries(data?.checks ?? {}).slice(0, 6);

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Health
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-7 text-xs cursor-pointer" asChild>
            <Link href="/health">Open →</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        {isLoading ? (
          <p className="text-xs text-muted-foreground animate-pulse">Checking…</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">No checks returned.</p>
        ) : (
          <ul className="space-y-1.5">
            {entries.map(([name, check]) => {
              const ok = check.status === "ok";
              return (
                <li key={name} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-muted-foreground">{name}</span>
                  <span className="inline-flex items-center gap-1.5 shrink-0">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-destructive"}`}
                      aria-hidden
                    />
                    <span className={ok ? "text-foreground" : "text-destructive"}>{ok ? "ok" : check.status}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function FailedStrip() {
  const { data, isLoading } = usePlatformFailedCallsByReason();
  const rows = (data ?? []).slice(0, 5);
  const total = (data ?? []).reduce((sum, r) => sum + r.count, 0);

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Fail reasons
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-7 text-xs cursor-pointer" asChild>
            <Link href="/platform">Triage →</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-2">
        {isLoading ? (
          <p className="text-xs text-muted-foreground animate-pulse">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">No failures in the last sample.</p>
        ) : (
          rows.map((row) => {
            const pct = total ? Math.round((row.count / total) * 100) : 0;
            return (
              <div key={row.reason} className="space-y-1">
                <div className="flex justify-between gap-3 text-xs">
                  <span className="truncate">{row.reason}</span>
                  <span className="font-mono text-muted-foreground shrink-0">{row.count}</span>
                </div>
                <div className="h-1 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-destructive/70" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function RecentFailedUsers() {
  const { data, isLoading } = usePlatformFailedCalls({ limit: 8, page: 1 });
  const rows = data?.data ?? [];

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Recent failed calls
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-7 text-xs cursor-pointer" asChild>
            <Link href="/platform">All fails →</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-xs text-muted-foreground">Loading…</TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-xs text-muted-foreground">No recent failures.</TableCell>
              </TableRow>
            ) : (
              rows.map((call) => {
                const userLabel = call.userName ?? call.userEmail ?? call.userId ?? "—";
                return (
                  <TableRow key={call.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {call.createdAt ? format(new Date(call.createdAt), "MMM d HH:mm") : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {call.userId ? (
                        <Link
                          href={`/users/${call.userId}`}
                          className="underline underline-offset-2 hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                        >
                          {userLabel}
                        </Link>
                      ) : (
                        userLabel
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{call.agentName ?? "—"}</TableCell>
                    <TableCell className="text-xs truncate max-w-[220px]">{call.errorMessage ?? "—"}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
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
  const { data: live } = usePlatformActive();
  const hasActiveTemplate = templates === undefined || templates.some((t) => t.isActive);

  const metrics = [
    {
      title: "Total Users",
      value: overview?.totalUsers?.toLocaleString() || "0",
      icon: Users,
      description: "Registered accounts",
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
  const liveSessions = live?.count ?? activeCount;
  const callsToday = Number(overview?.callsToday ?? 0);
  const minutesToday = Number(overview?.minutesToday ?? 0);
  const topMinutesUsers: Array<{
    clerkId: string | null;
    email: string | null;
    name: string | null;
    callCount: number;
    minutes: number;
  }> = overview?.topMinutesUsers ?? [];
  const heaviest = topMinutesUsers[0];

  function todayUserLabel(row: (typeof topMinutesUsers)[number] | undefined) {
    if (!row) return "No calls yet today";
    if (row.name?.trim()) return row.name.trim();
    if (row.email) return row.email;
    return row.clerkId ?? "Unknown user";
  }

  if (isLoading) {
    return (
      <div className="space-y-5">
        <SectionSubNav tabs={OPS_TABS} />
        <p className="text-muted-foreground animate-pulse">Loading platform metrics…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-5">
        <SectionSubNav tabs={OPS_TABS} />
        <p className="text-destructive">Error loading overview: {formatApiError(error)}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionSubNav tabs={OPS_TABS} />
      {!hasActiveTemplate && <NoActiveTemplateBanner />}

      <PageHeader
        title="Today"
        subtitle="What needs a hand right now. User tools stay on this page — spikes, wallets, and account totals are not gone."
        actions={
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center rounded-md border border-border bg-card p-0.5">
              {SEGMENTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSegment(s.id)}
                  className={`px-2.5 h-7 text-[11px] font-medium rounded-[5px] cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    segment === s.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <span className="relative flex h-1.5 w-1.5">
                <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              Live
            </span>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="border-primary/40 shadow-none">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.14em] flex items-center gap-1.5">
              <PhoneCall className="h-3.5 w-3.5" /> Calls today
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-3xl font-bold font-mono tabular-nums text-primary">
              {callsToday.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Calendar day · {segment} users</p>
          </CardContent>
        </Card>
        <Card className="border-primary/40 shadow-none">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.14em] flex items-center gap-1.5">
              <Timer className="h-3.5 w-3.5" /> Minutes today
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-3xl font-bold font-mono tabular-nums text-primary">
              {minutesToday.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Talk time consumed today</p>
          </CardContent>
        </Card>
        <Card className="border-primary/40 shadow-none">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.14em] flex items-center gap-1.5">
              <Trophy className="h-3.5 w-3.5" /> Heaviest user today
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {heaviest?.clerkId ? (
              <>
                <Link
                  href={`/users/${heaviest.clerkId}`}
                  className="text-lg font-semibold text-primary hover:underline truncate block"
                >
                  {todayUserLabel(heaviest)}
                </Link>
                <p className="text-xs text-muted-foreground mt-1 font-mono tabular-nums">
                  {heaviest.minutes.toLocaleString()} min · {heaviest.callCount.toLocaleString()} calls
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No calls yet today</p>
            )}
          </CardContent>
        </Card>
      </div>

      {topMinutesUsers.length > 0 && (
        <Card className="border-border shadow-none">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Top minutes today
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs">User</TableHead>
                  <TableHead className="text-xs text-right">Calls</TableHead>
                  <TableHead className="text-xs text-right">Minutes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topMinutesUsers.map((row, i) => (
                  <TableRow key={row.clerkId ?? i}>
                    <TableCell>
                      {row.clerkId ? (
                        <Link href={`/users/${row.clerkId}`} className="text-sm text-primary hover:underline">
                          {todayUserLabel(row)}
                        </Link>
                      ) : (
                        <span className="text-sm">{todayUserLabel(row)}</span>
                      )}
                      {row.email && row.name ? (
                        <div className="text-[11px] text-muted-foreground">{row.email}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-sm">
                      {row.callCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-sm font-medium">
                      {row.minutes.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-border shadow-none">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.14em]">Live</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-2xl font-bold font-mono tabular-nums">{liveSessions}</div>
            <p className="text-xs text-muted-foreground mt-0.5">on a call now</p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-none">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.14em]">Queue</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-2xl font-bold font-mono tabular-nums">{pendingCount}</div>
            <p className="text-xs text-muted-foreground mt-0.5">pending callbacks</p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-none">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.14em]">Calls 24h</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-2xl font-bold font-mono tabular-nums">{recentCallsCount.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-0.5">{successRate}% lifetime success</p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-none">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.14em]">Users</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-2xl font-bold font-mono tabular-nums">{overview?.totalUsers?.toLocaleString() || "0"}</div>
            <Link href="/users" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground cursor-pointer">
              Open directory →
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { href: "/users", label: "Users", icon: Users },
          { href: "/partners", label: "Partners", icon: Handshake },
          { href: "/all-agents", label: "All agents", icon: Activity },
          { href: "/emails", label: "Emails", icon: Mail },
          { href: "/recharges", label: "Recharges", icon: Wallet },
          { href: "/platform", label: "Failed calls", icon: AlertCircle },
        ].map((a) => (
          <Button key={a.href} variant="outline" size="sm" className="h-8 text-xs cursor-pointer" asChild>
            <Link href={a.href}>
              <a.icon className="h-3.5 w-3.5 mr-1.5" aria-hidden />
              {a.label}
            </Link>
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <VobizWalletCard />
        <HealthLights />
      </div>

      <SpikeAlertsPanel />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <FailedStrip />
        <Card className="border-border shadow-none">
          <CardHeader className="pb-2 pt-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Recent calls
              </CardTitle>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="h-7 text-xs cursor-pointer" asChild>
                  <Link href="/platform">Live log →</Link>
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs cursor-pointer" asChild>
                  <Link href="/usage/history">Usage history →</Link>
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="flex items-end gap-3">
              <span className="font-mono font-bold text-2xl tabular-nums">{recentCallsCount.toLocaleString()}</span>
              <p className="text-xs text-muted-foreground pb-1">
                in the last 24 hours · lifetime success {successRate}%
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <RecentFailedUsers />

      <CallVolumeChart compact defaultPreset="month" showViewAll segment={segment} />

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
          Platform totals
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {metrics.map((metric) => (
            <Card key={metric.title} className="border-border bg-card shadow-none">
              <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
                <CardTitle className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.14em]">
                  {metric.title}
                </CardTitle>
                <metric.icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className="text-2xl font-bold font-mono tabular-nums">{metric.value}</div>
                <p className="text-xs text-muted-foreground mt-0.5">{metric.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
