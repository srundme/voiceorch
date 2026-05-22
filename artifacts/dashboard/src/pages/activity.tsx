import React from "react";
import { format, parseISO } from "date-fns";
import { Activity, Bot, Phone, Key, BookOpen, Wallet, RefreshCw, Settings } from "lucide-react";
import { useListActivityLogs, getListActivityLogsQueryKey } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const EVENT_META: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  "agent.created":                 { label: "Agent Created",          color: "bg-[#D4D8DF]/20 text-[#353536] border-[#ACADB1]/40",  icon: Bot },
  "agent.deleted":                 { label: "Agent Deleted",          color: "bg-red-500/10 text-red-400 border-red-500/20",              icon: Bot },
  "agent.toggled":                 { label: "Agent Toggled",          color: "bg-blue-500/10 text-blue-400 border-blue-500/20",           icon: Bot },
  "call.started":                  { label: "Call Started",           color: "bg-violet-500/10 text-violet-400 border-violet-500/20",     icon: Phone },
  "call.ended":                    { label: "Call Ended",             color: "bg-[#D4D8DF]/20 text-[#706F70] border-[#D4D8DF]/50",           icon: Phone },
  "provider.added":                { label: "Provider Added",         color: "bg-[#D4D8DF]/20 text-[#353536] border-[#ACADB1]/40",  icon: Key },
  "provider.deleted":              { label: "Provider Deleted",       color: "bg-red-500/10 text-red-400 border-red-500/20",              icon: Key },
  "knowledge_base.created":        { label: "KB Created",             color: "bg-amber-500/10 text-amber-400 border-amber-500/20",        icon: BookOpen },
  "knowledge_base.deleted":        { label: "KB Deleted",             color: "bg-red-500/10 text-red-400 border-red-500/20",              icon: BookOpen },
  "account.api_key_regenerated":   { label: "API Key Regenerated",    color: "bg-orange-500/10 text-orange-400 border-orange-500/20",     icon: RefreshCw },
  "account.concurrent_slot_added": { label: "Concurrent Slot Added",  color: "bg-blue-500/10 text-blue-400 border-blue-500/20",           icon: Settings },
  "wallet.topup":                  { label: "Wallet Top-up",          color: "bg-[#D4D8DF]/20 text-[#353536] border-[#ACADB1]/40",  icon: Wallet },
};

function eventMeta(type: string) {
  return EVENT_META[type] ?? { label: type, color: "bg-[#D4D8DF]/20 text-[#706F70] border-[#D4D8DF]/50", icon: Activity };
}

export default function ActivityPage() {
  const { data: logs, isLoading } = useListActivityLogs(
    {},
    { query: { queryKey: getListActivityLogsQueryKey({}) } }
  );

  return (
    <div className="flex flex-col h-full overflow-auto bg-[#EBEDF1]">
      <div className="border-b border-[#D4D8DF] px-6 py-4 flex items-center gap-3 shrink-0">
        <Activity className="w-5 h-5 text-[#353536]" />
        <h1 className="font-semibold text-[#080808] text-lg">Activity Log</h1>
        <span className="text-xs text-[#ACADB1] ml-auto">Audit trail of all platform events</span>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-3 rounded-lg border border-[#D4D8DF] bg-white/30">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-72" />
                  </div>
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          ) : !logs || logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-[#ACADB1]">
              <Activity className="w-12 h-12 mb-4 opacity-30" />
              <p className="text-sm">No activity yet. Actions you take will appear here.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {logs.map((log) => {
                const meta = eventMeta(log.eventType);
                const Icon = meta.icon;
                return (
                  <div
                    key={log.id}
                    className="flex items-start gap-3 px-4 py-3 rounded-lg border border-[#D4D8DF]/60 bg-white/30 hover:bg-white transition-colors"
                  >
                    <div className="shrink-0 mt-0.5">
                      <Icon className="w-4 h-4 text-[#ACADB1]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={`text-[10px] font-mono border ${meta.color}`}>
                          {log.eventType}
                        </Badge>
                        {log.resourceType && log.resourceId && (
                          <span className="text-[10px] font-mono text-[#ACADB1]">
                            {log.resourceType}#{log.resourceId}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-[#353536] mt-1">{log.description}</p>
                    </div>
                    <div className="shrink-0 text-xs text-[#ACADB1] whitespace-nowrap mt-0.5">
                      {format(parseISO(log.createdAt), "MMM d, HH:mm:ss")}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
