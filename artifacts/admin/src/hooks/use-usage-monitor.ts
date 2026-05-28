import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "@/lib/api";

export type ServiceKey = "stt" | "tts" | "llm";

export interface UsageKpis {
  allocatedMicros: number;
  usedMicros: number;
  remainingMicros: number;
  eventCount: number;
  failedCount: number;
}
export interface UsageTrendPoint {
  bucket: string;
  costMicros: number;
  eventCount: number;
  service?: string | null;
}
export interface ProviderShare {
  provider: string;
  costMicros: number;
  eventCount: number;
}
export interface OverviewResponse {
  combined: UsageKpis;
  perService: { service: string; kpis: UsageKpis }[];
  dailyTrend: UsageTrendPoint[];
  providerShare: ProviderShare[];
}
export interface ModelBreakdown {
  model: string;
  costMicros: number;
  eventCount: number;
  inputTokens: number;
  outputTokens: number;
  audioSeconds: number;
  characters: number;
  allocatedMicros: number;
}
export interface ProviderBreakdown {
  provider: string;
  allocatedMicros: number;
  usedMicros: number;
  remainingMicros: number;
  eventCount: number;
  failedCount: number;
  models: ModelBreakdown[];
}
export interface ServiceResponse {
  service: string;
  kpis: UsageKpis;
  providers: ProviderBreakdown[];
  dailyTrend: UsageTrendPoint[];
  weeklyTrend: UsageTrendPoint[];
  monthlyTrend: UsageTrendPoint[];
}
export interface UsageProviderBreakdown {
  service: string;
  provider: string;
  model: string | null;
  costMicros: number;
  eventCount: number;
}
export interface UsageUserRow {
  userId: string | null;
  email: string | null;
  eventCount: number;
  costMicros: number;
  sttCostMicros: number;
  llmCostMicros: number;
  ttsCostMicros: number;
  providers: UsageProviderBreakdown[];
}
export interface UsageWorkspaceRow {
  workspaceId: string | null;
  eventCount: number;
  costMicros: number;
  sttCostMicros: number;
  llmCostMicros: number;
  ttsCostMicros: number;
  providers: UsageProviderBreakdown[];
}
export interface HistoryEntry {
  id: number;
  createdAt: string;
  service: string;
  provider: string;
  model: string | null;
  userId: string | null;
  email: string | null;
  workspaceId: string | null;
  callId: number | null;
  inputTokens: number;
  outputTokens: number;
  audioSeconds: number;
  characters: number;
  latencyMs: number | null;
  estimatedCostMicros: number;
  success: boolean;
  errorMessage: string | null;
}
export interface PricingRow {
  id: number;
  service: string;
  provider: string;
  model: string;
  inputTokenPricePerMillionMicros: number;
  outputTokenPricePerMillionMicros: number;
  audioSecondPriceMicros: number;
  characterPriceMicros: number;
  updatedAt: string;
}
export interface AllocationRow {
  id: number;
  service: string;
  provider: string;
  workspaceId: string | null;
  allocatedCostMicros: number;
  lowBalanceThresholdMicros: number;
  notes: string | null;
  updatedAt: string;
}
export interface AdminAlert {
  id: number;
  createdAt: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  service: string | null;
  provider: string | null;
  model: string | null;
  payload: Record<string, unknown> | null;
  dedupeKey: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
};

export function useUsageOverview(days: number) {
  return useQuery({
    queryKey: ["usage-monitor", "overview", days],
    queryFn: () => adminFetch<OverviewResponse>(`/usage/overview${qs({ days })}`),
    refetchInterval: 30000,
  });
}
export function useUsageByService(
  service: ServiceKey,
  filters: { days: number; provider?: string | null; model?: string | null; userId?: string | null; workspaceId?: string | null },
) {
  return useQuery({
    queryKey: ["usage-monitor", "service", service, filters],
    queryFn: () => adminFetch<ServiceResponse>(`/usage/services/${service}${qs(filters)}`),
    refetchInterval: 30000,
  });
}
export function useUsageByUser(days: number) {
  return useQuery({
    queryKey: ["usage-monitor", "users", days],
    queryFn: () => adminFetch<{ rows: UsageUserRow[] }>(`/usage/users${qs({ days })}`),
    refetchInterval: 30000,
  });
}
export function useUsageByWorkspace(days: number) {
  return useQuery({
    queryKey: ["usage-monitor", "workspaces", days],
    queryFn: () => adminFetch<{ rows: UsageWorkspaceRow[] }>(`/usage/workspaces${qs({ days })}`),
    refetchInterval: 30000,
  });
}
export function useUsageHistory(filters: Record<string, unknown>) {
  return useQuery({
    queryKey: ["usage-monitor", "history", filters],
    queryFn: () => adminFetch<{ rows: HistoryEntry[]; total: number }>(`/usage/history${qs(filters)}`),
    refetchInterval: 30000,
  });
}

export function usePricing() {
  return useQuery({
    queryKey: ["usage-monitor", "pricing"],
    queryFn: () => adminFetch<PricingRow[]>(`/usage/pricing`),
  });
}
export function useUpsertPricing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<PricingRow, "id" | "updatedAt">) =>
      adminFetch<PricingRow>(`/usage/pricing`, { method: "PUT", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["usage-monitor", "pricing"] }),
  });
}
export function useDeletePricing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminFetch<void>(`/usage/pricing/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["usage-monitor", "pricing"] }),
  });
}

export function useAllocations() {
  return useQuery({
    queryKey: ["usage-monitor", "allocations"],
    queryFn: () => adminFetch<AllocationRow[]>(`/usage/allocations`),
  });
}
export function useUpsertAllocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<AllocationRow, "id" | "updatedAt">) =>
      adminFetch<AllocationRow>(`/usage/allocations`, { method: "PUT", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["usage-monitor", "allocations"] }),
  });
}
export function useDeleteAllocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminFetch<void>(`/usage/allocations/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["usage-monitor", "allocations"] }),
  });
}

export function useAdminAlerts(opts: { limit?: number; onlyUnacknowledged?: boolean } = {}) {
  return useQuery({
    queryKey: ["usage-monitor", "alerts", opts],
    queryFn: () =>
      adminFetch<{ alerts: AdminAlert[]; unacknowledgedCount: number }>(`/alerts${qs(opts as Record<string, unknown>)}`),
    refetchInterval: 30000,
  });
}
export function useAcknowledgeAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminFetch<AdminAlert>(`/alerts/${id}/acknowledge`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["usage-monitor", "alerts"] }),
  });
}

export function microsToUsd(micros: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(
    micros / 1_000_000,
  );
}
