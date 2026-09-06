import { Link } from "wouter";
import { SectionSubNav } from "@/components/section-subnav";
import { VOICE_TABS } from "@/lib/nav-config";
import { useVoiceLive } from "@/hooks/use-admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv";
import { Activity, Download } from "lucide-react";

function fmtDur(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

export default function VoiceLivePage() {
  const { data, isLoading, dataUpdatedAt } = useVoiceLive();
  const calls = data?.calls ?? [];

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={VOICE_TABS} />
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Live Calls</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Active sessions · refreshes every 5s
            {dataUpdatedAt ? ` · ${new Date(dataUpdatedAt).toLocaleTimeString()}` : ""}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!calls.length}
          onClick={() =>
            downloadCsv(
              `live-calls-${Date.now()}`,
              ["callId", "agent", "user", "durationSec", "status", "language"],
              calls.map((c: any) => [c.callId, c.agentName, c.userEmail, c.durationSeconds, c.status, c.language]),
            )
          }
        >
          <Download className="h-3.5 w-3.5" /> CSV
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-muted-foreground uppercase flex items-center gap-2">
            <Activity className="h-3.5 w-3.5" /> Active now
          </CardTitle>
        </CardHeader>
        <CardContent className="text-3xl font-bold font-mono">{isLoading ? "…" : data?.count ?? 0}</CardContent>
      </Card>

      <div className="border border-border rounded-lg bg-card overflow-hidden overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-xs">Call</TableHead>
              <TableHead className="font-mono text-xs">Agent</TableHead>
              <TableHead className="font-mono text-xs">User</TableHead>
              <TableHead className="font-mono text-xs">Duration</TableHead>
              <TableHead className="font-mono text-xs">Providers</TableHead>
              <TableHead className="font-mono text-xs">Language</TableHead>
              <TableHead className="font-mono text-xs">Stage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground animate-pulse">Loading…</TableCell></TableRow>
            ) : calls.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No active calls</TableCell></TableRow>
            ) : (
              calls.map((c: any) => (
                <TableRow key={c.sessionId || c.callId}>
                  <TableCell>
                    <Link href={`/voice/calls/${c.callId}`} className="font-mono text-primary hover:underline">
                      #{c.callId}
                    </Link>
                    <Badge variant="outline" className="ml-2 text-[10px] capitalize">{c.status}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{c.agentName ?? c.agentId ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {c.userId ? (
                      <Link href={`/users/${c.userId}`} className="text-primary hover:underline">
                        {c.userEmail || c.userName}
                      </Link>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">{fmtDur(c.durationSeconds ?? 0)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">
                    {[c.providers?.asr, c.providers?.llm, c.providers?.tts].filter(Boolean).join(" · ") || "—"}
                  </TableCell>
                  <TableCell className="text-xs">{c.language ?? "—"}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-[10px]">{c.stage ?? "live"}</Badge></TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
