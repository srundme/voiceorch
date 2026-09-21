import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch, getClientContext } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { stripTranscriptMarkup } from "@/lib/transcript-display";
import {
  attemptStatusLabel,
  formatDuration,
  type CampaignReportingLead,
} from "@/lib/campaign-lead-reporting";
import { AttemptStatusBadge, DispositionBadge } from "@/components/campaign-ops/badges";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

type CallPayload = {
  id: number;
  status?: string;
  durationSeconds?: number | null;
  transcript?: string | null;
  recordingUrl?: string | null;
  callSummary?: string | null;
};

function transcriptLines(raw: string | null | undefined): Array<{ who: string; text: string }> {
  const t = (raw ?? "").trim();
  if (!t) return [];
  try {
    const parsed = JSON.parse(t);
    if (Array.isArray(parsed)) {
      return parsed.map((row) => ({
        who: String(row.role ?? row.speaker ?? row.who ?? "Caller"),
        text: stripTranscriptMarkup(String(row.content ?? row.text ?? "")),
      })).filter((row) => row.text);
    }
  } catch { /* plain text */ }
  return t.split(/\r?\n/).map((line) => {
    const m = line.match(/^(Agent|Caller|User|Bot)\s*:\s*(.*)$/i);
    if (m) return { who: m[1]!, text: stripTranscriptMarkup(m[2] ?? "") };
    return { who: "", text: stripTranscriptMarkup(line) };
  }).filter((row) => row.text);
}

function isAgent(who: string): boolean {
  return /agent|bot/i.test(who);
}

function InspectorAudio({ callId }: { callId: number }) {
  const { getToken } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        setUrl(null);
        const token = await getToken();
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        const clientCtx = getClientContext();
        if (clientCtx) headers["x-client-context"] = clientCtx;
        const r = await fetch(`/api/storage/recordings/${callId}`, { headers });
        if (!r.ok) throw new Error("No recording");
        const blob = await r.blob();
        if (cancelled) return;
        const obj = URL.createObjectURL(blob);
        revoked = obj;
        setUrl(obj);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "No recording");
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [callId, getToken]);

  if (error) return null;
  if (!url) return <Skeleton className="h-8 w-full" />;
  return <audio controls src={url} className="w-full h-8" preload="none" />;
}

export function CallInspectorPanel({
  campaignId,
  lead,
}: {
  campaignId: number;
  lead: CampaignReportingLead | null;
}) {
  const callId = lead?.latestCallId ?? lead?.latestAnsweredCallId ?? null;
  const call = useQuery({
    queryKey: ["campaign-call-inspector", callId],
    queryFn: () => customFetch<CallPayload>(`/api/calls/${callId}`),
    enabled: callId != null,
  });

  if (!lead) {
    return (
      <div className="h-full rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
        Select a call to read the transcript.
      </div>
    );
  }

  const lines = transcriptLines(call.data?.transcript);
  const name = (lead.name || "").trim();
  const title = name && name.toLowerCase() !== "unknown" ? name : lead.phone;

  return (
    <div className="h-full min-h-0 flex flex-col rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border shrink-0 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium truncate">{title}</p>
            {title !== lead.phone ? (
              <p className="text-xs font-mono text-muted-foreground">{lead.phone}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <AttemptStatusBadge status={lead.lastAttemptStatus} answeredEver={lead.answeredEver} />
            <DispositionBadge
              bucket={lead.dispositionBucket}
              label={lead.disposition}
              state={lead.dispositionState}
            />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {formatDuration(call.data?.durationSeconds ?? lead.latestAnsweredDuration)}
          {call.data?.status || lead.lastAttemptStatus
            ? ` · ${attemptStatusLabel(call.data?.status ?? lead.lastAttemptStatus)}`
            : ""}
        </p>
        {callId != null && <InspectorAudio callId={callId} />}
        <Link
          href={`/app/campaigns/${campaignId}/leads/${lead.leadId}`}
          className="inline-flex items-center text-[11px] text-muted-foreground hover:text-foreground"
        >
          Open lead
          <ExternalLink className="ml-1 h-3 w-3" />
        </Link>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2.5">
        {call.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transcript on this call.</p>
        ) : (
          lines.map((row, i) => {
            const agent = isAgent(row.who);
            return (
              <div key={`${i}-${row.text.slice(0, 12)}`} className={cn("flex", agent ? "justify-start" : "justify-end")}>
                <div className={cn("max-w-[90%] rounded-2xl px-3 py-2", agent ? "bg-muted" : "bg-foreground text-background")}>
                  {row.who ? (
                    <p className={cn("text-[10px] font-medium mb-0.5", agent ? "text-muted-foreground" : "text-background/70")}>
                      {row.who}
                    </p>
                  ) : null}
                  <p className="text-sm leading-5">{row.text}</p>
                </div>
              </div>
            );
          })
        )}
        {call.data?.callSummary ? (
          <p className="pt-3 text-xs text-muted-foreground border-t border-border">
            {call.data.callSummary}
          </p>
        ) : null}
      </div>
    </div>
  );
}
