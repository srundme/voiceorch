/**
 * Reach → custom sequence step editor (Phase 5 + Phase 6 squad on Call).
 *
 * Edits JourneyStep[] in place for journeys with presetId "custom".
 * Execution stays on the existing workflow engine — this is UI only.
 */

import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight, Mail, MessageCircle,
  Phone, Plus, Trash2, Webhook, Clock, GitBranch, PhoneForwarded,
} from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const _DASH_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DASH_API = `${_DASH_BASE}/api`;

type SquadListItem = {
  id: number;
  name: string;
  status: string;
  members: Array<{ agentId: number; roleName?: string }>;
};

export type ReachStepType =
  | "make_call"
  | "delay"
  | "send_whatsapp"
  | "send_email"
  | "schedule_callback"
  | "send_webhook"
  | "condition"
  | "join_meeting"
  | "update_sheet";

export type ReachStep = {
  id: string;
  type: string;
  label?: string;
  agentId?: number;
  phoneField?: string;
  /** Optional Agent Squad for make_call — enables live handoffs on the dial. */
  squadId?: number | null;
  field?: string;
  op?: string;
  value?: string;
  delaySeconds?: number;
  callbackDelayDays?: number;
  url?: string;
  whatsappHint?: string;
  notes?: string;
  emailField?: string;
  emailSubject?: string;
  emailBody?: string;
  meetingUrlField?: string;
  sheetStatusColumn?: string;
  sheetStatusValue?: string;
};

const STEP_CATALOG: Array<{
  type: ReachStepType;
  title: string;
  desc: string;
  icon: React.ElementType;
}> = [
  { type: "make_call", title: "Call", desc: "Dial with this agent (optional squad)", icon: Phone },
  { type: "delay", title: "Wait", desc: "Pause before the next step", icon: Clock },
  { type: "send_whatsapp", title: "WhatsApp", desc: "Send a follow-up message", icon: MessageCircle },
  { type: "send_email", title: "Email", desc: "Send a follow-up email", icon: Mail },
  { type: "schedule_callback", title: "Callback", desc: "Schedule another dial later", icon: PhoneForwarded },
  { type: "send_webhook", title: "Webhook", desc: "Notify your CRM / Zap", icon: Webhook },
  { type: "condition", title: "If…", desc: "Continue only when a condition is true", icon: GitBranch },
];

function sid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultStep(type: ReachStepType, agentId: number): ReachStep {
  switch (type) {
    case "make_call":
      return { id: sid("call"), type, agentId, phoneField: "phone", label: "Call lead" };
    case "delay":
      return { id: sid("delay"), type, delaySeconds: 3600, label: "Wait 1 hour" };
    case "send_whatsapp":
      return {
        id: sid("wa"),
        type,
        agentId,
        phoneField: "phone",
        whatsappHint: "call_summary",
        label: "WhatsApp follow-up",
      };
    case "send_email":
      return {
        id: sid("email"),
        type,
        emailField: "email",
        label: "Email follow-up",
      };
    case "join_meeting":
      return {
        id: sid("meet"),
        type,
        agentId,
        meetingUrlField: "meetingUrl",
        label: "Join a meeting",
      };
    case "update_sheet":
      return {
        id: sid("sheet"),
        type,
        sheetStatusColumn: "Status",
        sheetStatusValue: "",
        label: "Update the list",
      };
    case "schedule_callback":
      return {
        id: sid("cb"),
        type,
        agentId,
        phoneField: "phone",
        callbackDelayDays: 5,
        notes: "Journey follow-up",
        label: "Callback in 5 days",
      };
    case "send_webhook":
      return { id: sid("wh"), type, url: "", label: "Notify webhook" };
    case "condition":
      return {
        id: sid("cond"),
        type,
        field: "call.connected",
        op: "eq",
        value: "false",
        label: "If no answer",
      };
  }
}

