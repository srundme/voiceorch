import { useFinanceSummary, useFinanceTransactions } from "@/hooks/use-admin-api";
import { formatCentsToDollars } from "@/lib/api";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";

export default function Finance() {
  const { data: summary, isLoading: loadingSummary, isError: summaryError, error: summaryErr } = useFinanceSummary();
  const { data: transactions, isLoading: loadingTx, isError: txError, error: txErr } = useFinanceTransactions();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Financial Overview</h1>
      </div>

      {summaryError && (
        <p className="text-sm text-destructive">Failed to load summary: {(summaryErr as Error)?.message}</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Total Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono">
              {loadingSummary ? "..." : formatCentsToDollars(summary?.totalRevenueCents || 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Lifetime</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Monthly Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono">
              {loadingSummary ? "..." : formatCentsToDollars(summary?.monthlyRevenueCents || 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Current month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Total Topups
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono">
              {loadingSummary ? "..." : summary?.totalTopups?.toLocaleString() || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Successful transactions</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Unique Payers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono">
              {loadingSummary ? "..." : summary?.uniquePayingUsers?.toLocaleString() || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Users with &gt;0 topups</p>
          </CardContent>
        </Card>
      </div>

      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <div className="p-4 border-b border-border bg-muted/20 font-medium">All Transactions</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadingTx ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground animate-pulse">
                  Loading transactions...
                </TableCell>
              </TableRow>
            ) : txError ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-destructive">
                  Failed to load transactions: {(txErr as Error)?.message}
                </TableCell>
              </TableRow>
            ) : transactions?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No transactions found
                </TableCell>
              </TableRow>
            ) : (
              transactions?.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {format(new Date(tx.createdAt), "MMM d, yyyy HH:mm")}
                  </TableCell>
                  <TableCell>
                    {tx.userClerkId ? (
                      <Link href={`/users/${tx.userClerkId}`} className="text-primary hover:underline block truncate max-w-[200px]">
                        {tx.userEmail || tx.userId}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground truncate max-w-[200px] block">{tx.userEmail || tx.userId}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize text-[10px]">{tx.type}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge 
                      variant={tx.status === "success" ? "default" : tx.status === "failed" ? "destructive" : "secondary"} 
                      className="capitalize text-[10px]"
                    >
                      {tx.status || 'unknown'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs truncate max-w-[250px]" title={tx.description || tx.razorpayPaymentId}>
                    {tx.description || (tx.razorpayPaymentId ? `Ref: ${tx.razorpayPaymentId}` : "-")}
                  </TableCell>
                  <TableCell className={`text-right font-mono tabular-nums ${tx.amountCents > 0 ? 'text-primary' : tx.amountCents < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {tx.amountCents > 0 ? '+' : ''}{formatCentsToDollars(tx.amountCents)}
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
