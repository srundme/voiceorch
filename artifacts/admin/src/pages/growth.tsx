import { useGrowthFunnel, useGrowthTopUsers, useGrowthInactive } from "@/hooks/use-admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "wouter";
import { formatCentsToDollars } from "@/lib/api";
import { format } from "date-fns";

export default function Growth() {
  const { data: funnel, isLoading: loadingFunnel, isError: funnelError, error: funnelErr } = useGrowthFunnel();
  const { data: topUsers, isLoading: loadingTop, isError: topError, error: topErr } = useGrowthTopUsers();
  const { data: inactiveUsers, isLoading: loadingInactive, isError: inactiveError, error: inactiveErr } = useGrowthInactive();

  const funnelData = [
    { label: "Total Signups", value: funnel?.totalUsers || 0, percent: 100 },
    { label: "Created Agent", value: funnel?.usersWithAgent || 0, percent: funnel?.totalUsers ? Math.round(((funnel?.usersWithAgent || 0) / funnel.totalUsers) * 100) : 0 },
    { label: "Made a Call", value: funnel?.usersWithCall || 0, percent: funnel?.totalUsers ? Math.round(((funnel?.usersWithCall || 0) / funnel.totalUsers) * 100) : 0 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Growth & Adoption</h1>
      </div>

      <Card>
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-sm font-medium uppercase tracking-wider">Activation Funnel</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          {loadingFunnel ? (
            <div className="animate-pulse flex gap-4 h-24 bg-muted/50 rounded" />
          ) : funnelError ? (
            <p className="text-sm text-destructive py-6 text-center">Failed to load funnel data: {(funnelErr as Error)?.message}</p>
          ) : (
            <div className="flex flex-col md:flex-row items-stretch justify-between gap-4">
              {funnelData.map((step, idx) => (
                <div key={idx} className="flex-1 bg-muted/30 p-4 rounded-lg border border-border/50 relative overflow-hidden">
                  <div className="absolute bottom-0 left-0 bg-primary/10 h-1" style={{ width: `${step.percent}%` }} />
                  <div className="text-sm text-muted-foreground uppercase tracking-wider mb-2">{step.label}</div>
                  <div className="flex items-end gap-3">
                    <span className="text-3xl font-bold font-mono">{step.value.toLocaleString()}</span>
                    <span className="text-lg text-muted-foreground font-mono mb-1">{step.percent}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3 border-b border-border">
            <CardTitle className="text-sm font-medium uppercase tracking-wider">Top 20 Power Users</CardTitle>
          </CardHeader>
          <CardContent className="p-0 h-[500px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingTop ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-4">Loading...</TableCell></TableRow>
                ) : topError ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-8 text-destructive">Failed to load top users: {(topErr as Error)?.message}</TableCell></TableRow>
                ) : topUsers?.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">No data available</TableCell></TableRow>
                ) : (
                  topUsers?.map((user, idx) => (
                    <TableRow key={user.clerkId || idx}>
                      <TableCell>
                        <Link href={`/users/${user.clerkId}`} className="text-primary hover:underline block truncate max-w-[200px]">
                          {user.email || 'Unknown'}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums font-medium">{user.callCount?.toLocaleString() || 0}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground text-xs">
                        {formatCentsToDollars(user.walletBalanceCents || 0)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 border-b border-border">
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Inactive Users (7+ days)</CardTitle>
          </CardHeader>
          <CardContent className="p-0 h-[500px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Joined</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingInactive ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-4">Loading...</TableCell></TableRow>
                ) : inactiveError ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-8 text-destructive">Failed to load inactive users: {(inactiveErr as Error)?.message}</TableCell></TableRow>
                ) : inactiveUsers?.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">No inactive users</TableCell></TableRow>
                ) : (
                  inactiveUsers?.map((user, idx) => (
                    <TableRow key={user.clerkId || idx}>
                      <TableCell>
                        <Link href={`/users/${user.clerkId}`} className="text-muted-foreground hover:text-primary hover:underline block truncate max-w-[200px]">
                          {user.email || 'Unknown'}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {user.createdAt ? format(new Date(user.createdAt), "MMM d") : "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {formatCentsToDollars(user.walletBalanceCents || 0)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
