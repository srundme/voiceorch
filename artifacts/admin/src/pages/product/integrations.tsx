import { Link } from "wouter";
import { format } from "date-fns";
import { SectionSubNav } from "@/components/section-subnav";
import { PRODUCT_TABS } from "@/lib/nav-config";
import { useProductIntegrations } from "@/hooks/use-admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

function StatusBadge({ connected, failed }: { connected: number; failed: number }) {
  if (connected === 0) return <Badge variant="outline" className="text-[10px]">None</Badge>;
  if (failed > 0) {
    return (
      <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/40 text-amber-600">
        <AlertTriangle className="h-3 w-3" /> {failed} issue{failed === 1 ? "" : "s"}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] gap-1 border-emerald-500/40 text-emerald-600">
      <CheckCircle2 className="h-3 w-3" /> Healthy
    </Badge>
  );
}

export default function ProductIntegrationsPage() {
  const { data, isLoading } = useProductIntegrations();
  const services = data?.services ?? [];

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={PRODUCT_TABS} />
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connected services across workspaces — Calendar, CRM, Sheets, WhatsApp, email.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Connections</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold font-mono">{isLoading ? "…" : data?.totals?.connected ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Failed / invalid</CardTitle></CardHeader>
          <CardContent className={`text-2xl font-bold font-mono ${(data?.totals?.failed ?? 0) > 0 ? "text-destructive" : ""}`}>
            {isLoading ? "…" : data?.totals?.failed ?? 0}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Users affected</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold font-mono">{isLoading ? "…" : data?.totals?.users ?? 0}</CardContent>
        </Card>
      </div>

      <div className="border border-border rounded-lg bg-card overflow-hidden overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-xs">Service</TableHead>
              <TableHead className="font-mono text-xs">Status</TableHead>
              <TableHead className="font-mono text-xs text-right">Connected</TableHead>
              <TableHead className="font-mono text-xs text-right">Failed</TableHead>
              <TableHead className="font-mono text-xs text-right">Users</TableHead>
              <TableHead className="font-mono text-xs text-right">Last sync</TableHead>
              <TableHead className="font-mono text-xs">Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground animate-pulse">Loading…</TableCell></TableRow>
            ) : services.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No integration data</TableCell></TableRow>
            ) : (
              services.map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link href={s.href || "/product/integrations"} className="font-medium text-primary hover:underline">
                      {s.label}
                    </Link>
                    {s.lastError && (
                      <div className="text-[11px] text-destructive truncate max-w-[240px] flex items-center gap-1 mt-0.5">
                        <XCircle className="h-3 w-3 shrink-0" />
                        {s.lastError}
                      </div>
                    )}
                  </TableCell>
                  <TableCell><StatusBadge connected={s.connected} failed={s.failed} /></TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{s.connected}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{s.failed}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{s.usersAffected}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground font-mono">
                    {s.lastSync ? format(new Date(s.lastSync), "MMM d HH:mm") : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.detail}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Google Calendar detail</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Per-user OAuth rows (scopes, token expiry) live on{" "}
          <Link href="/product/integrations/gcal" className="text-primary hover:underline">
            Calendar connections
          </Link>
          .
        </CardContent>
      </Card>
    </div>
  );
}
