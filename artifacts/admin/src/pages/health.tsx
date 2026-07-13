import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
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
  GitBranch,
  GitCommit,
  ExternalLink,
  Rocket,
  Server,
  Layers,
  ChevronRight,
  RotateCcw,
  Info,
  Hourglass,
  Plus,
  Minus,
  FileText,
  Zap,
  Globe,
  Shield,
} from "lucide-react";
import { useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Deployment {
  sha: string;
  shortSha: string;
  message: string;
  fullMessage: string;
  author: string;
  date: string;
  url: string;
  status: "SUCCESS" | "FAILED" | "IN_PROGRESS";
  branch: string;
  environment: string;
}

interface DeploymentDetail extends Deployment {
  deployedAt: string | null;
  durationSec: number | null;
  likelyDeployed: boolean;
  migrationRan: boolean | null;
  rollbackAvailable: boolean;
  stats: { additions: number; deletions: number; total: number } | null;
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
  }>;
  repo: string;
}

interface HealthCheck {
  status: string;
  detail?: string;
}
interface HealthData {
  status: string;
  checks: Record<string, HealthCheck>;
  timestamp: string;
}

interface MigrationInfo {
  id: number;
  hash: string;
  createdAt: string;
  execTimeMs: number | null;
}
interface MigrationData {
  migrations: MigrationInfo[];
  latest: MigrationInfo | null;
  status?: "ok" | "pending" | "unavailable";
  pendingCount?: number | null;
  error?: string;
}

interface EnvInfo {
  nodeEnv: string;
  branch: string;
  commitSha: string | null;
  railwayProjectName: string | null;
  railwayEnvironment: string | null;
  deploymentSource: string;
  triggeredBy: string | null;
  repo: string;
  isSuperAdmin: boolean;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

interface DeploymentsPage {
  commits: Deployment[];
  hasNextPage: boolean;
}

function useDeployments(page: number) {
  return useQuery({
    queryKey: ["admin", "deployments", page],
    queryFn: () => adminFetch<DeploymentsPage>(`/deployments?page=${page}`),
    refetchInterval: 120_000,
  });
}

function useLatestDeployment() {
  return useQuery({
    queryKey: ["admin", "deployments", "latest"],
    queryFn: () => adminFetch<DeploymentDetail>("/deployments/latest"),
    refetchInterval: 60_000,
  });
}

function useDeploymentDetail(sha: string | null) {
  return useQuery({
    queryKey: ["admin", "deployments", sha],
    queryFn: () => adminFetch<DeploymentDetail>(`/deployments/${sha}`),
    enabled: !!sha,
  });
}

function useReleaseNotes(sha: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "release-notes", sha],
    queryFn: () => adminFetch<{ notes: string; cached: boolean }>(`/deployments/${sha}/release-notes`),
    enabled: !!sha && enabled,
    staleTime: 24 * 60 * 60 * 1000,
  });
}

function useMigrations() {
  return useQuery({
    queryKey: ["admin", "deployments", "migrations"],
    queryFn: () => adminFetch<MigrationData>("/deployments/migrations"),
    refetchInterval: 300_000,
  });
}

function useEnvInfo() {
  return useQuery({
    queryKey: ["admin", "env-info"],
    queryFn: () => adminFetch<EnvInfo>("/env-info"),
  });
}

function useHealthCheck() {
  return useQuery({
    queryKey: ["admin", "health"],
    queryFn: () => adminFetch<HealthData>("/health"),
    refetchInterval: 15000,
  });
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: string }) {
  if (status === "ok" || status === "SUCCESS") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "warn" || status === "IN_PROGRESS") return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
  return <XCircle className="h-4 w-4 text-red-500" />;
}

