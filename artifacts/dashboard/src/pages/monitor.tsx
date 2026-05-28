import { useState, useEffect, useMemo } from "react";
import { useListActiveCalls, useTransferCall } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Phone, RefreshCw, Radio, Clock, PhoneForwarded, X } from "lucide-react";
import { toast } from "sonner";
import { formatApiError } from "@/lib/format-api-error";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function TransferDialog({
  callId,
  onClose,
}: {
  callId: number;
  onClose: () => void;
}) {
  const [type, setType] = useState<"cold" | "warm">("cold");
  const [target, setTarget] = useState("");
  const [warmMessage, setWarmMessage] = useState("Please hold while I connect you to an agent.");
  const { mutate: transfer, isPending } = useTransferCall();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!target.trim()) return;
    transfer(
      { id: callId, data: { type, target: target.trim(), warmMessage } },
      {
        onSuccess: () => {
          toast.success(`Call #${callId} transferred to ${target}`);
          onClose();
        },
        onError: (err: unknown) => {
          toast.error(formatApiError(err));
        },
      },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-popover rounded-2xl shadow-xl border border-border w-96 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <PhoneForwarded className="w-4 h-4 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">Transfer Call #{callId}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors rounded-lg p-1 hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Transfer type */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Transfer type</p>
            <div className="grid grid-cols-2 gap-2">
              {(["cold", "warm"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`py-2 px-3 rounded-lg text-[13px] font-medium border transition-all ${
                    type === t
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground border-border hover:border-muted-foreground/30 hover:text-foreground"
                  }`}
                >
                  {t === "cold" ? "Cold" : "Warm"}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5">
              {type === "cold"
                ? "Immediately bridges caller to the target — no announcement."
                : "Speaks a handoff message before connecting."}
            </p>
          </div>

          {/* Target number */}
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
              Transfer to (E.164)
            </label>
            <Input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="+15551234567"
              className="h-9 text-sm"
              required
            />
          </div>

          {/* Warm message */}
          {type === "warm" && (
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                Handoff message
              </label>
              <Input
                value={warmMessage}
                onChange={(e) => setWarmMessage(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1 h-9 text-sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || !target.trim()}
              className="flex-1 h-9 text-sm"
            >
              {isPending ? "Transferring…" : "Transfer now"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ActiveCallRow({ call, now }: { call: any; now: number }) {
  const started = new Date(call.createdAt).getTime();
  const elapsed = Math.floor((now - started) / 1000);
  const [showTransfer, setShowTransfer] = useState(false);

  return (
    <>
      <div className="flex items-center gap-4 px-4 py-3 rounded-xl bg-card border border-border hover:border-muted-foreground/20 transition-colors">
        <div className="relative shrink-0">
          <div className="h-2.5 w-2.5 rounded-full bg-primary" />
          <div className="absolute inset-0 h-2.5 w-2.5 rounded-full bg-primary animate-ping opacity-60" />
        </div>

        <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Agent</p>
            <p className="text-sm text-foreground font-medium truncate">{call.agentName}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Number</p>
            <p className="text-sm text-foreground font-mono truncate">{call.toNumber}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Duration</p>
            <p className="text-sm text-foreground font-mono tabular-nums">{formatDuration(elapsed)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Call ID</p>
            <p className="text-sm text-muted-foreground font-mono">#{call.id}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Badge className="bg-primary/10 text-primary border border-primary/20 text-[10px]">Live</Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowTransfer(true)}
            className="h-7 px-2.5 text-xs gap-1.5"
          >
            <PhoneForwarded className="w-3 h-3" />
            Transfer
          </Button>
        </div>
      </div>

      {showTransfer && (
        <TransferDialog callId={call.id} onClose={() => setShowTransfer(false)} />
      )}
    </>
  );
}

/* ── Status strip ────────────────────────────────────────────────────────── */
function StatusStrip({ calls, now }: { calls: any[]; now: number }) {
  const agentsCount  = useMemo(() => new Set(calls.map((c) => c.agentId)).size, [calls]);
  const avgDuration  = calls.length > 0
    ? Math.floor(calls.reduce((sum, c) => sum + Math.floor((now - new Date(c.createdAt).getTime()) / 1000), 0) / calls.length)
    : 0;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-2 border-b border-border bg-card/50 text-[11px] shrink-0">
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary))]" />
        <span className="text-muted-foreground">{calls.length} live call{calls.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        <span className="text-muted-foreground">{agentsCount} agent{agentsCount !== 1 ? "s" : ""} busy</span>
      </div>
      {calls.length > 0 && (
        <div className="flex items-center gap-1.5">
          <Clock className="h-2.5 w-2.5 text-muted-foreground" />
          <span className="text-muted-foreground">avg {formatDuration(avgDuration)}</span>
        </div>
      )}
      <div className="ml-auto">
        <span className="px-2 py-0.5 rounded-md bg-muted text-foreground font-mono font-semibold border border-border">
          {calls.length > 0 ? `${agentsCount} busy` : "idle"}
        </span>
      </div>
    </div>
  );
}

export default function MonitorPage() {
  const [now, setNow] = useState(Date.now());
  const { data: calls = [], isLoading, refetch, dataUpdatedAt } = useListActiveCalls({
    query: { refetchInterval: 5000, queryKey: ["calls", "active"] },
  });

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-foreground">Live Monitor</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {calls.length === 0 ? "No active calls" : `${calls.length} call${calls.length !== 1 ? "s" : ""} in progress`}
            {lastUpdated && (
              <span className="ml-2 text-muted-foreground/70">· updated {lastUpdated.toLocaleTimeString()}</span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="h-7 px-2.5 text-xs gap-1.5"
        >
          <RefreshCw className="w-3 h-3" />
          Refresh
        </Button>
      </div>

      {/* Status strip — always visible */}
      <StatusStrip calls={calls} now={now} />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl px-6 py-8 md:px-8">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-xl bg-muted border border-border animate-pulse" />
            ))}
          </div>
        ) : calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="h-12 w-12 rounded-full bg-muted border border-border flex items-center justify-center mb-4">
              <Radio className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">No active calls</p>
            <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">
              When agents are handling calls, they'll appear here in real time. Auto-refreshes every 5 seconds.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {calls.map((call) => (
              <ActiveCallRow key={call.id} call={call} now={now} />
            ))}
          </div>
        )}

        {calls.length > 0 && (
          <div className="mt-6 p-4 rounded-xl bg-muted/40 border border-border">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground font-medium">Summary</p>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-lg font-bold text-foreground tabular-nums">{calls.length}</p>
                <p className="text-[11px] text-muted-foreground">Active calls</p>
              </div>
              <div>
                <p className="text-lg font-bold text-foreground tabular-nums">
                  {new Set(calls.map((c: any) => c.agentId)).size}
                </p>
                <p className="text-[11px] text-muted-foreground">Agents busy</p>
              </div>
              <div>
                <p className="text-lg font-bold text-foreground tabular-nums">
                  {formatDuration(
                    Math.floor(
                      calls.reduce((sum: number, c: any) => sum + Math.floor((now - new Date(c.createdAt).getTime()) / 1000), 0) / calls.length
                    )
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground">Avg duration</p>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
