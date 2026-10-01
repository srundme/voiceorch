import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Plus, Trash2, X } from "lucide-react";
import { customFetch, getListCampaignsQueryKey, useListCampaigns, type Agent } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  newStepId,
  type BranchCase,
  type ConditionOp,
  type FlowIssue,
  type FlowSchedule,
  type FlowSettings,
  type FlowStep,
  type FlowTrigger,
} from "./api";
import { STEP_META, TRIGGER_LABEL } from "./nodes";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

function AgentSelect({ agents, value, onChange, optional }: {
  agents: Agent[];
  value?: number;
  onChange: (id: number | undefined) => void;
  optional?: boolean;
}) {
  return (
    <Select
      value={value ? String(value) : optional ? "none" : undefined}
      onValueChange={(v) => onChange(v === "none" ? undefined : Number(v))}
    >
      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pick an agent" /></SelectTrigger>
      <SelectContent>
        {optional && <SelectItem value="none" className="text-xs">Same agent as the flow</SelectItem>}
        {agents.map((a) => (
          <SelectItem key={a.id} value={String(a.id)} className="text-xs">{a.name || `Agent ${a.id}`}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── What a condition can check ───────────────────────────────────────────────

const CHECKS: Array<{ value: string; label: string; values?: string[] }> = [
  { value: "call.connected", label: "Call was answered", values: ["true", "false"] },
  { value: "call.status", label: "Call status" },
  { value: "call.duration", label: "Call length (seconds)" },
  { value: "call.disposition", label: "Disposition (any field)" },
  { value: "call.summary", label: "Call summary" },
  { value: "call.success", label: "Success evaluation" },
  { value: "reply.received", label: "Replied on WhatsApp", values: ["true", "false"] },
  { value: "reply.text", label: "WhatsApp reply text" },
  { value: "name", label: "Person name" },
  { value: "email", label: "Person email" },
];

const OPS: Array<{ value: ConditionOp; label: string }> = [
  { value: "eq", label: "is" },
  { value: "neq", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "exists", label: "is set" },
  { value: "gt", label: "greater than" },
  { value: "lt", label: "less than" },
];

function CheckEditor({ field, op, value, steps, onChange }: {
  field?: string;
  op?: ConditionOp;
  value?: string;
  steps: FlowStep[];
  onChange: (patch: { field?: string; op?: ConditionOp; value?: string }) => void;
}) {
  const f = field ?? "";
  const kind = f.startsWith("__visits.") ? "__visits" : CHECKS.some((c) => c.value === f) ? f : f ? "custom" : "";
  const [customOpen, setCustomOpen] = useState(kind === "custom");
  const preset = CHECKS.find((c) => c.value === f);
  const shownKind = customOpen && kind !== "__visits" ? "custom" : kind;

  return (
    <div className="space-y-2">
      <Select
        value={shownKind || undefined}
        onValueChange={(k) => {
          if (k === "custom") { setCustomOpen(true); onChange({ field: "" }); return; }
          setCustomOpen(false);
          if (k === "__visits") { onChange({ field: `__visits.${steps[0]?.id ?? ""}`, op: "lt", value: "3" }); return; }
          const c = CHECKS.find((x) => x.value === k);
          onChange({ field: k, op: c?.values ? "eq" : op ?? "eq", value: c?.values?.[1] ?? value });
        }}
      >
        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="What to check" /></SelectTrigger>
        <SelectContent>
          {CHECKS.map((c) => <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>)}
          <SelectItem value="__visits" className="text-xs">Times a step has run (retry limit)</SelectItem>
          <SelectItem value="custom" className="text-xs">Custom field…</SelectItem>
        </SelectContent>
      </Select>

      {shownKind === "custom" && (
        <Input
          className="h-8 font-mono text-xs"
          placeholder="e.g. call.disposition.outcome or city"
          value={f}
          onChange={(e) => onChange({ field: e.target.value })}
        />
      )}
      {shownKind === "__visits" && (
        <Select value={f.slice("__visits.".length) || undefined} onValueChange={(id) => onChange({ field: `__visits.${id}` })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Which step" /></SelectTrigger>
          <SelectContent>
            {steps.map((s) => (
              <SelectItem key={s.id} value={s.id} className="text-xs">{s.label || STEP_META[s.type]?.label || s.type}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="flex gap-2">
        <Select value={op ?? "eq"} onValueChange={(o) => onChange({ op: o as ConditionOp })}>
          <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {OPS.map((o) => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {op !== "exists" && (preset?.values ? (
          <Select value={value ?? ""} onValueChange={(v) => onChange({ value: v })}>
            <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue placeholder="Value" /></SelectTrigger>
            <SelectContent>
              {preset.values.map((v) => <SelectItem key={v} value={v} className="text-xs">{v === "true" ? "Yes" : v === "false" ? "No" : v}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <Input className="h-8 flex-1 text-xs" placeholder="Value" value={value ?? ""} onChange={(e) => onChange({ value: e.target.value })} />
        ))}
      </div>
    </div>
  );
}

// ── Delay ────────────────────────────────────────────────────────────────────

const UNITS = [
  { value: 60, label: "minutes" },
  { value: 3600, label: "hours" },
  { value: 86400, label: "days" },
];

function DelayEditor({ seconds, onChange }: { seconds?: number; onChange: (s: number) => void }) {
  const s = Number(seconds) || 0;
  const initialUnit = s > 0 && s % 86400 === 0 ? 86400 : s > 0 && s % 3600 === 0 ? 3600 : 60;
  const [unit, setUnit] = useState(initialUnit);
  return (
    <div className="flex gap-2">
      <Input
        type="number"
        min={1}
        className="h-8 w-24 text-xs"
        value={s ? s / unit : ""}
        onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) * unit)))}
      />
      <Select value={String(unit)} onValueChange={(u) => { const n = Number(u); setUnit(n); onChange(s ? Math.round((s / unit) * n) : 0); }}>
        <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {UNITS.map((u) => <SelectItem key={u.value} value={String(u.value)} className="text-xs">{u.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

// ── Branch paths ─────────────────────────────────────────────────────────────

function BranchEditor({ step, steps, onChange }: { step: FlowStep; steps: FlowStep[]; onChange: (s: FlowStep) => void }) {
  const cases = step.cases ?? [];
  const setCase = (id: string, patch: Partial<BranchCase>) =>
    onChange({ ...step, cases: cases.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const addCase = (c?: Partial<BranchCase>) =>
    onChange({ ...step, cases: [...cases, { id: newStepId("path"), label: `Path ${cases.length + 1}`, field: "", op: "eq", value: "", next: null, ...c }] });

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">Checked top to bottom. The first path that matches wins; nothing matched goes to “Otherwise”.</p>
      {cases.map((c, i) => (
        <div key={c.id} className="space-y-2 rounded-lg border border-border p-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">{i + 1}.</span>
            <Input className="h-7 flex-1 text-xs" value={c.label ?? ""} placeholder="Path name" onChange={(e) => setCase(c.id, { label: e.target.value })} />
            <Button variant="ghost" size="icon" className="size-7" onClick={() => onChange({ ...step, cases: cases.filter((x) => x.id !== c.id) })}>
              <X className="size-3.5" />
            </Button>
          </div>
          <CheckEditor field={c.field} op={c.op} value={c.value} steps={steps} onChange={(p) => setCase(c.id, p)} />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => addCase()}>
          <Plus className="size-3.5" /> Add path
        </Button>
        {cases.length === 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onChange({
              ...step,
              cases: [
                { id: newStepId("path"), label: "Not answered", field: "call.connected", op: "eq", value: "false", next: null },
                { id: newStepId("path"), label: "Asked for callback", field: "call.disposition", op: "contains", value: "callback", next: null },
              ],
            })}
          >
            Use call outcome paths
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Step inspector ───────────────────────────────────────────────────────────

export function StepInspector({ step, steps, agents, issues, onChange, onDelete }: {
  step: FlowStep;
  steps: FlowStep[];
  agents: Agent[];
  issues: FlowIssue[];
  onChange: (s: FlowStep) => void;
  onDelete: () => void;
}) {
  const meta = STEP_META[step.type];
  const set = (patch: Partial<FlowStep>) => onChange({ ...step, ...patch });
  const Icon = meta.icon;
  const others = steps.filter((s) => s.id !== step.id);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <span className={cn("flex size-8 items-center justify-center rounded-lg", meta.tone)}><Icon className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{meta.label}</p>
          <p className="text-[11px] text-muted-foreground">{meta.hint}</p>
        </div>
        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" onClick={onDelete} aria-label="Delete step">
          <Trash2 className="size-4" />
        </Button>
      </div>

      {issues.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-200">
          {issues.map((i) => <p key={i.message}>{i.message}</p>)}
        </div>
      )}

      <Field label="Name on canvas">
        <Input className="h-8 text-xs" value={step.label ?? ""} placeholder={meta.label} onChange={(e) => set({ label: e.target.value })} />
      </Field>

      {step.type === "make_call" && (
        <>
          <Field label="Agent"><AgentSelect agents={agents} value={step.agentId} onChange={(agentId) => set({ agentId })} /></Field>
          <Field label="Phone field" hint="Which person field holds the number.">
            <Input className="h-8 font-mono text-xs" value={step.phoneField ?? "phone"} onChange={(e) => set({ phoneField: e.target.value })} />
          </Field>
          <p className="text-[11px] text-muted-foreground">
            The next step runs after the call ends. Use a Yes / No or Branch step after it to act on the outcome.
          </p>
        </>
      )}

      {step.type === "delay" && (
        <Field label="Wait for"><DelayEditor seconds={step.delaySeconds} onChange={(delaySeconds) => set({ delaySeconds })} /></Field>
      )}

      {step.type === "wait_for_reply" && (
        <>
          <Field label="Give up after" hint="No WhatsApp message from the person by then → “No reply” path.">
            <DelayEditor seconds={step.delaySeconds} onChange={(delaySeconds) => set({ delaySeconds })} />
          </Field>
          <p className="text-[11px] text-muted-foreground">
            Any WhatsApp message from the person takes the “Replied” path; its text is available as <span className="font-mono">reply.text</span> for a Yes / No or Branch step.
            Put a WhatsApp step before this one so they have something to reply to.
          </p>
        </>
      )}

      {step.type === "condition" && (
        <Field label="Check">
          <CheckEditor field={step.field} op={step.op} value={step.value} steps={others} onChange={set} />
        </Field>
      )}

      {step.type === "branch" && <BranchEditor step={step} steps={others} onChange={onChange} />}

      {step.type === "send_whatsapp" && (
        <>
          <Field label="Message type" hint="Uses the template mapped to this moment on the agent, unless you name one below.">
            <Select value={step.whatsappHint ?? "call_summary"} onValueChange={(v) => set({ whatsappHint: v as FlowStep["whatsappHint"] })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="call_summary" className="text-xs">Call summary</SelectItem>
                <SelectItem value="booking_confirmed" className="text-xs">Booking confirmed</SelectItem>
                <SelectItem value="callback_scheduled" className="text-xs">Callback scheduled</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-[1fr_90px] gap-2">
            <Field label="Template name (optional)">
              <Input
                className="h-8 text-xs"
                value={step.whatsappTemplate?.name ?? ""}
                onChange={(e) => set({
                  whatsappTemplate: e.target.value
                    ? { name: e.target.value, language: step.whatsappTemplate?.language ?? "en" }
                    : undefined,
                })}
              />
            </Field>
            <Field label="Language">
              <Input
                className="h-8 text-xs"
                value={step.whatsappTemplate?.language ?? ""}
                placeholder="en"
                disabled={!step.whatsappTemplate?.name}
                onChange={(e) => step.whatsappTemplate && set({ whatsappTemplate: { ...step.whatsappTemplate, language: e.target.value } })}
              />
            </Field>
          </div>
          <Field label="Template values (one per line)" hint="Supports {{name}}, {{phone}}, {{summary}} and any person field.">
            <Textarea
              className="min-h-[70px] text-xs"
              value={(step.whatsappParams ?? []).join("\n")}
              onChange={(e) => set({ whatsappParams: e.target.value ? e.target.value.split("\n") : undefined })}
            />
          </Field>
        </>
      )}

      {step.type === "send_email" && (
        <>
          <Field label="Subject" hint="Leave empty to use the default follow-up email.">
            <Input className="h-8 text-xs" value={step.emailSubject ?? ""} onChange={(e) => set({ emailSubject: e.target.value || undefined })} />
          </Field>
          <Field label="Body (HTML)" hint="Supports {{name}}, {{summary}} and any person field.">
            <Textarea className="min-h-[110px] text-xs" value={step.emailBody ?? ""} onChange={(e) => set({ emailBody: e.target.value || undefined })} />
          </Field>
          <Field label="Email field">
            <Input className="h-8 font-mono text-xs" value={step.emailField ?? "email"} onChange={(e) => set({ emailField: e.target.value })} />
          </Field>
        </>
      )}

      {step.type === "send_webhook" && (
        <Field label="URL" hint="Receives the whole person record and call result as JSON.">
          <Input className="h-8 font-mono text-xs" placeholder="https://" value={step.url ?? ""} onChange={(e) => set({ url: e.target.value })} />
        </Field>
      )}

      {step.type === "schedule_callback" && (
        <>
          <Field label="Agent"><AgentSelect agents={agents} value={step.agentId} onChange={(agentId) => set({ agentId })} /></Field>
          <Field label="Call back after (days)">
            <Input type="number" min={0} className="h-8 w-24 text-xs" value={step.callbackDelayDays ?? 1} onChange={(e) => set({ callbackDelayDays: Math.max(0, Number(e.target.value)) })} />
          </Field>
          <Field label="Note for the agent">
            <Input className="h-8 text-xs" value={step.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </>
      )}

      {step.type === "join_meeting" && (
        <>
          <Field label="Agent"><AgentSelect agents={agents} value={step.agentId} onChange={(agentId) => set({ agentId })} optional /></Field>
          <Field label="Meeting link field" hint="Defaults to meetingUrl / meetLink on the person.">
            <Input className="h-8 font-mono text-xs" value={step.meetingUrlField ?? ""} onChange={(e) => set({ meetingUrlField: e.target.value || undefined })} />
          </Field>
        </>
      )}

      {step.type === "update_sheet" && (
        <>
          <Field label="Column"><Input className="h-8 text-xs" value={step.sheetStatusColumn ?? "Status"} onChange={(e) => set({ sheetStatusColumn: e.target.value })} /></Field>
          <Field label="Value" hint="Leave empty to write the call outcome.">
            <Input className="h-8 text-xs" value={step.sheetStatusValue ?? ""} onChange={(e) => set({ sheetStatusValue: e.target.value || undefined })} />
          </Field>
          <p className="text-[11px] text-muted-foreground">Only works for people who came from a Google Sheet.</p>
        </>
      )}
    </div>
  );
}

// ── Trigger inspector ────────────────────────────────────────────────────────

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_SCHEDULE: FlowSchedule = { time: "10:00", days: [1, 2, 3, 4, 5], timezone: "Asia/Kolkata" };

function ScheduleEditor({ schedule, settings, onChange, onSettings }: {
  schedule: FlowSchedule;
  settings: FlowSettings;
  onChange: (s: FlowSchedule) => void;
  onSettings: (patch: Partial<FlowSettings>) => void;
}) {
  const campaignsQ = useListCampaigns({ query: { queryKey: getListCampaignsQueryKey() } });
  const campaigns = (Array.isArray(campaignsQ.data) ? campaignsQ.data : []).filter((c) => !c.name.startsWith("__"));
  const sheetsQ = useQuery({
    queryKey: ["automatic-calls"],
    queryFn: () => customFetch<Array<{ id: string; name: string }>>("/api/automatic-calls"),
  });
  const source = settings.peopleSource === "sheet" || settings.sheetPipelineId ? "sheet" : "campaign";
  const toggleDay = (d: number) =>
    onChange({ ...schedule, days: schedule.days.includes(d) ? schedule.days.filter((x) => x !== d) : [...schedule.days, d].sort() });

  return (
    <div className="space-y-3">
      <Field label="Time">
        <Input type="time" className="h-8 w-32 text-xs" value={schedule.time} onChange={(e) => onChange({ ...schedule, time: e.target.value })} />
      </Field>
      <Field label="Days">
        <div className="flex flex-wrap gap-1">
          {DAYS.map((d, i) => (
            <button
              key={d}
              type="button"
              onClick={() => toggleDay(i)}
              className={cn(
                "h-7 w-10 rounded-md border text-[11px] font-medium",
                schedule.days.includes(i) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground",
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Timezone">
        <Input className="h-8 text-xs" value={schedule.timezone ?? "Asia/Kolkata"} onChange={(e) => onChange({ ...schedule, timezone: e.target.value })} />
      </Field>
      <Field label="People to run" hint="Everyone on this list enters the flow at the scheduled time.">
        <div className="space-y-2">
          <Select
            value={source}
            onValueChange={(v) => onSettings(v === "sheet"
              ? { peopleSource: "sheet", campaignId: null }
              : { peopleSource: "campaign", sheetPipelineId: null })}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="campaign" className="text-xs">Campaign list</SelectItem>
              <SelectItem value="sheet" className="text-xs">Google Sheet</SelectItem>
            </SelectContent>
          </Select>
          {source === "campaign" ? (
            <Select
              value={settings.campaignId ? String(settings.campaignId) : undefined}
              onValueChange={(v) => onSettings({ peopleSource: "campaign", campaignId: Number(v), sheetPipelineId: null })}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={campaignsQ.isLoading ? "Loading…" : "Pick a campaign"} /></SelectTrigger>
              <SelectContent>
                {campaigns.map((c) => <SelectItem key={c.id} value={String(c.id)} className="text-xs">{c.name} · {c.totalLeads} people</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Select
              value={settings.sheetPipelineId || undefined}
              onValueChange={(v) => onSettings({ peopleSource: "sheet", sheetPipelineId: v, campaignId: null })}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={sheetsQ.isLoading ? "Loading…" : "Pick a connected sheet"} /></SelectTrigger>
              <SelectContent>
                {(sheetsQ.data ?? []).map((p) => <SelectItem key={p.id} value={p.id} className="text-xs">{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
      </Field>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Switch checked={schedule.reincludePeople === true} onCheckedChange={(v) => onChange({ ...schedule, reincludePeople: v })} />
        Include people who already went through this flow
      </label>
      <p className="text-[11px] text-muted-foreground">Runs once per chosen day while the flow is active. People still mid-flow are never started twice.</p>
    </div>
  );
}

export function TriggerInspector({ trigger, hookUrl, settings, agentName, onChange, onSettings }: {
  trigger: FlowTrigger;
  hookUrl: string | null;
  settings: FlowSettings;
  agentName: string;
  onChange: (t: FlowTrigger) => void;
  onSettings: (patch: Partial<FlowSettings>) => void;
}) {
  const { toast } = useToast();
  const fullHook = hookUrl ? `${window.location.origin}${BASE}${hookUrl}` : null;
  const usesHook = trigger.type === "form_lead" || trigger.type === "instagram_lead";
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold">Starts when</p>
        <p className="text-[11px] text-muted-foreground">How people enter this flow.</p>
      </div>
      <Field label="Trigger">
        <Select
          value={trigger.type}
          onValueChange={(v) => {
            const type = v as FlowTrigger["type"];
            onChange({ ...trigger, type, ...(type === "schedule" && !trigger.schedule ? { schedule: DEFAULT_SCHEDULE } : {}) });
          }}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(TRIGGER_LABEL) as FlowTrigger["type"][]).map((k) => (
              <SelectItem key={k} value={k} className="text-xs">{TRIGGER_LABEL[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {trigger.type === "manual" && (
        <p className="text-[12px] text-muted-foreground">
          Use <span className="font-medium text-foreground">Run on people</span> to start it on pasted numbers, a campaign list, or a Google Sheet (once, or keep watching for new rows).
        </p>
      )}

      {trigger.type === "call_ended" && (
        <>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <div>
              <p className="text-xs font-medium">Missed calls only</p>
              <p className="text-[11px] text-muted-foreground">Caller hung up before saying anything.</p>
            </div>
            <Switch checked={trigger.missedOnly === true} onCheckedChange={(v) => onChange({ ...trigger, missedOnly: v })} />
          </div>
          <p className="text-[12px] text-muted-foreground">
            Starts after an inbound call to <span className="font-medium text-foreground">{agentName}</span> (the flow's main agent) ends. The call result is available to Yes / No and Branch steps.
          </p>
        </>
      )}

      {trigger.type === "whatsapp_reply" && (
        <>
          <Field label="Only when the message contains" hint="Comma-separated words, any one matches. Leave empty for every message.">
            <Input className="h-8 text-xs" placeholder="e.g. yes, interested, price" value={trigger.keyword ?? ""} onChange={(e) => onChange({ ...trigger, keyword: e.target.value })} />
          </Field>
          <p className="text-[12px] text-muted-foreground">The message text is available as <span className="font-mono">reply.text</span>. People already in this flow aren't started again.</p>
        </>
      )}

      {trigger.type === "schedule" && (
        <ScheduleEditor
          schedule={trigger.schedule ?? DEFAULT_SCHEDULE}
          settings={settings}
          onChange={(schedule) => onChange({ ...trigger, schedule })}
          onSettings={onSettings}
        />
      )}

      {usesHook && (
        fullHook ? (
          <Field label="Send leads to" hint="POST JSON with phone, name, email and any other fields. Each POST starts one person.">
            <div className="flex gap-1.5">
              <Input readOnly className="h-8 font-mono text-[11px]" value={fullHook} />
              <Button
                variant="outline"
                size="icon"
                className="size-8 shrink-0"
                onClick={() => { void navigator.clipboard.writeText(fullHook); toast({ title: "Copied" }); }}
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
          </Field>
        ) : (
          <p className="text-[12px] text-muted-foreground">Save the flow to get its lead URL.</p>
        )
      )}
    </div>
  );
}

// ── Flow settings (nothing selected) ─────────────────────────────────────────

const HOURS = Array.from({ length: 25 }, (_, h) => h);

export function FlowSettingsPanel({ name, agentId, settings, agents, issues, errors, steps, spentTodayPaise, onChange, onSelectStep }: {
  name: string;
  agentId: number;
  settings: FlowSettings;
  agents: Agent[];
  issues: FlowIssue[];
  errors: string[];
  steps: FlowStep[];
  spentTodayPaise?: number;
  onChange: (patch: { name?: string; agentId?: number; settings?: FlowSettings }) => void;
  onSelectStep: (id: string) => void;
}) {
  const setS = (patch: Partial<FlowSettings>) => onChange({ settings: { ...settings, ...patch } });
  const stepName = (id: string | null) => {
    const s = steps.find((x) => x.id === id);
    return s ? s.label || STEP_META[s.type]?.label || s.type : "Flow";
  };
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold">Flow settings</p>
        <p className="text-[11px] text-muted-foreground">Click a step on the canvas to edit it.</p>
      </div>

      {(errors.length > 0 || issues.length > 0) && (
        <div className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5">
          <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-200">Fix before activating</p>
          {errors.map((e) => <p key={e} className="text-[12px] text-red-700 dark:text-red-300">{e}</p>)}
          {issues.map((i) => (
            <button
              key={`${i.stepId}:${i.message}`}
              type="button"
              className="block w-full text-left text-[12px] text-amber-800 hover:underline dark:text-amber-200"
              onClick={() => i.stepId && onSelectStep(i.stepId)}
            >
              <span className="font-medium">{stepName(i.stepId)}:</span> {i.message}
            </button>
          ))}
        </div>
      )}

      <Field label="Name"><Input className="h-8 text-xs" value={name} onChange={(e) => onChange({ name: e.target.value })} /></Field>
      <Field label="Main agent" hint="Owner of the flow. Each call step can still use a different agent.">
        <AgentSelect agents={agents} value={agentId} onChange={(id) => id && onChange({ agentId: id })} />
      </Field>

      <div className="space-y-3 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Calling hours</Label>
          <Switch checked={settings.isCallingHoursEnabled === true} onCheckedChange={(v) => setS({ isCallingHoursEnabled: v })} />
        </div>
        {settings.isCallingHoursEnabled && (
          <>
            <div className="flex items-center gap-2">
              <Select value={String(settings.businessHoursStart ?? 9)} onValueChange={(v) => setS({ businessHoursStart: Number(v) })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{HOURS.slice(0, 24).map((h) => <SelectItem key={h} value={String(h)} className="text-xs">{`${h}:00`}</SelectItem>)}</SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">to</span>
              <Select value={String(settings.businessHoursEnd ?? 19)} onValueChange={(v) => setS({ businessHoursEnd: Number(v) })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{HOURS.slice(1).map((h) => <SelectItem key={h} value={String(h)} className="text-xs">{`${h}:00`}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Field label="Timezone">
              <Input className="h-8 text-xs" value={settings.timezone ?? "Asia/Kolkata"} onChange={(e) => setS({ timezone: e.target.value })} />
            </Field>
            <p className="text-[11px] text-muted-foreground">Calls outside these hours wait in the queue until the window opens.</p>
          </>
        )}
      </div>

      <div className="space-y-2 rounded-lg border border-border p-3">
        <Label className="text-xs">Daily call budget</Label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">₹</span>
          <Input
            type="number"
            min={0}
            className="h-8 w-28 text-xs"
            placeholder="No limit"
            value={settings.dailyBudgetInr ? String(settings.dailyBudgetInr) : ""}
            onChange={(e) => setS({ dailyBudgetInr: e.target.value ? Math.max(0, Number(e.target.value)) : null })}
          />
          <span className="text-xs text-muted-foreground">per day</span>
        </div>
        {spentTodayPaise != null && (
          <p className="text-[11px] text-muted-foreground">
            Spent today: <span className="font-medium text-foreground">₹{(spentTodayPaise / 100).toFixed(2)}</span>
            {settings.dailyBudgetInr ? ` of ₹${settings.dailyBudgetInr}` : ""}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground">Once reached, new calls in this flow wait until tomorrow (calling-hours timezone). Calls already ringing finish.</p>
      </div>
    </div>
  );
}
