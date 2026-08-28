import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { ArrowRightLeft, Clock, CheckCircle2, PhoneIncoming, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface Transfer {
  id:                 number;
  callId:             number;
  transferTo:         string;
  transferName:       string | null;
  summary:            string | null;
  status:             string;
  providerTransferId: string | null;
  initiatedAt:        string;
  connectedAt:        string | null;
  completedAt:        string | null;
  agentName:          string | null;
}

function useTransfers() {
  return useQuery<{ transfers: Transfer[] }>({
    queryKey: ["call-transfers"],
    queryFn: () => customFetch<{ transfers: Transfer[] }>("/api/transfers"),
    // Poll only while something is still in flight; idle completed lists do not need 10s churn.
    refetchInterval: (query) => {
      const list = query.state.data?.transfers ?? [];
      const live = list.some((t) => t.status === "initiated" || t.status === "connected");
      return live ? 10_000 : false;
    },
  });
}

function statusBadge(status: string) {
  if (status === "initiated")  return <Badge variant="secondary" className="gap-1"><Clock className="w-3 h-3" /> Initiated</Badge>;
  if (status === "connected")  return <Badge variant="default"   className="gap-1"><PhoneIncoming className="w-3 h-3" /> Connected</Badge>;
  if (status === "completed")  return <Badge variant="outline"   className="gap-1"><CheckCircle2 className="w-3 h-3" /> Completed</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

function elapsed(start: string, end?: string | null): string {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const s  = Math.floor(ms / 1000);
  if (s < 60)  return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function datePart(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString();
}

export default function TransfersPage() {
  const { data, isLoading, isError, refetch, isFetching } = useTransfers();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // Pin History shell tab + canonicalize path (same pattern as Callbacks).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", "transfers");
    for (const k of ["status", "agent", "disp", "q", "from", "to", "sort", "page", "cb", "reason"]) {
      params.delete(k);
    }
    const qs = params.toString();
    const next = `/app/history?${qs}`;
    const current = `${window.location.pathname}${window.location.search}`;
    if (next !== current) navigate(next, { replace: true });
  }, [navigate]);

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      await customFetch(`/api/transfers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          ...(status === "connected" ? { connectedAt: new Date().toISOString() } : {}),
          ...(status === "completed" ? { completedAt: new Date().toISOString() } : {}),
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["call-transfers"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const transfers = data?.transfers ?? [];
  const active    = transfers.filter((t) => t.status === "initiated" || t.status === "connected");

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {active.length > 0 && (
        <Card className="border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-amber-800 dark:text-amber-300 text-base flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> {active.length} Active Transfer{active.length > 1 ? "s" : ""}
            </CardTitle>
            <CardDescription className="text-amber-700 dark:text-amber-400">
              These calls are waiting for a human agent to connect.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {active.map((t) => (
              <div key={t.id} className="flex items-start gap-4 bg-white dark:bg-black/20 rounded-lg p-4 border">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {statusBadge(t.status)}
                    <span className="text-sm font-medium">Call #{t.callId}</span>
                    {t.agentName && <span className="text-xs text-muted-foreground">via {t.agentName}</span>}
                  </div>
                  <p className="text-sm mt-1">
                    <span className="text-muted-foreground">Transfer to:</span>{" "}
                    <span className="font-mono font-medium">{t.transferTo}</span>
                    {t.transferName && <span className="text-muted-foreground"> ({t.transferName})</span>}
                  </p>
                  {t.summary && (
                    <div className="mt-2 text-xs bg-muted rounded p-2 text-muted-foreground italic">
                      "{t.summary}"
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Waiting {elapsed(t.initiatedAt)} · {timeStr(t.initiatedAt)}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {t.status === "initiated" && (
                    <Button size="sm" onClick={() => updateMutation.mutate({ id: t.id, status: "connected" })}>
                      <PhoneIncoming className="w-3 h-3 mr-1" /> Connected
                    </Button>
                  )}
                  {(t.status === "initiated" || t.status === "connected") && (
                    <Button size="sm" variant="outline" onClick={() => updateMutation.mutate({ id: t.id, status: "completed" })}>
                      <CheckCircle2 className="w-3 h-3 mr-1" /> Done
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transfer History</CardTitle>
          <CardDescription>
            {isError ? "Could not load transfers" : `${transfers.length} total transfers`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : isError ? (
            <div className="text-center py-12 space-y-3">
              <AlertCircle className="w-10 h-10 text-amber-600 mx-auto" />
              <p className="font-medium">Transfer history failed to load</p>
              <p className="text-sm text-muted-foreground">
                This is not an empty inbox — the request failed. Retry or check your session.
              </p>
              <Button size="sm" variant="outline" disabled={isFetching} onClick={() => void refetch()}>
                Retry
              </Button>
            </div>
          ) : transfers.length === 0 ? (
            <div className="text-center py-12">
              <ArrowRightLeft className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium">No transfers yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Transfers appear here when an AI agent hands off to a human — from normal or campaign calls.
              </p>
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground text-xs">
                    <th className="pb-2 pr-4 font-medium">Call</th>
                    <th className="pb-2 pr-4 font-medium">Agent</th>
                    <th className="pb-2 pr-4 font-medium">Transfer To</th>
                    <th className="pb-2 pr-4 font-medium">Summary</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium">Duration</th>
                    <th className="pb-2 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {transfers.map((t) => (
                    <tr key={t.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 pr-4 font-medium">#{t.callId}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{t.agentName ?? "—"}</td>
                      <td className="py-3 pr-4 font-mono">{t.transferTo}</td>
                      <td className="py-3 pr-4 max-w-[200px]">
                        <p className="truncate text-muted-foreground text-xs italic">
                          {t.summary ? `"${t.summary}"` : "—"}
                        </p>
                      </td>
                      <td className="py-3 pr-4">{statusBadge(t.status)}</td>
                      <td className="py-3 pr-4 text-muted-foreground text-xs">
                        {t.completedAt
                          ? elapsed(t.initiatedAt, t.completedAt)
                          : t.status === "initiated"
                            ? `${elapsed(t.initiatedAt)} (waiting)`
                            : "—"}
                      </td>
                      <td className="py-3 text-muted-foreground text-xs">
                        <p>{datePart(t.initiatedAt)}</p>
                        <p>{timeStr(t.initiatedAt)}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
