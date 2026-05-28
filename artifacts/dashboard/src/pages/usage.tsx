import React from "react";
import { BarChart3, TrendingUp, Zap, Mic, MessageSquare, Volume2, CheckCircle2, XCircle } from "lucide-react";
import { useGetMyUsage } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { format, parseISO } from "date-fns";

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function microsToUsd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

function microsToUsdShort(micros: number): string {
  const usd = micros / 1_000_000;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}

const SERVICE_META: Record<string, { label: string; icon: React.ElementType; iconClass: string; textClass: string }> = {
  stt: { label: "Speech-to-Text", icon: Mic,           iconClass: "bg-indigo-500/10", textClass: "text-indigo-500" },
  llm: { label: "Language Model", icon: MessageSquare,  iconClass: "bg-emerald-500/10", textClass: "text-emerald-500" },
  tts: { label: "Text-to-Speech", icon: Volume2,        iconClass: "bg-amber-500/10",   textClass: "text-amber-500" },
};

function ServiceCard({
  service,
  usedMicros,
  allocatedMicros,
  remainingMicros,
  eventCount,
}: {
  service: string;
  usedMicros: number;
  allocatedMicros: number;
  remainingMicros: number;
  eventCount: number;
}) {
  const meta = SERVICE_META[service] ?? { label: service.toUpperCase(), icon: BarChart3, iconClass: "bg-muted", textClass: "text-muted-foreground" };
  const Icon = meta.icon;
  const hasAllocation = allocatedMicros > 0;
  const pct = hasAllocation ? Math.min(100, (usedMicros / allocatedMicros) * 100) : 0;
  const isOverBudget = hasAllocation && usedMicros > allocatedMicros;

  return (
    <Card className="border border-border/50 shadow-sm">
      <CardContent className="pt-5 pb-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className={`rounded-lg p-2 ${meta.iconClass}`}>
              <Icon className={`w-4 h-4 ${meta.textClass}`} />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{meta.label}</p>
              <p className="text-xs text-muted-foreground">{eventCount} events this month</p>
            </div>
          </div>
          <p className="text-lg font-bold text-foreground tabular-nums">{microsToUsdShort(usedMicros)}</p>
        </div>

        {hasAllocation && (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {isOverBudget
                  ? <span className="text-red-500 font-medium">Over budget</span>
                  : `${microsToUsdShort(remainingMicros)} remaining`}
              </span>
              <span>of {microsToUsdShort(allocatedMicros)}</span>
            </div>
            <Progress
              value={pct}
              className="h-1.5"
              style={isOverBudget ? { "--progress-color": "#EF4444" } as React.CSSProperties : undefined}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */
export default function UsagePage() {
  const { data, isLoading, error } = useGetMyUsage();

  const currentMonth = format(new Date(), "MMMM yyyy");

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Usage</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{currentMonth} · Your AI service consumption and costs</p>
      </div>

      {/* Total summary */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : error ? (
        <Card className="border-red-500/20 bg-red-500/10">
          <CardContent className="pt-5">
            <p className="text-sm text-red-500">Failed to load usage data. Please try again later.</p>
          </CardContent>
        </Card>
      ) : data ? (
        <>
          {/* Total spend card */}
          <Card className="border border-border/50 shadow-sm">
            <CardContent className="pt-6 pb-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl p-2.5 bg-muted shadow-sm border border-border/50">
                    <TrendingUp className="w-5 h-5 text-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total spend this month</p>
                    <p className="text-3xl font-bold text-foreground tabular-nums mt-0.5">
                      {microsToUsdShort(data.totalUsedMicros)}
                    </p>
                  </div>
                </div>

                {(data.totalAllocatedMicros ?? 0) > 0 && (
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground font-medium">Budget</p>
                    <p className="text-sm font-semibold text-foreground tabular-nums mt-0.5">
                      {microsToUsdShort(data.totalAllocatedMicros ?? 0)}
                    </p>
                    <Badge
                      variant="outline"
                      className="mt-1 text-xs"
                      style={
                        (data.totalRemainingMicros ?? 0) <= 0
                          ? { background: "hsl(var(--destructive)/0.1)", color: "#DC2626", border: "1px solid hsl(var(--destructive)/0.3)" }
                          : { background: "#F0FDF4", color: "#15803D", border: "1px solid #BBF7D0" }
                      }
                    >
                      {(data.totalRemainingMicros ?? 0) > 0
                        ? `${microsToUsdShort(data.totalRemainingMicros ?? 0)} left`
                        : "Budget exceeded"}
                    </Badge>
                  </div>
                )}
              </div>

              {(data.totalAllocatedMicros ?? 0) > 0 && (
                <div className="mt-4">
                  <Progress
                    value={Math.min(100, ((data.totalUsedMicros) / (data.totalAllocatedMicros ?? 1)) * 100)}
                    className="h-2"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Per-service cards */}
          {data.perService.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {data.perService.map((row) => (
                <ServiceCard key={row.service} {...row} />
              ))}
            </div>
          ) : (
            <Card className="border border-border/50">
              <CardContent className="pt-8 pb-8 text-center">
                <BarChart3 className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No usage recorded this month yet.</p>
                <p className="text-xs text-muted-foreground/70 mt-1">Start running calls to see your cost breakdown here.</p>
              </CardContent>
            </Card>
          )}

          {/* Recent events */}
          <div>
            <h2 className="text-base font-semibold text-foreground mb-3">Recent Events</h2>
            {data.recentEvents.length === 0 ? (
              <Card className="border border-border/50">
                <CardContent className="pt-6 pb-6 text-center">
                  <p className="text-sm text-muted-foreground">No usage events yet.</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="border border-border/50 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border/50 bg-muted/50">
                        <th className="text-left py-2.5 px-4 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Time</th>
                        <th className="text-left py-2.5 pr-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Service</th>
                        <th className="text-left py-2.5 pr-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Provider / Model</th>
                        <th className="text-left py-2.5 pr-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Usage</th>
                        <th className="text-right py-2.5 pr-4 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="px-4">
                      {data.recentEvents.map((e) => (
                        <tr key={e.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="py-2.5 pl-4 pr-3">
                            <div className="flex items-center gap-2">
                              {e.success
                                ? <CheckCircle2 className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                                : <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                {format(parseISO(e.createdAt), "MMM d, HH:mm")}
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 pr-3">
                            <div className="flex items-center gap-1.5">
                              {SERVICE_META[e.service] && React.createElement(SERVICE_META[e.service]!.icon, {
                                className: `w-3 h-3 ${SERVICE_META[e.service]!.textClass}`,
                              })}
                              <span className="text-xs font-medium text-foreground capitalize">{e.service}</span>
                            </div>
                          </td>
                          <td className="py-2.5 pr-3">
                            <span className="text-xs text-foreground/80">{e.provider}</span>
                            {e.model && <span className="text-xs text-muted-foreground ml-1">/ {e.model}</span>}
                          </td>
                          <td className="py-2.5 pr-3">
                            {e.service === "llm" && (e.inputTokens || e.outputTokens)
                              ? <span className="text-xs text-muted-foreground">{e.inputTokens}↑ {e.outputTokens}↓ tokens</span>
                              : e.service === "stt" && e.audioSeconds
                              ? <span className="text-xs text-muted-foreground">{e.audioSeconds}s</span>
                              : e.service === "tts" && e.characters
                              ? <span className="text-xs text-muted-foreground">{e.characters} chars</span>
                              : null}
                          </td>
                          <td className="py-2.5 pr-4 text-right">
                            <span className="text-xs font-semibold text-foreground tabular-nums">
                              {microsToUsd(e.estimatedCostMicros)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
