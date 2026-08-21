import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "@/lib/api";
import type { AdminFailedCall } from "@workspace/api-client-react";

export type { AdminFailedCall };

// Book Interns
export function useBookInterns() {
  return useQuery({
    queryKey: ["admin", "book-interns"],
    queryFn: () => adminFetch<any[]>("/book/interns"),
    refetchInterval: 60000,
  });
}

// Real vs. test/internal user segmentation
export type UserSegment = "real" | "test" | "all";

// Overview
export function useOverview(segment: UserSegment = "real") {
  return useQuery({
    queryKey: ["admin", "overview", segment],
    queryFn: () => adminFetch<any>(`/overview?segment=${segment}`),
    refetchInterval: 30000,
  });
}

export type CallVolumePreset = "week" | "month" | "year";

export type CallVolumePoint = {
  period: string;
  total: number;
  completed: number;
  failed: number;
};

export type CallVolumeAnalytics = {
  preset: CallVolumePreset;
  from: string;
  to: string;
  bucket: "day" | "month";
  totals: { total: number; completed: number; failed: number };
  series: CallVolumePoint[];
};

export function useCallVolumeAnalytics(preset: CallVolumePreset = "month", segment: UserSegment = "real") {
  return useQuery({
    queryKey: ["admin", "analytics", "calls", preset, segment],
    queryFn: () => adminFetch<CallVolumeAnalytics>(`/analytics/calls?preset=${preset}&segment=${segment}`),
    refetchInterval: 60_000,
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

export function useSetConcurrentLimit(clerkId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { concurrentLimit: number }) =>
      adminFetch<{ concurrentLimit: number }>(`/users/${clerkId}/concurrent-limit`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users", clerkId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

// Mark / unmark a user as a test/internal account (excluded from real analytics).
export function useSetUserTestFlag(clerkId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { isTest: boolean }) =>
      adminFetch<{ isTest: boolean }>(`/users/${clerkId}/test-flag`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users", clerkId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "overview"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "analytics", "calls"] });
    },
  });
}

// ─── User Management (new) ────────────────────────────────────────────────────

export function useSetUserStatus(clerkId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { status: "active" | "suspended" | "deleted"; reason?: string }) =>
      adminFetch<{ status: string }>(`/users/${clerkId}/status`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users", clerkId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

export function useEditUserProfile(clerkId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { email?: string; name?: string; concurrentLimit?: number }) =>
      adminFetch<any>(`/users/${clerkId}/profile`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users", clerkId] });
    },
  });
}

export function useUserProviders(clerkId: string) {
  return useQuery({
    queryKey: ["admin", "users", clerkId, "providers"],
    queryFn: () => adminFetch<any[]>(`/users/${clerkId}/providers`),
    enabled: !!clerkId,
  });
}

export function useUserCalls(clerkId: string, page = 1) {
  return useQuery({
    queryKey: ["admin", "users", clerkId, "calls", page],
    queryFn: () => adminFetch<any>(`/users/${clerkId}/calls?page=${page}&limit=50`),
    enabled: !!clerkId,
  });
}

export function useUserWalletTransactions(clerkId: string, page = 1) {
  return useQuery({
    queryKey: ["admin", "users", clerkId, "wallet-transactions", page],
    queryFn: () => adminFetch<any>(`/users/${clerkId}/wallet/transactions?page=${page}&limit=100`),
    enabled: !!clerkId,
  });
}

export function useUserAgents(clerkId: string) {
  return useQuery({
    queryKey: ["admin", "users", clerkId, "agents"],
    queryFn: () => adminFetch<any[]>(`/users/${clerkId}/agents`),
    enabled: !!clerkId,
  });
}

// ─── Wallet Controls ──────────────────────────────────────────────────────────

export function useCreditWallet(clerkId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { amountCents: number; description?: string }) =>
      adminFetch<{ newBalanceCents: number }>(`/users/${clerkId}/wallet/credit`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users", clerkId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "users", clerkId, "wallet-transactions"] });
    },
  });
}

