import { Link } from "wouter";
import { useProductProviders, useInfraHealth } from "@/hooks/use-admin-api";
import { SectionSubNav } from "@/components/section-subnav";
import { PRODUCT_TABS } from "@/lib/nav-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

export default function ProvidersControlPage() {
  const { data, isLoading } = useProductProviders();
  const { data: health } = useInfraHealth();

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={PRODUCT_TABS} />
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Providers</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Infrastructure providers linked to Managed Keys. Usage is last 7 days from usage_events.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">Infra status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold capitalize">{health?.summary?.status ?? "—"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">Healthy keys</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold font-mono">{health?.summary?.healthy ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">Failed keys</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold font-mono">{health?.summary?.failed ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">Providers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold font-mono">{data?.providers?.length ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Managed key</TableHead>
                <TableHead>Affects</TableHead>
                <TableHead className="text-right">Events 7d</TableHead>
                <TableHead className="text-right">Fail %</TableHead>
                <TableHead className="text-right">Latency</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.providers ?? []).map((p: any) => (
                <TableRow key={p.key}>
                  <TableCell className="font-medium">{p.label}</TableCell>
                  <TableCell className="uppercase text-xs">{p.service}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {p.configured ? "Configured" : "Missing"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px]">
                    {(p.affects ?? []).join(" · ")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.usage7d?.events ?? 0}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.usage7d?.failureRatePct ?? 0}%</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.usage7d?.avgLatencyMs != null ? `${p.usage7d.avgLatencyMs} ms` : "—"}
                  </TableCell>
                  <TableCell>
                    <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                      <Link href="/managed-keys">Keys</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && !(data?.providers?.length) && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                    No providers listed.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
