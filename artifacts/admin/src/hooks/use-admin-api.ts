import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "@/lib/api";

// Overview
export function useOverview() {
  return useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => adminFetch<any>("/overview"),
    refetchInterval: 30000,
  });
}

// Users
export function useUsers() {
  return useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => adminFetch<any[]>("/users"),
  });
}

export function useUserDetail(clerkId: string) {
  return useQuery({
    queryKey: ["admin", "users", clerkId],
    queryFn: () => adminFetch<any>(`/users/${clerkId}`),
    enabled: !!clerkId,
  });
}

export function useAdjustWallet(clerkId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { adjustmentCents: number; description: string }) => 
      adminFetch<{ newBalanceCents: number }>(`/users/${clerkId}/wallet`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users", clerkId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

// Finance
export function useFinanceSummary() {
  return useQuery({
    queryKey: ["admin", "finance", "summary"],
    queryFn: () => adminFetch<any>("/finance/summary"),
  });
}

export function useFinanceTransactions() {
  return useQuery({
    queryKey: ["admin", "finance", "transactions"],
    queryFn: () => adminFetch<any[]>("/finance/transactions"),
  });
}

// Platform
export function usePlatformActive() {
  return useQuery({
    queryKey: ["admin", "platform", "active"],
    queryFn: () => adminFetch<any>("/platform/active"),
    refetchInterval: 10000,
  });
}

export function usePlatformCallbacks() {
  return useQuery({
    queryKey: ["admin", "platform", "callbacks"],
    queryFn: () => adminFetch<any[]>("/platform/callbacks"),
    refetchInterval: 10000,
  });
}

export function usePlatformFailedCalls() {
  return useQuery({
    queryKey: ["admin", "platform", "failed-calls"],
    queryFn: () => adminFetch<any[]>("/platform/failed-calls"),
  });
}

// Managed Keys
export function useManagedKeys() {
  return useQuery({
    queryKey: ["admin", "managed-keys"],
    queryFn: () => adminFetch<Record<string, string>>("/managed-keys"),
  });
}

export function useSaveManagedKeys() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, string>) =>
      adminFetch<{ saved: number }>("/managed-keys", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "managed-keys"] });
    },
  });
}

// Admin Voices
export interface AdminVoice {
  id: string;
  name: string;
  gender: string;
  language: string;
  description: string;
  isListed: boolean;
}

export function useAdminCartesiaVoices() {
  return useQuery({
    queryKey: ["admin", "voices", "cartesia"],
    queryFn: () => adminFetch<{ voices: AdminVoice[] }>("/voices/cartesia"),
  });
}

export function useAdminListedVoices() {
  return useQuery({
    queryKey: ["admin", "voices", "listed"],
    queryFn: () => adminFetch<{ voices: AdminVoice[] }>("/voices/listed"),
  });
}

export function useSaveListedVoices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (voices: Array<{ id: string; name: string; gender?: string; language?: string; description?: string }>) =>
      adminFetch<{ saved: number }>("/voices/listed", {
        method: "PUT",
        body: JSON.stringify({ voices }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "voices"] });
    },
  });
}

// Usage
export interface UsageRow {
  clerkId: string | null;
  email: string | null;
  callCount: number;
  sttCallCount: number;
  avgSttLatencyMs: number | null;
  llmCallCount: number;
  avgLlmLatencyMs: number | null;
  ttsCallCount: number;
  avgTtsFirstChunkMs: number | null;
  totalDurationSeconds: number;
  totalCostCents: number;
}

export interface UsageData {
  totals: {
    totalSttCalls: number;
    totalLlmCalls: number;
    totalTtsCalls: number;
  };
  rows: UsageRow[];
}

export function useUsage(days: number) {
  return useQuery({
    queryKey: ["admin", "usage", days],
    queryFn: () => adminFetch<UsageData>(`/usage?days=${days}`),
  });
}

// Growth
export function useGrowthFunnel() {
  return useQuery({
    queryKey: ["admin", "growth", "funnel"],
    queryFn: () => adminFetch<any>("/growth/funnel"),
  });
}

export function useGrowthTopUsers() {
  return useQuery({
    queryKey: ["admin", "growth", "top-users"],
    queryFn: () => adminFetch<any[]>("/growth/top-users"),
  });
}

export function useGrowthInactive() {
  return useQuery({
    queryKey: ["admin", "growth", "inactive"],
    queryFn: () => adminFetch<any[]>("/growth/inactive"),
  });
}