export function useDebitWallet(clerkId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { amountCents: number; description?: string }) =>
      adminFetch<{ newBalanceCents: number }>(`/users/${clerkId}/wallet/debit`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users", clerkId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "users", clerkId, "wallet-transactions"] });
    },
  });
}

export function useRefundWallet(clerkId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { amountCents: number; description?: string; callId?: number }) =>
      adminFetch<{ newBalanceCents: number }>(`/users/${clerkId}/wallet/refund`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users", clerkId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "users", clerkId, "wallet-transactions"] });
    },
  });
}

// ─── Agent CRUD (admin) ───────────────────────────────────────────────────────

export function useAdminDeleteAgent(clerkId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (agentId: number) =>
      adminFetch<{ ok: boolean }>(`/agents/${agentId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users", clerkId, "agents"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "users", clerkId] });
    },
  });
}

export function useAdminGetAgent(agentId: number) {
  return useQuery({
    queryKey: ["admin", "agents", agentId],
    queryFn: () => adminFetch<any>(`/agents/${agentId}`),
    enabled: !!agentId,
  });
}

export function useAdminCreateAgent(clerkId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      adminFetch<any>(`/users/${clerkId}/agents`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users", clerkId, "agents"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "users", clerkId] });
    },
  });
}

export function useAdminEditAgent(clerkId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, data }: { agentId: number; data: Record<string, unknown> }) =>
      adminFetch<any>(`/agents/${agentId}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users", clerkId, "agents"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "agents", variables.agentId] });
    },
  });
}

// ─── Impersonation ────────────────────────────────────────────────────────────

export function useImpersonateUser() {
  return useMutation({
    mutationFn: (clerkId: string) =>
      adminFetch<{ sessionToken: string; exchangeCode: string; userName: string | null; userEmail: string | null }>(
        `/impersonate/${clerkId}`,
        { method: "POST" },
      ),
  });
}

