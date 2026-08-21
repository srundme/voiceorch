import { Link, useParams } from "wouter";
import { format } from "date-fns";
import { SectionSubNav } from "@/components/section-subnav";
import { VOICE_TABS } from "@/lib/nav-config";
import { useVoiceCall360 } from "@/hooks/use-admin-api";
import { formatCentsToDollars } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function VoiceCall360Page() {
  const { callId } = useParams<{ callId: string }>();
  const { data, isLoading, isError } = useVoiceCall360(callId || "");
  const c = data?.call;

  if (isLoading) return <div className="p-8 text-muted-foreground animate-pulse">Loading call…</div>;
  if (isError || !c) return <div className="p-8 text-destructive">Call not found.</div>;

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={VOICE_TABS} />
      <div className="flex items-start gap-3">
        <Button variant="outline" size="icon" asChild className="shrink-0">
          <Link href="/voice/live"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight font-mono">Call #{c.id}</h1>
          <div className="flex flex-wrap gap-2 mt-1">
            <Badge variant="outline" className="capitalize">{c.status}</Badge>
            {c.outcome && <Badge variant="secondary" className="text-[10px]">{c.outcome}</Badge>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Revenue</CardTitle></CardHeader>
          <CardContent className="text-xl font-bold font-mono">{formatCentsToDollars(c.economics?.revenuePaise ?? 0)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Cost</CardTitle></CardHeader>
          <CardContent className="text-xl font-bold font-mono text-muted-foreground">{formatCentsToDollars(c.economics?.costPaise ?? 0)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Profit</CardTitle></CardHeader>
          <CardContent className={`text-xl font-bold font-mono ${(c.economics?.profitPaise ?? 0) < 0 ? "text-destructive" : "text-emerald-600"}`}>
            {formatCentsToDollars(c.economics?.profitPaise ?? 0)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Duration</CardTitle></CardHeader>
          <CardContent className="text-xl font-bold font-mono">{c.durationSeconds ?? 0}s</CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Metadata</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">User</div>
              {c.userId ? (
                <Link href={`/users/${c.userId}`} className="text-primary hover:underline">{c.userEmail || c.userId}</Link>
              ) : "—"}
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Agent</div>
              {c.agentId && c.userId ? (
                <Link href={`/users/${c.userId}/agents/${c.agentId}`} className="text-primary hover:underline">
                  {c.agentName || c.agentId}
                </Link>
              ) : (c.agentName || "—")}
            </div>
            <div><div className="text-xs text-muted-foreground">From</div><span className="font-mono text-xs">{c.fromNumber}</span></div>
            <div><div className="text-xs text-muted-foreground">To</div><span className="font-mono text-xs">{c.toNumber}</span></div>
            <div><div className="text-xs text-muted-foreground">Started</div><span className="font-mono text-xs">{c.startedAt ? format(new Date(c.startedAt), "yyyy-MM-dd HH:mm:ss") : "—"}</span></div>
            <div><div className="text-xs text-muted-foreground">Ended</div><span className="font-mono text-xs">{c.endedAt ? format(new Date(c.endedAt), "yyyy-MM-dd HH:mm:ss") : "—"}</span></div>
            <div><div className="text-xs text-muted-foreground">Language</div>{c.primaryLanguage || "—"}</div>
            <div><div className="text-xs text-muted-foreground">Execution</div><span className="font-mono text-[10px]">{c.executionId || "—"}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Providers & latency</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="font-mono text-xs">ASR {c.providers?.asr ?? "—"} · LLM {c.providers?.llm ?? "—"} · TTS {c.providers?.tts ?? "—"}</div>
            <div className="font-mono text-xs">Telephony {c.providers?.telephony ?? "—"} · Voice {c.providers?.voice ?? "—"}</div>
            <div className="grid grid-cols-3 gap-2 pt-2">
              <div><div className="text-xs text-muted-foreground">STT</div><div className="font-mono">{c.latency?.sttMs ?? "—"}ms</div></div>
              <div><div className="text-xs text-muted-foreground">LLM</div><div className="font-mono">{c.latency?.llmMs ?? "—"}ms</div></div>
              <div><div className="text-xs text-muted-foreground">TTS</div><div className="font-mono">{c.latency?.ttsMs ?? "—"}ms</div></div>
            </div>
            {c.errorMessage && (
              <div className="mt-2 rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                {c.errorMessage}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {(c.callSummary || c.transcript) && (
        <Card>
          <CardHeader><CardTitle className="text-sm">{c.callSummary ? "Summary" : "Transcript"}</CardTitle></CardHeader>
          <CardContent>
            {c.callSummary && <p className="text-sm mb-4">{c.callSummary}</p>}
            {c.transcript && (
              <pre className="text-xs whitespace-pre-wrap font-mono max-h-[420px] overflow-y-auto bg-muted/40 rounded p-3">
                {c.transcript}
              </pre>
            )}
          </CardContent>
        </Card>
      )}

      {(data?.technicalLogs?.length ?? 0) > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Technical logs</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data!.technicalLogs.map((l: any, i: number) => (
              <div key={i} className="flex justify-between gap-3 text-xs border-b border-border/50 pb-2">
                <div>
                  <span className="font-mono uppercase mr-2">{l.service}</span>
                  <span className="text-muted-foreground">{l.provider}</span>
                  {!l.success && l.error && <span className="text-destructive ml-2">{l.error}</span>}
                </div>
                <span className="font-mono text-muted-foreground shrink-0">
                  {l.latencyMs != null ? `${l.latencyMs}ms` : ""} {l.at ? format(new Date(l.at), "HH:mm:ss") : ""}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
