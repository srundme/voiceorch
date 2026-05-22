import { useState, useEffect } from "react";
import { useListActiveCalls } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Phone, RefreshCw, Radio, Clock } from "lucide-react";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function ActiveCallRow({ call, now }: { call: any; now: number }) {
  const started = new Date(call.createdAt).getTime();
  const elapsed = Math.floor((now - started) / 1000);

  return (
    <div className="flex items-center gap-4 px-4 py-3 rounded-lg bg-white border border-[#D4D8DF] hover:border-[#D4D8DF] transition-colors">
      <div className="relative">
        <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        <div className="absolute inset-0 h-2.5 w-2.5 rounded-full bg-emerald-400 animate-ping opacity-60" />
      </div>

      <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="min-w-0">
          <p className="text-[10px] text-[#ACADB1] uppercase tracking-wider mb-0.5">Agent</p>
          <p className="text-sm text-[#080808] font-medium truncate">{call.agentName}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] text-[#ACADB1] uppercase tracking-wider mb-0.5">Number</p>
          <p className="text-sm text-[#353536] font-mono truncate">{call.toNumber}</p>
        </div>
        <div>
          <p className="text-[10px] text-[#ACADB1] uppercase tracking-wider mb-0.5">Duration</p>
          <p className="text-sm text-[#353536] font-mono tabular-nums">{formatDuration(elapsed)}</p>
        </div>
        <div>
          <p className="text-[10px] text-[#ACADB1] uppercase tracking-wider mb-0.5">Call ID</p>
          <p className="text-sm text-[#ACADB1] font-mono">#{call.id}</p>
        </div>
      </div>

      <Badge className="shrink-0 bg-[#D4D8DF]/20 text-[#353536] border-[#ACADB1]/50 text-[10px]">
        Live
      </Badge>
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
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#D4D8DF] shrink-0">
        <div>
          <h1 className="text-base font-semibold text-[#080808]">Live Monitor</h1>
          <p className="text-xs text-[#ACADB1] mt-0.5">
            {calls.length === 0 ? "No active calls" : `${calls.length} call${calls.length !== 1 ? "s" : ""} in progress`}
            {lastUpdated && (
              <span className="ml-2 text-[#ACADB1]">· updated {lastUpdated.toLocaleTimeString()}</span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="h-7 px-2.5 text-xs border-[#D4D8DF] text-[#706F70] hover:text-[#080808]"
        >
          <RefreshCw className="w-3 h-3 mr-1.5" />
          Refresh
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-lg bg-white border border-[#D4D8DF] animate-pulse" />
            ))}
          </div>
        ) : calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="h-12 w-12 rounded-full bg-[#D4D8DF]/40 flex items-center justify-center mb-4">
              <Radio className="h-6 w-6 text-[#ACADB1]" />
            </div>
            <p className="text-sm font-medium text-[#706F70]">No active calls</p>
            <p className="text-xs text-[#ACADB1] mt-1 max-w-xs">
              When agents are handling calls, they'll appear here in real time. This page auto-refreshes every 5 seconds.
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
          <div className="mt-6 p-4 rounded-lg bg-white/50 border border-[#D4D8DF]">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-3.5 h-3.5 text-[#ACADB1]" />
              <p className="text-xs text-[#ACADB1] font-medium">Summary</p>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-lg font-bold text-[#080808] tabular-nums">{calls.length}</p>
                <p className="text-[11px] text-[#ACADB1]">Active calls</p>
              </div>
              <div>
                <p className="text-lg font-bold text-[#353536] tabular-nums">
                  {new Set(calls.map((c: any) => c.agentId)).size}
                </p>
                <p className="text-[11px] text-[#ACADB1]">Agents busy</p>
              </div>
              <div>
                <p className="text-lg font-bold text-[#353536] tabular-nums">
                  {formatDuration(
                    Math.floor(
                      calls.reduce((sum: number, c: any) => sum + Math.floor((now - new Date(c.createdAt).getTime()) / 1000), 0) / calls.length
                    )
                  )}
                </p>
                <p className="text-[11px] text-[#ACADB1]">Avg duration</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
