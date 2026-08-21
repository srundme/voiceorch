import { Link } from "wouter";
import { SectionSubNav } from "@/components/section-subnav";
import { OPERATIONS_TABS } from "@/lib/nav-config";
import { useOperationsHealth } from "@/hooks/use-admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, Activity } from "lucide-react";

function StatusIcon({ status }: { status: string }) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "warn") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  if (status === "error") return <XCircle className="h-4 w-4 text-red-500" />;
  return <HelpCircle className="h-4 w-4 text-muted-foreground" />;
}

function statusClass(status: string) {
  if (status === "ok") return "border-emerald-500/30 bg-emerald-500/5";
  if (status === "warn") return "border-amber-500/30 bg-amber-500/5";
  if (status === "error") return "border-red-500/30 bg-red-500/5";
  return "border-border";
}

export default function OperationsHealthPage() {
  const { data, isLoading, dataUpdatedAt } = useOperationsHealth();
  const components = data?.components ?? [];
  const overall = data?.status ?? "unknown";

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={OPERATIONS_TABS} />
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Platform Health</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live component status · refreshed every 15s
            {dataUpdatedAt ? ` · ${new Date(dataUpdatedAt).toLocaleTimeString()}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className={`gap-1.5 capitalize ${statusClass(overall)}`}>
            <StatusIcon status={overall} />
            {overall}
          </Badge>
          <Link href="/health" className="text-xs text-primary hover:underline">
            Full checklist →
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Overall</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-2 text-xl font-bold capitalize">
            <StatusIcon status={overall} /> {isLoading ? "…" : overall}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Active calls</CardTitle></CardHeader>
          <CardContent className="text-xl font-bold font-mono flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            {isLoading ? "…" : data?.activeCalls ?? 0}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Errors</CardTitle></CardHeader>
          <CardContent className="text-xl font-bold font-mono text-red-500">
            {isLoading ? "…" : components.filter((c: any) => c.status === "error").length}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Warnings</CardTitle></CardHeader>
          <CardContent className="text-xl font-bold font-mono text-amber-600">
            {isLoading ? "…" : components.filter((c: any) => c.status === "warn").length}
          </CardContent>
        </Card>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {isLoading
          ? Array.from({ length: 9 }).map((_, i) => (
              <Card key={i} className="animate-pulse h-32"><CardContent /></Card>
            ))
          : components.map((c: any) => (
              <Card key={c.id} className={`border ${statusClass(c.status)}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <StatusIcon status={c.status} />
                      {c.label}
                    </span>
                    <Badge variant="outline" className="text-[10px] uppercase">{c.status}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-xs text-muted-foreground">
                  <div>{c.detail ?? "—"}</div>
                  <div className="font-mono">
                    Latency {c.latencyMs != null ? `${c.latencyMs}ms` : "—"} · Errors {c.errorCount ?? 0}
                  </div>
                  {c.lastError && <div className="text-destructive truncate" title={c.lastError}>{c.lastError}</div>}
                  <div className="text-[10px]">
                    Last check {c.lastCheck ? new Date(c.lastCheck).toLocaleTimeString() : "—"}
                  </div>
                </CardContent>
              </Card>
            ))}
      </div>
    </div>
  );
}
