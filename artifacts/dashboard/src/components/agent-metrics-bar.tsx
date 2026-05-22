import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { computePipelineCost } from "@/lib/provider-pricing";

interface AgentMetricsBarProps {
  asrProvider: string;
  llmProvider: string;
  llmModel?: string | null;
  ttsProvider: string;
  telephonyProvider: string;
  avgSttLatencyMs?: number | null;
  avgLlmLatencyMs?: number | null;
  avgTtsFirstChunkMs?: number | null;
}

const COST_COLORS = {
  asr:       { bg: "bg-teal-500",    text: "text-teal-600",    label: "ASR" },
  llm:       { bg: "bg-violet-500",  text: "text-violet-600",  label: "LLM" },
  tts:       { bg: "bg-orange-500",  text: "text-orange-600",  label: "TTS" },
  telephony: { bg: "bg-blue-500",    text: "text-blue-600",    label: "Tel" },
  platform:  { bg: "bg-emerald-500", text: "text-emerald-600", label: "Fee" },
};

const LATENCY_COLORS = {
  stt: { bg: "bg-sky-500",    text: "text-sky-600",    label: "STT" },
  llm: { bg: "bg-violet-500", text: "text-violet-600", label: "LLM" },
  tts: { bg: "bg-amber-500",  text: "text-amber-600",  label: "TTS" },
};

function SegmentBar({
  segments,
}: {
  segments: { key: string; pct: number; bg: string; tooltip: string }[];
}) {
  return (
    <div className="flex h-1.5 w-full rounded-full overflow-hidden gap-[1px] bg-black/[0.06]">
      {segments.map((s) => (
        <Tooltip key={s.key}>
          <TooltipTrigger asChild>
            <div
              className={`h-full ${s.bg} transition-all rounded-sm`}
              style={{ width: `${Math.max(s.pct, 2)}%` }}
            />
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-[11px]">
            {s.tooltip}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

export function AgentMetricsBar({
  asrProvider,
  llmProvider,
  llmModel,
  ttsProvider,
  telephonyProvider,
  avgSttLatencyMs,
  avgLlmLatencyMs,
  avgTtsFirstChunkMs,
}: AgentMetricsBarProps) {
  const cost = computePipelineCost(asrProvider, llmProvider, llmModel, ttsProvider, telephonyProvider);

  const total = cost.totalPerMin;
  const costSegments = (
    [
      { key: "asr",       value: cost.asr.costPerMin,       ...COST_COLORS.asr },
      { key: "llm",       value: cost.llm.costPerMin,       ...COST_COLORS.llm },
      { key: "tts",       value: cost.tts.costPerMin,       ...COST_COLORS.tts },
      { key: "telephony", value: cost.telephony.costPerMin, ...COST_COLORS.telephony },
      { key: "platform",  value: cost.platform.costPerMin,  ...COST_COLORS.platform },
    ] as const
  ).map((s) => ({
    key: s.key,
    pct: (s.value / total) * 100,
    bg: s.bg,
    tooltip: `${s.label}: $${s.value.toFixed(4)}/min`,
  }));

  const hasLatency = avgSttLatencyMs != null || avgLlmLatencyMs != null || avgTtsFirstChunkMs != null;
  const totalLatencyMs = (avgSttLatencyMs ?? 0) + (avgLlmLatencyMs ?? 0) + (avgTtsFirstChunkMs ?? 0);
  const displayLatencyMs = totalLatencyMs || 0;

  const latencySegments = hasLatency
    ? [
        {
          key: "stt",
          pct: totalLatencyMs > 0 ? ((avgSttLatencyMs ?? 0) / totalLatencyMs) * 100 : 33,
          bg: LATENCY_COLORS.stt.bg,
          tooltip: `STT: ${avgSttLatencyMs ?? 0}ms`,
        },
        {
          key: "llm",
          pct: totalLatencyMs > 0 ? ((avgLlmLatencyMs ?? 0) / totalLatencyMs) * 100 : 34,
          bg: LATENCY_COLORS.llm.bg,
          tooltip: `LLM: ${avgLlmLatencyMs ?? 0}ms`,
        },
        {
          key: "tts",
          pct: totalLatencyMs > 0 ? ((avgTtsFirstChunkMs ?? 0) / totalLatencyMs) * 100 : 33,
          bg: LATENCY_COLORS.tts.bg,
          tooltip: `TTS: ${avgTtsFirstChunkMs ?? 0}ms`,
        },
      ]
    : null;

  function fmtLatency(ms: number) {
    return ms >= 1000 ? `~${(ms / 1000).toFixed(1)}s` : `~${Math.round(ms).toLocaleString()}ms`;
  }

  return (
    <div className="flex items-stretch gap-0 border-b border-black/[0.07] bg-white shrink-0">
      {/* Cost */}
      <div className="flex-1 flex flex-col gap-1.5 px-5 py-2.5 border-r border-black/[0.07]">
        <div className="flex items-baseline gap-2">
          <span className="text-[9px] font-bold tracking-[0.15em] uppercase text-black/35">
            Average Cost
          </span>
          <span className="text-xs font-bold text-black/80 tabular-nums">
            ~${cost.totalPerMin.toFixed(2)}{" "}
            <span className="text-[10px] font-normal text-black/35">/min</span>
          </span>
        </div>
        <SegmentBar segments={costSegments} />
        <div className="flex items-center gap-3">
          {(["asr", "llm", "tts", "telephony", "platform"] as const).map((k) => (
            <span key={k} className={`text-[9px] ${COST_COLORS[k].text} flex items-center gap-0.5`}>
              <span className={`w-1.5 h-1.5 rounded-full ${COST_COLORS[k].bg} inline-block`} />
              {COST_COLORS[k].label}
            </span>
          ))}
        </div>
      </div>

      {/* Latency */}
      <div className="flex-1 flex flex-col gap-1.5 px-5 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[9px] font-bold tracking-[0.15em] uppercase text-black/35">
            Average Latency
          </span>
          {hasLatency ? (
            <span className="text-xs font-bold text-black/80 tabular-nums">
              {fmtLatency(displayLatencyMs)}{" "}
              <span className="text-[10px] font-normal text-black/35">e2e</span>
            </span>
          ) : (
            <span className="text-[10px] text-black/30 italic">no data yet</span>
          )}
        </div>
        {latencySegments ? (
          <SegmentBar segments={latencySegments} />
        ) : (
          <div className="h-1.5 w-full rounded-full bg-black/[0.06]" />
        )}
        <div className="flex items-center gap-3">
          {(["stt", "llm", "tts"] as const).map((k) => (
            <span key={k} className={`text-[9px] ${LATENCY_COLORS[k].text} flex items-center gap-0.5`}>
              <span className={`w-1.5 h-1.5 rounded-full ${LATENCY_COLORS[k].bg} inline-block`} />
              {LATENCY_COLORS[k].label}
            </span>
          ))}
          {hasLatency && (
            <span className="text-[9px] text-black/30 ml-auto">
              {avgSttLatencyMs != null && `${avgSttLatencyMs}+`}
              {avgLlmLatencyMs != null && `${avgLlmLatencyMs}+`}
              {avgTtsFirstChunkMs != null && `${avgTtsFirstChunkMs}`}ms
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
