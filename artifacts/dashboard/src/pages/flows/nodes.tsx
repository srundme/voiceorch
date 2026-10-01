import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import {
  AlertCircle,
  CalendarClock,
  GitFork,
  Mail,
  MessageCircle,
  Phone,
  Sheet,
  Split,
  Timer,
  Video,
  Webhook,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FlowStep, FlowTrigger, StepCounts, StepType } from "./api";

export const STEP_META: Record<StepType, { label: string; hint: string; icon: LucideIcon; tone: string; group: "action" | "logic" }> = {
  make_call: { label: "AI call", hint: "Call the person with an agent", icon: Phone, tone: "text-sky-600 bg-sky-500/10", group: "action" },
  send_whatsapp: { label: "WhatsApp", hint: "Send an approved template", icon: MessageCircle, tone: "text-emerald-600 bg-emerald-500/10", group: "action" },
  send_email: { label: "Email", hint: "Send an email", icon: Mail, tone: "text-violet-600 bg-violet-500/10", group: "action" },
  send_webhook: { label: "Webhook", hint: "POST everything to a URL", icon: Webhook, tone: "text-orange-600 bg-orange-500/10", group: "action" },
  update_sheet: { label: "Update sheet", hint: "Write status to the sheet row", icon: Sheet, tone: "text-green-700 bg-green-500/10", group: "action" },
  schedule_callback: { label: "Schedule callback", hint: "Auto-dial again later", icon: CalendarClock, tone: "text-amber-600 bg-amber-500/10", group: "action" },
  join_meeting: { label: "Join meeting", hint: "Send an agent into Meet/Zoom", icon: Video, tone: "text-indigo-600 bg-indigo-500/10", group: "action" },
  delay: { label: "Wait", hint: "Pause before the next step", icon: Timer, tone: "text-slate-600 bg-slate-500/10", group: "logic" },
  condition: { label: "Yes / No", hint: "Check one thing, two paths", icon: Split, tone: "text-pink-600 bg-pink-500/10", group: "logic" },
  branch: { label: "Branch", hint: "Several paths, first match wins", icon: GitFork, tone: "text-fuchsia-600 bg-fuchsia-500/10", group: "logic" },
};

export const TRIGGER_LABEL: Record<FlowTrigger["type"], string> = {
  manual: "Manual / people list",
  form_lead: "Website form / API",
  instagram_lead: "Instagram / Meta lead ad",
};

export function formatDelay(secs: number | undefined): string {
  const s = Number(secs) || 0;
  if (s <= 0) return "Not set";
  if (s % 86400 === 0) return `${s / 86400} day${s === 86400 ? "" : "s"}`;
  if (s % 3600 === 0) return `${s / 3600} hour${s === 3600 ? "" : "s"}`;
  if (s % 60 === 0) return `${s / 60} min`;
  return `${s}s`;
}

const OP_TEXT: Record<string, string> = {
  eq: "is", neq: "is not", contains: "contains", exists: "is set", gt: ">", lt: "<",
};

export function describeCheck(field?: string, op?: string, value?: string): string {
  if (!field) return "Not set";
  if (field === "__stop") return "Stop";
  const f = field.startsWith("__visits.") ? "times step ran" : field;
  return op === "exists" ? `${f} is set` : `${f} ${OP_TEXT[op ?? "eq"] ?? op} ${value ?? ""}`.trim();
}

