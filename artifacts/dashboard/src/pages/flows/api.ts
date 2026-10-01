import { customFetch } from "@workspace/api-client-react";

export type ConditionOp = "eq" | "neq" | "contains" | "exists" | "gt" | "lt";

export type StepType =
  | "make_call"
  | "condition"
  | "branch"
  | "wait_for_reply"
  | "delay"
  | "send_webhook"
  | "schedule_callback"
  | "send_whatsapp"
  | "send_email"
  | "join_meeting"
  | "update_sheet";

export interface BranchCase {
  id: string;
  label?: string;
  field: string;
  op: ConditionOp;
  value?: string;
  next?: string | null;
}

export interface FlowStep {
  id: string;
  type: StepType;
  label?: string;
  next?: string | null;
  onTrue?: string | null;
  onFalse?: string | null;
  cases?: BranchCase[];
  position?: { x: number; y: number };

  agentId?: number;
  squadId?: number;
  phoneField?: string;
  field?: string;
  op?: ConditionOp;
  value?: string;
  delaySeconds?: number;
  url?: string;
  callbackDelayDays?: number;
  notes?: string;
  whatsappHint?: "call_summary" | "booking_confirmed" | "callback_scheduled";
  whatsappTemplate?: { name: string; language: string; paramCount?: number };
  whatsappParams?: string[];
  emailField?: string;
  emailSubject?: string;
  emailBody?: string;
  meetingUrlField?: string;
  sheetStatusColumn?: string;
  sheetStatusValue?: string;
}

export type TriggerType = "form_lead" | "instagram_lead" | "manual" | "call_ended" | "whatsapp_reply" | "schedule";

export interface FlowSchedule {
  time: string;
  days: number[];
  timezone?: string;
  reincludePeople?: boolean;
}

export interface FlowTrigger {
  type: TriggerType;
  fieldMap?: Record<string, string>;
  entryStepId?: string | null;
  /** Canvas position of the trigger node (builder only). */
  position?: { x: number; y: number };
  missedOnly?: boolean;
  keyword?: string;
  schedule?: FlowSchedule;
}

export interface FlowSettings {
  isCallingHoursEnabled?: boolean;
  businessHoursStart?: number | null;
  businessHoursEnd?: number | null;
  timezone?: string | null;
  peopleSource?: "campaign" | "manual" | "sheet";
  campaignId?: number | null;
  sheetPipelineId?: string | null;
  runMode?: "once" | "live";
  autoFeed?: boolean;
  dailyBudgetInr?: number | null;
  [key: string]: unknown;
}

export interface FlowIssue {
  stepId: string | null;
  message: string;
}

export interface Flow {
  id: number;
  agentId: number;
  name: string;
  description: string | null;
  status: "draft" | "active" | "paused";
  presetId: string;
  trigger: FlowTrigger;
  steps: FlowStep[];
  settings: FlowSettings;
  flow: { trigger: FlowTrigger; steps: FlowStep[] };
  validation: { errors: string[]; issues: FlowIssue[] };
  hookUrl: string | null;
  totalRuns: number;
  lastRunAt: string | null;
  updatedAt: string;
}

export interface FlowPreset {
  id: string;
  label: string;
  trigger: string;
  firstContact: string;
  followups: string;
  channels: string;
}

export interface StepCounts {
  ran: number;
  ok: number;
  sent: number;
  skipped: number;
  failed: number;
  waiting: number;
  connected: number;
  paths: Record<string, number>;
}

export interface FlowRun {
  id: number;
  status: string;
  name: string;
  phone: string;
  error: string | null;
  triggeredBy: string | null;
  updatedAt: string;
  call: { callId?: number; connected?: boolean; status?: string; duration?: number; summary?: string } | null;
  version: number;
  currentStepId: string | null;
  stepTrail: Array<{ type?: string; status?: string; reason?: string; at?: string; stepIndex?: number; stepId?: string }>;
}

export type PersonAction = "stop" | "retry" | "skip_wait" | "move" | "complete";

export interface FlowVersion {
  version: number;
  savedAt: string;
  stepCount: number;
  steps: FlowStep[];
  trigger: FlowTrigger;
  activePeople: number;
  totalPeople: number;
}

export interface StepStatsResponse {
  steps: Record<string, StepCounts>;
  dailyBudgetInr: number | null;
  spentTodayPaise: number;
}

const API = "/api";

function json(body: unknown): { method: string; body: string; headers: Record<string, string> } {
  return { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } };
}

export const flowsApi = {
  list: () => customFetch<Flow[]>(`${API}/journeys`),
  get: (id: number) => customFetch<Flow>(`${API}/journeys/${id}`),
  presets: () => customFetch<FlowPreset[]>(`${API}/journeys/presets`),
  create: (body: { agentId: number; name?: string; presetId?: string; trigger?: FlowTrigger; steps?: FlowStep[] }) =>
    customFetch<Flow>(`${API}/journeys`, json(body)),
  update: (id: number, body: Partial<Pick<Flow, "name" | "description" | "agentId" | "trigger" | "steps" | "settings">>) =>
    customFetch<Flow>(`${API}/journeys/${id}`, { ...json(body), method: "PATCH" }),
  remove: (id: number) => customFetch<void>(`${API}/journeys/${id}`, { method: "DELETE" }),
  activate: (id: number) => customFetch<Flow>(`${API}/journeys/${id}/activate`, json({})),
  pause: (id: number) => customFetch<Flow>(`${API}/journeys/${id}/pause`, json({})),
  test: (id: number, context: Record<string, string>) =>
    customFetch<{ runId: number }>(`${API}/journeys/${id}/test`, json(context)),
  start: (id: number, body: { phones?: string[]; campaignId?: number; sheetPipelineId?: string; runMode?: "once" | "live"; force?: boolean }) =>
    customFetch<{ started: number; skipped: number; hasMore?: boolean; sourceTotal?: number }>(
      `${API}/journeys/${id}/start`,
      json(body),
    ),
  stepStats: (id: number) => customFetch<StepStatsResponse>(`${API}/journeys/${id}/step-stats`),
  runs: (id: number, limit = 50) =>
    customFetch<{ runs: FlowRun[]; total: number }>(`${API}/journeys/${id}/runs?limit=${limit}`),
  versions: (id: number) => customFetch<{ current: number; versions: FlowVersion[] }>(`${API}/journeys/${id}/versions`),
  stopAll: (id: number) =>
    customFetch<{ runs: number; queuedCalls: number; journey: Flow }>(`${API}/journeys/${id}/stop-all`, json({})),
  personAction: (id: number, runId: number, action: PersonAction, stepId?: string) =>
    customFetch<{ ok: true }>(`${API}/journeys/${id}/runs/${runId}/action`, json({ action, stepId })),
};

/** Server error message from a customFetch rejection. */
export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err && typeof err === "object") {
    const data = (err as { data?: unknown }).data;
    if (data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string") {
      return (data as { error: string }).error;
    }
    if (err instanceof Error && err.message) return err.message;
  }
  return fallback;
}

export function newStepId(type: string): string {
  return `${type}_${Math.random().toString(36).slice(2, 10)}`;
}
