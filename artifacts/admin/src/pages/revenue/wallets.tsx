import { Link } from "wouter";
import { format } from "date-fns";
import { SectionSubNav } from "@/components/section-subnav";
import { MONEY_TABS } from "@/lib/nav-config";
import { useRevenueWallets } from "@/hooks/use-admin-api";
import { formatCentsToDollars } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadCsv } from "@/lib/csv";
import { Download, Search } from "lucide-react";
import { useMemo, useState } from "react";

export default function WalletsPage() {
  const { data, isLoading } = useRevenueWallets();
  const [q, setQ] = useState("");
  const wallets = data?.wallets ?? [];
  const filtered = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return wallets;
    return wallets.filter((w: any) => {
      const hay = `${w.email ?? ""} ${w.name ?? ""} ${w.clerkId ?? ""}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [wallets, q]);

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={MONEY_TABS} />
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Wallets</h1>
          <p className="text-sm text-muted-foreground mt-1">Customer wallet balances and liability</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!filtered.length}
          onClick={() =>
            downloadCsv(
              `wallets-${Date.now()}`,
              ["email", "name", "clerkId", "balancePaise", "status", "txCount", "lastTx"],
              filtered.map((w: any) => [w.email, w.name, w.clerkId, w.walletBalanceCents, w.status, w.txCount, w.lastTransactionAt]),
            )
          }
        >
          <Download className="h-3.5 w-3.5" /> CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Wallets</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold font-mono">{isLoading ? "…" : data?.kpis?.wallets ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Liability</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold font-mono">{isLoading ? "…" : formatCentsToDollars(data?.kpis?.totalLiabilityPaise ?? 0)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Negative</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold font-mono text-destructive">{isLoading ? "…" : data?.kpis?.negativeBalances ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Zero</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold font-mono">{isLoading ? "…" : data?.kpis?.zeroBalances ?? 0}</CardContent>
        </Card>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search email, name, id…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="border border-border rounded-lg bg-card overflow-hidden overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-xs">User</TableHead>
              <TableHead className="font-mono text-xs">Status</TableHead>
              <TableHead className="font-mono text-xs text-right">Balance</TableHead>
              <TableHead className="font-mono text-xs text-right">Txns</TableHead>
              <TableHead className="font-mono text-xs text-right">Last txn</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground animate-pulse">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No wallets</TableCell></TableRow>
            ) : (
              filtered.map((w: any) => (
                <TableRow key={w.clerkId}>
                  <TableCell>
                    <Link href={`/users/${w.clerkId}`} className="block">
                      <div className="font-medium text-primary hover:underline">{w.email || w.name || w.clerkId}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">{w.clerkId}</div>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] capitalize">{w.status}</Badge>
                    {w.isTest && <Badge variant="secondary" className="ml-1 text-[10px]">Test</Badge>}
                  </TableCell>
                  <TableCell className={`text-right font-mono ${(w.walletBalanceCents ?? 0) < 0 ? "text-destructive" : ""}`}>
                    {formatCentsToDollars(w.walletBalanceCents ?? 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono">{w.txCount ?? 0}</TableCell>
                  <TableCell className="text-right text-xs font-mono text-muted-foreground">
                    {w.lastTransactionAt ? format(new Date(w.lastTransactionAt), "MMM d, yyyy") : "—"}
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