function StatusBadge({ status, label }: { status: string; label?: string }) {
  const styles =
    status === "ok" || status === "SUCCESS"
      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
      : status === "warn" || status === "IN_PROGRESS"
        ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
        : "bg-red-500/10 text-red-400 border-red-500/20";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${styles}`}>
      <StatusIcon status={status} />
      {label ?? status.toUpperCase()}
    </span>
  );
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-zinc-400">{icon}</span>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</h2>
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(ms / 60_000);
  if (ms < 60_000) return "just now";
  if (m === 1) return "1 minute ago";
  if (m < 60) return `${m} minutes ago`;
  if (m < 120) return "1 hour ago";
  if (m < 1440) return `${Math.floor(m / 60)} hours ago`;
  return `${Math.floor(m / 1440)} days ago`;
}

function formatDurationSec(sec: number): string {
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

// ── Module impact mapping ─────────────────────────────────────────────────────

const MODULE_MAP: Array<{ name: string; patterns: string[] }> = [
  { name: "Voice Infrastructure",    patterns: ["orchestration/", "services/pipeline", "services/session"] },
  { name: "Admin Portal",            patterns: ["routes/admin", "admin/src/"] },
  { name: "Scheduling",              patterns: ["routes/scheduling", "services/scheduling"] },
  { name: "Campaigns",               patterns: ["routes/campaign", "services/batch"] },
  { name: "Dashboard",               patterns: ["dashboard/src/", "routes/analytics", "routes/agents"] },
  { name: "Voice Analysis (ML)",     patterns: ["gender-service/", "voice-intel"] },
  { name: "Database / Migrations",   patterns: ["lib/db/", "drizzle/", "schema/"] },
  { name: "Knowledge Base",          patterns: ["routes/knowledge-base", "orchestration/kb"] },
  { name: "Providers / BYOP",        patterns: ["routes/providers", "services/minute-rates"] },
  { name: "Auth / Session",          patterns: ["routes/auth", "middlewares/", "lib/auth"] },
  { name: "Billing / Wallet",        patterns: ["routes/billing", "routes/wallet", "wallet"] },
];

function computeImpact(files: string[]): { affected: string[]; unaffected: string[] } {
  const affected = new Set<string>();
  for (const f of files) {
    for (const mod of MODULE_MAP) {
      if (mod.patterns.some((p) => f.includes(p))) {
        affected.add(mod.name);
      }
    }
  }
  const unaffected = MODULE_MAP.map((m) => m.name).filter((n) => !affected.has(n));
  return { affected: [...affected], unaffected };
}

// ── Latest Deployment Card ────────────────────────────────────────────────────

function LatestDeploymentCard() {
  const { data, isLoading, isError, refetch, isFetching } = useLatestDeployment();

  const ageMs = data ? Date.now() - new Date(data.date).getTime() : null;

  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-zinc-400" />
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Latest Deployment
          </CardTitle>
        </div>
        <div className="flex items-center gap-2">
          {data && <StatusBadge status={data.status} />}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border border-border hover:bg-muted transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ) : isError ? (
          <p className="text-xs text-red-400">Failed to reach GitHub API. Check GITHUB_PERSONAL_ACCESS_TOKEN.</p>
        ) : data ? (
          <div className="space-y-3">
            {/* Header row: message + deploy identifier + GitHub link */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{data.message}</p>
                  <span className="shrink-0 text-[10px] font-mono text-muted-foreground bg-muted/40 border border-border rounded px-1.5 py-0.5">
                    #{data.shortSha}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {data.author}
                  {" · "}{ageMs != null ? timeAgo(data.date) : ""}
                </p>
              </div>
              <a href={data.url} target="_blank" rel="noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>

            {/* Row 1: branch / env / duration / migration */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <InfoPill label="Branch" value={data.branch} />
              <InfoPill label="Environment" value={data.environment} />
              <InfoPill label="Duration" value={data.durationSec != null ? formatDurationSec(data.durationSec) : "—"} />
              <InfoPill label="Migration" value={data.migrationRan == null ? "Unknown" : data.migrationRan ? "Ran" : "None"} />
            </div>

            {/* Row 2: start time / end time / rollback availability */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <InfoPill label="Started" value={data.date ? new Date(data.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"} />
              <InfoPill label="Deployed At" value={data.deployedAt ? new Date(data.deployedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Deploying…"} />
              <div className={`rounded border px-2 py-1.5 ${data.rollbackAvailable ? "border-emerald-800 bg-emerald-950/30" : "border-border bg-muted/30"}`}>
                <div className="text-[10px] text-muted-foreground">Rollback</div>
                <div className={`text-xs font-medium mt-0.5 flex items-center gap-1 ${data.rollbackAvailable ? "text-emerald-400" : "text-muted-foreground"}`}>
                  {data.rollbackAvailable
                    ? <><CheckCircle2 className="h-3 w-3 shrink-0" /> Available</>
                    : <><AlertTriangle className="h-3 w-3 shrink-0" /> Unavailable</>}
                </div>
              </div>
            </div>

            {/* Railway live / deploying status bar */}
            <div className="rounded-md bg-muted/40 border border-border px-3 py-2 flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-mono">{data.repo} · {data.branch}</span>
              <span className={data.likelyDeployed ? "text-emerald-400" : "text-yellow-400"}>
                {data.likelyDeployed
                  ? `Railway live · deployed ${data.deployedAt ? timeAgo(data.deployedAt) : "recently"}`
                  : `Deploying… (Railway typically 2-3 min after push)`}
              </span>
            </div>

            {data.stats && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="text-emerald-400">+{data.stats.additions}</span>
                <span className="text-red-400">-{data.stats.deletions}</span>
                <span>{data.files.length} files changed</span>
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-muted/30 border border-border px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-xs font-medium mt-0.5 truncate">{value}</div>
    </div>
  );
}

// ── Production Status Card ────────────────────────────────────────────────────

function ProductionStatusCard() {
  const { data, isLoading, isError, refetch, isFetching } = useHealthCheck();
  const { data: envInfo } = useEnvInfo();
  const { data: latest } = useLatestDeployment();

  const overallStatus = data?.status ?? "unknown";
  const overallBadgeStatus = overallStatus === "ok" ? "SUCCESS" : overallStatus === "degraded" ? "IN_PROGRESS" : "FAILED";

  // Build the 5 required explicit indicators
  const dbCheck = data?.checks?.["db"];
  const redisCheck = data?.checks?.["redis"];
  const lastCheck = data?.timestamp ? new Date(data.timestamp).toLocaleTimeString() : null;
  const versionTag = envInfo?.commitSha ?? latest?.shortSha ?? null;

  type Indicator = {
    key: string;
    label: string;
    icon: React.ReactNode;
    status: string;
    detail: string;
    version?: string;
  };

  const indicators: Indicator[] = [
    {
      key: "backend",
      label: "Backend (API Server)",
      icon: <Server className="h-4 w-4" />,
      status: isError ? "error" : (overallStatus === "ok" ? "ok" : overallStatus === "degraded" ? "warn" : "error"),
      detail: lastCheck ? `Checked ${lastCheck}` : "Polling…",
      version: versionTag ?? undefined,
    },
    {
      key: "frontend",
      label: "Frontend (Dashboard)",
      icon: <Globe className="h-4 w-4" />,
      // Frontend is on the same Railway deploy as backend — treat as same status
      status: isError ? "warn" : (overallStatus === "ok" ? "ok" : overallStatus === "degraded" ? "warn" : "warn"),
      detail: "Same deployment as Backend",
      version: versionTag ?? undefined,
    },
    {
      key: "db",
      label: "Database",
      icon: <Database className="h-4 w-4" />,
      status: dbCheck?.status ?? (isLoading ? "warn" : "error"),
      detail: dbCheck?.detail ?? (isLoading ? "Checking…" : "Unavailable"),
    },
    {
      key: "redis",
      label: "Redis",
      icon: <Radio className="h-4 w-4" />,
      status: redisCheck?.status ?? (isLoading ? "warn" : "warn"),
      detail: redisCheck?.detail ?? (isLoading ? "Checking…" : "Not configured"),
    },
    {
      key: "railway",
      label: "Railway Deploy",
      icon: <Rocket className="h-4 w-4" />,
      status: latest == null ? "warn" : (latest.status === "SUCCESS" ? "ok" : latest.status === "FAILED" ? "error" : "warn"),
      detail: latest ? (latest.likelyDeployed ? `Deployed ${timeAgo(latest.date)}` : "Deploying…") : "Loading…",
      version: latest?.shortSha ?? undefined,
    },
  ];

  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-zinc-400" />
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Production Status
          </CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={overallBadgeStatus} label={overallStatus.toUpperCase()} />
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border border-border hover:bg-muted transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && !data ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (
          <div className="space-y-2">
            {indicators.map((ind) => (
              <div key={ind.key} className="flex items-center justify-between rounded bg-muted/20 border border-border px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{ind.icon}</span>
                  <div>
                    <span className="text-sm font-medium">{ind.label}</span>
                    {ind.version && (
                      <span className="ml-2 text-[10px] font-mono text-muted-foreground">v{ind.version}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-right">
                  <span className="text-xs text-muted-foreground truncate max-w-40 hidden sm:block">{ind.detail}</span>
                  <StatusBadge status={ind.status} />
                </div>
              </div>
            ))}
            <div className="mt-2 text-[10px] text-muted-foreground text-right">
              Last health check: {lastCheck ?? "—"}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Migration Status Card ─────────────────────────────────────────────────────

function MigrationStatusCard() {
  const { data, isLoading, isError } = useMigrations();
  const latest = data?.latest;
  const migStatus = data?.status ?? (isError ? "unavailable" : null);

  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-zinc-400" />
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Database Migration Status
          </CardTitle>
        </div>
        {!isLoading && migStatus && (
          <StatusBadge
            status={
              migStatus === "ok" ? "SUCCESS"
                : migStatus === "pending" ? "FAILED"
                  : "IN_PROGRESS"
            }
            label={
              migStatus === "ok" ? "IN SYNC"
                : migStatus === "pending" ? "PENDING"
                  : "UNAVAIL"
            }
          />
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : migStatus === "unavailable" || data?.error ? (
          <div className="flex items-center gap-2 text-yellow-400 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Migration table unavailable in this environment</span>
          </div>
        ) : migStatus === "pending" ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded bg-red-950/30 border border-red-800 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-300">
                  {data?.pendingCount != null && data.pendingCount > 0
                    ? `${data.pendingCount} migration${data.pendingCount > 1 ? "s" : ""} pending — not yet applied to this database`
                    : "Unapplied migrations detected"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Run <code className="font-mono bg-muted/40 px-1 rounded">pnpm --filter @workspace/db run push</code> or apply the migration SQL on the production DB.
                </p>
              </div>
            </div>
            {latest && (
              <div className="text-xs text-muted-foreground">
                Last applied: <span className="font-mono">{latest.hash.slice(0, 20)}…</span> · {timeAgo(latest.createdAt)}
              </div>
            )}
          </div>
        ) : latest ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium font-mono truncate">{latest.hash.slice(0, 32)}…</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Applied {timeAgo(latest.createdAt)}
                  {latest.execTimeMs != null && ` · exec: ${latest.execTimeMs}ms`}
                </p>
              </div>
              <StatusBadge status="SUCCESS" label="APPLIED" />
            </div>
            {data.migrations.length > 1 && (
              <div className="space-y-1">
                {data.migrations.slice(1, 4).map((m) => (
                  <div key={m.id} className="text-xs text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                    <span className="font-mono truncate">{m.hash.slice(0, 20)}…</span>
                    <span className="shrink-0">{new Date(m.createdAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No migrations found.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Deployment History Table + Drawer ─────────────────────────────────────────

function DeploymentImpact({ files }: { files: string[] }) {
  const { affected, unaffected } = computeImpact(files);
  if (files.length === 0) return <p className="text-xs text-muted-foreground">No file data available.</p>;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <p className="text-xs font-semibold text-emerald-400 mb-2">Affected Modules</p>
        {affected.length === 0
          ? <p className="text-xs text-muted-foreground">None detected</p>
          : (
            <ul className="space-y-1">
              {affected.map((m) => (
                <li key={m} className="flex items-center gap-2 text-xs">
                  <Zap className="h-3 w-3 text-emerald-500 shrink-0" />
                  {m}
                </li>
              ))}
            </ul>
          )}
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2">Unaffected Modules</p>
        <ul className="space-y-1">
          {unaffected.slice(0, 6).map((m) => (
            <li key={m} className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3 w-3 shrink-0" />
              {m}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ReleaseNotesSection({ sha }: { sha: string }) {
  const [enabled, setEnabled] = useState(false);
  const { data, isLoading, isError } = useReleaseNotes(sha, enabled);

  if (!enabled) {
    return (
      <button
        onClick={() => setEnabled(true)}
        className="text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
      >
        <Zap className="h-3 w-3" />
        Generate AI release notes
      </button>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    );
  }

  if (isError) {
    return <p className="text-xs text-red-400">Failed to generate release notes.</p>;
  }

  return (
    <div className="space-y-1">
      {data?.notes.split("\n").filter(Boolean).map((line, i) => (
        <p key={i} className="text-sm text-foreground/90 leading-relaxed">{line}</p>
      ))}
      {data?.cached && (
        <p className="text-[10px] text-muted-foreground mt-2">Cached result</p>
      )}
    </div>
  );
}

function DeploymentDrawer({ sha, open, onClose }: { sha: string | null; open: boolean; onClose: () => void }) {
  const { data, isLoading, isError } = useDeploymentDetail(open ? sha : null);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <GitCommit className="h-4 w-4" />
            Deployment Details
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : isError ? (
            <p className="text-sm text-red-400">Failed to load deployment details.</p>
          ) : data ? (
            <>
              {/* Header */}
              <div className="space-y-2">
                <div className="flex items-start gap-3 justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{data.message}</p>
                    <p className="text-xs text-muted-foreground mt-1 font-mono">{data.sha}</p>
                  </div>
                  <a href={data.url} target="_blank" rel="noreferrer"
                    className="shrink-0 text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs">
                    GitHub <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status={data.status} />
                  <InfoPill label="Author" value={data.author} />
                  <InfoPill label="Date" value={timeAgo(data.date)} />
                  {data.durationSec != null && <InfoPill label="Build time" value={formatDurationSec(data.durationSec)} />}
                </div>
                {data.fullMessage.includes("\n") && (
                  <div className="rounded bg-muted/30 border border-border p-3">
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{data.fullMessage}</p>
                  </div>
                )}
              </div>

              {/* AI Release Notes */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                  <Zap className="h-3 w-3" />
                  AI Release Notes
                </h3>
                <ReleaseNotesSection sha={data.sha} />
              </div>

              {/* Files changed */}
              {data.files.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                    <FileText className="h-3 w-3" />
                    Files Changed ({data.files.length})
                    {data.stats && (
                      <span className="font-normal normal-case text-[10px]">
                        <span className="text-emerald-400">+{data.stats.additions}</span>
                        <span className="text-muted-foreground"> / </span>
                        <span className="text-red-400">-{data.stats.deletions}</span>
                      </span>
                    )}
                  </h3>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {data.files.map((f) => (
                      <div key={f.filename} className="flex items-center justify-between text-xs rounded px-2 py-1 hover:bg-muted/30">
                        <span className="font-mono truncate flex-1 min-w-0">{f.filename}</span>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <span className="text-emerald-400 flex items-center"><Plus className="h-2.5 w-2.5" />{f.additions}</span>
                          <span className="text-red-400 flex items-center"><Minus className="h-2.5 w-2.5" />{f.deletions}</span>
                          <span className={`text-[10px] px-1 rounded ${
                            f.status === "added" ? "bg-emerald-500/20 text-emerald-400" :
                            f.status === "removed" ? "bg-red-500/20 text-red-400" :
                            "bg-muted text-muted-foreground"
                          }`}>{f.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Deployment Impact */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                  <Layers className="h-3 w-3" />
                  Deployment Impact
                </h3>
                <DeploymentImpact files={data.files.map((f) => f.filename)} />
              </div>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DeploymentHistoryTable() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch, isFetching } = useDeployments(page);
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function openDrawer(sha: string) {
    setSelectedSha(sha);
    setDrawerOpen(true);
  }

  function handleRefresh() {
    setPage(1);
    refetch();
  }

  return (
    <>
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-zinc-400" />
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Deployment History
            </CardTitle>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isFetching}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border border-border hover:bg-muted transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : isError ? (
            <div className="p-4 text-sm text-red-400">Failed to load deployment history.</div>
          ) : (
            <div className="divide-y divide-border">
              {/* Header */}
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>Description</span>
                <span className="hidden sm:block">Author</span>
                <span className="hidden md:block">Branch</span>
                <span>Status</span>
              </div>
              {(data?.commits ?? []).map((dep) => (
                <button
                  key={dep.sha}
                  onClick={() => openDrawer(dep.sha)}
                  className="w-full grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors items-center"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{dep.message}</p>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">
                      {dep.shortSha} · {timeAgo(dep.date)}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground hidden sm:block shrink-0">{dep.author}</span>
                  <span className="text-xs text-muted-foreground hidden md:block shrink-0 font-mono">{dep.branch}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <StatusBadge status={dep.status} />
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  </div>
                </button>
              ))}
              {/* Pagination controls */}
              <div className="flex items-center justify-between px-4 py-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1 || isFetching}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-border hover:bg-muted transition-colors disabled:opacity-40"
                >
                  ← Prev
                </button>
                <span className="text-xs text-muted-foreground">Page {page}</span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!data?.hasNextPage || isFetching}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-border hover:bg-muted transition-colors disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <DeploymentDrawer
        sha={selectedSha}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </>
  );
}

// ── Feature Rollout Tracker ───────────────────────────────────────────────────

const PENDING_FEATURES = [
  "Horizontal scaling (PM2 / clustering)",
  "WebSocket per-IP rate limiting",
  "Circuit breaker for provider APIs",
  "Revenue analytics dashboard",
  "Multi-region Railway deployment",
];

function FeatureRolloutTracker() {
  const { data, isLoading } = useDeployments(1);

  const deployedToday = (data?.commits ?? [])
    .filter((d) => {
      const ms = Date.now() - new Date(d.date).getTime();
      return ms < 24 * 60 * 60 * 1000;
    })
    .flatMap((d) => {
      const msg = d.message;
      if (/^feat[(:]/i.test(msg)) return [msg.replace(/^feat[(:]\s*/i, "")];
      if (/^fix[(:]/i.test(msg)) return [`Fix: ${msg.replace(/^fix[(:]\s*/i, "")}`];
      if (/^add[s]?\s+/i.test(msg)) return [msg];
      return [];
    })
    .slice(0, 8);

  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-zinc-400" />
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Feature Rollout Tracker
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold mb-2">Deployed Today</p>
            {isLoading ? (
              <div className="space-y-1">{[1, 2].map((i) => <Skeleton key={i} className="h-5 w-3/4" />)}</div>
            ) : deployedToday.length === 0 ? (
              <p className="text-xs text-muted-foreground">No feature commits in the last 24 hours.</p>
            ) : (
              <ul className="space-y-1.5">
                {deployedToday.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider text-yellow-400 font-semibold mb-2">Pending Deployment</p>
            <ul className="space-y-1.5">
              {PENDING_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Hourglass className="h-3.5 w-3.5 text-yellow-500 mt-0.5 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Environment Information ───────────────────────────────────────────────────

function EnvironmentInfoCard() {
  const { data, isLoading, isError } = useEnvInfo();

  const envRows = data ? [
    { label: "Environment",       value: data.nodeEnv },
    { label: "Branch",            value: data.branch },
    { label: "Commit SHA",        value: data.commitSha ?? "—" },
    { label: "Deployment Source", value: data.deploymentSource },
    { label: "Railway Project",   value: data.railwayProjectName ?? "—" },
    { label: "Railway Env",       value: data.railwayEnvironment ?? "—" },
    { label: "Triggered By",      value: data.triggeredBy ?? "—" },
    { label: "Repository",        value: data.repo },
  ] : [];

  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-zinc-400" />
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Environment Information
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
        ) : isError ? (
          <p className="text-xs text-red-400">Failed to load environment info.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {envRows.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between text-xs border-b border-border/50 py-1.5">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono font-medium">{value}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Rollback Center ───────────────────────────────────────────────────────────

function RollbackCenter() {
  const { data } = useDeployments(1);
  const { data: envInfo } = useEnvInfo();
  const [showModal, setShowModal] = useState(false);

  const current = data?.commits?.[0];
  const previous = data?.commits?.[1];
  const isSuperAdmin = envInfo?.isSuperAdmin ?? false;

  return (
    <>
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-zinc-400" />
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Rollback Center
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div className="rounded bg-muted/30 border border-border p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Current Version</p>
              {current ? (
                <>
                  <p className="text-sm font-medium truncate">{current.message}</p>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">{current.shortSha} · {timeAgo(current.date)}</p>
                </>
              ) : (
                <Skeleton className="h-8 w-full" />
              )}
            </div>
            <div className="rounded bg-muted/30 border border-border p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Previous Version</p>
              {previous ? (
                <>
                  <p className="text-sm font-medium truncate">{previous.message}</p>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">{previous.shortSha} · {timeAgo(previous.date)}</p>
                </>
              ) : (
                <Skeleton className="h-8 w-full" />
              )}
            </div>
          </div>

          {isSuperAdmin ? (
            <>
              <button
                onClick={() => setShowModal(true)}
                disabled={!previous}
                className="inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RotateCcw className="h-4 w-4" />
                Rollback To Previous Version
              </button>
              <p className="text-xs text-muted-foreground mt-2">
                Super-admin action. Opens Railway rollback instructions.
              </p>
            </>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Shield className="h-3.5 w-3.5 shrink-0" />
              Rollback requires super-admin access. Contact your platform admin.
            </div>
          )}
        </CardContent>
      </Card>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-background border border-border rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <RotateCcw className="h-5 w-5 text-red-400" />
              <h2 className="text-lg font-semibold">Rollback to Previous Version</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Automated rollback is not yet wired to the Railway API. To rollback:
            </p>
            <ol className="text-sm space-y-2 text-foreground mb-6 list-decimal list-inside">
              <li>
                Open your{" "}
                <a href="https://railway.app/dashboard" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-1">
                  Railway Dashboard <ExternalLink className="h-3 w-3" />
                </a>
              </li>
              <li>Select the VoiceOrch service</li>
              <li>Go to Deployments → find the previous build</li>
              <li>Click "Redeploy" on that deployment</li>
            </ol>
            {previous && (
              <div className="rounded bg-muted/30 border border-border p-3 mb-4 text-xs text-muted-foreground">
                Target: <span className="font-mono">{previous.shortSha}</span> — {previous.message}
              </div>
            )}
            <div className="flex justify-end">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded text-sm font-medium border border-border hover:bg-muted transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Health Checklist (kept) ───────────────────────────────────────────────────

function ChecklistItem({ label, status, note }: { label: string; status: "implemented" | "pending"; note?: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5">
        {status === "implemented"
          ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          : <AlertTriangle className="h-4 w-4 text-yellow-500" />}
      </div>
      <div>
        <div className="text-sm font-medium">{label}</div>
        {note && <div className="text-xs text-muted-foreground mt-0.5">{note}</div>}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HealthChecklistPage() {
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const { refetch: refetchHealth } = useHealthCheck();

  function handleRefresh() {
    refetchHealth();
    setLastRefreshed(new Date());
  }

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deployment &amp; Operations Center</h1>
          <p className="text-sm text-muted-foreground mt-1">Real-time deployment status, production health, and rollback controls</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground hidden sm:flex items-center gap-1">
            <Clock className="h-3 w-3" />
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

      {/* Section 1 — Deployment */}
      <div>
        <SectionHeader icon={<Rocket className="h-3.5 w-3.5" />} title="Active Deployment" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <LatestDeploymentCard />
          <MigrationStatusCard />
        </div>
      </div>

      {/* Section 2 — Production Health */}
      <div>
        <SectionHeader icon={<Activity className="h-3.5 w-3.5" />} title="Production Health" />
        <ProductionStatusCard />
      </div>

      {/* Section 3 — Deployment History */}
      <div>
        <SectionHeader icon={<GitBranch className="h-3.5 w-3.5" />} title="Deployment History" />
        <DeploymentHistoryTable />
      </div>

      {/* Section 4 — Feature Rollout */}
      <div>
        <SectionHeader icon={<Layers className="h-3.5 w-3.5" />} title="Feature Rollout Tracker" />
        <FeatureRolloutTracker />
      </div>

      {/* Section 5 — Rollback + Environment (side by side) */}
      <div>
        <SectionHeader icon={<Shield className="h-3.5 w-3.5" />} title="Operations" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <RollbackCenter />
          <EnvironmentInfoCard />
        </div>
      </div>

      {/* Section 6 — Production Readiness Checklist */}
      <div>
        <SectionHeader icon={<CheckCircle2 className="h-3.5 w-3.5" />} title="Production Readiness Checklist" />
        <Card className="border-border">
          <CardContent className="pt-5">
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
    </div>
  );
}
