import { useCustomerWorkspaces } from "@/hooks/use-admin-api";
import { useDateRange } from "@/hooks/use-date-range";
import { DateRangeBar } from "@/components/date-range-bar";
import { SectionSubNav } from "@/components/section-subnav";
import { CUSTOMERS_TABS } from "@/lib/nav-config";
import { formatCentsToDollars } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function WorkspacesPage() {
  const range = useDateRange({ preset: "last30", compare: "none" });
  const { data, isLoading, dataUpdatedAt } = useCustomerWorkspaces(range.fromParam, range.toParam);
  const rows = data?.workspaces ?? [];

  const totals = rows.reduce(
    (acc: { revenue: number; cost: number; calls: number; minutes: number }, r: any) => ({
      revenue: acc.revenue + Number(r.revenuePaise ?? 0),
      cost: acc.cost + Number(r.costPaise ?? 0),
      calls: acc.calls + Number(r.calls ?? 0),
      minutes: acc.minutes + Number(r.minutes ?? 0),
    }),
    { revenue: 0, cost: 0, calls: 0, minutes: 0 },
  );

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={CUSTOMERS_TABS} />
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workspaces</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data?.note ?? "Owner accounts as workspaces"} · usage in selected range
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!rows.length}
          onClick={() =>
            downloadCsv(
              `workspaces-${Date.now()}`,
              ["workspaceId", "owner", "email", "agents", "calls", "minutes", "revenue", "cost", "profit", "wallet"],
              rows.map((w: any) => [w.workspaceId, w.ownerName, w.ownerEmail, w.agents, w.calls, w.minutes, w.revenuePaise, w.costPaise, w.profitPaise, w.walletPaise]),
            )
          }
        >
          <Download className="h-3.5 w-3.5" /> CSV
        </Button>
      </div>
      <DateRangeBar range={range} showCompare={false} updatedAt={dataUpdatedAt ? new Date(dataUpdatedAt) : null} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Workspaces</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold font-mono">{isLoading ? "…" : rows.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Revenue</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold font-mono">{isLoading ? "…" : formatCentsToDollars(totals.revenue)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Profit</CardTitle></CardHeader>
          <CardContent className={`text-2xl font-bold font-mono ${totals.revenue - totals.cost < 0 ? "text-destructive" : "text-emerald-600"}`}>
            {isLoading ? "…" : formatCentsToDollars(totals.revenue - totals.cost)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Minutes</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold font-mono">{isLoading ? "…" : Math.round(totals.minutes).toLocaleString()}</CardContent>
        </Card>
      </div>

      <div className="border border-border rounded-lg bg-card overflow-hidden overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-xs">Workspace / Owner</TableHead>
              <TableHead className="font-mono text-xs">Status</TableHead>
              <TableHead className="font-mono text-xs text-right">Agents</TableHead>
              <TableHead className="font-mono text-xs text-right">Calls</TableHead>
              <TableHead className="font-mono text-xs text-right">Minutes</TableHead>
              <TableHead className="font-mono text-xs text-right">Revenue</TableHead>
              <TableHead className="font-mono text-xs text-right">Cost</TableHead>
              <TableHead className="font-mono text-xs text-right">Profit</TableHead>
              <TableHead className="font-mono text-xs text-right">Wallet</TableHead>
              <TableHead className="font-mono text-xs text-right">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10} className="h-24 text-center text-muted-foreground animate-pulse">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="h-24 text-center text-muted-foreground">No workspaces</TableCell></TableRow>
            ) : (
              rows.map((w: any) => (
                <TableRow key={w.workspaceId}>
                  <TableCell>
                    <Link href={`/users/${w.workspaceId}`} className="block">
                      <div className="font-medium text-primary hover:underline truncate max-w-[240px]">
                        {w.ownerName || w.ownerEmail || w.workspaceId}
                      </div>
                      <div className="text-xs text-muted-foreground truncate max-w-[240px]">{w.ownerEmail}</div>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={w.status === "active" ? "default" : "outline"} className="text-[10px] capitalize">
                      {w.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{w.agents}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{w.calls}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{Math.round(w.minutes ?? 0)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatCentsToDollars(w.revenuePaise ?? 0)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">{formatCentsToDollars(w.costPaise ?? 0)}</TableCell>
                  <TableCell className={`text-right font-mono tabular-nums ${(w.profitPaise ?? 0) < 0 ? "text-destructive" : "text-emerald-600"}`}>
                    {formatCentsToDollars(w.profitPaise ?? 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatCentsToDollars(w.walletPaise ?? 0)}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {w.createdAt ? format(new Date(w.createdAt), "MMM d, yyyy") : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
