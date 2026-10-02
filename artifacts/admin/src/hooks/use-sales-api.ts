import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { salesFetch, type SalesQuery } from "@/lib/sales-api";
import { useDemoFlag } from "@/components/sales/sales-context";
import type {
  Activity,
  CalendarView,
  Company,
  CompanyDetail,
  CompanyList,
  CompanyListItem,
  Contact,
  DedupeReviewResult,
  Expense,
  GenerateTargetsResult,
  InviteResult,
  LeadCommit,
  LeadPreview,
  Opportunity,
  Payment,
  PaymentAdjustment,
  Pilot,
  PilotDetail,
  PilotReport,
  Proposal,
  ReportsView,
  SalesConfig,
  SalesInvite,
  SalesUser,
  SalesUserFull,
  SettingsView,
  SnapshotImportResult,
  Snapshot,
  StageHistory,
  Subscription,
  Target,
  Task,
  TeamMember,
  TodayView,
} from "@/lib/sales-types";

type Body = Record<string, unknown>;

export const salesKeys = {
  all: ["sales"] as const,
  me: ["sales", "me"] as const,
  invite: (token: string) => ["sales", "invite", token] as const,
  team: ["sales", "team"] as const,
  users: ["sales", "users"] as const,
  settings: ["sales", "settings"] as const,
  targets: (q: SalesQuery) => ["sales", "targets", q] as const,
  companies: (q: SalesQuery) => ["sales", "companies", q] as const,
  companyIndex: (demo: boolean) => ["sales", "company-index", demo] as const,
  company: (id: number) => ["sales", "company", id] as const,
  activities: (q: SalesQuery) => ["sales", "activities", q] as const,
  tasks: (q: SalesQuery) => ["sales", "tasks", q] as const,
  today: (q: SalesQuery) => ["sales", "today", q] as const,
  pilots: (q: SalesQuery) => ["sales", "pilots", q] as const,
  pilot: (id: number) => ["sales", "pilot", id] as const,
  pilotReport: (id: number) => ["sales", "pilot-report", id] as const,
  proposals: (companyId: number) => ["sales", "proposals", companyId] as const,
  payments: (q: SalesQuery) => ["sales", "payments", q] as const,
  subscriptions: (q: SalesQuery) => ["sales", "subscriptions", q] as const,
  subscription: (id: number) => ["sales", "subscription", id] as const,
  calendar: (q: SalesQuery) => ["sales", "calendar", q] as const,
  reports: (q: SalesQuery) => ["sales", "reports", q] as const,
  expenses: (q: SalesQuery) => ["sales", "expenses", q] as const,
  demo: ["sales", "demo"] as const,
};

/** Every mutation refreshes cached sales data except the session itself. */
function useSalesMutation<TVars, TRes>(fn: (vars: TVars) => Promise<TRes>, opts: { invalidate?: boolean; onSuccess?: (res: TRes) => void } = {}) {
  const qc = useQueryClient();
  return useMutation<TRes, Error, TVars>({
    mutationFn: fn,
    onSuccess: async (res) => {
      if (opts.invalidate !== false) {
        await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "sales" && q.queryKey[1] !== "me" && q.queryKey[1] !== "invite" });
      }
      opts.onSuccess?.(res);
    },
  });
}

function useSalesQuery<T>(key: QueryKey, path: string, query?: SalesQuery, enabled = true) {
  return useQuery<T, Error>({
    queryKey: key,
    queryFn: ({ signal }) => salesFetch<T>(path, { query, signal }),
    enabled,
  });
}

/* ── Auth ─────────────────────────────────────────────────────────────── */

export function useSalesMe() {
  return useQuery<{ user: SalesUser }, Error>({
    queryKey: salesKeys.me,
    queryFn: () => salesFetch("/auth/me"),
    retry: false,
    staleTime: 60_000,
  });
}

export function useSalesLogin() {
  const qc = useQueryClient();
  return useMutation<{ user: SalesUser }, Error, { email: string; password: string }>({
    mutationFn: (body) => salesFetch("/auth/login", { method: "POST", body }),
    onSuccess: (res) => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] === "sales" });
      qc.setQueryData(salesKeys.me, res);
    },
  });
}

export function useSalesLogout() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error, void>({
    mutationFn: () => salesFetch("/auth/logout", { method: "POST", body: {} }),
    onSettled: () => qc.removeQueries({ predicate: (q) => q.queryKey[0] === "sales" }),
  });
}