export function stepLabel(step: ReachStep): string {
  if (step.label?.trim()) return step.label.trim();
  switch (step.type) {
    case "make_call":
      return step.squadId ? "Call with squad handoffs" : "Call with this agent";
    case "send_whatsapp": return "WhatsApp follow-up";
    case "send_email": return "Email follow-up";
    case "join_meeting": return "Join a meeting";
    case "update_sheet": return "Update the list";
    case "schedule_callback":
      return step.callbackDelayDays
        ? `Callback in ${step.callbackDelayDays} days`
        : "Schedule callback";
    case "send_webhook": return "Notify webhook";
    case "delay": {
      const s = step.delaySeconds ?? 0;
      if (s >= 86400 && s % 86400 === 0) return `Wait ${s / 86400} day(s)`;
      if (s >= 3600 && s % 3600 === 0) return `Wait ${s / 3600} hour(s)`;
      if (s >= 60 && s % 60 === 0) return `Wait ${s / 60} minute(s)`;
      return s > 0 ? `Wait ${s}s` : "Wait";
    }
    case "condition": return "If condition…";
    case "wait": return "Wait";
    default: return step.type;
  }
}

function delayToUnit(seconds: number): { amount: number; unit: "minutes" | "hours" | "days" } {
  if (seconds >= 86400 && seconds % 86400 === 0) return { amount: seconds / 86400, unit: "days" };
  if (seconds >= 3600 && seconds % 3600 === 0) return { amount: seconds / 3600, unit: "hours" };
  return { amount: Math.max(1, Math.round(seconds / 60) || 60), unit: "minutes" };
}

function unitToSeconds(amount: number, unit: "minutes" | "hours" | "days"): number {
  const n = Math.max(1, Math.floor(amount) || 1);
  if (unit === "days") return n * 86400;
  if (unit === "hours") return n * 3600;
  return n * 60;
}

type Props = {
  steps: ReachStep[];
  agentId: number;
  onChange: (next: ReachStep[]) => void;
  readOnly?: boolean;
};

