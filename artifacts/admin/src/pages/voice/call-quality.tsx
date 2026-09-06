import { SectionSubNav } from "@/components/section-subnav";
import { VOICE_TABS } from "@/lib/nav-config";
import { useVoiceCallQuality } from "@/hooks/use-admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadCsv } from "@/lib/csv";
import { formatCentsToDollars } from "@/lib/api";
import { Download } from "lucide-react";

export default function VoiceCallQualityPage() {
  const { data, isLoading } = useVoiceCallQuality(7);
  const k = data?.kpis;
  const providers = data?.providers ?? [];

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={VOICE_TABS} />
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Call Quality</h1>
          <p className="text-sm text-muted-foreground mt-1">Latency, completion, errors · last 7 days</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!providers.length}
          onClick={() =>
            downloadCsv(
              `call-quality-providers-${Date.now()}`,
              ["provider", "service", "calls", "minutes", "failureRatePct", "avgLatencyMs", "costPaise"],
              providers.map((p: any) => [p.provider, p.service, p.calls, p.minutes, p.failureRatePct, p.avgLatencyMs, p.costPaise]),
            )
          }
        >
          <Download className="h-3.5 w-3.5" /> CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {[
          ["Calls", k?.calls],
          ["Completion", k ? `${k.completionRatePct}%` : null],
          ["Error rate", k ? `${k.errorRatePct}%` : null],
          ["Transfer rate", k ? `${k.transferRatePct}%` : null],
          ["Avg duration", k?.avgDurationSeconds != null ? `${k.avgDurationSeconds}s` : null],
          ["Avg STT", k?.avgSttMs != null ? `${k.avgSttMs}ms` : null],
          ["Avg LLM", k?.avgLlmMs != null ? `${k.avgLlmMs}ms` : null],
          ["Avg TTS", k?.avgTtsMs != null ? `${k.avgTtsMs}ms` : null],
          ["Avg latency", k?.avgLatencyMs != null ? `${k.avgLatencyMs}ms` : null],
          ["Disconnect", k ? `${k.disconnectRatePct}%` : null],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">{label}</CardTitle></CardHeader>
            <CardContent className="text-xl font-bold font-mono">{isLoading ? "…" : value ?? "—"}</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Provider comparison (STT)</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-mono text-xs">Provider</TableHead>
                <TableHead className="font-mono text-xs text-right">Calls</TableHead>
                <TableHead className="font-mono text-xs text-right">Minutes</TableHead>
                <TableHead className="font-mono text-xs text-right">Failure</TableHead>
                <TableHead className="font-mono text-xs text-right">Latency</TableHead>
                <TableHead className="font-mono text-xs text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="h-20 text-center text-muted-foreground animate-pulse">Loading…</TableCell></TableRow>
              ) : providers.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="h-20 text-center text-muted-foreground">No data</TableCell></TableRow>
              ) : (
                providers.map((p: any) => (
                  <TableRow key={p.provider}>
                    <TableCell className="font-medium">{p.provider}</TableCell>
                    <TableCell className="text-right font-mono">{p.calls}</TableCell>
                    <TableCell className="text-right font-mono">{p.minutes}</TableCell>
                    <TableCell className="text-right font-mono">{p.failureRatePct}%</TableCell>
                    <TableCell className="text-right font-mono">{p.avgLatencyMs ?? "—"}ms</TableCell>
                    <TableCell className="text-right font-mono">{formatCentsToDollars(p.costPaise ?? 0)}</TableCell>
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
