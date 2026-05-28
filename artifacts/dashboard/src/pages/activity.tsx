import React from "react";
import { format, parseISO } from "date-fns";
import { Activity, Bot, Phone, Key, BookOpen, Wallet, RefreshCw, Settings } from "lucide-react";
import { useListActivityLogs, getListActivityLogsQueryKey } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const EVENT_META: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  "agent.created":                 { label: "Agent Created",          color: "bg-muted text-foreground border-border",                        icon: Bot },
  "agent.deleted":                 { label: "Agent Deleted",          color: "bg-red-500/10 text-red-500 border-red-500/20",                  icon: Bot },
  "agent.toggled":                 { label: "Agent Toggled",          color: "bg-blue-500/10 text-blue-400 border-blue-500/20",               icon: Bot },
  "call.started":                  { label: "Call Started",           color: "bg-violet-500/10 text-violet-500 border-violet-500/20",         icon: Phone },
  "call.ended":                    { label: "Call Ended",             color: "bg-muted text-muted-foreground border-border/50",               icon: Phone },
  "provider.added":                { label: "Provider Added",         color: "bg-muted text-foreground border-border",                        icon: Key },
  "provider.deleted":              { label: "Provider Deleted",       color: "bg-red-500/10 text-red-500 border-red-500/20",                  icon: Key },
  "knowledge_base.created":        { label: "KB Created",             color: "bg-amber-500/10 text-amber-600 border-amber-500/20",            icon: BookOpen },
  "knowledge_base.deleted":        { label: "KB Deleted",             color: "bg-red-500/10 text-red-500 border-red-500/20",                  icon: BookOpen },
  "account.api_key_regenerated":   { label: "API Key Regenerated",    color: "bg-orange-500/10 text-orange-400 border-orange-500/20",         icon: RefreshCw },
  "account.concurrent_slot_added": { label: "Concurrent Slot Added",  color: "bg-blue-500/10 text-blue-400 border-blue-500/20",               icon: Settings },
  "wallet.topup":                  { label: "Wallet Top-up",          color: "bg-muted text-foreground border-border",                        icon: Wallet },
};

function eventMeta(type: string) {
  return EVENT_META[type] ?? { label: type, color: "bg-muted text-muted-foreground border-border/50", icon: Activity };
}

export default function ActivityPage() {
  const { data: logs, isLoading } = useListActivityLogs(
    {},
    { query: { queryKey: getListActivityLogsQueryKey({}) } }
  );

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="border-b border-border px-6 py-4 flex items-center gap-3 shrink-0">
        <Activity className="w-5 h-5 text-foreground" />
        <h1 className="font-semibold text-foreground text-lg">Activity Log</h1>
        <span className="text-xs text-muted-foreground ml-auto">Audit trail of all platform events</span>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-3 rounded-lg border border-border bg-card">
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
            <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
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
                    className="flex items-start gap-3 px-4 py-3 rounded-lg border border-border/50 bg-card hover:bg-muted/30 transition-colors"
                  >
                    <div className="shrink-0 mt-0.5">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={`text-[10px] font-mono border ${meta.color}`}>
                          {log.eventType}
                        </Badge>
                        {log.resourceType && log.resourceId && (
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {log.resourceType}#{log.resourceId}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-foreground mt-1">{log.description}</p>
                    </div>
                    <div className="shrink-0 text-xs text-muted-foreground whitespace-nowrap mt-0.5">
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