export function ReachStepEditor({ steps, agentId, onChange, readOnly = false }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const updateAt = (index: number, patch: Partial<ReachStep>) => {
    const next = steps.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onChange(next);
  };

  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    const tmp = next[index]!;
    next[index] = next[j]!;
    next[j] = tmp;
    onChange(next);
  };

  const remove = (index: number) => {
    const id = steps[index]?.id;
    onChange(steps.filter((_, i) => i !== index));
    if (expandedId === id) setExpandedId(null);
  };

  const add = (type: ReachStepType) => {
    const step = defaultStep(type, agentId);
    onChange([...steps, step]);
    setExpandedId(step.id);
    setAddOpen(false);
  };

  if (readOnly) {
    return (
      <ol className="space-y-1.5">
        {steps.map((step, idx) => (
          <li key={step.id} className="flex items-start gap-2 rounded-lg border border-border/40 bg-background/30 px-3 py-2">
            <span className="text-[10px] font-mono text-muted-foreground mt-0.5">{idx + 1}</span>
            <p className="text-xs font-medium">{stepLabel(step)}</p>
          </li>
        ))}
        {steps.length === 0 && (
          <p className="text-[11px] text-muted-foreground px-1">No steps yet.</p>
        )}
      </ol>
    );
  }

  return (
    <div className="space-y-2">
      <ol className="space-y-1.5">
        {steps.map((step, idx) => {
          const open = expandedId === step.id;
          return (
            <li key={step.id} className="rounded-lg border border-border/50 bg-background/40 overflow-hidden">
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <button
                  type="button"
                  className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground"
                  onClick={() => setExpandedId(open ? null : step.id)}
                  aria-label={open ? "Collapse step" : "Expand step"}
                >
                  {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
                <span className="text-[10px] font-mono text-muted-foreground w-4">{idx + 1}</span>
                <button
                  type="button"
                  className="flex-1 text-left text-xs font-medium truncate"
                  onClick={() => setExpandedId(open ? null : step.id)}
                >
                  {stepLabel(step)}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={idx === 0}
                  onClick={() => move(idx, -1)}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={idx === steps.length - 1}
                  onClick={() => move(idx, 1)}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(idx)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {open && (
                <div className="border-t border-border/40 px-3 py-3 space-y-2.5 bg-card/20">
                  <StepFields step={step} agentId={agentId} onPatch={(p) => updateAt(idx, p)} />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {steps.length === 0 && (
        <p className="text-[11px] text-muted-foreground px-1">
          Add a Call step first, then WhatsApp / email / wait / callback as needed.
        </p>
      )}

      <div className="relative">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => setAddOpen((v) => !v)}
        >
          <Plus className="h-3.5 w-3.5" />
          Add step
        </Button>
        {addOpen && (
          <div className="absolute z-20 mt-1.5 w-full max-w-sm rounded-xl border border-border/60 bg-popover shadow-lg p-1.5 space-y-0.5">
            {STEP_CATALOG.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => add(item.type)}
                  className="w-full flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted/50"
                >
                  <div className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{item.title}</p>
                    <p className="text-[10px] text-muted-foreground">{item.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StepFields({
  step,
  agentId,
  onPatch,
}: {
  step: ReachStep;
  agentId: number;
  onPatch: (patch: Partial<ReachStep>) => void;
}) {
  const delay = delayToUnit(step.delaySeconds ?? 3600);
  const squadsQ = useQuery({
    queryKey: ["reach-squads", agentId],
    enabled: step.type === "make_call" && agentId > 0,
    queryFn: () => customFetch<SquadListItem[]>(`${DASH_API}/squads`),
    staleTime: 30_000,
  });
  const squadsForAgent = (squadsQ.data ?? []).filter((s) =>
    s.members?.some((m) => m.agentId === agentId),
  );

  return (
    <>
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Label</Label>
        <Input
          className="h-8 text-xs"
          value={step.label ?? ""}
          placeholder={stepLabel({ ...step, label: undefined })}
          onChange={(e) => onPatch({ label: e.target.value })}
        />
      </div>

      {(step.type === "make_call" ||
        step.type === "send_whatsapp" ||
        step.type === "schedule_callback") && (
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Phone field</Label>
          <Input
            className="h-8 text-xs font-mono"
            value={step.phoneField ?? "phone"}
            onChange={(e) => onPatch({ phoneField: e.target.value || "phone" })}
          />
        </div>
      )}

      {step.type === "make_call" && (
        <div className="space-y-1.5">
          <Label className="text-[10px] text-muted-foreground">Squad (optional)</Label>
          <Select
            value={step.squadId ? String(step.squadId) : "none"}
            onValueChange={(v) => {
              if (v === "none") {
                onPatch({ squadId: null, label: step.label?.includes("squad") ? "Call lead" : step.label });
              } else {
                const id = Number(v);
                const name = squadsForAgent.find((s) => s.id === id)?.name;
                onPatch({
                  squadId: id,
                  label: step.label && !step.label.toLowerCase().includes("call")
                    ? step.label
                    : name
                      ? `Call via ${name}`
                      : "Call with squad handoffs",
                });
              }
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="This agent only" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-xs">This agent only (no squad)</SelectItem>
              {squadsForAgent.map((s) => (
                <SelectItem key={s.id} value={String(s.id)} className="text-xs">
                  {s.name}
                  {s.status !== "active" ? ` · ${s.status}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">
            {squadsForAgent.length === 0 ? (
              <>
                No squads include this agent yet.{" "}
                <Link href="/app/squads" className="underline underline-offset-2">
                  Create a squad
                </Link>{" "}
                to enable mid-call specialist handoffs.
              </>
            ) : (
              "Squad runs enable mid-call handoffs and shared contact memory between members."
            )}
          </p>
        </div>
      )}

      {step.type === "delay" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Wait</Label>
            <Input
              type="number"
              min={1}
              className="h-8 text-xs"
              value={delay.amount}
              onChange={(e) => {
                const amount = Math.max(1, Number(e.target.value) || 1);
                const secs = unitToSeconds(amount, delay.unit);
                onPatch({
                  delaySeconds: secs,
                  label: stepLabel({ ...step, delaySeconds: secs, label: undefined }),
                });
              }}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Unit</Label>
            <Select
              value={delay.unit}
              onValueChange={(unit: "minutes" | "hours" | "days") => {
                const secs = unitToSeconds(delay.amount, unit);
                onPatch({
                  delaySeconds: secs,
                  label: stepLabel({ ...step, delaySeconds: secs, label: undefined }),
                });
              }}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minutes" className="text-xs">Minutes</SelectItem>
                <SelectItem value="hours" className="text-xs">Hours</SelectItem>
                <SelectItem value="days" className="text-xs">Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {step.type === "send_whatsapp" && (
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Template hint</Label>
          <Select
            value={step.whatsappHint ?? "call_summary"}
            onValueChange={(v) => onPatch({ whatsappHint: v })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="call_summary" className="text-xs">Call summary</SelectItem>
              <SelectItem value="booking_confirmed" className="text-xs">Booking confirmed</SelectItem>
              <SelectItem value="callback_scheduled" className="text-xs">Callback scheduled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {step.type === "send_email" && (
        <>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Email field</Label>
            <Input
              className="h-8 text-xs font-mono"
              value={step.emailField ?? "email"}
              onChange={(e) => onPatch({ emailField: e.target.value || "email" })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Subject override</Label>
            <Input
              className="h-8 text-xs"
              value={step.emailSubject ?? ""}
              placeholder="Optional"
              onChange={(e) => onPatch({ emailSubject: e.target.value || undefined })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Body override</Label>
            <Textarea
              className="min-h-[72px] text-xs font-mono"
              value={step.emailBody ?? ""}
              placeholder="Optional — leave blank to use Channels → Email template"
              onChange={(e) => onPatch({ emailBody: e.target.value || undefined })}
            />
          </div>
        </>
      )}

      {step.type === "schedule_callback" && (
        <>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Delay (days)</Label>
            <Input
              type="number"
              min={1}
              max={60}
              className="h-8 text-xs"
              value={step.callbackDelayDays ?? 5}
              onChange={(e) => {
                const days = Math.max(1, Number(e.target.value) || 1);
                onPatch({
                  callbackDelayDays: days,
                  label: `Callback in ${days} days`,
                });
              }}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Notes</Label>
            <Input
              className="h-8 text-xs"
              value={step.notes ?? ""}
              onChange={(e) => onPatch({ notes: e.target.value || undefined })}
            />
          </div>
        </>
      )}

      {step.type === "send_webhook" && (
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Webhook URL</Label>
          <Input
            className="h-8 text-xs font-mono"
            placeholder="https://…"
            value={step.url ?? ""}
            onChange={(e) => onPatch({ url: e.target.value })}
          />
        </div>
      )}

      {step.type === "condition" && (
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="space-y-1 sm:col-span-1">
            <Label className="text-[10px] text-muted-foreground">Field</Label>
            <Input
              className="h-8 text-xs font-mono"
              value={step.field ?? ""}
              placeholder="call.connected"
              onChange={(e) => onPatch({ field: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Op</Label>
            <Select
              value={step.op ?? "eq"}
              onValueChange={(v) => onPatch({ op: v })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["eq", "neq", "contains", "exists", "gt", "lt"] as const).map((op) => (
                  <SelectItem key={op} value={op} className="text-xs">{op}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Value</Label>
            <Input
              className="h-8 text-xs font-mono"
              value={step.value ?? ""}
              onChange={(e) => onPatch({ value: e.target.value })}
            />
          </div>
          <p className={cn("sm:col-span-3 text-[10px] text-muted-foreground")}>
            If the condition is false, the run stops (engine does not branch to another path yet).
          </p>
        </div>
      )}
    </>
  );
}
