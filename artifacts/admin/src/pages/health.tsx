import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Database,
  Radio,
  Phone,
  BarChart3,
  Clock,
} from "lucide-react";
import { useState } from "react";

interface HealthCheck {
  status: string;
  detail?: string;
}

interface HealthData {
  status: string;
  checks: Record<string, HealthCheck>;
  timestamp: string;
}

function useHealthCheck() {
  return useQuery({
    queryKey: ["admin", "health"],
    queryFn: () => adminFetch<HealthData>("/health"),
    refetchInterval: 15000,
  });
}

function StatusIcon({ status }: { status: string }) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "warn") return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
  return <XCircle className="h-4 w-4 text-red-500" />;
}

function StatusBadge({ status }: { status: string }) {
  const styles =
    status === "ok"
      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
      : status === "warn"
        ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
        : "bg-red-500/10 text-red-400 border-red-500/20";

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${styles}`}>
      <StatusIcon status={status} />
      {status.toUpperCase()}
    </span>
  );
}

const CHECK_ICONS: Record<string, React.ReactNode> = {
  db: <Database className="h-4 w-4" />,
  redis: <Radio className="h-4 w-4" />,
  activeCalls: <Phone className="h-4 w-4" />,
  campaignConcurrency: <BarChart3 className="h-4 w-4" />,
  load: <Activity className="h-4 w-4" />,
};

const CHECK_LABELS: Record<string, string> = {
  db: "Database",
  redis: "Redis",
  activeCalls: "Active Calls",
  campaignConcurrency: "Campaign Concurrency",
  load: "System Load",
};

export default function HealthChecklistPage() {
  const { data, isLoading, isError, refetch } = useHealthCheck();
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  function handleRefresh() {
    refetch();
    setLastRefreshed(new Date());
  }

  const overallStatus = data?.status ?? "unknown";
  const overallBg =
    overallStatus === "ok"
      ? "bg-emerald-500/10 border-emerald-500/20"
      : overallStatus === "degraded"
        ? "bg-yellow-500/10 border-yellow-500/20"
        : "bg-red-500/10 border-red-500/20";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Health Checklist</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            <Clock className="h-3 w-3 inline mr-1" />
            Last check: {lastRefreshed.toLocaleTimeString()}
          </span>
          <button
            onClick={handleRefresh}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border border-border hover:bg-muted transition-colors"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>
      </div>

      {/* Overall status card */}
      <Card className={`border ${overallBg}`}>
        <CardContent className="p-5">
          <div className="flex items-center gap-3">
            <StatusIcon status={overallStatus} />
            <div>
              <div className="text-sm font-semibold">Overall: {overallStatus.toUpperCase()}</div>
              <div className="text-xs text-muted-foreground">
                {data?.timestamp ? new Date(data.timestamp).toLocaleString() : "No data yet"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Individual checks */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isLoading ? (
          <div className="col-span-2 text-center py-8 text-muted-foreground animate-pulse">
            Running health checks...
          </div>
        ) : isError ? (
          <div className="col-span-2 text-center py-8 text-red-400">
            Failed to load health data. Check API connection.
          </div>
        ) : (
          Object.entries(data?.checks ?? {}).map(([key, check]) => (
            <Card key={key} className="border-border">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{CHECK_ICONS[key] ?? <Activity className="h-4 w-4" />}</span>
                  <CardTitle className="text-sm font-medium">
                    {CHECK_LABELS[key] ?? key}
                  </CardTitle>
                </div>
                <StatusBadge status={check.status} />
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">{check.detail ?? "No additional details"}</p>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Checklist summary */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium uppercase tracking-wider">
            Production Readiness Checklist
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <ChecklistItem label="Campaign concurrency cap" status="implemented" />
            <ChecklistItem label="HTTP rate limiting (IP + Auth)" status="implemented" />
            <ChecklistItem label="Deep health endpoint (/api/healthz/deep)" status="implemented" />
            <ChecklistItem label="DB connection pool (max 50)" status="implemented" />
            <ChecklistItem label="Campaign call limit per campaign (default 20)" status="implemented" />
            <ChecklistItem label="Auto-scheduler with sliding window" status="implemented" />
            <ChecklistItem label="Rate limit exempt paths (healthz, webhooks)" status="implemented" />
            <ChecklistItem label="Horizontal scaling (load balancer)" status="pending" note="Single instance. Add PM2 / clustering for > 100 concurrent calls" />
            <ChecklistItem label="WebSocket rate limiting" status="pending" note="Add per-IP connection cap on WebSocket upgrade" />
            <ChecklistItem label="Circuit breaker for provider APIs" status="pending" note="Add retry + fallback for LLM / TTS provider failures" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ChecklistItem({
  label,
  status,
  note,
}: {
  label: string;
  status: "implemented" | "pending";
  note?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5">
        {status === "implemented" ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-yellow-500" />
        )}
      </div>
      <div>
        <div className="text-sm font-medium">{label}</div>
        {note && <div className="text-xs text-muted-foreground mt-0.5">{note}</div>}
      </div>
    </div>
  );
}
