import React, { useState } from "react";
import { BarChart3, TrendingUp, PhoneCall, Clock, Calculator, Mic, MessageSquare, Volume2, PhoneOutgoing, Receipt, ChevronDown, ChevronRight } from "lucide-react";
import { useGetMyUsage } from "@workspace/api-client-react";
import { format, parseISO } from "date-fns";

function microsToInr(micros: number): string {
  return `₹${(micros / 1_000_000).toFixed(4)}`;
}
function microsToInrShort(micros: number): string {
  const inr = micros / 1_000_000;
  if (inr >= 1) return `₹${inr.toFixed(2)}`;
  return `₹${inr.toFixed(4)}`;
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

function ProviderBadge({ service, provider, model }: { service: string; provider?: string | null; model?: string | null }) {
  const meta = SERVICE_META[service] ?? { label: service.toUpperCase(), icon: BarChart3 };
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md bg-elevated border border-border text-muted-foreground/70 whitespace-nowrap">
      <Icon className="w-3 h-3 text-muted-foreground/50" />
      {provider ? (
        <span>
          {provider}
          {model ? <span className="text-muted-foreground/40"> / {model}</span> : null}
        </span>
      ) : (
        <span className="text-muted-foreground/40">Not Available</span>
      )}
    </span>
  );
}

function LineItem({
  icon: Icon,
  label,
  service,
  provider,
  model,
  usageLabel,
  costMicros,
  available = true,
}: {
  icon: React.ElementType;
  label: string;
  service?: string;
  provider?: string | null;
  model?: string | null;
  usageLabel: string | null;
  costMicros: number | null | undefined;
  available?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-border/40 last:border-0">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="h-7 w-7 rounded-lg bg-elevated border border-border flex items-center justify-center shrink-0">
          <Icon className="w-3.5 h-3.5 text-muted-foreground/60" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground/80">{label}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            {service && <ProviderBadge service={service} provider={provider} model={model} />}
            {usageLabel && <span className="text-[11px] text-muted-foreground/50">{usageLabel}</span>}
          </div>
        </div>
      </div>
      <span className="text-xs font-semibold text-foreground tabular-nums shrink-0">
        {!available ? (
          <span className="text-muted-foreground/40 font-normal italic">Not Available</span>
        ) : costMicros == null ? (
          <span className="text-muted-foreground/40 font-normal italic">Pending</span>
        ) : (
          microsToInr(costMicros)
        )}
      </span>
    </div>
  );
}

function CallChargeRowItem({ c }: { c: any }) {
  const [open, setOpen] = useState(false);

  const stt = (c.providers ?? []).find((p: any) => p.service === "stt");
  const llm = (c.providers ?? []).find((p: any) => p.service === "llm");
  const tts = (c.providers ?? []).find((p: any) => p.service === "tts");

  const sttUsage = c.sttAudioSeconds ? `${c.sttAudioSeconds}s audio` : null;
  const llmUsage = (c.llmInputTokens || c.llmOutputTokens) ? `${c.llmInputTokens ?? 0}↑ ${c.llmOutputTokens ?? 0}↓ tokens` : null;
  const ttsUsage = c.ttsCharacters ? `${c.ttsCharacters} chars` : null;

  const grandTotalMicros = Math.abs(c.amountCents) * 10_000 + (c.aiServiceCostMicros ?? 0);

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
            {microsToInr(grandTotalMicros)}
          </span>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border/40 last:border-0 bg-elevated/20">
          <td colSpan={4} className="px-4 py-3">
            <div className="max-w-xl">
              <LineItem
                icon={Mic}
                label="Speech-to-Text"
                service="stt"
                provider={stt?.provider}
                model={stt?.model}
                usageLabel={sttUsage}
                costMicros={c.sttCostMicros}
                available={!!stt || (c.sttCostMicros ?? 0) > 0}
              />
              <LineItem
                icon={MessageSquare}
                label="Language Model"
                service="llm"
                provider={llm?.provider}
                model={llm?.model}
                usageLabel={llmUsage}
                costMicros={c.llmCostMicros}
                available={!!llm || (c.llmCostMicros ?? 0) > 0}
              />
              <LineItem
                icon={Volume2}
                label="Text-to-Speech"
                service="tts"
                provider={tts?.provider}
                model={tts?.model}
                usageLabel={ttsUsage}
                costMicros={c.ttsCostMicros}
                available={!!tts || (c.ttsCostMicros ?? 0) > 0}
              />
              <LineItem
                icon={PhoneOutgoing}
                label="Telephony"
                usageLabel={null}
                costMicros={null}
                available={false}
              />
              <LineItem
                icon={Receipt}
                label="Platform Fee"
                usageLabel={null}
                costMicros={Math.abs(c.amountCents) * 10_000}
              />
              <div className="flex items-center justify-between gap-3 py-2.5 border-b border-border/40">
                <div className="flex items-center gap-2.5">
                  <div className="h-7 w-7 rounded-lg bg-elevated border border-border flex items-center justify-center shrink-0">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground/60" />
                  </div>
                  <p className="text-xs font-medium text-foreground/80">Call Duration</p>
                </div>
                <span className="text-xs font-semibold text-foreground tabular-nums">{formatDuration(c.durationSeconds)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 pt-3">
                <p className="text-xs font-bold uppercase tracking-wider text-foreground">Grand Total</p>
                <span className="text-sm font-bold text-foreground tabular-nums">{microsToInr(grandTotalMicros)}</span>
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
              value={microsToInrShort(data.totalSpendMicros ?? data.totalUsedMicros)}
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
              value={microsToInrShort(data.avgCostPerCallMicros ?? 0)}
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
        </>
      ) : null}
    </div>
  );
}
