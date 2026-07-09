import React, { useState } from "react";
import { BarChart3, TrendingUp, PhoneCall, Clock, Calculator, Mic, MessageSquare, Volume2, CheckCircle2, XCircle, ChevronDown, ChevronRight } from "lucide-react";
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
function formatMinutes(totalMinutes: number): string {
  if (totalMinutes >= 100) return `${Math.round(totalMinutes)}`;
  return totalMinutes.toFixed(1);
}
function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

const SERVICE_META: Record<string, { label: string; icon: React.ElementType }> = {
  stt: { label: "Speech-to-Text", icon: Mic },
  llm: { label: "Language Model",  icon: MessageSquare },
  tts: { label: "Text-to-Speech",  icon: Volume2 },
};

function SummaryCard({
  icon: Icon, label, value, sub,
}: { icon: React.ElementType; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="h-9 w-9 rounded-xl bg-elevated border border-border flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-muted-foreground/60" />
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">{label}</p>
      </div>
      <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground/50 mt-1">{sub}</p>}
    </div>
  );
}

function ProviderPills({ providers }: { providers: { service: string; provider: string; model: string | null }[] }) {
  if (providers.length === 0) return <span className="text-xs text-muted-foreground/40">No AI service data recorded</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {providers.map((p, i) => {
        const meta = SERVICE_META[p.service] ?? { label: p.service.toUpperCase(), icon: BarChart3 };
        const Icon = meta.icon;
        return (
          <span key={i} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-elevated border border-border text-muted-foreground/70">
            <Icon className="w-3 h-3 text-muted-foreground/50" />
            {p.provider}{p.model ? ` / ${p.model}` : ""}
          </span>
        );
      })}
    </div>
  );
}

function CallChargeRowItem({ c }: { c: any }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        className="border-b border-border/40 last:border-0 hover:bg-elevated/40 transition-colors cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        <td className="py-2.5 pl-4 pr-2 whitespace-nowrap">
          {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40" />}
        </td>
        <td className="py-2.5 pr-3 whitespace-nowrap">
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
            ${((Math.abs(c.amountCents) + (c.aiServiceCostMicros ?? 0) / 10_000) / 100).toFixed(2)}
          </span>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border/40 last:border-0 bg-elevated/20">
          <td colSpan={4} className="px-4 py-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Platform Fee</p>
                <p className="text-sm font-semibold text-foreground tabular-nums mt-0.5">${(Math.abs(c.amountCents) / 100).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">STT Cost</p>
                <p className="text-sm font-semibold text-foreground tabular-nums mt-0.5">{microsToUsd(c.sttCostMicros ?? 0)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">LLM Cost</p>
                <p className="text-sm font-semibold text-foreground tabular-nums mt-0.5">{microsToUsd(c.llmCostMicros ?? 0)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">TTS Cost</p>
                <p className="text-sm font-semibold text-foreground tabular-nums mt-0.5">{microsToUsd(c.ttsCostMicros ?? 0)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Total Cost</p>
                <p className="text-sm font-semibold text-foreground tabular-nums mt-0.5">
                  ${((Math.abs(c.amountCents) + (c.aiServiceCostMicros ?? 0) / 10_000) / 100).toFixed(4)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Call Duration</p>
                <p className="text-sm font-semibold text-foreground tabular-nums mt-0.5">{formatDuration(c.durationSeconds)}</p>
              </div>
              <div className="col-span-2 sm:col-span-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-1.5">Providers / Models</p>
                <ProviderPills providers={c.providers ?? []} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function UsagePage() {
  const { data, isLoading, error } = useGetMyUsage();
  const currentMonth = format(new Date(), "MMMM yyyy");

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Usage</h1>
        <p className="text-sm text-muted-foreground/60 mt-0.5">{currentMonth} · Your billing and cost breakdown</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[0,1,2,3].map(i => <div key={i} className="h-24 rounded-2xl bg-card border border-border animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="bg-card border border-border rounded-2xl p-5">
          <p className="text-sm text-muted-foreground">Failed to load usage data. Please try again later.</p>
        </div>
      ) : data ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard
              icon={TrendingUp}
              label="Total Spend"
              value={microsToUsdShort(data.totalSpendMicros ?? data.totalUsedMicros)}
              sub="This month"
            />
            <SummaryCard
              icon={PhoneCall}
              label="Total Calls"
              value={String(data.totalCalls ?? 0)}
              sub="This month"
            />
            <SummaryCard
              icon={Clock}
              label="Total Minutes"
              value={formatMinutes(data.totalMinutes ?? 0)}
              sub="Talk time"
            />
            <SummaryCard
              icon={Calculator}
              label="Avg Cost / Call"
              value={microsToUsdShort(data.avgCostPerCallMicros ?? 0)}
              sub="This month"
            />
          </div>

          {/* Call charges */}
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-3">Call Charges</h2>
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
                        <th className="w-8 py-2.5 pl-4"></th>
                        <th className="text-left py-2.5 pr-3 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Time</th>
                        <th className="text-left py-2.5 pr-3 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Description</th>
                        <th className="text-right py-2.5 pr-4 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Charged</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.callCharges.recentCharges.map((c: any) => (
                        <CallChargeRowItem key={c.id} c={c} />
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
