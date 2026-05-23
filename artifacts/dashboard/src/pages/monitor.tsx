import { useState, useEffect } from "react";
import { useListActiveCalls, useTransferCall } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Phone, RefreshCw, Radio, Clock, PhoneForwarded, X } from "lucide-react";
import { toast } from "sonner";

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
        onError: (err: any) => {
          toast.error(err?.message ?? "Transfer failed");
        },
      },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-96 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <PhoneForwarded className="w-4 h-4 text-gray-500" />
            <p className="text-sm font-semibold text-gray-700">Transfer Call #{callId}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-500 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Transfer type */}
          <div>
            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-2">Transfer type</p>
            <div className="grid grid-cols-2 gap-2">
              {(["cold", "warm"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`py-2 px-3 rounded-lg text-[13px] font-medium border transition-all ${
                    type === t
                      ? "bg-gray-800 text-gray-900 border-gray-700"
                      : "bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-600"
                  }`}
                >
                  {t === "cold" ? "🔇 Cold" : "🔊 Warm"}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5">
              {type === "cold"
                ? "Immediately bridges caller to the target — no announcement."
                : "Speaks a handoff message before connecting."}
            </p>
          </div>

          {/* Target number */}
          <div>
            <label className="text-[11px] font-medium text-gray-400 uppercase tracking-wider block mb-1.5">
              Transfer to (E.164)
            </label>
            <Input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="+15551234567"
              className="h-9 text-sm bg-gray-50 border-gray-200"
              required
            />
          </div>

          {/* Warm message */}
          {type === "warm" && (
            <div>
              <label className="text-[11px] font-medium text-gray-400 uppercase tracking-wider block mb-1.5">
                Handoff message
              </label>
              <Input
                value={warmMessage}
                onChange={(e) => setWarmMessage(e.target.value)}
                className="h-9 text-sm bg-gray-50 border-gray-200"
              />
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1 h-9 text-sm border-gray-200" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || !target.trim()}
              className="flex-1 h-9 text-sm bg-gray-800 text-gray-900 hover:bg-gray-700"
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
      <div className="flex items-center gap-4 px-4 py-3 rounded-xl bg-white border border-gray-200 hover:border-white/[0.12] transition-colors">
        <div className="relative shrink-0">
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          <div className="absolute inset-0 h-2.5 w-2.5 rounded-full bg-emerald-400 animate-ping opacity-60" />
        </div>

        <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="min-w-0">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Agent</p>
            <p className="text-sm text-gray-800 font-medium truncate">{call.agentName}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Number</p>
            <p className="text-sm text-gray-700 font-mono truncate">{call.toNumber}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Duration</p>
            <p className="text-sm text-gray-700 font-mono tabular-nums">{formatDuration(elapsed)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Call ID</p>
            <p className="text-sm text-gray-400 font-mono">#{call.id}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Badge className="bg-gray-50 text-gray-700 border-gray-200 text-[10px]">Live</Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowTransfer(true)}
            className="h-7 px-2.5 text-xs border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300 gap-1.5"
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
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
        <div>
          <h1 className="text-base font-semibold text-gray-800">Live Monitor</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {calls.length === 0 ? "No active calls" : `${calls.length} call${calls.length !== 1 ? "s" : ""} in progress`}
            {lastUpdated && (
              <span className="ml-2 text-gray-400">· updated {lastUpdated.toLocaleTimeString()}</span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="h-7 px-2.5 text-xs border-gray-200 text-gray-500 hover:text-gray-800"
        >
          <RefreshCw className="w-3 h-3 mr-1.5" />
          Refresh
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-xl bg-gray-50 border border-gray-200 animate-pulse" />
            ))}
          </div>
        ) : calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="h-12 w-12 rounded-full bg-gray-50 flex items-center justify-center mb-4">
              <Radio className="h-6 w-6 text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-500">No active calls</p>
            <p className="text-xs text-gray-400 mt-1 max-w-xs">
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
          <div className="mt-6 p-4 rounded-xl bg-gray-50 border border-gray-200">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-3.5 h-3.5 text-gray-400" />
              <p className="text-xs text-gray-400 font-medium">Summary</p>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-lg font-bold text-gray-800 tabular-nums">{calls.length}</p>
                <p className="text-[11px] text-gray-400">Active calls</p>
              </div>
              <div>
                <p className="text-lg font-bold text-gray-700 tabular-nums">
                  {new Set(calls.map((c: any) => c.agentId)).size}
                </p>
                <p className="text-[11px] text-gray-400">Agents busy</p>
              </div>
              <div>
                <p className="text-lg font-bold text-gray-700 tabular-nums">
                  {formatDuration(
                    Math.floor(
                      calls.reduce((sum: number, c: any) => sum + Math.floor((now - new Date(c.createdAt).getTime()) / 1000), 0) / calls.length
                    )
                  )}
                </p>
                <p className="text-[11px] text-gray-400">Avg duration</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