/** One-line summary under the node title. */
export function stepSummary(step: FlowStep, agentName: (id?: number) => string): string {
  switch (step.type) {
    case "make_call": return step.agentId ? `with ${agentName(step.agentId)}` : "Pick an agent";
    case "schedule_callback": return `in ${step.callbackDelayDays ?? 0} day(s)`;
    case "delay": return formatDelay(step.delaySeconds);
    case "send_webhook": return step.url ? step.url.replace(/^https?:\/\//, "").slice(0, 32) : "Add URL";
    case "send_whatsapp": return step.whatsappTemplate?.name || (step.whatsappHint ?? "call_summary").replace(/_/g, " ");
    case "send_email": return step.emailSubject || "Default follow-up";
    case "update_sheet": return `${step.sheetStatusColumn || "Status"} = ${step.sheetStatusValue || "outcome"}`;
    case "join_meeting": return "Meeting link from person";
    case "condition": return describeCheck(step.field, step.op, step.value);
    case "branch": return `${(step.cases ?? []).length} path(s) + otherwise`;
  }
}

export type StepNodeData = {
  step: FlowStep;
  summary: string;
  issues: string[];
  counts?: StepCounts;
  isEntry: boolean;
};

export type TriggerNodeData = {
  trigger: FlowTrigger;
  connected: boolean;
};

const handleCls = "!size-2.5 !border-2 !border-background !bg-muted-foreground";

function OutHandle({ id, label, left, tone }: { id: string; label: string; left: string; tone?: string }) {
  return (
    <div className="absolute -bottom-5 -translate-x-1/2" style={{ left }}>
      <span className={cn("pointer-events-none block whitespace-nowrap text-center text-[10px] font-medium leading-none", tone ?? "text-muted-foreground")}>
        {label}
      </span>
      <Handle
        type="source"
        position={Position.Bottom}
        id={id}
        className={handleCls}
        style={{ left: "50%", bottom: -8 }}
      />
    </div>
  );
}

function CountChips({ counts, step }: { counts?: StepCounts; step: FlowStep }) {
  if (!counts || counts.ran + counts.waiting === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1 text-[10px] font-medium">
      <span className="rounded bg-muted px-1.5 py-0.5 text-foreground">{counts.ran} ran</span>
      {step.type === "make_call" && (
        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300">{counts.connected} answered</span>
      )}
      {counts.sent > 0 && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300">{counts.sent} sent</span>}
      {counts.waiting > 0 && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">{counts.waiting} waiting</span>}
      {counts.skipped > 0 && <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{counts.skipped} skipped</span>}
      {counts.failed > 0 && <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-700 dark:text-red-300">{counts.failed} failed</span>}
    </div>
  );
}

export const StepNode = memo(function StepNode({ data, selected }: NodeProps<Node<StepNodeData>>) {
  const { step, summary, issues, counts } = data;
  const meta = STEP_META[step.type];
  const Icon = meta?.icon ?? Zap;
  const outputs: Array<{ id: string; label: string; tone?: string }> =
    step.type === "condition"
      ? [
          { id: "yes", label: "Yes", tone: "text-emerald-600" },
          { id: "no", label: "No", tone: "text-red-600" },
        ]
      : step.type === "branch"
        ? [
            ...(step.cases ?? []).map((c) => ({ id: `case:${c.id}`, label: c.label || "Path" })),
            { id: "otherwise", label: "Otherwise" },
          ]
        : [{ id: "next", label: "" }];

  return (
    <div
      className={cn(
        "relative w-[240px] rounded-xl border bg-card px-3 py-2.5 shadow-sm transition-shadow",
        selected ? "border-primary ring-2 ring-primary/25" : "border-border",
        issues.length > 0 && !selected && "border-amber-500/60",
      )}
      style={{ marginBottom: outputs.length > 1 ? 18 : 0 }}
    >
      <Handle type="target" position={Position.Top} className={handleCls} />
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", meta?.tone)}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[13px] font-semibold text-foreground">{step.label || meta?.label || step.type}</p>
            {issues.length > 0 && <AlertCircle className="size-3.5 shrink-0 text-amber-500" aria-label={issues[0]} />}
          </div>
          <p className="truncate text-[11px] text-muted-foreground">{summary}</p>
        </div>
      </div>
      <CountChips counts={counts} step={step} />
      {outputs.length === 1 ? (
        <Handle type="source" position={Position.Bottom} id="next" className={handleCls} />
      ) : (
        outputs.map((o, i) => (
          <OutHandle key={o.id} id={o.id} label={o.label} tone={o.tone} left={`${((i + 1) / (outputs.length + 1)) * 100}%`} />
        ))
      )}
    </div>
  );
});

export const TriggerNode = memo(function TriggerNode({ data, selected }: NodeProps<Node<TriggerNodeData>>) {
  return (
    <div
      className={cn(
        "w-[240px] rounded-xl border-2 border-dashed bg-card px-3 py-2.5",
        selected ? "border-primary" : "border-primary/40",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Zap className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Starts when</p>
          <p className="truncate text-[13px] font-semibold">{TRIGGER_LABEL[data.trigger.type] ?? data.trigger.type}</p>
        </div>
      </div>
      {!data.connected && <p className="mt-1.5 text-[11px] text-amber-600">Drag from the dot below to the first step</p>}
      <Handle type="source" position={Position.Bottom} id="out" className={handleCls} />
    </div>
  );
});

export const nodeTypes = { step: StepNode, trigger: TriggerNode };