export function useEndImpersonation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionToken: string) =>
      adminFetch<{ ok: boolean }>(`/impersonate/sessions/${sessionToken}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "impersonate", "sessions"] });
    },
  });
}

export function useImpersonationSessions() {
  return useQuery({
    queryKey: ["admin", "impersonate", "sessions"],
    queryFn: () => adminFetch<any[]>("/impersonate/sessions"),
    refetchInterval: 30000,
  });
}

// ─── Audit Logs ───────────────────────────────────────────────────────────────

export function useAuditLogs(filters: { userId?: string; action?: string; page?: number } = {}) {
  const { userId, action, page = 1 } = filters;
  const params = new URLSearchParams({ page: String(page), limit: "50" });
  if (userId) params.set("userId", userId);
  if (action) params.set("action", action);

  return useQuery({
    queryKey: ["admin", "audit-logs", filters],
    queryFn: () => adminFetch<any>(`/audit-logs?${params.toString()}`),
  });
}

export function useUserAuditLogs(clerkId: string, page = 1) {
  return useQuery({
    queryKey: ["admin", "audit-logs", { userId: clerkId, page }],
    queryFn: () => adminFetch<any>(`/audit-logs?userId=${clerkId}&page=${page}&limit=50`),
    enabled: !!clerkId,
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

export function useRecentRecharges(opts?: { limit?: number; status?: string }) {
  const limit = opts?.limit ?? 200;
  const status = opts?.status ?? "completed";
  return useQuery({
    queryKey: ["admin", "finance", "recharges", limit, status],
    queryFn: () =>
      adminFetch<{ rows: any[]; total: number; totalAmountCents: number }>(
        `/finance/recharges?limit=${limit}&status=${encodeURIComponent(status)}`,
      ),
    refetchInterval: 30000,
  });
}

export function usePhonePurchases(opts?: {
  limit?: number;
  status?: string;
  numberType?: string;
}) {
  const limit = opts?.limit ?? 200;
  const status = opts?.status ?? "completed";
  const numberType = opts?.numberType ?? "all";
  return useQuery({
    queryKey: ["admin", "phone-purchases", limit, status, numberType],
    queryFn: () =>
      adminFetch<{ rows: any[]; total: number; totalAmountCents: number }>(
        `/phone-purchases?limit=${limit}&status=${encodeURIComponent(status)}&numberType=${encodeURIComponent(numberType)}`,
      ),
    refetchInterval: 30000,
  });
}

function financeRangeParams(from?: string, to?: string) {
  const p = new URLSearchParams();
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  return p.toString();
}

export function useFinanceAuditSummary(from?: string, to?: string) {
  const q = financeRangeParams(from, to);
  return useQuery({
    queryKey: ["admin", "finance", "audit-summary", from, to],
    queryFn: () => adminFetch<any>(`/finance/audit-summary?${q}`),
  });
}

export function useFinanceLedger(opts: {
  from?: string;
  to?: string;
  tab?: string;
  limit?: number;
  offset?: number;
}) {
  const p = new URLSearchParams();
  if (opts.from) p.set("from", opts.from);
  if (opts.to) p.set("to", opts.to);
  if (opts.tab) p.set("tab", opts.tab);
  if (opts.limit) p.set("limit", String(opts.limit));
  if (opts.offset) p.set("offset", String(opts.offset));
  return useQuery({
    queryKey: ["admin", "finance", "ledger", opts],
    queryFn: () => adminFetch<{ rows: any[]; total: number }>(`/finance/ledger?${p}`),
  });
}

export function useFinanceDailyClose(from?: string, to?: string) {
  const q = financeRangeParams(from, to);
  return useQuery({
    queryKey: ["admin", "finance", "daily-close", from, to],
    queryFn: () => adminFetch<any>(`/finance/daily-close?${q}`),
  });
}

export function useFinanceRazorpayGaps() {
  return useQuery({
    queryKey: ["admin", "finance", "razorpay-gaps"],
    queryFn: () => adminFetch<any>("/finance/razorpay-gaps?hours=24"),
  });
}

export function useFinanceEconomics(from?: string, to?: string) {
  const q = financeRangeParams(from, to);
  return useQuery({
    queryKey: ["admin", "finance", "economics", from, to],
    queryFn: () => adminFetch<any>(`/finance/economics?${q}`),
  });
}

export function useFinanceCohorts() {
  return useQuery({
    queryKey: ["admin", "finance", "cohorts"],
    queryFn: () => adminFetch<any>("/finance/cohorts"),
  });
}

export function useFinanceInvestor() {
  return useQuery({
    queryKey: ["admin", "finance", "investor"],
    queryFn: () => adminFetch<any>("/finance/investor"),
  });
}

// ─── Board (Founder / Investor deck) ──────────────────────────────────────────

export interface BoardSettings {
  cashOnHandPaise: number;
  monthlyBurnPaise: number;
  cacPaise: number;
  telephonyCostPaisePerMin: number;
  flagshipClerkId: string | null;
  flagshipGoal: number;
}

export function useBoardSettings() {
  return useQuery({
    queryKey: ["admin", "board", "settings"],
    queryFn: () => adminFetch<BoardSettings>("/board/settings"),
  });
}

export function useUpdateBoardSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<BoardSettings>) =>
      adminFetch<BoardSettings>("/board/settings", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "board"] });
    },
  });
}

export function useBoardPulse() {
  return useQuery({
    queryKey: ["admin", "board", "pulse"],
    queryFn: () => adminFetch<any>("/board/pulse"),
    refetchInterval: 60_000,
  });
}

export function useBoardGrowth() {
  return useQuery({
    queryKey: ["admin", "board", "growth"],
    queryFn: () => adminFetch<any>("/board/growth"),
    refetchInterval: 300_000,
  });
}

export function useBoardRetention() {
  return useQuery({
    queryKey: ["admin", "board", "retention"],
    queryFn: () => adminFetch<any>("/board/retention"),
    refetchInterval: 300_000,
  });
}

export function useBoardMoat() {
  return useQuery({
    queryKey: ["admin", "board", "moat"],
    queryFn: () => adminFetch<any>("/board/moat"),
    refetchInterval: 300_000,
  });
}

export function useBoardUnitEconomics() {
  return useQuery({
    queryKey: ["admin", "board", "unit-economics"],
    queryFn: () => adminFetch<any>("/board/unit-economics"),
    refetchInterval: 300_000,
  });
}

export async function downloadFinanceCsv(pathWithQuery: string, filename: string) {
  const token = localStorage.getItem("adminToken") ?? "";
  const res = await fetch(`/api/admin${pathWithQuery}`, {
    headers: { "X-Admin-Token": token },
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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

export interface FailedCallsFilters {
  agentId?: number | null;
  userId?: string;
  reason?: string;
  executionId?: string;
  page?: number;
  limit?: number;
}

/** The generated schema predates `executionId` on this endpoint. */
export type FailedCallRow = AdminFailedCall & { executionId?: string | null };

export interface FailedCallsResponse {
  data: FailedCallRow[];
  total: number;
  page: number;
  pageSize: number;
}

export function usePlatformFailedCalls(filters: FailedCallsFilters = {}) {
  const params = new URLSearchParams();
  if (filters.agentId != null) params.set("agentId", String(filters.agentId));
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.reason) params.set("reason", filters.reason);
  if (filters.executionId) params.set("executionId", filters.executionId);
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return useQuery({
    queryKey: ["admin", "platform", "failed-calls", filters],
    queryFn: () => adminFetch<FailedCallsResponse>(`/platform/failed-calls${qs ? `?${qs}` : ""}`),
  });
}

export function useFailedCallsAgents() {
  return useQuery({
    queryKey: ["admin", "platform", "failed-calls-agents"],
    queryFn: () => adminFetch<{ id: number; name: string }[]>("/platform/failed-calls/agents"),
  });
}

export interface FailureReasonRow {
  reason: string;
  count: number;
}

export function usePlatformFailedCallsByReason() {
  return useQuery({
    queryKey: ["admin", "platform", "failed-calls", "by-reason"],
    queryFn: () => adminFetch<FailureReasonRow[]>("/platform/failed-calls/by-reason"),
  });
}

// Azure Speaker Recognition connectivity check
export type AzureSpeakerCheckResult =
  | { ok: true; region: string; message: string }
  | { ok: false; region: string | null; status: number | null; error: string };

export function useAzureSpeakerCheck(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "azure-speaker-check"],
    queryFn: () => adminFetch<AzureSpeakerCheckResult>("/azure-speaker-check"),
    enabled,
    staleTime: 0,
    retry: false,
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

// Managed Phone Numbers
export interface ManagedPhoneNumbersData {
  selected: string[];
  available: Array<{ number: string; numberType?: string; region?: string }>;
  fetchError?: string | null;
}

export function useManagedPhoneNumbers() {
  return useQuery({
    queryKey: ["admin", "managed-phone-numbers"],
    queryFn: () => adminFetch<ManagedPhoneNumbersData>("/managed-phone-numbers"),
  });
}

export function useSaveManagedPhoneNumbers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (numbers: string[]) =>
      adminFetch<{ saved: number; numbers: string[] }>("/managed-phone-numbers", {
        method: "POST",
        body: JSON.stringify({ numbers }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "managed-phone-numbers"] });
    },
  });
}

export interface ManagedOutboundTrialSettings {
  dailyLimit: number;
}

export function useManagedOutboundTrial() {
  return useQuery({
    queryKey: ["admin", "managed-outbound-trial"],
    queryFn: () => adminFetch<ManagedOutboundTrialSettings>("/managed-outbound-trial"),
  });
}

export function useSaveManagedOutboundTrial() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { dailyLimit: number }) =>
      adminFetch<ManagedOutboundTrialSettings>("/managed-outbound-trial", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "managed-outbound-trial"] });
    },
  });
}

export function useSetUserUnlimitedTrial(clerkId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { unlimited: boolean }) =>
      adminFetch<{ unlimitedManagedTrial: boolean }>(`/users/${clerkId}/unlimited-trial`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users", clerkId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

// DPDP — admin-triggered erasure (right to be forgotten)
export function useDpdpErasure() {
  return useMutation({
    mutationFn: (phoneNumber: string) =>
      adminFetch<{ ok: boolean; anonymizedCalls: number }>("/dpdp/erasure", {
        method: "POST",
        body: JSON.stringify({ phoneNumber }),
      }),
  });
}

// Admin Voices
export interface AdminVoice {
  id: string;
  name: string;
  language: string;
  description: string;
  isListed: boolean;
  isOwner?: boolean;
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
    mutationFn: (voices: Array<{ id: string; name: string; language?: string; description?: string }>) =>
      adminFetch<{ saved: number }>("/voices/listed", {
        method: "PUT",
        body: JSON.stringify({ voices }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "voices"] });
    },
  });
}

// Spike Alerts
export interface SpikeAlert {
  clerkId: string | null;
  email: string | null;
  name: string | null;
  callCount: number;
  dismissed: boolean;
  notified: boolean;
}

export interface SpikeAlertsData {
  threshold: number | null;
  alerts: SpikeAlert[];
}

export function useSpikeThreshold() {
  return useQuery({
    queryKey: ["admin", "settings", "spike-threshold"],
    queryFn: () => adminFetch<{ threshold: number | null }>("/settings/spike-threshold"),
  });
}

export function useSaveSpikeThreshold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (threshold: number | null) =>
      adminFetch<{ threshold: number | null }>("/settings/spike-threshold", {
        method: "PUT",
        body: JSON.stringify({ threshold }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "settings", "spike-threshold"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "alerts", "spikes"] });
    },
  });
}

export function useSpikeAlertEmail() {
  return useQuery({
    queryKey: ["admin", "settings", "spike-email"],
    queryFn: () => adminFetch<{ email: string | null }>("/settings/spike-email"),
  });
}

export function useSaveSpikeAlertEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (email: string | null) =>
      adminFetch<{ email: string | null }>("/settings/spike-email", {
        method: "PUT",
        body: JSON.stringify({ email }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "settings", "spike-email"] });
    },
  });
}

// Alert Notification Settings
export function useAlertEmail() {
  return useQuery({
    queryKey: ["admin", "settings", "alert-email"],
    queryFn: () => adminFetch<{ email: string | null }>("/settings/alert-email"),
  });
}

export function useSaveAlertEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (email: string | null) =>
      adminFetch<{ email: string | null }>("/settings/alert-email", {
        method: "PUT",
        body: JSON.stringify({ email }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "settings", "alert-email"] });
    },
  });
}

export function useAlertSlackWebhook() {
  return useQuery({
    queryKey: ["admin", "settings", "alert-slack-webhook"],
    queryFn: () => adminFetch<{ webhookUrl: string | null }>("/settings/alert-slack-webhook"),
  });
}

export function useSaveAlertSlackWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (webhookUrl: string | null) =>
      adminFetch<{ webhookUrl: string | null }>("/settings/alert-slack-webhook", {
        method: "PUT",
        body: JSON.stringify({ webhookUrl }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "settings", "alert-slack-webhook"] });
    },
  });
}

export function useAlertMinSeverity() {
  return useQuery({
    queryKey: ["admin", "settings", "alert-min-severity"],
    queryFn: () => adminFetch<{ minSeverity: string }>("/settings/alert-min-severity"),
  });
}

export function useSaveAlertMinSeverity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (minSeverity: string) =>
      adminFetch<{ minSeverity: string }>("/settings/alert-min-severity", {
        method: "PUT",
        body: JSON.stringify({ minSeverity }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "settings", "alert-min-severity"] });
    },
  });
}

export function useAlertNotificationCooldown() {
  return useQuery({
    queryKey: ["admin", "settings", "alert-notification-cooldown"],
    queryFn: () => adminFetch<{ cooldownMinutes: number }>("/settings/alert-notification-cooldown"),
  });
}

export function useSaveAlertNotificationCooldown() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cooldownMinutes: number) =>
      adminFetch<{ cooldownMinutes: number }>("/settings/alert-notification-cooldown", {
        method: "PUT",
        body: JSON.stringify({ cooldownMinutes }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "settings", "alert-notification-cooldown"] });
    },
  });
}

export function useSendTestAlertNotification() {
  return useMutation({
    mutationFn: () =>
      adminFetch<{ ok: boolean; sent: string[]; message: string }>("/settings/alert-notifications/test", {
        method: "POST",
      }),
  });
}

export function useAlertCooldownStats() {
  return useQuery({
    queryKey: ["admin", "settings", "alert-notification-cooldown", "stats"],
    queryFn: () =>
      adminFetch<{ suppressedCount: number; cooldownExpiresAt: number | null }>(
        "/settings/alert-notification-cooldown/stats",
      ),
    refetchInterval: 30000,
  });
}

export function useResetAlertSuppressedCount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      adminFetch<{ ok: boolean }>("/settings/alert-notification-cooldown/stats/reset", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "settings", "alert-notification-cooldown", "stats"] });
    },
  });
}

export interface AlertCooldownStatus {
  lastNotifiedAt: string | null;
  lastNotifiedSeverity: string | null;
  cooldownUntil: string | null;
}

export function useAlertCooldownStatus() {
  return useQuery({
    queryKey: ["admin", "alerts", "cooldown-status"],
    queryFn: () => adminFetch<AlertCooldownStatus>("/alerts/cooldown-status"),
    refetchInterval: 15000,
  });
}

export function useSpikeAlerts() {
  return useQuery({
    queryKey: ["admin", "alerts", "spikes"],
    queryFn: () => adminFetch<SpikeAlertsData>("/alerts/spikes"),
    refetchInterval: 60000,
  });
}

export function useDismissSpikeAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (clerkId: string) =>
      adminFetch<{ ok: boolean }>(`/alerts/spikes/${encodeURIComponent(clerkId)}/dismiss`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "alerts", "spikes"] });
    },
  });
}

// Alert Notification Delivery Log
export interface AlertNotificationLogEntry {
  id: number;
  alertId: number | null;
  channel: "email" | "slack";
  status: "sent" | "failed";
  errorMessage: string | null;
  createdAt: string;
}

export interface AlertNotificationLogSummary {
  email: { lastSentAt: string | null; lastFailedAt: string | null };
  slack: { lastSentAt: string | null; lastFailedAt: string | null };
}

export interface AlertNotificationLogData {
  summary: AlertNotificationLogSummary;
  entries: AlertNotificationLogEntry[];
}

export function useAlertNotificationLog(limit = 50) {
  return useQuery({
    queryKey: ["admin", "alert-notification-log", limit],
    queryFn: () => adminFetch<AlertNotificationLogData>(`/alert-notification-log?limit=${limit}`),
    refetchInterval: 30000,
  });
}

// Prompt Templates
export interface PromptTemplateRow {
  id: number;
  version: number;
  filename: string;
  mimeType: string;
  uploadedBy: string;
  uploadedAt: string;
  isActive: boolean;
}

export function usePromptTemplates() {
  return useQuery({
    queryKey: ["admin", "prompt-templates"],
    queryFn: () => adminFetch<PromptTemplateRow[]>("/prompt-templates"),
    staleTime: 30000,
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

export function useDeployments() {
  return useQuery({
    queryKey: ["admin", "deployments"],
    queryFn: () => adminFetch<any[]>("/deployments"),
    refetchInterval: 30_000,
  });
}

export function useGrowthFunnelV2() {
  return useQuery({
    queryKey: ["admin", "growth", "funnel-v2"],
    queryFn: () => adminFetch<any>("/growth/funnel-v2"),
  });
}

export function useGrowthCohorts() {
  return useQuery({
    queryKey: ["admin", "growth", "cohorts"],
    queryFn: () => adminFetch<any[]>("/growth/cohorts"),
  });
}

export function useGrowthUserJourneys(stage = "all") {
  return useQuery({
    queryKey: ["admin", "growth", "user-journeys", stage],
    queryFn: () => adminFetch<any[]>(`/growth/user-journeys?stage=${stage}`),
  });
}

export function useGrowthDropoffReasons() {
  return useQuery({
    queryKey: ["admin", "growth", "dropoff-reasons"],
    queryFn: () => adminFetch<any>("/growth/dropoff-reasons"),
  });
}

export function useGrowthEventStats() {
  return useQuery({
    queryKey: ["admin", "growth", "event-stats"],
    queryFn: () => adminFetch<any[]>("/growth/event-stats"),
  });
}

// ─── Signups / Lifecycle Report ───────────────────────────────────────────────

export type LifecycleState = "active" | "inactive" | "never_activated" | "suspended" | "closed";

export interface SignupReportRow {
  clerk_id: string;
  email: string | null;
  name: string | null;
  is_test: boolean;
  status: string;
  suspended_at: string | null;
  suspended_reason: string | null;
  onboarding_completed: boolean;
  role: string | null;
  referral_source: string | null;
  auth_method: "password" | "google";
  signed_up_at: string;
  login_count: number;
  first_login_at: string | null;
  last_login_at: string | null;
  first_vibe_at: string | null;
  agent_count: number;
  first_agent_at: string | null;
  call_count: number;
  first_call_at: string | null;
  last_call_at: string | null;
  total_duration_seconds: number;
  last_seen_at: string;
  lifecycle: LifecycleState;
}

export interface SignupReport {
  summary: Record<string, number>;
  rows: SignupReportRow[];
}

export function useSignupReport(segment: UserSegment = "all") {
  return useQuery({
    queryKey: ["admin", "reports", "signups", segment],
    queryFn: () => adminFetch<SignupReport>(`/reports/signups?segment=${segment}`),
    refetchInterval: 60_000,
  });
}

// ── Ambient Sounds ────────────────────────────────────────────────────────────

export interface AmbientSound {
  id: string;
  name: string;
  mimeType: string;
  fileSize: number;
  durationSeconds: number | null;
}

export function useAdminAmbientSounds() {
  return useQuery({
    queryKey: ["admin", "ambient-sounds"],
    queryFn: () => adminFetch<AmbientSound[]>("/ambient-sounds"),
  });
}

// ── Family Agent Provision ────────────────────────────────────────────────────

export interface ProvisionFamilyAgentInput {
  familyAgentId: string;
  name: string;
  systemPrompt: string;
  asrProvider: string;
  asrModel?: string;
  asrLanguage?: string;
  asrBackgroundDenoising?: boolean;
  asrConfidenceThreshold?: number;
  asrEndOfTurnConfidence?: number;
  asrEndOfTurnTimeout?: number;
  asrKeyterms?: string;
  asrSmartEndpointing?: string;
  asrAutoFallback?: boolean;
  llmProvider: string;
  llmModel?: string;
  ttsProvider: string;
  ttsVoice?: string;
  ttsModel?: string;
  telephonyProvider: string;
  temperature?: number;
  maxDuration?: number;
  greetingMessage?: string;
  endCallPhrases?: string;
  language?: string;
  backchannelingEnabled?: boolean;
  backchannelingFrequency?: number;
  noiseCancellationEnabled?: boolean;
  inactivityMessage?: string;
  webhookUrl?: string;
  silenceTimeoutSeconds?: number;
  ambientSoundId?: string;
  dispositionSchema?: Array<{ key: string; label: string; type: string; required?: boolean; options?: string }>;
  memoryEnabled?: boolean;
  crossCallMemoryEnabled?: boolean;
}

export function useProvisionFamilyAgent() {
  return useMutation({
    mutationFn: (data: ProvisionFamilyAgentInput) =>
      adminFetch<{ agentId: number }>("/family/provision", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  });
}

// Token Optimization Kill Switch
export function useTokenOptimizationEnabled() {
  return useQuery({
    queryKey: ["admin", "settings", "token-optimization"],
    queryFn: () => adminFetch<{ enabled: boolean }>("/settings/token-optimization"),
  });
}

export function useSaveTokenOptimizationEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      adminFetch<{ enabled: boolean }>("/settings/token-optimization", {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "settings", "token-optimization"] });
    },
  });
}

export function useSendTestEmail() {
  return useMutation({
    mutationFn: (to: string) =>
      adminFetch<{ ok: boolean; message: string }>("/test-email", {
        method: "POST",
        body: JSON.stringify({ to }),
      }),
  });
}

export interface VobizWalletStatus {
  totalUserWalletInr:  number;
  vobizBalanceInr:     number | null;
  requiredMinInr:      number;
  shortfallInr:        number;
  thresholdPct:        number;
  status:              "ok" | "warning" | "critical" | "unknown";
}

export function useVobizWalletStatus() {
  return useQuery<VobizWalletStatus>({
    queryKey: ["admin", "vobiz-wallet-status"],
    queryFn:  () => adminFetch<VobizWalletStatus>("/vobiz-wallet-status"),
    refetchInterval: 5 * 60 * 1000, // refresh every 5 minutes
  });
}

// ─── Platform Emails ──────────────────────────────────────────────────────────

export function usePlatformEmails(params: { page?: number; userId?: string; search?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.userId) qs.set("userId", params.userId);
  if (params.search) qs.set("search", params.search);
  return useQuery({
    queryKey: ["admin", "emails", params],
    queryFn: () => adminFetch<any>(`/emails?${qs.toString()}`),
  });
}

export interface EmailReportResponse {
  days: number;
  since: string;
  totals: { total: number; sent: number; failed: number };
  byType: Array<{ emailType: string; total: number; sent: number; failed: number }>;
  byDay: Array<{ day: string; total: number; sent: number; failed: number }>;
  recentFailures: Array<{
    id: number;
    toEmail: string;
    subject: string;
    emailType: string;
    errorMessage: string | null;
    sentAt: string;
  }>;
}

export function useEmailReport(days: number = 30) {
  return useQuery({
    queryKey: ["admin", "emails", "report", days],
    queryFn: () => adminFetch<EmailReportResponse>(`/emails/report?days=${days}`),
  });
}

export function usePlatformEmailDetail(id: number | null) {
  return useQuery({
    queryKey: ["admin", "emails", id],
    queryFn: () => adminFetch<any>(`/emails/${id}`),
    enabled: id !== null,
  });
}

export function useSendEmailToUser(clerkId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { subject: string; htmlBody: string; emailType?: string }) =>
      adminFetch<any>(`/users/${clerkId}/send-email`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "emails"] });
    },
  });
}

export function useSendManualEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { toEmail: string; toUserId?: string; toName?: string; subject: string; htmlBody: string; emailType?: string }) =>
      adminFetch<any>("/emails/send", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "emails"] });
    },
  });
}

// ─── Workshop events + feedback analytics ─────────────────────────────────────

export interface WorkshopSession {
  id: string;
  name: string;
}

export interface WorkshopEvent {
  id: number;
  slug: string;
  title: string;
  college: string | null;
  eventDate: string | null;
  mode: "online" | "offline";
  sessions: WorkshopSession[];
  status: "open" | "closed";
  registrationsCount: number;
  attendeesCount: number;
  createdAt: string;
  updatedAt: string;
  responseCount: number;
}

export interface WorkshopEventInput {
  title: string;
  slug?: string;
  college?: string | null;
  eventDate?: string | null;
  mode?: "online" | "offline";
  sessions?: WorkshopSession[];
  status?: "open" | "closed";
  registrationsCount?: number;
  attendeesCount?: number;
}

export function useWorkshopEvents() {
  return useQuery({
    queryKey: ["admin", "events"],
    queryFn: () => adminFetch<WorkshopEvent[]>("/events"),
    refetchInterval: 60_000,
  });
}

export function useCreateWorkshopEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: WorkshopEventInput) =>
      adminFetch<WorkshopEvent>("/events", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "events"] }),
  });
}

export function useUpdateWorkshopEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<WorkshopEventInput> }) =>
      adminFetch<WorkshopEvent>(`/events/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "events"] }),
  });
}

export function useDeleteWorkshopEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminFetch<void>(`/events/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "events"] }),
  });
}

export function useWorkshopAnalytics(id: number | null) {
  return useQuery({
    queryKey: ["admin", "events", id, "analytics"],
    queryFn: () => adminFetch<any>(`/events/${id}/analytics`),
    enabled: id !== null,
    refetchInterval: 60_000,
  });
}

export function useWorkshopResponses(id: number | null) {
  return useQuery({
    queryKey: ["admin", "events", id, "responses"],
    queryFn: () => adminFetch<any[]>(`/events/${id}/responses`),
    enabled: id !== null,
  });
}
