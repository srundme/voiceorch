/**
 * Lightweight fetch helpers + react-query hooks for the workflow maker.
 * Follows the dashboard convention of relative /api calls with a Bearer token
 * pulled from localStorage.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export type WorkflowStatus = "draft" | "active" | "paused";
export type WorkflowTriggerType = "form_lead" | "instagram_lead" | "sheet_row" | "manual";
export type WorkflowStepType = "make_call" | "sheet_append" | "sheet_update" | "condition" | "delay" | "send_webhook";

export interface WorkflowTrigger {
  type: WorkflowTriggerType;
  connectionId?: string;
  spreadsheetId?: string;
  spreadsheetName?: string;
  sheetName?: string;
  phoneColumn?: string;
  fieldMap?: Record<string, string>;
}

export interface WorkflowStep {
  id: string;
  type: WorkflowStepType;
  agentId?: number;
  phoneField?: string;
  connectionId?: string;
  spreadsheetId?: string;
  sheetName?: string;
  columnMap?: Record<string, string>;
  matchColumn?: string;
  matchField?: string;
  field?: string;
  op?: string;
  value?: string;
  delaySeconds?: number;
  url?: string;
}

export interface Workflow {
  id: number;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  publicToken: string | null;
  hookUrl: string | null;
  totalRuns: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRun {
  id: number;
  status: string;
  triggeredBy: string | null;
  currentStepIndex: number;
  callId: number | null;
  context: Record<string, unknown>;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SheetsConnection {
  id: string;
  email: string;
  connectedAt: string;
  scopeValid: boolean;
}

export function getToken(): string | null {
  try { return localStorage.getItem("voiceorch:session"); } catch { return null; }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const resp = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `Request failed: ${resp.status}`);
  }
  if (resp.status === 204) return undefined as T;
  return resp.json() as Promise<T>;
}

/* ── Workflows ─────────────────────────────────────────────────────────────── */

export function useWorkflows() {
  return useQuery({ queryKey: ["workflows"], queryFn: () => api<Workflow[]>("/workflows") });
}

export function useWorkflow(id: number | null) {
  return useQuery({
    queryKey: ["workflow", id],
    queryFn: () => api<Workflow>(`/workflows/${id}`),
    enabled: id != null && !Number.isNaN(id),
  });
}

export function useWorkflowRuns(id: number | null) {
  return useQuery({
    queryKey: ["workflow-runs", id],
    queryFn: () => api<WorkflowRun[]>(`/workflows/${id}/runs`),
    enabled: id != null && !Number.isNaN(id),
    refetchInterval: 8000,
  });
}

export function useUpdateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<Workflow> }) =>
      api<Workflow>(`/workflows/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (w) => {
      qc.invalidateQueries({ queryKey: ["workflows"] });
      qc.invalidateQueries({ queryKey: ["workflow", w.id] });
    },
  });
}

export function useSetWorkflowStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: "activate" | "pause" }) =>
      api<Workflow>(`/workflows/${id}/${action}`, { method: "POST" }),
    onSuccess: (w) => {
      qc.invalidateQueries({ queryKey: ["workflows"] });
      qc.invalidateQueries({ queryKey: ["workflow", w.id] });
    },
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/workflows/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workflows"] }),
  });
}

export function useTestWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, context }: { id: number; context: Record<string, unknown> }) =>
      api<{ runId: number }>(`/workflows/${id}/test`, { method: "POST", body: JSON.stringify({ context }) }),
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: ["workflow-runs", v.id] }),
  });
}

/* ── Google Sheets connection + pickers ──────────────────────────────────────── */

export function useSheetsConnections() {
  return useQuery({ queryKey: ["workflow-sheets-connections"], queryFn: () => api<SheetsConnection[]>("/workflows/google/connections") });
}

export async function getSheetsConnectUrl(): Promise<string> {
  const origin = window.location.origin;
  const { url } = await api<{ url: string }>(`/workflows/google/connect-url?returnOrigin=${encodeURIComponent(origin)}`);
  return url;
}

export async function listSpreadsheets(connectionId: string): Promise<Array<{ id: string; name: string }>> {
  return api(`/workflows/google/spreadsheets?connectionId=${encodeURIComponent(connectionId)}`);
}

export async function listSheetTabs(connectionId: string, spreadsheetId: string): Promise<string[]> {
  return api(`/workflows/google/sheets?connectionId=${encodeURIComponent(connectionId)}&spreadsheetId=${encodeURIComponent(spreadsheetId)}`);
}

export async function listSheetColumns(connectionId: string, spreadsheetId: string, sheetName: string): Promise<string[]> {
  return api(`/workflows/google/columns?connectionId=${encodeURIComponent(connectionId)}&spreadsheetId=${encodeURIComponent(spreadsheetId)}&sheetName=${encodeURIComponent(sheetName)}`);
}