export function useSalesInvite(token: string) {
  return useQuery<{ email: string; role: string; expiresAt: string }, Error>({
    queryKey: salesKeys.invite(token),
    queryFn: () => salesFetch(`/invites/${encodeURIComponent(token)}`),
    retry: false,
  });
}

export function useAcceptInvite(token: string) {
  const qc = useQueryClient();
  return useMutation<{ user: SalesUser }, Error, { name: string; password: string }>({
    mutationFn: (body) => salesFetch(`/invites/${encodeURIComponent(token)}/accept`, { method: "POST", body }),
    onSuccess: (res) => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] === "sales" });
      qc.setQueryData(salesKeys.me, res);
    },
  });
}

/* ── Team, users, settings ────────────────────────────────────────────── */

export function useTeam() {
  return useQuery<TeamMember[], Error>({
    queryKey: salesKeys.team,
    queryFn: async () => (await salesFetch<{ users: TeamMember[] }>("/team")).users,
    staleTime: 5 * 60_000,
  });
}

/** Includes deactivated users so historic records still show a name. */
export function useTeamDirectory() {
  return useQuery<TeamMember[], Error>({
    queryKey: [...salesKeys.team, "all"],
    queryFn: async () => (await salesFetch<{ users: TeamMember[] }>("/team", { query: { includeInactive: 1 } })).users,
    staleTime: 5 * 60_000,
  });
}

export function useSalesUsers(enabled = true) {
  return useSalesQuery<{ users: SalesUserFull[]; invites: SalesInvite[] }>(salesKeys.users, "/users", undefined, enabled);
}
export const useInviteUser = () => useSalesMutation((body: { email: string; role: string }) => salesFetch<InviteResult>("/users", { method: "POST", body }));
export const useUpdateUser = () =>
  useSalesMutation(({ id, ...body }: { id: number; role?: string; status?: string; name?: string }) => salesFetch<{ user: SalesUserFull }>(`/users/${id}`, { method: "PATCH", body }));
export const useRevokeInvite = () => useSalesMutation((id: number) => salesFetch(`/invites/${id}`, { method: "DELETE" }));

export function useSalesSettings() {
  return useQuery<SettingsView, Error>({ queryKey: salesKeys.settings, queryFn: () => salesFetch("/settings"), staleTime: 5 * 60_000 });
}
export const usePutSettings = () =>
  useSalesMutation((body: { config: SalesConfig; reason?: string | null }) => salesFetch<SettingsView>("/settings", { method: "PUT", body }));

export function useTargets(q: { from?: string; to?: string; kind?: string }) {
  return useSalesQuery<{ targets: Target[] }>(salesKeys.targets(q), "/targets", q);
}
export const usePatchTarget = () =>
  useSalesMutation(({ id, ...body }: { id: number } & Body) => salesFetch<{ target: Target }>(`/targets/${id}`, { method: "PATCH", body }));
export const useGenerateTargets = () =>
  useSalesMutation((body: { from?: string; to?: string }) => salesFetch<GenerateTargetsResult>("/targets/generate", { method: "POST", body }));

/* ── Companies & opportunities ────────────────────────────────────────── */

export function useCompanies(q: SalesQuery, enabled = true) {
  const demo = useDemoFlag();
  const query = { ...q, demo };
  return useSalesQuery<CompanyList>(salesKeys.companies(query), "/companies", query, enabled);
}

/** Lightweight id → company lookup for lists whose rows only carry companyId (payments, subscriptions). */
export function useCompanyIndex() {
  const demo = useDemoFlag();
  return useQuery<Map<number, CompanyListItem>, Error>({
    queryKey: salesKeys.companyIndex(demo),
    queryFn: async ({ signal }) => {
      const map = new Map<number, CompanyListItem>();
      for (let page = 1; page <= 10; page++) {
        const res = await salesFetch<CompanyList>("/companies", { query: { page, pageSize: 100, demo }, signal });
        res.items.forEach((c) => map.set(c.id, c));
        if (page * res.pageSize >= res.total) break;
      }
      return map;
    },
    staleTime: 60_000,
  });
}

export function useCompany(id: number | null | undefined) {
  return useSalesQuery<CompanyDetail>(salesKeys.company(id ?? 0), `/companies/${id}`, undefined, Boolean(id));
}

export type CreateCompanyResult = {
  company: Company;
  inbound: boolean;
  contacts: Contact[];
  opportunity: Opportunity | null;
  dedupe: { needsReview: boolean; duplicateOfCompanyId: number | null };
};
export const useCreateCompany = () => useSalesMutation((body: Body) => salesFetch<CreateCompanyResult>("/companies", { method: "POST", body }));
export const useUpdateCompany = () =>
  useSalesMutation(({ id, ...body }: { id: number } & Body) => salesFetch<{ company: Company }>(`/companies/${id}`, { method: "PATCH", body }));
