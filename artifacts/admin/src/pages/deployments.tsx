import { useState } from "react";
import { useDeployments } from "@/hooks/use-admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow, format } from "date-fns";
import { RefreshCw, Rocket, XCircle, AlertTriangle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionSubNav } from "@/components/section-subnav";
import { OPERATIONS_TABS } from "@/lib/nav-config";

/* ── types ─────────────────────────────────────────────────────────────── */

interface DeploymentEvent {
  id: number;
  railwayDeployId: string | null;
  serviceName: string | null;
  environment: string | null;
  status: string;
  deployUrl: string | null;
  commitMessage: string | null;
  commitHash: string | null;
  triggeredBy: string | null;
  createdAt: string;
}

/* ── status helpers ─────────────────────────────────────────────────────── */

const STATUS_META: Record<string, { label: string; icon: React.ReactNode; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  SUCCESS:           { label: "Success",    icon: <CheckCircle2 className="h-3 w-3" />, variant: "default" },
  DEPLOYING:         { label: "Deploying",  icon: <Loader2 className="h-3 w-3 animate-spin" />, variant: "secondary" },
  BUILDING:          { label: "Building",   icon: <Loader2 className="h-3 w-3 animate-spin" />, variant: "secondary" },
  FAILED:            { label: "Failed",     icon: <XCircle className="h-3 w-3" />, variant: "destructive" },
  CRASHED:           { label: "Crashed",    icon: <AlertTriangle className="h-3 w-3" />, variant: "destructive" },
  REMOVED:           { label: "Removed",    icon: <XCircle className="h-3 w-3" />, variant: "outline" },
  WAITING:           { label: "Waiting",    icon: <Clock className="h-3 w-3" />, variant: "outline" },
  SKIPPED:           { label: "Skipped",    icon: <Clock className="h-3 w-3" />, variant: "outline" },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, icon: null, variant: "outline" as const };
  return (
    <Badge variant={m.variant} className="flex items-center gap-1 font-mono text-[11px]">
      {m.icon}{m.label}
    </Badge>
  );
}

/* ── summary cards ──────────────────────────────────────────────────────── */

function SummaryCards({ events }: { events: DeploymentEvent[] }) {
  const total     = events.length;
  const successes = events.filter(e => e.status === "SUCCESS").length;
  const failures  = events.filter(e => ["FAILED","CRASHED"].includes(e.status)).length;
  const inFlight  = events.filter(e => ["DEPLOYING","BUILDING","WAITING"].includes(e.status)).length;
  const rate      = total ? Math.round((successes / total) * 100) : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {[
        { label: "Total Events",    value: total,     color: "text-foreground",  icon: <Rocket className="h-5 w-5" /> },
        { label: "Successful",      value: successes, color: "text-emerald-600", icon: <CheckCircle2 className="h-5 w-5" /> },
        { label: "Failed / Crashed",value: failures,  color: failures > 0 ? "text-red-600" : "text-foreground", icon: <XCircle className="h-5 w-5" /> },
        { label: "Success Rate",    value: `${rate}%`,color: rate >= 80 ? "text-emerald-600" : "text-amber-600", icon: <Rocket className="h-5 w-5" /> },
      ].map((c, i) => (
        <Card key={i}>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{c.label}</p>
                <p className={`text-2xl font-bold font-mono ${c.color}`}>{c.value}</p>
              </div>
              <div className="text-muted-foreground/40">{c.icon}</div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ── service filter ─────────────────────────────────────────────────────── */

/* ── page ───────────────────────────────────────────────────────────────── */

export default function DeploymentsPage() {
  const [serviceFilter, setServiceFilter] = useState("all");
  const [statusFilter,  setStatusFilter]  = useState("all");

  const { data: events = [], isLoading, refetch, isFetching } = useDeployments();

  const services = Array.from(new Set(events.map(e => e.serviceName).filter(Boolean))) as string[];
  const statuses  = Array.from(new Set(events.map(e => e.status)));

  const filtered = events.filter(e =>
    (serviceFilter === "all" || e.serviceName === serviceFilter) &&
    (statusFilter  === "all" || e.status === statusFilter)
  );

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={OPERATIONS_TABS} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deployments</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Current version history · Railway events · auto-refreshes every 30s
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Setup hint if empty */}
      {!isLoading && events.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center space-y-3">
            <Rocket className="h-10 w-10 mx-auto text-muted-foreground/40" />
            <p className="font-medium">No deployment events yet</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Add a Railway webhook pointing to{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                https://app.snapserve.ai/api/hooks/railway
              </code>{" "}
              with the secret header{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                X-Railway-Token: {"<RAILWAY_WEBHOOK_SECRET>"}
              </code>
              . Select any event types you want to track.
            </p>
          </CardContent>
        </Card>
      )}

      {events.length > 0 && <SummaryCards events={events} />}

      {/* Filters */}
      {events.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center text-sm">
          <span className="text-muted-foreground">Service:</span>
          {["all", ...services].map(s => (
            <button key={s} onClick={() => setServiceFilter(s)}
              className={`px-3 py-1 rounded-full border text-xs font-medium transition-colors ${
                serviceFilter === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"
              }`}>
              {s === "all" ? "All" : s}
            </button>
          ))}
          <span className="text-muted-foreground ml-3">Status:</span>
          {["all", ...statuses].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-full border text-xs font-medium transition-colors ${
                statusFilter === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"
              }`}>
              {s === "all" ? "All" : s}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-auto max-h-[640px]">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Commit</TableHead>
                <TableHead>Triggered By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">No events match your filters</TableCell>
                </TableRow>
              ) : filtered.map(ev => (
                <TableRow key={ev.id} className="hover:bg-muted/30">
                  <TableCell className="text-xs whitespace-nowrap">
                    <span className="text-muted-foreground" title={format(new Date(ev.createdAt), "PPpp")}>
                      {formatDistanceToNow(new Date(ev.createdAt), { addSuffix: true })}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{ev.serviceName ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{ev.environment ?? "—"}</TableCell>
                  <TableCell><StatusBadge status={ev.status} /></TableCell>
                  <TableCell className="max-w-[280px]">
                    {ev.commitMessage ? (
                      <div>
                        <p className="text-xs truncate">{ev.commitMessage}</p>
                        {ev.commitHash && (
                          <p className="font-mono text-[10px] text-muted-foreground mt-0.5">{ev.commitHash.slice(0, 7)}</p>
                        )}
                      </div>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{ev.triggeredBy ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Setup instructions box */}
      {events.length > 0 && (
        <Card className="bg-muted/30">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Webhook setup</CardTitle>
          </CardHeader>
          <CardContent className="pb-4 text-xs space-y-1 text-muted-foreground">
            <p>URL: <code className="bg-background px-1.5 py-0.5 rounded">https://app.snapserve.ai/api/hooks/railway</code></p>
            <p>Header: <code className="bg-background px-1.5 py-0.5 rounded">X-Railway-Token: {"<RAILWAY_WEBHOOK_SECRET env var>"}</code></p>
            <p>Recommend events: Deployment Deployed, Deployment Failed, Deployment Crashed, Deployment Building</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
