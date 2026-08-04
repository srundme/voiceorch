/**
 * Call plans — ordered step timeline (not n8n).
 * Palette: Call · WhatsApp · Email · Wait · Meet · Update list · If… · Stop.
 */

import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight, Clock, FileSpreadsheet,
  GitBranch, Mail, MessageCircle, OctagonX, Phone, Plus, Trash2, Video,
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
import {
  defaultStep,
  stepLabel,
  type ReachStep,
  type ReachStepType,
} from "@/pages/agents/reach-step-editor";

export type CallPlanStep = ReachStep;

const DASH_API = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

type SquadListItem = {
  id: number;
  name: string;
  status: string;
  members: Array<{ agentId: number; roleName?: string }>;
};

/** Plain-language If… presets (engine: continue only when true, else stop). */
const IF_PRESETS = [
  {
    id: "answered",
    title: "If they answered",
    field: "call.connected",
    op: "eq" as const,
    value: "true",
    label: "If they answered",
  },
  {
    id: "no_answer",
    title: "If they didn’t answer",
    field: "call.connected",
    op: "eq" as const,
    value: "false",
    label: "If they didn’t answer",
  },
  {
    id: "success",
    title: "If the call succeeded",
    field: "call.success",
    op: "contains" as const,
    value: "true",
    label: "If the call succeeded",
  },
  {
    id: "custom",
    title: "Custom condition…",
    field: "call.connected",
    op: "eq" as const,
    value: "true",
    label: "If…",
  },
] as const;

const MVP_CATALOG: Array<{
  type: ReachStepType | "stop";
  title: string;
  desc: string;
  icon: React.ElementType;
}> = [
  { type: "make_call", title: "Call them", desc: "Dial with the chosen agent (optional team)", icon: Phone },
  { type: "send_whatsapp", title: "Send WhatsApp", desc: "Message after the previous step", icon: MessageCircle },
  { type: "send_email", title: "Send email", desc: "Email after the previous step", icon: Mail },
  { type: "delay", title: "Wait", desc: "Pause before the next step", icon: Clock },
  { type: "join_meeting", title: "Join a meeting", desc: "Bot joins Meet / Zoom / Teams", icon: Video },
  { type: "update_sheet", title: "Update the list", desc: "Write status back to the Sheet row", icon: FileSpreadsheet },
  { type: "condition", title: "If…", desc: "Continue only when something is true", icon: GitBranch },
  { type: "stop", title: "Stop", desc: "End this person’s path here", icon: OctagonX },
];

function sid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function stopStep(): CallPlanStep {
  return {
    id: sid("stop"),
    type: "condition",
    field: "__stop",
    op: "eq",
    value: "1",
    label: "Stop",
  };
}

function isStopStep(step: CallPlanStep): boolean {
  return step.type === "condition" && step.field === "__stop";
}

function isIfStep(step: CallPlanStep): boolean {
  return step.type === "condition" && step.field !== "__stop";
}

function matchIfPreset(step: CallPlanStep): string {
  const hit = IF_PRESETS.find(
    (p) =>
      p.id !== "custom"
      && p.field === (step.field ?? "")
      && p.op === (step.op ?? "eq")
      && p.value === (step.value ?? ""),
  );
  return hit?.id ?? "custom";
}

function displayLabel(step: CallPlanStep): string {
  if (isStopStep(step)) return "Stop";
  if (isIfStep(step)) return step.label?.trim() || "If…";
  if (step.type === "make_call") {
    if (step.squadId) return step.label?.trim() || "Call with team handoffs";
    return step.label?.trim() || "Call them";
  }
  if (step.type === "send_whatsapp") return step.label?.trim() || "Send WhatsApp";
  if (step.type === "send_email") return step.label?.trim() || "Send email";
  if (step.type === "join_meeting") return step.label?.trim() || "Join a meeting";
  if (step.type === "update_sheet") return step.label?.trim() || "Update the list";
  return stepLabel(step);
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
  steps: CallPlanStep[];
  agentId: number;
  onChange: (next: CallPlanStep[]) => void;
  readOnly?: boolean;
};