export const useAssignOwner = () =>
  useSalesMutation(({ id, ownerId }: { id: number; ownerId: number | null }) => salesFetch<{ company: Company }>(`/companies/${id}/owner`, { method: "POST", body: { ownerId } }));
export const useDedupeReview = () =>
  useSalesMutation(({ id, ...body }: { id: number; action: "keep_separate" | "merge"; targetCompanyId?: number; reason?: string | null }) =>
    salesFetch<DedupeReviewResult>(`/companies/${id}/dedupe-review`, { method: "POST", body }),
  );
export const useAddContact = () =>
  useSalesMutation(({ companyId, ...body }: { companyId: number } & Body) => salesFetch<{ contact: Contact }>(`/companies/${companyId}/contacts`, { method: "POST", body }));
export const useUpdateContact = () =>
  useSalesMutation(({ id, ...body }: { id: number } & Body) => salesFetch<{ contact: Contact }>(`/contacts/${id}`, { method: "PATCH", body }));
export const useDeleteContact = () => useSalesMutation((id: number) => salesFetch(`/contacts/${id}`, { method: "DELETE" }));
export const useCreateOpportunity = () =>
  useSalesMutation((companyId: number) => salesFetch<{ opportunity: Opportunity }>(`/companies/${companyId}/opportunities`, { method: "POST", body: {} }));
export const useUpdateOpportunity = () =>
  useSalesMutation(({ id, ...body }: { id: number } & Body) => salesFetch<{ opportunity: Opportunity }>(`/opportunities/${id}`, { method: "PATCH", body }));
export const useChangeStage = () =>
  useSalesMutation(({ id, ...body }: { id: number; to: string; note?: string | null; bypassReason?: string | null; evidence?: Body }) =>
    salesFetch<{ opportunity: Opportunity; history: StageHistory; bypass: boolean; skipped: string[] }>(`/opportunities/${id}/stage`, { method: "POST", body }),
  );

/* ── Activities & tasks ───────────────────────────────────────────────── */

export function useActivities(q: SalesQuery, enabled = true) {
  const demo = useDemoFlag();
  const query = { ...q, demo };
  return useSalesQuery<{ activities: Activity[] }>(salesKeys.activities(query), "/activities", query, enabled);
}
export const useCreateActivity = () => useSalesMutation((body: Body) => salesFetch<{ activity: Activity }>("/activities", { method: "POST", body }));
export const useUpdateActivity = () =>
  useSalesMutation(({ id, ...body }: { id: number } & Body) => salesFetch<{ activity: Activity }>(`/activities/${id}`, { method: "PATCH", body }));
export const useCancelActivity = () =>
  useSalesMutation(({ id, reason }: { id: number; reason?: string | null }) => salesFetch<{ activity: Activity }>(`/activities/${id}/cancel`, { method: "POST", body: { reason } }));

export function useTasks(q: SalesQuery, enabled = true) {
  const demo = useDemoFlag();
  const query = { ...q, demo };
  return useSalesQuery<{ scope: string; items: Task[] }>(salesKeys.tasks(query), "/tasks", query, enabled);
}
/** The signed-in user's open tasks, refreshed every minute for the reminders bell. */
export function useTaskReminders() {
  const demo = useDemoFlag();
  const query = { scope: "mine", status: "open", limit: 100, demo };
  return useQuery<{ scope: string; items: Task[] }, Error>({
    queryKey: salesKeys.tasks({ ...query, reminders: true }),
    queryFn: ({ signal }) => salesFetch("/tasks", { query, signal }),
    refetchInterval: 60_000,
  });
}
export const useCreateTask = () => useSalesMutation((body: Body) => salesFetch<{ task: Task }>("/tasks", { method: "POST", body }));
export const useUpdateTask = () => useSalesMutation(({ id, ...body }: { id: number } & Body) => salesFetch<{ task: Task }>(`/tasks/${id}`, { method: "PATCH", body }));
export const useAssignTask = () =>
  useSalesMutation(({ id, ownerId }: { id: number; ownerId: number | null }) => salesFetch<{ task: Task }>(`/tasks/${id}/assign`, { method: "POST", body: { ownerId } }));
export const useCompleteTask = () =>
  useSalesMutation(({ id, outcome }: { id: number; outcome?: string | null }) => salesFetch<{ task: Task }>(`/tasks/${id}/complete`, { method: "POST", body: { outcome } }));
