import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Link } from "wouter";
import { useRecentRecharges } from "@/hooks/use-admin-api";
import { formatCentsToDollars } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IndianRupee, RefreshCw, Search } from "lucide-react";
import { SectionSubNav } from "@/components/section-subnav";
import { MONEY_TABS } from "@/lib/nav-config";

type Recharge = {
  id: number;
  userId: number;
  type: string;
  amountCents: number;
  description: string | null;
  status: string;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  createdAt: string;
  userEmail: string | null;
  userName: string | null;
  userClerkId: string | null;
  userIsTest: boolean | null;
};

export default function Recharges() {
  const [statusAll, setStatusAll] = useState(false);
  const [hideTest, setHideTest] = useState(true);
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, refetch, isFetching } = useRecentRecharges({
    limit: 300,
    status: statusAll ? "all" : "completed",
  });

  const rows: Recharge[] = data?.rows ?? [];

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (hideTest && r.userIsTest) return false;
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        (r.userEmail ?? "").toLowerCase().includes(q) ||
        (r.userName ?? "").toLowerCase().includes(q) ||
        (r.razorpayPaymentId ?? "").toLowerCase().includes(q) ||
        (r.userClerkId ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, hideTest, search]);

  const shownAmount = useMemo(
    () => filtered.reduce((sum, r) => sum + (r.amountCents ?? 0), 0),
    [filtered],
  );

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={MONEY_TABS} />
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <IndianRupee className="h-6 w-6 text-emerald-500" /> Recharges
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Recent wallet top-ups — who paid you and when.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Recharges shown</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{filtered.length.toLocaleString()}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total collected (shown)</CardDescription>
            <CardTitle className="text-2xl tabular-nums text-emerald-500">
              {formatCentsToDollars(shownAmount)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>All-time successful total</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {data?.totalAmountCents != null ? formatCentsToDollars(data.totalAmountCents) : "—"}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap space-y-0">
          <div>
            <CardTitle className="text-base">Recent recharges</CardTitle>
            <CardDescription>Newest first · auto-refreshes every 30s</CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search email, name, payment id…"
                className="h-8 w-56 pl-8 text-xs"
              />
            </div>
            <Button
              variant={hideTest ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setHideTest((v) => !v)}
            >
              {hideTest ? "Real users only" : "Incl. test users"}
            </Button>
            <Button
              variant={statusAll ? "outline" : "default"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setStatusAll((v) => !v)}
            >
              {statusAll ? "All statuses" : "Successful only"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment ID</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-destructive">
                    Failed to load recharges.
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No recharges found.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                      {format(new Date(r.createdAt), "MMM d, yyyy HH:mm")}
                    </TableCell>
                    <TableCell>
                      {r.userClerkId ? (
                        <Link
                          href={`/users/${r.userClerkId}`}
                          className="text-primary hover:underline text-xs block truncate max-w-[220px]"
                        >
                          {r.userEmail || r.userName || r.userClerkId}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {r.userEmail || r.userName || "—"}
                        </span>
                      )}
                      {r.userName && r.userEmail ? (
                        <span className="text-[10px] text-muted-foreground block truncate max-w-[220px]">
                          {r.userName}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize text-[10px]">
                        {r.type === "auto_topup" ? "auto top-up" : "top-up"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === "completed"
                            ? "default"
                            : r.status === "failed"
                              ? "destructive"
                              : "secondary"
                        }
                        className="capitalize text-[10px]"
                      >
                        {r.status || "unknown"}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className="text-[11px] font-mono text-muted-foreground truncate max-w-[160px]"
                      title={r.razorpayPaymentId || r.razorpayOrderId || undefined}
                    >
                      {r.razorpayPaymentId || r.razorpayOrderId || "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums text-emerald-400">
                      +{formatCentsToDollars(r.amountCents)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