export function CallPlanStepEditor({ steps, agentId, onChange, readOnly = false }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const squadsQ = useQuery({
    queryKey: ["call-plan-squads", agentId],
    enabled: agentId > 0,
    queryFn: () => customFetch<SquadListItem[]>(`${DASH_API}/squads`),
    staleTime: 30_000,
  });
  const squadsForAgent = (squadsQ.data ?? []).filter((s) =>
    s.members?.some((m) => m.agentId === agentId),
  );

  const updateAt = (index: number, patch: Partial<CallPlanStep>) => {
    onChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
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

  const add = (type: ReachStepType | "stop") => {
    const step = type === "stop" ? stopStep() : defaultStep(type, agentId);
    if (type === "make_call") step.label = "Call them";
    if (type === "send_whatsapp") step.label = "Send WhatsApp";
    if (type === "send_email") step.label = "Send email";
    if (type === "join_meeting") step.label = "Join a meeting";
    if (type === "update_sheet") step.label = "Update the list";
    if (type === "condition") {
      step.field = "call.connected";
      step.op = "eq";
      step.value = "true";
      step.label = "If they answered";
    }
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
            <p className="text-xs font-medium">{displayLabel(step)}</p>
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
          const stop = isStopStep(step);
          const ifStep = isIfStep(step);
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
                  {displayLabel(step)}
                </button>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={idx === 0} onClick={() => move(idx, -1)}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={idx === steps.length - 1} onClick={() => move(idx, 1)}>
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => remove(idx)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {open && (
                <div className="border-t border-border/40 px-3 py-3 space-y-2.5 bg-card/20">
                  {stop ? (
                    <p className="text-[11px] text-muted-foreground">
                      Ends this person’s path. Nothing after this step runs for them.
                    </p>
                  ) : ifStep ? (
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <Label className="text-[11px]">Continue only if…</Label>
                        <Select
                          value={matchIfPreset(step)}
                          onValueChange={(id) => {
                            const preset = IF_PRESETS.find((p) => p.id === id);
                            if (!preset) return;
                            updateAt(idx, {
                              field: preset.field,
                              op: preset.op,
                              value: preset.value,
                              label: preset.label,
                            });
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {IF_PRESETS.map((p) => (
                              <SelectItem key={p.id} value={p.id} className="text-xs">{p.title}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {matchIfPreset(step) === "custom" && (
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div className="space-y-1">
                            <Label className="text-[11px]">Field</Label>
                            <Input
                              className="h-8 text-xs font-mono"
                              value={step.field ?? ""}
                              placeholder="call.connected"
                              onChange={(e) => updateAt(idx, { field: e.target.value, label: step.label || "If…" })}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[11px]">Op</Label>
                            <Select
                              value={step.op ?? "eq"}
                              onValueChange={(v) => updateAt(idx, { op: v as CallPlanStep["op"] })}
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
                            <Label className="text-[11px]">Value</Label>
                            <Input
                              className="h-8 text-xs font-mono"
                              value={step.value ?? ""}
                              onChange={(e) => updateAt(idx, { value: e.target.value })}
                            />
                          </div>
                        </div>
                      )}
                      <p className="text-[10px] text-muted-foreground">
                        If this isn’t true, this person’s path stops here. Place If after a Call step.
                      </p>
                    </div>
                  ) : step.type === "make_call" ? (
                    <div className="space-y-2">
                      <p className="text-[11px] text-muted-foreground rounded-md border border-border/50 bg-muted/20 px-2.5 py-2">
                        Missed calls and call-backs use this agent’s settings — not this plan.
                      </p>
                      <div className="space-y-1">
                        <Label className="text-[11px]">Label</Label>
                        <Input
                          className="h-8 text-xs"
                          value={step.label ?? ""}
                          onChange={(e) => updateAt(idx, { label: e.target.value })}
                          placeholder="Call them"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px]">Team (optional)</Label>
                        <Select
                          value={step.squadId ? String(step.squadId) : "none"}
                          onValueChange={(v) => {
                            if (v === "none") {
                              updateAt(idx, {
                                squadId: null,
                                label: step.label?.includes("team") ? "Call them" : step.label,
                              });
                              return;
                            }
                            const id = Number(v);
                            const name = squadsForAgent.find((s) => s.id === id)?.name;
                            updateAt(idx, {
                              squadId: id,
                              label: step.label?.trim() && !step.label.includes("Call them")
                                ? step.label
                                : name
                                  ? `Call with ${name}`
                                  : "Call with team handoffs",
                            });
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none" className="text-xs">This agent only</SelectItem>
                            {squadsForAgent.map((s) => (
                              <SelectItem key={s.id} value={String(s.id)} className="text-xs">{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {squadsForAgent.length === 0 ? (
                          <p className="text-[10px] text-muted-foreground">
                            No team includes this agent yet.{" "}
                            <Link href={`/app/squads?seedAgent=${agentId}`} className="underline underline-offset-2">
                              Create a team
                            </Link>
                          </p>
                        ) : (
                          <p className="text-[10px] text-muted-foreground">
                            Team dials enable mid-call handoffs between members.
                          </p>
                        )}
                      </div>
                    </div>
                  ) : step.type === "send_whatsapp" ? (
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <Label className="text-[11px]">Message type</Label>
                        <Select
                          value={step.whatsappHint ?? "call_summary"}
                          onValueChange={(v) => updateAt(idx, { whatsappHint: v })}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="call_summary" className="text-xs">After call summary</SelectItem>
                            <SelectItem value="booking_confirmed" className="text-xs">Booking confirmed</SelectItem>
                            <SelectItem value="callback_scheduled" className="text-xs">Callback scheduled</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Needs WhatsApp connected under Connections.
                      </p>
                    </div>
                  ) : step.type === "send_email" ? (
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <Label className="text-[11px]">Subject</Label>
                        <Input
                          className="h-8 text-xs"
                          value={step.emailSubject ?? ""}
                          onChange={(e) => updateAt(idx, { emailSubject: e.target.value })}
                          placeholder="Follow-up"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px]">Body</Label>
                        <Textarea
                          rows={3}
                          className="text-xs"
                          value={step.emailBody ?? ""}
                          onChange={(e) => updateAt(idx, { emailBody: e.target.value })}
                          placeholder="Hi {{name}} — …"
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Needs email connected. Uses the person’s email from the list when present.
                      </p>
                    </div>
                  ) : step.type === "join_meeting" ? (
                    <div className="space-y-2">
                      <p className="text-[11px] text-muted-foreground rounded-md border border-border/50 bg-muted/20 px-2.5 py-2">
                        Uses a Meet / Zoom / Teams link from the person’s row (Meeting URL column) or context after a booking.
                        The agent’s meeting prompt is used in the room.
                      </p>
                      <div className="space-y-1">
                        <Label className="text-[11px]">URL field</Label>
                        <Input
                          className="h-8 text-xs font-mono"
                          value={step.meetingUrlField ?? "meetingUrl"}
                          onChange={(e) => updateAt(idx, { meetingUrlField: e.target.value })}
                          placeholder="meetingUrl"
                        />
                      </div>
                    </div>
                  ) : step.type === "update_sheet" ? (
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <Label className="text-[11px]">Column</Label>
                        <Input
                          className="h-8 text-xs"
                          value={step.sheetStatusColumn ?? "Status"}
                          onChange={(e) => updateAt(idx, { sheetStatusColumn: e.target.value })}
                          placeholder="Status"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px]">Value (optional)</Label>
                        <Input
                          className="h-8 text-xs"
                          value={step.sheetStatusValue ?? ""}
                          onChange={(e) => updateAt(idx, { sheetStatusValue: e.target.value })}
                          placeholder="Blank = call disposition / Updated"
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Only works when this person came from a Sheet list (row is known).
                      </p>
                    </div>
                  ) : step.type === "delay" ? (
                    <div className="space-y-2">
                      {(() => {
                        const { amount, unit } = delayToUnit(step.delaySeconds ?? 3600);
                        return (
                          <div className="flex items-end gap-2">
                            <div className="space-y-1 flex-1">
                              <Label className="text-[11px]">Wait</Label>
                              <Input
                                type="number"
                                min={1}
                                className="h-8 text-xs"
                                value={amount}
                                onChange={(e) => {
                                  const next = unitToSeconds(Number(e.target.value) || 1, unit);
                                  updateAt(idx, {
                                    delaySeconds: next,
                                    label: displayWaitLabel(next),
                                  });
                                }}
                              />
                            </div>
                            <Select
                              value={unit}
                              onValueChange={(v) => {
                                const u = v as "minutes" | "hours" | "days";
                                const next = unitToSeconds(amount, u);
                                updateAt(idx, {
                                  delaySeconds: next,
                                  label: displayWaitLabel(next),
                                });
                              }}
                            >
                              <SelectTrigger className="h-8 w-28 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="minutes" className="text-xs">Minutes</SelectItem>
                                <SelectItem value="hours" className="text-xs">Hours</SelectItem>
                                <SelectItem value="days" className="text-xs">Days</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">{step.type}</p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {steps.length === 0 && (
        <p className="text-[11px] text-muted-foreground px-1">
          Add what happens next — Call, WhatsApp, Email, Wait, Meet, Update list, If…, or Stop.
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
          Add next step
        </Button>
        {addOpen && (
          <div className="absolute z-20 mt-1.5 w-full max-w-sm rounded-xl border border-border/60 bg-popover shadow-lg p-1.5 space-y-0.5">
            {MVP_CATALOG.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => add(item.type)}
                  className={cn(
                    "w-full flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted/50",
                  )}
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

function displayWaitLabel(seconds: number): string {
  if (seconds >= 86400 && seconds % 86400 === 0) return `Wait ${seconds / 86400} day(s)`;
  if (seconds >= 3600 && seconds % 3600 === 0) return `Wait ${seconds / 3600} hour(s)`;
  if (seconds >= 60 && seconds % 60 === 0) return `Wait ${seconds / 60} minute(s)`;
  return `Wait ${seconds}s`;
}

/** Default Call → WhatsApp → Wait starter for new plans. */
export function defaultCallPlanSteps(agentId: number): CallPlanStep[] {
  return [
    { ...defaultStep("make_call", agentId), label: "Call them" },
    { ...defaultStep("send_whatsapp", agentId), label: "Send WhatsApp" },
    { ...defaultStep("delay", agentId), delaySeconds: 86400, label: "Wait 1 day" },
  ];
}