export const useCancelTask = () =>
  useSalesMutation(({ id, reason }: { id: number; reason?: string | null }) => salesFetch<{ task: Task }>(`/tasks/${id}/cancel`, { method: "POST", body: { reason } }));

export function useToday(q: { date?: string; scope?: string; ownerId?: number }) {
  const demo = useDemoFlag();
  const query = { ...q, demo };
  return useSalesQuery<TodayView>(salesKeys.today(query), "/today", query);
}

/* ── Pilots ───────────────────────────────────────────────────────────── */

export function usePilots(q: { companyId?: number; status?: string } = {}) {
  const demo = useDemoFlag();
  const query = { ...q, demo };
  return useSalesQuery<{ pilots: Pilot[] }>(salesKeys.pilots(query), "/pilots", query);
}
export function usePilot(id: number) {
  return useSalesQuery<PilotDetail>(salesKeys.pilot(id), `/pilots/${id}`, undefined, id > 0);
}
export function usePilotReport(id: number) {
  return useSalesQuery<PilotReport>(salesKeys.pilotReport(id), `/pilots/${id}/report`, undefined, id > 0);
}
export const useCreatePilot = () => useSalesMutation((body: Body) => salesFetch<{ pilot: Pilot }>("/pilots", { method: "POST", body }));
export const useUpdatePilot = () => useSalesMutation(({ id, ...body }: { id: number } & Body) => salesFetch<{ pilot: Pilot }>(`/pilots/${id}`, { method: "PATCH", body }));
export const usePilotStatus = () =>
  useSalesMutation(({ id, ...body }: { id: number; to: string; overrideReason?: string | null; reason?: string | null }) =>
    salesFetch<{ pilot: Pilot }>(`/pilots/${id}/status`, { method: "POST", body }),
  );
export const useExtendPilot = () =>
  useSalesMutation(({ id, ...body }: { id: number; attempts: number; reason: string; costLimitPaise: number; reviewAt: string }) =>
    salesFetch<{ pilot: Pilot }>(`/pilots/${id}/extension`, { method: "POST", body }),
  );
export const useAddSnapshot = () =>
  useSalesMutation(({ id, ...body }: { id: number } & Body) =>
    salesFetch<{ result: "created" | "corrected" | "unchanged"; snapshot: Snapshot; pilot: Pilot }>(`/pilots/${id}/snapshots`, { method: "POST", body }),
  );
export const useImportSnapshots = () =>
  useSalesMutation(({ id, ...body }: { id: number; filename: string; rows: Array<Record<string, unknown>> }) =>
    salesFetch<SnapshotImportResult>(`/pilots/${id}/snapshots/import`, { method: "POST", body }),
  );

/* ── Proposals, payments, subscriptions ───────────────────────────────── */

export function useProposals(companyId: number | null | undefined) {
  return useSalesQuery<{ proposals: Proposal[] }>(salesKeys.proposals(companyId ?? 0), "/proposals", { companyId: companyId ?? undefined }, Boolean(companyId));
}
export const useCreateProposal = () => useSalesMutation((body: Body) => salesFetch<{ proposal: Proposal }>("/proposals", { method: "POST", body }));
export const useUpdateProposal = () =>
  useSalesMutation(({ id, ...body }: { id: number } & Body) => salesFetch<{ proposal: Proposal }>(`/proposals/${id}`, { method: "PATCH", body }));
export const useSendProposal = () => useSalesMutation((id: number) => salesFetch<{ proposal: Proposal }>(`/proposals/${id}/send`, { method: "POST", body: {} }));
export const useAcceptProposal = () =>
  useSalesMutation(({ id, ...body }: { id: number; acceptedBy: string; acceptedAt?: string }) => salesFetch<{ proposal: Proposal }>(`/proposals/${id}/accept`, { method: "POST", body }));
export const useDeclineProposal = () =>
  useSalesMutation(({ id, reason }: { id: number; reason?: string | null }) => salesFetch<{ proposal: Proposal }>(`/proposals/${id}/decline`, { method: "POST", body: { reason } }));

export function usePayments(q: { companyId?: number; status?: string } = {}) {
  const demo = useDemoFlag();
  const query = { ...q, demo };
  return useSalesQuery<{ payments: Payment[] }>(salesKeys.payments(query), "/payments", query);
}
export const useRecordPayment = () => useSalesMutation((body: Body) => salesFetch<{ payment: Payment }>("/payments", { method: "POST", body }));
export const useVerifyPayment = () =>
  useSalesMutation((id: number) => salesFetch<{ payment: Payment; firstPaidAt: string | null; renewalDate: string | null }>(`/payments/${id}/verify`, { method: "POST", body: {} }));
