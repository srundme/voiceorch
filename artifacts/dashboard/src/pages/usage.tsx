import React from "react";
import { BarChart3, TrendingUp, Mic, MessageSquare, Volume2, CheckCircle2, XCircle, PhoneCall } from "lucide-react";
import { useGetMyUsage } from "@workspace/api-client-react";
import { format, parseISO } from "date-fns";

function microsToUsd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}
function microsToUsdShort(micros: number): string {
  const usd = micros / 1_000_000;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}

const SERVICE_META: Record<string, { label: string; icon: React.ElementType }> = {
  stt: { label: "Speech-to-Text", icon: Mic },
  llm: { label: "Language Model",  icon: MessageSquare },
  tts: { label: "Text-to-Speech",  icon: Volume2 },
};

function ServiceCard({
  service, usedMicros, allocatedMicros, remainingMicros, eventCount,
}: {
  service: string; usedMicros: number; allocatedMicros: number;
  remainingMicros: number; eventCount: number;
}) {
  const meta = SERVICE_META[service] ?? { label: service.toUpperCase(), icon: BarChart3 };
  const Icon = meta.icon;
  const hasAllocation = allocatedMicros > 0;
  const pct = hasAllocation ? Math.min(100, (usedMicros / allocatedMicros) * 100) : 0;
  const isOverBudget = hasAllocation && usedMicros > allocatedMicros;

  return (
    <div className="bg-card border border-border rounded-2xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-elevated border border-border flex items-center justify-center shrink-0">
            <Icon className="w-4 h-4 text-muted-foreground/60" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{meta.label}</p>
            <p className="text-xs text-muted-foreground/60">{eventCount} events</p>
          </div>
        </div>
        <p className="text-lg font-bold text-foreground tabular-nums">{microsToUsdShort(usedMicros)}</p>
      </div>
      {hasAllocation && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground/60">
            <span>{isOverBudget ? <span className="text-foreground font-medium">Over budget</span> : `${microsToUsdShort(remainingMicros)} remaining`}</span>
            <span>of {microsToUsdShort(allocatedMicros)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-elevated overflow-hidden">
            <div className={`h-full rounded-full transition-all ${isOverBudget ? "bg-foreground/80" : "bg-foreground/40"}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function UsagePage() {
  const { data, isLoading, error } = useGetMyUsage();
  const currentMonth = format(new Date(), "MMMM yyyy");

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Usage</h1>
        <p className="text-sm text-muted-foreground/60 mt-0.5">{currentMonth} · Your AI service consumption and costs</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0,1,2].map(i => <div key={i} className="h-24 rounded-2xl bg-card border border-border animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="bg-card border border-border rounded-2xl p-5">
          <p className="text-sm text-muted-foreground">Failed to load usage data. Please try again later.</p>
        </div>
      ) : data ? (
        <>
          {/* Total spend */}
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="h-11 w-11 rounded-xl bg-elevated border border-border flex items-center justify-center shrink-0">
                  <TrendingUp className="w-5 h-5 text-muted-foreground/60" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Total spend this month</p>
                  <p className="text-3xl font-bold text-foreground tabular-nums mt-0.5">{microsToUsdShort(data.totalUsedMicros)}</p>
                </div>
              </div>
              {(data.totalAllocatedMicros ?? 0) > 0 && (
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Budget</p>
                  <p className="text-sm font-semibold text-foreground tabular-nums mt-0.5">{microsToUsdShort(data.totalAllocatedMicros ?? 0)}</p>
                  <span className={`inline-block mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full border ${(data.totalRemainingMicros ?? 0) <= 0 ? "border-border text-muted-foreground bg-elevated" : "border-border text-muted-foreground bg-elevated"}`}>
                    {(data.totalRemainingMicros ?? 0) > 0 ? `${microsToUsdShort(data.totalRemainingMicros ?? 0)} left` : "Budget exceeded"}
                  </span>
                </div>
              )}
            </div>
            {(data.totalAllocatedMicros ?? 0) > 0 && (
              <div className="mt-5 h-1.5 rounded-full bg-elevated overflow-hidden">
                <div className="h-full rounded-full bg-foreground/30 transition-all" style={{ width: `${Math.min(100, (data.totalUsedMicros / (data.totalAllocatedMicros ?? 1)) * 100)}%` }} />
              </div>
            )}
          </div>

          {/* Per-service AI costs */}
          {data.perService.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {data.perService.map(row => <ServiceCard key={row.service} {...row} />)}
            </div>
          ) : (
            <div className="bg-card border border-border rounded-2xl p-10 flex flex-col items-center text-center gap-2">
              <div className="h-12 w-12 rounded-2xl bg-elevated border border-border flex items-center justify-center mb-1">
                <BarChart3 className="w-5 h-5 text-muted-foreground/40" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">No usage recorded this month yet.</p>
              <p className="text-xs text-muted-foreground/50">Start running calls to see your cost breakdown here.</p>
            </div>
          )}

          {/* Call charges */}
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-3">Call Charges</h2>
            <div className="bg-card border border-border rounded-2xl p-5 mb-4">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-elevated border border-border flex items-center justify-center shrink-0">
                  <PhoneCall className="w-4 h-4 text-muted-foreground/60" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">Platform Call Fee</p>
                  <p className="text-xs text-muted-foreground/60">{data.callCharges.callCount} call{data.callCharges.callCount !== 1 ? "s" : ""} this month</p>
                </div>
                <p className="text-lg font-bold text-foreground tabular-nums">
                  ${(data.callCharges.totalCents / 100).toFixed(2)}
                </p>
              </div>
            </div>

            {data.callCharges.recentCharges.length === 0 ? (
              <div className="bg-card border border-border rounded-2xl p-6 text-center">
                <p className="text-sm text-muted-foreground/60">No call charges yet.</p>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2.5 px-4 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Time</th>
                        <th className="text-left py-2.5 pr-3 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Description</th>
                        <th className="text-right py-2.5 pr-4 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Charged</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.callCharges.recentCharges.map(c => (
                        <tr key={c.id} className="border-b border-border/40 last:border-0 hover:bg-elevated/40 transition-colors">
                          <td className="py-2.5 pl-4 pr-3 whitespace-nowrap">
                            <span className="text-xs text-muted-foreground/60">{format(parseISO(c.createdAt), "MMM d, HH:mm")}</span>
                          </td>
                          <td className="py-2.5 pr-3">
                            <div className="flex items-center gap-1.5">
                              <PhoneCall className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                              <span className="text-xs text-foreground/70">{c.description}</span>
                            </div>
                          </td>
                          <td className="py-2.5 pr-4 text-right">
                            <span className="text-xs font-semibold text-foreground tabular-nums">
                              ${(Math.abs(c.amountCents) / 100).toFixed(2)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Recent AI service events */}
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-3">Recent AI Service Events</h2>
            {data.recentEvents.length === 0 ? (
              <div className="bg-card border border-border rounded-2xl p-6 text-center">
                <p className="text-sm text-muted-foreground/60">No usage events yet.</p>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2.5 px-4 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Time</th>
                        <th className="text-left py-2.5 pr-3 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Service</th>
                        <th className="text-left py-2.5 pr-3 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Provider / Model</th>
                        <th className="text-left py-2.5 pr-3 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Usage</th>
                        <th className="text-right py-2.5 pr-4 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentEvents.map(e => (
                        <tr key={e.id} className="border-b border-border/40 last:border-0 hover:bg-elevated/40 transition-colors">
                          <td className="py-2.5 pl-4 pr-3">
                            <div className="flex items-center gap-2">
                              {e.success
                                ? <CheckCircle2 className="w-3.5 h-3.5 text-foreground/30 shrink-0" />
                                : <XCircle className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0" />}
                              <span className="text-xs text-muted-foreground/60 whitespace-nowrap">{format(parseISO(e.createdAt), "MMM d, HH:mm")}</span>
                            </div>
                          </td>
                          <td className="py-2.5 pr-3">
                            <div className="flex items-center gap-1.5">
                              {SERVICE_META[e.service] && React.createElement(SERVICE_META[e.service]!.icon, { className: "w-3 h-3 text-muted-foreground/50" })}
                              <span className="text-xs font-medium text-foreground/70 capitalize">{e.service}</span>
                            </div>
                          </td>
                          <td className="py-2.5 pr-3">
                            <span className="text-xs text-muted-foreground/60">{e.provider}</span>
                            {e.model && <span className="text-xs text-muted-foreground/40 ml-1">/ {e.model}</span>}
                          </td>
                          <td className="py-2.5 pr-3">
                            {e.service === "llm" && (e.inputTokens || e.outputTokens)
                              ? <span className="text-xs text-muted-foreground/60">{e.inputTokens}↑ {e.outputTokens}↓ tokens</span>
                              : e.service === "stt" && e.audioSeconds
                              ? <span className="text-xs text-muted-foreground/60">{e.audioSeconds}s</span>
                              : e.service === "tts" && e.characters
                              ? <span className="text-xs text-muted-foreground/60">{e.characters} chars</span>
                              : null}
                          </td>
                          <td className="py-2.5 pr-4 text-right">
                            <span className="text-xs font-semibold text-foreground tabular-nums">{microsToUsd(e.estimatedCostMicros)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
