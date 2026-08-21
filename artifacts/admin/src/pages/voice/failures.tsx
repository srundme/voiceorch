import { Link } from "wouter";
import { format } from "date-fns";
import { SectionSubNav } from "@/components/section-subnav";
import { VOICE_TABS } from "@/lib/nav-config";
import { useVoiceFailures } from "@/hooks/use-admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadCsv } from "@/lib/csv";
import { Download } from "lucide-react";

export default function VoiceFailuresPage() {
  const { data, isLoading } = useVoiceFailures(7);
  const groups = data?.groups ?? [];
  const recent = data?.recent ?? [];
  const k = data?.kpis;

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={VOICE_TABS} />
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Failure Center</h1>
          <p className="text-sm text-muted-foreground mt-1">Grouped failures · last 7 days</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!groups.length}
          onClick={() =>
            downloadCsv(
              `failures-${Date.now()}`,
              ["category", "count", "ratePct", "users", "agents", "action"],
              groups.map((g: any) => [g.category, g.failureCount, g.failureRatePct, g.affectedUsers, g.affectedAgents, g.recommendedAction]),
            )
          }
        >
          <Download className="h-3.5 w-3.5" /> CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Calls</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold font-mono">{isLoading ? "…" : k?.totalCalls ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Failed</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold font-mono text-destructive">{isLoading ? "…" : k?.failedCalls ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Failure rate</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold font-mono">{isLoading ? "…" : `${k?.failureRatePct ?? 0}%`}</CardContent>
        </Card>
      </div>

      <div className="border border-border rounded-lg bg-card overflow-hidden overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-xs">Category</TableHead>
              <TableHead className="font-mono text-xs text-right">Count</TableHead>
              <TableHead className="font-mono text-xs text-right">Rate</TableHead>
              <TableHead className="font-mono text-xs text-right">Users</TableHead>
              <TableHead className="font-mono text-xs text-right">Agents</TableHead>
              <TableHead className="font-mono text-xs">Last seen</TableHead>
              <TableHead className="font-mono text-xs">Recommended action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="h-20 text-center text-muted-foreground animate-pulse">Loading…</TableCell></TableRow>
            ) : groups.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="h-20 text-center text-muted-foreground">No failures</TableCell></TableRow>
            ) : (
              groups.map((g: any) => (
                <TableRow key={g.category}>
                  <TableCell><Badge variant="outline">{g.category}</Badge></TableCell>
                  <TableCell className="text-right font-mono">{g.failureCount}</TableCell>
                  <TableCell className="text-right font-mono">{g.failureRatePct}%</TableCell>
                  <TableCell className="text-right font-mono">{g.affectedUsers}</TableCell>
                  <TableCell className="text-right font-mono">{g.affectedAgents}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {g.lastSeen ? format(new Date(g.lastSeen), "MMM d HH:mm") : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[280px]">{g.recommendedAction}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Recent failures</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-mono text-xs">Call</TableHead>
                <TableHead className="font-mono text-xs">Category</TableHead>
                <TableHead className="font-mono text-xs">Agent</TableHead>
                <TableHead className="font-mono text-xs">User</TableHead>
                <TableHead className="font-mono text-xs">Error</TableHead>
                <TableHead className="font-mono text-xs">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/voice/calls/${r.id}`} className="font-mono text-primary hover:underline">#{r.id}</Link>
                  </TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{r.category}</Badge></TableCell>
                  <TableCell className="text-sm">{r.agentName ?? r.agentId}</TableCell>
                  <TableCell className="text-sm">
                    {r.userId ? <Link href={`/users/${r.userId}`} className="text-primary hover:underline">{r.ownerEmail || r.userId}</Link> : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-destructive truncate max-w-[280px]">{r.errorMessage}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {r.createdAt ? format(new Date(r.createdAt), "MMM d HH:mm") : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