export const useRejectPayment = () =>
  useSalesMutation(({ id, reason }: { id: number; reason: string }) => salesFetch<{ payment: Payment }>(`/payments/${id}/reject`, { method: "POST", body: { reason } }));
export const useAdjustPayment = () =>
  useSalesMutation(({ id, ...body }: { id: number; kind: "correction" | "refund"; feeDeltaPaise: number; taxDeltaPaise: number; reason: string }) =>
    salesFetch<{ payment: Payment; adjustment: PaymentAdjustment }>(`/payments/${id}/adjustments`, { method: "POST", body }),
  );

export function useSubscriptions(q: { companyId?: number } = {}) {
  const demo = useDemoFlag();
  const query = { ...q, demo };
  return useSalesQuery<{ subscriptions: Subscription[] }>(salesKeys.subscriptions(query), "/subscriptions", query);
}
export function useSubscription(id: number | null | undefined) {
  return useSalesQuery<{ subscription: Subscription; tasks: Task[] }>(salesKeys.subscription(id ?? 0), `/subscriptions/${id}`, undefined, Boolean(id));
}
export const useCreateSubscription = () => useSalesMutation((body: Body) => salesFetch<{ subscription: Subscription }>("/subscriptions", { method: "POST", body }));
export const useUpdateSubscription = () =>
  useSalesMutation(({ id, ...body }: { id: number } & Body) => salesFetch<{ subscription: Subscription }>(`/subscriptions/${id}`, { method: "PATCH", body }));
export const useGoLive = () =>
  useSalesMutation(({ id, ...body }: { id: number; startDate?: string; liveAt?: string }) =>
    salesFetch<{ subscription: Subscription; opportunityStage: string | null }>(`/subscriptions/${id}/live`, { method: "POST", body }),
  );
export const useSubscriptionStatus = () =>
  useSalesMutation(({ id, action, reason }: { id: number; action: "pause" | "resume" | "cancel"; reason?: string }) =>
    salesFetch<{ subscription: Subscription }>(`/subscriptions/${id}/${action}`, { method: "POST", body: action === "cancel" ? { reason } : {} }),
  );

/* ── Imports, calendar, reports, expenses, demo ───────────────────────── */

type LeadImportBody = { filename: string; rows: Array<Record<string, unknown>>; decisions?: Record<string, "create" | "skip"> };
export const useLeadImportPreview = () =>
  useSalesMutation((body: LeadImportBody) => salesFetch<LeadPreview>("/imports/leads/preview", { method: "POST", body }), { invalidate: false });
export const useLeadImportCommit = () => useSalesMutation((body: LeadImportBody) => salesFetch<LeadCommit>("/imports/leads/commit", { method: "POST", body }));

export function useCalendar(q: { from: string; to: string; scope?: string; types?: string }) {
  const demo = useDemoFlag();
  const query = { ...q, demo };
  return useSalesQuery<CalendarView>(salesKeys.calendar(query), "/calendar", query);
}

export function useReports(q: { from: string; to: string; groupBy?: string; cohort?: string }) {
  const demo = useDemoFlag();
  const query = { ...q, demo };
  return useSalesQuery<ReportsView>(salesKeys.reports(query), "/reports", query, q.from <= q.to);
}

export function useExpenses(q: { from?: string; to?: string; category?: string }) {
  const demo = useDemoFlag();
  const query = { ...q, demo };
  return useSalesQuery<{ items: Expense[]; totalPaise: number }>(salesKeys.expenses(query), "/expenses", query);
}
export const useCreateExpense = () => useSalesMutation((body: Body) => salesFetch<{ expense: Expense }>("/expenses", { method: "POST", body }));
export const useUpdateExpense = () =>
  useSalesMutation(({ id, ...body }: { id: number } & Body) => salesFetch<{ expense: Expense }>(`/expenses/${id}`, { method: "PATCH", body }));
export const useDeleteExpense = () => useSalesMutation((id: number) => salesFetch(`/expenses/${id}`, { method: "DELETE" }));

export function useDemoStatus(enabled: boolean) {
  return useSalesQuery<{ demoCompanies: number }>(salesKeys.demo, "/demo", undefined, enabled);
}
export const useSeedDemo = () => useSalesMutation(() => salesFetch<{ seeded: boolean; companyIds: number[] }>("/demo/seed", { method: "POST", body: {} }));
export const useClearDemo = () =>
  useSalesMutation(() => salesFetch<{ removed: { companies: number; tasks: number; expenses: number } }>("/demo", { method: "DELETE" }));
