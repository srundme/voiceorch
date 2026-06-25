import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "@/lib/api";
import type { AdminFailedCall } from "@workspace/api-client-react";

export type { AdminFailedCall };

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
  page?: number;
  limit?: number;
}

export interface FailedCallsResponse {
  data: AdminFailedCall[];
  total: number;
  page: number;
  pageSize: number;
}

export function usePlatformFailedCalls(filters: FailedCallsFilters = {}) {
  const params = new URLSearchParams();
  if (filters.agentId != null) params.set("agentId", String(filters.agentId));
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.reason) params.set("reason", filters.reason);
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
  totalUserWalletUsd:  number;
  vobizBalanceInr:     number | null;
  requiredMinInr:      number;
  shortfallInr:        number;
  thresholdPct:        number;
  usdToInr:            number;
  status:              "ok" | "warning" | "critical" | "unknown";
}

export function useVobizWalletStatus() {
  return useQuery<VobizWalletStatus>({
    queryKey: ["admin", "vobiz-wallet-status"],
    queryFn:  () => adminFetch<VobizWalletStatus>("/vobiz-wallet-status"),
    refetchInterval: 5 * 60 * 1000, // refresh every 5 minutes
  });
}
